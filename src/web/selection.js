// Select text on a page → floating toolbar → create a user annotation.
import { mergeLineRects } from '/shared/pagetext.js';
import { COLORS } from './state.js';
import { icons } from './icons.js';
import { toast } from './toast.js';

const swatches = () => COLORS.map((c) => `<button class="color-dot hl-color-${c}" data-color="${c}" title="${c}"></button>`).join('');

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
    bar.innerHTML = `<span class="swatches">${swatches()}</span><span class="sep"></span><button class="tb-btn act-note">${icons.note}<span>Note</span></button>`;
    bar.hidden = false;
    place(p.bounds);
  }
  function place(b) {
    const w = bar.offsetWidth, h = bar.offsetHeight;
    let top = b.top - h - 10;
    if (top < 60) top = b.bottom + 10;
    const left = Math.max(8, Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - w - 8));
    bar.style.top = `${top}px`;
    bar.style.left = `${left}px`;
  }

  async function create(color, note) {
    if (!pending) return;
    const p = pending;
    hide();
    window.getSelection()?.removeAllRanges();
    try {
      await docApi.add({ page: p.page, anchor: p.anchor, quote: p.quote, rects: p.rects, color, note: note || '', source: 'user' });
    } catch (e) { toast(e.message, { error: true }); }
  }

  bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection alive
  bar.addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (dot) { create(dot.dataset.color, bar.querySelector('textarea')?.value); return; }
    if (e.target.closest('.act-note')) {
      const b = pending.bounds;
      bar.classList.add('note-mode');
      bar.innerHTML = `<textarea placeholder="Why does this matter? (Markdown)"></textarea><div class="note-row"><span class="swatches">${swatches()}</span><span class="grow"></span><button class="tb-btn act-cancel">Cancel</button></div>`;
      place(b);
      const ta = bar.querySelector('textarea');
      setTimeout(() => ta.focus(), 0);
      ta.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') hide(); if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') create('yellow', ta.value); };
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
