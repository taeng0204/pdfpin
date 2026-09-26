// Document manager: ties the store, the pdf.js text index, the matcher and the SSE hub together.
import fs from 'node:fs';
import path from 'node:path';
import { openPdf, closePdf, getPageIndex, offsetsToAnchor, anchorToOffsets, approxRects, parsePages } from './pdftext.js';
import { search, rankByOverlap } from './matcher.js';
import { docIdFor } from './store.js';

export const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'];

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

export class DocManager {
  constructor(store, hub) {
    this.store = store;
    this.hub = hub;
    this.pdfs = new Map(); // docId -> { pdf, mtimeMs }
  }

  /** Open (or re-open) a PDF file and register it as the current document. */
  async open(filePath) {
    const abs = path.resolve(filePath);
    let st;
    try { st = fs.statSync(abs); } catch { throw new ApiError(404, `File not found: ${abs}`); }
    if (!st.isFile()) throw new ApiError(400, `Not a file: ${abs}`);
    let pdf;
    try { pdf = await openPdf(abs); } catch (e) { throw new ApiError(400, `Not a readable PDF: ${abs} (${e.message})`); }
    const prev = this.pdfs.get(docIdFor(abs));
    if (prev) await closePdf(prev.pdf);
    const doc = this.store.openDocument({ path: abs, title: pdf.title || path.basename(abs, '.pdf'), pages: pdf.numPages });
    this.pdfs.set(doc.id, { pdf, mtimeMs: st.mtimeMs });
    return doc;
  }

  resolve(ref) {
    const doc = this.store.resolve(ref);
    if (!doc) throw new ApiError(404, ref ? `No document matches "${ref}"` : 'No document is open. Run `pdfpin open <file.pdf>` first.');
    return doc;
  }

  /** pdf.js document for a stored record, re-opened when the file changed on disk. */
  async pdf(doc) {
    let st;
    try { st = fs.statSync(doc.path); } catch { throw new ApiError(404, `File no longer exists: ${doc.path}`); }
    const cached = this.pdfs.get(doc.id);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.pdf;
    if (cached) await closePdf(cached.pdf);
    const pdf = await openPdf(doc.path);
    this.pdfs.set(doc.id, { pdf, mtimeMs: st.mtimeMs });
    if (cached) this.hub.broadcast(doc.id, 'doc.reloaded', { id: doc.id, pages: pdf.numPages });
    return pdf;
  }

  async text(doc, pagesSpec) {
    const pdf = await this.pdf(doc);
    const pages = parsePages(pagesSpec, pdf.numPages);
    const out = [];
    for (const p of pages) out.push({ page: p, text: (await getPageIndex(pdf, p)).text });
    return out;
  }

  /** Locate a quote. Exact hits on any page first; fuzzy only on the most similar pages. */
  async find(doc, query, { page = null, fuzzy = true, limit = 50 } = {}) {
    if (!query || !collapse(query)) throw new ApiError(400, 'Query text is empty');
    const pdf = await this.pdf(doc);
    if (page !== null && (page < 1 || page > pdf.numPages)) throw new ApiError(400, `Page ${page} is out of range (1-${pdf.numPages})`);
    const pages = page ? [page] : parsePages(null, pdf.numPages);
    const indexes = [];
    for (const p of pages) indexes.push(await getPageIndex(pdf, p));
    let hits = [];
    for (const idx of indexes) for (const h of search(idx.text, query, { fuzzy: false })) hits.push(this._hit(idx, h));
    if (!hits.length && fuzzy) {
      const ranked = rankByOverlap(query, indexes).slice(0, page ? 1 : 4);
      for (const idx of ranked) for (const h of search(idx.text, query)) hits.push(this._hit(idx, h));
      hits.sort((a, b) => b.score - a.score);
    }
    return hits.slice(0, limit);
  }

