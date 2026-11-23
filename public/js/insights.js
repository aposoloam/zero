// insights.js — plain-language notes worked out on this device, no AI needed.
// Each note is { tone: 'warn' | 'good' | 'info', text }. Keep them short and specific:
// a number, what it means, what to do.

import { simulate, minimumsOnly, rateFor, nextMonth } from './payoff.js';
import { since, byCategory, topMerchants, chargesOn } from './analysis.js';
import { monthlyBudget } from './state.js';
import { money, monthName, plural, monthsBetween } from './format.js';

const CUTTABLE = ['fast food & dining', 'gaming', 'subscriptions', 'shopping', 'personal care & style'];

/** Smallest monthly budget that clears `debt` before its promo ends, by binary search. */
function budgetToBeatPromo(debts, plan, debt) {
  const promoYm = debt.promoEnd.slice(0, 7);
  const clears = (budget) => {
    const r = simulate(debts, { ...plan, budget });
    const before = r.months.filter((m) => m.ym < promoYm).pop();
    return before && before.balances[debt.id] <= 0.005;
  };
  let lo = plan.budget, hi = plan.budget + 20000;
  if (!clears(hi)) return null;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (clears(mid)) hi = mid; else lo = mid; }
  return Math.ceil(hi);
}

export function localInsights(state) {
  const { settings, debts, transactions } = state;
  const notes = [];
  const open = debts.filter((d) => Number(d.balance) > 0);
  if (!open.length) return [{ tone: 'good', text: 'no debts entered. add one in the ledger to see a plan.' }];

  const start = nextMonth();
  const plan = { budget: monthlyBudget(settings), strategy: settings.strategy, order: settings.order, lump: settings.lump, start };
  const result = simulate(open, plan);

  if (result.shortfall) {
    const mins = open.reduce((s, d) => s + Number(d.min || 0), 0);
    notes.push({ tone: 'warn', text: `this budget (${money(plan.budget)}/mo) doesn’t cover the minimums (${money(mins)}/mo). missed minimums mean late fees and penalty rates — find the gap first.` });
  }
  if (result.stalled) {
    notes.push({ tone: 'warn', text: 'at this budget the interest grows faster than the payments, so this never reaches $0.' });
  }

  // interest leaking right now
  const nowInterest = open.reduce((s, d) => s + Number(d.balance) * rateFor(d, start) / 1200, 0);
  if (nowInterest > 1) {
    const worst = [...open].sort((a, b) => rateFor(b, start) - rateFor(a, start))[0];
    notes.push({ tone: 'warn', text: `about ${money(nowInterest)} a month is going to interest right now, mostly on ${worst.name} (${rateFor(worst, start)}%). that’s the first debt to kill.` });
  }

  // promo deadlines
  for (const d of open.filter((x) => x.promoEnd && x.promoEnd.slice(0, 7) > start.slice(0, 7))) {
    const promoYm = d.promoEnd.slice(0, 7);
    const before = result.months.filter((m) => m.ym < promoYm).pop();
    const left = before ? before.balances[d.id] : Number(d.balance);
    if (left > 0.005) {
      const need = budgetToBeatPromo(open, plan, d);
      notes.push({ tone: 'warn', text: `${d.name} will still owe ${money(left)} when its ${d.promoApr || 0}% rate ends (${monthName(promoYm)}), then it jumps to ${d.apr}%.` +
        (need ? ` putting ${money(need)}/mo toward debt (${money(need - plan.budget)} more) clears it in time.` : '') });
    } else {
      notes.push({ tone: 'good', text: `${d.name} is paid off before its ${d.promoApr || 0}% rate ends in ${monthName(promoYm)} — it never charges you interest.` });
    }
  }

  // charging on a card that carries interest
  const recent = since(transactions, 30);
  for (const d of open.filter((x) => rateFor(x, start) > 0 && !x.payInFull)) {
    const spent = chargesOn(recent, d.name).reduce((s, t) => s - t.amount, 0);
    if (spent > 20) {
      notes.push({ tone: 'warn', text: `${money(spent)} went on ${d.name} in the last 30 days while it carries a ${rateFor(d, start)}% balance. new charges there start costing interest right away — move them to a card you pay in full or debit.` });
    }
  }

  // compared with minimums only
  const base = minimumsOnly(open, start);
  if (result.debtFree && base.stalled) {
    const mins = open.reduce((s, d) => s + Number(d.min || 0), 0);
    notes.push({ tone: 'good', text: `paying only the minimums (${money(mins)}/mo) would never clear this — once the promo rates end, interest outruns them. this plan gets there.` });
  }
  if (result.debtFree) {
    const saved = (base.totalInterest || 0) - result.totalInterest;
    const months = base.debtFree ? monthsBetween(result.debtFree, base.debtFree) : null;
    if (saved > 1 && !base.stalled) {
      notes.push({ tone: 'good', text: `versus paying minimums only, this plan saves ${money(saved)} in interest` + (months ? ` and finishes ${plural(months, 'month')} sooner.` : '.') });
    }
    const faster = simulate(open, { ...plan, budget: plan.budget + 100 });
    const gain = monthsBetween(faster.debtFree, result.debtFree);
    if (gain > 0) notes.push({ tone: 'info', text: `every extra $100 a month moves debt-free from ${monthName(result.debtFree)} to ${monthName(faster.debtFree)}.` });
  }

  // student mode
  if (!settings.studentMode && settings.living > settings.studentLiving) {
    const sm = simulate(open, { ...plan, budget: monthlyBudget({ ...settings, studentMode: true }) });
    if (sm.debtFree) notes.push({ tone: 'info', text: `student mode frees up ${money(settings.living - settings.studentLiving)} a month and gets you to $0 by ${monthName(sm.debtFree)}.` });
  }

  // biggest cuttable spending in the last 30 days
  const cats = byCategory(recent).filter((c) => CUTTABLE.includes(c.category));
  if (cats[0]) {
    const c = cats[0];
    notes.push({ tone: 'info', text: `${c.category}: ${money(c.total)} across ${plural(c.count, 'purchase')} in the last 30 days. it’s the easiest place to find money.` });
  }

  const subs = topMerchants(since(transactions, 45), 50).filter((m) => m.category === 'subscriptions');
  if (subs.length >= 3) {
    const total = subs.reduce((s, m) => s + m.total / Math.max(1, m.count), 0);
    notes.push({ tone: 'info', text: `${plural(subs.length, 'subscription')} cost about ${money(total)} a month. keep the ones that earn you money; pause the rest until you’re at $0.` });
  }

  return notes;
}

