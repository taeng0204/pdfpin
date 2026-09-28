// The viewer's own page, loaded into jsdom, so a module under test finds the elements it expects
// instead of a hand-written stand-in that can drift away from the real markup.
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const GLOBALS = [
  'window', 'document', 'localStorage', 'sessionStorage', 'Node', 'Element', 'HTMLElement',
  'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMParser', 'MutationObserver',
  'DocumentFragment', 'Range', 'NodeFilter',
];

/**
 * Put the viewer's page in place and expose its globals. Call this before importing any module
 * under src/web: several of them read the document or localStorage as they load.
 */
export function loadViewerDom() {
  const html = fs.readFileSync(new URL('../../src/web/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:47831/view/0123456789', pretendToBeVisual: true });
  for (const key of GLOBALS) {
    if (dom.window[key] === undefined) continue;
    try { globalThis[key] = dom.window[key]; } catch { /* node owns a few of these; its own will do */ }
  }
  return dom;
}

/** A docApi that records what the panel asked for and never touches a daemon. */
export function recordingApi(overrides = {}) {
  const calls = [];
  const record = (name) => async (...args) => { calls.push({ name, args }); return overrides[name]?.(...args); };
  return {
    calls,
    add: record('add'),
    update: record('update'),
    remove: record('remove'),
    updateSession: record('updateSession'),
    removeSession: record('removeSession'),
    archiveSession: record('archiveSession'),
    setColors: record('setColors'),
    export: record('export'),
  };
}

/** Enough of the viewer and the highlight layer for the panel to talk to. */
export const stubViewer = () => ({
  scrollToRect() {},
  scrollToPage() {},
  pagesEl: document.getElementById('pages'),
});

export const stubHighlights = () => ({
  pulse() {},
  flashSession() {},
  async rectsFor() { return []; },
});

export const annotation = (over = {}) => ({
  id: 'a1', page: 1, quote: 'a quoted sentence', note: 'why it matters', title: '',
  color: 'yellow', colorAuto: true, tag: '', sessionId: null, source: 'agent',
  anchor: { startItem: 0, startChar: 0, endItem: 0, endChar: 9 }, rects: [], ...over,
});

export const session = (over = {}) => ({
  id: 's1', title: 'A question', flow: 'An overview', color: 'yellow',
  createdAt: '2026-09-28T00:00:00.000Z', archived: false, ...over,
});
