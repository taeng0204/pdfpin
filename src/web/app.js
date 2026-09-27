// pdfpin viewer bootstrap.
import { api, docApi as makeDocApi } from './api.js';
import { state, on, emit, savePref, setAnnotations, upsertAnnotation, dropAnnotation, select, setSessions, upsertSession, dropSession } from './state.js';
import { confirmDialog } from './dialog.js';
import { initViewer } from './viewer.js';
import { initHighlights } from './highlights.js';
import { initPanel } from './panel.js';
import { initSearch } from './search.js';
import { initSelection } from './selection.js';
import { initStrip } from './strip.js';
import { initKeys } from './keys.js';
import { initHistory } from './history.js';
import { connectEvents } from './sse.js';
import { toast } from './toast.js';
import { icons } from './icons.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const app = $('app');

function applyTheme() {
  root.dataset.theme = state.theme;
  root.classList.toggle('dim-pages', state.theme === 'dark' && state.dim);
  $('theme-toggle').innerHTML = state.theme === 'dark' ? icons.sun : icons.moon;
  $('dim-row').hidden = state.theme !== 'dark';
  $('dim-toggle').checked = state.dim;
}
function applyPanel() {
  app.classList.toggle('panel-closed', !state.panelOpen);
  $('panel-toggle').setAttribute('aria-pressed', state.panelOpen);
}