  _hit(idx, h) {
    const anchor = offsetsToAnchor(idx, h.start, h.end);
    const { start, end } = anchorToOffsets(idx, anchor);
    const before = idx.text.slice(Math.max(0, start - 60), start);
    const after = idx.text.slice(end, end + 60);
    return {
      page: idx.page,
      start, end,
      score: +h.score.toFixed(3),
      exact: h.exact,
      anchor,
      quote: collapse(idx.text.slice(start, end)),
      context: collapse(`${before}[[${idx.text.slice(start, end)}]]${after}`),
    };
  }

  /** Nearest fuzzy candidates for an agent to retry with (used in 422 responses). */
  async suggestions(doc, query, page = null) {
    const pdf = await this.pdf(doc);
    const pages = page ? [page] : parsePages(null, pdf.numPages);
    const indexes = [];
    for (const p of pages) indexes.push(await getPageIndex(pdf, p));
    const ranked = rankByOverlap(query, indexes).slice(0, 3);
    const out = [];
    for (const idx of ranked) {
      const maxEdits = Math.ceil(collapse(query).length * 0.5);
      for (const h of search(idx.text, query, { maxEdits })) out.push(this._hit(idx, h));
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 3).map((h) => ({ page: h.page, score: h.score, context: h.context }));
  }

  _validateCommon(spec) {
    if (spec.color !== undefined && spec.color !== null && !COLORS.includes(spec.color)) {
      throw new ApiError(400, `Unknown color "${spec.color}". Use one of: ${COLORS.join(', ')}`);
    }
    for (const k of ['note', 'title', 'tag']) {
      if (spec[k] !== undefined && spec[k] !== null && typeof spec[k] !== 'string') throw new ApiError(400, `"${k}" must be a string`);
    }
  }

  /** Create one annotation from a spec. Returns { annotation, alternatives } or { annotations } with all=true. */
  async add(doc, spec) {
    if (!spec || typeof spec !== 'object') throw new ApiError(400, 'Annotation spec must be an object');
    this._validateCommon(spec);
    const page = spec.page === undefined || spec.page === null ? null : Number(spec.page);
    if (page !== null && !Number.isInteger(page)) throw new ApiError(400, '"page" must be an integer');

    if (spec.anchor) return { annotation: await this._addFromAnchor(doc, spec, page) };
    if (spec.rects && !spec.text) return { annotation: await this._addRect(doc, spec, page) };
    if (typeof spec.text !== 'string' || !collapse(spec.text)) throw new ApiError(400, '"text" (the quote to highlight) is required');

    const hits = await this.find(doc, spec.text, { page });
    if (!hits.length) {
      const suggestions = await this.suggestions(doc, spec.text, page);
      throw new ApiError(422, `Text not found${page ? ` on page ${page}` : ''}: "${collapse(spec.text).slice(0, 80)}"`, { suggestions });
    }
    const pdf = await this.pdf(doc);
    const create = async (h) => {
      const idx = await getPageIndex(pdf, h.page);
      const ann = this.store.addAnnotation(doc.id, {
        page: h.page, quote: h.quote, note: spec.note ?? '', title: spec.title ?? '', color: spec.color ?? 'yellow', tag: spec.tag ?? '',
        anchor: h.anchor, rects: approxRects(idx, h.anchor), rectsSource: 'approx', score: h.score, source: spec.source === 'user' ? 'user' : 'agent',
      });
      this.hub.broadcast(doc.id, 'annotation.added', { annotation: ann });
      return ann;
    };
    if (spec.all) {
      const annotations = [];
      for (const h of hits) annotations.push(await create(h));
      return { annotations };
    }
    const annotation = await create(hits[0]);
    const alternatives = hits.slice(1).map((h) => ({ page: h.page, context: h.context }));
    return { annotation, alternatives };
  }

