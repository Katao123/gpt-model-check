import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STATES, formatWeight, usageFor, presentationFor, resultMarkdown } from '../scripts/presentation.mjs';
import { execute, parseArgs } from '../scripts/check.mjs';

const report = {
  schemaVersion: 1, tool: 'gpt-model-check', status: 'match',
  source: { model: 'gpt-6-astra', effort: 'max', originator: 'Codex Desktop' }, validSamples: 3,
  analysis: { results: [{ model: 'gpt-6-astra', probability: .91 }] },
  elapsedMs: 98834, usage: { input: 84467, output: 7683, samples: 3 },
};

test('each outcome renders exactly its own bundled, intact image', async () => {
  const manifest = JSON.parse(await readFile(new URL('../assets/states/manifest.json', import.meta.url), 'utf8'));
  const images = new Set();
  for (const status of Object.keys(STATES)) {
    const current = { ...report, status };
    const view = presentationFor(current);
    images.add(view.imagePath);
    assert.ok(path.isAbsolute(view.imagePath));
    assert.equal(path.basename(view.imagePath), manifest.assets[status].file);
    const png = await readFile(view.imagePath);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(createHash('sha256').update(png).digest('hex'), manifest.assets[status].sha256);
    const markdown = resultMarkdown(current);
    assert.equal((markdown.match(/!\[/g) || []).length, 1);
    assert.ok(markdown.includes(view.imageMarkdown));
  }
  assert.equal(images.size, 5);
});

test('weights describe the top candidate without claiming 100 percent identity', () => {
  for (const [value, expected] of [[0, '0%'], [.91, '91%'], [.9800256187, '98%'], [.999777619, '>99.9%'], [1, '>99.9%'], [.00001, '<0.1%']])
    assert.equal(formatWeight(value), expected);
  for (const value of [undefined, null, NaN, Infinity, -1, 1.1]) assert.equal(formatWeight(value), null);
  const mismatch = { ...report, status: 'mismatch', analysis: { results: [{ model: 'gpt-5.6-luna', probability: .91 }, { model: 'gpt-6-astra', probability: .09 }] } };
  const view = presentationFor(mismatch);
  assert.equal(view.candidate, 'gpt-5.6-luna');
  assert.equal(view.relativeWeight, '91%');
  assert.equal(view.weightMeaning, '库内匹配权重');
  assert.equal(presentationFor({ ...report, analysis: {} }).relativeWeight, null);
});

test('high candidate weight never promotes inconclusive or failed outcomes', () => {
  const inconclusive = presentationFor({ ...report, status: 'inconclusive', analysis: { results: [{ model: 'gpt-6-astra', probability: .98 }] } });
  assert.equal(inconclusive.status, 'inconclusive');
  assert.equal(inconclusive.relativeWeight, null);
  assert.equal(path.basename(inconclusive.imagePath), 'inconclusive.png');
  for (const status of ['error', 'unsupported']) {
    const view = presentationFor({ ...report, status });
    assert.equal(view.relativeWeight, null);
    assert.equal(view.candidate, null);
  }
});

test('low-margin output keeps the verdict without mixing raw and percentage scales', () => {
  const analysis = { results: [
    { model: 'gpt-6-astra', score: 1.3291576497060167, probability: .975868488591515 },
    { model: 'gpt-5.6-sol', score: .9993018229051779, probability: .018635305197160733 },
  ] };
  const current = { ...report, status: 'inconclusive', analysis, gates: { scoreGap: .5 },
    retryArtifact: '/test-home/visualizations/2026/09/18/01a0b29a-0000-7000-8000-000000000001/gpt-model-check-retry.html' };
  const markdown = resultMarkdown(current);
  assert.doesNotMatch(markdown, /97\.6%|codex-followup/);
  assert.match(markdown, /gpt-6-astra 排名第一，第二名是 gpt-5\.6-sol/);
  assert.match(markdown, /领先 0\.330 分/);
  assert.match(markdown, /至少领先 0\.500 分/);
  assert.equal((markdown.match(/visualize/g) || []).length, 1);
  const reference = JSON.parse(markdown.match(/visualize(.*?)/)[1]);
  assert.ok(path.isAbsolute(reference.path));
  assert.equal(path.basename(reference.path), 'gpt-model-check-retry.html');
  for (const status of ['match', 'mismatch', 'unsupported', 'error'])
    assert.doesNotMatch(resultMarkdown({ ...report, status }), /visualize/);
  // Presentation never edits the raw evidence or silently changes a verdict.
  assert.equal(current.analysis.results[0].probability, .975868488591515);
  assert.equal(current.gates.scoreGap, .5);
  assert.equal(presentationFor(current).status, 'inconclusive');
  const borderline = { ...current, analysis: { results: [
    { model: 'gpt-6-astra', probability: .999, score: 1.4999 },
    { model: 'gpt-5.6-sol', probability: .001, score: 1 },
  ] } };
  assert.match(presentationFor(borderline).detail, /领先 不足 0\.500 分/);
  assert.match(resultMarkdown({ ...current, source: { ...current.source, originator: 'Codex CLI' } }), /发送「重新检测」/);
  assert.doesNotMatch(resultMarkdown({ ...current, source: { ...current.source, originator: 'Codex CLI' } }), /visualize/);
});

test('nearly 100 percent with one timeout explains missing evidence, not model mismatch', () => {
  const partial = { ...report, status: 'inconclusive', validSamples: 2,
    source: { model: 'gpt-5.6-luna' },
    analysis: { results: [{ model: 'gpt-5.6-luna', probability: .9996819363, score: 1.766 }, { model: 'gpt-5.5', probability: .00027, score: 1.082 }] },
    rejected: [{ sample: 1, reason: 'PROBE_TIMEOUT' }],
  };
  const view = presentationFor(partial);
  assert.equal(view.status, 'inconclusive');
  assert.equal(view.relativeWeight, null);
  assert.match(view.detail, /1 组请求超时/);
  assert.match(view.detail, /2\/3 组有效样本/);
  assert.match(view.detail, /偏向 gpt-5\.6-luna/);
  assert.doesNotMatch(view.detail, /指纹不符|发生模型切换/);
  assert.doesNotMatch(resultMarkdown(partial), />99\.9%/);
  assert.equal(partial.analysis.results[0].probability, .9996819363);
});

test('weak lead names both candidates instead of claiming the selected model is wrong', () => {
  const current = { ...report, status: 'inconclusive', source: { model: 'gpt-5.6-sol' },
    analysis: { results: [{ model: 'gpt-5.6-sol', probability: .598, score: .98 }, { model: 'gpt-5.6-terra', probability: .375, score: .94 }] },
  };
  const view = presentationFor(current);
  for (const value of ['gpt-5.6-sol', '59.8%', 'gpt-5.6-terra', '37.5%', '80%']) assert.ok(view.detail.includes(value));
  assert.equal(view.status, 'inconclusive');
  assert.doesNotMatch(view.detail, /指纹不符/);
  assert.equal(view.relativeWeight, '59.8%');
});

test('the approved low-weight example uses one percentage scale, even when top differs', () => {
  const current = { ...report, status: 'inconclusive', source: { ...report.source, model: 'gpt-5.6-sol' },
    analysis: { results: [
      { model: 'gpt-5.6-terra', probability: .6795793197512563, score: .7 },
      { model: 'gpt-5.4', probability: .16517224171124145, score: .58 },
      { model: 'gpt-5.6-sol', probability: .10743340470320502, score: .5 },
    ] },
  };
  const view = presentationFor(current);
  assert.equal(view.status, 'inconclusive');
  assert.equal(view.relativeWeight, '68%');
  for (const value of ['gpt-5.6-terra', '68%', 'gpt-5.4', '16.5%', '80%']) assert.ok(view.detail.includes(value));
  assert.doesNotMatch(resultMarkdown(current), /原始分|0\.500/);
  const changed = { ...current, error: { code: 'SOURCE_CHANGED', message: '配置发生变化' } };
  assert.equal(presentationFor(changed).relativeWeight, null);
  assert.match(presentationFor(changed).detail, /所选模型发生了变化/);
});

test('unknown usage stays unknown; old per-probe receipts and partial totals remain accurate', () => {
  assert.deepEqual(usageFor({ status: 'error' }), { input: null, output: null, samples: null });
  assert.deepEqual(usageFor({ status: 'unsupported', samples: [] }), { input: 0, output: 0, samples: 0 });
  assert.deepEqual(usageFor({ samples: [{ usage: { input: 5, output: 2 } }, { error: {} }, { usage: { input: 8, output: 3 } }] }), { input: 13, output: 5, samples: 2 });
  assert.deepEqual(usageFor({ usage: { input: 0, output: 0, samples: 3 } }), { input: 0, output: 0, samples: 3 });
  const partial = resultMarkdown({ ...report, usage: { input: 12, samples: 1 } });
  assert.match(partial, /输入 Token \*\*12\*\*/);
  assert.match(partial, /输出 Token \*\*未返回\*\*/);
  assert.match(partial, /仅 1\/3 组返回用量/);
  assert.match(resultMarkdown({ status: 'error' }), /输入 Token \*\*未返回\*\*/);
});

test('result keeps actual token counts but omits script duration that differs from UI time', () => {
  const markdown = resultMarkdown(report);
  assert.match(markdown, /84,467/);
  assert.match(markdown, /7,683/);
  assert.match(markdown, /有效样本 3\/3/);
  assert.doesNotMatch(markdown, /耗时|秒|98,834|99 秒/);
  assert.equal(report.elapsedMs, 98834); // Still available in the original receipt.
  const escaped = resultMarkdown({ ...report, source: { model: 'model\n![injected](url)' }, receipt: 'C:\\Users\\Test User\\receipt.json' });
  assert.equal((escaped.match(/!\[/g) || []).length, 1);
  assert.match(escaped, /<C:\/Users\/Test User\/receipt.json>/);
});

test('saved receipts replay offline without a current thread, runtime, or new receipt', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gpt presentation '));
  try {
    const receipt = path.join(directory, 'previous check.json');
    const original = JSON.stringify(report);
    await writeFile(receipt, original);
    const options = parseArgs(['render', '--receipt', receipt]);
    const saved = await execute(options, { env: {} });
    assert.equal(saved.replay, true);
    assert.equal(saved.receipt, receipt);
    assert.deepEqual(saved.usage, report.usage);
    assert.equal(saved.elapsedMs, report.elapsedMs);
    assert.match(resultMarkdown(saved), /历史检测结果回放/);
    const command = fileURLToPath(new URL('../scripts/check.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [command, 'render', '--receipt', receipt, '--codex', path.join(directory, 'does-not-exist'), '--json'], { env: { PATH: directory }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');
    const json = JSON.parse(run.stdout);
    assert.equal(json.presentation.relativeWeight, '91%');
    assert.equal(json.presentation.usage.input, report.usage.input);
    assert.equal(await readFile(receipt, 'utf8'), original);
    await writeFile(receipt, 'null');
    await assert.rejects(execute(options, { env: {} }), { code: 'INVALID_RECEIPT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('ambiguous render arguments never fall through into a paid check', () => {
  for (const args of [['render'], ['--receipt', '/tmp/check.json'], ['check', '--receipt', '/tmp/check.json']])
    assert.throws(() => parseArgs(args), { code: 'ARGUMENT' });
});
