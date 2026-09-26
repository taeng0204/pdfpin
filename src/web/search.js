// In-document search over the shared page text index; results drawn as light rects.
import { search } from '/shared/matcher.js';
import { offsetsToAnchor } from '/shared/pagetext.js';
import { icons } from './icons.js';
import { computeDomRects } from './highlights.js';

export function initSearch({ viewer, highlights }) {
  const box = document.getElementById('search');
  const input = document.getElementById('search-input');
  const count = document.getElementById('search-count');
  const btnOpen = document.getElementById('search-open');
  const btnPrev = document.getElementById('search-prev');
  const btnNext = document.getElementById('search-next');
  const btnClose = document.getElementById('search-close');
  btnOpen.innerHTML = icons.search; btnPrev.innerHTML = icons.up; btnNext.innerHTML = icons.down; btnClose.innerHTML = icons.close;

  let hits = [];
  let cur = -1;
  let timer = null;
  let lastQuery = '';

  function open() { box.dataset.open = 'true'; input.focus(); input.select(); }
  function close() { box.dataset.open = 'false'; input.value = ''; hits = []; cur = -1; count.textContent = ''; highlights.clearSearchHits(); viewer.viewerEl.focus(); }
  function toggle() { box.dataset.open === 'true' ? close() : open(); }

  async function run(q) {
    lastQuery = q;
    hits = [];
    cur = -1;
    if (!q.trim() || q.trim().length < 2) { count.textContent = ''; highlights.clearSearchHits(); return; }
    for (const ps of viewer.pages) {
      await ps.textReady;
      if (!ps.index || lastQuery !== q) continue;
      const found = search(ps.index.text, q, { fuzzy: false });
      if (found.length) await viewer.ensureFonts(ps);
      if (lastQuery !== q) continue;
      for (const h of found) {
        const anchor = offsetsToAnchor(ps.index, h.start, h.end);
        const rects = computeDomRects(ps, anchor);
        if (rects.length) hits.push({ page: ps.num, anchor, rects });
        if (hits.length >= 500) break;
      }
      if (hits.length >= 500) break;
    }
    if (lastQuery !== q) return;
    if (hits.length) { cur = 0; jump(0, { scroll: true }); } else { count.textContent = 'No results'; highlights.clearSearchHits(); }
  }

  function jump(i, { scroll = true } = {}) {
    if (!hits.length) return;
    cur = (i + hits.length) % hits.length;
    count.textContent = `${cur + 1} / ${hits.length}`;
    highlights.showSearchHits(hits, cur);
    if (scroll) viewer.scrollToRect(hits[cur].page, hits[cur].rects[0]);
  }

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
  viewer.viewerEl.addEventListener('scroll', () => {}, { passive: true });
  return { open, close, toggle, redraw: () => { if (hits.length) highlights.showSearchHits(hits, cur); } };
}
