import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.js';

let home;
let store;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-store-'));
  store = new Store(home);
});

const meta = { path: '/papers/eclipser.pdf', title: 'Eclipser', pages: 12 };

test('openDocument creates a record with a stable id and makes it current', () => {
  const doc = store.openDocument(meta);
  assert.match(doc.id, /^[0-9a-f]{10}$/);
  assert.equal(doc.title, 'Eclipser');
  assert.deepEqual(doc.annotations, []);
  assert.equal(store.current().id, doc.id);
  assert.equal(store.openDocument(meta).id, doc.id);
});

test('annotations persist on disk across store instances', () => {
  const doc = store.openDocument(meta);
  const ann = store.addAnnotation(doc.id, { page: 2, quote: 'q', note: 'n', color: 'yellow' });
  assert.match(ann.id, /^a_[0-9a-z]{6}$/);
  assert.ok(ann.createdAt);
  const again = new Store(home);
  assert.equal(again.get(doc.id).annotations.length, 1);
  assert.equal(again.current().id, doc.id);
});

test('updateAnnotation merges fields and bumps updatedAt', () => {
  const doc = store.openDocument(meta);
  const ann = store.addAnnotation(doc.id, { page: 1, quote: 'q', note: 'n', color: 'yellow' });
  const upd = store.updateAnnotation(doc.id, ann.id, { note: 'better', color: 'green' });
  assert.equal(upd.note, 'better');
  assert.equal(upd.color, 'green');
  assert.equal(upd.quote, 'q');
  assert.ok(upd.updatedAt);
  assert.equal(store.updateAnnotation(doc.id, 'a_nope00', { note: 'x' }), null);
});

test('removeAnnotation and clearAnnotations by tag', () => {
  const doc = store.openDocument(meta);
  const a = store.addAnnotation(doc.id, { page: 1, quote: 'a', note: '', tag: 'x' });
  store.addAnnotation(doc.id, { page: 1, quote: 'b', note: '', tag: 'y' });
  store.addAnnotation(doc.id, { page: 2, quote: 'c', note: '', tag: 'x' });
  assert.equal(store.removeAnnotation(doc.id, a.id), true);
  assert.equal(store.removeAnnotation(doc.id, a.id), false);
  assert.equal(store.clearAnnotations(doc.id, { tag: 'x' }), 1);
  assert.equal(store.get(doc.id).annotations.length, 1);
  assert.equal(store.clearAnnotations(doc.id), 1);
});

test('setSummary stores and clears the agent summary', () => {
  const doc = store.openDocument(meta);
  store.setSummary(doc.id, { title: 'Evidence for X', body: 'Three passages support it.' });
  assert.equal(store.get(doc.id).summary.title, 'Evidence for X');
  store.setSummary(doc.id, null);
  assert.equal(store.get(doc.id).summary, null);
});

test('resolve finds a document by id, by path, or by file name', () => {
  const doc = store.openDocument(meta);
  store.openDocument({ path: '/papers/other.pdf', title: 'Other', pages: 3 });
  assert.equal(store.resolve(doc.id).id, doc.id);
  assert.equal(store.resolve('/papers/eclipser.pdf').id, doc.id);
  assert.equal(store.resolve('eclipser.pdf').id, doc.id);
  assert.equal(store.resolve('missing'), null);
});

test('list reports every document with its annotation count', () => {
  const doc = store.openDocument(meta);
  store.addAnnotation(doc.id, { page: 1, quote: 'a', note: '' });
  const rows = store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].annotationCount, 1);
  assert.equal(rows[0].current, true);
});
