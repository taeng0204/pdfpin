// Two ways pdfpin can be talking to the wrong copy of itself: a daemon left over from an older
// install, and a document filed under the other Unicode spelling of its own name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isStale } from '../src/cli/client.js';
import { Store, docIdFor } from '../src/server/store.js';
import { VERSION } from '../src/server/index.js';

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-stale-'));

/** docIdFor reads process.platform as it goes, so a test can ask what another platform would do. */
function asPlatform(name, fn) {
  const was = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: name, configurable: true });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', was); }
}

const NFC = '/tmp/노트.pdf'.normalize('NFC');
const NFD = '/tmp/노트.pdf'.normalize('NFD');

test('the two spellings of a name really are different strings', () => {
  assert.notEqual(NFC, NFD, 'the fixture would prove nothing otherwise');
});

test('where the filesystem folds the spellings, so does the document id', () => {
  for (const os_ of ['darwin', 'win32']) {
    asPlatform(os_, () => assert.equal(docIdFor(NFC), docIdFor(NFD), `${os_} opens one file either way`));
  }
  // On Linux those are two files that happen to look alike, and folding them would merge two papers.
  asPlatform('linux', () => assert.notEqual(docIdFor(NFC), docIdFor(NFD)));
});

// The migration is a macOS and Windows story, so these run as macOS wherever the suite is run:
// on Linux the two spellings are two files and nothing should be re-filed at all.
test('a document filed under the old id moves to the one its path gives now', () => {
  const home = tmpHome();
  const docs = path.join(home, 'docs');
  fs.mkdirSync(docs, { recursive: true });

  asPlatform('darwin', () => {
    const canonical = docIdFor(NFD);
    const legacy = asPlatform('linux', () => docIdFor(NFD)); // what a pre-fix daemon wrote
    assert.notEqual(legacy, canonical, 'the fixture needs an id that moved');
    fs.writeFileSync(path.join(docs, `${legacy}.json`),
      JSON.stringify({ id: legacy, path: NFD, title: '노트', pages: 1, sessions: [], annotations: [{ id: 'a1' }] }));
    fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify({ currentDocId: legacy }));

    const store = new Store(home);
    assert.equal(fs.existsSync(path.join(docs, `${legacy}.json`)), false, 'the old file is gone');
    const moved = store.get(canonical);
    assert.equal(moved.id, canonical);
    assert.equal(moved.annotations.length, 1, 'the notes came with it');
    assert.equal(store.state.currentDocId, canonical, 'and so did "current"');
  });
});

test('a paper filed twice keeps the fuller record and sets the other aside', () => {
  const home = tmpHome();
  const docs = path.join(home, 'docs');
  fs.mkdirSync(docs, { recursive: true });

  asPlatform('darwin', () => {
    const canonical = docIdFor(NFD);
    const legacy = asPlatform('linux', () => docIdFor(NFD));
    // the half holding the notes is the one filed under the old id
    fs.writeFileSync(path.join(docs, `${legacy}.json`),
      JSON.stringify({ id: legacy, path: NFD, sessions: [], annotations: [{ id: 'a1' }, { id: 'a2' }] }));
    fs.writeFileSync(path.join(docs, `${canonical}.json`),
      JSON.stringify({ id: canonical, path: NFC, sessions: [], annotations: [] }));

    const store = new Store(home);
    assert.equal(store.get(canonical).annotations.length, 2, 'the record with the notes survived');
    const aside = fs.readdirSync(docs).filter((f) => f.includes('.duplicate-'));
    assert.equal(aside.length, 1, 'the emptier one was set aside, not deleted');
  });
});

test('on Linux the two spellings stay two documents and nothing is re-filed', () => {
  const home = tmpHome();
  const docs = path.join(home, 'docs');
  fs.mkdirSync(docs, { recursive: true });

  asPlatform('linux', () => {
    const a = docIdFor(NFD);
    const b = docIdFor(NFC);
    fs.writeFileSync(path.join(docs, `${a}.json`), JSON.stringify({ id: a, path: NFD, sessions: [], annotations: [] }));
    fs.writeFileSync(path.join(docs, `${b}.json`), JSON.stringify({ id: b, path: NFC, sessions: [], annotations: [] }));

    new Store(home);
    assert.deepEqual(fs.readdirSync(docs).sort(), [`${a}.json`, `${b}.json`].sort(), 'both are left alone');
  });
});

test('a daemon is replaced when it is older, or when its own files are gone', () => {
  assert.equal(isStale({ version: VERSION, web: true }), false, 'the healthy one is kept');
  assert.equal(isStale({ version: '0.0.1', web: true }), true, 'an older install');
  assert.equal(isStale({ version: VERSION, web: false }), true, 'its viewer was deleted under it');
  assert.equal(isStale({ version: VERSION }), false, 'silence about the viewer is not a complaint');
  assert.equal(isStale(null), false, 'nothing answered, which is a different problem');
});
