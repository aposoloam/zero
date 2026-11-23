// palette.js — the command palette. Every action in the app is a command:
//   { id, title, hint?, run() }
// Typing filters by fuzzy match (letters in order, closer together ranks higher).

import { esc } from './format.js';

export function score(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, ''), t = text.toLowerCase();
  if (!q) return 1;
  let ti = 0, s = 0, last = -1;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i === -1) return 0;
    s += i === last + 1 ? 3 : 1;        // consecutive letters score higher
    if (i === 0 || t[i - 1] === ' ' || t[i - 1] === ':') s += 2; // word starts too
    last = i; ti = i + 1;
  }
  return s;
}

export function createPalette(dialog, getCommands) {
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('ol');
  let shown = [], active = 0;

  function render() {
    const q = input.value.trim();
    shown = getCommands()
      .map((c) => ({ c, s: score(q, `${c.title} ${c.hint || ''}`) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((c, i) => `
      <li id="cmd-${i}" role="option" aria-selected="${i === active}" data-i="${i}">
        <span>${esc(c.title)}</span>${c.hint ? `<kbd>${esc(c.hint)}</kbd>` : ''}
      </li>`).join('') || '<li class="none">no command matches</li>';
    input.setAttribute('aria-activedescendant', shown.length ? `cmd-${active}` : '');
    list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }

  function run(i) {
    const cmd = shown[i];
    if (!cmd) return;
    dialog.close();
    cmd.run();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = (active + 1) % Math.max(1, shown.length); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + shown.length) % Math.max(1, shown.length); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { run(active); e.preventDefault(); }
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) run(Number(li.dataset.i)); });

  return {
    open(prefill = '') {
      input.value = prefill;
      active = 0;
      render();
      dialog.showModal();
      input.focus();
    },
  };
}
