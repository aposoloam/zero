// main.js — wires the page together. Read top to bottom:
//   1. state      2. saving      3. look & layout     4. payoff     5. plan
//   6. debts      7. notes       8. money in/out      9. transactions
//   10. import    11. settings dialog                 12. commands, keys, boot

import * as api from './api.js';
import { fromSaved, sample, empty, parseBackup, monthlyBudget, addTransactions, recategorize, newDebtId } from './state.js';
import { resolve, diff, apply, THEMES, PANES, FONTS, COLOR_KEYS, DEFAULTS, activeTheme } from './settings.js';
import { simulate, minimumsOnly, nextMonth } from './payoff.js';
import { importCSV, parseDate, fileToBase64 } from './importers.js';
import { CATEGORIES, categorize } from './categorize.js';
import { localInsights, summaryForClaude } from './insights.js';
import { monthlyFlow, byCategory, since } from './analysis.js';
import { payoffChart, flowChart } from './charts.js';
import { money, monthName, plural, esc, configure } from './format.js';
import { createPalette } from './palette.js';
import { listen, label as keyLabel } from './keys.js';

/* ---------- 1. state ---------- */

let state;                  // your money data (state.json)
let prefs = structuredClone(DEFAULTS); // look & behavior (settings.json), always fully resolved
let prefWarnings = [];
let animateNext = true;     // the payoff line inks itself in once per load
let txShown = 60;
let pending = null;         // an import waiting for confirmation
let saveStatus = { text: 'not saved yet', bad: false };

const $ = (sel) => document.querySelector(sel);
const num = (v) => (v === '' || v === null || v === undefined ? '' : Number(v));
const thisMonth = () => new Date().toISOString().slice(0, 7);
const openDebts = () => state.debts.filter((d) => Number(d.balance) > 0);
const currentPlan = () => {
  const s = state.settings;
  return { budget: monthlyBudget(s), strategy: s.strategy, order: s.order, lump: s.lump, start: nextMonth() };
};

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

/** Two-tap confirm for destructive buttons: the first tap relabels it, a second within 4s acts. */
function armed(btn, text) {
  if (!btn || btn.dataset.armed) return true;
  const original = btn.innerHTML;
  btn.dataset.armed = '1';
  btn.textContent = text;
  setTimeout(() => { delete btn.dataset.armed; btn.innerHTML = original; }, 4000);
  return false;
}

/* ---------- 2. saving (debounced; to data/*.json or browser storage in demo mode) ---------- */

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const writeState = debounce(async () => {
  try {
    await api.writeFile('state', state);
    saveStatus = { text: `saved ${new Date().toLocaleTimeString([], { hour12: false })}`, bad: false };
  } catch (err) {
    saveStatus = { text: `not saved: ${err.message}`, bad: true };
  }
  renderStatus();
}, 350);

function persist() {
  saveStatus = { text: 'saving…', bad: false };
  renderStatus();
  writeState();
}

const writePrefs = debounce(async () => {
  try { await api.writeFile('settings', diff(prefs)); } catch (err) { toast(`settings not saved: ${err.message}`); }
}, 350);

/** Changes one or more settings, re-applies them, re-renders, and saves settings.json. */
function setPrefs(patch, { save = true } = {}) {
  const next = resolve({ ...diff(prefs), ...patch });
  prefs = next.settings;
  prefWarnings = next.warnings;
  applyPrefs();
  if (save) writePrefs();
}

/* ---------- 3. look & layout ---------- */

function applyPrefs() {
  configure(prefs);
  apply(prefs);
  // pane order, visibility, width, and the number key that jumps to each
  const main = $('#panes');
  const visible = prefs.panes;
  for (const id of Object.keys(PANES)) {
    const pane = main.querySelector(`[data-pane="${id}"]`);
    const i = visible.indexOf(id);
    pane.hidden = i === -1;
    pane.classList.toggle('wide', prefs.wide.includes(id));
    pane.querySelector('.idx').textContent = i > -1 && i < 9 ? String(i + 1) : '';
  }
  visible.forEach((id) => main.appendChild(main.querySelector(`[data-pane="${id}"]`)));
  document.querySelectorAll('kbd[data-key]').forEach((k) => { k.textContent = prefs.keys[k.dataset.key] ? keyLabel(prefs.keys[k.dataset.key]) : ''; });
  $('#key-min').hidden = !prefs.chart.minimums;
  renderAll();
}

/* ---------- 4. payoff ---------- */

function renderPayoff() {
  const debts = openDebts();
  const plan = currentPlan();
  const lead = $('#hero-lead'), hero = $('#hero-date'), facts = $('#facts');
  hero.classList.remove('is-bad');

  if (!debts.length) {
    lead.textContent = state.debts.length ? 'every balance is at $0' : 'nothing to pay off yet';
    hero.textContent = state.debts.length ? 'debt-free' : 'add a debt';
    facts.innerHTML = '';
    $('#payoff-chart').replaceChildren();
    return;
  }

  const result = simulate(debts, plan);
  const base = minimumsOnly(debts, plan.start);
  const total = debts.reduce((s, d) => s + Number(d.balance), 0);

  lead.textContent = result.stalled ? 'at this budget you’re' : 'debt-free by';
  hero.textContent = result.stalled ? 'not getting there' : monthName(result.debtFree);
  hero.classList.toggle('is-bad', result.stalled);

  facts.innerHTML = `
    <div><dt>left to pay</dt><dd>${money(total)}</dd></div>
    <div><dt>months to go</dt><dd>${result.stalled ? '—' : result.months.length}</dd></div>
    <div class="cost"><dt>interest on the way</dt><dd>${result.stalled ? '—' : money(result.totalInterest)}</dd></div>
    <div><dt>to debt each month</dt><dd>${money(plan.budget)}</dd></div>`;

  const promos = prefs.chart.promos ? debts.filter((d) => d.promoEnd).map((d) => ({ ym: d.promoEnd.slice(0, 7), name: d.name })) : [];
  $('#key-promo').hidden = !promos.length;

  payoffChart($('#payoff-chart'), {
    start: thisMonth(), startTotal: total, plan: result, base, promos,
    showMin: prefs.chart.minimums, animate: animateNext && prefs.chart.animate,
    label: result.stalled ? 'payoff chart: the balance never reaches zero at this budget'
      : `payoff chart: ${money(total)} falls to zero by ${monthName(result.debtFree)}`,
    onHover: (p, b) => {
      $('#readout').textContent = p ? `${p.ym}  ${money(p.total)} left${b && prefs.chart.minimums ? `   minimums only: ${money(b.total)}` : ''}` : '';
    },
  });
  animateNext = false;
}

