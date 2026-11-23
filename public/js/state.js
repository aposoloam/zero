// state.js — the shape of your money data, and the pure functions that change it.
// Where it's stored is api.js's job: data/state.json with the local server, or this
// browser's localStorage in demo mode.

import { categorize, merchantKey } from './categorize.js';
import { txId } from './importers.js';
import { DEMO } from './demo.js';

export const VERSION = 1;

/*
  {
    version: 1,
    sample: true,            // true while the demo numbers are showing
    settings: {              // money settings (look-and-feel lives in settings.json)
      takeHome: 1768,        // monthly take-home pay
      netHourly: 17.20,      // take-home per hour, for the extra-shifts slider
      fixed: 152,            // bills that don't move: giving, loans, rent…
      living: 880,           // everyday spending, normal month
      studentLiving: 555,    // everyday spending, bare-bones month
      studentMode: false,
      extraHours: 0,         // extra hours per week
      extraMonthly: 0,       // any other extra per month
      strategy: 'avalanche',
      order: [],             // debt ids, for the custom strategy
      lump: { amount: 0, month: '' },
    },
    debts: [ { id, name, balance, apr, promoApr, promoEnd, min, payInFull } ],
    transactions: [ { id, date, account, description, amount, category } ],
    learned: { merchantKey: category },   // your category corrections
  }
*/

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Saved data → a complete state. Nothing saved yet → the sample. */
export function fromSaved(saved) {
  return saved && typeof saved === 'object' ? migrate(saved) : clone(DEMO);
}

export function sample() { return clone(DEMO); }

/** A blank slate for a new user: no debts, no transactions, no income filled in yet. */
export function empty() {
  const s = clone(DEMO);
  Object.assign(s.settings, { takeHome: 0, netHourly: 0, fixed: 0, living: 0, studentLiving: 0, studentMode: false });
  return { ...s, sample: false, debts: [], transactions: [], learned: {} };
}

/** Fills in anything an older or hand-edited backup is missing. */
export function migrate(s) {
  const base = clone(DEMO);
  return {
    version: VERSION,
    sample: Boolean(s.sample),
    settings: { ...base.settings, ...(s.settings || {}), lump: { ...base.settings.lump, ...(s.settings?.lump || {}) } },
    debts: Array.isArray(s.debts) ? s.debts : [],
    transactions: Array.isArray(s.transactions) ? s.transactions : [],
    learned: s.learned && typeof s.learned === 'object' ? s.learned : {},
  };
}

/** Validates a backup file before it replaces anything. Throws with a readable message. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('that file isn’t valid JSON'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.debts) || !Array.isArray(data.transactions)) {
    throw new Error('that file doesn’t look like a zero backup');
  }
  return migrate({ ...data, sample: false });
}

/** Money per month that goes to debt under the current settings. */
export function monthlyBudget(settings) {
  const living = settings.studentMode ? settings.studentLiving : settings.living;
  const shifts = (Number(settings.extraHours) || 0) * (Number(settings.netHourly) || 0) * 52 / 12;
  const b = (Number(settings.takeHome) || 0) - (Number(settings.fixed) || 0) - (Number(living) || 0)
    + shifts + (Number(settings.extraMonthly) || 0);
  return Math.max(0, Math.round(b));
}

/**
 * Adds imported rows, skipping ones already present. Identical rows inside one file
 * (two $0.32 work meals on the same day) are kept apart by their position.
 * @returns {{ added, skipped }}
 */
export function addTransactions(state, rows, account) {
  const existing = new Set(state.transactions.map((t) => t.id));
  const seen = {};
  let added = 0, skipped = 0;
  for (const r of rows) {
    const base = txId({ ...r, account });
    seen[base] = (seen[base] || 0) + 1;
    const id = seen[base] > 1 ? `${base}-${seen[base]}` : base;
    if (existing.has(id)) { skipped++; continue; }
    state.transactions.push({
      id, account, date: r.date, description: r.description, amount: Number(r.amount),
      category: r.category || categorize(r.description, r.amount, state.learned),
    });
    existing.add(id);
    added++;
  }
  state.transactions.sort((a, b) => b.date.localeCompare(a.date));
  if (added) state.sample = false;
  return { added, skipped };
}

/** Sets a category and remembers it for every transaction from the same merchant. */
export function recategorize(state, id, category) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return 0;
  const key = merchantKey(t.description);
  state.learned[key] = category;
  let changed = 0;
  for (const x of state.transactions) {
    if (merchantKey(x.description) === key && x.category !== category) { x.category = category; changed++; }
  }
  return changed;
}

export function newDebtId(state) {
  let i = state.debts.length + 1;
  while (state.debts.some((d) => d.id === `d${i}`)) i++;
  return `d${i}`;
}
