import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { loadBank, supportedModel, validArray, scoreSamples, decide, decisionDetails } from '../scripts/fingerprint.mjs';
import { sourceThread, candidatePaths } from '../scripts/runtime.mjs';
import { promptFor, forkOne, prepareForks, prepareFresh, runSamples } from '../scripts/probes.mjs';
import { parseArgs, summary } from '../scripts/check.mjs';

const { bank } = await loadBank();
const refs = JSON.parse(await readFile(new URL('./fixtures/astra-reference.json', import.meta.url), 'utf8'));
const samples = refs.map(r => ({ text: r.text, count: r.requested_count }));
const source = { id: 'source-1234', model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'max', cwd: '/workspace', path: '/source.jsonl' };

test('pinned bank passes hashes; only covered GPT selections supported', () => {
  assert.equal(bank.models.length, 13);
  assert.equal(bank.models.filter(m => supportedModel(m.id, bank)).length, 6);
  assert.ok(supportedModel('gpt-6-astra', bank));
  for (const id of ['deepseek-v4-pro', 'gpt-7', 'claude-opus-5', 'gpt-6-astra-proxy']) assert.equal(supportedModel(id, bank), false);
});
test('reference scorer smoke test is not a live accuracy evaluation', () => {
  const result = scoreSamples(samples, 'gpt-6-astra', bank);
  assert.equal(result.analysis.prediction, 'gpt-6-astra');
  assert.equal(result.validSamples, 3);
  assert.equal(result.status, 'match');
  assert.ok(result.analysis.results.every(x => Number.isFinite(x.score)));
});
test('malformed, short, negative, decimal and tool answers cannot become match', () => {
  for (const text of ['我拒绝回答', '[1,2]', '[' + '-1,'.repeat(299) + '1]', '[' + '1.2,'.repeat(299) + '1]'])
    assert.equal(validArray(text, 300), false);
  assert.equal(scoreSamples([{ ...samples[0], error: { code: 'TOOL_ATTEMPT' } }], 'gpt-6-astra', bank).status, 'inconclusive');
  assert.equal(scoreSamples(samples.slice(0, 2), 'gpt-6-astra', bank).status, 'inconclusive');
  assert.equal(scoreSamples(samples, 'deepseek-v4-pro', bank).analysis, null);
});
test('decision gates decline low-margin and incomplete samples', () => {
  const a = { results: [{ model: 'gpt-5.6-sol', probability: .98, score: 2 }, { model: 'gpt-6-astra', probability: .02, score: 1 }] };
  assert.equal(decide(a, 'gpt-6-astra', 3), 'mismatch');
  assert.equal(decide(a, 'gpt-5.6-sol', 3), 'match');
  assert.equal(decide(a, 'gpt-5.6-sol', 2), 'inconclusive');
  a.results[1].score = 1.8;
  assert.equal(decide(a, 'gpt-5.6-sol', 3), 'inconclusive');
  a.results[0].score = NaN;
  assert.equal(decide(a, 'gpt-5.6-sol', 3), 'inconclusive');
});
test('decision reasons distinguish incomplete, ambiguous and matching results without changing thresholds', () => {
  const analysis = { results: [
    { model: 'gpt-6-astra', probability: .976, score: 1.33 },
    { model: 'gpt-5.6-sol', probability: .019, score: 1 },
  ] };
  const margin = decisionDetails(analysis, 'gpt-6-astra', 3);
  assert.equal(margin.reason, 'LOW_MARGIN');
  assert.equal(margin.status, 'inconclusive');
  assert.ok(Math.abs(margin.scoreGap - .33) < 1e-10);
  assert.equal(margin.minScoreGap, .5);
  assert.equal(decisionDetails(analysis, 'gpt-6-astra', 2).reason, 'INSUFFICIENT_SAMPLES');
  assert.equal(decisionDetails(analysis, 'gpt-6-astra', 3, { scoreGap: .3 }).status, 'match');
  const weak = { results: [{ model: 'gpt-5.6-sol', probability: .598, score: 1 }, { model: 'gpt-5.6-terra', probability: .375, score: .96 }] };
  const unclear = decisionDetails(weak, 'gpt-5.6-sol', 3);
  assert.equal(unclear.reason, 'LOW_WEIGHT');
  assert.equal(unclear.runnerUpWeight, .375);
  assert.equal(unclear.minRelativeWeight, .8);
  assert.equal(decisionDetails(null, 'gpt-6-astra', 3).reason, 'INVALID_ANALYSIS');
});
test('current session comes from explicit trusted identifier, never latest history', () => {
  assert.equal(sourceThread(null, { CODEX_THREAD_ID: 'thread-12345' }), 'thread-12345');
  assert.equal(sourceThread('thread-67890', { CODEX_THREAD_ID: 'thread-12345' }), 'thread-67890');
  assert.throws(() => sourceThread(null, {}), { code: 'NO_CURRENT_THREAD' });
});
test('Mac and Windows executable candidates preserve spaces and use native paths', () => {
  assert.equal(candidatePaths('darwin', { CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop' }, '/Users/a', ['/bin'])[0], '/Applications/ChatGPT.app/Contents/Resources/codex');
  const win = candidatePaths('win32', {}, 'C:\\Users\\Test User', ['C:\\Program Files\\NodeJS']);
  assert.deepEqual(win, ['C:\\Program Files\\NodeJS\\codex.exe', 'C:\\Program Files\\NodeJS\\node_modules\\@openai\\codex\\bin\\codex.js']);
});
function forkApp(override = {}) {
  let index = 0;
  return { calls: [], async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/turns/list') return { data: [{ id: 'live', status: 'inProgress' }, { id: 'done', status: 'completed' }] };
    assert.equal(method, 'thread/fork');
    return { model: source.model, modelProvider: source.modelProvider, reasoningEffort: source.reasoningEffort, cwd: source.cwd,
      thread: { id: `fork-${++index}`, ephemeral: true, path: null, forkedFromId: source.id }, ...override };
  } };
}
test('three distinct temporary forks use exactly the same completed boundary and settings', async () => {
  const app = forkApp(); const forks = await prepareForks(app, source);
  assert.equal(new Set(forks.map(f => f.id)).size, 3);
  assert.ok(forks.every(f => f.boundary === 'done' && f.count >= 292 && f.count <= 332));
  assert.ok(app.calls.filter(c => c.method === 'thread/fork').every(c => c.params.lastTurnId === 'done' && c.params.ephemeral && c.params.model === source.model && c.params.config.model_reasoning_effort === 'max'));
  assert.match(promptFor('en', 300), /Do not call tools/);
});
test('fork mismatches fail closed before any inference', async () => {
  for (const override of [{ model: 'gpt-5.6-sol' }, { modelProvider: 'other' }, { reasoningEffort: 'low' }, { cwd: '/different' }])
    await assert.rejects(forkOne(forkApp(override), source, 'done'), { code: 'SETTINGS_CHANGED' });
  await assert.rejects(forkOne(forkApp({ thread: { id: 'persisted', ephemeral: false } }), source, 'done'), { code: 'WRONG_FORK' });
});
test('fast mode creates empty ephemeral sessions with exact source configuration and no fallback', async () => {
  const calls = [];
  const app = { async request(method, p) {
    calls.push({ method, p });
    return { model: source.model, modelProvider: source.modelProvider, reasoningEffort: source.reasoningEffort, cwd: source.cwd,
      thread: { id: `fresh-${calls.length}`, ephemeral: true, path: null, turns: [] } };
  } };
  const batch = await prepareFresh(app, source);
  assert.equal(batch.length, 3);
  assert.ok(calls.every(c => c.method === 'thread/start' && !c.p.threadId && !c.p.allowProviderModelFallback && c.p.model === source.model && c.p.config.model_reasoning_effort === 'max'));
  assert.ok(batch.every(t => t.boundary === null));
  const wrong = { async request() { return { thread: { id: 'wrong', ephemeral: true, turns: [{}] } }; } };
  await assert.rejects(prepareFresh(wrong, source), { code: 'WRONG_SESSION' });
});
class SampleApp extends EventEmitter {
  constructor(mode) { super(); this.mode = mode; this.calls = []; }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'turn/interrupt') return {};
    assert.equal(method, 'turn/start');
    const turnId = `turn-${params.threadId}`;
    queueMicrotask(() => {
      this.emit('notification', { method: 'turn/started', params: { threadId: params.threadId, turn: { id: turnId } } });
      if (this.mode === 'timeout') return;
      if (this.mode === 'tool') {
        this.emit('notification', { method: 'item/started', params: { threadId: params.threadId, item: { type: 'commandExecution' } } }); return;
      }
      this.emit('notification', { method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', phase: 'final_answer', text: samples[0].text } } });
      this.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { id: turnId, status: 'completed' } } });
    });
    return { turn: { id: turnId } };
  }
}
const testForks = Array.from({ length: 3 }, (_, i) => ({ id: `fork-${i}`, prompt: 'test-only', count: 300 }));
test('runner collects real notifications, never uses reference answers as fallback', async () => {
  const app = new SampleApp('success');
  const results = await runSamples(app, testForks, { timeoutMs: 1000 });
  assert.ok(results.every(r => r.text === samples[0].text && !r.error));
  assert.equal(app.calls.filter(x => x.method === 'turn/start').length, 3);
});
test('tool attempts invalidate samples and interrupt only their own fork', async () => {
  const app = new SampleApp('tool'); const results = await runSamples(app, testForks, { timeoutMs: 1000 });
  assert.ok(results.every(r => r.error.code === 'TOOL_ATTEMPT' && !r.text));
  assert.ok(app.calls.filter(x => x.method === 'turn/interrupt').every(x => x.params.threadId.startsWith('fork-')));
});
test('timeouts are execution failures with cancelled probe turns', async () => {
  const app = new SampleApp('timeout'); const results = await runSamples(app, testForks, { timeoutMs: 20 });
  assert.ok(results.every(r => r.error.code === 'PROBE_TIMEOUT' && !r.text));
  assert.equal(app.calls.filter(x => x.method === 'turn/interrupt').length, 3);
});
test('CLI validates bounds and reports unsupported without an accusation', () => {
  assert.equal(parseArgs(['doctor', '--json']).command, 'doctor');
  assert.equal(parseArgs([]).context, 'fresh');
  assert.throws(() => parseArgs(['--context', 'mystery']), { code: 'ARGUMENT' });
  assert.throws(() => parseArgs(['--timeout', '0']), { code: 'ARGUMENT' });
  assert.match(summary({ status: 'unsupported' }), /未发送探针/);
});
