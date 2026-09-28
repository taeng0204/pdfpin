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
const doc = async () => (await api('GET', `/api/docs/${docId}`)).json.doc;
const session = (title, highlights) => api('POST', `/api/docs/${docId}/sessions`, { title, highlights });

before(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-arch-'));
  const pdf = await makeFixturePdf(home);
  handle = await createServer({ home, port: 0 });
  base = `http://127.0.0.1:${handle.port}`;
  docId = (await api('POST', '/api/docs', { path: pdf })).json.doc.id;
});
after(async () => { await handle.close(); });

test('a session goes away once its last highlight is removed', async () => {
  const s = (await session('throwaway', [{ text: 'Hello World' }, { text: 'Second line' }])).json.session;
  const ids = (await doc()).annotations.filter((a) => a.sessionId === s.id).map((a) => a.id);
  assert.equal(ids.length, 2);

  await api('DELETE', `/api/docs/${docId}/annotations/${ids[0]}`);
  assert.ok((await doc()).sessions.some((x) => x.id === s.id), 'it survives while one highlight is left');

  await api('DELETE', `/api/docs/${docId}/annotations/${ids[1]}`);
  assert.equal((await doc()).sessions.some((x) => x.id === s.id), false, 'the empty session is gone');
});

test('clearing the document takes its sessions with it', async () => {
  await session('a', [{ text: 'Hello World' }]);
  await session('b', [{ text: 'Page two' }]);
  await api('DELETE', `/api/docs/${docId}/annotations`);
  const d = await doc();
  assert.deepEqual(d.annotations, []);
  assert.deepEqual(d.sessions, []);
});

test('a session can be archived and brought back, keeping its highlights', async () => {
  const s = (await session('for later', [{ text: 'Hello World' }, { text: 'Page two' }])).json.session;
  assert.equal(s.archived, false);

  const archived = (await api('PATCH', `/api/docs/${docId}/sessions/${s.id}`, { archived: true })).json.session;
  assert.equal(archived.archived, true);
  assert.ok(archived.archivedAt);
  assert.equal((await doc()).annotations.filter((a) => a.sessionId === s.id).length, 2, 'the highlights stay');

  const back = (await api('PATCH', `/api/docs/${docId}/sessions/${s.id}`, { archived: false })).json.session;
  assert.equal(back.archived, false);
  assert.equal(back.archivedAt, null);
});

test('archiving is refused anything but a boolean', async () => {
  const s = (await doc()).sessions[0];
  assert.equal((await api('PATCH', `/api/docs/${docId}/sessions/${s.id}`, { archived: 'yes' })).status, 400);
});

test('deleting an archived session removes it and its highlights for good', async () => {
  const s = (await doc()).sessions[0];
  await api('PATCH', `/api/docs/${docId}/sessions/${s.id}`, { archived: true });
  const r = await api('DELETE', `/api/docs/${docId}/sessions/${s.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.removedAnnotations, 2);
  const d = await doc();
  assert.equal(d.sessions.some((x) => x.id === s.id), false);
  assert.equal(d.annotations.some((a) => a.sessionId === s.id), false);
});
