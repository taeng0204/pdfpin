// Select text on a page → floating toolbar → create a user annotation.
import { mergeLineRects } from '../shared/pagetext.js';
import { COLORS } from './state.js';
import { icons } from './icons.js';
import { toast } from './toast.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { isPlainKey } from './shortcuts.js';

const swatches = () => COLORS.map((c) => `<button class="color-dot hl-color-${c}" data-color="${c}" title="${c}"></button>`).join('');
const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colorOfTag = (tag) => [...state.annotations.values()].find((a) => a.tag === tag)?.color ?? 'yellow';

/** Tags in the order they help here: the ones this document already leans on, then the rest. */
export function orderedTags() {
  const used = new Map();
  for (const a of state.annotations.values()) if (a.tag) used.set(a.tag, (used.get(a.tag) ?? 0) + 1);
  return [...used.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/** Every tag, on one scrolling line. Slicing the list off would hide tags with no way back to them. */
export function tagChips() {
  const tags = orderedTags();
  if (!tags.length) return '';
  const chips = tags.map((tag) => `<button class="sel-tag hl-color-${colorOfTag(tag)}" data-tag="${escAttr(tag)}" title="${escAttr(t('sel.tagged', { tag }))}">${escAttr(tag)}</button>`).join('');
  return `<div class="sel-tags">${chips}</div>`;
}

export function initSelection({ viewer, docApi }) {
  const bar = document.getElementById('sel-toolbar');
  let pending = null; // { page, anchor, quote, rects }

  function hide() { bar.hidden = true; bar.classList.remove('note-mode'); pending = null; }

  function capture() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const ps = viewer.pageOf(range.startContainer.parentElement);
    const pe = viewer.pageOf(range.endContainer.parentElement);
    if (!ps || !pe || ps !== pe || !ps.textLayer) return null;
    const startSpan = spanOf(range.startContainer, ps);
    const endSpan = spanOf(range.endContainer, ps);
    if (!startSpan || !endSpan) return null;
    const startItem = ps.spanIndex.get(startSpan.el);
    const endItem = ps.spanIndex.get(endSpan.el);
    if (startItem === undefined || endItem === undefined) return null;
    const anchor = { startItem, startChar: startSpan.offset(range.startOffset, range.startContainer), endItem, endChar: endSpan.offset(range.endOffset, range.endContainer) };
    if (anchor.endItem < anchor.startItem || (anchor.endItem === anchor.startItem && anchor.endChar <= anchor.startChar)) return null;
    const pageRect = ps.el.getBoundingClientRect();
    const s = pageRect.width / ps.base.w;
    const rects = [];
    for (const r of range.getClientRects()) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      rects.push({ x: (r.left - pageRect.left) / s, y: (r.top - pageRect.top) / s, w: r.width / s, h: r.height / s });
    }
    const quote = sel.toString().replace(/\s+/g, ' ').trim();
    if (!quote) return null;
    return { page: ps.num, anchor, quote, rects: mergeLineRects(rects), bounds: range.getBoundingClientRect() };
  }

  function spanOf(node, ps) {
    const el = node.nodeType === 3 ? node.parentElement : node;
    const span = el?.closest?.('.textLayer > span, .textLayer .markedContent > span');
    if (!span) return null;
    return {
      el: span,
      offset: (off, container) => {
        if (container.nodeType === 3) return Math.min(off, container.length);
        return off === 0 ? 0 : (span.firstChild?.length ?? 0);
      },
    };
  }

  function show(p) {
    pending = p;
    bar.classList.remove('note-mode');
    const chips = tagChips();
    bar.innerHTML = `${chips}<div class="sel-main"><span class="swatches">${swatches()}</span><span class="sep"></span><button class="tb-btn act-note">${icons.note}<span>${t('sel.note')}</span></button></div>`;
    bar.classList.toggle('with-tags', !!chips);
    bar.hidden = false;
    place(p.bounds);
    markOverflow();
  }

  /** Fade the right edge only when there is more to scroll to. */
  function markOverflow() {
    const strip = bar.querySelector('.sel-tags');
    if (strip) strip.classList.toggle('overflowing', strip.scrollWidth > strip.clientWidth + 1);
  }
  function place(b) {
    const w = bar.offsetWidth, h = bar.offsetHeight;
    let top = b.top - h - 10;
    if (top < 60) top = b.bottom + 10;
    const left = Math.max(8, Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - w - 8));
    bar.style.top = `${top}px`;
    bar.style.left = `${left}px`;
  }

  /** With a tag the colour follows that tag; with a colour it is pinned to that colour. */
  async function create({ color, tag, note }) {
    if (!pending) return;
    const p = pending;
    hide();
    window.getSelection()?.removeAllRanges();
    const spec = { page: p.page, anchor: p.anchor, quote: p.quote, rects: p.rects, note: note || '', source: 'user' };
    if (tag) spec.tag = tag; else spec.color = color;
    try { await docApi.add(spec); } catch (e) { toast(e.message, { error: true }); }
  }

  bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection alive
  // a mouse wheel only scrolls vertically, and the tag strip runs the other way
  bar.addEventListener('wheel', (e) => {
    const strip = e.target.closest?.('.sel-tags');
    if (!strip || strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    strip.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  bar.addEventListener('click', (e) => {
    const chip = e.target.closest('.sel-tag');
    if (chip) { create({ tag: chip.dataset.tag, note: bar.querySelector('textarea')?.value }); return; }
    const dot = e.target.closest('.color-dot');
    if (dot) { create({ color: dot.dataset.color, note: bar.querySelector('textarea')?.value }); return; }
    if (e.target.closest('.act-note')) {
      const b = pending.bounds;
      bar.classList.add('note-mode');
      bar.innerHTML = `<textarea placeholder="${t('sel.notePlaceholder')}"></textarea>${tagChips()}<div class="note-row"><span class="swatches">${swatches()}</span><span class="grow"></span><button class="tb-btn act-cancel">${t('sel.cancel')}</button></div>`;
      place(b);
      markOverflow();
      const ta = bar.querySelector('textarea');
      setTimeout(() => ta.focus(), 0);
      ta.onkeydown = (ev) => { if (isPlainKey(ev)) ev.stopPropagation(); if (ev.key === 'Escape') hide(); if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') create({ color: 'yellow', note: ta.value }); };
      ta.onmousedown = (ev) => ev.stopPropagation();
      return;
    }
    if (e.target.closest('.act-cancel')) hide();
  });

  viewer.pagesEl.addEventListener('mouseup', () => {
    setTimeout(() => {
      if (!bar.hidden && bar.classList.contains('note-mode')) return;
      const p = capture();
      if (p) show(p); else hide();
    }, 10);
  });
  document.addEventListener('mousedown', (e) => { if (!bar.contains(e.target) && !bar.classList.contains('note-mode')) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !bar.hidden) hide(); });
  viewer.viewerEl.addEventListener('scroll', () => { if (!bar.hidden && !bar.classList.contains('note-mode')) hide(); }, { passive: true });
  return { hide };
}
