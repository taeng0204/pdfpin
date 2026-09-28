import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDemoPdf, DEMO_QUOTES } from '../src/server/demo.js';
import { openPdf, getPageIndex } from '../src/server/pdftext.js';
import { search } from '../src/shared/matcher.js';

test('the demo paper is a real one-page PDF that carries every quote the tour needs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-demo-'));
  const file = await buildDemoPdf(dir);
  assert.equal(path.dirname(file), dir);
  assert.ok(fs.statSync(file).size > 1000);

  const doc = await openPdf(file);
  assert.equal(doc.numPages, 1);
  const { text } = await getPageIndex(doc, 1);

  assert.ok(DEMO_QUOTES.length >= 4);
  for (const quote of DEMO_QUOTES) {
    const hits = search(text, quote, { fuzzy: false });
    assert.equal(hits.length, 1, `"${quote}" should appear exactly once`);
  }
});

test('building it twice lands on the same path and refreshes the file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-demo2-'));
  const a = await buildDemoPdf(dir);
  const b = await buildDemoPdf(dir);
  assert.equal(a, b);
  assert.ok(fs.existsSync(b));
});
