// Page text index shared by the server (pdf.js in Node) and the viewer (pdf.js in the browser).
// Both build the same text from the same items, so offsets and anchors line up exactly.

const SPACE_GAP = 0.1; // fraction of font height that counts as a word gap between adjacent items

/** Keep only pdf.js text items that own a string (the set that becomes TextLayer.textDivs). */
export function textItems(content) {
  const items = [];
  for (const it of content.items) {
    if (it.str === undefined) continue;
    items.push({ str: it.str, hasEOL: !!it.hasEOL, transform: it.transform, width: it.width, height: it.height });
  }
  return items;
}

export function separatorAfter(items, i) {
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

/** { text, itemOf, charOf, itemStart } for a list of items. Separators map to the item's end. */
export function buildPageText(items) {
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
  return { text, itemOf, charOf, itemStart };
}

/** Raw [start, end) offsets → { startItem, startChar, endItem, endChar } (end exclusive within item). */
export function offsetsToAnchor(index, start, end) {
  const { itemOf, charOf, items } = index;
  let s = start;
  while (s < end && charOf[s] === items[itemOf[s]].str.length) s++;
  let e = end - 1;
  while (e > s && charOf[e] === items[itemOf[e]].str.length) e--;
  return { startItem: itemOf[s], startChar: charOf[s], endItem: itemOf[e], endChar: charOf[e] + 1 };
}

export function anchorToOffsets(index, a) {
  return { start: index.itemStart[a.startItem] + a.startChar, end: index.itemStart[a.endItem] + a.endChar };
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
      out[out.length - 1] = round({ x, y, w: x2 - x, h: y2 - y });
    } else {
      out.push(round(r));
    }
  }
  return out;
}

export function round(r) {
  return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) };
}
