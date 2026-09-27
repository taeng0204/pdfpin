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

test('removeDocument deletes the record and clears current when needed', () => {
  const doc = store.openDocument(meta);
  assert.equal(store.removeDocument(doc.id), true);
  assert.equal(store.get(doc.id), null);
  assert.equal(store.current(), null);
  assert.equal(store.removeDocument(doc.id), false);
});

test('list exposes whether the file still exists', () => {
  const doc = store.openDocument({ path: '/papers/gone.pdf', title: 'Gone', pages: 1 });
  const row = store.list().find((d) => d.id === doc.id);
  assert.equal(row.exists, false);
});

test('sessions group annotations and the newest one is current', () => {
  const doc = store.openDocument(meta);
  const s1 = store.addSession(doc.id, { title: 'Evidence for X', flow: 'two passages' });
  assert.match(s1.id, /^s_[0-9a-z]{6}$/);
  assert.equal(store.get(doc.id).currentSessionId, s1.id);
  const a = store.addAnnotation(doc.id, { page: 1, quote: 'q', note: 'n', sessionId: s1.id });
  assert.equal(a.sessionId, s1.id);
  const s2 = store.addSession(doc.id, { title: 'Second question' });
  assert.equal(store.get(doc.id).currentSessionId, s2.id);
  assert.equal(store.updateSession(doc.id, s1.id, { flow: 'updated' }).flow, 'updated');
  assert.equal(store.updateSession(doc.id, 's_nope00', { flow: 'x' }), null);
});

test('removing a session deletes its annotations and moves current to the latest remaining', () => {
  const doc = store.openDocument(meta);
  const s1 = store.addSession(doc.id, { title: 'one' });
  store.addAnnotation(doc.id, { page: 1, quote: 'a', sessionId: s1.id });
  const s2 = store.addSession(doc.id, { title: 'two' });
  store.addAnnotation(doc.id, { page: 1, quote: 'b', sessionId: s2.id });
  store.addAnnotation(doc.id, { page: 2, quote: 'c' }); // user-made, no session
  assert.equal(store.removeSession(doc.id, s2.id), 1);
  const d = store.get(doc.id);
  assert.equal(d.sessions.length, 1);
  assert.equal(d.annotations.length, 2);
  assert.equal(d.currentSessionId, s1.id);
  assert.equal(store.removeSession(doc.id, 's_nope00'), -1);
});

test('list reports session count and the latest session title', () => {
  const doc = store.openDocument(meta);
  store.addSession(doc.id, { title: 'first' });
  store.addSession(doc.id, { title: 'latest' });
  const row = store.list().find((d) => d.id === doc.id);
  assert.equal(row.sessionCount, 2);
  assert.equal(row.latestSession, 'latest');
});
