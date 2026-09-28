// Document manager: ties the store, the pdf.js text index, the matcher and the SSE hub together.
import fs from 'node:fs';
import path from 'node:path';
import { openPdf, closePdf, getPageIndex, offsetsToAnchor, anchorToOffsets, approxRects, parsePages } from './pdftext.js';
import { search, rankByOverlap } from '../shared/matcher.js';
import { docIdFor } from './store.js';
import { revealFile } from './reveal.js';
import { COLORS } from './palette.js';

export { COLORS } from './palette.js';
export const MAX_QUERY = 2000; // characters; keeps the fuzzy DP bounded
const MAX_OPEN_PDFS = 8;       // pdf.js documents kept in memory (LRU)

function cleanRects(rects, { allowEmpty = false } = {}) {
  if (!Array.isArray(rects) || (!rects.length && !allowEmpty) || rects.length > 500) throw new ApiError(400, 'Invalid rects');
  const out = rects.map((r) => ({ x: +r?.x, y: +r?.y, w: +r?.w, h: +r?.h }));
  if (!out.every((r) => [r.x, r.y, r.w, r.h].every(Number.isFinite))) throw new ApiError(400, 'Invalid rects');
  return out;
}

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

export class DocManager {
  constructor(store, hub, settings = null) {
    this.store = store;
    this.hub = hub;
    this.settings = settings;
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
    this._remember(doc.id, { pdf, mtimeMs: st.mtimeMs });
    this.hub.broadcastAll('docs.changed', { id: doc.id, action: 'opened' });
    return doc;
  }

  /** LRU bookkeeping for open pdf.js documents. */
  _remember(id, entry) {
    this.pdfs.delete(id);
    this.pdfs.set(id, entry);
    while (this.pdfs.size > MAX_OPEN_PDFS) {
      const [oldId, old] = this.pdfs.entries().next().value;
      this.pdfs.delete(oldId);
      closePdf(old.pdf);
    }
  }

  resolve(ref) {
    if (ref === 'current') ref = null;
    const doc = this.store.resolve(ref);
    if (!doc) throw new ApiError(404, ref ? `No document matches "${ref}"` : 'No document is open. Run `pdfpin open <file.pdf>` first.');
    return doc;
  }

  /** pdf.js document for a stored record, re-opened when the file changed on disk. */
  async pdf(doc) {
    let st;
    try { st = fs.statSync(doc.path); } catch { throw new ApiError(404, `File no longer exists: ${doc.path}`); }
    const cached = this.pdfs.get(doc.id);
    if (cached && cached.mtimeMs === st.mtimeMs) { this._remember(doc.id, cached); return cached.pdf; }
    if (cached) await closePdf(cached.pdf);
    const pdf = await openPdf(doc.path);
    this._remember(doc.id, { pdf, mtimeMs: st.mtimeMs });
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
    if (query.length > MAX_QUERY) throw new ApiError(400, `Query is too long (${query.length} chars, max ${MAX_QUERY})`);
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
      for (const h of search(idx.text, query, { maxEdits: Infinity })) out.push(this._hit(idx, h));
    }
    return out
      .filter((h) => h.score >= 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((h) => ({ page: h.page, score: h.score, context: h.context }));
  }

  /** Resolve the session an annotation should belong to: explicit id, null for none, or the document's current one. */
  _sessionFor(doc, spec) {
    if (spec.sessionId === null) return null;
    const fresh = this.store.get(doc.id);
    if (spec.sessionId === undefined) return fresh.currentSessionId ?? null;
    if (!fresh.sessions.some((s) => s.id === spec.sessionId)) throw new ApiError(404, `Session ${spec.sessionId} not found`);
    return spec.sessionId;
  }

  _palette() {
    const p = this.settings?.get().palette;
    return p?.length ? p : COLORS;
  }

  /** The colour a tag gets when nobody has said otherwise: its position among the document's tags. */
  _autoTagColor(fresh, tag) {
    if (!tag) return this._palette()[0];
    if (fresh.tagColors[tag]) return fresh.tagColors[tag];
    const order = [];
    for (const a of fresh.annotations) if (a.tag && !order.includes(a.tag)) order.push(a.tag);
    const i = order.indexOf(tag);
    const palette = this._palette();
    return palette[(i < 0 ? order.length : i) % palette.length];
  }

  _sessionColor(fresh, sessionId) {
    if (!sessionId) return null;
    if (fresh.sessionColors[sessionId]) return fresh.sessionColors[sessionId];
    return fresh.sessions.find((s) => s.id === sessionId)?.color ?? null;
  }

  /** Where an automatic colour comes from: the session it belongs to, or its tag. */
  _autoColor(fresh, { tag, sessionId }) {
    if ((this.settings?.get().colorBy ?? 'tag') === 'session') {
      const c = this._sessionColor(fresh, sessionId);
      if (c) return c;
    }
    return this._autoTagColor(fresh, (tag ?? '').trim());
  }

