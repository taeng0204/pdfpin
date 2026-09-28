// In-document search. Finding runs on the cheap page index; glyph rectangles are measured only for
// the pages whose text layer is currently built, so a hit on page 300 costs nothing until you go there.
import { search } from '/shared/matcher.js';
import { offsetsToAnchor } from '/shared/pagetext.js';
import { on } from './state.js';
import { t } from './i18n.js';
import { icons } from './icons.js';
import { computeDomRects } from './highlights.js';

const MAX_HITS = 500;

export function initSearch({ viewer, highlights }) {
  const box = document.getElementById('search');
  const input = document.getElementById('search-input');
  const count = document.getElementById('search-count');
  const btnOpen = document.getElementById('search-open');
  const btnPrev = document.getElementById('search-prev');
  const btnNext = document.getElementById('search-next');
  const btnClose = document.getElementById('search-close');
  btnOpen.innerHTML = icons.search; btnPrev.innerHTML = icons.up; btnNext.innerHTML = icons.down; btnClose.innerHTML = icons.close;

  let hits = [];   // [{ page, anchor }]
  let cur = -1;
  let timer = null;
  let lastQuery = '';

  function open() { box.dataset.open = 'true'; input.focus(); input.select(); }
  function close() {
    box.dataset.open = 'false';
    input.value = '';
    lastQuery = '';
    hits = [];
    cur = -1;
    count.textContent = '';
    highlights.clearSearchHits();
    viewer.viewerEl.focus();
  }
  const toggle = () => (box.dataset.open === 'true' ? close() : open());

  async function run(q) {
    lastQuery = q;
    hits = [];
    cur = -1;
    highlights.clearSearchHits();
    if (q.trim().length < 2) { count.textContent = ''; return; }
    count.textContent = '…';
    for (const ps of viewer.pages) {
      const index = await viewer.ensureIndex(ps);
      if (lastQuery !== q) return;
      for (const h of search(index.text, q, { fuzzy: false })) {
        hits.push({ page: ps.num, anchor: offsetsToAnchor(index, h.start, h.end) });
        if (hits.length >= MAX_HITS) break;
      }
      if (hits.length >= MAX_HITS) break;
    }
    if (lastQuery !== q) return;
    if (!hits.length) { count.textContent = t('search.noResults'); return; }
    await jump(0);
  }

  async function jump(i) {
    if (!hits.length) return;
    cur = (i + hits.length) % hits.length;
    count.textContent = `${cur + 1} / ${hits.length}`;
    const hit = hits[cur];
    let rects = rectsOf(hit);
    if (!rects.length) {
      try { await viewer.ensureTextLayer(viewer.pages[hit.page - 1]); } catch { /* keep going */ }
      rects = rectsOf(hit);
    }
    viewer.scrollToRect(hit.page, rects[0] || null);
    draw();
  }

  function rectsOf(hit) {
    const ps = viewer.pages[hit.page - 1];
    return ps?.textLayer ? computeDomRects(ps, hit.anchor) : [];
  }

  /** Paint the hits we can measure right now; pages that scroll in redraw themselves. */
  function draw() {
    if (!hits.length) return highlights.clearSearchHits();
    const drawable = [];
    hits.forEach((h, i) => {
      const rects = rectsOf(h);
      if (rects.length) drawable.push({ page: h.page, rects, current: i === cur });
    });
    highlights.showSearchHits(drawable);
  }

  let drawTimer = null;
  const redraw = () => { clearTimeout(drawTimer); drawTimer = setTimeout(draw, 60); };
  on('textlayer', redraw);
  on('scale', redraw);

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 160); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); jump(cur + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  });
  btnOpen.onclick = open;
  btnClose.onclick = close;
  btnPrev.onclick = () => jump(cur - 1);
  btnNext.onclick = () => jump(cur + 1);
  return { open, close, toggle, redraw };
}