/* ---------- 5. plan ---------- */

const STRATEGY_HINTS = {
  avalanche: 'costs the least interest. promo rates count as low until they end.',
  snowball: 'quick wins: the smallest balances disappear first.',
  custom: 'set the order with the arrows in the debts table.',
};

function renderPlan() {
  const s = state.settings;
  document.querySelectorAll('input[name=strategy]').forEach((r) => { r.checked = r.value === s.strategy; });
  $('#strategy-hint').textContent = STRATEGY_HINTS[s.strategy] || '';
  $('#student-mode').checked = s.studentMode;
  $('#student-hint').textContent = `everyday spending ${money(s.living)} → ${money(s.studentLiving)} a month`;
  $('#extra-hours').value = s.extraHours;
  const shift = s.extraHours * s.netHourly * 52 / 12;
  $('#extra-hours-out').textContent = s.extraHours ? `+${s.extraHours} h/wk  +${money(shift)}/mo` : 'none';
  $('#extra-monthly').value = s.extraMonthly;
  $('#extra-monthly-out').textContent = s.extraMonthly ? `+${money(s.extraMonthly)}/mo` : 'none';
  $('#lump-amount').value = s.lump.amount || '';
  $('#lump-month').value = s.lump.month || '';
  $('#lump-month').min = nextMonth();
  document.querySelectorAll('[data-money]').forEach((i) => { if (document.activeElement !== i) i.value = s[i.dataset.money]; });
  renderMath();
}

function renderMath() {
  const s = state.settings;
  const living = s.studentMode ? s.studentLiving : s.living;
  const extra = s.extraHours * s.netHourly * 52 / 12 + Number(s.extraMonthly || 0);
  $('#budget-math').innerHTML = `${money(s.takeHome)} − ${money(s.fixed)} bills − ${money(living)} everyday${extra ? ` + ${money(extra)} extra` : ''} = <strong>${money(monthlyBudget(s))}/mo to debt</strong>`;
}

/* ---------- 6. debts ---------- */

function orderedDebts() {
  const s = state.settings;
  s.order = [...s.order.filter((id) => state.debts.some((d) => d.id === id)), ...state.debts.map((d) => d.id).filter((id) => !s.order.includes(id))];
  return s.strategy === 'custom' ? [...state.debts].sort((a, b) => s.order.indexOf(a.id) - s.order.indexOf(b.id)) : state.debts;
}

