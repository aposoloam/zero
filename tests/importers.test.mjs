import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, importCSV, parseAmount, parseDate } from '../public/js/importers.js';
import { categorize, merchantKey } from '../public/js/categorize.js';
import { addTransactions, monthlyBudget } from '../public/js/state.js';
import { localInsights, summaryForClaude } from '../public/js/insights.js';
import { DEMO } from '../public/js/demo.js';

test('csv parser handles quotes, commas and newlines in fields', () => {
  const rows = parseCSV('a,b\n"x, y","he said ""hi""\nthere"\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"\nthere']]);
});

test('amounts and dates in common bank formats', () => {
  assert.equal(parseAmount('$1,234.56'), 1234.56);
  assert.equal(parseAmount('(12.00)'), -12);
  assert.equal(parseDate('11/2/26'), '2026-11-02');
  assert.equal(parseDate('2026-11-02'), '2026-11-02');
});

test('apple card preset flips purchases to money out', () => {
  const csv = 'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By\n' +
    '11/20/2026,11/21/2026,CORNER BOOKS,Corner Books,Shopping,Purchase,42.10,Sam\n' +
    '11/20/2026,11/20/2026,PAYMENT,Apple,Payment,Payment,-100.00,Sam\n';
  const r = importCSV(csv);
  assert.equal(r.preset.id, 'apple-card');
  assert.equal(r.rows[0].amount, -42.1);
  assert.equal(r.rows[1].amount, 100);
});

test('capital one checking uses the debit/credit type column', () => {
  const csv = 'Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance\n' +
    '1234,Deposit from ACME COFFEE PAYROLL,10/01/26,Credit,900.00,950.00\n' +
    '1234,Withdrawal from CHASE CREDIT CRD EPAY,10/02/26,Debit,300.00,650.00\n';
  const r = importCSV(csv);
  assert.equal(r.preset.id, 'capitalone-checking');
  assert.deepEqual(r.rows.map((x) => x.amount), [900, -300]);
});

test('unknown csv falls back to a guessed mapping', () => {
  const r = importCSV('When,What,Value\n2026-11-01,Thing,-5.00\n');
  assert.equal(r.preset, null);
  assert.equal(r.rows[0].amount, -5);
});

test('categorizer knows the usual suspects', () => {
  assert.equal(categorize('McDonalds 17005 130-3660880 CO', -5), 'fast food & dining');
  assert.equal(categorize('Deposit from 305627 ACME COFFEE PAYROLL', 800), 'income');
  assert.equal(categorize('SPOTIFY USA', -11.99), 'subscriptions');
  assert.equal(categorize('Withdrawal from APPLECARD GSBANK PAYMENT', -52), 'card payment');
  assert.equal(merchantKey('McDonalds 17005 130-3660880 CO'), merchantKey('MCDONALDS 40362 112-3456789 CO'));
});

test('re-importing the same rows adds nothing; same-day twins are kept', () => {
  const s = JSON.parse(JSON.stringify(DEMO));
  const rows = [{ date: '2026-11-01', description: 'CAMPUS CAFE', amount: -1.5 }, { date: '2026-11-01', description: 'CAMPUS CAFE', amount: -1.5 }];
  assert.deepEqual(addTransactions(s, rows, 'Apple Card'), { added: 2, skipped: 0 });
  assert.deepEqual(addTransactions(s, rows, 'Apple Card'), { added: 0, skipped: 2 });
});

test('budget math and insights run on the sample', () => {
  assert.equal(monthlyBudget(DEMO.settings), 445);
  const notes = localInsights(DEMO);
  assert.ok(notes.length >= 3);
  const sum = summaryForClaude(DEMO);
  assert.ok(sum.debts.length === 3 && !JSON.stringify(sum).includes('demo0'));
});

test('insights and windows work with no transactions at all', async () => {
  const { empty } = await import('../public/js/state.js');
  const { since } = await import('../public/js/analysis.js');
  const s = empty();
  s.debts.push({ id: 'a', name: 'card', balance: 500, apr: 20, min: 25 });
  s.settings.takeHome = 1000;
  assert.deepEqual(since([], 30), []);
  assert.ok(localInsights(s).length > 0);
});
