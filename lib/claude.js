// lib/claude.js — the two jobs zero asks Claude to do, and the call that runs them.
//
// Prompts live here on the server, never in the browser, so the local API can't be
// turned into a general-purpose Claude relay. Each job forces a tool call, so the
// answer always comes back as structured JSON.

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const API = () => process.env.ZERO_ANTHROPIC_URL || 'https://api.anthropic.com';

export const JOBS = {
  insights: {
    system: `You are a blunt, kind money coach for someone who wants out of credit card debt as fast as possible.
You get a JSON summary: income, spending, a payoff plan already calculated by their app, their debts, and the last 30 days of spending by category and merchant.
Give 4 to 6 notes they can act on this week. Rules:
- Use their real numbers and merchant names. Every note names a dollar amount.
- Prioritize by dollars saved or months shaved off. Interest and promo deadlines first.
- Do not repeat the plan back to them; add what the plan doesn't already say.
- Never suggest new credit, loans, gambling, crypto, or skipping minimums. Don't moralize about giving or religion.
- Write in lowercase, plain and warm, one or two short sentences per note.
- monthly_impact is the rough dollars per month the note frees up or saves, or null.`,
    tool: {
      name: 'notes',
      description: 'Return the coaching notes.',
      input_schema: {
        type: 'object',
        properties: {
          notes: {
            type: 'array', minItems: 1, maxItems: 6,
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, body: { type: 'string' }, monthly_impact: { type: ['number', 'null'] } },
              required: ['title', 'body', 'monthly_impact'],
            },
          },
          one_thing: { type: 'string', description: 'the single most important thing to do first, one sentence' },
        },
        required: ['notes', 'one_thing'],
      },
    },
    maxTokens: 1500,
    content: (payload) => [{ type: 'text', text: `here's my money summary:\n${JSON.stringify(payload)}` }],
  },

  extract: {
    system: `You read bank and credit card statements (PDFs or app screenshots) and return every transaction you can see.
- amount is signed from the account holder's point of view: money in is positive, money out (purchases, fees, interest, withdrawals) is negative. On a credit card a payment or refund is positive, a purchase is negative.
- dates as YYYY-MM-DD. If a screenshot says "Friday" or "yesterday", work out the date from the newest dated row or the statement period; if you can't, skip that row.
- skip rows whose amount is hidden or cut off, and list them in skipped.
- If the statement shows a balance, APR, promo rate, minimum payment or due date, fill in debt; otherwise debt is null.
- Never return full account or card numbers.`,
    tool: {
      name: 'statement',
      description: 'Return the transactions and account details found.',
      input_schema: {
        type: 'object',
        properties: {
          account_name: { type: 'string', description: 'short name like "Apple Card" or "Capital One checking"' },
          transactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { date: { type: 'string' }, description: { type: 'string' }, amount: { type: 'number' } },
              required: ['date', 'description', 'amount'],
            },
          },
          skipped: { type: 'array', items: { type: 'string' } },
          debt: {
            type: ['object', 'null'],
            properties: {
              balance: { type: 'number' }, apr: { type: ['number', 'null'] }, promo_apr: { type: ['number', 'null'] },
              promo_end: { type: ['string', 'null'] }, minimum_payment: { type: ['number', 'null'] }, due_date: { type: ['string', 'null'] },
            },
          },
        },
        required: ['account_name', 'transactions', 'skipped', 'debt'],
      },
    },
    maxTokens: 8000,
    content: ({ mediaType, data }) => [
      mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
      { type: 'text', text: 'pull every transaction from this statement.' },
    ],
  },
};

const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_SUMMARY = 30 * 1024;

/** Returns an error message for a bad payload, or null if it's fine. */
export function checkPayload(task, payload) {
  if (task === 'insights') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'the summary is missing';
    if (JSON.stringify(payload).length > MAX_SUMMARY) return 'the summary is too large';
    return null;
  }
  if (task === 'extract') {
    const { mediaType, data } = payload || {};
    if (!FILE_TYPES.includes(mediaType)) return 'upload a PDF, PNG, JPEG or WebP';
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(data)) return 'the file data is not valid base64';
    return null;
  }
  return 'unknown task';
}

const headers = (key) => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' });

/** Runs a job. Resolves to { result } or { error, status }. Never includes the key in errors. */
export async function runJob(key, model, task, payload) {
  const job = JOBS[task];
  let res;
  try {
    res = await fetch(`${API()}/v1/messages`, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: job.maxTokens,
        system: job.system,
        tools: [job.tool],
        tool_choice: { type: 'tool', name: job.tool.name },
        messages: [{ role: 'user', content: job.content(payload) }],
      }),
    });
  } catch {
    return { error: 'couldn’t reach the anthropic api. check your connection.', status: 502 };
  }
  if (res.status === 401) return { error: 'anthropic rejected the api key. replace it in settings.', status: 401 };
  if (res.status === 404) return { error: `the model “${model}” wasn’t found. change it in settings.`, status: 400 };
  if (res.status === 429 || res.status === 529) return { error: 'claude is busy or you hit a rate limit. try again in a minute.', status: 503 };
  if (!res.ok) return { error: `the anthropic api answered ${res.status}.`, status: 502 };
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  return block ? { result: block.input } : { error: 'claude returned an unexpected answer.', status: 502 };
}

/** Checks a key by listing models. Resolves to 'valid', 'invalid' or 'unverified' (offline). */
export async function verifyKey(key) {
  try {
    const res = await fetch(`${API()}/v1/models?limit=1`, { headers: headers(key) });
    if (res.ok) return 'valid';
    if (res.status === 401 || res.status === 403) return 'invalid';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}
