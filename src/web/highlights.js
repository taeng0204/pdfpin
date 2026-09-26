// Highlight overlay: anchors → exact DOM rects via Range, rendering, hover popover, selection pulse.
import { mergeLineRects } from '/shared/pagetext.js';
import { state, on, select, emit, visibleAnnotations } from './state.js';
import { renderMarkdown } from './markdown.js';
import { icons } from './icons.js';

export function initHighlights(viewer, docApi) {
  const groups = new Map(); // annotation id -> { el, page }
  const popover = document.getElementById('popover');
  let hoverTimer = null;
  let pinnedId = null;
  const pendingPatch = new Map();
  let actions = null; // { edit(id), remove(annotation) } supplied by the panel

  const pageRects = (ps, anchor) => computeDomRects(ps, anchor);

  async function rectsFor(a) {
    const ps = viewer.pages[a.page - 1];
    if (!ps) return a.rects || [];
    if (!a.anchor) return a.rects || [];
    await ps.textReady;
    await viewer.ensureFonts(ps);
    if (!ps.textLayer) return a.rects || [];
    const rects = pageRects(ps, a.anchor);
    if (rects.length) {
      const changed = a.rectsSource !== 'dom' || JSON.stringify(rects) !== JSON.stringify(a.rects);
      if (changed && !pendingPatch.has(a.id)) {
        pendingPatch.set(a.id, true);
        a.rectsSource = 'dom';
        a.rects = rects;
        docApi.update(a.id, { rects }).catch(() => {}).finally(() => pendingPatch.delete(a.id));
      }
      return rects;
    }
    return a.rects || [];
  }

  async function render(a) {
    const ps = viewer.pages[a.page - 1];
    if (!ps) return;
    const rects = await rectsFor(a);
    const current = state.annotations.get(a.id);
    if (!current) return; // removed while we were computing
    let g = groups.get(a.id);
    if (!g) {
      g = { el: document.createElement('div'), page: a.page };
      g.el.className = 'hl';
      g.el.dataset.id = a.id;
      groups.set(a.id, g);
    }
    g.el.className = `hl hl-color-${a.color}${a.source === 'user' ? ' user' : ''}${state.selectedId === a.id ? ' selected' : ''}`;
    g.el.innerHTML = rects.map((r) => `<div class="hl-rect" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></div>`).join('');
    if (g.el.parentNode !== ps.hlEl) ps.hlEl.appendChild(g.el);
    current.rects = rects;
    applyFilter();
  }

  function remove(id) {
    groups.get(id)?.el.remove();
    groups.delete(id);
    if (pinnedId === id) hidePopover();
  }

  async function renderAll() {
    for (const g of groups.values()) g.el.remove();
    groups.clear();
    await Promise.all([...state.annotations.values()].map(render));
    emit('rects');
  }

  function pulse(id) {
    const g = groups.get(id);
    if (!g) return;
    g.el.classList.remove('pulse');
    void g.el.offsetWidth;
    g.el.classList.add('pulse');
    setTimeout(() => g.el.classList.remove('pulse'), 1300);
  }

  function showPopover(a, anchorRect, { pinned = false } = {}) {
    popover.className = `popover hl-color-${a.color}`;
    const meta = [`p.${a.page}`, a.tag ? `#${a.tag}` : '', a.source === 'user' ? 'you' : 'agent'].filter(Boolean).join(' · ');
    const acts = pinned && actions ? `<div class="pop-actions"><button class="tb-btn pop-edit">${icons.edit}<span>Edit</span></button><button class="tb-btn danger pop-del">${icons.trash}<span>Delete</span></button></div>` : '';
    popover.innerHTML = `<div class="pop-meta"></div>${a.title ? '<div class="pop-title"></div>' : ''}<div class="md"></div>${a.quote ? '<div class="pop-quote"></div>' : ''}${acts}`;
    popover.querySelector('.pop-edit')?.addEventListener('click', () => { hidePopover(); actions.edit(a.id); });
    popover.querySelector('.pop-del')?.addEventListener('click', () => { hidePopover(); actions.remove(a); });
    popover.querySelector('.pop-meta').textContent = meta;
    if (a.title) popover.querySelector('.pop-title').textContent = a.title;
    popover.querySelector('.md').innerHTML = a.note ? renderMarkdown(a.note) : '<span style="color:var(--muted)">No note</span>';
    if (a.quote) popover.querySelector('.pop-quote').textContent = a.quote;
    popover.hidden = false;
    const pw = popover.offsetWidth, ph = popover.offsetHeight;
    let top = anchorRect.top - ph - 10;
    if (top < 60) top = anchorRect.bottom + 10;
    let left = anchorRect.left + anchorRect.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }
  function hidePopover() { popover.hidden = true; pinnedId = null; }

  // hover + click on highlight rects (event delegation on the pages container)
  viewer.pagesEl.addEventListener('mouseover', (e) => {
    const rect = e.target.closest?.('.hl-rect');
    if (!rect) return;
    const id = rect.parentElement.dataset.id;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const a = state.annotations.get(id);
      if (a && !pinnedId) showPopover(a, rect.getBoundingClientRect());
    }, 140);
  });
  viewer.pagesEl.addEventListener('mouseout', (e) => {
    if (!e.target.closest?.('.hl-rect')) return;
    clearTimeout(hoverTimer);
    if (!pinnedId) hidePopover();
  });
  viewer.pagesEl.addEventListener('click', (e) => {
    const rect = e.target.closest?.('.hl-rect');
    if (!rect) { if (pinnedId) hidePopover(); return; }
    const id = rect.parentElement.dataset.id;
    const a = state.annotations.get(id);
    if (!a) return;
    pinnedId = id;
    showPopover(a, rect.getBoundingClientRect(), { pinned: true });
    select(id, { from: 'page' });
  });
  popover.addEventListener('mouseenter', () => clearTimeout(hoverTimer));
  popover.addEventListener('mouseleave', () => { if (!pinnedId) hidePopover(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !popover.hidden) hidePopover(); });
  viewer.viewerEl.addEventListener('scroll', () => { if (!popover.hidden) hidePopover(); }, { passive: true });

  // page highlights follow the panel filter: everything else fades back
  function applyFilter() {
    const { text, tags, colors } = state.filter;
    const active = text.trim() || tags.size || colors.size;
    const keep = active ? new Set(visibleAnnotations().map((a) => a.id)) : null;
    for (const [gid, g] of groups) g.el.classList.toggle('faded', !!keep && !keep.has(gid));
  }
  on('filter', applyFilter);
  on('annotations', () => setTimeout(applyFilter, 0));
  on('select', ({ id }) => {
    for (const [gid, g] of groups) g.el.classList.toggle('selected', gid === id);
    if (pinnedId && pinnedId !== id) hidePopover();
  });
  on('annotation:upsert', (a) => render(a).then(() => emit('rects')));
  on('annotation:remove', remove);
  on('textlayer', async (ps) => {
    // text layer just became available → refine rects for annotations on that page
    for (const a of state.annotations.values()) if (a.page === ps.num) await render(a);
    emit('rects');
  });

  // ---- search hits (separate, lighter layer) ----
  const searchEls = [];
  function showSearchHits(hits, currentIdx) {
    clearSearchHits();
    hits.forEach((h, i) => {
      const ps = viewer.pages[h.page - 1];
      for (const r of h.rects) {
        const d = document.createElement('div');
        d.className = `search-hit${i === currentIdx ? ' current' : ''}`;
        d.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
        ps.hlEl.appendChild(d);
        searchEls.push(d);
      }
    });
  }
  function clearSearchHits() { for (const d of searchEls) d.remove(); searchEls.length = 0; }

  return { render, remove, renderAll, pulse, rectsFor, computeDomRects, showSearchHits, clearSearchHits, hidePopover, setActions: (a) => { actions = a; } };
}

