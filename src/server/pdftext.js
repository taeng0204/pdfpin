// PDF text index built on pdf.js in Node: page text with an offset map back to text items, plus geometry helpers.
import fs from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { textItems, buildPageText, mergeLineRects, round } from '../shared/pagetext.js';

export { offsetsToAnchor, anchorToOffsets, mergeLineRects } from '../shared/pagetext.js';

export async function openPdf(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await pdfjs.getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;
  let title = '';
  try {
    const meta = await pdf.getMetadata();
    title = (meta?.info?.Title || '').trim();
  } catch { /* metadata is optional */ }
  return { path: filePath, numPages: pdf.numPages, title, pdf, _pages: new Map() };
}

export async function closePdf(doc) {
  try { await doc.pdf.destroy(); } catch { /* ignore */ }
}

/** Text index for one page (cached per document). */
export async function getPageIndex(doc, pageNo) {
  if (doc._pages.has(pageNo)) return doc._pages.get(pageNo);
  const page = await doc.pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1 });
  const items = textItems(await page.getTextContent());
  const index = { page: pageNo, items, ...buildPageText(items), viewport, rotation: viewport.rotation };
  doc._pages.set(pageNo, index);
  return index;
}

/** Approximate highlight rects (page units at scale 1, top-left origin) from item geometry. */
export function approxRects(index, a) {
  const rects = [];
  for (let i = a.startItem; i <= a.endItem; i++) {
    const it = index.items[i];
    const len = it.str.length;
    if (!len || !it.width) continue;
    const c0 = i === a.startItem ? a.startChar : 0;
    const c1 = i === a.endItem ? a.endChar : len;
    if (c1 <= c0) continue;
    const [sx, , , sy, x0, y0] = it.transform;
    const h = it.height || Math.hypot(sx, sy);
    const x1 = x0 + (it.width * c0) / len;
    const x2 = x0 + (it.width * c1) / len;
    const [vx1, vy1] = index.viewport.convertToViewportPoint(x1, y0 - 0.22 * h);
    const [vx2, vy2] = index.viewport.convertToViewportPoint(x2, y0 + 0.78 * h);
    rects.push(round({ x: Math.min(vx1, vx2), y: Math.min(vy1, vy2), w: Math.abs(vx2 - vx1), h: Math.abs(vy2 - vy1) }));
  }
  return mergeLineRects(rects);
}

/** Viewer rect (top-left origin, scale 1) → PDF user-space [x1, y1, x2, y2]. */
export function toPdfRect(index, r) {
  const [ax, ay] = index.viewport.convertToPdfPoint(r.x, r.y);
  const [bx, by] = index.viewport.convertToPdfPoint(r.x + r.w, r.y + r.h);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** Parse "1-3,7" style page selections into a sorted unique array within [1, max]. */
export function parsePages(spec, max) {
  if (!spec) return Array.from({ length: max }, (_, i) => i + 1);
  const set = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`Invalid page selection: "${part.trim()}"`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (p >= 1 && p <= max) set.add(p);
  }
  return [...set].sort((x, y) => x - y);
}
