// Key bindings are stored as "mod+shift+h" or "ArrowRight". "mod" is ⌘ on macOS and Ctrl elsewhere.
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const MODIFIERS = new Set(['Meta', 'Control', 'Alt', 'Shift']);
const SYMBOLS = { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Space: '␣', Enter: '⏎' };

function normalizeKey(key) {
  if (MODIFIERS.has(key)) return null;
  if (key === ' ') return 'Space';
  if (key === '+') return '='; // ⌘+ and ⌘= are the same physical key
  return key.length === 1 ? key.toLowerCase() : key;
}

/** The binding a keyboard event represents, or null for a bare modifier. */
export function eventBinding(e) {
  const key = normalizeKey(e.key);
  if (!key) return null;
  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

/** A binding rendered for people: "⌘⇧H" on macOS, "Ctrl+Shift+H" elsewhere. */
export function formatBinding(binding) {
  if (!binding) return '';
  const parts = binding.split('+');
  const key = parts.pop();
  const has = (m) => parts.includes(m);
  const label = SYMBOLS[key] || (key.length === 1 ? key.toUpperCase() : key);
  if (IS_MAC) return `${has('mod') ? '⌘' : ''}${has('alt') ? '⌥' : ''}${has('shift') ? '⇧' : ''}${label}`;
  return [...(has('mod') ? ['Ctrl'] : []), ...(has('alt') ? ['Alt'] : []), ...(has('shift') ? ['Shift'] : []), label].join('+');
}

// Combinations the browser or the system takes before the page can see them. They differ per
// platform, so a binding that works on Windows can be swallowed on a Mac and the other way round.
// ⌘E is Chrome's "Use Selection for Find", but the page is offered the key first and may keep it,
// unlike the window and tab commands below, which never reach us.
const MAC_RESERVED = new Set(['mod+h', 'mod+q', 'mod+m', 'mod+w', 'mod+n', 'mod+t', 'mod+shift+h', 'mod+shift+n', 'mod+shift+t']);
const OTHER_RESERVED = new Set(['mod+n', 'mod+t', 'mod+w', 'mod+shift+n', 'mod+shift+t', 'mod+shift+w', 'mod+shift+q']);
export const isReserved = (binding) => (IS_MAC ? MAC_RESERVED : OTHER_RESERVED).has(binding);
