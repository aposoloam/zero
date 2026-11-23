// charts.js — two small hand-drawn SVG charts. No chart library, so no third-party
// script ever runs next to your numbers. Colors come from CSS classes in zero.css.

import { money, monthName, monthsBetween } from './format.js';
import { addMonths } from './payoff.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

/** Tidy y-axis ticks: about `ticks` steps of 1, 2, 2.5 or 5 × a power of ten. 4,163 → step 1,000, max 5,000. */
function niceScale(v, ticks = 4) {
  if (v <= 0) return { max: 100, step: 25 };
  const raw = v / ticks;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [0.5, 1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => v / m <= ticks + 1);
  return { max: Math.ceil(v / step) * step, step };
}

/**
 * The hero chart: total balance over time for this plan and for minimums only.
 * @param {HTMLElement} box
 * @param {Object} o { start, startTotal, plan, base, promos: [{ ym, name }], showMin, animate, label, onHover }
 */
export function payoffChart(box, o) {
  const W = box.clientWidth || 800, H = box.clientHeight || 300;
  const pad = { t: 12, r: 16, b: 28, l: 56 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  // x runs from today to a bit past the plan's last month (never shorter than a year)
  const planPts = [{ ym: o.start, total: o.startTotal }, ...o.plan.months.map((m) => ({ ym: m.ym, total: m.total }))];
  const span = Math.max(12, Math.ceil((planPts.length - 1) * 1.6));
  const basePts = [{ ym: o.start, total: o.startTotal }, ...o.base.months.slice(0, span).map((m) => ({ ym: m.ym, total: m.total }))];
  const { max: yMax, step } = niceScale(Math.max(o.startTotal, ...planPts.map((p) => p.total), ...(o.showMin !== false ? basePts.map((p) => p.total) : [])));
  const x = (i) => pad.l + (i / span) * iw;
  const y = (v) => pad.t + ih - (v / yMax) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label });
  const grid = el('g', { class: 'grid' }, svg);
  const axis = el('g', { class: 'axis' }, svg);
  for (let v = 0; v <= yMax + 0.01; v += step) {
    el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, grid);
    el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, axis).textContent = money(v);
  }
  // label as many months as fit at ~64px apart, on a step that reads naturally
  const fit = Math.max(1, Math.floor(iw / 76));
  const every = [1, 2, 3, 6, 12, 24, 60].find((s) => span / s <= fit) || 120;
  for (let i = 0; i <= span; i += every) {
    const ym = addMonths(o.start, i);
    el('text', { x: x(i), y: H - 6, 'text-anchor': i === span ? 'end' : 'middle' }, axis).textContent = monthName(ym, true);
  }

  // promo deadlines: a red pencil tick where a 0% rate runs out
  for (const p of o.promos) {
    const i = monthsBetween(o.start, p.ym);
    if (i <= 0 || i > span) continue;
    const g = el('g', { class: 'promo' }, svg);
    el('line', { x1: x(i), x2: x(i), y1: pad.t, y2: pad.t + ih }, g);
    el('text', { x: x(i) + 5, y: pad.t + 12 }, g).textContent = `${p.name} 0% ends`;
  }

  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join('');
  if (o.showMin !== false) el('path', { class: 'line-min', d: path(basePts) }, svg);
  el('path', { class: 'area-plan', d: `${path(planPts)}L${x(planPts.length - 1)},${y(0)}L${x(0)},${y(0)}Z` }, svg);
  const line = el('path', { class: 'line-plan', d: path(planPts) }, svg);

  const done = o.plan.debtFree;
  let dot;
  if (done) dot = el('circle', { class: 'zero-dot', cx: x(planPts.length - 1), cy: y(0), r: 5 }, svg);

  // hover / touch readout
  const cursor = el('g', { class: 'cursor', visibility: 'hidden' }, svg);
  const cl = el('line', { y1: pad.t, y2: pad.t + ih }, cursor);
  const cc = el('circle', { r: 3.5 }, cursor);
  const hit = el('rect', { x: pad.l, y: pad.t, width: iw, height: ih, fill: 'transparent' }, svg);
  const move = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(planPts.length - 1, Math.round(((px - pad.l) / iw) * span)));
    cl.setAttribute('x1', x(i)); cl.setAttribute('x2', x(i));
    cc.setAttribute('cx', x(i)); cc.setAttribute('cy', y(planPts[i].total));
    cursor.setAttribute('visibility', 'visible');
    o.onHover?.(planPts[i], basePts[i]);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { cursor.setAttribute('visibility', 'hidden'); o.onHover?.(null); });

  box.replaceChildren(svg);

  // the one orchestrated moment: the line inks itself in on first load
  if (o.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const len = line.getTotalLength();
    line.style.setProperty('--len', len);
    line.classList.add('draw');
    if (dot) { dot.style.opacity = 0; setTimeout(() => { dot.style.transition = 'opacity .3s'; dot.style.opacity = 1; }, 1500); }
  }
}

/** Monthly bars: money in (ink) beside money out (red pencil). */
export function flowChart(box, months) {
  const W = box.clientWidth || 500, H = box.clientHeight || 220;
  const pad = { t: 8, r: 4, b: 24, l: 52 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const data = months.slice(-8);
  if (!data.length) { box.innerHTML = '<p class="empty">import transactions to see this.</p>'; return; }
  const { max: yMax, step } = niceScale(Math.max(...data.flatMap((m) => [m.in, m.out])), 3);
  const y = (v) => pad.t + ih - (Math.max(0, v) / yMax) * ih;
  const slot = iw / data.length, bw = Math.min(18, slot / 3);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': data.map((m) => `${monthName(m.ym)}: ${money(m.in)} in, ${money(m.out)} out`).join('; ') });
  const grid = el('g', { class: 'grid' }, svg), axis = el('g', { class: 'axis' }, svg);
  for (let v = 0; v <= yMax + 0.01; v += step) {
    el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, grid);
    el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, axis).textContent = money(v);
  }
  data.forEach((m, i) => {
    const cx = pad.l + slot * i + slot / 2;
    el('rect', { class: 'bar-in', x: cx - bw - 1, y: y(m.in), width: bw, height: pad.t + ih - y(m.in), rx: 1.5 }, svg)
      .appendChild(el('title')).textContent = `in ${money(m.in)}`;
    el('rect', { class: 'bar-out', x: cx + 1, y: y(m.out), width: bw, height: pad.t + ih - y(m.out), rx: 1.5 }, svg)
      .appendChild(el('title')).textContent = `out ${money(m.out)}`;
    el('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }, axis).textContent = monthName(m.ym, true);
  });
  box.replaceChildren(svg);
}
