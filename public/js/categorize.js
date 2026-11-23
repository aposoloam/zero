// categorize.js — guesses a category from a transaction description.
//
// To teach it a new merchant, add a line to RULES. The first match wins, so put
// specific patterns above general ones. Categories you set by hand in the app are
// remembered per merchant and always beat these rules (see `merchantKey`).

export const CATEGORIES = [
  'income', 'groceries', 'gas & convenience', 'fast food & dining', 'work meals',
  'subscriptions', 'gaming', 'shopping', 'personal care & style', 'transport & parking',
  'car', 'bills', 'giving', 'loan payment', 'card payment', 'interest & fees',
  'business', 'refund', 'other',
];

// What a category means for the money in / out view.
//   in        counts as money in
//   transfer  money moving between your own accounts (card payments) — not counted,
//             because the purchases themselves are already counted on the card
//   out       everything else counts as money out
export function kindOf(category) {
  if (category === 'income') return 'in';
  if (category === 'card payment') return 'transfer';
  return 'out';
}

const RULES = [
  [/payroll|direct dep|paycheck|salary/i, 'income'],
  [/card.*pay(ment)?|crd epay|autopay|payment thank you|mobile pmt|payment from/i, 'card payment'],
  [/student ln|dept education|navient|nelnet|mohela|aidvantage/i, 'loan payment'],
  [/interest charge|late fee|annual fee|finance charge/i, 'interest & fees'],
  [/donation|tithe|tithing|church|charity/i, 'giving'],
  [/kroger|king soopers|walmart|safeway|target|costco|whole foods|trader joe|aldi|sprouts|publix|h-e-b/i, 'groceries'],
  [/7-eleven|loaf\W*n\W*jug|shell|conoco|chevron|exxon|circle k|maverik|kum ?& ?go|quiktrip|wawa|sheetz/i, 'gas & convenience'],
  [/mcdonald|raising cane|chick-?fil|taco bell|wendy|burger|chipotle|subway|starbucks|domino|pizza|doordash|uber eats|grubhub/i, 'fast food & dining'],
  [/spotify|netflix|hulu|disney\+|discord|google one|icloud|apple\.com\/bill|anthropic|claude|openai|amazon prime|prime video|youtube premium/i, 'subscriptions'],
  [/steam|xbox|playstation|nintendo|epic games|riot|roblox/i, 'gaming'],
  [/sally beauty|sephora|ulta|barber|salon/i, 'personal care & style'],
  [/parking|uber(?! eats)|lyft|transit|toll/i, 'transport & parking'],
  [/grease monkey|jiffy|autozone|o'?reilly|napa|tire|car wash|valvoline/i, 'car'],
  [/secretary.?state|cloudflare|namecheap|github|vercel|gumroad/i, 'business'],
  [/xcel|comcast|xfinity|verizon|t-mobile|at&t|insurance|geico|progressive|rent/i, 'bills'],
  [/amazon|amzn|ebay|etsy|best buy/i, 'shopping'],
];

/** Normalizes a description so "MCDONALDS 17005 130-3660880 CO" and "McDonald's" share a key. */
export function merchantKey(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/[0-9#*]+/g, ' ')
    .replace(/[^a-z&' ]+/g, ' ')
    .replace(/\b(co|ca|wa|ny|tn|va|de|castle rock|denver|pending)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

/**
 * @param {string} description
 * @param {number} amount   signed: + money in, − money out
 * @param {Object} learned  { merchantKey: category } from the user's own edits
 */
export function categorize(description, amount, learned = {}) {
  const key = merchantKey(description);
  if (learned[key]) return learned[key];
  for (const [pattern, category] of RULES) if (pattern.test(description)) return category;
  if (amount > 0 && /refund|return|credit/i.test(description)) return 'refund';
  return amount > 0 ? 'income' : 'other';
}
