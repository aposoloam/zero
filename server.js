#!/usr/bin/env node
// server.js — zero's local server. No dependencies: just Node 20+.
//
//   node server.js            → http://localhost:4321
//
// What it does:
//   • serves the app from ./public
//   • keeps your data as plain JSON files in ./data (state.json, settings.json)
//   • keeps your Anthropic API key in ./data/secrets.json (owner-only permissions),
//     and never sends it back to the browser
//   • calls Claude for the two jobs in lib/claude.js
//
// It only listens on 127.0.0.1, and every /api request must come from this app's own
// page (Host, Origin and a custom header are checked), so other websites you visit
// can't read your data or spend your key.
//
// Environment (all optional):
//   ZERO_PORT          default 4321
//   ZERO_DATA_DIR      default ./data
//   ANTHROPIC_API_KEY  use this key instead of the one saved from the app
//   ZERO_MODEL         override the model chosen in settings

import http from 'node:http';
import { readFile, writeFile, rename, mkdir, unlink, chmod, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runJob, verifyKey, checkPayload, DEFAULT_MODEL } from './lib/claude.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.ZERO_DATA_DIR || join(ROOT, 'data');
const PORT = Number(process.env.ZERO_PORT) || 4321;
const HOST = '127.0.0.1';
const VERSION = '2.0.0';

const DATA_FILES = { state: 'state.json', settings: 'settings.json' };
const SECRETS = 'secrets.json';
const MAX_JSON = 2 * 1024 * 1024;      // state / settings
const MAX_UPLOAD = 12 * 1024 * 1024;   // a ~9 MB statement once base64'd

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

/* ---------- small helpers ---------- */

function send(res, status, body, type = 'application/json') {
  const isJson = type === 'application/json';
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store' });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJSON(name) {
  try { return JSON.parse(await readFile(join(DATA, name), 'utf8')); } catch { return null; }
}

/** Write-then-rename, so a crash mid-write never leaves a half-written file. */
async function writeJSON(name, value, mode = 0o600) {
  await mkdir(DATA, { recursive: true, mode: 0o700 });
  const file = join(DATA, name);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode });
  await rename(tmp, file);
  await chmod(file, mode);
}

async function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: 'env' };
  const s = await readJSON(SECRETS);
  return s?.anthropicKey ? { key: s.anthropicKey, source: 'file', status: s.status } : { key: null };
}

const hint = (key) => (key ? `…${key.slice(-4)}` : null);

/** How the data folder is shown in the app: "data" inside the repo, "~/…" elsewhere. */
function displayDir() {
  const rel = relative(ROOT, DATA);
  if (rel && !rel.startsWith('..')) return rel;
  const home = homedir();
  return DATA.startsWith(home) ? `~${DATA.slice(home.length)}` : DATA;
}

/* ---------- request guard ---------- */

const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

/**
 * Blocks DNS-rebinding (Host must be ours) and cross-site requests (Origin, if sent,
 * must be ours, and /api calls need the x-zero header, which browsers only allow
 * cross-origin after a CORS preflight this server never approves).
 */
function allowed(req, isApi) {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, ''))) return false;
  if (isApi && req.headers['x-zero'] !== '1') return false;
  return true;
}

/* ---------- api ---------- */

async function api(req, res, path) {
  const method = req.method;

  if (path === '/api/health' && method === 'GET') {
    const { key, source, status } = await apiKey();
    const settings = await readJSON(DATA_FILES.settings);
    return send(res, 200, {
      ok: true, version: VERSION, dataDir: displayDir(),
      key: { set: Boolean(key), hint: hint(key), source: source || null, status: status || null },
      model: process.env.ZERO_MODEL || settings?.model || DEFAULT_MODEL,
    });
  }

  const file = path.match(/^\/api\/data\/(state|settings)$/)?.[1];
  if (file && method === 'GET') return send(res, 200, { value: await readJSON(DATA_FILES[file]) });
  if (file && method === 'PUT') {
    let value;
    try { value = JSON.parse(await readBody(req, MAX_JSON)); } catch (e) { return send(res, e.status || 400, { error: e.status ? 'too large' : 'not valid JSON' }); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return send(res, 400, { error: 'expected a JSON object' });
    await writeJSON(DATA_FILES[file], value);
    return send(res, 200, { ok: true, savedAt: new Date().toISOString() });
  }

  if (path === '/api/key' && method === 'POST') {
    let key;
    try { key = String(JSON.parse(await readBody(req, 4096)).key || '').trim(); } catch { return send(res, 400, { error: 'not valid JSON' }); }
    if (!/^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(key)) return send(res, 400, { error: 'that doesn’t look like an anthropic api key (sk-ant-…)' });
    const status = await verifyKey(key);
    if (status === 'invalid') return send(res, 400, { error: 'anthropic rejected that key' });
    await writeJSON(SECRETS, { anthropicKey: key, status, savedAt: new Date().toISOString() });
    return send(res, 200, { ok: true, hint: hint(key), status });
  }
  if (path === '/api/key' && method === 'DELETE') {
    try { await unlink(join(DATA, SECRETS)); } catch { /* already gone */ }
    return send(res, 200, { ok: true });
  }

  if (path === '/api/claude' && method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req, MAX_UPLOAD)); } catch (e) { return send(res, e.status || 400, { error: e.status ? 'that file is too big (max ~9 MB)' : 'not valid JSON' }); }
    const problem = checkPayload(body?.task, body?.payload);
    if (problem) return send(res, 400, { error: problem });
    const { key } = await apiKey();
    if (!key) return send(res, 409, { error: 'add your anthropic api key in settings first' });
    const settings = await readJSON(DATA_FILES.settings);
    const out = await runJob(key, process.env.ZERO_MODEL || settings?.model, body.task, body.payload);
    return out.error ? send(res, out.status, { error: out.error }) : send(res, 200, { result: out.result });
  }

  return send(res, 404, { error: 'not found' });
}

/* ---------- static files ---------- */

async function serveStatic(req, res, path) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
  const rel = normalize(decodeURIComponent(path === '/' ? '/index.html' : path)).replace(/^([/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + '/') && file !== PUBLIC) return send(res, 403, { error: 'forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404, 'not found', 'text/plain; charset=utf-8');
  }
}

/* ---------- boot ---------- */

export function createServer() {
  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const isApi = path.startsWith('/api/');
    if (!allowed(req, isApi)) return send(res, 403, { error: 'forbidden' });
    try {
      return isApi ? await api(req, res, path) : await serveStatic(req, res, path);
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: 'something went wrong on the server' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(DATA, { recursive: true, mode: 0o700 });
  await chmod(DATA, 0o700); // tighten a folder that already existed, e.g. from git clone
  createServer().listen(PORT, HOST, () => {
    console.log(`\n  zero ${VERSION}\n  → http://localhost:${PORT}\n  data: ${DATA}\n`);
  });
}