  async _addFromAnchor(doc, spec, page) {
    if (!page) throw new ApiError(400, '"page" is required with "anchor"');
    const pdf = await this.pdf(doc);
    if (page < 1 || page > pdf.numPages) throw new ApiError(400, `Page ${page} is out of range`);
    const idx = await getPageIndex(pdf, page);
    const a = spec.anchor;
    const ok = [a.startItem, a.startChar, a.endItem, a.endChar].every(Number.isInteger)
      && a.startItem >= 0 && a.endItem < idx.items.length && a.startItem <= a.endItem;
    if (!ok) throw new ApiError(400, 'Invalid anchor');
    const { start, end } = anchorToOffsets(idx, a);
    const ann = this.store.addAnnotation(doc.id, {
      page, quote: spec.quote ?? collapse(idx.text.slice(start, end)), note: spec.note ?? '', title: spec.title ?? '', color: spec.color ?? 'yellow', tag: spec.tag ?? '',
      anchor: a, rects: spec.rects?.length ? spec.rects : approxRects(idx, a), rectsSource: spec.rects?.length ? 'dom' : 'approx', score: 1, source: spec.source ?? 'user',
    });
    this.hub.broadcast(doc.id, 'annotation.added', { annotation: ann });
    return ann;
  }

  async _addRect(doc, spec, page) {
    if (!page) throw new ApiError(400, '"page" is required with "rects"');
    const pdf = await this.pdf(doc);
    if (page < 1 || page > pdf.numPages) throw new ApiError(400, `Page ${page} is out of range`);
    const rects = spec.rects.map((r) => ({ x: +r.x, y: +r.y, w: +r.w, h: +r.h }));
    if (!rects.every((r) => [r.x, r.y, r.w, r.h].every(Number.isFinite))) throw new ApiError(400, 'Invalid rects');
    const ann = this.store.addAnnotation(doc.id, {
      page, quote: spec.quote ?? '', note: spec.note ?? '', title: spec.title ?? '', color: spec.color ?? 'yellow', tag: spec.tag ?? '',
      anchor: null, rects, rectsSource: 'dom', score: 1, source: spec.source ?? 'agent',
    });
    this.hub.broadcast(doc.id, 'annotation.added', { annotation: ann });
    return ann;
  }

  update(doc, annId, patch) {
    this._validateCommon(patch);
    const clean = {};
    for (const k of ['note', 'title', 'color', 'tag', 'quote']) if (patch[k] !== undefined) clean[k] = patch[k];
    if (Array.isArray(patch.rects)) {
      clean.rects = patch.rects.map((r) => ({ x: +r.x, y: +r.y, w: +r.w, h: +r.h }));
      clean.rectsSource = 'dom';
    }
    const ann = this.store.updateAnnotation(doc.id, annId, clean);
    if (!ann) throw new ApiError(404, `Annotation ${annId} not found`);
    this.hub.broadcast(doc.id, 'annotation.updated', { annotation: ann });
    return ann;
  }

  remove(doc, annId) {
    if (!this.store.removeAnnotation(doc.id, annId)) throw new ApiError(404, `Annotation ${annId} not found`);
    this.hub.broadcast(doc.id, 'annotation.removed', { id: annId });
  }

  clear(doc, { tag } = {}) {
    const removed = this.store.clearAnnotations(doc.id, { tag });
    this.hub.broadcast(doc.id, 'annotations.cleared', { tag: tag || null, removed });
    return removed;
  }

  setSummary(doc, summary) {
    const s = this.store.setSummary(doc.id, summary);
    this.hub.broadcast(doc.id, 'summary.updated', { summary: s });
    return s;
  }

  async focus(doc, { annotationId, page }) {
    const fresh = this.store.get(doc.id);
    if (annotationId) {
      const ann = fresh.annotations.find((a) => a.id === annotationId);
      if (!ann) throw new ApiError(404, `Annotation ${annotationId} not found`);
      this.hub.broadcast(doc.id, 'focus', { annotationId, page: ann.page });
      return { annotationId, page: ann.page };
    }
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1 || p > fresh.pages) throw new ApiError(400, `Page ${page} is out of range (1-${fresh.pages})`);
    this.hub.broadcast(doc.id, 'focus', { page: p });
    return { page: p };
  }

  async close() {
    for (const { pdf } of this.pdfs.values()) await closePdf(pdf);
    this.pdfs.clear();
  }
}
