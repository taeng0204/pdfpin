// Side panel: summary card, filters, annotation cards grouped by page, inline editing.
import { state, on, emit, select, visibleAnnotations, orderedAnnotations, COLORS } from './state.js';
import { renderMarkdown } from './markdown.js';
import { icons } from './icons.js';
import { toast } from './toast.js';

export function initPanel({ docApi, viewer, highlights }) {
  const cardsEl = document.getElementById('cards');
  const summaryEl = document.getElementById('summary');
  const countEl = document.getElementById('ann-count');
  const chipsEl = document.getElementById('tag-chips');
  const colorEl = document.getElementById('color-filter');
  const filterInput = document.getElementById('filter-input');
  let editingId = null;

  function renderSummary() {
    const s = state.doc?.summary;
    if (!s || (!s.title && !s.body)) { summaryEl.hidden = true; summaryEl.innerHTML = ''; return; }
    summaryEl.hidden = false;
    summaryEl.innerHTML = `${s.title ? '<h2></h2>' : ''}<div class="md"></div>`;
    if (s.title) summaryEl.querySelector('h2').textContent = s.title;
    summaryEl.querySelector('.md').innerHTML = renderMarkdown(s.body);
  }

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
        b.onclick = () => { toggle(state.filter.tags, t); renderAll(); };
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
        b.onclick = () => { toggle(state.filter.colors, c); renderAll(); };
        colorEl.appendChild(b);
      }
    }
  }
  const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

  function renderCards() {
    const all = state.annotations.size;
    const list = visibleAnnotations();
    countEl.textContent = list.length === all ? all : `${list.length}/${all}`;
    cardsEl.innerHTML = '';
    if (!all) {
      cardsEl.innerHTML = `<div class="empty"><div class="glyph">${icons.pin}</div><strong>No highlights yet.</strong><br>Ask your agent, or select text on a page.<code>pdfpin add --text "exact quote" \\\n  --note "why it matters" --tag "claim"</code></div>`;
      cardsEl.querySelector('.glyph svg').style.cssText = 'width:34px;height:34px;stroke:currentColor;fill:none;stroke-width:1.5';
      return;
    }
    if (!list.length) { cardsEl.innerHTML = '<div class="empty">Nothing matches the current filter.</div>'; return; }
    let group = null;
    let lastPage = 0;
    list.forEach((a, i) => {
      if (a.page !== lastPage) {
        lastPage = a.page;
        group = document.createElement('section');
        group.className = 'page-group';
        const n = list.filter((x) => x.page === a.page).length;
        group.innerHTML = `<div class="page-group-head" data-page="${a.page}"><span>Page ${a.page}</span><span class="rule"></span><span>${n}</span></div>`;
        cardsEl.appendChild(group);
      }
      group.appendChild(card(a, i));
    });
  }

  function card(a, i) {
    const el = document.createElement('article');
    el.className = `card hl-color-${a.color}${a.id === state.selectedId ? ' selected' : ''}${a._fresh ? ' fresh' : ''}`;
    el.dataset.id = a.id;
    el.tabIndex = 0;
    el.style.animationDelay = `${Math.min(i, 8) * 30}ms`;
    el.innerHTML = `
      <div class="card-meta">
        <span class="pg">p.${a.page}</span>${a.tag ? '<span class="tag"></span>' : ''}${a.source === 'user' ? '<span class="src">you</span>' : ''}${a.score < 0.999 ? `<span class="src" title="fuzzy match">~${Math.round(a.score * 100)}%</span>` : ''}
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
    if (a.tag) el.querySelector('.tag').textContent = `#${a.tag}`;
    if (a.quote) el.querySelector('.card-quote').textContent = a.quote;
    if (a.title) el.querySelector('.card-title').textContent = a.title;
    el.querySelector('.card-note').innerHTML = renderMarkdown(a.note);
    if (a._fresh) { a._fresh = false; }
    if (editingId === a.id) openEditor(el, a);
    return el;
  }

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

  cardsEl.addEventListener('click', async (e) => {
    const head = e.target.closest('.page-group-head');
    if (head) { viewer.scrollToPage(Number(head.dataset.page)); return; }
    const el = e.target.closest('.card');
    if (!el) return;
    const a = state.annotations.get(el.dataset.id);
    if (!a) return;
    if (e.target.closest('.act-copy')) { e.stopPropagation(); copyCitation(a); return; }
    if (e.target.closest('.act-edit')) { e.stopPropagation(); openEditor(el, a); return; }
    if (e.target.closest('.act-del')) {
      e.stopPropagation();
      const b = e.target.closest('.act-del');
      if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.title = 'Click again to delete'; setTimeout(() => b.classList.remove('confirm'), 2200); return; }
      try { await docApi.remove(a.id); } catch (err) { toast(err.message, { error: true }); }
      return;
    }
    if (e.target.closest('textarea, .card-edit-row')) return;
    select(a.id, { from: 'panel' });
  });
  cardsEl.addEventListener('keydown', (e) => {
    const el = e.target.closest('.card');
    if (!el || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Enter') select(el.dataset.id, { from: 'panel' });
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
    const s = state.doc?.summary;
    let md = `# ${title}\n\n`;
    if (s?.title || s?.body) md += `## ${s.title || 'Summary'}\n\n${s.body || ''}\n\n`;
    let page = 0;
    for (const a of list) {
      if (a.page !== page) { page = a.page; md += `## Page ${page}\n\n`; }
      md += `> ${a.quote}\n\n${a.title ? `**${a.title}** ` : ''}${a.note || ''}\n\n`;
    }
    try { await navigator.clipboard.writeText(md); toast(`Copied ${list.length} notes as Markdown`, { duration: 2200 }); } catch { toast('Clipboard unavailable', { error: true }); }
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
      toast(`Exported ${r.count} annotation(s) → ${r.path}`, { duration: 9000 });
    } catch (err) { toast(err.message, { error: true }); }
  });

  filterInput.addEventListener('input', () => { state.filter.text = filterInput.value; renderCards(); });

  function renderAll() { renderSummary(); renderFilters(); renderCards(); }
  on('annotations', renderAll);
  on('summary', renderSummary);
  on('rects', () => { /* order may change once rects are known */ renderCards(); });
  on('select', ({ id, from }) => {
    for (const el of cardsEl.querySelectorAll('.card')) el.classList.toggle('selected', el.dataset.id === id);
    const el = cardsEl.querySelector(`.card[data-id="${id}"]`);
    if (el && from !== 'panel') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (id && from !== 'page') {
      const a = state.annotations.get(id);
      if (a) { highlights.rectsFor(a).then((rects) => { viewer.scrollToRect(a.page, rects[0] || null); setTimeout(() => highlights.pulse(id), 350); }); }
    }
  });

  renderAll();
  return { renderAll, renderCards, focusFilter: () => filterInput.focus() };
}