/**
 * The summary sent to Claude. Totals and merchant names only — no account numbers,
 * no full transaction list.
 */
export function summaryForClaude(state) {
  const { settings, debts, transactions } = state;
  const start = nextMonth();
  const open = debts.filter((d) => Number(d.balance) > 0);
  const plan = { budget: monthlyBudget(settings), strategy: settings.strategy, order: settings.order, lump: settings.lump, start };
  const result = simulate(open, plan);
  const recent = since(transactions, 30);
  return {
    today: new Date().toISOString().slice(0, 10),
    income: { takeHomeMonthly: settings.takeHome, takeHomePerHour: settings.netHourly, fixedBillsMonthly: settings.fixed },
    spending: { everydayMonthly: settings.living, studentModeMonthly: settings.studentLiving, studentModeOn: settings.studentMode },
    plan: { strategy: settings.strategy, monthlyToDebt: plan.budget, extraHoursPerWeek: settings.extraHours, debtFree: result.debtFree, totalInterest: result.totalInterest, stalled: result.stalled, shortfall: result.shortfall },
    debts: open.map((d) => ({ name: d.name, balance: Number(d.balance), apr: Number(d.apr), promoApr: d.promoApr === '' ? null : d.promoApr, promoEnd: d.promoEnd || null, minimum: Number(d.min), paidInFullMonthly: Boolean(d.payInFull), projectedPayoff: result.paidOff[d.id] || null })),
    last30Days: {
      byCategory: byCategory(recent).map((c) => ({ category: c.category, total: Math.round(c.total), purchases: c.count })),
      topMerchants: topMerchants(recent, 15).map((m) => ({ merchant: m.name.slice(0, 40), total: Math.round(m.total), visits: m.count, category: m.category })),
    },
  };
}
