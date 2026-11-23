// Runs the real server on a spare port with a temp data folder and a fake Anthropic API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4399;
const dir = await mkdtemp(join(tmpdir(), 'zero-test-'));
let lastClaude = null;

// fake anthropic: accepts keys ending in "good", records the last messages call
const fake = http.createServer(async (req, res) => {
  const key = req.headers['x-api-key'] || '';
  if (!key.endsWith('good')) { res.writeHead(401).end('{}'); return; }
  if (req.url.startsWith('/v1/models')) { res.writeHead(200).end('{"data":[]}'); return; }
  let body = '';
  for await (const c of req) body += c;
  lastClaude = JSON.parse(body);
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'tool_use', input: { ok: true } }] }));
});

let server;
before(async () => {
  await new Promise((r) => fake.listen(4398, '127.0.0.1', r));
  process.env.ZERO_PORT = String(PORT);
  process.env.ZERO_DATA_DIR = dir;
  process.env.ZERO_ANTHROPIC_URL = 'http://127.0.0.1:4398';
  delete process.env.ANTHROPIC_API_KEY;
  const { createServer } = await import('../server.js');
  server = createServer();
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
});
after(() => { server.close(); fake.close(); });

const base = `http://127.0.0.1:${PORT}`;
const api = (path, init = {}) => fetch(base + path, { ...init, headers: { 'x-zero': '1', 'content-type': 'application/json', ...(init.headers || {}) } });

test('serves the app with security headers', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('blocks path traversal', async () => {
  const r = await fetch(`${base}/..%2fserver.js`);
  assert.ok([403, 404].includes(r.status));
  assert.ok(!(await r.text()).includes('createServer'));
});

test('api needs the x-zero header and a matching origin', async () => {
  assert.equal((await fetch(`${base}/api/health`)).status, 403);
  assert.equal((await api('/api/health', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await api('/api/health', { headers: { origin: `http://localhost:${PORT}` } })).status, 200);
});

test('rejects a foreign Host header (dns rebinding)', async () => {
  const status = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', headers: { host: `evil.example:${PORT}`, 'x-zero': '1' } }, (r) => resolve(r.statusCode));
  });
  assert.equal(status, 403);
});

test('state round-trips through an owner-only file', async () => {
  const state = { version: 1, debts: [{ id: 'a', balance: 10 }], transactions: [] };
  assert.equal((await api('/api/data/state', { method: 'PUT', body: JSON.stringify(state) })).status, 200);
  const got = await (await api('/api/data/state')).json();
  assert.deepEqual(got.value, state);
  assert.equal((await stat(join(dir, 'state.json'))).mode & 0o777, 0o600);
});

test('bad keys are refused, good keys are saved and never returned', async () => {
  assert.equal((await api('/api/key', { method: 'POST', body: JSON.stringify({ key: 'hello' }) })).status, 400);
  assert.equal((await api('/api/key', { method: 'POST', body: JSON.stringify({ key: 'sk-ant-aaaaaaaaaaaaaaaaaaaaaaaabad' }) })).status, 400);
  const ok = await api('/api/key', { method: 'POST', body: JSON.stringify({ key: 'sk-ant-aaaaaaaaaaaaaaaaaaaaaaaagood' }) });
  assert.equal(ok.status, 200);
  const health = await (await api('/api/health')).json();
  assert.equal(health.key.set, true);
  assert.equal(health.key.hint, '…good');
  assert.ok(!JSON.stringify(health).includes('sk-ant'));
  assert.equal((await stat(join(dir, 'secrets.json'))).mode & 0o777, 0o600);
});

test('claude jobs use server-side prompts and the saved key', async () => {
  const r = await api('/api/claude', { method: 'POST', body: JSON.stringify({ task: 'insights', payload: { plan: {} } }) });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).result, { ok: true });
  assert.equal(lastClaude.tool_choice.name, 'notes');
  assert.equal((await api('/api/claude', { method: 'POST', body: JSON.stringify({ task: 'chat', payload: 'hi' }) })).status, 400);
});

test('the model comes from settings.json', async () => {
  await api('/api/data/settings', { method: 'PUT', body: JSON.stringify({ model: 'claude-haiku-5-5' }) });
  await api('/api/claude', { method: 'POST', body: JSON.stringify({ task: 'insights', payload: { a: 1 } }) });
  assert.equal(lastClaude.model, 'claude-haiku-5-5');
});

test('removing the key deletes the secrets file', async () => {
  await api('/api/key', { method: 'DELETE' });
  await assert.rejects(readFile(join(dir, 'secrets.json')));
  const r = await api('/api/claude', { method: 'POST', body: JSON.stringify({ task: 'insights', payload: { a: 1 } }) });
  assert.equal(r.status, 409);
});
