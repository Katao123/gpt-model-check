import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { codexHome } from './runtime.mjs';

export const REPOSITORY_URL = 'https://github.com/Katao123/gpt-model-check';
export const STAR_MESSAGE = `如果这个工具对你有帮助，欢迎 [点个 ⭐ Star](${REPOSITORY_URL})。`;
const DAY = 24 * 60 * 60 * 1000;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

// Count actual probe runs, including rechecks. Reading a receipt or checking
// compatibility is not a run. No account, model, answer or device ID is recorded.
export function isCountedCheck(report) {
  return report.command === 'check' && !report.replay && report.supported === true
    && Array.isArray(report.samples) && report.samples.some(s => typeof s.turnId === 'string' && s.turnId.length > 0);
}

async function acquire(lock) {
  for (let attempt = 0; attempt < 25; attempt++) {
    try { await mkdir(lock, { mode: 0o700 }); return true; }
    catch (error) { if (error.code !== 'EEXIST') return false; }
    // A killed process must not suppress the local counter permanently.
    const info = await stat(lock).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 30_000) await rm(lock, { recursive: true, force: true }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}

export async function recordCheck(report, { env = process.env, random = Math.random, now = Date.now() } = {}) {
  if (!isCountedCheck(report)) return null;
  const directory = path.join(codexHome(env), 'gpt-model-check');
  const file = path.join(directory, 'usage.json');
  const lock = path.join(directory, 'usage.lock');
  const temporary = path.join(directory, `usage-${randomUUID()}.tmp`);
  let owned = false;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    owned = await acquire(lock);
    if (!owned) return null;
    let previous;
    try { previous = JSON.parse(await readFile(file, 'utf8')); } catch { /* Start locally at zero. */ }
    const checks = Math.min(nonnegative(previous?.checks) + 1, Number.MAX_SAFE_INTEGER);
    const lastPromptCheck = nonnegative(previous?.lastPromptCheck);
    const lastPromptAt = nonnegative(previous?.lastPromptAt);
    const eligible = checks > 3 && env.GPT_MODEL_CHECK_STAR_PROMPT !== '0'
      && ['match', 'mismatch', 'inconclusive'].includes(report.status)
      && (!lastPromptCheck || (checks - lastPromptCheck >= 3 && now - lastPromptAt >= DAY));
    const showStar = eligible && random() < 0.25;
    const state = { schemaVersion: 1, checks,
      lastPromptCheck: showStar ? checks : lastPromptCheck,
      lastPromptAt: showStar ? now : lastPromptAt };
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
    return { checks, showStar };
  } catch {
    // This optional local reminder must never break or retry a detection.
    return null;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
    if (owned) await rm(lock, { recursive: true, force: true }).catch(() => {});
  }
}
