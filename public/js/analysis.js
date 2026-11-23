// analysis.js — looks back at transactions: money in vs out, where it went, who it went to.

import { kindOf, merchantKey } from './categorize.js';

/** The newest transaction date, so "last 30 days" means the last 30 days of your data. */
export function latestDate(transactions) {
  return transactions.reduce((max, t) => (t.date > max ? t.date : max), '0000-00-00');
}

export function since(transactions, days) {
  if (!days || !transactions.length) return transactions;
  const end = new Date(`${latestDate(transactions)}T00:00:00`);
  end.setDate(end.getDate() - days);
  const cut = end.toISOString().slice(0, 10);
  return transactions.filter((t) => t.date > cut);
}

/** [{ ym, in, out }] oldest first. Card payments are skipped so nothing is counted twice. */
export function monthlyFlow(transactions) {
  const by = {};
  for (const t of transactions) {
    const kind = kindOf(t.category);
    if (kind === 'transfer') continue;
    const ym = t.date.slice(0, 7);
    by[ym] ||= { ym, in: 0, out: 0 };
    if (kind === 'in') by[ym].in += t.amount;
    else by[ym].out -= t.amount; // refunds (positive) shrink money out
  }
  return Object.values(by).sort((a, b) => a.ym.localeCompare(b.ym));
}

/** [{ category, total, count }] biggest first, money out only. */
export function byCategory(transactions) {
  const by = {};
  for (const t of transactions) {
    if (kindOf(t.category) !== 'out') continue;
    by[t.category] ||= { category: t.category, total: 0, count: 0 };
    by[t.category].total -= t.amount;
    if (t.amount < 0) by[t.category].count++;
  }
  return Object.values(by).filter((c) => c.total > 0.005).sort((a, b) => b.total - a.total);
}

/** [{ name, total, count, category }] biggest first. `name` is a readable sample description. */
export function topMerchants(transactions, limit = 12) {
  const by = {};
  for (const t of transactions) {
    if (kindOf(t.category) !== 'out' || t.amount >= 0) continue;
    const k = merchantKey(t.description) || t.description;
    by[k] ||= { name: t.description, total: 0, count: 0, category: t.category };
    by[k].total -= t.amount;
    by[k].count++;
  }
  return Object.values(by).sort((a, b) => b.total - a.total).slice(0, limit);
}

/** Purchases on a debt's own account (matched by name) — spending on a card that charges interest. */
export function chargesOn(transactions, debtName) {
  const n = debtName.toLowerCase();
  return transactions.filter((t) => t.amount < 0 && kindOf(t.category) === 'out' &&
    (t.account.toLowerCase().includes(n) || n.includes(t.account.toLowerCase())));
}
