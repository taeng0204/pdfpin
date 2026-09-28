// pdfpin viewer bootstrap.
import { api, docApi as makeDocApi } from './api.js';
import { state, on, emit, savePref, setAnnotations, upsertAnnotation, dropAnnotation, select, setSessions, upsertSession, dropSession } from './state.js';
import { confirmDialog } from './dialog.js';
import { initViewer, mark } from './viewer.js';
import { initHighlights } from './highlights.js';
import { initPanel } from './panel.js';
import { initSearch } from './search.js';
import { initSelection } from './selection.js';
import { initStrip } from './strip.js';
import { initKeys } from './keys.js';
import { initHistory } from './history.js';
import { openSettings } from './settings-ui.js';
import { t, setLanguage } from './i18n.js';
import { formatBinding } from './shortcuts.js';
import { connectEvents } from './sse.js';
import { toast } from './toast.js';
import { icons } from './icons.js';

const $ = (id) => document.getElementById(id);
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const keyFor = (action) => formatBinding(state.settings?.keys?.[action]);
const root = document.documentElement;
const app = $('app');

function applyTheme() {
  const wanted = state.settings?.theme ?? 'system';
  state.theme = wanted === 'system' ? (darkQuery.matches ? 'dark' : 'light') : wanted;
  state.dim = state.settings?.dimPages ?? true;
  root.dataset.theme = state.theme;
  root.classList.toggle('dim-pages', state.theme === 'dark' && state.dim);
  $('theme-toggle').innerHTML = state.theme === 'dark' ? icons.sun : icons.moon;
  $('dim-row').hidden = state.theme !== 'dark';
  $('dim-toggle').checked = state.dim;
}
darkQuery.addEventListener('change', () => { if ((state.settings?.theme ?? 'system') === 'system') applyTheme(); });

/** Labels that live in the shell rather than in a rendered list. */
function applyStrings() {
  const set = (id, attr, value) => { const el = $(id); if (el) el[attr] = value; };
  document.title = state.doc ? `${state.doc.title} · pdfpin` : 'pdfpin';
  set('loading-text', 'textContent', $('loading').hidden ? '' : t('app.loading'));
  set('search-input', 'placeholder', t('top.searchPlaceholder'));
  set('filter-input', 'placeholder', t('panel.filter'));
  set('history-filter', 'placeholder', t('docs.filter'));
  set('search-open', 'title', t('top.search', { key: keyFor('search') }));
  set('search-prev', 'title', t('top.prev'));
  set('search-next', 'title', t('top.next'));
  set('search-close', 'title', t('top.close'));
  set('zoom-in', 'title', t('top.zoomIn', { key: keyFor('zoomIn') }));
  set('zoom-out', 'title', t('top.zoomOut', { key: keyFor('zoomOut') }));
  set('zoom-label', 'title', t('top.zoomReset', { key: keyFor('zoomReset') }));
  set('fit-toggle', 'title', t('top.fit'));
  set('theme-toggle', 'title', t('top.theme', { key: keyFor('theme') }));
  set('settings-toggle', 'title', t('top.settings', { key: keyFor('settings') }));
  set('history-toggle', 'title', t('top.documents', { key: keyFor('documents') }));
  set('panel-toggle', 'title', t('top.history', { key: keyFor('history') }));
  set('drawer-close', 'title', t('top.close'));
  set('export-btn', 'title', t('panel.export'));
  set('tags-btn', 'title', t('tags.manage'));
  set('archive-btn', 'title', t('archive.manage'));
  set('strip', 'title', t('top.strip'));
  set('copy-all-btn', 'title', t('panel.copyAll'));
  set('page-input', 'ariaLabel', t('top.currentPage'));
  const brand = document.querySelector('.brand');
  if (brand) brand.title = t('top.home');
  const heads = document.querySelectorAll('.panel-heading');
  if (heads[0]) heads[0].textContent = t('panel.heading');
  const drawerHead = document.querySelector('#drawer .panel-heading');
  if (drawerHead) drawerHead.textContent = t('docs.heading');
  const dimLabel = document.querySelector('#dim-row span');
  if (dimLabel) dimLabel.textContent = t('panel.dimPages');
  const hint = document.querySelector('.panel-foot .hint');
  if (hint) hint.textContent = t('panel.hint', { prev: keyFor('prevHighlight'), next: keyFor('nextHighlight') });
  const foot = document.querySelector('.drawer-foot');
  if (foot) foot.innerHTML = t('docs.foot');
  const menu = $('export-menu');
  if (menu) menu.innerHTML = `<button data-format="pdf">${t('export.pdf')} <small>${t('export.pdfHint')}</small></button><button data-format="md">${t('export.md')} <small>${t('export.mdHint')}</small></button>`;
  emit('strings');
}
function applyPanel() {
  app.classList.toggle('panel-closed', !state.panelOpen);
  $('panel-toggle').setAttribute('aria-pressed', state.panelOpen);
}