/** Exact rects for an anchor using the page's text-layer spans. Page units at scale 1, top-left origin. */
export function computeDomRects(ps, anchor) {
  const divs = ps.textLayer?.textDivs;
  if (!divs?.length) return [];
  const pick = (idx, dir) => {
    let i = idx;
    while (i >= 0 && i < divs.length && (!divs[i].isConnected || !divs[i].firstChild)) i += dir;
    return divs[i] || null;
  };
  const sDiv = pick(anchor.startItem, +1);
  const eDiv = pick(anchor.endItem, -1);
  if (!sDiv || !eDiv) return [];
  const sNode = sDiv.firstChild, eNode = eDiv.firstChild;
  const sOff = sDiv === divs[anchor.startItem] ? Math.min(anchor.startChar, sNode.length) : 0;
  const eOff = eDiv === divs[anchor.endItem] ? Math.min(anchor.endChar, eNode.length) : eNode.length;
  const range = document.createRange();
  try {
    range.setStart(sNode, sOff);
    range.setEnd(eNode, eOff);
  } catch { return []; }
  if (range.collapsed) return [];
  const pageRect = ps.el.getBoundingClientRect();
  const s = pageRect.width / ps.base.w;
  if (!s) return [];
  const rects = [];
  for (const r of range.getClientRects()) {
    if (r.width < 0.5 || r.height < 0.5) continue;
    rects.push({ x: (r.left - pageRect.left) / s, y: (r.top - pageRect.top) / s, w: r.width / s, h: r.height / s });
  }
  rects.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.5 ? a.y - b.y : a.x - b.x));
  return mergeLineRects(dedupe(rects));
}

function dedupe(rects) {
  const out = [];
  for (const r of rects) {
    if (out.some((o) => Math.abs(o.x - r.x) < 0.5 && Math.abs(o.y - r.y) < 0.5 && Math.abs(o.w - r.w) < 0.5 && Math.abs(o.h - r.h) < 0.5)) continue;
    out.push(r);
  }
  return out;
}
