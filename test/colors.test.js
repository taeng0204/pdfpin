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
const colorsOf = async () => (await api('GET', `/api/docs/${docId}`)).json.doc.annotations.map((a) => [a.quote.slice(0, 12), a.color, a.colorAuto]);

before(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-col-'));
  const pdf = await makeFixturePdf(home);
  handle = await createServer({ home, port: 0 });
  base = `http://127.0.0.1:${handle.port}`;
  docId = (await api('POST', '/api/docs', { path: pdf })).json.doc.id;
});
after(async () => { await handle.close(); });

test('a session is born with its own colour, taken from the palette', async () => {
  const a = await api('POST', `/api/docs/${docId}/sessions`, { title: 'first' });
  const b = await api('POST', `/api/docs/${docId}/sessions`, { title: 'second' });
  assert.equal(a.json.session.color, 'yellow');
  assert.equal(b.json.session.color, 'green');
  assert.notEqual(a.json.session.color, b.json.session.color);
});

test('colouring by session paints every highlight of a session alike', async () => {
  await api('DELETE', `/api/docs/${docId}/annotations`);
  const s1 = (await api('POST', `/api/docs/${docId}/sessions`, { title: 'one', highlights: [{ text: 'Hello World', tag: 'a' }, { text: 'Second line', tag: 'b' }] })).json.session;
  const s2 = (await api('POST', `/api/docs/${docId}/sessions`, { title: 'two', highlights: [{ text: 'Page two', tag: 'c' }] })).json.session;

  // by tag (the default) the three highlights get three colours
  const byTag = (await colorsOf()).map((x) => x[1]);
  assert.equal(new Set(byTag).size, 3);

  await api('PATCH', '/api/settings', { colorBy: 'session' });
  const bySession = (await api('GET', `/api/docs/${docId}`)).json.doc.annotations;
  assert.equal(bySession.filter((a) => a.sessionId === s1.id).every((a) => a.color === s1.color), true);
  assert.equal(bySession.filter((a) => a.sessionId === s2.id).every((a) => a.color === s2.color), true);

  await api('PATCH', '/api/settings', { colorBy: 'tag' });
  assert.equal(new Set((await colorsOf()).map((x) => x[1])).size, 3, 'switching back restores the per-tag colours');
});

test('a colour the agent asked for is never repainted', async () => {
  await api('POST', `/api/docs/${docId}/annotations`, { text: 'higher code coverage', tag: 'a', color: 'grape' });
  await api('PATCH', '/api/settings', { colorBy: 'session' });
  const pinned = (await colorsOf()).find((x) => x[0].startsWith('higher code'));
  assert.equal(pinned[1], 'grape');
  assert.equal(pinned[2], false);
  await api('PATCH', '/api/settings', { colorBy: 'tag' });
});

test('the reader can give a tag a different colour', async () => {
  const r = await api('PATCH', `/api/docs/${docId}/colors`, { tags: { a: 'teal' } });
  assert.equal(r.status, 200);
  const anns = (await api('GET', `/api/docs/${docId}`)).json.doc.annotations;
  assert.equal(anns.filter((a) => a.tag === 'a' && a.colorAuto).every((a) => a.color === 'teal'), true);
  assert.equal(anns.find((a) => a.tag === 'b').color !== 'teal', true, 'other tags are untouched');
  assert.equal(r.json.doc.tagColors.a, 'teal');
  assert.equal((await api('PATCH', `/api/docs/${docId}/colors`, { tags: { a: 'chartreuse' } })).status, 400);
});

test('the reader can give a session a different colour', async () => {
  const doc = (await api('GET', `/api/docs/${docId}`)).json.doc;
  const s = doc.sessions[doc.sessions.length - 1];
  await api('PATCH', '/api/settings', { colorBy: 'session' });
  const r = await api('PATCH', `/api/docs/${docId}/colors`, { sessions: { [s.id]: 'indigo' } });
  assert.equal(r.status, 200);
  const anns = (await api('GET', `/api/docs/${docId}`)).json.doc.annotations;
  assert.equal(anns.filter((a) => a.sessionId === s.id && a.colorAuto).every((a) => a.color === 'indigo'), true);
  await api('PATCH', '/api/settings', { colorBy: 'tag' });
});

test('an override is dropped by passing null, and unknown sessions are refused', async () => {
  assert.equal((await api('PATCH', `/api/docs/${docId}/colors`, { tags: { a: null } })).json.doc.tagColors.a, undefined);
  assert.equal((await api('PATCH', `/api/docs/${docId}/colors`, { sessions: { s_nope00: 'blue' } })).status, 404);
});
