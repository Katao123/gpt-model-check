import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AppServer } from '../scripts/app-server.mjs';
import { saveReceipt } from '../scripts/check.mjs';

const fixture = fileURLToPath(new URL('./fixtures/mock-app-server.mjs', import.meta.url));
const runtime = { command: process.execPath, prefix: [fixture] };
test('native JSON-lines transport, permission refusal, timeout and redacted server errors', async () => {
  const app = new AppServer(runtime, 'test-only');
  try {
    assert.equal((await app.initialize()).userAgent, 'test-only');
    await assert.rejects(app.request('test/error'), e => e.code === 'PROTOCOL_ERROR' && !/private|secret-token/.test(e.message));
    const notice = once(app, 'notification');
    await app.request('test/tool');
    assert.equal((await notice)[0].method, '_server_request');
    assert.equal(app.serverRequests, 1);
    await assert.rejects(app.request('test/timeout', {}, 20), { code: 'RPC_TIMEOUT' });
  } finally { await app.close(); }
  assert.ok(app.closed);
});
test('receipt and install work in paths with spaces; existing skills are preserved', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gpt check '));
  try {
    const file = await saveReceipt({ status: 'test-only', samples: [] }, null, { CODEX_HOME: root });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).status, 'test-only');
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
    const install = fileURLToPath(new URL('../install.mjs', import.meta.url));
    const first = spawnSync(process.execPath, [install], { env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const dest = path.join(root, 'skills', 'gpt-model-check', 'SKILL.md');
    const before = await readFile(dest, 'utf8');
    const models = spawnSync(process.execPath, [path.join(path.dirname(dest), 'scripts/check.mjs'), 'models'],
      { env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8' });
    assert.equal(models.status, 0, models.stderr);
    assert.equal(JSON.parse(models.stdout).models.length, 6);
    const again = spawnSync(process.execPath, [install], { env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8' });
    assert.equal(again.status, 1);
    assert.equal(await readFile(dest, 'utf8'), before);
    await writeFile(path.join(path.dirname(dest), 'local-customization.txt'), 'keep my old version');
    const update = spawnSync(process.execPath, [install, '--update'], { env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8' });
    assert.equal(update.status, 0, update.stderr);
    const backups = path.join(root, 'gpt-model-check', 'backups');
    const [backup] = await readdir(backups);
    assert.equal(await readFile(path.join(backups, backup, 'local-customization.txt'), 'utf8'), 'keep my old version');
    assert.equal(await readFile(dest, 'utf8'), before);
    await assert.rejects(stat(path.join(path.dirname(dest), '.git')));
    await assert.rejects(stat(path.join(path.dirname(dest), 'tests')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
