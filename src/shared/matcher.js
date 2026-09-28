// Text normalisation and exact/fuzzy substring search used to anchor agent quotes in page text.
// All public functions return offsets into the *raw* string that was passed in.

const QUOTES = { '“': '"', '”': '"', '„': '"', '″': '"', '‘': "'", '’': "'", '‚': "'", '′': "'" };
const DASHES = new Set(['‐', '‑', '‒', '–', '—', '―', '−', '­']);
const WS = /\s/;
const LETTER = /\p{L}/u;
const MARK = /^\p{M}+$/u;

/**
 * Normalise text for matching.
 * Returns { text, map } where map[i] is the raw index of the code point that produced text[i].
 */
export function normalize(raw) {
  // Pass 1: per-code-point canonicalisation (ligatures, quotes, dashes, case, whitespace class).
  const chars = []; // { ch, raw, ws }
  let rawIdx = 0;
  for (const cp of raw) {
    let out;
    if (WS.test(cp) || cp === ' ' || cp === '​') {
      out = ' ';
    } else if (QUOTES[cp]) {
      out = QUOTES[cp];
    } else if (DASHES.has(cp)) {
      out = '-';
    } else if (MARK.test(cp)) {
      out = ''; // combining accents: "é" and "e + ◌́" should match
    } else {
      out = cp.normalize('NFKC').toLowerCase();
    }
    for (const c of out) if (!MARK.test(c)) chars.push({ ch: c, raw: rawIdx, ws: c === ' ' });
    rawIdx += cp.length;
  }

  // Pass 2: collapse whitespace, trim, and join words hyphenated across a break ("gener-\nating").
  let text = '';
  const map = [];
  let i = 0;
  const n = chars.length;
  while (i < n) {
    const c = chars[i];
    if (c.ws) {
      let j = i;
      while (j < n && chars[j].ws) j++;
      if (text.length > 0 && j < n) {
        text += ' ';
        map.push(c.raw);
      }
      i = j;
      continue;
    }
    if (c.ch === '-' && text.length > 0 && LETTER.test(text[text.length - 1])) {
      let j = i + 1;
      while (j < n && chars[j].ws) j++;
      if (j > i + 1 && j < n && LETTER.test(chars[j].ch) && chars[j].ch === chars[j].ch.toLowerCase()) {
        i = j; // drop the hyphen and the line break
        continue;
      }
    }
    text += c.ch;
    map.push(c.raw);
    i++;
  }
  return { text, map };
}

function rawEnd(raw, idx) {
  const cp = raw.codePointAt(idx);
  return idx + (cp > 0xffff ? 2 : 1);
}

/**
 * Sellers' approximate substring search: best end position of `pattern` inside `text`.
 * Returns { end, dist } where end is exclusive.
 */
function bestEnd(text, pattern) {
  const m = pattern.length;
  const n = text.length;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  let best = { end: 0, dist: prev[m] };
  for (let j = 1; j <= n; j++) {
    cur[0] = 0;
    const tc = text.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const cost = pattern.charCodeAt(i - 1) === tc ? 0 : 1;
      let v = prev[i - 1] + cost;
      const del = prev[i] + 1;
      if (del < v) v = del;
      const ins = cur[i - 1] + 1;
      if (ins < v) v = ins;
      cur[i] = v;
    }
    if (cur[m] < best.dist) best = { end: j, dist: cur[m] };
    const t = prev; prev = cur; cur = t;
  }
  return best;
}

function reverse(s) {
  return Array.from(s).reverse().join('');
}

/** Best fuzzy occurrence of `pattern` in `text` (both already normalised). */
function fuzzyFind(text, pattern, maxEdits) {
  const { end, dist } = bestEnd(text, pattern);
  if (dist > maxEdits) return null;
  const rev = bestEnd(reverse(text.slice(0, end)), reverse(pattern));
  const start = end - rev.end;
  return { start, end, dist: Math.min(dist, rev.dist) };
}

/**
 * Search `query` in `pageText`.
 * Returns [{ start, end, score, exact }] with raw offsets (end exclusive), in document order.
 */
export function search(pageText, query, opts = {}) {
  const q = normalize(query);
  if (!q.text) return [];
  const p = normalize(pageText);
  if (!p.text) return [];

  const toRaw = (ns, ne) => ({ start: p.map[ns], end: rawEnd(pageText, p.map[ne - 1]) });

  const hits = [];
  let idx = 0;
  while ((idx = p.text.indexOf(q.text, idx)) !== -1) {
    hits.push({ ...toRaw(idx, idx + q.text.length), score: 1, exact: true });
    idx += q.text.length;
  }
  if (hits.length || opts.fuzzy === false) return hits;

  const maxEdits = opts.maxEdits ?? Math.max(2, Math.floor(q.text.length * 0.2));
  const f = fuzzyFind(p.text, q.text, maxEdits);
  if (!f || f.end <= f.start) return [];
  return [{ ...toRaw(f.start, f.end), score: Math.max(0, 1 - f.dist / q.text.length), exact: false }];
}

function trigrams(text) {
  const set = new Set();
  const t = normalize(text).text;
  for (let i = 0; i + 3 <= t.length; i++) set.add(t.slice(i, i + 3));
  return set;
}

/**
 * Rank candidates ({ text, ... }) by the share of the query's trigrams they contain.
 * Cheap pre-filter used to pick which pages deserve a fuzzy search.
 */
export function rankByOverlap(query, candidates) {
  const q = trigrams(query);
  if (!q.size) return [...candidates];
  return candidates
    .map((c) => {
      const t = trigrams(c.text);
      let shared = 0;
      for (const g of q) if (t.has(g)) shared++;
      return { c, score: shared / q.size };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

/**
 * The quote to show under a highlight. A PDF breaks words across lines with a hyphen, so the page
 * itself reads "steering to- ward" while whoever asked for the highlight wrote "steering toward".
 * When the two differ only in hyphens and spacing they are the same passage, and the asked-for
 * wording is the one that reads as prose, so prefer it. Any other difference (a typo the fuzzy
 * matcher forgave, a word dropped) means only the page can be trusted.
 */
export function bestQuote(asked, onPage) {
  const page = collapse(onPage);
  if (typeof asked !== 'string') return page;
  const given = collapse(asked);
  return given && quoteKey(given) === quoteKey(page) ? given : page;
}

const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
const quoteKey = (s) => normalize(s).text.replace(/[-\s]/g, '');
