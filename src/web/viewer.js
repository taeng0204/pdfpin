// PDF rendering: page shells for every page, lazy hi-DPI canvases, eager text layers, zoom.
import { textItems, buildPageText } from '/shared/pagetext.js';
import { state, emit, savePref } from './state.js';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const GAP = 22;

export async function initViewer({ viewerEl, pagesEl, fileUrl }) {
  const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
  const pdf = await pdfjs.getDocument({ url: fileUrl, isEvalSupported: false }).promise;

  const v = {
    pdf, pdfjs, pages: [], scale: 1, maxBaseW: 0, maxBaseH: 0,
    viewerEl, pagesEl,
  };

  // Page shells first so the document has its final height immediately.
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const el = document.createElement('div');
    el.className = 'page unrendered';
    el.dataset.page = n;
    el.style.animationDelay = `${Math.min(n - 1, 6) * 40}ms`;
    el.innerHTML = `<canvas></canvas><div class="textLayer"></div><div class="hl-layer"></div><span class="page-num">${n}</span>`;
    pagesEl.appendChild(el);
    const ps = {
      num: n, page, base: { w: vp.width, h: vp.height }, userUnit: vp.userUnit || 1, el,
      canvas: el.querySelector('canvas'), textEl: el.querySelector('.textLayer'), hlEl: el.querySelector('.hl-layer'),
      textLayer: null, items: null, index: null, spanIndex: new WeakMap(), rendered: 0, renderTask: null, visible: false,
    };
    ps.textReady = new Promise((r) => { ps._resolveText = r; });
    v.pages.push(ps);
    v.maxBaseW = Math.max(v.maxBaseW, vp.width);
    v.maxBaseH = Math.max(v.maxBaseH, vp.height);
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const ps = v.pages[Number(e.target.dataset.page) - 1];
      ps.visible = e.isIntersecting;
      if (e.isIntersecting) renderCanvas(v, ps);
      else if (ps.rendered) releaseCanvas(ps);
    }
  }, { root: viewerEl, rootMargin: '900px 0px' });

  applyScale(v, computeScale(v, state.zoomMode));
  for (const ps of v.pages) io.observe(ps.el);

  // Text layers are cheap and needed for anchors/search: build them all, first pages first.
  (async () => {
    for (const ps of v.pages) {
      try { await buildTextLayer(v, ps); } catch (err) { console.error('text layer', ps.num, err); ps._resolveText(); }
    }
  })();

  let ticking = false;
  viewerEl.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; updateCurrentPage(v); emit('scroll'); });
  }, { passive: true });

  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.zoomMode !== 'custom') setZoom(v, state.zoomMode, { keep: true }); }, 80);
  }).observe(viewerEl);

  viewerEl.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomStep(v, e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  v.ensureFonts = (ps) => ensureFonts(v, ps);
  v.setZoom = (mode, opts) => setZoom(v, mode, opts);
  v.zoomStep = (dir) => zoomStep(v, dir);
  v.scrollToPage = (n) => scrollToPage(v, n);
  v.scrollToRect = (n, rect, opts) => scrollToRect(v, n, rect, opts);
  v.pageOf = (el) => { const p = el?.closest?.('.page'); return p ? v.pages[Number(p.dataset.page) - 1] : null; };
  v.pageScale = (ps) => ps.el.getBoundingClientRect().width / ps.base.w || v.scale;
  v.docHeight = () => pagesEl.scrollHeight;
  return v;
}

function computeScale(v, mode) {
  const padX = 26 + 34;
  const availW = Math.max(200, v.viewerEl.clientWidth - padX);
  const availH = Math.max(200, v.viewerEl.clientHeight - 52);
  if (mode === 'fit-page') return Math.min(availW / v.maxBaseW, availH / v.maxBaseH);
  if (typeof mode === 'number') return mode;
  return Math.min(availW / v.maxBaseW, 2.5);
}

function applyScale(v, scale) {
  v.scale = scale;
  for (const ps of v.pages) {
    ps.el.style.width = `${Math.floor(ps.base.w * scale)}px`;
    ps.el.style.height = `${Math.floor(ps.base.h * scale)}px`;
    ps.el.style.setProperty('--scale-factor', scale);
    ps.el.style.setProperty('--user-unit', ps.userUnit);
    ps.hlEl.style.width = `${ps.base.w}px`;
    ps.hlEl.style.height = `${ps.base.h}px`;
  }
  emit('scale', scale);
}

function setZoom(v, mode, { keep = true } = {}) {
  const el = v.viewerEl;
  // remember where we are relative to the current page so the same text stays in view
  const cur = v.pages[state.currentPage - 1] || v.pages[0];
  const before = cur ? (el.scrollTop - cur.el.offsetTop) / (cur.el.offsetHeight || 1) : 0;
  state.zoomMode = typeof mode === 'number' ? 'custom' : mode;
  savePref('zoom', state.zoomMode === 'custom' ? 'fit-width' : state.zoomMode);
  applyScale(v, computeScale(v, mode));
  if (keep && cur) el.scrollTop = cur.el.offsetTop + before * cur.el.offsetHeight;
  for (const ps of v.pages) if (ps.visible) renderCanvas(v, ps);
}

