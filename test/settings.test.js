import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFixturePdf } from './helpers/fixture.js';
import { createServer } from '../src/server/index.js';
import { DEFAULT_SETTINGS } from '../src/server/settings.js';

let base;
let handle;
let home;

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

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-set-'));
  handle = await createServer({ home, port: 0 });
  base = `http://127.0.0.1:${handle.port}`;
});
after(async () => { await handle.close(); });

test('settings start at the defaults and persist on disk', async () => {
  const r = await api('GET', '/api/settings');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.settings, DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.language, 'auto');
  assert.equal(DEFAULT_SETTINGS.palette.length, 12);
  assert.equal(DEFAULT_SETTINGS.keys.history, 'mod+e');
  assert.equal(DEFAULT_SETTINGS.keys.settings, 'mod+,');
});

test('a patch merges, validates and survives a restart', async () => {
  const r = await api('PATCH', '/api/settings', { language: 'ko', palette: ['blue', 'pink'], keys: { history: 'mod+e' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.settings.language, 'ko');
  assert.deepEqual(r.json.settings.palette, ['blue', 'pink']);
  assert.equal(r.json.settings.keys.history, 'mod+e');
  assert.equal(r.json.settings.keys.documents, DEFAULT_SETTINGS.keys.documents, 'other keys keep their defaults');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')).palette, ['blue', 'pink']);
});

test('invalid values are refused with a helpful message', async () => {
  assert.equal((await api('PATCH', '/api/settings', { language: 'martian' })).status, 400);
  assert.equal((await api('PATCH', '/api/settings', { palette: [] })).status, 400);
  assert.equal((await api('PATCH', '/api/settings', { palette: ['chartreuse'] })).status, 400);
  assert.equal((await api('PATCH', '/api/settings', { theme: 'neon' })).status, 400);
  assert.equal((await api('PATCH', '/api/settings', { keys: { history: 42 } })).status, 400);
  const dup = await api('PATCH', '/api/settings', { keys: { documents: 'mod+e' } });
  assert.equal(dup.status, 400);
  assert.match(dup.json.error, /already/i);
});

test('the palette drives which colours new tags receive', async () => {
  const pdf = await makeFixturePdf(home);
  const doc = (await api('POST', '/api/docs', { path: pdf })).json.doc;
  const add = (text, tag) => api('POST', `/api/docs/${doc.id}/annotations`, { text, tag, note: '' });
  assert.equal((await add('Hello World', 'one')).json.annotation.color, 'blue');
  assert.equal((await add('Second line', 'two')).json.annotation.color, 'pink');
});

test('settings can be reset', async () => {
  const r = await api('DELETE', '/api/settings');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.settings, DEFAULT_SETTINGS);
});

test('a fresh install reads on a light page, and can be told to follow the system', async () => {
  await api('DELETE', '/api/settings');
  assert.equal((await api('GET', '/api/settings')).json.settings.theme, 'light');
  assert.equal((await api('PATCH', '/api/settings', { theme: 'system' })).json.settings.theme, 'system');
});
