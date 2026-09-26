import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { makeFixturePdf } from './helpers/fixture.js';
import { Store } from '../src/server/store.js';
import { SseHub } from '../src/server/sse.js';
import { DocManager } from '../src/server/docs.js';
import { exportDocument } from '../src/server/export.js';

let home;
let pdfPath;
let docs;
let hub;
let doc;
let withRects; // annotation exported to the PDF
let noRects; // annotation whose rects were cleared: Markdown only

const highlightsOf = async (file, pageNo) => {
  const pdf = await PDFDocument.load(fs.readFileSync(file));
  const annots = pdf.getPage(pageNo - 1).node.Annots();
  return annots ? annots.asArray().map((ref) => pdf.context.lookup(ref)) : [];
};

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-export-'));
  pdfPath = await makeFixturePdf(home);
  hub = new SseHub();
  docs = new DocManager(new Store(home), hub);
  doc = await docs.open(pdfPath);
  withRects = (await docs.add(doc, { text: 'higher code coverage than KLEE', note: 'Coverage claim', title: 'Claim', color: 'green', tag: 'evidence' })).annotation;
  noRects = (await docs.add(doc, { text: 'Page two', note: 'Second page note' })).annotation;
  docs.update(doc, noRects.id, { rects: [] });
  docs.setSummary(doc, { title: 'Evidence for X', body: 'Three passages support it.' });
});

after(async () => {
  await docs.close();
  hub.close();
});

test('pdf export writes a real Highlight annotation next to the source', async () => {
  const r = await exportDocument(docs, doc, { format: 'pdf' });
  assert.equal(r.format, 'pdf');
  assert.equal(r.count, 1);
  assert.equal(r.path, path.join(home, 'fixture.annotated.pdf'));

  const [annot] = await highlightsOf(r.path, 1);
  assert.equal(annot.get(PDFName.of('Subtype')).toString(), '/Highlight');
  assert.equal(annot.get(PDFName.of('Type')).toString(), '/Annot');
  assert.equal(annot.lookup(PDFName.of('QuadPoints'), PDFArray).size(), 8 * withRects.rects.length);
  assert.equal(annot.lookup(PDFName.of('Rect'), PDFArray).size(), 4);
  assert.equal(annot.lookup(PDFName.of('Contents')).decodeText(), 'Claim\n\nCoverage claim');
  assert.equal(annot.lookup(PDFName.of('T')).decodeText(), 'evidence');
  assert.match(annot.lookup(PDFName.of('M')).decodeText(), /^D:\d{14}Z$/); // a string, not a name
  assert.match(annot.lookup(PDFName.of('CreationDate')).decodeText(), /^D:\d{14}Z$/);
  const [rr, gg, bb] = annot.lookup(PDFName.of('C'), PDFArray).asArray().map((n) => n.asNumber());
  assert.ok(rr < gg && bb < gg, 'green colour'); // #8CE99A

  // page 2's annotation lost its rects, so it is not exported
  assert.equal((await highlightsOf(r.path, 2)).length, 0);
});

test('pdf export keeps an existing indirect Annots array and appends to it', async () => {
  const src = await PDFDocument.load(fs.readFileSync(pdfPath));
  const ctx = src.context;
  const square = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] }));
  src.getPage(0).node.set(PDFName.of('Annots'), ctx.register(ctx.obj([square])));
  const other = path.join(home, 'existing.pdf');
  fs.writeFileSync(other, await src.save());

  const d2 = await docs.open(other);
  await docs.add(d2, { text: 'Hello World', note: 'greeting' });
  const r = await exportDocument(docs, d2, { format: 'pdf' });
  const annots = await highlightsOf(r.path, 1);
  assert.equal(annots.length, 2);
  assert.equal(annots[0].get(PDFName.of('Subtype')).toString(), '/Square');
  assert.equal(annots[1].get(PDFName.of('Subtype')).toString(), '/Highlight');
});

test('md export lists the summary, page headers, quotes and notes', async () => {
  const r = await exportDocument(docs, doc, { format: 'md' });
  assert.equal(r.format, 'md');
  assert.equal(r.count, 2);
  assert.equal(r.path, path.join(home, 'fixture.annotations.md'));

  const md = fs.readFileSync(r.path, 'utf8');
  assert.match(md, /^# Fixture Paper\n/);
  assert.ok(md.includes(pdfPath));
  assert.match(md, /## Evidence for X\n\nThree passages support it\./);
  assert.match(md, /## Page 1\n\n> higher code coverage than KLEE\n\n\*\*Claim\*\*\n\nCoverage claim\n\n_green · #evidence · a_[a-z0-9]{6}_/);
  assert.match(md, /## Page 2\n\n> Page two\n\nSecond page note\n\n_yellow · a_[a-z0-9]{6}_/);
  assert.ok(md.indexOf('## Page 1') < md.indexOf('## Page 2'));
});

test('unknown format is rejected with status 400', async () => {
  await assert.rejects(() => exportDocument(docs, doc, { format: 'docx' }), (e) => e.status === 400 && /format/i.test(e.message));
});

test('a document without annotations still writes the file with count 0', async () => {
  const empty = await docs.open(await makeFixturePdf(fs.mkdtempSync(path.join(home, 'empty-'))));
  const out = path.join(home, 'nested', 'out.pdf');
  const pdf = await exportDocument(docs, empty, { format: 'pdf', out });
  assert.equal(pdf.count, 0);
  assert.equal(pdf.path, out);
  assert.ok((await PDFDocument.load(fs.readFileSync(out))).getPageCount() === 2);

  const md = await exportDocument(docs, empty, { format: 'md', out: path.join(home, 'nested', 'out.md') });
  assert.equal(md.count, 0);
  assert.match(fs.readFileSync(md.path, 'utf8'), /^# Fixture Paper\n/);
});