async function boot() {
  const m = location.pathname.match(/^\/view\/([^/]+)/);
  let doc;
  try {
    const r = m ? await api('GET', `/api/docs/${m[1]}`) : await api('GET', '/api/docs/current');
    doc = r.doc;
  } catch (e) {
    $('loading-text').textContent = e.status === 404 ? 'No document is open. Pick one from the history, or run `pdfpin open <file.pdf>` in a terminal.' : `Cannot load document: ${e.message}`;
    $('doc-title').textContent = 'pdfpin';
    applyTheme();
    applyPanel();
    $('panel-toggle').innerHTML = icons.panel;
    const history = initHistory();
    if (e.status === 404) history.open();
    return;
  }
  if (!m) history.replaceState(null, '', `/view/${doc.id}`);
  state.docId = doc.id;
  state.doc = doc;
  document.title = `${doc.title} · pdfpin`;
  $('doc-title').textContent = doc.title;
  $('doc-title').title = doc.path;
  $('page-count').textContent = doc.pages;

  applyTheme();
  applyPanel();
  const docApi = makeDocApi(doc.id);

  // icons
  $('zoom-out').innerHTML = icons.minus; $('zoom-in').innerHTML = icons.plus;
  $('panel-toggle').innerHTML = icons.panel;
  $('fit-toggle').innerHTML = state.zoomMode === 'fit-page' ? icons.fitWidth : icons.fitPage;

  const viewer = await initViewer({ viewerEl: $('viewer'), pagesEl: $('pages'), fileUrl: doc.fileUrl });
  $('loading').hidden = true;
  const highlights = initHighlights(viewer, docApi);
  const panel = initPanel({ docApi, viewer, highlights });
  highlights.setActions({ edit: panel.edit, remove: panel.removeWithUndo });
  const search = initSearch({ viewer, highlights });
  initSelection({ viewer, docApi });
  initStrip({ viewer });

  const history = initHistory();
  const ui = {
    toggleHistory() { history.isOpen() ? history.close() : history.open(); },
    togglePanel() { state.panelOpen = !state.panelOpen; savePref('panel', state.panelOpen); applyPanel(); },
    toggleTheme() { state.theme = state.theme === 'dark' ? 'light' : 'dark'; savePref('theme', state.theme); applyTheme(); },
    toggleHighlights() { app.classList.toggle('hide-highlights'); },
  };
  initKeys({ viewer, search, ui });

  // top bar wiring
  $('theme-toggle').onclick = ui.toggleTheme;
  $('panel-toggle').onclick = ui.togglePanel;
  $('dim-toggle').onchange = (e) => { state.dim = e.target.checked; savePref('dim', state.dim); applyTheme(); };
  $('zoom-in').onclick = () => viewer.zoomStep(1);
  $('zoom-out').onclick = () => viewer.zoomStep(-1);
  $('zoom-label').onclick = () => viewer.setZoom('fit-width');
  $('fit-toggle').onclick = () => {
    const next = state.zoomMode === 'fit-page' ? 'fit-width' : 'fit-page';
    viewer.setZoom(next);
    $('fit-toggle').innerHTML = next === 'fit-page' ? icons.fitWidth : icons.fitPage;
  };
  on('scale', (s) => { $('zoom-label').textContent = `${Math.round(s * 100)}%`; search.redraw(); });
  on('page', (p) => { if (document.activeElement !== $('page-input')) $('page-input').value = p; });
  $('page-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const n = Number(e.target.value); if (n >= 1 && n <= doc.pages) viewer.scrollToPage(n); e.target.blur(); }
    if (e.key === 'Escape') e.target.blur();
    e.stopPropagation();
  });
  $('page-input').addEventListener('focus', (e) => e.target.select());
  $('page-input').addEventListener('blur', () => { $('page-input').value = state.currentPage; });

  // sessions + annotations (older sessions start folded; the latest stays open)
  setSessions(doc.sessions || [], doc.currentSessionId);
  for (const s of state.sessions.slice(0, -1)) state.collapsed.add(s.id);
  setAnnotations(doc.annotations);
  await highlights.renderAll();
  panel.renderAll();

  // live events
  let addBuffer = [];
  let addTimer = null;
  const flushAdds = () => {
    const list = addBuffer.filter((a) => a.source !== 'user');
    addBuffer = [];
    if (!list.length) return;
    const pages = [...new Set(list.map((a) => a.page))].sort((a, b) => a - b);
    const where = pages.length > 4 ? `p.${pages[0]}–${pages[pages.length - 1]}` : pages.map((p) => `p.${p}`).join(', ');
    const s = list[0].sessionId ? state.sessions.find((x) => x.id === list[0].sessionId) : null;
    const label = `${list.length === 1 ? 'New highlight' : `${list.length} new highlights`} · ${where}${s?.title ? ` · ${s.title.slice(0, 40)}` : ''}`;
    toast(label, { color: list[0].color, action: 'Show', onAction: () => select(list[0].id, { from: 'toast' }) });
  };
  const resync = async () => {
    try {
      const r = await docApi.get();
      state.doc = r.doc;
      setSessions(r.doc.sessions || [], r.doc.currentSessionId);
      setAnnotations(r.doc.annotations);
      await highlights.renderAll();
    } catch (e) { console.error('resync', e); }
  };
  connectEvents(doc.id, {
    'annotation.added': ({ annotation }) => {
      upsertAnnotation(annotation, { fresh: true });
      addBuffer.push(annotation);
      clearTimeout(addTimer);
      addTimer = setTimeout(flushAdds, 500);
    },
    'annotation.updated': ({ annotation }) => {
      const prev = state.annotations.get(annotation.id);
      if (prev && prev.rectsSource === 'dom' && annotation.rectsSource !== 'dom') annotation.rects = prev.rects;
      upsertAnnotation(annotation);
    },
    'annotation.removed': ({ id }) => dropAnnotation(id),
    'annotations.cleared': () => resync(),
    'session.added': ({ session }) => {
      // a new interaction: fold the older ones so the latest reads like the top of a history
      for (const s of state.sessions) state.collapsed.add(s.id);
      state.collapsed.delete(session.id);
      state.currentSessionId = session.id;
      upsertSession(session);
      toast(`New session: ${session.title || 'untitled'}`, { duration: 4000 });
    },
    'session.updated': ({ session }) => upsertSession(session),
    'session.removed': ({ id, currentSessionId }) => { state.currentSessionId = currentSessionId ?? null; dropSession(id); },
    'session.current': ({ currentSessionId }) => { state.currentSessionId = currentSessionId; emit('sessions'); },
    focus: ({ annotationId, page, sessionId }) => {
      if (sessionId) { state.collapsed.delete(sessionId); emit('sessions'); }
      if (annotationId) select(annotationId, { from: 'agent' });
      else if (page) viewer.scrollToPage(page);
      if (!document.hasFocus()) window.focus?.();
    },
    'doc.reloaded': () => { toast('The PDF changed on disk — reloading', { duration: 1500 }); setTimeout(() => location.reload(), 600); },
    'doc.removed': () => { toast('This document was removed from pdfpin', { duration: 2500 }); setTimeout(() => { location.href = '/'; }, 800); },
    'docs.changed': () => { if (history.isOpen()) history.refresh(); },
    resync,
  }, (s) => { const c = $('conn'); c.dataset.state = s; c.title = { open: 'Live: connected', connecting: 'Connecting…', error: 'Disconnected' }[s]; });

  // hash deep link: #a_xxx or #p3
  const h = location.hash.slice(1);
  if (h.startsWith('a_') && state.annotations.has(h)) setTimeout(() => select(h, { from: 'link' }), 300);
  else if (/^p\d+$/.test(h)) setTimeout(() => viewer.scrollToPage(Number(h.slice(1))), 300);
}

boot().catch((e) => { console.error(e); $('loading-text').textContent = `Failed: ${e.message}`; });
