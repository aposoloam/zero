// settings.js — everything about how zero looks and behaves. Saved as data/settings.json
// (or in the browser in demo mode). Every key is optional: anything you leave out falls
// back to DEFAULTS, and anything invalid is ignored with a warning instead of breaking.

export const THEMES = {
  graph: { label: 'graph paper', bg: '#eceee9', surface: '#e1e4de', fg: '#1c2433', muted: '#5f656e', rule: '#c9cdc6', accent: '#1c2433', danger: '#b8362a', good: '#2f6b4f', grid: true },
  ink: { label: 'ink (dark)', bg: '#14161b', surface: '#1d2027', fg: '#e3e6eb', muted: '#959ba5', rule: '#2e333c', accent: '#e3e6eb', danger: '#ef6b5c', good: '#6fbf98', grid: true },
  phosphor: { label: 'phosphor', bg: '#0f0f0e', surface: '#1a1916', fg: '#f0b35c', muted: '#a37a3f', rule: '#3a3022', accent: '#f0b35c', danger: '#ff6b4f', good: '#a6d470', grid: false },
  plain: { label: 'plain', bg: '#f6f6f4', surface: '#ebebe8', fg: '#16171a', muted: '#62646a', rule: '#d4d5d1', accent: '#2251c4', danger: '#bf3326', good: '#23744c', grid: false },
};
export const COLOR_KEYS = ['bg', 'surface', 'fg', 'muted', 'rule', 'accent', 'danger', 'good'];

export const PANES = {
  payoff: 'payoff',
  debts: 'debts',
  plan: 'plan',
  notes: 'notes',
  flow: 'money in / out',
  transactions: 'transactions',
};

export const FONTS = {
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  sans: "'Hanken Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif",
};

export const DEFAULTS = {
  theme: 'system',                 // 'system' (graph by day, ink by night) or a THEMES key
  colors: {},                      // overrides, e.g. { "accent": "#ff5500" }
  font: 'mono',                    // 'mono', 'sans', or any font installed on your machine
  fontSize: 14,                    // px, 11–20
  density: 'comfortable',          // 'comfortable' | 'compact'
  columns: 2,                      // 1 or 2
  panes: ['payoff', 'debts', 'plan', 'notes', 'flow', 'transactions'],  // order; leave one out to hide it
  wide: ['payoff', 'debts', 'flow', 'transactions'],                    // panes that span both columns
  dates: 'iso',                    // 'iso' (2027-03) | 'words' (march 2027)
  locale: 'en-US',
  currency: 'USD',
  chart: { animate: true, minimums: true, promos: true },
  model: 'claude-sonnet-5-5',
  keys: {
    palette: 'mod+k', settings: ',', import: 'i', ask: 'a', student: 's', search: '/', help: '?',
  },
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Merges saved settings over the defaults, keeping only valid values. Returns { settings, warnings }. */
export function resolve(saved = {}) {
  const s = structuredClone(DEFAULTS);
  const warnings = [];
  const warn = (k) => warnings.push(`ignored “${k}”: not a valid value`);
  if (!saved || typeof saved !== 'object') return { settings: s, warnings };
  for (const k of Object.keys(saved)) if (!(k in DEFAULTS)) warnings.push(`ignored “${k}”: not a setting`);

  if (saved.theme !== undefined) (saved.theme === 'system' || THEMES[saved.theme]) ? (s.theme = saved.theme) : warn('theme');
  if (saved.colors && typeof saved.colors === 'object') {
    for (const [k, v] of Object.entries(saved.colors)) (COLOR_KEYS.includes(k) && HEX.test(v)) ? (s.colors[k] = v) : warn(`colors.${k}`);
  }
  if (typeof saved.font === 'string' && saved.font.trim() && saved.font.length < 80 && !/[;{}<>'"\\]/.test(saved.font)) s.font = saved.font.trim();
  else if (saved.font !== undefined) warn('font');
  if (saved.fontSize !== undefined) (Number(saved.fontSize) >= 11 && Number(saved.fontSize) <= 20) ? (s.fontSize = Number(saved.fontSize)) : warn('fontSize');
  if (saved.density !== undefined) ['comfortable', 'compact'].includes(saved.density) ? (s.density = saved.density) : warn('density');
  if (saved.columns !== undefined) [1, 2].includes(Number(saved.columns)) ? (s.columns = Number(saved.columns)) : warn('columns');
  if (Array.isArray(saved.panes)) {
    const ok = saved.panes.filter((p) => PANES[p]);
    if (ok.length !== saved.panes.length) warn('panes (unknown names)');
    s.panes = [...new Set(ok)];
  }
  if (Array.isArray(saved.wide)) s.wide = saved.wide.filter((p) => PANES[p]);
  if (saved.dates !== undefined) ['iso', 'words'].includes(saved.dates) ? (s.dates = saved.dates) : warn('dates');
  if (typeof saved.locale === 'string') { try { new Intl.NumberFormat(saved.locale); s.locale = saved.locale; } catch { warn('locale'); } }
  if (typeof saved.currency === 'string') { try { new Intl.NumberFormat('en-US', { style: 'currency', currency: saved.currency }); s.currency = saved.currency.toUpperCase(); } catch { warn('currency'); } }
  if (saved.chart && typeof saved.chart === 'object') for (const k of Object.keys(s.chart)) if (typeof saved.chart[k] === 'boolean') s.chart[k] = saved.chart[k];
  if (typeof saved.model === 'string' && /^[a-z0-9.\-]{3,64}$/.test(saved.model)) s.model = saved.model;
  else if (saved.model !== undefined) warn('model');
  if (saved.keys && typeof saved.keys === 'object') {
    for (const [k, v] of Object.entries(saved.keys)) (k in s.keys && typeof v === 'string' && v.length <= 20) ? (s.keys[k] = v.toLowerCase()) : warn(`keys.${k}`);
  }
  return { settings: s, warnings };
}

/** Only the keys that differ from the defaults — what gets written to settings.json. */
export function diff(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings)) {
    if (JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])) out[k] = v;
  }
  return out;
}

/** The theme in effect right now (resolving 'system' against the OS preference). */
export function activeTheme(settings) {
  const name = settings.theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'graph')
    : settings.theme;
  return { name, ...THEMES[name], ...settings.colors };
}

/** Writes the settings onto the page as CSS custom properties and data attributes. */
export function apply(settings, root = document.documentElement) {
  const t = activeTheme(settings);
  for (const k of COLOR_KEYS) root.style.setProperty(`--${k}`, t[k]);
  root.style.setProperty('--font', FONTS[settings.font] || `'${settings.font}', ${FONTS.mono}`);
  root.style.setProperty('--size', `${settings.fontSize}px`);
  root.style.setProperty('--cols', settings.columns);
  root.dataset.density = settings.density;
  root.dataset.grid = t.grid ? 'on' : 'off';
  root.dataset.font = FONTS[settings.font] ? settings.font : 'custom';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.bg);
}
