// Side panel: the document's history of sessions (newest first), each with its overview and its
// highlights grouped by tag/colour; plus the reader's own highlights. Filters, inline editing, export.
import { state, on, emit, select, visibleAnnotations, orderedAnnotations, sessionOf, hasFilter, COLORS } from './state.js';
import { renderMarkdown } from './markdown.js';
import { icons } from './icons.js';
import { toast } from './toast.js';
import { confirmDialog, pickColor } from './dialog.js';
import { openTags, refreshTagOptions } from './tags-ui.js';
import { openArchive } from './archive-ui.js';
import { t } from './i18n.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LOOSE_ID = '__yours';
const colorBy = () => state.settings?.colorBy ?? 'tag';

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
        b.textContent = t;
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
    countEl.textContent = t('panel.count', { n: ns, m: visible.length === all ? all : `${visible.length}/${all}` });
    cardsEl.innerHTML = '';
    if (!all && !state.sessions.length) {
      cardsEl.innerHTML = `<div class="empty"><strong>${t('panel.empty')}</strong>${t('panel.emptyHint')}</div>`;
      return;
    }
    const q = state.filter.text.trim().toLowerCase();
    const sessions = [...state.sessions].reverse();
    let shown = 0;
    sessions.forEach((s) => {
      const items = orderedAnnotations().filter((a) => a.sessionId === s.id);
      const seen = items.filter((a) => visibleIds.has(a.id));
      const textHit = q && `${s.title} ${s.flow}`.toLowerCase().includes(q);
      if (s.archived) return;
      if (state.filter.session && state.filter.session !== s.id) return;
      if (hasFilter() && !seen.length && !textHit) return;
      shown++;
      cardsEl.appendChild(sessionEl(s, items, hasFilter() ? (textHit ? items : seen) : items));
    });
    const allLoose = orderedAnnotations().filter((a) => !sessionOf(a));
    const loose = allLoose.filter((a) => visibleIds.has(a.id));
    if (loose.length && !state.filter.session) {
      shown++;
      const sec = foldable({
        id: LOOSE_ID,
        title: t('panel.yourHighlights'),
        metaHtml: `<span>${t('panel.byHandCount', { n: allLoose.length })}</span>`,
        actionsHtml: '',
        dotColors: allLoose.map((a) => a.color),
        classes: 'loose',
      });
      fillGroups(sec, allLoose, loose);
      cardsEl.appendChild(sec);
    }
    if (!shown) cardsEl.innerHTML = `<div class="empty">${t('panel.noMatch')}</div>`;
  }

  /** A collapsible section: one agent session, or the reader's own highlights. */
  function foldable({ id, title, metaHtml, actionsHtml, extra = '', dotColors, classes = '' }) {
    const sec = document.createElement('section');
    const folded = state.collapsed.has(id) && !hasFilter();
    sec.className = `session${folded ? ' collapsed' : ''} ${classes}`.trim();
    sec.dataset.session = id;
    const byColor = colorBy() === 'session' && id !== LOOSE_ID;
    const dots = [...new Set(dotColors)].map((c) => `<span class="mini-dot hl-color-${c}${byColor ? ' clickable' : ''}"${byColor ? ` title="${t('color.change')}"` : ''}></span>`).join('');
    sec.innerHTML = `
      <div class="session-head" role="button" tabindex="0" aria-expanded="${!folded}">
        <div class="session-main">
          <div class="session-title"></div>
          <div class="session-meta"><span class="dots">${dots}</span>${metaHtml}</div>
        </div>
        <span class="session-actions">${actionsHtml}<span class="icon-btn fold" aria-hidden="true">${icons.chevron}</span></span>
      </div>
      <div class="session-fold"><div class="session-clip"><div class="session-body">${extra}<div class="session-groups"></div></div></div></div>`;
    sec.querySelector('.session-title').textContent = title;
    return sec;
  }

  /** Highlights split by tag, or by colour when they carry no tag. Headings appear only when they help. */
  function fillGroups(sec, items, shownItems) {
    const index = new Map(items.map((a, k) => [a.id, k + 1]));
    const groups = new Map();
    for (const a of shownItems) {
      // tags are the topic; highlights made by hand carry none, so their colour stands in for one
      const key = a.tag ? `#${a.tag}` : `:${a.color}`;
      if (!groups.has(key)) groups.set(key, { color: a.color, label: a.tag || a.color, items: [] });
      groups.get(key).items.push(a);
    }
    const gEl = sec.querySelector('.session-groups');
    const labelled = groups.size > 1 || [...groups.values()].some((g) => g.items[0].tag);
    for (const [, g] of groups) {
      const wrap = document.createElement('div');
      wrap.className = 'group';
      if (labelled) {
        const tag = g.items[0].tag || '';
        const clickable = tag && colorBy() === 'tag';
        wrap.innerHTML = `<div class="group-head"><span class="mini-dot hl-color-${g.color}${clickable ? ' clickable' : ''}"${clickable ? ` data-tag="${esc(tag)}" title="${t('color.change')}"` : ''}></span><span class="group-name"></span><span class="rule"></span><span>${g.items.length}</span></div>`;
        wrap.querySelector('.group-name').textContent = g.label;
      }
      g.items.forEach((a) => wrap.appendChild(card(a, index.get(a.id))));
      gEl.appendChild(wrap);
    }
  }

  function sessionEl(s, items, shownItems) {
    const meta = `<span>${t('session.highlights', { n: items.length })}</span><span>·</span><span title="${esc(s.createdAt)}">${relative(s.createdAt)}</span>`
      + (s.id === state.currentSessionId ? `<span class="cur">${t('session.current')}</span>` : '')
      + (s.source === 'user' ? `<span>· ${t('session.byHand')}</span>` : '');
    const actions = `
      <button class="icon-btn act-focus" title="${t('session.focus')}" aria-pressed="${state.filter.session === s.id}">${icons.eye}</button>
      <button class="icon-btn act-sedit" title="${t('session.edit')}">${icons.edit}</button>
      <button class="icon-btn act-sarch" title="${t('archive.archive')}">${icons.archive}</button>`;
    const sec = foldable({
      id: s.id,
      title: s.title || t('session.untitled'),
      metaHtml: meta,
      actionsHtml: actions,
      extra: '<div class="session-flow md"></div>',
      dotColors: items.map((a) => a.color),
      classes: `${s.id === state.currentSessionId ? 'current' : ''} ${state.filter.session === s.id ? 'focused' : ''}`,
    });
    const flow = sec.querySelector('.session-flow');
    if (s.flow) flow.innerHTML = renderMarkdown(s.flow); else flow.remove();
    if (editingSession === s.id) openSessionEditor(sec, s);
    fillGroups(sec, items, shownItems);
    return sec;
  }

  function card(a, n) {
    const el = document.createElement('article');
    el.className = `card hl-color-${a.color}${a.id === state.selectedId ? ' selected' : ''}${a._fresh ? ' fresh' : ''}`;
    el.dataset.id = a.id;
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="card-meta">
        ${n ? `<span class="idx">${n}</span>` : ''}<span class="pg">p.${a.page}</span>${a.tag ? '<span class="tag"></span>' : ''}${a.source === 'user' ? `<span class="src">${t('session.byHand')}</span>` : ''}${a.score < 0.999 ? `<span class="src" title="${t('card.fuzzy')}">~${Math.round(a.score * 100)}%</span>` : ''}
        <span class="spacer"></span>
        <span class="card-actions">
          <button class="icon-btn act-copy" title="${t('card.copy')}">${icons.copy}</button>
          <button class="icon-btn act-edit" title="${t('card.edit')}">${icons.edit}</button>
          <button class="icon-btn act-del" title="${t('card.delete')}">${icons.trash}</button>
        </span>
      </div>
      ${a.quote ? '<p class="card-quote"></p>' : ''}
      ${a.title ? '<div class="card-title"></div>' : ''}
      <div class="card-note md"></div>`;
    if (a.tag) el.querySelector('.tag').textContent = a.tag;
    if (a.quote) { const m = document.createElement('mark'); m.className = `mk mk-${a.color}`; m.textContent = a.quote; el.querySelector('.card-quote').appendChild(m); }
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
    ta.placeholder = t('card.notePlaceholder');
    const tagInput = document.createElement('input');
    tagInput.className = 'card-edit-tag';
    tagInput.placeholder = t('card.tagPlaceholder');
    tagInput.value = a.tag || '';
    tagInput.setAttribute('list', 'tag-options');
    tagInput.spellcheck = false;
    const row = document.createElement('div');
    row.className = 'card-edit-row';
    row.innerHTML = `<button class="btn act-cancel">${t('common.cancel')}</button><button class="btn primary act-save">${t('common.save')}</button>`;
    note.append(tagInput, ta, row);
    tagInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } if (e.key === 'Escape') { editingId = null; renderCards(); } };
    ta.focus();
    ta.onkeydown = (e) => {
      if (e.key === 'Escape') { editingId = null; renderCards(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') row.querySelector('.act-save').click();
      e.stopPropagation();
    };
    row.querySelector('.act-cancel').onclick = (e) => { e.stopPropagation(); editingId = null; renderCards(); };
    row.querySelector('.act-save').onclick = async (e) => {
      e.stopPropagation();
      const patch = { note: ta.value };
      const tag = tagInput.value.trim();
      if (tag !== (a.tag || '')) patch.tag = tag; // only when it moved, so the colour rule is left alone
      try { await docApi.update(a.id, patch); editingId = null; } catch (err) { toast(err.message, { error: true }); }
    };
  }

  function openSessionEditor(sec, s) {
    editingSession = s.id;
    sec.classList.remove('collapsed');
    const body = sec.querySelector('.session-body');
    body.querySelector('.session-editor')?.remove();
    const box = document.createElement('div');
    box.className = 'session-editor';
    box.innerHTML = `<input class="session-edit-title" placeholder="${t('session.titlePlaceholder')}"><textarea class="card-edit" placeholder="${t('session.flowPlaceholder')}"></textarea><div class="card-edit-row"><button class="btn act-scancel">${t('common.cancel')}</button><button class="btn primary act-ssave">${t('common.save')}</button></div>`;
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
    toast(t('card.deleted'), {
      color: a.color, duration: 7000, action: t('card.undo'),
      onAction: async () => {
        try { await docApi.add(snapshot); } catch (err) {
          // its session may have gone with it; bring the highlight back on its own rather than fail
          if (err.status === 404 && snapshot.sessionId) {
            try { await docApi.add({ ...snapshot, sessionId: null }); return; } catch { /* fall through */ }
          }
          toast(t('card.restoreFailed', { message: err.message }), { error: true });
        }
      },
    });
  }

  async function archiveSession(s) {
    const title = s.title || t('session.untitled');
    try { await docApi.archiveSession(s.id, true); } catch (err) { toast(err.message, { error: true }); return; }
    toast(t('archive.archived', { title }), {
      color: s.color, duration: 7000, action: t('archive.undo'),
      onAction: async () => { try { await docApi.archiveSession(s.id, false); } catch (err) { toast(err.message, { error: true }); } },
    });
  }

  async function deleteSession(s) {
    const n = state.annotations.size ? [...state.annotations.values()].filter((a) => a.sessionId === s.id).length : 0;
    const title = s.title || t('session.untitled');
    const ok = await confirmDialog({
      title: t('session.deleteTitle'),
      body: `<p><strong>${esc(title)}</strong></p><p>${n ? t('session.deleteBodyWith', { n }) : t('session.deleteBodyEmpty')}</p>`,
      confirmText: n ? t('session.deleteConfirm', { n }) : t('session.deleteConfirmEmpty'),
      cancelText: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    try { await docApi.removeSession(s.id); toast(t('session.deleted', { title }), { duration: 2500 }); }
    catch (err) { toast(err.message, { error: true }); }
  }

  function focusSession(id) {
    const turningOn = state.filter.session !== id;
    state.filter.session = turningOn ? id : null;
    if (turningOn) state.collapsed.delete(id);
    renderAll();
    emit('filter');
    // land on the session's first highlight and light the whole set up once
    if (turningOn) highlights.flashSession(id);
  }

  cardsEl.addEventListener('click', async (e) => {
    const dot = e.target.closest('.mini-dot.clickable');
    if (dot) {
      e.stopPropagation();
      const tag = dot.dataset.tag;
      const sid = dot.closest('.session')?.dataset.session;
      const current = tag ? state.doc?.tagColors?.[tag] : state.doc?.sessionColors?.[sid];
      const picked = await pickColor(dot, current);
      if (picked === undefined) return;
      try { await docApi.setColors(tag ? { tags: { [tag]: picked } } : { sessions: { [sid]: picked } }); }
      catch (err) { toast(err.message, { error: true }); }
      return;
    }
    const head = e.target.closest('.session-head');
    if (head) {
      const sec = head.closest('.session');
      const s = state.sessions.find((x) => x.id === sec.dataset.session);
      if (s) {
        if (e.target.closest('.act-focus')) { focusSession(s.id); return; }
        // go through a render so only one editor is ever open; clicking edit again keeps the draft
        if (e.target.closest('.act-sedit')) { if (editingSession !== s.id) { editingSession = s.id; renderCards(); } return; }
        if (e.target.closest('.act-sarch')) { archiveSession(s); return; }
      }
      toggleFold(sec);
      return;
    }
    const el = e.target.closest('.card');
    if (!el) return;
    const a = state.annotations.get(el.dataset.id);
    if (!a) return;
    if (e.target.closest('.act-copy')) { e.stopPropagation(); copyCitation(a); return; }
    if (e.target.closest('.act-edit')) { e.stopPropagation(); if (editingId !== a.id) { editingId = a.id; renderCards(); } return; }
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

  /** Fold in place so the section can animate; a re-render would snap it open or shut. */
  function toggleFold(sec) {
    const id = sec.dataset.session;
    const folding = !sec.classList.contains('collapsed');
    if (folding) state.collapsed.add(id); else state.collapsed.delete(id);
    sec.classList.toggle('collapsed', folding);
    sec.querySelector('.session-head').setAttribute('aria-expanded', String(!folding));
  }

  async function copyCitation(a) {
    const title = state.doc?.title || 'document';
    const md = `> ${a.quote}\n> — *${title}*, p. ${a.page}${a.note ? `\n\n${a.note}` : ''}`;
    try { await navigator.clipboard.writeText(md); toast(t('card.citationCopied'), { color: a.color, duration: 1800 }); } catch { toast(t('card.clipboardUnavailable'), { error: true }); }
  }

  document.getElementById('copy-all-btn').innerHTML = icons.copy;
  document.getElementById('copy-all-btn').onclick = async () => {
    const list = visibleAnnotations();
    if (!list.length) return toast(t('card.nothingToCopy'));
    const title = state.doc?.title || 'document';
    let md = `# ${title}\n\n`;
    const groups = [...state.sessions].reverse().map((s) => ({ s, items: list.filter((a) => a.sessionId === s.id) })).filter((g) => g.items.length);
    const loose = list.filter((a) => !sessionOf(a));
    if (loose.length) groups.push({ s: null, items: loose });
    for (const { s, items } of groups) {
      md += `## ${s ? s.title || t('session.untitled') : t('panel.yourHighlights')}\n\n${s?.flow ? `${s.flow}\n\n` : ''}`;
      items.forEach((a, i) => { md += `### ${i + 1}. p.${a.page}${a.tag ? ` · #${a.tag}` : ''}\n\n> ${a.quote}\n\n${a.title ? `**${a.title}** ` : ''}${a.note || ''}\n\n`; });
    }
    try { await navigator.clipboard.writeText(md); toast(t('card.copiedAll', { n: list.length }), { duration: 2200 }); } catch { toast(t('card.clipboardUnavailable'), { error: true }); }
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
      toast(t('export.done', { n: r.count, path: r.path }), { duration: 9000 });
    } catch (err) { toast(err.message, { error: true }); }
  });

  filterInput.addEventListener('input', () => { state.filter.text = filterInput.value; renderCards(); emit('filter'); });

  const tagsBtn = document.getElementById('tags-btn');
  tagsBtn.innerHTML = icons.tag;
  tagsBtn.onclick = () => openTags(docApi);
  const archiveBtn = document.getElementById('archive-btn');
  archiveBtn.innerHTML = icons.archive;
  archiveBtn.onclick = () => openArchive(docApi);
  on('sessions', () => { archiveBtn.hidden = !state.sessions.some((s) => s.archived); });
  archiveBtn.hidden = !state.sessions.some((s) => s.archived);

  function renderAll() { refreshTagOptions(); renderFilters(); renderCards(); }
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
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.min', { n: Math.round(s / 60) });
  if (s < 86400) return t('time.hour', { n: Math.round(s / 3600) });
  if (s < 7 * 86400) return t('time.day', { n: Math.round(s / 86400) });
  return new Date(ms).toLocaleDateString();
}
