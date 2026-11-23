// format.js — how numbers and dates read on screen. configure() is called whenever
// settings change, so locale, currency and date style follow settings.json.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
let cfg = { locale: 'en-US', currency: 'USD', dates: 'iso' };
let whole, cents;

export function configure({ locale = 'en-US', currency = 'USD', dates = 'iso' } = {}) {
  cfg = { locale, currency, dates };
  whole = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
  cents = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
configure();

/** $1,234 by default; $1,234.56 with cents. */
export const money = (n, withCents = false) => (withCents ? cents : whole).format(Number(n) || 0);

/** '2027-03' → '2027-03' (iso) or 'march 2027' (words). short → '2027-03' / 'mar ’27'. */
export function monthName(ym, short = false) {
  if (!ym) return '';
  if (cfg.dates === 'iso') return ym;
  const [y, m] = ym.split('-').map(Number);
  return short ? `${MONTHS[m - 1].slice(0, 3)} ’${String(y).slice(2)}` : `${MONTHS[m - 1]} ${y}`;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Months between two 'YYYY-MM' strings (b − a). */
export function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Escapes text for safe use inside innerHTML templates. Use it on anything from imports. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
