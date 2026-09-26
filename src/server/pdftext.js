// PDF text index built on pdf.js: page text with an offset map back to text items, plus geometry helpers.
import fs from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const SPACE_GAP = 0.1; // fraction of font height that counts as a word gap between adjacent items

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

/**
 * Text index for one page.
 * items: pdf.js text items that own a string (same set/order as TextLayer.textDivs).
 * text:  concatenated page text; map: itemOf/charOf per raw offset (separators map to item end).
 */
export async function getPageIndex(doc, pageNo) {
  if (doc._pages.has(pageNo)) return doc._pages.get(pageNo);
  const page = await doc.pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (it.str === undefined) continue;
    items.push({ str: it.str, hasEOL: !!it.hasEOL, transform: it.transform, width: it.width, height: it.height });
  }
  let text = '';
  const itemOf = [];
  const charOf = [];
  const itemStart = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    itemStart.push(text.length);
    for (let c = 0; c < it.str.length; c++) { itemOf.push(i); charOf.push(c); }
    text += it.str;
    const sep = separatorAfter(items, i);
    if (sep) { text += sep; itemOf.push(i); charOf.push(it.str.length); }
  }
  const index = { page: pageNo, text, items, itemOf, charOf, itemStart, viewport, rotation: viewport.rotation };
  doc._pages.set(pageNo, index);
  return index;
}

function separatorAfter(items, i) {
  const it = items[i];
  if (it.hasEOL) return '\n';
  const next = items[i + 1];
  if (!next || !it.str || !next.str) return '';
  if (/\s$/.test(it.str) || /^\s/.test(next.str)) return '';
  const h = Math.max(it.height, next.height, 1);
  const sameLine = Math.abs(it.transform[5] - next.transform[5]) < h * 0.5;
  if (!sameLine) return '\n';
  const gap = next.transform[4] - (it.transform[4] + it.width);
  return gap > h * SPACE_GAP ? ' ' : '';
}

/** Raw [start, end) offsets → { startItem, startChar, endItem, endChar } (end exclusive within item). */
export function offsetsToAnchor(index, start, end) {
  const { itemOf, charOf, items } = index;
  let s = start;
  // a match never starts on a separator; skip to the next item's first char
  while (s < end && charOf[s] === items[itemOf[s]].str.length) s++;
  let e = end - 1;
  while (e > s && charOf[e] === items[itemOf[e]].str.length) e--;
  return { startItem: itemOf[s], startChar: charOf[s], endItem: itemOf[e], endChar: charOf[e] + 1 };
}

export function anchorToOffsets(index, a) {
  return { start: index.itemStart[a.startItem] + a.startChar, end: index.itemStart[a.endItem] + a.endChar };
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
    rects.push(norm({ x: Math.min(vx1, vx2), y: Math.min(vy1, vy2), w: Math.abs(vx2 - vx1), h: Math.abs(vy2 - vy1) }));
  }
  return mergeLineRects(rects);
}

function norm(r) {
  return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) };
}

/** Merge rects that sit on the same line and touch or overlap horizontally. */
export function mergeLineRects(rects) {
  const out = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5 && r.x <= last.x + last.w + Math.max(last.h, r.h) * 0.6 && r.x + r.w >= last.x - 1) {
      const x = Math.min(last.x, r.x);
      const y = Math.min(last.y, r.y);
      const x2 = Math.max(last.x + last.w, r.x + r.w);
      const y2 = Math.max(last.y + last.h, r.y + r.h);
      out[out.length - 1] = norm({ x, y, w: x2 - x, h: y2 - y });
    } else {
      out.push(r);
    }
  }
  return out;
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
