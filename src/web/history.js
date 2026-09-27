// History drawer: every document the daemon knows, newest first; click to open it right away.
import { historyApi } from './api.js';
import { state } from './state.js';
import { icons } from './icons.js';
import { toast } from './toast.js';
import { confirmDialog } from './dialog.js';

export function initHistory() {
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const list = document.getElementById('history-list');
  const count = document.getElementById('history-count');
  const filter = document.getElementById('history-filter');
  const toggle = document.getElementById('history-toggle');
  toggle.innerHTML = icons.library;
  document.getElementById('drawer-close').innerHTML = icons.close;
  let docs = [];
  let query = '';

  async function open() {
    drawer.hidden = false;
    backdrop.hidden = false;
    toggle.setAttribute('aria-pressed', 'true');
    await refresh();
    filter.focus();
  }
  function close() {
    drawer.hidden = true;
    backdrop.hidden = true;
    toggle.setAttribute('aria-pressed', 'false');
  }
  const isOpen = () => !drawer.hidden;

  async function refresh() {
    try {
      docs = (await historyApi.list()).docs;
    } catch (e) {
      list.innerHTML = `<div class="hist-empty">Cannot load history: ${e.message}</div>`;
      return;
    }
    render();
  }

  function render() {
    const q = query.trim().toLowerCase();
    const rows = docs.filter((d) => !q || `${d.title} ${d.path} ${d.latestSession} ${d.tags.join(' ')}`.toLowerCase().includes(q));
    count.textContent = docs.length;
    list.innerHTML = '';
    if (!docs.length) { list.innerHTML = '<div class="hist-empty">No documents yet.<br>Open one with <code>pdfpin open file.pdf</code>.</div>'; return; }
    if (!rows.length) { list.innerHTML = '<div class="hist-empty">Nothing matches.</div>'; return; }
    let group = '';
    rows.forEach((d, i) => {
      const g = bucket(d.openedAt);
      if (g !== group) { group = g; const h = document.createElement('div'); h.className = 'hist-group'; h.textContent = g; list.appendChild(h); }
      list.appendChild(row(d, i));
    });
  }

  function row(d, i) {
    const el = document.createElement('article');
    el.className = `hist${d.id === state.docId ? ' current' : ''}${d.exists ? '' : ' missing'}`;
    el.dataset.id = d.id;
    el.tabIndex = 0;
    el.style.animationDelay = `${Math.min(i, 10) * 25}ms`;
    el.title = d.exists ? d.path : `File not found: ${d.path}`;
    const notes = d.annotationCount ? `<span class="notes">${d.annotationCount} note${d.annotationCount > 1 ? 's' : ''}</span>` : '<span>no notes</span>';
    const tags = d.tags.slice(0, 4).map(() => '<span class="tag"></span>').join('');
    el.innerHTML = `
      <div class="hist-icon">${d.exists ? icons.file : icons.warn}</div>
      <div class="hist-main">
        <div class="hist-title"></div>
        <div class="hist-path"></div>
        <div class="hist-meta"><span>${d.pages} pages</span>${notes}<span>${relative(d.openedAt)}</span>${tags}</div>
        ${d.latestSession ? '<div class="hist-summary"></div>' : ''}
      </div>
      <div class="hist-actions">
        <button class="icon-btn act-reveal" title="Show in folder">${icons.folder}</button>
        <button class="icon-btn act-remove" title="Forget this document…">${icons.trash}</button>
      </div>`;
    el.querySelector('.hist-title').textContent = d.title;
    el.querySelector('.hist-path').textContent = shortPath(d.path);
    el.querySelectorAll('.hist-meta .tag').forEach((t, k) => { t.textContent = d.tags[k]; });
    if (d.latestSession) el.querySelector('.hist-summary').textContent = `${d.sessionCount > 1 ? `${d.sessionCount} sessions · latest: ` : ''}${d.latestSession}`;
    return el;
  }

  async function openDoc(d) {
    if (!d.exists) { toast(`File not found: ${d.path}`, { error: true }); return; }
    if (d.id === state.docId) { close(); return; }
    try { await historyApi.activate(d.id); } catch { /* opening still works without activation */ }
    location.href = `/view/${d.id}`;
  }

  list.addEventListener('click', async (e) => {
    const el = e.target.closest('.hist');
    if (!el) return;
    const d = docs.find((x) => x.id === el.dataset.id);
    if (!d) return;
    if (e.target.closest('.act-reveal')) {
      e.stopPropagation();
      try { const r = await historyApi.reveal(d.id); if (!r.launched) toast(d.path, { duration: 4000 }); } catch (err) { toast(err.message, { error: true }); }
      return;
    }
    if (e.target.closest('.act-remove')) {
      e.stopPropagation();
      await forget(d);
      return;
    }
    openDoc(d);
  });
  async function forget(d) {
    const n = d.annotationCount;
    const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const ok = await confirmDialog({
      title: 'Forget this document?',
      body: `<p><strong>${esc(d.title)}</strong></p>` +
        `<p>${n ? `Its <strong>${n} note${n > 1 ? 's' : ''}</strong> and highlights will be deleted.` : 'It has no notes.'} The PDF file itself stays where it is.</p>` +
        (n ? '<p class="muted">Tip: export first if you want to keep the notes (panel → download icon).</p>' : ''),
      confirmText: n ? `Delete ${n} note${n > 1 ? 's' : ''} and forget` : 'Forget',
      danger: true,
    });
    if (!ok) return;
    try {
      await historyApi.remove(d.id);
      toast(`Forgot “${d.title}”`, { duration: 2500 });
      if (d.id === state.docId) { location.href = '/'; return; }
      await refresh();
    } catch (err) { toast(err.message, { error: true }); }
  }

  list.addEventListener('keydown', (e) => {
    const el = e.target.closest('.hist');
    if (!el) return;
    const rows = [...list.querySelectorAll('.hist')];
    const i = rows.indexOf(el);
    if (e.key === 'Enter') { const d = docs.find((x) => x.id === el.dataset.id); if (d) openDoc(d); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); rows[Math.min(i + 1, rows.length - 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (i === 0) filter.focus(); else rows[i - 1]?.focus(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const d = docs.find((x) => x.id === el.dataset.id); if (d) forget(d); }
  });
  filter.addEventListener('input', () => { query = filter.value; render(); });
  filter.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') { const first = list.querySelector('.hist'); if (first) first.click(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('.hist')?.focus(); }
  });
  toggle.onclick = () => (isOpen() ? close() : open());
  backdrop.onclick = close;
  document.getElementById('drawer-close').onclick = close;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  return { open, close, isOpen, refresh };
}

/** Keep the tail of a long path: "…/lecture/binary/paper.pdf". */
function shortPath(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-3).join('/')}`;
}

function bucket(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Earlier';
  const now = new Date();
  const d = new Date(t);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now - t < 7 * 86400e3) return 'This week';
  return 'Earlier';
}

function relative(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}
