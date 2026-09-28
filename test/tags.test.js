import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFixturePdf } from './helpers/fixture.js';
import { createServer } from '../src/server/index.js';

let base;
let handle;
let docId;

const api = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
};
const anns = async () => (await api('GET', `/api/docs/${docId}`)).json.doc.annotations;
const byQuote = async (q) => (await anns()).find((a) => a.quote.startsWith(q));

before(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-tags-'));
  const pdf = await makeFixturePdf(home);
  handle = await createServer({ home, port: 0 });
  base = `http://127.0.0.1:${handle.port}`;
  docId = (await api('POST', '/api/docs', { path: pdf })).json.doc.id;
});
after(async () => { await handle.close(); });

test('giving a highlight a tag makes its colour follow that tag', async () => {
  await api('POST', `/api/docs/${docId}/annotations`, { text: 'Hello World', tag: 'claim', note: '' });
  // a highlight made by hand: an explicit colour, no tag
  const mine = (await api('POST', `/api/docs/${docId}/annotations`, { text: 'Second line', color: 'grape', source: 'user' })).json.annotation;
  assert.equal(mine.colorAuto, false);
  assert.equal(mine.tag, '');

  const tagged = (await api('PATCH', `/api/docs/${docId}/annotations/${mine.id}`, { tag: 'claim' })).json.annotation;
  assert.equal(tagged.tag, 'claim');
  assert.equal(tagged.colorAuto, true, 'a tag takes the colour question back');
  assert.equal(tagged.color, (await byQuote('Hello World')).color, 'the reader and the agent now share one colour');
});

test('a colour given with the tag still pins the highlight', async () => {
  const a = (await api('POST', `/api/docs/${docId}/annotations`, { text: 'Page two', note: '' })).json.annotation;
  const r = (await api('PATCH', `/api/docs/${docId}/annotations/${a.id}`, { tag: 'claim', color: 'teal' })).json.annotation;
  assert.equal(r.color, 'teal');
  assert.equal(r.colorAuto, false);
});

test('renaming a tag moves every highlight and its colour', async () => {
  await api('PATCH', `/api/docs/${docId}/colors`, { tags: { claim: 'cyan' } });
  const r = await api('PATCH', `/api/docs/${docId}/tags/claim`, { name: 'evidence' });
  assert.equal(r.status, 200, r.text);
  const list = await anns();
  assert.equal(list.some((a) => a.tag === 'claim'), false);
  assert.equal(list.filter((a) => a.tag === 'evidence').length, 3, 'all three "claim" highlights moved');
  assert.equal(r.json.doc.tagColors.evidence, 'cyan');
  assert.equal(r.json.doc.tagColors.claim, undefined);
  assert.equal(list.find((a) => a.tag === 'evidence' && a.colorAuto).color, 'cyan');
});

test('renaming onto a tag that exists merges the two', async () => {
  await api('POST', `/api/docs/${docId}/annotations`, { text: 'higher code coverage', tag: 'caveat', note: '' });
  const r = await api('PATCH', `/api/docs/${docId}/tags/caveat`, { name: 'evidence' });
  assert.equal(r.status, 200);
  const list = await anns();
  assert.equal(list.some((a) => a.tag === 'caveat'), false);
  assert.equal(list.filter((a) => a.tag === 'evidence').length, 4);
});

test('a tag can be recoloured by name and dropped entirely', async () => {
  assert.equal((await api('PATCH', `/api/docs/${docId}/tags/evidence`, { color: 'lime' })).json.doc.tagColors.evidence, 'lime');
  assert.equal((await byQuote('Hello World')).color, 'lime');
  const r = await api('DELETE', `/api/docs/${docId}/tags/evidence`);
  assert.equal(r.status, 200);
  assert.equal((await anns()).some((a) => a.tag === 'evidence'), false);
  assert.equal(r.json.doc.tagColors.evidence, undefined);
});

test('bad tag operations are refused', async () => {
  assert.equal((await api('PATCH', `/api/docs/${docId}/tags/nope`, { name: 'x' })).status, 404);
  await api('POST', `/api/docs/${docId}/annotations`, { text: 'Second line of text', tag: 'keep', note: '' });
  assert.equal((await api('PATCH', `/api/docs/${docId}/tags/keep`, { name: '   ' })).status, 400);
  assert.equal((await api('PATCH', `/api/docs/${docId}/tags/keep`, { color: 'chartreuse' })).status, 400);
});