  /** The colour for a new highlight, plus whether it was chosen for us. */
  _colorFor(doc, spec) {
    const fresh = this.store.get(doc.id);
    if (spec.color) return { color: spec.color, colorAuto: false };
    return { color: this._autoColor(fresh, { tag: spec.tag, sessionId: spec.sessionId }), colorAuto: true };
  }

  /** The colour a new session takes: the first one no other session in this document is using. */
  _freshSessionColor(fresh) {
    const palette = this._palette();
    const taken = new Set(fresh.sessions.map((s) => s.color));
    return palette.find((c) => !taken.has(c)) ?? palette[fresh.sessions.length % palette.length];
  }

  /**
   * Repaint every highlight whose colour was assigned automatically. Colours the agent or the
   * reader chose by hand keep theirs. Returns the annotations that actually changed.
   */
  recolor(doc) {
    const fresh = this.store.get(doc.id);
    if (!fresh) return [];
    const changed = [];
    for (const a of fresh.annotations) {
      if (!a.colorAuto) continue;
      const next = this._autoColor(fresh, a);
      if (next && next !== a.color) { a.color = next; changed.push(a); }
    }
    if (changed.length) {
      this.store._save(fresh);
      this.hub.broadcast(doc.id, 'annotations.recolored', { annotations: fresh.annotations });
    }
    return changed;
  }

  /** Recolour every document; used when a rule that applies everywhere changes. */
  recolorAll() {
    for (const row of this.store.list()) this.recolor({ id: row.id });
  }

  /** Every tag in the document with what the reader needs to manage it. */
  tags(doc) {
    const fresh = this.store.get(doc.id);
    const out = new Map();
    for (const a of fresh.annotations) {
      if (!a.tag) continue;
      if (!out.has(a.tag)) out.set(a.tag, { tag: a.tag, count: 0, color: a.color, pinned: 0, override: fresh.tagColors[a.tag] ?? null });
      const row = out.get(a.tag);
      row.count++;
      if (a.colorAuto) row.color = a.color; else row.pinned++;
    }
    return [...out.values()];
  }

