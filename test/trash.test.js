// What a confirmation dialog destroys. Annotations are the whole reason a document was open, and
// the three ways to lose them all used to be one unlink with nothing kept and nothing logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/server/store.js';

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-trash-'));
const trashOf = (home) => {
  try { return fs.readdirSync(path.join(home, 'trash')).filter((f) => f.endsWith('.json')); } catch { return []; }
};
const readTrash = (home, file) => JSON.parse(fs.readFileSync(path.join(home, 'trash', file), 'utf8'));

function docWith(store, marks = 2) {
  const doc = store.openDocument({ path: '/tmp/paper.pdf', title: 'paper', pages: 3 });
  const s = store.addSession(doc.id, { title: 'What does it measure?', flow: 'Two numbers carry it.' });
  for (let i = 0; i < marks; i += 1) store.addAnnotation(doc.id, { page: 1, quote: `q${i}`, tag: 't', sessionId: s.id });
  return { doc: store.get(doc.id), session: s };
}

test('nothing is kept until something is destroyed', () => {
  const home = tmpHome();
  const store = new Store(home);
  docWith(store);
  assert.equal(fs.existsSync(path.join(home, 'trash')), false, 'an untouched home has no trash folder');
});

test('forgetting a document keeps the copy the viewer will never show again', () => {
  const home = tmpHome();
  const store = new Store(home);
  const { doc } = docWith(store, 3);

  assert.equal(store.removeDocument(doc.id), true, 'the contract the callers rely on');
  assert.equal(store.get(doc.id), null, 'and it really is gone from docs/');

  const kept = trashOf(home);
  assert.equal(kept.length, 1);
  assert.match(kept[0], /^[0-9a-f]{10}-forgotten-/, 'named for the document and what happened');
  const back = readTrash(home, kept[0]);
  assert.equal(back.id, doc.id);
  assert.equal(back.annotations.length, 3, 'with every mark still on it');
  assert.equal(back.path, '/tmp/paper.pdf', 'so putting it back is a mv into docs/');
});

test('clearing marks keeps the document as it was, and only when marks were lost', () => {
  const home = tmpHome();
  const store = new Store(home);
  const { doc } = docWith(store, 2);

  assert.equal(store.clearAnnotations(doc.id, { tag: 'nothing-has-this' }), 0);
  assert.deepEqual(trashOf(home), [], 'clearing nothing destroys nothing');

  assert.equal(store.clearAnnotations(doc.id), 2);
  const kept = trashOf(home);
  assert.equal(kept.length, 1);
  assert.match(kept[0], /-cleared-/);
  assert.equal(readTrash(home, kept[0]).annotations.length, 2, 'the marks as they were');
  assert.equal(store.get(doc.id).annotations.length, 0, 'while the live document is cleared');
});

test('removing a session keeps it even when it held no marks, because it held the overview', () => {
  const home = tmpHome();
  const store = new Store(home);
  const { doc, session } = docWith(store, 0);

  assert.equal(store.removeSession(doc.id, session.id), 0, 'no marks were lost');
  const kept = trashOf(home);
  assert.equal(kept.length, 1, 'and the overview is still worth keeping');
  assert.equal(readTrash(home, kept[0]).sessions[0].flow, 'Two numbers carry it.');
});

test('the trash keeps enough to undo a mistake, not everything ever read', () => {
  const home = tmpHome();
  const store = new Store(home);
  for (let i = 0; i < 45; i += 1) {
    const { doc } = docWith(store, 1);
    store.removeDocument(doc.id);
  }
  assert.equal(trashOf(home).length, 40, 'the newest are kept');
});

test('a trash it cannot write never stops the thing someone asked for', () => {
  const home = tmpHome();
  const store = new Store(home);
  const { doc } = docWith(store, 2);
  // A read-only home, a full disk, a folder someone made a file: all land the same way.
  fs.writeFileSync(path.join(home, 'trash'), 'not a folder');

  assert.equal(store.removeDocument(doc.id), true, 'the removal still happens');
  assert.equal(store.get(doc.id), null);
});
