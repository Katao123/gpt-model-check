import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import { retryDirectory, prepareRetry } from '../scripts/retry.mjs';
import { execute, parseArgs } from '../scripts/check.mjs';
import { presentationFor, resultMarkdown } from '../scripts/presentation.mjs';

const html = await readFile(new URL('../assets/retry.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function mount(sendFollowUpMessage) {
  const handlers = {};
  const attributes = {};
  const link = { hidden: false, textContent: '重新检测',
    addEventListener: (type, handler) => { handlers[type] = handler; },
    setAttribute: (key, value) => { attributes[key] = value; },
    removeAttribute: key => { delete attributes[key]; },
    click: () => handlers.click?.({ preventDefault() {} }),
  };
  const status = { textContent: '' };
  const label = { textContent: '重新检测' };
  const elements = { '[data-action="retry"]': link, '[data-label]': label, '[role="status"]': status };
  const root = { querySelector: selector => elements[selector] };
  runInNewContext(script, { document: { getElementById: () => root }, window: { openai: { sendFollowUpMessage } } });
  return { link, status, attributes, click: handlers.click ? link.click : undefined, keydown: handlers.keydown };
}

test('retry does nothing on load and one click submits one fresh check to the host', async () => {
  const calls = [];
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const ui = mount(request => { calls.push(request); return pending; });
  assert.equal(calls.length, 0);
  const first = ui.click();
  await ui.click();
  assert.equal(calls.length, 1); // Double-click while sending cannot queue two checks.
  assert.equal(ui.attributes['aria-disabled'], 'true');
  assert.match(calls[0].prompt, /\$gpt-model-check/);
  assert.match(calls[0].prompt, /本任务当前选中的模型/);
  assert.match(calls[0].prompt, /不要回放旧记录/);
  resolve(); await first;
  assert.equal(ui.attributes['aria-disabled'], undefined);
  assert.equal(ui.status.textContent, ''); // Host acceptance is not a model-check result.
});

test('a failed host send stays retryable without claiming a check ran', async () => {
  const ui = mount(async () => { throw new Error('host unavailable'); });
  await ui.click();
  assert.equal(ui.attributes['aria-disabled'], undefined);
  assert.match(ui.status.textContent, /未能发送/);
  assert.doesNotMatch(ui.status.textContent, /开始检测|检测完成/);
});

test('unsupported clients show an honest alternative instead of a fake action', () => {
  const ui = mount(undefined);
  assert.equal(ui.link.hidden, true);
  assert.equal(ui.click, undefined);
  assert.match(ui.status.textContent, /发送「重新检测」/);
});

test('retry text link also supports Space activation without navigation', async () => {
  let calls = 0;
  const ui = mount(async () => { calls++; });
  let prevented = false;
  ui.keydown({ key: ' ', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(calls, 1);
  await Promise.resolve();
});

test('action links are published to the viewing task directory, not the skill or old source', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'gpt retry '));
  const id = '01a0b29a-0000-7000-8000-000000000001';
  try {
    const saved = { tool: 'gpt-model-check', schemaVersion: 1, status: 'inconclusive',
      source: { id: '01a09b7c-0000-7000-8000-000000000001', originator: 'Codex Desktop' },
      retryArtifact: '/old-unreadable-skill/retry.html', validSamples: 2,
    };
    const env = { CODEX_HOME: home, CODEX_THREAD_ID: id };
    const current = await prepareRetry(saved, env);
    const expected = path.join(home, 'visualizations', '2026', '09', '18', id, 'gpt-model-check-retry.html');
    assert.equal(current.retryArtifact, expected);
    assert.equal(await readFile(expected, 'utf8'), html);
    assert.equal(saved.retryArtifact, '/old-unreadable-skill/retry.html');
    const reference = JSON.parse(presentationFor(current).retryMarkdown.match(/visualize(.*?)/)[1]);
    assert.equal(reference.path, expected.replaceAll('\\', '/'));
    // Offline replay uses the same publication path without connecting Codex.
    const receipt = path.join(home, 'old.json');
    const original = JSON.stringify(saved);
    await writeFile(receipt, original);
    const replay = await execute(parseArgs(['render', '--receipt', receipt]), { env });
    assert.equal(path.dirname(replay.retryArtifact), path.dirname(expected));
    assert.match(path.basename(replay.retryArtifact), /^gpt-model-check-retry-[a-f0-9]{12}\.html$/);
    assert.equal(replay.retryIncludesReceipt, false);
    const fragment = await readFile(replay.retryArtifact, 'utf8');
    assert.equal(fragment, html);
    assert.equal(presentationFor(replay).receiptInActions, false);
    assert.match(resultMarkdown(replay), /\[查看检测记录\]/);
    assert.equal(await readFile(receipt, 'utf8'), original);
    assert.equal((await prepareRetry(saved, { CODEX_HOME: home })).retryArtifact, null);
    for (const status of ['match', 'mismatch', 'unsupported', 'error'])
      assert.equal((await prepareRetry({ ...saved, status }, env)).retryArtifact, null);
    // Permission or filesystem failures remain a display fallback, not a recheck.
    const blocked = await prepareRetry(saved, { ...env, CODEX_HOME: receipt });
    assert.equal(blocked.retryArtifact, null);
    assert.match(presentationFor(blocked).retryMarkdown, /发送「重新检测」/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('viewer directory rejects unknown identifiers instead of guessing a path', () => {
  for (const id of [undefined, '', '../other-thread', 'not-a-uuid', 'abc-def'])
    assert.equal(retryDirectory('/home/test', id), null);
});

test('all outcomes keep one native receipt file link and never inline the record', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'gpt native receipt '));
  const env = { CODEX_HOME: home, CODEX_THREAD_ID: '01a0b29a-0000-7000-8000-000000000001' };
  try {
    for (const status of ['match', 'mismatch', 'inconclusive', 'unsupported', 'error']) {
      const saved = { tool: 'gpt-model-check', schemaVersion: 1, status,
        source: { model: 'gpt-6-astra', originator: 'Codex Desktop' },
        retryArtifact: '/old-inline-record.html', retryIncludesReceipt: true };
      const receipt = path.join(home, `${status}.json`);
      const raw = JSON.stringify(saved);
      await writeFile(receipt, raw);
      const prepared = await prepareRetry({ ...saved, receipt }, env);
      assert.equal(presentationFor(prepared).receiptInActions, false);
      const markdown = resultMarkdown(prepared);
      assert.equal(markdown.split('[查看检测记录]').length - 1, 1);
      assert.ok(markdown.includes(`[查看检测记录](<${receipt.replaceAll('\\', '/')}>)`));
      if (status === 'inconclusive') {
        assert.match(markdown, /visualize/);
        assert.equal(await readFile(prepared.retryArtifact, 'utf8'), html);
      } else {
        assert.equal(prepared.retryArtifact, null);
        assert.doesNotMatch(markdown, /visualize/);
      }
      assert.equal(await readFile(receipt, 'utf8'), raw);
    }
    assert.doesNotMatch(html, /data-receipt|data-action="record"|<pre|<code/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
