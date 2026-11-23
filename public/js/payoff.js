// payoff.js — month-by-month debt payoff simulation.
//
// Pure functions, no DOM. Every number the app shows about the future comes from here.
//
// A debt looks like:
//   { id, name, balance, apr, promoApr, promoEnd, min }
//   apr       standard yearly rate, as a percent (26.74)
//   promoApr  optional promo rate, as a percent (0)
//   promoEnd  optional 'YYYY-MM-DD'; the promo rate applies to months before the month it ends in
//             (conservative: a promo ending Apr 2 is treated as gone for all of April)
//   min       minimum monthly payment in dollars
//   payInFull optional true for a card you clear every statement (no interest as long as
//             you do). It always gets paid first, whatever the strategy.
//
// Each simulated month: interest is added, every minimum is paid, then whatever is
// left of the monthly budget goes to debts in strategy order. Money freed up by a
// paid-off debt rolls into the next one automatically, because the budget stays fixed.

export const STRATEGIES = {
  avalanche: 'highest rate first',
  snowball: 'smallest balance first',
  custom: 'your order',
};

const MAX_MONTHS = 360;
const round2 = (n) => Math.round(n * 100) / 100;

/** 'YYYY-MM' for the month after `date` (a Date). Simulations start next month. */
export function nextMonth(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 2; // getMonth is 0-based, +1 for next month
  return m > 12 ? `${y + 1}-01` : `${y}-${String(m).padStart(2, '0')}`;
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** The yearly rate (percent) that applies to a debt during month `ym`. */
export function rateFor(debt, ym) {
  if (debt.payInFull) return 0; // cleared every statement, so the rate never applies
  const hasPromo = debt.promoEnd && debt.promoApr !== undefined && debt.promoApr !== null && debt.promoApr !== '';
  if (hasPromo && ym < debt.promoEnd.slice(0, 7)) return Number(debt.promoApr);
  return Number(debt.apr) || 0;
}

/** Debts with a balance, in the order extra money should go to them this month. */
function priority(debts, balances, strategy, order, ym) {
  const open = debts.filter((d) => balances[d.id] > 0.005);
  const first = open.filter((d) => d.payInFull);
  const rest = open.filter((d) => !d.payInFull);
  return [...first, ...sortByStrategy(rest, balances, strategy, order, ym)];
}

function sortByStrategy(open, balances, strategy, order, ym) {
  if (strategy === 'snowball') {
    return open.sort((a, b) => balances[a.id] - balances[b.id]);
  }
  if (strategy === 'custom' && order?.length) {
    const pos = (d) => { const i = order.indexOf(d.id); return i === -1 ? 999 : i; };
    return open.sort((a, b) => pos(a) - pos(b));
  }
  // avalanche: highest rate right now; ties go to the promo that ends sooner, then the smaller balance
  return open.sort((a, b) =>
    rateFor(b, ym) - rateFor(a, ym) ||
    (a.promoEnd || '9999').localeCompare(b.promoEnd || '9999') ||
    balances[a.id] - balances[b.id]);
}

/**
 * Run the plan.
 * @param {Array} debts
 * @param {Object} plan  { budget, strategy, order, lump: { amount, month: 'YYYY-MM' }, start: 'YYYY-MM' }
 * @returns {{ months, debtFree, totalInterest, totalPaid, paidOff, shortfall, stalled }}
 */
export function simulate(debts, plan) {
  const start = plan.start || nextMonth();
  const balances = Object.fromEntries(debts.map((d) => [d.id, Math.max(0, Number(d.balance) || 0)]));
  const months = [];
  const paidOff = {};
  let totalInterest = 0;
  let totalPaid = 0;
  let shortfall = false;

  for (let i = 0; i < MAX_MONTHS; i++) {
    const ym = addMonths(start, i);
    if (Object.values(balances).every((b) => b <= 0.005)) break;

    let interest = 0;
    for (const d of debts) {
      const add = round2(balances[d.id] * rateFor(d, ym) / 100 / 12);
      balances[d.id] = round2(balances[d.id] + add);
      interest += add;
    }

    let money = Number(plan.budget) || 0;
    if (plan.lump?.amount && plan.lump.month === ym) money += Number(plan.lump.amount);

    const order = priority(debts, balances, plan.strategy, plan.order, ym);
    const minsDue = order.reduce((s, d) => s + Math.min(Number(d.min) || 0, balances[d.id]), 0);
    if (money + 0.005 < minsDue) shortfall = true;

    // 1) minimums, in priority order (if money runs short, the top priorities get paid)
    for (const d of order) {
      const pay = round2(Math.min(Number(d.min) || 0, balances[d.id], money));
      balances[d.id] = round2(balances[d.id] - pay);
      money = round2(money - pay);
    }
    // 2) everything left, in priority order
    for (const d of order) {
      const pay = round2(Math.min(balances[d.id], money));
      balances[d.id] = round2(balances[d.id] - pay);
      money = round2(money - pay);
    }

    const total = round2(Object.values(balances).reduce((s, b) => s + b, 0));
    for (const d of debts) if (!paidOff[d.id] && balances[d.id] <= 0.005) paidOff[d.id] = ym;
    totalInterest = round2(totalInterest + interest);
    totalPaid = round2(totalPaid + (Number(plan.budget) || 0) + (plan.lump?.month === ym ? Number(plan.lump.amount) || 0 : 0) - money);
    months.push({ ym, balances: { ...balances }, total, interest: round2(interest) });
  }

  const last = months[months.length - 1];
  const done = !last || last.total <= 0.005;
  // "stalled" = the plan never finishes because payments don't outrun interest
  return {
    months,
    debtFree: done ? (last ? last.ym : start) : null,
    totalInterest,
    totalPaid,
    paidOff,
    shortfall,
    stalled: !done,
  };
}

/** Minimums-only baseline, for comparison. Minimums are held fixed at today's amounts. */
export function minimumsOnly(debts, start) {
  const budget = debts.reduce((s, d) => s + (Number(d.balance) > 0 ? Number(d.min) || 0 : 0), 0);
  return simulate(debts, { budget, strategy: 'avalanche', start });
}
