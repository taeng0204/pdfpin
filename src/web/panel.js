// Side panel: the document's history of sessions (newest first), each with its overview and its
// highlights grouped by tag/colour; plus the reader's own highlights. Filters, inline editing, export.
import { state, on, emit, select, visibleAnnotations, orderedAnnotations, sessionOf, hasFilter, COLORS } from './state.js';
import { renderMarkdown } from './markdown.js';
import { icons } from './icons.js';
import { toast } from './toast.js';
import { confirmDialog } from './dialog.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initPanel({ docApi, viewer, highlights }) {
  const cardsEl = document.getElementById('cards');
  const countEl = document.getElementById('ann-count');
  const chipsEl = document.getElementById('tag-chips');
  const colorEl = document.getElementById('color-filter');
  const filterInput = document.getElementById('filter-input');
  document.getElementById('summary')?.remove();
  let editingId = null;        // annotation being edited
  let editingSession = null;   // session being edited

  // ---------- filters ----------
  const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
  function renderFilters() {
    const all = orderedAnnotations();
    const tags = [...new Set(all.map((a) => a.tag || ''))].filter(Boolean).sort();
    chipsEl.innerHTML = '';
    if (tags.length > 1 || state.filter.tags.size) {
      for (const t of tags) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = `#${t}`;
        b.setAttribute('aria-pressed', state.filter.tags.has(t));
        b.onclick = () => { toggle(state.filter.tags, t); renderAll(); emit('filter'); };
        chipsEl.appendChild(b);
      }
    }
    const colors = COLORS.filter((c) => all.some((a) => a.color === c));
    colorEl.innerHTML = '';
    colorEl.classList.toggle('all-on', !state.filter.colors.size);
    if (colors.length > 1 || state.filter.colors.size) {
      for (const c of colors) {
        const b = document.createElement('button');
        b.className = `color-dot hl-color-${c}`;
        b.title = c;
        b.setAttribute('aria-pressed', state.filter.colors.has(c));
        b.onclick = () => { toggle(state.filter.colors, c); renderAll(); emit('filter'); };
        colorEl.appendChild(b);
      }
    }
  }

  // ---------- sessions ----------
  function renderCards() {
    const all = state.annotations.size;
    const visible = visibleAnnotations();
    const visibleIds = new Set(visible.map((a) => a.id));
    const ns = state.sessions.length;
    countEl.textContent = `${ns} session${ns === 1 ? '' : 's'} · ${visible.length === all ? all : `${visible.length}/${all}`}`;
    cardsEl.innerHTML = '';
    if (!all && !state.sessions.length) {
      cardsEl.innerHTML = `<div class="empty"><div class="glyph">${icons.pin}</div><strong>Nothing marked yet.</strong><br>Ask your agent a question, or select text on a page.<code>pdfpin mark --json '{"title": "…",\n  "flow": "…", "highlights": [{"text": "…", "note": "…"}]}'</code></div>`;
      cardsEl.querySelector('.glyph svg').style.cssText = 'width:34px;height:34px;stroke:currentColor;fill:none;stroke-width:1.5';
      return;
    }
    const q = state.filter.text.trim().toLowerCase();
    const sessions = [...state.sessions].reverse();
    let shown = 0;
    sessions.forEach((s, i) => {
      const items = orderedAnnotations().filter((a) => a.sessionId === s.id);
      const seen = items.filter((a) => visibleIds.has(a.id));
      const textHit = q && `${s.title} ${s.flow}`.toLowerCase().includes(q);
      if (state.filter.session && state.filter.session !== s.id) return;
      if (hasFilter() && !seen.length && !textHit) return;
      shown++;
      cardsEl.appendChild(sessionEl(s, items, hasFilter() ? (textHit ? items : seen) : items, i));
    });
    const loose = orderedAnnotations().filter((a) => !sessionOf(a)).filter((a) => visibleIds.has(a.id));
    if (loose.length && !state.filter.session) {
      shown++;
      const sec = document.createElement('section');
      sec.className = 'session loose';
      sec.innerHTML = `<div class="session-head static"><div class="session-title">Your highlights</div><div class="session-meta">${loose.length} by hand</div></div><div class="session-body"></div>`;
      const body = sec.querySelector('.session-body');
      loose.forEach((a) => body.appendChild(card(a, null)));
      cardsEl.appendChild(sec);
    }
    if (!shown) cardsEl.innerHTML = '<div class="empty">Nothing matches the current filter.</div>';
  }

  function sessionEl(s, items, shownItems, i) {
    const sec = document.createElement('section');
    const folded = state.collapsed.has(s.id) && !hasFilter();
    sec.className = `session${folded ? ' collapsed' : ''}${s.id === state.currentSessionId ? ' current' : ''}${state.filter.session === s.id ? ' focused' : ''}`;
    sec.dataset.session = s.id;
    sec.style.animationDelay = `${Math.min(i, 6) * 40}ms`;
    const dots = [...new Set(items.map((a) => a.color))].map((c) => `<span class="mini-dot hl-color-${c}"></span>`).join('');
    sec.innerHTML = `
      <div class="session-head" role="button" tabindex="0" aria-expanded="${!folded}">
        <span class="chev">${icons.chevron}</span>
        <div class="session-main">
          <div class="session-title"></div>
          <div class="session-meta"><span class="dots">${dots}</span><span>${items.length} highlight${items.length === 1 ? '' : 's'}</span><span>·</span><span title="${esc(s.createdAt)}">${relative(s.createdAt)}</span>${s.id === state.currentSessionId ? '<span class="cur">current</span>' : ''}${s.source === 'user' ? '<span>· by hand</span>' : ''}</div>
        </div>
        <span class="session-actions">
          <button class="icon-btn act-focus" title="Show only this session on the pages" aria-pressed="${state.filter.session === s.id}">${icons.eye}</button>
          <button class="icon-btn act-sedit" title="Edit title and overview">${icons.edit}</button>
          <button class="icon-btn act-sdel" title="Delete session…">${icons.trash}</button>
        </span>
      </div>
      <div class="session-body">
        <div class="session-flow md"></div>
        <div class="session-groups"></div>
      </div>`;
    sec.querySelector('.session-title').textContent = s.title || 'Untitled session';
    const flow = sec.querySelector('.session-flow');
    if (s.flow) flow.innerHTML = renderMarkdown(s.flow); else flow.remove();
    if (editingSession === s.id) openSessionEditor(sec, s);

    // groups by tag (colour when untagged), highlights numbered by creation order within the session
    const index = new Map(items.map((a, k) => [a.id, k + 1]));
    const groups = new Map();
    for (const a of shownItems) {
      const key = a.tag ? `#${a.tag}` : a.color;
      if (!groups.has(key)) groups.set(key, { color: a.color, items: [] });
      groups.get(key).items.push(a);
    }
    const gEl = sec.querySelector('.session-groups');
    for (const [key, g] of groups) {
      const wrap = document.createElement('div');
      wrap.className = 'group';
      wrap.innerHTML = `<div class="group-head"><span class="mini-dot hl-color-${g.color}"></span><span class="group-name"></span><span class="rule"></span><span>${g.items.length}</span></div>`;
      wrap.querySelector('.group-name').textContent = key;
      g.items.forEach((a) => wrap.appendChild(card(a, index.get(a.id))));
      gEl.appendChild(wrap);
    }
    return sec;
  }

  function card(a, n) {
    const el = document.createElement('article');
    el.className = `card hl-color-${a.color}${a.id === state.selectedId ? ' selected' : ''}${a._fresh ? ' fresh' : ''}`;
    el.dataset.id = a.id;
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="card-meta">
        ${n ? `<span class="idx">${n}</span>` : ''}<span class="pg">p.${a.page}</span>${a.source === 'user' ? '<span class="src">you</span>' : ''}${a.score < 0.999 ? `<span class="src" title="fuzzy match">~${Math.round(a.score * 100)}%</span>` : ''}
        <span class="spacer"></span>
        <span class="card-actions">
          <button class="icon-btn act-copy" title="Copy as citation">${icons.copy}</button>
          <button class="icon-btn act-edit" title="Edit note">${icons.edit}</button>
          <button class="icon-btn act-del" title="Delete">${icons.trash}</button>
        </span>
      </div>
      ${a.quote ? '<p class="card-quote"></p>' : ''}
      ${a.title ? '<div class="card-title"></div>' : ''}
      <div class="card-note md"></div>`;
    if (a.quote) el.querySelector('.card-quote').textContent = a.quote;
    if (a.title) el.querySelector('.card-title').textContent = a.title;
    el.querySelector('.card-note').innerHTML = renderMarkdown(a.note);
    if (a._fresh) a._fresh = false;
    if (editingId === a.id) openEditor(el, a);
    return el;
  }

  // ---------- editors ----------
  function openEditor(el, a) {
    editingId = a.id;
    const note = el.querySelector('.card-note');
    note.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.className = 'card-edit';
    ta.value = a.note || '';
    ta.placeholder = 'Note (Markdown)…';
    const row = document.createElement('div');
    row.className = 'card-edit-row';
    row.innerHTML = '<button class="btn act-cancel">Cancel</button><button class="btn primary act-save">Save</button>';
    note.append(ta, row);
    ta.focus();
    ta.onkeydown = (e) => {
      if (e.key === 'Escape') { editingId = null; renderCards(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') row.querySelector('.act-save').click();
      e.stopPropagation();
    };
    row.querySelector('.act-cancel').onclick = (e) => { e.stopPropagation(); editingId = null; renderCards(); };
    row.querySelector('.act-save').onclick = async (e) => {
      e.stopPropagation();
      try { await docApi.update(a.id, { note: ta.value }); editingId = null; } catch (err) { toast(err.message, { error: true }); }
    };
  }

  function openSessionEditor(sec, s) {
    editingSession = s.id;
    sec.classList.remove('collapsed');
    const body = sec.querySelector('.session-body');
    const box = document.createElement('div');
    box.className = 'session-editor';
    box.innerHTML = `<input class="session-edit-title" placeholder="Title (the question or purpose)"><textarea class="card-edit" placeholder="Overview (Markdown): what was found, how it connects, caveats"></textarea><div class="card-edit-row"><button class="btn act-scancel">Cancel</button><button class="btn primary act-ssave">Save</button></div>`;
    box.querySelector('input').value = s.title || '';
    box.querySelector('textarea').value = s.flow || '';
    sec.querySelector('.session-flow')?.remove();
    body.prepend(box);
    const stop = (e) => e.stopPropagation();
    box.addEventListener('click', stop);
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { editingSession = null; renderCards(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') box.querySelector('.act-ssave').click();
    });
    box.querySelector('.act-scancel').onclick = () => { editingSession = null; renderCards(); };
    box.querySelector('.act-ssave').onclick = async () => {
      try { await docApi.updateSession(s.id, { title: box.querySelector('input').value, flow: box.querySelector('textarea').value }); editingSession = null; }
      catch (err) { toast(err.message, { error: true }); }
    };
    setTimeout(() => box.querySelector('input').focus(), 0);
  }

  // ---------- actions ----------
  async function removeWithUndo(a) {
    const snapshot = { page: a.page, anchor: a.anchor, rects: a.rects, quote: a.quote, note: a.note, title: a.title, color: a.color, tag: a.tag, source: a.source, sessionId: a.sessionId };
    try { await docApi.remove(a.id); } catch (err) { toast(err.message, { error: true }); return; }
    toast('Highlight deleted', {
      color: a.color, duration: 7000, action: 'Undo',
      onAction: async () => { try { await docApi.add(snapshot); } catch (err) { toast(`Could not restore: ${err.message}`, { error: true }); } },
    });
  }

  async function deleteSession(s) {
    const n = state.annotations.size ? [...state.annotations.values()].filter((a) => a.sessionId === s.id).length : 0;
    const ok = await confirmDialog({
      title: 'Delete this session?',
      body: `<p><strong>${esc(s.title || 'Untitled session')}</strong></p><p>${n ? `Its <strong>${n} highlight${n > 1 ? 's' : ''}</strong> and notes will be removed from the document.` : 'It has no highlights.'}</p>`,
      confirmText: n ? `Delete session and ${n} highlight${n > 1 ? 's' : ''}` : 'Delete session',
      danger: true,
    });
    if (!ok) return;
    try { await docApi.removeSession(s.id); toast(`Deleted “${s.title || 'Untitled session'}”`, { duration: 2500 }); }
    catch (err) { toast(err.message, { error: true }); }
  }

  function focusSession(id) {
    state.filter.session = state.filter.session === id ? null : id;
    if (state.filter.session) state.collapsed.delete(id);
    renderAll();
    emit('filter');
  }

  cardsEl.addEventListener('click', async (e) => {
    const head = e.target.closest('.session-head:not(.static)');
    if (head) {
      const sec = head.closest('.session');
      const s = state.sessions.find((x) => x.id === sec.dataset.session);
      if (!s) return;
      if (e.target.closest('.act-focus')) { focusSession(s.id); return; }
      if (e.target.closest('.act-sedit')) { openSessionEditor(sec, s); return; }
      if (e.target.closest('.act-sdel')) { deleteSession(s); return; }
      if (state.collapsed.has(s.id)) state.collapsed.delete(s.id); else state.collapsed.add(s.id);
      renderCards();
      return;
    }
    const el = e.target.closest('.card');
    if (!el) return;
    const a = state.annotations.get(el.dataset.id);
    if (!a) return;
    if (e.target.closest('.act-copy')) { e.stopPropagation(); copyCitation(a); return; }
    if (e.target.closest('.act-edit')) { e.stopPropagation(); openEditor(el, a); return; }
    if (e.target.closest('.act-del')) { e.stopPropagation(); removeWithUndo(a); return; }
    if (e.target.closest('textarea, .card-edit-row')) return;
    select(a.id, { from: 'panel' });
  });
  cardsEl.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    const head = e.target.closest('.session-head');
    if (head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); head.click(); return; }
    const el = e.target.closest('.card');
    if (el && e.key === 'Enter') select(el.dataset.id, { from: 'panel' });
  });

  async function copyCitation(a) {
    const title = state.doc?.title || 'document';
    const md = `> ${a.quote}\n> — *${title}*, p. ${a.page}${a.note ? `\n\n${a.note}` : ''}`;
    try { await navigator.clipboard.writeText(md); toast('Citation copied', { color: a.color, duration: 1800 }); } catch { toast('Clipboard unavailable', { error: true }); }
  }

  document.getElementById('copy-all-btn').innerHTML = icons.copy;
  document.getElementById('copy-all-btn').onclick = async () => {
    const list = visibleAnnotations();
    if (!list.length) return toast('Nothing to copy');
    const title = state.doc?.title || 'document';
    let md = `# ${title}\n\n`;
    const groups = [...state.sessions].reverse().map((s) => ({ s, items: list.filter((a) => a.sessionId === s.id) })).filter((g) => g.items.length);
    const loose = list.filter((a) => !sessionOf(a));
    if (loose.length) groups.push({ s: null, items: loose });
    for (const { s, items } of groups) {
      md += `## ${s ? s.title || 'Untitled session' : 'Other highlights'}\n\n${s?.flow ? `${s.flow}\n\n` : ''}`;
      items.forEach((a, i) => { md += `### ${i + 1}. p.${a.page}${a.tag ? ` · #${a.tag}` : ''}\n\n> ${a.quote}\n\n${a.title ? `**${a.title}** ` : ''}${a.note || ''}\n\n`; });
    }
    try { await navigator.clipboard.writeText(md); toast(`Copied ${list.length} highlights as Markdown`, { duration: 2200 }); } catch { toast('Clipboard unavailable', { error: true }); }
  };

  // export menu
  const exportBtn = document.getElementById('export-btn');
  const menu = document.getElementById('export-menu');
  exportBtn.innerHTML = icons.download;
  exportBtn.onclick = (e) => {
    e.stopPropagation();
    const r = exportBtn.getBoundingClientRect();
    menu.hidden = !menu.hidden;
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
  };
  document.addEventListener('click', () => { menu.hidden = true; });
  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    menu.hidden = true;
    try {
      const r = await docApi.export(b.dataset.format);
      toast(`Exported ${r.count} highlight(s) → ${r.path}`, { duration: 9000 });
    } catch (err) { toast(err.message, { error: true }); }
  });

  filterInput.addEventListener('input', () => { state.filter.text = filterInput.value; renderCards(); emit('filter'); });

  function renderAll() { renderFilters(); renderCards(); }
  on('annotations', renderAll);
  on('sessions', renderAll);
  on('rects', () => renderCards());
  on('select', ({ id, from }) => {
    if (id) {
      const a = state.annotations.get(id);
      if (a?.sessionId && state.collapsed.has(a.sessionId)) { state.collapsed.delete(a.sessionId); renderCards(); }
    }
    for (const el of cardsEl.querySelectorAll('.card')) el.classList.toggle('selected', el.dataset.id === id);
    const el = cardsEl.querySelector(`.card[data-id="${id}"]`);
    if (el && from !== 'panel') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (id && from !== 'page') {
      const a = state.annotations.get(id);
      if (a) { highlights.rectsFor(a).then((rects) => { viewer.scrollToRect(a.page, rects[0] || null); setTimeout(() => highlights.pulse(id), 350); }); }
    }
  });

  renderAll();
  return {
    renderAll, renderCards, focusFilter: () => filterInput.focus(), removeWithUndo,
    edit(id) {
      select(id, { from: 'popover' });
      setTimeout(() => { const el = cardsEl.querySelector(`.card[data-id="${id}"]`); const a = state.annotations.get(id); if (el && a) openEditor(el, a); }, 60);
    },
  };
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