function zoomStep(v, dir) {
  const cur = v.scale;
  let next;
  if (dir > 0) next = ZOOM_STEPS.find((s) => s > cur + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  else next = [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.01) ?? ZOOM_STEPS[0];
  setZoom(v, next);
}

async function renderCanvas(v, ps) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = v.scale;
  const key = `${scale.toFixed(4)}@${dpr}`;
  if (ps.rendered === key || ps.rendering === key) return;
  if (ps.renderTask) { ps.renderTask.cancel(); ps.renderTask = null; }
  ps.rendering = key;
  const vp = ps.page.getViewport({ scale: scale * dpr });
  const maxDim = 8192;
  const clamp = Math.min(1, maxDim / Math.max(vp.width, vp.height));
  const rvp = clamp < 1 ? ps.page.getViewport({ scale: scale * dpr * clamp }) : vp;
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(rvp.width);
  canvas.height = Math.floor(rvp.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  const task = ps.page.render({ canvasContext: ctx, viewport: rvp });
  ps.renderTask = task;
  try {
    await task.promise;
  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return;
    console.error('render', ps.num, e);
    return;
  } finally {
    if (ps.renderTask === task) ps.renderTask = null;
    if (ps.rendering === key) ps.rendering = null;
  }
  if (Math.abs(v.scale - scale) > 1e-6) return; // zoom changed meanwhile; a newer render is on its way
  ps.canvas.replaceWith(canvas);
  ps.canvas = canvas;
  ps.rendered = key;
  ps.el.classList.remove('unrendered');
  ensureFonts(v, ps); // fonts are loaded now; relayout the text layer once if it predates them
}

function releaseCanvas(ps) {
  const blank = document.createElement('canvas');
  ps.canvas.replaceWith(blank);
  ps.canvas = blank;
  ps.rendered = 0;
  ps.el.classList.add('unrendered');
}

async function buildTextLayer(v, ps) {
  const content = ps.content || (ps.content = await ps.page.getTextContent());
  if (!ps.items) {
    ps.items = textItems(content);
    ps.index = { page: ps.num, items: ps.items, ...buildPageText(ps.items) };
  }
  ps.textLayer?.cancel();
  ps.textEl.replaceChildren();
  const tl = new v.pdfjs.TextLayer({ textContentSource: content, container: ps.textEl, viewport: ps.page.getViewport({ scale: v.scale }) });
  await tl.render();
  ps.textLayer = tl;
  ps.spanIndex = new WeakMap();
  tl.textDivs.forEach((div, i) => ps.spanIndex.set(div, i));
  ps.textLayerFonts = ps.fontsReady;
  ps._resolveText();
  emit('textlayer', ps);
}

/**
 * Make sure the page's embedded fonts are loaded and the text layer was laid out with them.
 * Fetching the operator list is what makes pdf.js load fonts; it is cached, so pages that were
 * rendered already pay nothing. Only pages with highlights or search hits need this.
 */
async function ensureFonts(v, ps) {
  if (ps.fontsReady) { await ps.fontsJob; return; }
  if (!ps.fontsJob) {
    ps.fontsJob = (async () => {
      try { await ps.page.getOperatorList(); } catch { /* rendering will surface the error */ }
      try { await document.fonts.ready; } catch { /* ignore */ }
      ps.fontsReady = true;
      await ps.textReady;
      if (!ps.textLayerFonts) await buildTextLayer(v, ps);
    })();
  }
  await ps.fontsJob;
}

function updateCurrentPage(v) {
  const el = v.viewerEl;
  const mid = el.scrollTop + el.clientHeight * 0.4;
  let best = 1;
  for (const ps of v.pages) {
    if (ps.el.offsetTop <= mid) best = ps.num; else break;
  }
  if (best !== state.currentPage) { state.currentPage = best; emit('page', best); }
}

function scrollToPage(v, n) {
  const ps = v.pages[n - 1];
  if (!ps) return;
  v.viewerEl.scrollTo({ top: Math.max(0, ps.el.offsetTop - GAP), behavior: 'smooth' });
}

function scrollToRect(v, n, rect, { behavior = 'smooth' } = {}) {
  const ps = v.pages[n - 1];
  if (!ps) return;
  const el = v.viewerEl;
  const y = ps.el.offsetTop + (rect ? rect.y * v.scale : 0);
  const target = rect ? y - el.clientHeight * 0.33 : y - GAP;
  const within = rect && y > el.scrollTop + 80 && y + rect.h * v.scale < el.scrollTop + el.clientHeight - 80;
  if (!within) el.scrollTo({ top: Math.max(0, target), behavior });
}
