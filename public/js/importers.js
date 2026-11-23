// importers.js — turns bank / card exports into transactions.
//
// Every importer returns rows shaped like:
//   { date: 'YYYY-MM-DD', description, amount, account }
//   amount is signed from YOUR point of view: + money in, − money out.
//
// CSV presets are matched on the header row. To support a new bank, add a preset:
// list the header columns it must have, and a `row` function that maps one parsed
// line to the shape above. Anything unrecognized falls back to the generic mapper,
// which the import screen lets you adjust by hand.

/** RFC 4180 CSV parser: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text).replace(/^﻿/, ''); // strip a byte-order mark
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Accepts 2026-11-02, 11/02/2026, 11/2/26. Returns 'YYYY-MM-DD' or null. */
export function parseDate(value) {
  const v = String(value || '').trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

/** "$1,234.56", "(12.00)", "-5" → number. Returns NaN for blanks. */
export function parseAmount(value) {
  const v = String(value ?? '').trim();
  if (!v) return NaN;
  const negative = /^\(.*\)$/.test(v) || v.startsWith('-');
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return negative ? -n : n;
}

const has = (header, cols) => cols.every((c) => header.includes(c.toLowerCase()));

export const PRESETS = [
  {
    id: 'capitalone-checking', label: 'Capital One checking', account: 'Capital One checking',
    columns: ['Transaction Date', 'Transaction Description', 'Transaction Type', 'Transaction Amount'],
    row: (r) => ({
      date: r['transaction date'], description: r['transaction description'],
      amount: Math.abs(parseAmount(r['transaction amount'])) * (/debit/i.test(r['transaction type']) ? -1 : 1),
    }),
  },
  {
    id: 'capitalone-card', label: 'Capital One card', account: 'Capital One card',
    columns: ['Transaction Date', 'Description', 'Debit', 'Credit'],
    row: (r) => ({
      date: r['transaction date'], description: r.description,
      amount: (parseAmount(r.credit) || 0) - (parseAmount(r.debit) || 0),
    }),
  },
  {
    id: 'apple-card', label: 'Apple Card', account: 'Apple Card',
    columns: ['Transaction Date', 'Description', 'Amount (USD)'],
    // Apple Card exports purchases as positive numbers, payments as negative
    row: (r) => ({ date: r['transaction date'], description: r.merchant || r.description, amount: -parseAmount(r['amount (usd)']) }),
  },
  {
    id: 'chase-card', label: 'Chase card', account: 'Chase card',
    columns: ['Transaction Date', 'Post Date', 'Description', 'Amount'],
    // Chase card exports purchases as negative already
    row: (r) => ({ date: r['transaction date'], description: r.description, amount: parseAmount(r.amount) }),
  },
  {
    id: 'chase-checking', label: 'Chase checking', account: 'Chase checking',
    columns: ['Posting Date', 'Description', 'Amount'],
    row: (r) => ({ date: r['posting date'], description: r.description, amount: parseAmount(r.amount) }),
  },
];

/**
 * Best-guess column picks for an unknown CSV, from header names first and the first
 * data row second. The import screen shows these as editable selects.
 */
export function guessMapping(header, sample = []) {
  const find = (re) => header.findIndex((h) => re.test(h));
  const byValue = (test) => sample.findIndex((v) => test(String(v || '').trim()));
  const map = {
    date: find(/date|posted|when/i),
    description: find(/desc|merchant|payee|name|memo|details/i),
    amount: find(/amount|value|total/i),
    debit: find(/debit|withdraw/i),
    credit: find(/credit|deposit/i),
  };
  if (map.date < 0) map.date = byValue((v) => parseDate(v) !== null);
  if (map.amount < 0 && map.debit < 0) map.amount = byValue((v) => /^[-($]*[\d,]+\.\d{2}\)?$/.test(v));
  if (map.description < 0) map.description = byValue((v) => /[a-z]{3,}/i.test(v) && parseDate(v) === null);
  return map;
}

/**
 * Parse a CSV export.
 * @returns {{ preset, header, rows, mapping, errors }}
 *   preset is null when the generic mapper was used.
 */
export function importCSV(text, { mapping, flip = false } = {}) {
  const table = parseCSV(text);
  if (table.length < 2) return { preset: null, header: [], rows: [], mapping: null, errors: ['that file has no rows'] };
  const header = table[0].map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  const preset = mapping ? null : PRESETS.find((p) => has(lower, p.columns)) || null;
  const map = mapping || guessMapping(header, table[1]);
  const rows = [];
  const errors = [];

  table.slice(1).forEach((cells, i) => {
    const r = Object.fromEntries(lower.map((h, j) => [h, (cells[j] ?? '').trim()]));
    let out;
    if (preset) out = preset.row(r);
    else {
      const amount = map.amount >= 0
        ? parseAmount(cells[map.amount])
        : (parseAmount(cells[map.credit]) || 0) - (parseAmount(cells[map.debit]) || 0);
      out = { date: cells[map.date], description: cells[map.description], amount };
    }
    const date = parseDate(out.date);
    if (!date || !Number.isFinite(out.amount)) { errors.push(`line ${i + 2} skipped`); return; }
    rows.push({ date, description: String(out.description || '').trim() || '(no description)', amount: flip ? -out.amount : out.amount });
  });

  return { preset, header, rows, mapping: preset ? null : map, errors };
}

/** Stable id for de-duplicating imports: same account, day, amount and description = same transaction. */
export function txId(t) {
  const s = `${t.account}|${t.date}|${Number(t.amount).toFixed(2)}|${String(t.description).toLowerCase()}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `t${h.toString(36)}`;
}

/** Reads a File as base64 (no data: prefix), for statement uploads. */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
