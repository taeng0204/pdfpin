// Keyboard shortcuts.
import { state, select, visibleAnnotations } from './state.js';

export function initKeys({ viewer, search, ui }) {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); search.open(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); viewer.zoomStep(1); return; }
    if (mod && e.key === '-') { e.preventDefault(); viewer.zoomStep(-1); return; }
    if (mod && e.key === '0') { e.preventDefault(); viewer.setZoom('fit-width'); return; }
    if (typing || mod || e.altKey) return;
    switch (e.key) {
      case 'n': case 'j': step(1); break;
      case 'p': case 'k': step(-1); break;
      case 't': ui.togglePanel(); break;
      case 'd': ui.toggleTheme(); break;
      case 'h': ui.toggleHighlights(); break;
      case '[': viewer.scrollToPage(Math.max(1, state.currentPage - 1)); break;
      case ']': viewer.scrollToPage(Math.min(viewer.pages.length, state.currentPage + 1)); break;
      case '/': e.preventDefault(); search.open(); break;
      case 'Escape': select(null); break;
      default: return;
    }
  });
  function step(dir) {
    const list = visibleAnnotations();
    if (!list.length) return;
    const i = list.findIndex((a) => a.id === state.selectedId);
    const next = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    select(list[next].id, { from: 'keys' });
  }
}
