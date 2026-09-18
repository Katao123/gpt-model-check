import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { recordCheck, REPOSITORY_URL } from '../scripts/community.mjs';
import { execute, parseArgs } from '../scripts/check.mjs';
import { resultMarkdown } from '../scripts/presentation.mjs';

const run = { command: 'check', supported: true, status: 'match', samples: [{ turnId: 'test-turn' }] };
const day = 86_400_000;
async function isolated(body) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'gpt community '));
  try { await body({ CODEX_HOME: home }); } finally { await rm(home, { recursive: true, force: true }); }
}

test('only actual checks count; the first three never invite, a fourth can', async () => isolated(async env => {
  for (const report of [{ ...run, command: 'doctor' }, { ...run, replay: true }, { ...run, command: 'render' },
    { ...run, supported: false }, { ...run, samples: [] }, { ...run, samples: [{ error: {} }] }])
    assert.equal(await recordCheck(report, { env }), null);
  await assert.rejects(access(path.join(env.CODEX_HOME, 'gpt-model-check')));
  for (let checks = 1; checks <= 4; checks++)
    assert.deepEqual(await recordCheck(run, { env, random: () => 0, now: day }), { checks, showStar: checks === 4 });
}));

test('random selection, three-check spacing and a daily cap suppress repeated invitations', async () => isolated(async env => {
  for (let i = 0; i < 3; i++) await recordCheck(run, { env, now: day });
  assert.equal((await recordCheck(run, { env, random: () => 0.8, now: day })).showStar, false);
  assert.equal((await recordCheck(run, { env, random: () => 0, now: day })).showStar, true);
  for (let i = 0; i < 5; i++) assert.equal((await recordCheck(run, { env, random: () => 0, now: day })).showStar, false);
  assert.equal((await recordCheck(run, { env, random: () => 0, now: 2 * day })).showStar, true);
  assert.equal((await recordCheck(run, { env, random: () => 0, now: 3 * day })).showStar, false);
  assert.equal((await recordCheck(run, { env, random: () => 0, now: 3 * day })).showStar, false);
  assert.equal((await recordCheck(run, { env, random: () => 0, now: 3 * day })).showStar, true);
}));

test('opt-out and failed checks never show a star invitation', async () => isolated(async env => {
  for (let i = 0; i < 4; i++) {
    const result = await recordCheck(run, { env: { ...env, GPT_MODEL_CHECK_STAR_PROMPT: '0' }, random: () => 0 });
    assert.equal(result.showStar, false);
  }
  const failure = await recordCheck({ ...run, status: 'error' }, { env, random: () => 0 });
  assert.equal(failure.checks, 5);
  assert.equal(failure.showStar, false);
}));

test('parallel sidebar checks retain the count and show at most one invitation', async () => isolated(async env => {
  const results = await Promise.all(Array.from({ length: 10 }, () => recordCheck(run, { env, random: () => 0, now: day })));
  assert.deepEqual(results.map(r => r.checks).sort((a, b) => a - b), Array.from({ length: 10 }, (_, i) => i + 1));
  assert.equal(results.filter(r => r.showStar).length, 1);
  const state = JSON.parse(await readFile(path.join(env.CODEX_HOME, 'gpt-model-check/usage.json'), 'utf8'));
  assert.equal(state.checks, 10);
  assert.deepEqual(Object.keys(state).sort(), ['checks', 'lastPromptAt', 'lastPromptCheck', 'schemaVersion']);
}));

test('local feedback storage failure cannot fail or retry a model check', async () => isolated(async env => {
  const blocked = path.join(env.CODEX_HOME, 'blocked');
  await writeFile(blocked, 'file, not directory');
  assert.equal(await recordCheck(run, { env: { CODEX_HOME: blocked } }), null);
}));

test('replay suppresses saved invitations and leaves local usage unchanged', async () => isolated(async env => {
  await recordCheck(run, { env });
  const file = path.join(env.CODEX_HOME, 'gpt-model-check/usage.json');
  const before = await readFile(file, 'utf8');
  const saved = { ...run, schemaVersion: 1, tool: 'gpt-model-check', community: { checks: 4, showStar: true } };
  const receipt = path.join(env.CODEX_HOME, 'receipt.json');
  await writeFile(receipt, JSON.stringify(saved));
  const replay = await execute(parseArgs(['render', '--receipt', receipt]), { env });
  assert.doesNotMatch(resultMarkdown(replay), /Star/);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.ok(resultMarkdown(saved).includes(REPOSITORY_URL));
  assert.doesNotMatch(resultMarkdown({ ...saved, status: 'error' }), /Star/);
}));
