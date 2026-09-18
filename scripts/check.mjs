#!/usr/bin/env node
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AppServer } from './app-server.mjs';
import { resolveRuntime, sourceThread, codexHome } from './runtime.mjs';
import { readSource, prepareForks, prepareFresh, runSamples } from './probes.mjs';
import { loadBank, supportedModel, scoreSamples, GATES } from './fingerprint.mjs';
import { CheckError } from './errors.mjs';
import { STATES, resultMarkdown, presentationFor } from './presentation.mjs';
import { prepareRetry } from './retry.mjs';
import { recordCheck } from './community.mjs';

export function parseArgs(args) {
  const out = { command: 'check', timeout: 180, context: 'fresh' };
  if (args.length && !args[0].startsWith('--')) out.command = args.shift();
  if (!['check', 'doctor', 'models', 'render'].includes(out.command)) throw new CheckError('ARGUMENT', '用法：check.mjs [check|doctor|models]，或 check.mjs render --receipt 记录文件');
  while (args.length) {
    const flag = args.shift();
    if (flag === '--json') { out.json = true; continue; }
    if (!['--thread', '--codex', '--output', '--timeout', '--context', '--receipt'].includes(flag) || !args[0] || args[0].startsWith('--'))
      throw new CheckError('ARGUMENT', '参数不完整或不受支持。');
    out[flag.slice(2)] = args.shift();
  }
  out.timeout = Number(out.timeout);
  if (!Number.isInteger(out.timeout) || out.timeout < 5 || out.timeout > 600)
    throw new CheckError('ARGUMENT', '--timeout 必须是 5–600 秒之间的整数。');
  if (!['fresh', 'current'].includes(out.context)) throw new CheckError('ARGUMENT', '--context 仅支持 fresh 或 current。');
  if ((out.command === 'render') !== Boolean(out.receipt)) throw new CheckError('ARGUMENT', '回放请使用 render --receipt <记录文件>；不会发起模型请求。');
  return out;
}
const sameSettings = (a, b) => ['id', 'model', 'modelProvider', 'reasoningEffort', 'cwd', 'originator'].every(k => a[k] === b[k]);

export async function connectCurrent(options, env = process.env) {
  const id = sourceThread(options.thread, env);
  let runtime = await resolveRuntime(options.codex, env);
  let originator = env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || null;
  let app = new AppServer(runtime, originator, { env });
  try {
    await app.initialize();
    let source = await readSource(app, id);
    if (typeof source.originator !== 'string' || !source.originator || /[\r\n]/.test(source.originator))
      throw new CheckError('NO_ORIGINATOR', '当前运行时没有提供客户端来源，无法保证检测走相同客户端通道。');
    const nextRuntime = await resolveRuntime(options.codex, { ...env, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: source.originator });
    if (source.originator !== originator || nextRuntime.file !== runtime.file) {
      originator = source.originator; runtime = nextRuntime; await app.close();
      app = new AppServer(runtime, originator, { env }); await app.initialize();
      const checked = await readSource(app, id);
      if (!sameSettings(source, checked)) throw new CheckError('SOURCE_CHANGED', '读取期间任务配置发生变化，请重新检测。');
      source = checked;
    }
    return { app, source, runtime, originator };
  } catch (e) { await app.close(); throw e; }
}

