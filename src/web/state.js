// Shared viewer state + a tiny event bus.
const listeners = new Map();
export const on = (evt, fn) => { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); };
export const emit = (evt, data) => { for (const fn of listeners.get(evt) || []) fn(data); };

const pref = (k, d) => { try { const v = localStorage.getItem(`pdfpin:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } };
export const savePref = (k, v) => { try { localStorage.setItem(`pdfpin:${k}`, JSON.stringify(v)); } catch { /* private mode */ } };

export const state = {
  docId: null,
  doc: null,
  annotations: new Map(),
  selectedId: null,
  filter: { text: '', tags: new Set(), colors: new Set() },
  currentPage: 1,
  theme: pref('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  dim: pref('dim', true),
  panelOpen: pref('panel', true),
  zoomMode: pref('zoom', 'fit-width'),
};

export const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'];

export function setAnnotations(list) {
  state.annotations = new Map(list.map((a) => [a.id, a]));
  emit('annotations');
}
export function upsertAnnotation(a, { fresh = false } = {}) {
  state.annotations.set(a.id, { ...a, _fresh: fresh });
  emit('annotations');
  emit('annotation:upsert', a);
}
export function dropAnnotation(id) {
  if (!state.annotations.delete(id)) return;
  if (state.selectedId === id) state.selectedId = null;
  emit('annotations');
  emit('annotation:remove', id);
}
export function select(id, opts = {}) {
  state.selectedId = id;
  emit('select', { id, ...opts });
}

/** Annotations that pass the panel filters, in page/position order. */
export function visibleAnnotations() {
  const { text, tags, colors } = state.filter;
  const q = text.trim().toLowerCase();
  return [...state.annotations.values()]
    .filter((a) => (!tags.size || tags.has(a.tag || '')) && (!colors.size || colors.has(a.color)))
    .filter((a) => !q || `${a.quote} ${a.note} ${a.title} ${a.tag}`.toLowerCase().includes(q))
    .sort(byPosition);
}
export function orderedAnnotations() { return [...state.annotations.values()].sort(byPosition); }
export function byPosition(a, b) {
  if (a.page !== b.page) return a.page - b.page;
  const ay = a.rects?.[0]?.y ?? 0, by = b.rects?.[0]?.y ?? 0;
  if (Math.abs(ay - by) > 2) return ay - by;
  return (a.rects?.[0]?.x ?? 0) - (b.rects?.[0]?.x ?? 0);
}
