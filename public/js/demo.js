// demo.js — made-up sample numbers, shown until you import your own.
// Safe to publish: no real accounts or people.

const tx = [
  ['2026-11-20', 'Checking', 'ACME COFFEE PAYROLL', 742.18],
  ['2026-11-06', 'Checking', 'ACME COFFEE PAYROLL', 701.55],
  ['2026-10-23', 'Checking', 'ACME COFFEE PAYROLL', 768.90],
  ['2026-10-09', 'Checking', 'ACME COFFEE PAYROLL', 690.12],
  ['2026-11-15', 'Checking', 'NORTHLINE CARD PAYMENT', -300.00],
  ['2026-10-15', 'Checking', 'NORTHLINE CARD PAYMENT', -300.00],
  ['2026-11-03', 'Checking', 'RENT — SHARED HOUSE', -450.00],
  ['2026-10-03', 'Checking', 'RENT — SHARED HOUSE', -450.00],
  ['2026-11-12', 'Checking', 'DEPT EDUCATION STUDENT LN', -45.00],
  ['2026-10-12', 'Checking', 'DEPT EDUCATION STUDENT LN', -45.00],
  ['2026-11-19', 'Northline card', 'SAFEWAY 1123', -38.42],
  ['2026-11-17', 'Northline card', 'SHELL OIL 5521', -41.10],
  ['2026-11-16', 'Northline card', 'TACO BELL 0094', -9.87],
  ['2026-11-14', 'Northline card', 'STEAM PURCHASE', -24.99],
  ['2026-11-12', 'Northline card', 'SPOTIFY USA', -11.99],
  ['2026-11-11', 'Northline card', 'CHIPOTLE 2210', -13.45],
  ['2026-11-09', 'Northline card', 'TARGET 0441', -52.30],
  ['2026-11-08', 'Northline card', 'STARBUCKS 8812', -6.85],
  ['2026-11-06', 'Northline card', 'NETFLIX.COM', -15.49],
  ['2026-11-05', 'Northline card', 'SHELL OIL 5521', -38.75],
  ['2026-11-03', 'Northline card', 'AMAZON MKTPL', -64.20],
  ['2026-11-02', 'Northline card', 'TACO BELL 0094', -8.12],
  ['2026-11-01', 'Northline card', 'INTEREST CHARGE', -28.40],
  ['2026-10-28', 'Northline card', 'SAFEWAY 1123', -44.18],
  ['2026-10-25', 'Northline card', 'XBOX GAME PASS', -16.99],
  ['2026-10-22', 'Northline card', 'CHIPOTLE 2210', -12.95],
  ['2026-10-19', 'Northline card', 'SHELL OIL 5521', -36.20],
  ['2026-10-14', 'Northline card', 'ULTA BEAUTY', -48.60],
  ['2026-10-12', 'Northline card', 'SPOTIFY USA', -11.99],
  ['2026-10-10', 'Northline card', 'TACO BELL 0094', -11.02],
  ['2026-10-06', 'Northline card', 'NETFLIX.COM', -15.49],
  ['2026-10-04', 'Northline card', 'TARGET 0441', -71.88],
  ['2026-10-01', 'Northline card', 'INTEREST CHARGE', -30.12],
];

const CATS = {
  'ACME COFFEE PAYROLL': 'income', 'NORTHLINE CARD PAYMENT': 'card payment', 'RENT — SHARED HOUSE': 'bills',
  'DEPT EDUCATION STUDENT LN': 'loan payment', 'SAFEWAY 1123': 'groceries', 'TARGET 0441': 'groceries',
  'SHELL OIL 5521': 'gas & convenience', 'TACO BELL 0094': 'fast food & dining', 'CHIPOTLE 2210': 'fast food & dining',
  'STARBUCKS 8812': 'fast food & dining', 'STEAM PURCHASE': 'gaming', 'XBOX GAME PASS': 'gaming',
  'SPOTIFY USA': 'subscriptions', 'NETFLIX.COM': 'subscriptions', 'AMAZON MKTPL': 'shopping',
  'ULTA BEAUTY': 'personal care & style', 'INTEREST CHARGE': 'interest & fees',
};

export const DEMO = {
  version: 1,
  sample: true,
  settings: {
    takeHome: 1560, netHourly: 15.4, fixed: 495, living: 620, studentLiving: 390,
    studentMode: false, extraHours: 0, extraMonthly: 0,
    strategy: 'avalanche', order: [], lump: { amount: 0, month: '' },
  },
  debts: [
    { id: 'd1', name: 'Northline card', balance: 1284.5, apr: 27.49, min: 35, promoApr: '', promoEnd: '' },
    { id: 'd2', name: 'Harbor card', balance: 1890, apr: 24.99, promoApr: 0, promoEnd: '2027-06-15', min: 38 },
    { id: 'd3', name: 'Phone financing', balance: 420, apr: 0, min: 35, promoApr: '', promoEnd: '' },
  ],
  transactions: tx.map(([date, account, description, amount], i) => ({
    id: `demo${i}`, date, account, description, amount, category: CATS[description] || 'other',
  })),
  learned: {},
};
