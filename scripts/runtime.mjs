import { access, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CheckError } from './errors.mjs';

export const codexHome = (env = process.env) => env.CODEX_HOME || path.join(os.homedir(), '.codex');
export function sourceThread(explicit, env = process.env) {
  const id = explicit || env.CODEX_THREAD_ID || env.CODEX_SESSION_ID;
  if (!id || !/^[a-zA-Z0-9_-]{8,128}$/.test(id))
    throw new CheckError('NO_CURRENT_THREAD', '请在要检测的 Codex 任务中运行 $gpt-model-check，无法从外部终端猜测当前任务。');
  return id;
}
const exists = async p => { try { await access(p); return true; } catch { return false; } };

// These are candidates, not a promise that every Desktop distribution bundles a CLI.
export function candidatePaths(platform, env, home, pathEntries) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const desktop = /desktop/i.test(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || '');
  const bundle = platform === 'darwin' ? [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    p.join(home, 'Applications/ChatGPT.app/Contents/Resources/codex'),
    p.join(home, 'Applications/Codex.app/Contents/Resources/codex'),
  ] : [];
  const bins = pathEntries.flatMap(dir => platform === 'win32'
    ? [p.join(dir, 'codex.exe'), p.join(dir, 'node_modules/@openai/codex/bin/codex.js')]
    : [p.join(dir, 'codex')]);
  return [...new Set(desktop ? [...bundle, ...bins] : [...bins, ...bundle])];
}

export async function resolveRuntime(explicit, env = process.env) {
  const requested = explicit || env.GPT_MODEL_CHECK_CODEX_PATH;
  if (requested) {
    if (!path.isAbsolute(requested) || !await exists(requested))
      throw new CheckError('CODEX_PATH_INVALID', '--codex 必须是已存在的 Codex 可执行文件绝对路径。');
    return executable(requested, 'explicit');
  }
  const entries = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const candidates = candidatePaths(process.platform, env, os.homedir(), entries);
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    const root = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const versions = await readdir(root).catch(() => []);
    const found = [];
    for (const v of versions) {
      const f = path.join(root, v, 'codex.exe');
      if (await exists(f)) found.push(f);
    }
    if (found.length === 1) {
      if (/desktop/i.test(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || '')) candidates.unshift(found[0]);
      else candidates.push(found[0]);
    } else if (found.length > 1 && /desktop/i.test(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || '')) {
      throw new CheckError('AMBIGUOUS_CODEX', '发现多个 Desktop 运行时，无法确定当前版本。请用 --codex 指定当前客户端的 codex.exe。');
    }
  }
  for (const f of candidates) if (await exists(f)) return executable(f, 'auto');
  throw new CheckError('CODEX_NOT_FOUND', '没有找到可用的 Codex 运行时。请安装 Codex CLI，或用 --codex 指向 Desktop 配套运行时。');
}
async function executable(file, selection) {
  const resolved = await realpath(file);
  if (/\.(cmd|bat)$/i.test(resolved))
    throw new CheckError('CODEX_WRAPPER', '请指定 codex.exe 或 @openai/codex/bin/codex.js，不能直接启动批处理包装器。');
  return {
    file: resolved, selection,
    command: /\.[cm]?js$/i.test(resolved) ? process.execPath : resolved,
    prefix: /\.[cm]?js$/i.test(resolved) ? [resolved] : [],
  };
}
