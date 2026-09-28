// Evidence strip: a slim minimap of highlight positions along the right edge of the viewer.
import { state, on, select, orderedAnnotations } from './state.js';
import { ellipsis } from './text.js';

export function initStrip({ viewer }) {
  const strip = document.getElementById('strip');
  const view = document.getElementById('strip-view');
  let marks = new Map();

  function layout() {
    const total = viewer.pagesEl.scrollHeight || 1;
    const H = strip.clientHeight || viewer.viewerEl.clientHeight;
    for (const m of marks.values()) m.remove();
    marks = new Map();
    const all = orderedAnnotations();
    strip.hidden = !all.length;
    for (const a of all) {
      const ps = viewer.pages[a.page - 1];
      if (!ps) continue;
      const r = a.rects?.[0];
      const y = ps.el.offsetTop + (r ? r.y * viewer.scale : 0);
      const el = document.createElement('div');
      el.className = `strip-mark hl-color-${a.color}${a.id === state.selectedId ? ' selected' : ''}`;
      el.style.top = `${Math.min(H - 3, (y / total) * H)}px`;
      el.title = `p.${a.page} — ${ellipsis(a.title || a.note || a.quote || '', 80)}`;
      el.dataset.id = a.id;
      strip.appendChild(el);
      marks.set(a.id, el);
    }
    updateView();
  }
  function updateView() {
    const el = viewer.viewerEl;
    const total = el.scrollHeight || 1;
    const H = strip.clientHeight || el.clientHeight;
    view.style.top = `${(el.scrollTop / total) * H}px`;
    view.style.height = `${Math.max(6, (el.clientHeight / total) * H)}px`;
  }
  strip.addEventListener('click', (e) => {
    const m = e.target.closest('.strip-mark');
    if (m) { select(m.dataset.id, { from: 'strip' }); return; }
    const H = strip.clientHeight;
    const y = (e.clientY - strip.getBoundingClientRect().top) / H;
    viewer.viewerEl.scrollTo({ top: y * viewer.viewerEl.scrollHeight - viewer.viewerEl.clientHeight / 2, behavior: 'smooth' });
  });
  on('annotations', layout);
  on('rects', layout);
  on('scale', () => setTimeout(layout, 50));
  on('scroll', updateView);
  on('select', ({ id }) => { for (const [k, m] of marks) m.classList.toggle('selected', k === id); });
  new ResizeObserver(layout).observe(viewer.viewerEl);
  layout();
}
