#!/usr/bin/env node
import { mkdir, cp, rename, rm, access, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const source = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const target = path.join(base, 'skills', 'gpt-model-check');
const temporary = `${target}.install-${randomUUID().slice(0, 8)}`;
const args = process.argv.slice(2);
let backup = null;
let replaced = false;
try {
  if (args.some(arg => arg !== '--update') || args.length > 1) throw new Error('用法：node install.mjs [--update]');
  if (path.resolve(source) === path.resolve(target)) throw new Error('请从下载的新版仓库目录运行安装脚本。');
  const manifest = await readFile(path.join(source, 'SKILL.md'), 'utf8');
  if (!manifest.includes('name: gpt-model-check')) throw new Error('安装包不完整。');
  let exists = false; try { await access(target); exists = true; } catch {}
  if (exists && !args.includes('--update')) throw new Error(`已经存在 ${target}；更新请运行 node install.mjs --update，旧版会自动备份。`);
  if (exists) {
    const old = await readFile(path.join(target, 'SKILL.md'), 'utf8');
    if (!old.includes('name: gpt-model-check')) throw new Error('目标目录不是 gpt-model-check，未覆盖。');
  }
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(temporary);
  // Install only distributable runtime resources, not a Git checkout or reports.
  for (const name of ['SKILL.md', 'agents', 'assets', 'scripts', 'package.json', 'LICENSE', 'install.mjs'])
    await cp(path.join(source, name), path.join(temporary, name), { recursive: true, errorOnExist: true, force: false });
  for (const name of ['README.md', 'README.en.md', 'THIRD_PARTY_NOTICES.md']) {
    try { await access(path.join(source, name)); }
    catch { continue; }
    await cp(path.join(source, name), path.join(temporary, name), { errorOnExist: true, force: false });
  }
  if (exists) {
    backup = path.join(base, 'gpt-model-check', 'backups', `skill-${Date.now()}-${randomUUID().slice(0, 8)}`);
    await mkdir(path.dirname(backup), { recursive: true });
    await rename(target, backup);
    replaced = true;
  }
  await rename(temporary, target);
  console.log(`已安装：${target}\n在 Codex 下一轮对话输入 $gpt-model-check；若未出现，重新打开 Codex。`);
  if (backup) console.log(`旧版备份：${backup}`);
} catch (e) {
  await rm(temporary, { recursive: true, force: true });
  if (replaced) await rename(backup, target).catch(() => console.error(`恢复旧版未完成，备份保留在：${backup}`));
  console.error(e.message); process.exitCode = 1;
}
