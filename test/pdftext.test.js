import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeFixturePdf } from './helpers/fixture.js';
import { openPdf, getPageIndex, offsetsToAnchor, anchorToOffsets, approxRects } from '../src/server/pdftext.js';

let pdfPath;
let doc;
before(async () => {
  pdfPath = await makeFixturePdf();
  doc = await openPdf(pdfPath);
});

test('openPdf reports page count and title', () => {
  assert.equal(doc.numPages, 2);
  assert.equal(doc.title, 'Fixture Paper');
});

test('openPdf rejects a file that is not a PDF', async () => {
  const bad = path.join(os.tmpdir(), `pdfpin-bad-${Date.now()}.pdf`);
  await fs.writeFile(bad, 'not a pdf');
  await assert.rejects(() => openPdf(bad));
});

test('getPageIndex builds page text with line breaks between items', async () => {
  const idx = await getPageIndex(doc, 1);
  assert.match(idx.text, /Hello World\nSecond line of text/);
  assert.ok(idx.items.length >= 3);
  assert.equal(idx.viewport.width, 612);
  assert.equal(idx.viewport.height, 792);
});

test('offsetsToAnchor maps raw offsets to item/char positions and back', async () => {
  const idx = await getPageIndex(doc, 1);
  const start = idx.text.indexOf('World');
  const end = idx.text.indexOf('Second') + 'Second'.length;
  const anchor = offsetsToAnchor(idx, start, end);
  assert.equal(anchor.startChar, 6);
  assert.equal(anchor.endItem, anchor.startItem + 1);
  assert.equal(anchor.endChar, 6);
  assert.deepEqual(anchorToOffsets(idx, anchor), { start, end });
});

test('offsetsToAnchor skips a separator at the start of a match', async () => {
  const idx = await getPageIndex(doc, 1);
  const nl = idx.text.indexOf('\n');
  const anchor = offsetsToAnchor(idx, nl, nl + 7); // "\nSecond"
  assert.equal(anchor.startChar, 0);
  assert.equal(idx.items[anchor.startItem].str.slice(0, 6), 'Second');
});

test('approxRects returns a top-left-origin rect around the matched glyphs', async () => {
  const idx = await getPageIndex(doc, 1);
  const s = idx.text.indexOf('Hello World');
  const rects = approxRects(idx, offsetsToAnchor(idx, s, s + 'Hello World'.length));
  assert.equal(rects.length, 1);
  const r = rects[0];
  assert.ok(Math.abs(r.x - 72) < 1.5, `x=${r.x}`);
  assert.ok(r.y > 78 && r.y < 86, `y=${r.y}`);
  assert.ok(r.w > 50 && r.w < 75, `w=${r.w}`);
  assert.ok(r.h > 10 && r.h < 15, `h=${r.h}`);
});

test('approxRects shrinks proportionally for a partial item', async () => {
  const idx = await getPageIndex(doc, 1);
  const s = idx.text.indexOf('World');
  const [r] = approxRects(idx, offsetsToAnchor(idx, s, s + 5));
  assert.ok(r.x > 100 && r.x < 110, `x=${r.x}`);
});