export async function saveReceipt(report, output, env = process.env) {
  const directory = output ? path.resolve(output) : path.join(codexHome(env), 'gpt-model-check', 'reports');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`);
  await writeFile(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return file;
}

export function summary(report) {
  if (report.command === 'doctor') return [
    'Codex 连接成功（尚未发出模型请求）',
    `当前选择：${report.source.model} · ${report.source.provider} · ${report.source.effort || '默认档位'}`,
    `客户端：${report.source.originator}`,
    `指纹库：${report.supported ? '支持检测' : '暂不支持此模型'}`,
    `运行时：${report.runtime.file}`,
  ].join('\n');
  return resultMarkdown(report);
}

export async function execute(options, { env = process.env, progress = () => {}, signal } = {}) {
  if (options.command === 'render') {
    const receipt = path.resolve(options.receipt);
    let saved;
    try { saved = JSON.parse(await readFile(receipt, 'utf8')); }
    catch { throw new CheckError('RECEIPT_READ_FAILED', '无法读取指定检测记录。'); }
    if (!saved || saved.tool !== 'gpt-model-check' || saved.schemaVersion !== 1 || !Object.hasOwn(STATES, saved.status))
      throw new CheckError('INVALID_RECEIPT', '这个文件不是可回放的检测记录。');
    return prepareRetry({ ...saved, receipt, replay: true }, env);
  }
  const { bank, provenance } = await loadBank();
  if (options.command === 'models') return { models: bank.models.filter(m => supportedModel(m.id, bank)).map(m => ({ id: m.id, name: m.display_name })) };
  const start = Date.now();
  const { app, source, runtime, originator } = await connectCurrent(options, env);
  const report = {
    schemaVersion: 1, tool: 'gpt-model-check', toolVersion: '0.1.13', command: options.command,
    createdAt: new Date().toISOString(), context: options.context || 'fresh',
    source: { id: source.id, model: source.model, provider: source.modelProvider, effort: source.reasoningEffort, originator },
    runtime: { file: runtime.file, selection: runtime.selection, platform: process.platform, node: process.version },
    supported: supportedModel(source.model, bank),
    bank: { sha256: provenance.bankSha256, builtAt: provenance.bankBuiltAt, commit: provenance.upstreamCommit, modelCount: bank.models.length },
    limits: [
      'Fingerprint similarity within a closed reference bank, not authenticated model identity or an IQ test.',
      'Relative candidate weights are not calibrated probabilities of actual model identity.',
      'Unknown actual models can resemble known candidates. Matching cannot exclude unlisted models.',
      (options.context === 'current'
        ? 'Three temporary forks share a completed source turn; later/in-progress content is excluded.'
        : 'Three new ephemeral sessions use the source model/provider/effort/cwd and native runtime. Source history and client-injected per-thread instructions are not reproduced.'),
      'This does not inspect routing of past requests or prove that every current conversation request follows the same route.',
      'System prompt, history, client version and sampling settings can affect the result.',
      'Hooks/notifications disabled and read-only/untrusted permissions applied only in the private probe process.',
    ],
    gates: GATES,
  };
  try {
    if (options.command === 'doctor') return report;
    if (!report.supported) Object.assign(report, { status: 'unsupported', samples: [], validSamples: 0 });
    else {
      if (signal?.aborted) throw new CheckError('CANCELLED', '检测已取消。');
      const forks = options.context === 'current' ? await prepareForks(app, source) : await prepareFresh(app, source);
      const fresh = await readSource(app, source.id);
      if (!sameSettings(source, fresh)) throw new CheckError('SOURCE_CHANGED', '采样前任务配置发生变化，请重新检测。');
      progress(0, 3);
      report.boundary = forks[0].boundary;
      report.samples = await runSamples(app, forks, { timeoutMs: options.timeout * 1000, progress, signal });
      const withUsage = report.samples.filter(s => s.usage && Number.isFinite(s.usage.input) && Number.isFinite(s.usage.output));
      if (withUsage.length) report.usage = withUsage.reduce((a, s) => ({
        input: a.input + s.usage.input, output: a.output + s.usage.output,
        cachedInput: a.cachedInput + (s.usage.cachedInput || 0), samples: a.samples + 1,
      }), { input: 0, output: 0, cachedInput: 0, samples: 0 });
      Object.assign(report, scoreSamples(report.samples, source.model, bank));
      const finalSource = await readSource(app, source.id);
      if (!sameSettings(source, finalSource)) {
        report.status = 'inconclusive';
        report.error = { code: 'SOURCE_CHANGED', message: '检测过程中当前模型配置发生变化，结果不能代表现在的选择。' };
      }
      if (report.samples.every(s => s.error)) report.status = 'error';
    }
  } catch (e) {
    report.status = 'error';
    report.error = e instanceof CheckError ? { code: e.code, message: e.message } : { code: 'INTERNAL_ERROR', message: '检测遇到内部错误，未作模型判断。' };
  } finally { report.serverRequestsRefused = app.serverRequests; await app.close(); }
  report.elapsedMs = Date.now() - start;
  report.community = await recordCheck(report, { env });
  report.receipt = await saveReceipt(report, options.output, env);
  return prepareRetry(report, env);
}

async function main() {
  let options;
  const cancellation = new AbortController();
  const stop = () => cancellation.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    options = parseArgs(process.argv.slice(2));
    const report = await execute(options, { signal: cancellation.signal,
      progress: (n, total) => process.stderr.write(`GPT 指纹检测：${n}/${total} 组已完成\n`),
    });
    if (options.json || options.command === 'models') console.log(JSON.stringify(report.status ? { ...report, presentation: presentationFor(report) } : report, null, 2));
    else console.log(summary(report));
    if (report.status === 'error') process.exitCode = 1;
  } catch (e) {
    const report = { status: 'error', error: e instanceof CheckError ? { code: e.code, message: e.message } : { code: 'INTERNAL_ERROR', message: '检测无法启动；请检查 Node.js、Codex 及本地目录权限。' } };
    console.log(options?.json ? JSON.stringify(report, null, 2) : summary(report)); process.exitCode = 1;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
// Node resolves the module URL through symlinks, while argv keeps the user's path
// (for example /var vs /private/var on macOS). Compare the canonical entry path.
const [entry, self] = await Promise.all([
  process.argv[1] ? realpath(process.argv[1]).catch(() => null) : null,
  realpath(fileURLToPath(import.meta.url)),
]);
if (entry && entry === self) await main();
