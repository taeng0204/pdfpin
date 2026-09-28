// Keyboard handling. Every configurable action comes from settings.keys; a few basics are fixed.
import { state, select, visibleAnnotations } from './state.js';
import { eventBinding } from './shortcuts.js';

export function initKeys({ viewer, search, ui }) {
  // One page per press, with its own target so repeated presses do not fight the smooth scroll.
  let target = null;
  let targetTimer = null;
  function stepPage(delta) {
    const base = target ?? state.currentPage;
    const next = Math.min(viewer.pages.length, Math.max(1, base + delta));
    target = next;
    clearTimeout(targetTimer);
    targetTimer = setTimeout(() => { target = null; }, 600);
    viewer.scrollToPage(next);
  }

  function stepHighlight(dir) {
    const list = visibleAnnotations();
    if (!list.length) return;
    const i = list.findIndex((a) => a.id === state.selectedId);
    const next = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    select(list[next].id, { from: 'keys' });
  }

  const actions = {
    documents: () => ui.toggleDocuments(),
    history: () => ui.toggleHistory(),
    settings: () => ui.openSettings(),
    search: () => search.open(),
    zoomIn: () => viewer.zoomStep(1),
    zoomOut: () => viewer.zoomStep(-1),
    zoomReset: () => viewer.setZoom('fit-width'),
    nextPage: () => stepPage(1),
    prevPage: () => stepPage(-1),
    nextHighlight: () => stepHighlight(1),
    prevHighlight: () => stepHighlight(-1),
    theme: () => ui.toggleTheme(),
    toggleHighlights: () => ui.toggleHighlights(),
  };
  const FIXED = { '/': () => search.open(), ']': () => stepPage(1), '[': () => stepPage(-1), Escape: () => select(null) };

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const binding = eventBinding(e);
    if (!binding) return;
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const bindings = state.settings?.keys ?? {};
    const action = Object.keys(actions).find((a) => bindings[a] === binding);
    const needsModifier = binding.startsWith('mod');
    if (action && (!typing || needsModifier)) { e.preventDefault(); actions[action](); return; }
    if (typing || needsModifier || e.altKey) return;
    if (FIXED[binding]) { e.preventDefault(); FIXED[binding](); }
  });
}
