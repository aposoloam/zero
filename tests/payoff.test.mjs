// Run with: node --test tests/
// Expected numbers were checked against an independent python implementation of the same rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, minimumsOnly, rateFor, addMonths } from '../public/js/payoff.js';

const debts = [
  { id: 'apple', name: 'Everyday card', balance: 300, apr: 0, min: 0, payInFull: true },
  { id: 'prime', name: 'Store card', balance: 1500, apr: 24.99, min: 45 },
  { id: 'flex', name: 'Promo card', balance: 2400, apr: 26.99, promoApr: 0, promoEnd: '2027-04-02', min: 40 },
];

test('promo rate applies only before promoEnd', () => {
  assert.equal(rateFor(debts[2], '2027-03'), 0);
  assert.equal(rateFor(debts[2], '2027-04'), 26.99);
});

test('addMonths wraps years', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-11', 14), '2028-01');
});

test('$700/mo, highest rate first: June 2027, $120.41 interest', () => {
  const r = simulate(debts, { budget: 700, strategy: 'avalanche', start: '2026-12' });
  assert.equal(r.debtFree, '2027-06');
  assert.equal(r.totalInterest, 120.41);
});

test('$1,000/mo: April 2027, $54.99 interest', () => {
  const r = simulate(debts, { budget: 1000, strategy: 'avalanche', start: '2026-12' });
  assert.equal(r.debtFree, '2027-04');
  assert.equal(r.totalInterest, 54.99);
});

test('snowball pays the smallest balance first', () => {
  const r = simulate(debts, { budget: 700, strategy: 'snowball', start: '2026-12' });
  assert.ok(r.paidOff.prime < r.paidOff.flex);
  assert.ok(r.paidOff.apple <= r.paidOff.prime);
});

test('custom order is respected', () => {
  const r = simulate(debts, { budget: 700, strategy: 'custom', order: ['flex', 'prime', 'apple'], start: '2026-12' });
  assert.ok(r.paidOff.flex < r.paidOff.prime);
});

test('one-time extra lands in its month and shortens the plan', () => {
  const base = simulate(debts, { budget: 700, strategy: 'avalanche', start: '2026-12' });
  const lump = simulate(debts, { budget: 700, strategy: 'avalanche', start: '2026-12', lump: { amount: 800, month: '2026-12' } });
  assert.ok(lump.months[0].total < base.months[0].total - 799);
  assert.ok(lump.debtFree <= base.debtFree);
});

test('a budget below the minimums is flagged', () => {
  const r = simulate(debts, { budget: 50, strategy: 'avalanche', start: '2026-12' });
  assert.equal(r.shortfall, true);
});

test('payments that never beat interest are reported as stalled', () => {
  const r = simulate([{ id: 'x', balance: 10000, apr: 30, min: 10 }], { budget: 10, strategy: 'avalanche', start: '2026-12' });
  assert.equal(r.stalled, true);
  assert.equal(r.debtFree, null);
});

test('minimums-only baseline takes much longer', () => {
  const r = minimumsOnly(debts, '2026-12');
  assert.ok(r.months.length > 24);
});
