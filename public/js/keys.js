// keys.js — keyboard shortcuts. A binding is one key ("i", "/", "?") or one chord
// ("mod+k", "alt+s"). Sequences like "g d" aren't supported, on purpose: one chord or
// one key keeps it predictable. "mod" is ⌘ on macOS and ctrl everywhere else.

const IS_MAC = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

export function parse(binding) {
  const parts = String(binding).toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() || '';
  return { key, mod: parts.includes('mod'), ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift') };
}

export function matches(binding, e) {
  const b = parse(binding);
  const modDown = IS_MAC ? e.metaKey : e.ctrlKey;
  if (b.mod !== modDown) return false;
  if (!b.mod && (e.metaKey || e.ctrlKey) !== b.ctrl) return false;
  if (b.alt !== e.altKey) return false;
  // shift is implied by characters like ? and >, so only check it when asked for
  if (b.shift && !e.shiftKey) return false;
  return e.key.toLowerCase() === b.key;
}

/** Human label: "mod+k" → "⌘K" on mac, "Ctrl+K" elsewhere. */
export function label(binding) {
  const b = parse(binding);
  const mods = [b.mod && (IS_MAC ? '⌘' : 'Ctrl+'), b.ctrl && 'Ctrl+', b.alt && (IS_MAC ? '⌥' : 'Alt+'), b.shift && (IS_MAC ? '⇧' : 'Shift+')].filter(Boolean).join('');
  return mods + (b.key.length === 1 ? b.key.toUpperCase() : b.key);
}

const typing = (el) => el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));

/**
 * Listens for shortcuts. `bindings` is { name: 'mod+k' }, `actions` is { name: fn }.
 * Plain keys are ignored while you type in a field; chords with mod always work.
 */
export function listen(getBindings, actions, extra = () => false) {
  document.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (extra(e)) return;
    for (const [name, binding] of Object.entries(getBindings())) {
      if (!actions[name] || !matches(binding, e)) continue;
      if (!parse(binding).mod && typing(document.activeElement)) return;
      if (document.querySelector('dialog[open]') && name !== 'palette') return;
      e.preventDefault();
      actions[name]();
      return;
    }
  });
}
