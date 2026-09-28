// The tag strip over a selection: every tag reachable, the ones in use first.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadViewerDom, annotation } from './helpers/dom.js';

let setAnnotations; let orderedTags; let tagChips;

before(async () => {
  loadViewerDom();
  ({ setAnnotations } = await import('../src/web/state.js'));
  ({ orderedTags, tagChips } = await import('../src/web/selection.js'));
});

const seed = (tags) => setAnnotations(tags.map((tag, i) => annotation({ id: `a${i}`, tag, color: 'yellow' })));

test('a document with no tags shows no strip', () => {
  seed([]);
  assert.deepEqual(orderedTags(), []);
  assert.equal(tagChips(), '');
});

test('the tags a document leans on come first, ties alphabetically', () => {
  seed(['scope', 'result', 'scope', 'caveat', 'scope', 'result']);
  assert.deepEqual(orderedTags(), ['scope', 'result', 'caveat']);
});

test('every tag is offered, however many there are', () => {
  const many = Array.from({ length: 20 }, (_, i) => `tag-${String(i).padStart(2, '0')}`);
  seed(many);
  assert.equal(orderedTags().length, 20, 'no tag may be dropped: the strip scrolls instead');
  const html = tagChips();
  for (const tag of many) assert.ok(html.includes(`data-tag="${tag}"`), `${tag} is missing from the strip`);
});

test('a chip carries its tag colour and escapes what came from the document', () => {
  setAnnotations([
    annotation({ id: 'a1', tag: 'method', color: 'blue' }),
    annotation({ id: 'a2', tag: '<script>', color: 'pink' }),
  ]);
  const html = tagChips();
  assert.match(html, /class="sel-tag hl-color-blue"[^>]*data-tag="method"/);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});
