import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, search } from '../src/server/matcher.js';

test('normalize collapses whitespace, lowercases and maps back to raw offsets', () => {
  const { text, map } = normalize('Hello   World\n\tFoo');
  assert.equal(text, 'hello world foo');
  assert.equal(map[0], 0);          // h
  assert.equal(map[6], 8);          // 'w' sits at raw index 8
  assert.equal(map[12], 15);        // 'f' sits at raw index 15
});

test('normalize expands ligatures and straightens curly quotes and dashes', () => {
  const { text } = normalize('“ﬁne” — it’s');
  assert.equal(text, '"fine" - it\'s');
});

test('normalize joins words hyphenated across a line break', () => {
  const { text, map } = normalize('known to excel in gener-\nating tests');
  assert.equal(text, 'known to excel in generating tests');
  // the 'a' of "ating" maps to its raw position after the "-\n"
  assert.equal(map[text.indexOf('ating')], 'known to excel in gener-\n'.length);
});

test('search finds an exact quote regardless of case and spacing', () => {
  const page = 'Eclipser achieved 8.57% higher code\ncoverage than KLEE on GNU coreutils.';
  const hits = search(page, 'higher code coverage than klee');
  assert.equal(hits.length, 1);
  assert.equal(page.slice(hits[0].start, hits[0].end), 'higher code\ncoverage than KLEE');
  assert.equal(hits[0].score, 1);
  assert.equal(hits[0].exact, true);
});

test('search returns every exact occurrence in document order', () => {
  const page = 'fuzzing is fun. Fuzzing is fast. fuzzing wins.';
  const hits = search(page, 'fuzzing');
  assert.deepEqual(hits.map((h) => h.start), [0, 16, 33]);
});

test('search falls back to fuzzy matching for small typos', () => {
  const page = 'We evaluated Eclipser against current state-of-the-art fuzzers.';
  const hits = search(page, 'evaluated Eclipsr against curent state-of-the-art');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].exact, false);
  assert.ok(hits[0].score > 0.9, `score ${hits[0].score}`);
  assert.equal(page.slice(hits[0].start, hits[0].end), 'evaluated Eclipser against current state-of-the-art');
});

test('search matches a quote whose hyphenated line break was removed by the caller', () => {
  const page = 'a state-of-the-art symbolic executor known to excel in gener-\nating tests with high coverage';
  const hits = search(page, 'known to excel in generating tests');
  assert.equal(hits.length, 1);
  assert.equal(page.slice(hits[0].start, hits[0].end), 'known to excel in gener-\nating tests');
});

test('search returns nothing when the quote is not on the page', () => {
  const hits = search('completely unrelated text about kernels', 'grey-box concolic testing');
  assert.deepEqual(hits, []);
});

test('search rejects empty queries', () => {
  assert.deepEqual(search('some text', '   '), []);
});

test('search does not confuse a fuzzy hit for a much longer page', () => {
  const page = 'x'.repeat(3000) + ' the quick brown fox jumps over the lazy dog ' + 'y'.repeat(3000);
  const hits = search(page, 'quick brwn fox jumps ovr the lazy');
  assert.equal(hits.length, 1);
  assert.equal(page.slice(hits[0].start, hits[0].end), 'quick brown fox jumps over the lazy');
});

test('search can be restricted to exact matches', () => {
  const page = 'We evaluated Eclipser against current fuzzers.';
  assert.deepEqual(search(page, 'evaluated Eclipsr against', { fuzzy: false }), []);
  assert.equal(search(page, 'evaluated Eclipser against', { fuzzy: false }).length, 1);
});

test('rankByOverlap orders candidates by shared trigrams with the query', async () => {
  const { rankByOverlap } = await import('../src/server/matcher.js');
  const pages = [
    { page: 1, text: 'kernel scheduling and memory management' },
    { page: 2, text: 'grey-box concolic testing on binary code' },
    { page: 3, text: 'concolic execution for binaries' },
  ];
  const ranked = rankByOverlap('concolic testing binary', pages);
  assert.deepEqual(ranked.map((p) => p.page), [2, 3, 1]);
});
