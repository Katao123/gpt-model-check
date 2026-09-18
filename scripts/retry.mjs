import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { codexHome } from './runtime.mjs';

// Desktop only reads inline pages from this task's visualization directory or
// authorized workspace roots. A global skill asset is not a readable UI page.
export function retryDirectory(home, id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  const date = new Date(parseInt(id.replaceAll('-', '').slice(0, 12), 16));
  if (!Number.isFinite(date.valueOf())) return null;
  const [year, month, day] = date.toISOString().slice(0, 10).split('-');
  return path.join(home, 'visualizations', year, month, day, id);
}

export async function prepareRetry(report, env = process.env) {
  // On replay the viewer can be a different task. Never reuse a saved UI path
  // or guess the viewer from the report's original source task.
  const view = { ...report, retryArtifact: null, retryIncludesReceipt: false };
  const directory = retryDirectory(codexHome(env), env.CODEX_THREAD_ID || env.CODEX_SESSION_ID);
  if (report.status !== 'inconclusive' || !/desktop/i.test(report.source?.originator || '') || !directory) return view;
  const suffix = typeof report.receipt === 'string'
    ? `-${createHash('sha256').update(report.receipt).digest('hex').slice(0, 12)}` : '';
  const file = path.join(directory, `gpt-model-check-retry${suffix}.html`);
  try {
    await mkdir(directory, { recursive: true });
    if ((await lstat(file).catch(() => null))?.isSymbolicLink()) return view;
    const contents = await readFile(new URL('../assets/retry.html', import.meta.url), 'utf8');
    await writeFile(file, contents);
    view.retryArtifact = file;
  } catch {
    // A display failure must not erase a completed check or trigger new probes.
    // Presentation offers the usable "send 重新检测" fallback instead.
  }
  return view;
}
