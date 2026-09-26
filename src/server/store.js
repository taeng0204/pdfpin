// Persistent document + annotation store: one JSON file per document under <home>/docs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function docIdFor(filePath) {
  const norm = path.resolve(filePath).replace(/\\/g, '/');
  const key = process.platform === 'win32' ? norm.toLowerCase() : norm;
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
}

function shortId(prefix) {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export class Store {
  constructor(home) {
    this.home = home;
    this.docsDir = path.join(home, 'docs');
    fs.mkdirSync(this.docsDir, { recursive: true });
    this.stateFile = path.join(home, 'state.json');
    this.state = readJson(this.stateFile, { currentDocId: null });
    this.cache = new Map();
  }

  _file(id) {
    return path.join(this.docsDir, `${id}.json`);
  }

  _save(doc) {
    doc.updatedAt = new Date().toISOString();
    this.cache.set(doc.id, doc);
    writeJsonAtomic(this._file(doc.id), doc);
    return doc;
  }

  _saveState() {
    writeJsonAtomic(this.stateFile, this.state);
  }

  get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const doc = readJson(this._file(id), null);
    if (doc) this.cache.set(id, doc);
    return doc;
  }

  list() {
    const rows = [];
    for (const f of fs.readdirSync(this.docsDir)) {
      if (!f.endsWith('.json')) continue;
      const doc = this.get(f.slice(0, -5));
      if (!doc) continue;
      rows.push({
        id: doc.id,
        path: doc.path,
        title: doc.title,
        pages: doc.pages,
        openedAt: doc.openedAt,
        annotationCount: doc.annotations.length,
        current: doc.id === this.state.currentDocId,
      });
    }
    return rows.sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''));
  }

  current() {
    return this.state.currentDocId ? this.get(this.state.currentDocId) : null;
  }

  setCurrent(id) {
    this.state.currentDocId = id;
    this._saveState();
  }

  /** Find a document by id, absolute path, or bare file name. */
  resolve(ref) {
    if (!ref) return this.current();
    const byId = this.get(ref);
    if (byId) return byId;
    const abs = path.resolve(ref);
    const byPath = this.get(docIdFor(abs));
    if (byPath) return byPath;
    const name = path.basename(ref).toLowerCase();
    const rows = this.list().filter((d) => path.basename(d.path).toLowerCase() === name);
    return rows.length ? this.get(rows[0].id) : null;
  }

  openDocument({ path: filePath, title, pages }) {
    const id = docIdFor(filePath);
    const now = new Date().toISOString();
    let doc = this.get(id);
    if (!doc) {
      doc = { id, path: filePath, title: title || path.basename(filePath), pages, createdAt: now, openedAt: now, summary: null, annotations: [] };
    } else {
      doc.openedAt = now;
      if (title) doc.title = title;
      if (pages) doc.pages = pages;
    }
    this._save(doc);
    this.setCurrent(id);
    return doc;
  }

  addAnnotation(docId, fields) {
    const doc = this.get(docId);
    if (!doc) return null;
    const now = new Date().toISOString();
    const ann = {
      id: shortId('a'),
      page: fields.page,
      quote: fields.quote ?? '',
      note: fields.note ?? '',
      title: fields.title ?? '',
      color: fields.color ?? 'yellow',
      tag: fields.tag ?? '',
      source: fields.source ?? 'agent',
      anchor: fields.anchor ?? null,
      rects: fields.rects ?? [],
      rectsSource: fields.rectsSource ?? (fields.rects?.length ? 'dom' : 'none'),
      score: fields.score ?? 1,
      createdAt: now,
      updatedAt: now,
    };
    doc.annotations.push(ann);
    this._save(doc);
    return ann;
  }

  updateAnnotation(docId, annId, patch) {
    const doc = this.get(docId);
    if (!doc) return null;
    const ann = doc.annotations.find((a) => a.id === annId);
    if (!ann) return null;
    for (const k of ['note', 'title', 'color', 'tag', 'rects', 'rectsSource', 'quote']) {
      if (patch[k] !== undefined) ann[k] = patch[k];
    }
    ann.updatedAt = new Date().toISOString();
    this._save(doc);
    return ann;
  }

  removeAnnotation(docId, annId) {
    const doc = this.get(docId);
    if (!doc) return false;
    const before = doc.annotations.length;
    doc.annotations = doc.annotations.filter((a) => a.id !== annId);
    if (doc.annotations.length === before) return false;
    this._save(doc);
    return true;
  }

  clearAnnotations(docId, { tag } = {}) {
    const doc = this.get(docId);
    if (!doc) return 0;
    const keep = tag ? doc.annotations.filter((a) => a.tag !== tag) : [];
    const removed = doc.annotations.length - keep.length;
    doc.annotations = keep;
    this._save(doc);
    return removed;
  }

  setSummary(docId, summary) {
    const doc = this.get(docId);
    if (!doc) return null;
    doc.summary = summary ? { title: summary.title ?? '', body: summary.body ?? '' } : null;
    this._save(doc);
    return doc.summary;
  }
}
