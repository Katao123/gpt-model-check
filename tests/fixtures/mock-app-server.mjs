// Test-only protocol double. Never used by the actual detector or installer.
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
lines.on('line', line => {
  const m = JSON.parse(line);
  if (!m.method) return;
  if (m.method === 'initialize') send({ id: m.id, result: { userAgent: 'test-only' } });
  else if (m.method === 'test/error') send({ id: m.id, error: { code: -32000, message: 'secret-token https://example.invalid/?key=private' } });
  else if (m.method === 'test/tool') { send({ id: m.id, result: {} }); send({ id: 'permission-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'test-fork' } }); }
  else if (m.method === 'test/timeout') { /* Intentionally no response. */ }
  else if (m.id) send({ id: m.id, result: { ok: true } });
});