function renderDebts() {
  const custom = state.settings.strategy === 'custom';
  $('#debt-rows').innerHTML = orderedDebts().map((d, i, all) => `
    <tr data-id="${esc(d.id)}">
      <td data-label="name"><input type="text" id="n-${esc(d.id)}" aria-label="debt name" data-field="name" value="${esc(d.name)}"></td>
      <td class="num" data-label="balance"><input type="number" aria-label="${esc(d.name)} balance" data-field="balance" value="${esc(Number(d.balance).toFixed(2))}" min="0" step="0.01" inputmode="decimal"></td>
      <td class="num" data-label="rate %"><input type="number" class="rate" aria-label="${esc(d.name)} rate percent" data-field="apr" value="${esc(d.apr)}" min="0" step="0.01" inputmode="decimal"></td>
      <td class="num" data-label="promo %"><input type="number" class="rate" aria-label="${esc(d.name)} promo rate percent" data-field="promoApr" value="${esc(d.promoApr ?? '')}" min="0" step="0.01" inputmode="decimal" placeholder="—"></td>
      <td data-label="promo ends"><input type="date" aria-label="${esc(d.name)} promo end date" data-field="promoEnd" value="${esc(d.promoEnd || '')}"></td>
      <td class="num" data-label="minimum"><input type="number" aria-label="${esc(d.name)} minimum payment" data-field="min" value="${esc(d.min)}" min="0" step="1" inputmode="decimal"></td>
      <td class="center" data-label="paid in full monthly"><input type="checkbox" aria-label="${esc(d.name)} is paid in full every month" data-field="payInFull" ${d.payInFull ? 'checked' : ''}></td>
      <td class="gone" data-label="gone by" data-gone="${esc(d.id)}"></td>
      <td><span class="row-actions">
        ${custom ? `<button type="button" data-cmd="debt-up" aria-label="move ${esc(d.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-cmd="debt-down" aria-label="move ${esc(d.name)} down" ${i === all.length - 1 ? 'disabled' : ''}>↓</button>` : ''}
        <button type="button" data-cmd="remove-debt" aria-label="remove ${esc(d.name)}">remove</button>
      </span></td>
    </tr>`).join('') || '<tr><td colspan="9" class="empty">no debts yet. add the cards and loans you want gone.</td></tr>';
  renderGoneBy();
}

function renderGoneBy() {
  const debts = openDebts();
  const paidOff = debts.length ? simulate(debts, currentPlan()).paidOff : {};
  document.querySelectorAll('[data-gone]').forEach((cell) => {
    const d = state.debts.find((x) => x.id === cell.dataset.gone);
    const ym = paidOff[cell.dataset.gone];
    const owes = Number(d?.balance) > 0;
    cell.classList.toggle('is-bad', owes && !ym);
    cell.textContent = !owes ? 'paid off' : ym ? monthName(ym, true) : 'not in sight';
  });
}

function onDebtInput(e) {
  const row = e.target.closest('tr[data-id]');
  const field = e.target.dataset.field;
  if (!row || !field) return;
  const d = state.debts.find((x) => x.id === row.dataset.id);
  if (field === 'name' || field === 'promoEnd') d[field] = e.target.value;
  else if (field === 'payInFull') d.payInFull = e.target.checked;
  else d[field] = num(e.target.value);
  persist();
  renderNumbers();
}

function moveDebt(btn, dir) {
  const order = state.settings.order;
  const i = order.indexOf(btn.closest('tr').dataset.id), j = i + dir;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  persist(); renderDebts(); renderNumbers();
}

/* ---------- 7. notes ---------- */

function renderNotes() {
  $('#local-notes').innerHTML = localInsights(state).map((n) => `<li class="${n.tone}">${esc(n.text)}</li>`).join('');
}

async function askClaude() {
  const box = $('#claude-notes'), btn = $('#ask-claude');
  btn.disabled = true;
  box.innerHTML = '<p class="thinking">claude is reading your numbers </p>';
  try {
    const r = await api.claude('insights', summaryForClaude(state));
    box.innerHTML = `<p class="first">${esc(r.one_thing)}</p>
      <dl>${(r.notes || []).map((n) => `<div><dt>${esc(n.title)}${n.monthly_impact ? ` <span>${money(n.monthly_impact)}/mo</span>` : ''}</dt><dd>${esc(n.body)}</dd></div>`).join('')}</dl>`;
  } catch (err) {
    const fix = /api key/.test(err.message) ? ' <button type="button" class="link" data-cmd="settings">open settings</button>' : '';
    box.innerHTML = `<p class="error">${esc(err.message)}${fix}</p>`;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 8. money in / out ---------- */

function renderFlow() {
  flowChart($('#flow-chart'), monthlyFlow(state.transactions));
  const cats = byCategory(since(state.transactions, Number($('#window').value))).slice(0, 10);
  const top = cats[0]?.total || 1;
  const list = $('#cats');
  list.innerHTML = cats.length ? cats.map((c) => `<li><span>${esc(c.category)} <span class="count">${c.count}×</span></span><strong>${money(c.total)}</strong><span class="bar"></span></li>`).join('')
    : '<li class="empty">nothing spent in this window.</li>';
  // widths go through the CSSOM so the strict content security policy can forbid inline styles
  list.querySelectorAll('.bar').forEach((b, i) => { b.style.width = `${Math.max(2, (cats[i].total / top) * 100)}%`; });
}

/* ---------- 9. transactions ---------- */

function renderTxFilters() {
  const accounts = [...new Set(state.transactions.map((t) => t.account))].sort();
  const fill = (sel, opts, all) => {
    const v = sel.value;
    sel.innerHTML = `<option value="">${all}</option>` + opts.map((o) => `<option>${esc(o)}</option>`).join('');
    sel.value = opts.includes(v) ? v : '';
  };
  fill($('#tx-account'), accounts, 'all accounts');
  fill($('#tx-category'), CATEGORIES, 'all categories');
}

function renderTx() {
  const q = $('#tx-search').value.trim().toLowerCase();
  const acct = $('#tx-account').value, cat = $('#tx-category').value;
  const rows = state.transactions.filter((t) => (!acct || t.account === acct) && (!cat || t.category === cat) &&
    (!q || t.description.toLowerCase().includes(q) || String(Math.abs(t.amount)).includes(q)));
  const options = CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#tx-rows').innerHTML = rows.slice(0, txShown).map((t) => `
    <tr data-tx="${esc(t.id)}">
      <td class="c-date">${esc(t.date)}</td>
      <td class="c-desc" title="${esc(t.description)}">${esc(t.description)}</td>
      <td class="c-acct">${esc(t.account)}</td>
      <td class="c-cat"><select aria-label="category for ${esc(t.description)}" data-tx-cat>${options}</select></td>
      <td class="num c-amt ${t.amount > 0 ? 'in' : ''}">${t.amount > 0 ? '+' : ''}${money(t.amount, true)}</td>
      <td class="c-act"><span class="row-actions"><button type="button" data-cmd="remove-tx" aria-label="delete ${esc(t.description)}">×</button></span></td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">no transactions match. press import to add some.</td></tr>';
  $('#tx-rows').querySelectorAll('[data-tx-cat]').forEach((s) => { s.value = state.transactions.find((t) => t.id === s.closest('tr').dataset.tx).category; });
  $('#tx-count').textContent = plural(rows.length, 'transaction');
  $('#tx-more').hidden = rows.length <= txShown;
}

/* ---------- status bar and banner ---------- */

function renderStatus() {
  const info = api.serverInfo();
  const plan = currentPlan();
  const parts = [
    info ? '<span class="ok">local</span>' : '<span>demo</span>',
    `<span class="opt">${info ? `${esc(info.dataDir)}/state.json` : 'browser storage'}</span>`,
    `<span class="${saveStatus.bad ? 'bad' : ''}">${esc(saveStatus.text)}</span>`,
    info ? (info.key.set ? `<span class="opt ok">key ${esc(info.key.hint)}</span>` : '<span class="opt">no api key</span>') : '',
    `<span class="opt">${esc(state.settings.strategy)}</span>`,
    `<span>${money(plan.budget)}/mo</span>`,
    prefs.keys.help ? `<span class="opt">${esc(keyLabel(prefs.keys.help))} shortcuts</span>` : '',
  ];
  $('#status').innerHTML = parts.filter(Boolean).join('');
  $('#where').textContent = info ? `zero ${info.version}  ${info.dataDir}/` : 'demo: data stays in this browser';
}

function renderBanner() {
  const b = $('#banner');
  const info = api.serverInfo();
  const notes = [];
  const repo = document.body.dataset.repo;
  if (!info) notes.push(`demo mode: nothing leaves this browser and claude is off. to use zero for real, run it on your computer${repo ? `: <a href="${esc(repo)}">get it on github</a>` : ' with <code>npm start</code>'}.`);
  if (state.sample) notes.push(`these are sample numbers. <button type="button" class="link" data-cmd="import">import a statement</button><button type="button" class="link" data-cmd="start-empty">start empty</button>`);
  if (prefWarnings.length) notes.push(`settings.json: ${esc(prefWarnings.join('; '))}`);
  b.hidden = !notes.length;
  b.innerHTML = notes.join('<br>');
}

/** Everything driven by numbers, without rebuilding inputs you may be typing in. */
function renderNumbers() {
  renderPayoff(); renderMath(); renderGoneBy(); renderNotes(); renderStatus();
}

function renderAll() {
  if (!state) return;
  renderBanner(); renderPlan(); renderDebts(); renderPayoff(); renderNotes();
  renderFlow(); renderTxFilters(); renderTx(); renderStatus();
}

/* ---------- 10. import ---------- */

const STATEMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

function openImport() {
  pending = null;
  $('#import-preview').innerHTML = '';
  $('#import-error').textContent = '';
  $('#import-file').value = '';
  $('#import-confirm').disabled = true;
  $('#import-confirm').textContent = 'add transactions';
  $('#import-dialog').showModal();
}

async function handleImportFile(file) {
  pending = null;
  const err = $('#import-error'), preview = $('#import-preview');
  err.textContent = '';
  $('#import-confirm').disabled = true;
  if (!file) return;
  if (file.size > 9 * 1024 * 1024) { err.textContent = 'that file is over 9 MB. export a shorter date range.'; return; }

  if (STATEMENT_TYPES.includes(file.type)) {
    preview.innerHTML = '<p class="thinking">claude is reading the statement </p>';
    try {
      const r = await api.claude('extract', { mediaType: file.type, data: await fileToBase64(file) });
      const rows = (r.transactions || [])
        .map((t) => ({ date: parseDate(t.date), description: String(t.description || '').slice(0, 120), amount: Number(t.amount) }))
        .filter((t) => t.date && Number.isFinite(t.amount));
      pending = { rows, account: r.account_name || file.name, source: 'claude', skipped: r.skipped || [], debt: r.debt };
      renderPreview();
    } catch (e) { preview.innerHTML = ''; err.textContent = e.message; }
    return;
  }

  const text = await file.text();

  // a backup: by extension, type, or because it's a JSON object (some browsers drop both)
  if (/\.json$/i.test(file.name) || file.type === 'application/json' || text.trimStart().startsWith('{')) {
    try {
      const restored = parseBackup(text);
      pending = { backup: restored };
      preview.innerHTML = `<p>a zero backup with ${plural(restored.debts.length, 'debt')} and ${plural(restored.transactions.length, 'transaction')}. it replaces everything here.</p>`;
      $('#import-confirm').disabled = false;
      $('#import-confirm').textContent = 'replace with backup';
    } catch (e) { err.textContent = e.message; }
    return;
  }

  const parsed = importCSV(text);
  if (!parsed.rows.length) { preview.innerHTML = ''; err.textContent = 'no transactions found. is this a csv export from your bank?'; return; }
  pending = { text, ...parsed, account: parsed.preset?.account || file.name.replace(/\.csv$/i, ''), flip: false, source: 'csv' };
  renderPreview();
}

function renderPreview() {
  const p = pending;
  const accounts = [...new Set([...state.transactions.map((t) => t.account), ...state.debts.map((d) => d.name)])];
  const cols = (k) => p.header.map((h, i) => `<option value="${i}" ${p.mapping[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('');
  const lower = p.account.toLowerCase();
  const match = p.debt ? state.debts.find((d) => d.name.toLowerCase().includes(lower) || lower.includes(d.name.toLowerCase())) : null;
  p.debtMatch = match;

  $('#import-preview').innerHTML = `
    <div class="preview">
      <div class="preview-meta">
        <span>${p.source === 'claude' ? 'read by claude' : p.preset ? `format: ${esc(p.preset.label)}` : 'format not recognized, check the columns'}</span>
        <label>account <input type="text" id="import-account" list="account-list" value="${esc(p.account)}"></label>
        <datalist id="account-list">${accounts.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
        ${p.source === 'csv' ? `<label><input type="checkbox" id="import-flip" ${p.flip ? 'checked' : ''}> flip signs</label>` : ''}
      </div>
      ${p.mapping ? `<div class="mapping">
        <label>date <select data-map="date">${cols('date')}</select></label>
        <label>description <select data-map="description">${cols('description')}</select></label>
        <label>amount <select data-map="amount"><option value="-1">debit / credit columns</option>${cols('amount')}</select></label>
      </div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>date</th><th>description</th><th>category</th><th class="num">amount</th></tr></thead>
        <tbody>${p.rows.slice(0, 80).map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.description)}</td><td>${esc(categorize(r.description, r.amount, state.learned))}</td><td class="num">${money(r.amount, true)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">${plural(p.rows.length, 'transaction')}${p.rows.length > 80 ? ', first 80 shown' : ''}. money in is positive, money out is negative${p.source === 'csv' ? '. if that’s backwards, flip signs' : ''}.
      ${p.skipped?.length ? `<br>skipped: ${esc(p.skipped.join('; '))}` : ''}${p.errors?.length ? `<br>${plural(p.errors.length, 'line')} couldn’t be read.` : ''}</p>
      ${p.debt?.balance ? `<label class="debt-offer"><input type="checkbox" id="import-debt" checked>
        <span>${match ? `update ${esc(match.name)}` : 'add a debt'}: balance ${money(p.debt.balance, true)}${p.debt.apr != null ? `, ${esc(p.debt.apr)}%` : ''}${p.debt.promo_end ? `, ${esc(p.debt.promo_apr ?? 0)}% until ${esc(p.debt.promo_end)}` : ''}${p.debt.minimum_payment != null ? `, minimum ${money(p.debt.minimum_payment)}` : ''}</span></label>` : ''}
    </div>`;
  $('#import-confirm').disabled = !p.rows.length;
  $('#import-confirm').textContent = `add ${plural(p.rows.length, 'transaction')}`;
}

function onPreviewChange(e) {
  if (!pending?.rows) return;
  if (e.target.id === 'import-account') { pending.account = e.target.value; return; }
  if (e.target.id === 'import-flip' || e.target.dataset.map !== undefined) {
    const mapping = pending.mapping ? { ...pending.mapping } : null;
    if (e.target.dataset.map) mapping[e.target.dataset.map] = Number(e.target.value);
    const flip = $('#import-flip')?.checked || false;
    pending = { ...pending, ...importCSV(pending.text, { mapping, flip }), preset: mapping ? null : pending.preset, flip };
    if (mapping) pending.mapping = mapping;
    renderPreview();
  }
}

function confirmImport() {
  if (!pending) return;
  if (pending.backup) {
    state = pending.backup;
    $('#import-dialog').close();
    persist(); animateNext = true; renderAll();
    toast(`restored ${plural(state.debts.length, 'debt')} and ${plural(state.transactions.length, 'transaction')}`);
    return;
  }
  const account = ($('#import-account')?.value || pending.account || 'imported').trim();
  const { added, skipped } = addTransactions(state, pending.rows, account);
  if (pending.debt?.balance && $('#import-debt')?.checked) {
    const d = pending.debtMatch || { id: newDebtId(state), name: account, min: 0, apr: 0, promoApr: '', promoEnd: '' };
    if (!pending.debtMatch) state.debts.push(d);
    d.balance = Number(pending.debt.balance);
    if (pending.debt.apr != null) d.apr = Number(pending.debt.apr);
    if (pending.debt.promo_end) { d.promoEnd = parseDate(pending.debt.promo_end) || ''; d.promoApr = Number(pending.debt.promo_apr ?? 0); }
    if (pending.debt.minimum_payment != null) d.min = Number(pending.debt.minimum_payment);
  }
  state.sample = false;
  persist();
  $('#import-dialog').close();
  pending = null;
  toast(`added ${plural(added, 'transaction')}${skipped ? `, skipped ${skipped} already here` : ''}`);
  renderAll();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `zero-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('backup downloaded');
}

/* ---------- 11. settings dialog ---------- */

function field(labelText, control) { return `<div class="field"><span>${labelText}</span><div class="row">${control}</div></div>`; }
const opt = (value, text, current) => `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(text)}</option>`;

function renderSettings() {
  const info = api.serverInfo();
  const t = activeTheme(prefs);
  const fontChoice = FONTS[prefs.font] ? prefs.font : 'custom';
  $('#settings-body').innerHTML = `
    <section aria-labelledby="s-look"><h3 id="s-look">appearance</h3>
      ${field('theme', `<select data-pref="theme">${opt('system', 'system (graph / ink)', prefs.theme)}${Object.entries(THEMES).map(([k, v]) => opt(k, v.label, prefs.theme)).join('')}</select>`)}
      ${field('colors', `<div class="swatches">${COLOR_KEYS.map((k) => `<label><input type="color" data-color="${k}" value="${t[k]}"> ${k}</label>`).join('')}</div>
        <button type="button" class="quiet" data-cmd="reset-colors" ${Object.keys(prefs.colors).length ? '' : 'disabled'}>reset colors</button>`)}
      ${field('font', `<select data-pref="fontChoice">${opt('mono', 'JetBrains Mono', fontChoice)}${opt('sans', 'Hanken Grotesk', fontChoice)}${opt('custom', 'a font on this computer…', fontChoice)}</select>
        <input type="text" data-pref="fontCustom" placeholder="e.g. Berkeley Mono" value="${fontChoice === 'custom' ? esc(prefs.font) : ''}" ${fontChoice === 'custom' ? '' : 'hidden'} aria-label="custom font name">`)}
      ${field('text size', `<input type="range" min="11" max="20" step="1" data-pref="fontSize" value="${prefs.fontSize}" aria-label="text size"><output>${prefs.fontSize}px</output>`)}
      ${field('density', `<select data-pref="density">${opt('comfortable', 'comfortable', prefs.density)}${opt('compact', 'compact', prefs.density)}</select>`)}
      ${field('dates', `<select data-pref="dates">${opt('iso', '2027-03', prefs.dates)}${opt('words', 'march 2027', prefs.dates)}</select>`)}
      ${field('money', `<input type="text" data-pref="locale" value="${esc(prefs.locale)}" aria-label="locale" size="8"><input type="text" data-pref="currency" value="${esc(prefs.currency)}" aria-label="currency code" size="4">`)}
    </section>

    <section aria-labelledby="s-layout"><h3 id="s-layout">layout</h3>
      ${field('columns', `<select data-pref="columns">${opt(1, 'one', prefs.columns)}${opt(2, 'two', prefs.columns)}</select>`)}
      ${field('panes', `<ol class="pane-list">${[...prefs.panes, ...Object.keys(PANES).filter((p) => !prefs.panes.includes(p))].map((id) => {
        const on = prefs.panes.includes(id), i = prefs.panes.indexOf(id);
        return `<li data-pane-id="${id}"><span>${esc(PANES[id])}</span>
          <label><input type="checkbox" data-pane-show ${on ? 'checked' : ''}> show</label>
          <label><input type="checkbox" data-pane-wide ${prefs.wide.includes(id) ? 'checked' : ''}> full width</label>
          <span class="row-actions"><button type="button" data-cmd="pane-up" aria-label="move ${esc(PANES[id])} up" ${!on || i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-cmd="pane-down" aria-label="move ${esc(PANES[id])} down" ${!on || i === prefs.panes.length - 1 ? 'disabled' : ''}>↓</button></span></li>`;
      }).join('')}</ol>`)}
      ${field('chart', `<label><input type="checkbox" data-chart="animate" ${prefs.chart.animate ? 'checked' : ''}> draw-in</label>
        <label><input type="checkbox" data-chart="minimums" ${prefs.chart.minimums ? 'checked' : ''}> minimums-only line</label>
        <label><input type="checkbox" data-chart="promos" ${prefs.chart.promos ? 'checked' : ''}> promo deadlines</label>`)}
    </section>

    <section aria-labelledby="s-keys"><h3 id="s-keys">keyboard</h3>
      <div class="keylist">${Object.entries(prefs.keys).map(([k, v]) => `<label>${esc(k)} <input type="text" data-keybind="${k}" value="${esc(v)}" spellcheck="false"></label>`).join('')}</div>
      <p class="hint">one key (“i”) or one chord (“mod+k”, “alt+s”). mod is ⌘ on mac, ctrl elsewhere. leave empty to turn a shortcut off. 1–9 jump to panes.</p>
    </section>

    <section aria-labelledby="s-claude"><h3 id="s-claude">claude</h3>
      ${info ? `
        ${field('api key', info.key.set
          ? `<span class="key-state ok">saved ${esc(info.key.hint)}${info.key.status === 'unverified' ? ' (not verified, you were offline)' : ''}${info.key.source === 'env' ? ' from ANTHROPIC_API_KEY' : ''}</span>
             ${info.key.source === 'env' ? '' : '<button type="button" class="quiet" data-cmd="remove-key">remove</button>'}`
          : '<span class="key-state">none yet</span>')}
        ${info.key.source === 'env' ? '' : field(info.key.set ? 'replace key' : 'add key', `<input type="password" id="key-input" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" size="28" aria-label="anthropic api key">
          <button type="button" data-cmd="save-key">save key</button>`)}
        <p class="hint">the key is checked with anthropic, then saved to ${esc(info.dataDir)}/secrets.json on this computer with owner-only permissions. the page never sees it again. get one at console.anthropic.com.</p>
        <p class="error" id="key-error" role="alert"></p>
        ${field('model', `<input type="text" data-pref="model" value="${esc(prefs.model)}" list="models" spellcheck="false" aria-label="claude model">
          <datalist id="models"><option value="claude-sonnet-5-5"><option value="claude-haiku-5-5"><option value="claude-opus-5-5"></datalist>`)}`
      : '<p class="hint">claude needs the local server, so your api key never touches the browser. run <code>npm start</code> and open http://localhost:4321.</p>'}
    </section>

    <section aria-labelledby="s-data"><h3 id="s-data">data</h3>
      ${field('stored in', info ? `<code>${esc(info.dataDir)}/state.json</code>, <code>settings.json</code>` : 'this browser (demo mode)')}
      ${field('backup', '<button type="button" class="quiet" data-cmd="export">download backup</button><button type="button" class="quiet" data-cmd="import">restore or import…</button>')}
      ${field('start over', '<button type="button" class="quiet" data-cmd="load-sample">load sample numbers</button><button type="button" class="quiet" data-cmd="start-empty">start empty</button><button type="button" class="danger" data-cmd="erase">erase everything</button>')}
    </section>

    <section aria-labelledby="s-json"><h3 id="s-json">settings.json</h3>
      <p class="hint">every option above, as text. only values that differ from the defaults are saved.</p>
      <textarea class="json-editor" id="json-editor" spellcheck="false" aria-label="settings.json">${esc(JSON.stringify(diff(prefs), null, 2))}</textarea>
      <div class="row"><button type="button" data-cmd="apply-json">apply</button><button type="button" class="quiet" data-cmd="show-defaults">show all defaults</button></div>
      <p class="error" id="json-error" role="alert"></p>
    </section>`;
}

function openSettings(focus) {
  renderSettings();
  $('#settings-dialog').showModal();
  if (focus) $(focus)?.focus();
}

function onSettingsInput(e) {
  const el = e.target;
  if (el.dataset.pref === 'fontChoice') {
    if (el.value === 'custom') { el.nextElementSibling.hidden = false; el.nextElementSibling.focus(); return; }
    return setPrefs({ font: el.value });
  }
  if (el.dataset.pref === 'fontCustom') { if (el.value.trim()) setPrefs({ font: el.value }); return; }
  if (el.dataset.pref === 'fontSize') { el.nextElementSibling.textContent = `${el.value}px`; return setPrefs({ fontSize: Number(el.value) }); }
  if (el.dataset.pref === 'columns') return setPrefs({ columns: Number(el.value) });
  if (el.dataset.pref) return setPrefs({ [el.dataset.pref]: el.value });
  if (el.dataset.color) return setPrefs({ colors: { ...prefs.colors, [el.dataset.color]: el.value } });
  if (el.dataset.chart) return setPrefs({ chart: { ...prefs.chart, [el.dataset.chart]: el.checked } });
  if (el.dataset.keybind) return setPrefs({ keys: { ...prefs.keys, [el.dataset.keybind]: el.value.trim() } });
  const li = el.closest('[data-pane-id]');
  if (li && el.matches('[data-pane-show]')) {
    const id = li.dataset.paneId;
    setPrefs({ panes: el.checked ? [...prefs.panes, id] : prefs.panes.filter((p) => p !== id) });
    return renderSettings();
  }
  if (li && el.matches('[data-pane-wide]')) {
    const id = li.dataset.paneId;
    return setPrefs({ wide: el.checked ? [...prefs.wide, id] : prefs.wide.filter((p) => p !== id) });
  }
}

function movePane(btn, dir) {
  const id = btn.closest('[data-pane-id]').dataset.paneId;
  const panes = [...prefs.panes];
  const i = panes.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= panes.length) return;
  [panes[i], panes[j]] = [panes[j], panes[i]];
  setPrefs({ panes });
  renderSettings();
}

async function saveKey() {
  const input = $('#key-input'), err = $('#key-error'), btn = document.querySelector('[data-cmd=save-key]');
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'checking…';
  try {
    const r = await api.saveKey(input.value);
    input.value = '';
    toast(r.status === 'valid' ? `key ${r.hint} verified and saved` : `key ${r.hint} saved (couldn’t verify offline)`);
    renderSettings(); renderStatus();
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = 'save key';
  }
}

function applyJson() {
  const err = $('#json-error');
  try {
    const parsed = JSON.parse($('#json-editor').value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('settings.json must be an object: { … }');
    const next = resolve(parsed);
    prefs = next.settings; prefWarnings = next.warnings;
    applyPrefs(); writePrefs(); renderSettings();
    $('#json-error').textContent = prefWarnings.join('; ');
    if (!prefWarnings.length) toast('settings applied');
  } catch (e) {
    err.textContent = e instanceof SyntaxError ? `not valid JSON: ${e.message}` : e.message;
  }
}

/* ---------- 12. commands, keys, boot ---------- */

const ACTIONS = {
  palette: () => palette.open(),
  import: openImport,
  settings: () => openSettings(),
  'close-settings': () => $('#settings-dialog').close(),
  ask: askClaude,
  student: () => { state.settings.studentMode = !state.settings.studentMode; persist(); renderPlan(); renderNumbers(); toast(`student mode ${state.settings.studentMode ? 'on' : 'off'}`); },
  search: () => { if (prefs.panes.includes('transactions')) { $('#tx-search').focus(); $('#tx-search').scrollIntoView({ block: 'center' }); } },
  help: () => { renderHelp(); $('#help-dialog').showModal(); },
  'confirm-import': confirmImport,
  export: exportBackup,
  'add-debt': () => {
    const id = newDebtId(state);
    state.debts.push({ id, name: 'new debt', balance: 0, apr: 0, promoApr: '', promoEnd: '', min: 0 });
    state.sample = false;
    persist(); renderDebts(); renderBanner();
    document.getElementById(`n-${id}`)?.select();
  },
  'remove-debt': (btn) => {
    if (!armed(btn, 'sure?')) return;
    const id = btn.closest('tr').dataset.id;
    state.debts = state.debts.filter((x) => x.id !== id);
    persist(); renderDebts(); renderNumbers();
  },
  'debt-up': (btn) => moveDebt(btn, -1),
  'debt-down': (btn) => moveDebt(btn, 1),
  'remove-tx': (btn) => {
    const id = btn.closest('tr').dataset.tx;
    state.transactions = state.transactions.filter((t) => t.id !== id);
    persist(); renderTx(); renderFlow(); renderNotes();
  },
  'more-tx': () => { txShown += 100; renderTx(); },
  'load-sample': () => { state = sample(); persist(); animateNext = true; renderAll(); toast('sample numbers loaded'); },
  'start-empty': () => { state = empty(); persist(); renderAll(); toast('cleared. add a debt or import a statement.'); },
  erase: async (btn) => {
    if (!armed(btn, 'tap again to erase')) return;
    state = empty();
    persist();
    if (!api.isLocal()) await api.eraseLocal();
    renderAll(); toast('erased');
  },
  'save-key': saveKey,
  'remove-key': async (btn) => {
    if (!armed(btn, 'sure?')) return;
    try { await api.removeKey(); toast('key removed'); } catch (e) { toast(e.message); }
    renderSettings(); renderStatus();
  },
  'reset-colors': () => { setPrefs({ colors: {} }); renderSettings(); },
  'pane-up': (btn) => movePane(btn, -1),
  'pane-down': (btn) => movePane(btn, 1),
  'apply-json': applyJson,
  'show-defaults': () => { $('#json-editor').value = JSON.stringify(prefs, null, 2); },
};

/** Everything the palette can run. Titles read as "group: action". */
function commands() {
  const k = (name) => (prefs.keys[name] ? keyLabel(prefs.keys[name]) : '');
  const list = [
    { title: 'import a file', hint: k('import'), run: openImport },
    { title: 'ask claude for notes', hint: k('ask'), run: askClaude },
    { title: `student mode: turn ${state.settings.studentMode ? 'off' : 'on'}`, hint: k('student'), run: ACTIONS.student },
    { title: 'debts: add a debt', run: ACTIONS['add-debt'] },
    { title: 'transactions: search', hint: k('search'), run: ACTIONS.search },
    { title: 'settings: open', hint: k('settings'), run: () => openSettings() },
    { title: 'settings: edit settings.json', run: () => openSettings('#json-editor') },
    { title: 'settings: api key', run: () => openSettings('#key-input') },
    { title: 'data: download backup', run: exportBackup },
    { title: 'data: load sample numbers', run: ACTIONS['load-sample'] },
    { title: 'data: start empty', run: ACTIONS['start-empty'] },
    { title: 'keyboard shortcuts', hint: k('help'), run: ACTIONS.help },
  ];
  for (const [id, name] of [['avalanche', 'highest rate first'], ['snowball', 'smallest balance first'], ['custom', 'my own order']]) {
    list.push({ title: `strategy: ${name}`, run: () => { state.settings.strategy = id; persist(); renderPlan(); renderDebts(); renderNumbers(); } });
  }
  prefs.panes.forEach((id, i) => list.push({ title: `go to: ${PANES[id]}`, hint: i < 9 ? String(i + 1) : '', run: () => jumpTo(id) }));
  for (const id of Object.keys(PANES)) {
    const on = prefs.panes.includes(id);
    list.push({ title: `pane: ${on ? 'hide' : 'show'} ${PANES[id]}`, run: () => setPrefs({ panes: on ? prefs.panes.filter((p) => p !== id) : [...prefs.panes, id] }) });
  }
  list.push({ title: 'theme: system', run: () => setPrefs({ theme: 'system' }) });
  for (const [id, t] of Object.entries(THEMES)) list.push({ title: `theme: ${t.label}`, run: () => setPrefs({ theme: id }) });
  list.push(
    { title: 'font: JetBrains Mono', run: () => setPrefs({ font: 'mono' }) },
    { title: 'font: Hanken Grotesk', run: () => setPrefs({ font: 'sans' }) },
    { title: `layout: ${prefs.columns === 2 ? 'one column' : 'two columns'}`, run: () => setPrefs({ columns: prefs.columns === 2 ? 1 : 2 }) },
    { title: `layout: ${prefs.density === 'compact' ? 'comfortable' : 'compact'}`, run: () => setPrefs({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' }) },
    { title: `dates: ${prefs.dates === 'iso' ? 'march 2027' : '2027-03'}`, run: () => setPrefs({ dates: prefs.dates === 'iso' ? 'words' : 'iso' }) },
  );
  return list;
}

function jumpTo(id) {
  const pane = document.querySelector(`[data-pane="${id}"]`);
  if (!pane || pane.hidden) return;
  pane.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  pane.querySelector('input, select, button')?.focus({ preventScroll: true });
}

function renderHelp() {
  const names = { palette: 'commands', settings: 'settings', import: 'import', ask: 'ask claude', student: 'student mode', search: 'search transactions', help: 'this list' };
  $('#shortcuts').innerHTML = Object.entries(prefs.keys).filter(([, v]) => v)
    .map(([k, v]) => `<dt><kbd>${esc(keyLabel(v))}</kbd></dt><dd>${esc(names[k] || k)}</dd>`).join('') +
    '<dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>jump to a pane</dd><dt><kbd>esc</kbd></dt><dd>close a dialog</dd>';
}

const palette = createPalette($('#palette'), commands);

function bind() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (btn && ACTIONS[btn.dataset.cmd]) ACTIONS[btn.dataset.cmd](btn);
  });

  listen(() => prefs.keys, ACTIONS, (e) => {
    // number keys jump to panes, unless you're typing
    if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(input|textarea|select)$/i.test(document.activeElement?.tagName || '') && !document.querySelector('dialog[open]')) {
      const id = prefs.panes[Number(e.key) - 1];
      if (id) { e.preventDefault(); jumpTo(id); }
      return true;
    }
    return false;
  });

  document.querySelectorAll('input[name=strategy]').forEach((r) => r.addEventListener('change', () => {
    state.settings.strategy = r.value; persist(); renderPlan(); renderDebts(); renderNumbers();
  }));
  const setMoney = (key, value) => { state.settings[key] = value; persist(); renderPlan(); renderNumbers(); };
  $('#student-mode').addEventListener('change', (e) => setMoney('studentMode', e.target.checked));
  $('#extra-hours').addEventListener('input', (e) => setMoney('extraHours', Number(e.target.value)));
  $('#extra-monthly').addEventListener('input', (e) => setMoney('extraMonthly', Number(e.target.value)));
  $('#lump-amount').addEventListener('change', (e) => setMoney('lump', { ...state.settings.lump, amount: Number(e.target.value) || 0 }));
  $('#lump-month').addEventListener('change', (e) => setMoney('lump', { ...state.settings.lump, month: e.target.value }));
  document.querySelectorAll('[data-money]').forEach((i) => i.addEventListener('input', () => setMoney(i.dataset.money, Number(i.value) || 0)));

  $('#debt-rows').addEventListener('input', onDebtInput);
  $('#debt-rows').addEventListener('change', (e) => { if (e.target.type === 'checkbox') onDebtInput(e); });

  $('#window').addEventListener('change', renderFlow);
  $('#tx-search').addEventListener('input', () => { txShown = 60; renderTx(); });
  $('#tx-account').addEventListener('change', () => { txShown = 60; renderTx(); });
  $('#tx-category').addEventListener('change', () => { txShown = 60; renderTx(); });
  $('#tx-rows').addEventListener('change', (e) => {
    if (!e.target.matches('[data-tx-cat]')) return;
    const n = recategorize(state, e.target.closest('tr').dataset.tx, e.target.value);
    persist(); renderTx(); renderFlow(); renderNotes();
    toast(n > 1 ? `moved ${n} from this merchant to ${e.target.value}` : `set to ${e.target.value}`);
  });

  $('#import-file').addEventListener('change', (e) => handleImportFile(e.target.files[0]));
  $('#import-preview').addEventListener('change', onPreviewChange);
  $('#import-preview').addEventListener('input', (e) => { if (e.target.id === 'import-account' && pending) pending.account = e.target.value; });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); handleImportFile(e.dataTransfer.files[0]); });

  $('#settings-body').addEventListener('change', onSettingsInput);
  $('#settings-body').addEventListener('input', (e) => { if (e.target.type === 'range' || e.target.type === 'color') onSettingsInput(e); });
  $('#settings-body').addEventListener('keydown', (e) => { if (e.target.id === 'key-input' && e.key === 'Enter') { e.preventDefault(); saveKey(); } });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (prefs.theme === 'system') applyPrefs(); });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderPayoff(); renderFlow(); }, 150); });
}

async function boot() {
  await api.connect();
  const [savedState, savedPrefs] = await Promise.all([api.readFile('state'), api.readFile('settings')]);
  state = fromSaved(savedState);
  saveStatus = { text: savedState ? 'loaded' : 'not saved yet', bad: false };
  const r = resolve(savedPrefs || {});
  prefs = r.settings; prefWarnings = r.warnings;
  bind();
  applyPrefs();
}

boot();