  /** Rename a tag (renaming onto an existing one merges them) and/or set its colour. */
  updateTag(doc, tag, { name, color }) {
    const fresh = this.store.get(doc.id);
    if (!fresh.annotations.some((a) => a.tag === tag)) throw new ApiError(404, `No highlight carries the tag "${tag}"`);
    if (color !== undefined && color !== null && !COLORS.includes(color)) throw new ApiError(400, `Unknown colour "${color}". Choose from: ${COLORS.join(', ')}`);
    let target = tag;
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) throw new ApiError(400, 'A tag needs a name');
      target = name.trim();
      if (target !== tag) {
        for (const a of fresh.annotations) if (a.tag === tag) a.tag = target;
        if (fresh.tagColors[tag] && !fresh.tagColors[target]) fresh.tagColors[target] = fresh.tagColors[tag];
        delete fresh.tagColors[tag];
      }
    }
    if (color !== undefined) {
      if (color === null) delete fresh.tagColors[target]; else fresh.tagColors[target] = color;
    }
    this.store._save(fresh);
    this.recolor(doc);
    this.hub.broadcast(doc.id, 'colors.changed', { tagColors: fresh.tagColors, sessionColors: fresh.sessionColors });
    return this.store.get(doc.id);
  }

  /** Take a tag off every highlight that carries it. The highlights stay. */
  removeTag(doc, tag) {
    const fresh = this.store.get(doc.id);
    const hit = fresh.annotations.filter((a) => a.tag === tag);
    if (!hit.length) throw new ApiError(404, `No highlight carries the tag "${tag}"`);
    for (const a of hit) a.tag = '';
    delete fresh.tagColors[tag];
    this.store._save(fresh);
    this.recolor(doc);
    this.hub.broadcast(doc.id, 'colors.changed', { tagColors: fresh.tagColors, sessionColors: fresh.sessionColors });
    return { doc: this.store.get(doc.id), updated: hit.length };
  }

  setColors(doc, { tags, sessions }) {
    const fresh = this.store.get(doc.id);
    for (const [k, v] of Object.entries({ ...tags, ...sessions })) {
      if (v !== null && !COLORS.includes(v)) throw new ApiError(400, `Unknown colour "${v}". Choose from: ${COLORS.join(', ')}`);
    }
    for (const id of Object.keys(sessions ?? {})) {
      if (!fresh.sessions.some((s) => s.id === id)) throw new ApiError(404, `Session ${id} not found`);
    }
    const updated = this.store.setColorOverrides(doc.id, { tags, sessions });
    this.recolor(doc);
    this.hub.broadcast(doc.id, 'colors.changed', { tagColors: updated.tagColors, sessionColors: updated.sessionColors });
    return this.store.get(doc.id);
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
    if (spec.text.length > MAX_QUERY) throw new ApiError(400, `"text" is too long (${spec.text.length} chars, max ${MAX_QUERY}); quote a sentence or a phrase`);

    const hits = await this.find(doc, spec.text, { page });
    if (!hits.length) {
      const suggestions = await this.suggestions(doc, spec.text, page);
      throw new ApiError(422, `Text not found${page ? ` on page ${page}` : ''}: "${collapse(spec.text).slice(0, 80)}"`, { suggestions });
    }
    const pdf = await this.pdf(doc);
    const sessionId = this._sessionFor(doc, spec);
    const { color, colorAuto } = this._colorFor(doc, { ...spec, sessionId });
    const create = async (h) => {
      const idx = await getPageIndex(pdf, h.page);
      const ann = this.store.addAnnotation(doc.id, {
        page: h.page, quote: h.quote, note: spec.note ?? '', title: spec.title ?? '', color, colorAuto, tag: spec.tag ?? '',
        anchor: h.anchor, rects: approxRects(idx, h.anchor), rectsSource: 'approx', score: h.score, source: spec.source === 'user' ? 'user' : 'agent', sessionId,
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
    const rects = spec.rects?.length ? cleanRects(spec.rects) : null;
    // people highlighting by hand are not part of an agent session unless they say so
    const sessionId = this._sessionFor(doc, { ...spec, sessionId: spec.sessionId === undefined ? null : spec.sessionId });
    const ann = this.store.addAnnotation(doc.id, {
      page, quote: spec.quote ?? collapse(idx.text.slice(start, end)), note: spec.note ?? '', title: spec.title ?? '', ...this._colorFor(doc, { ...spec, sessionId }), tag: spec.tag ?? '',
      anchor: a, rects: rects ?? approxRects(idx, a), rectsSource: rects ? 'dom' : 'approx', score: 1, source: spec.source ?? 'user', sessionId,
    });
    this.hub.broadcast(doc.id, 'annotation.added', { annotation: ann });
    return ann;
  }

  async _addRect(doc, spec, page) {
    if (!page) throw new ApiError(400, '"page" is required with "rects"');
    const pdf = await this.pdf(doc);
    if (page < 1 || page > pdf.numPages) throw new ApiError(400, `Page ${page} is out of range`);
    const rects = cleanRects(spec.rects);
    const sessionId = this._sessionFor(doc, spec);
    const ann = this.store.addAnnotation(doc.id, {
      page, quote: spec.quote ?? '', note: spec.note ?? '', title: spec.title ?? '', ...this._colorFor(doc, { ...spec, sessionId }), tag: spec.tag ?? '',
      anchor: null, rects, rectsSource: 'dom', score: 1, source: spec.source ?? 'agent', sessionId,
    });
    this.hub.broadcast(doc.id, 'annotation.added', { annotation: ann });
    return ann;
  }

  update(doc, annId, patch) {
    this._validateCommon(patch);
    const clean = {};
    for (const k of ['note', 'title', 'color', 'tag', 'quote']) if (patch[k] !== undefined) clean[k] = patch[k];
    if (patch.color !== undefined) clean.colorAuto = false;
    else if (patch.tag !== undefined) {
      // naming a topic means "colour me like that topic", so the rule takes over again
      clean.colorAuto = true;
      const fresh = this.store.get(doc.id);
      const current = fresh.annotations.find((a) => a.id === annId);
      clean.color = this._autoColor(fresh, { tag: patch.tag, sessionId: current?.sessionId });
    }
    if (patch.sessionId !== undefined) clean.sessionId = this._sessionFor(doc, { sessionId: patch.sessionId });
    if (Array.isArray(patch.rects)) {
      clean.rects = cleanRects(patch.rects, { allowEmpty: true });
      clean.rectsSource = clean.rects.length ? 'dom' : 'none';
    }
    const ann = this.store.updateAnnotation(doc.id, annId, clean);
    if (!ann) throw new ApiError(404, `Annotation ${annId} not found`);
    this.hub.broadcast(doc.id, 'annotation.updated', { annotation: ann });
    return ann;
  }

  remove(doc, annId) {
    const owner = this.store.get(doc.id)?.annotations.find((a) => a.id === annId)?.sessionId ?? null;
    if (!this.store.removeAnnotation(doc.id, annId)) throw new ApiError(404, `Annotation ${annId} not found`);
    this.hub.broadcast(doc.id, 'annotation.removed', { id: annId });
    if (owner) this._pruneEmptySessions(doc, [owner]);
  }

  clear(doc, { tag } = {}) {
    const removed = this.store.clearAnnotations(doc.id, { tag });
    this.hub.broadcast(doc.id, 'annotations.cleared', { tag: tag || null, removed });
    this._pruneEmptySessions(doc);
    return removed;
  }

  /** A session with nothing left in it has no reason to stay. */
  _pruneEmptySessions(doc, only = null) {
    const fresh = this.store.get(doc.id);
    if (!fresh) return;
    const candidates = only ?? fresh.sessions.map((s) => s.id);
    for (const id of candidates) {
      if (!fresh.sessions.some((s) => s.id === id)) continue;
      if (fresh.annotations.some((a) => a.sessionId === id)) continue;
      this.store.removeSession(fresh.id, id);
      this.hub.broadcast(doc.id, 'session.removed', { id, removedAnnotations: 0, currentSessionId: this.store.get(doc.id).currentSessionId });
    }
  }

  /** Create a session, optionally with its highlights. Highlights that fail to match do not abort the rest. */
  async addSession(doc, spec) {
    if (!spec || typeof spec !== 'object') throw new ApiError(400, 'Session spec must be an object');
    for (const k of ['title', 'flow']) if (spec[k] !== undefined && spec[k] !== null && typeof spec[k] !== 'string') throw new ApiError(400, `"${k}" must be a string`);
    if (spec.highlights !== undefined && !Array.isArray(spec.highlights)) throw new ApiError(400, '"highlights" must be an array');
    const color = this._freshSessionColor(this.store.get(doc.id));
    const session = this.store.addSession(doc.id, { title: spec.title ?? '', flow: spec.flow ?? '', color, source: spec.source === 'user' ? 'user' : 'agent' });
    this.hub.broadcast(doc.id, 'session.added', { session });
    const results = [];
    for (const h of spec.highlights ?? []) {
      try {
        results.push({ ok: true, ...(await this.add(doc, { ...h, sessionId: session.id })) });
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        results.push({ ok: false, error: e.message, ...e.extra, spec: { text: h?.text, page: h?.page } });
      }
    }
    return { session, results, added: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  updateSession(doc, sessionId, patch) {
    for (const k of ['title', 'flow']) if (patch[k] !== undefined && typeof patch[k] !== 'string') throw new ApiError(400, `"${k}" must be a string`);
    if (patch.archived !== undefined && typeof patch.archived !== 'boolean') throw new ApiError(400, '"archived" must be true or false');
    const session = this.store.updateSession(doc.id, sessionId, patch);
    if (!session) throw new ApiError(404, `Session ${sessionId} not found`);
    this.hub.broadcast(doc.id, 'session.updated', { session });
    return session;
  }

  removeSession(doc, sessionId) {
    const removed = this.store.removeSession(doc.id, sessionId);
    if (removed < 0) throw new ApiError(404, `Session ${sessionId} not found`);
    this.hub.broadcast(doc.id, 'session.removed', { id: sessionId, removedAnnotations: removed, currentSessionId: this.store.get(doc.id).currentSessionId });
    return removed;
  }

  useSession(doc, sessionId) {
    if (sessionId !== null && !this.store.getSession(doc.id, sessionId)) throw new ApiError(404, `Session ${sessionId} not found`);
    this.store.setCurrentSession(doc.id, sessionId);
    this.hub.broadcast(doc.id, 'session.current', { currentSessionId: sessionId });
    return sessionId;
  }

  async focus(doc, { annotationId, page, sessionId }) {
    const fresh = this.store.get(doc.id);
    if (sessionId) {
      const first = fresh.annotations.find((a) => a.sessionId === sessionId);
      if (!fresh.sessions.some((s) => s.id === sessionId)) throw new ApiError(404, `Session ${sessionId} not found`);
      this.hub.broadcast(doc.id, 'focus', { sessionId, annotationId: first?.id, page: first?.page });
      return { sessionId, page: first?.page ?? null };
    }
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

  activate(doc) {
    const d = this.store.activate(doc.id);
    this.hub.broadcastAll('docs.changed', { id: doc.id, action: 'activated' });
    return d;
  }

  reveal(doc) {
    return { launched: revealFile(doc.path), path: doc.path };
  }

  async removeDocument(docRecord) {
    const cached = this.pdfs.get(docRecord.id);
    if (cached) { this.pdfs.delete(docRecord.id); await closePdf(cached.pdf); }
    this.store.removeDocument(docRecord.id);
    this.hub.broadcast(docRecord.id, 'doc.removed', { id: docRecord.id });
    this.hub.broadcastAll('docs.changed', { id: docRecord.id, action: 'removed' });
  }

  async close() {
    for (const { pdf } of this.pdfs.values()) await closePdf(pdf);
    this.pdfs.clear();
  }
}
