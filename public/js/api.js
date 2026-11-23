// api.js — talks to the local server (server.js). If there's no server — the app was
// opened as static files, e.g. a hosted demo — zero runs in demo mode: data stays in
// this browser's localStorage and Claude is off. API keys are never kept in the browser.

let info = null; // the server's /api/health answer, or null in demo mode

const HEADERS = { 'content-type': 'application/json', 'x-zero': '1' };

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`api/${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('can’t reach the zero server. is `npm start` still running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `the server answered ${res.status}`);
  return data;
}

/** Finds out whether the local server is there. Call once at startup. */
export async function connect() {
  try {
    const res = await fetch('api/health', { headers: HEADERS });
    info = res.ok ? await res.json() : null;
  } catch { info = null; }
  return info;
}

export const isLocal = () => Boolean(info);
export const serverInfo = () => info;
export async function refresh() { return connect(); }

/* ---------- data files: state.json and settings.json ---------- */

const LS = { state: 'zero.state.v1', settings: 'zero.settings.v1' };

export async function readFile(name) {
  if (info) return (await call('GET', `data/${name}`)).value;
  try { const raw = localStorage.getItem(LS[name]); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function writeFile(name, value) {
  if (info) return call('PUT', `data/${name}`, value);
  try { localStorage.setItem(LS[name], JSON.stringify(value)); return { ok: true }; } catch { throw new Error('this browser won’t let zero save'); }
}

export async function eraseLocal() {
  try { Object.values(LS).forEach((k) => localStorage.removeItem(k)); } catch { /* nothing stored */ }
}

/* ---------- api key ---------- */

export async function saveKey(key) {
  if (!info) throw new Error('keys can only be saved through the local server');
  const r = await call('POST', 'key', { key });
  await connect();
  return r;
}

export async function removeKey() {
  await call('DELETE', 'key');
  await connect();
}

/* ---------- claude ---------- */

export async function claude(task, payload) {
  if (!info) throw new Error('claude needs the local server. run `npm start` and open http://localhost:4321.');
  if (!info.key.set) throw new Error('add your anthropic api key in settings first.');
  return (await call('POST', 'claude', { task, payload })).result;
}