async function boot() {
  mark('boot');
  try {
    state.settings = (await api('GET', '/api/settings')).settings;
  } catch {
    state.settings = null; // the daemon answered oddly; fall back to built-in defaults
  }
  setLanguage(state.settings?.language);
  state.zoomMode = state.settings?.zoom ?? 'fit-width';
  const m = location.pathname.match(/^\/view\/([^/]+)/);
  let doc;
  try {
    const r = m ? await api('GET', `/api/docs/${m[1]}`) : await api('GET', '/api/docs/current');
    doc = r.doc;
  } catch (e) {
    $('loading-text').textContent = e.status === 404 ? t('app.noDocument') : t('app.loadFailed', { message: e.message });
    $('doc-title').textContent = 'pdfpin';
    applyTheme();
    applyPanel();
    $('panel-toggle').innerHTML = icons.panel;
    $('settings-toggle').innerHTML = icons.settings;
    $('settings-toggle').onclick = openSettings;
    const documents = initHistory();
    applyStrings();
    if (e.status === 404) documents.open();
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
  $('settings-toggle').innerHTML = icons.settings;
  $('fit-toggle').innerHTML = state.zoomMode === 'fit-page' ? icons.fitWidth : icons.fitPage;

  const viewer = await initViewer({ viewerEl: $('viewer'), pagesEl: $('pages'), fileUrl: doc.fileUrl });
  $('loading').hidden = true;
  const highlights = initHighlights(viewer, docApi);
  const panel = initPanel({ docApi, viewer, highlights });
  highlights.setActions({ edit: panel.edit, remove: panel.removeWithUndo });
  const search = initSearch({ viewer, highlights });
  initSelection({ viewer, docApi });
  initStrip({ viewer });

  const documents = initHistory();
  /** Apply locally, then persist. Waiting on the daemon first would make the theme feel laggy. */
  const saveSettings = async (patch) => {
    const previous = state.settings;
    state.settings = { ...state.settings, ...patch };
    applySettings();
    try {
      state.settings = (await api('PATCH', '/api/settings', patch)).settings;
    } catch (e) {
      state.settings = previous;
      applySettings();
      toast(t('settings.saveFailed', { message: e.message }), { error: true });
    }
  };
  const ui = {
    toggleDocuments() { documents.isOpen() ? documents.close() : documents.open(); },
    toggleHistory() { state.panelOpen = !state.panelOpen; savePref('panel', state.panelOpen); applyPanel(); },
    toggleTheme() { saveSettings({ theme: state.theme === 'dark' ? 'light' : 'dark' }); },
    toggleHighlights() { app.classList.toggle('hide-highlights'); },
    openSettings,
  };
  let applied = null;
  function applySettings() {
    const s = state.settings;
    const listChanged = !applied || applied.language !== s?.language || applied.colorBy !== s?.colorBy;
    applied = s ? { language: s.language, colorBy: s.colorBy } : null;
    setLanguage(s?.language);
    applyTheme();
    applyStrings();
    if (listChanged) panel.renderAll();
  }
  on('settings', applySettings);
  initKeys({ viewer, search, ui });

  // top bar wiring
  $('theme-toggle').onclick = ui.toggleTheme;
  $('panel-toggle').onclick = ui.toggleHistory;
  $('settings-toggle').onclick = openSettings;
  $('dim-toggle').onchange = (e) => saveSettings({ dimPages: e.target.checked });
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

  mark('ready');
  // sessions + annotations (older sessions start folded; the latest stays open)
  applyStrings();
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
    const label = list.length === 1 ? t('toast.newHighlight', { where }) : t('toast.newHighlights', { n: list.length, where });
    toast(`${label}${s?.title ? ` · ${s.title.slice(0, 40)}` : ''}`, { color: list[0].color, action: t('toast.show'), onAction: () => select(list[0].id, { from: 'toast' }) });
  };
  const daemonPid = (await api('GET', '/api/health').catch(() => ({}))).pid;
  const resync = async () => {
    try {
      const h = await api('GET', '/api/health').catch(() => null);
      if (h && daemonPid && h.pid !== daemonPid) { location.reload(); return; } // daemon restarted: pick up new code
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
    'annotations.recolored': async ({ annotations }) => { setAnnotations(annotations); await highlights.renderAll(); },
    'colors.changed': () => resync(),
    'session.added': ({ session }) => {
      // a new interaction: fold the older ones so the latest reads like the top of a history
      for (const s of state.sessions) state.collapsed.add(s.id);
      state.collapsed.delete(session.id);
      state.currentSessionId = session.id;
      upsertSession(session);
      toast(t('session.new', { title: session.title || t('session.untitled') }), { duration: 4000 });
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
    'doc.reloaded': () => { toast(t('docs.reloading'), { duration: 1500 }); setTimeout(() => location.reload(), 600); },
    'doc.removed': () => { toast(t('docs.removed'), { duration: 2500 }); setTimeout(() => { location.href = '/'; }, 800); },
    'docs.changed': () => { if (documents.isOpen()) documents.refresh(); },
    'settings.changed': ({ settings }) => { state.settings = settings; applySettings(); },
    resync,
  }, (s) => { const c = $('conn'); c.dataset.state = s; c.title = t(`conn.${s}`); });

  // hash deep link: #a_xxx or #p3
  const h = location.hash.slice(1);
  if (h.startsWith('a_') && state.annotations.has(h)) setTimeout(() => select(h, { from: 'link' }), 300);
  else if (/^p\d+$/.test(h)) setTimeout(() => viewer.scrollToPage(Number(h.slice(1))), 300);
}

boot().catch((e) => { console.error(e); $('loading-text').textContent = t('app.failed', { message: e.message }); });
