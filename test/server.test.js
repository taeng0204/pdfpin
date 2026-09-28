import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFixturePdf } from './helpers/fixture.js';
import { createServer } from '../src/server/index.js';

let base;
let handle;
let pdfPath;
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
  return { status: res.status, json, text, headers: res.headers };
};

before(async () => {
  process.env.PDFPIN_NO_LAUNCH = '1';
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-srv-'));
  pdfPath = await makeFixturePdf(home);
  handle = await createServer({ home, port: 0 });
  base = `http://127.0.0.1:${handle.port}`;
});

after(async () => {
  await handle.close();
});

test('health endpoint answers', async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('opening a document registers it as current', async () => {
  const r = await api('POST', '/api/docs', { path: pdfPath });
  assert.equal(r.status, 200, r.text);
  docId = r.json.doc.id;
  assert.equal(r.json.doc.pages, 2);
  assert.equal(r.json.doc.title, 'Fixture Paper');
  const cur = await api('GET', '/api/docs/current');
  assert.equal(cur.json.doc.id, docId);
});

test('opening a missing file is a 404', async () => {
  const r = await api('POST', '/api/docs', { path: '/nope/missing.pdf' });
  assert.equal(r.status, 404);
  assert.match(r.json.error, /not found/i);
});

test('text endpoint returns selected pages', async () => {
  const r = await api('GET', `/api/docs/${docId}/text?pages=2`);
  assert.equal(r.status, 200);
  assert.equal(r.json.pages.length, 1);
  assert.equal(r.json.pages[0].page, 2);
  assert.match(r.json.pages[0].text, /Page two/);
});

test('find endpoint lists every hit with page and context', async () => {
  const r = await api('GET', `/api/docs/${docId}/find?q=fuzzing`);
  assert.equal(r.status, 200);
  assert.equal(r.json.hits.length, 2);
  assert.equal(r.json.hits[0].page, 2);
  assert.match(r.json.hits[0].context, /fuzzing/);
});

test('adding an annotation by quote anchors it with rects', async () => {
  const r = await api('POST', `/api/docs/${docId}/annotations`, { text: 'higher code coverage than KLEE', note: 'Coverage claim', color: 'green', tag: 'evidence' });
  assert.equal(r.status, 201, r.text);
  const a = r.json.annotation;
  assert.equal(a.page, 1);
  assert.equal(a.quote, 'higher code coverage than KLEE');
  assert.equal(a.color, 'green');
  assert.ok(a.rects.length >= 1);
  assert.equal(a.rectsSource, 'approx');
  assert.ok(a.anchor.endChar > a.anchor.startChar || a.anchor.endItem > a.anchor.startItem);
});

test('adding with --all highlights every occurrence', async () => {
  const r = await api('POST', `/api/docs/${docId}/annotations`, { text: 'fuzzing', note: 'x', all: true });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.annotations.length, 2);
});

test('a quote that is not in the document yields 422 with suggestions', async () => {
  const r = await api('POST', `/api/docs/${docId}/annotations`, { text: 'quantum gravity waveguide', note: '' });
  assert.equal(r.status, 422);
  assert.match(r.json.error, /not found/i);
  assert.ok(Array.isArray(r.json.suggestions));
});

test('batch add reports per-item results without aborting', async () => {
  const r = await api('POST', `/api/docs/${docId}/annotations`, [
    { text: 'Hello World', note: 'greeting' },
    { text: 'zzz nowhere zzz', note: 'nope' },
  ]);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.results.length, 2);
  assert.equal(r.json.results[0].ok, true);
  assert.equal(r.json.results[1].ok, false);
});

test('SSE stream delivers session events', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/docs/${docId}/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const posted = await api('POST', `/api/docs/${docId}/sessions`, { title: 'SSE session' });
  let buf = '';
  const deadline = Date.now() + 3000;
  while (!buf.includes('session.added') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
  }
  ctrl.abort();
  assert.match(buf, /event: session\.added/);
  assert.match(buf, new RegExp(posted.json.session.id));
});

test('SSE stream delivers annotation events', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/docs/${docId}/events`, { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const posted = await api('POST', `/api/docs/${docId}/annotations`, { text: 'Second line', note: 'sse' });
  assert.equal(posted.status, 201);
  let buf = '';
  const deadline = Date.now() + 3000;
  while (!buf.includes('annotation.added') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
  }
  ctrl.abort();
  assert.match(buf, /event: annotation\.added/);
  assert.match(buf, new RegExp(posted.json.annotation.id));
});

test('patching rects marks them as DOM-sourced', async () => {
  const created = await api('POST', `/api/docs/${docId}/annotations`, { text: 'Page two', note: '' });
  const id = created.json.annotation.id;
  const r = await api('PATCH', `/api/docs/${docId}/annotations/${id}`, { rects: [{ x: 1, y: 2, w: 3, h: 4 }], note: 'edited' });
  assert.equal(r.status, 200);
  assert.equal(r.json.annotation.rectsSource, 'dom');
  assert.equal(r.json.annotation.note, 'edited');
  const del = await api('DELETE', `/api/docs/${docId}/annotations/${id}`);
  assert.equal(del.status, 200);
  assert.equal((await api('DELETE', `/api/docs/${docId}/annotations/${id}`)).status, 404);
});

test('a session can be created with structured highlights in one call', async () => {
  const r = await api('POST', `/api/docs/${docId}/sessions`, {
    title: 'Evidence for X',
    flow: 'Two passages support it: coverage (1) and bugs (2).',
    highlights: [
      { text: 'higher code coverage than KLEE', note: 'coverage', color: 'green', tag: 'coverage' },
      { text: 'zzz nowhere zzz', note: 'nope' },
      { text: 'Page two mentions', note: 'bugs', color: 'pink', tag: 'bugs' },
    ],
  });
  assert.equal(r.status, 201, r.text);
  assert.match(r.json.session.id, /^s_/);
  assert.equal(r.json.added, 2);
  assert.equal(r.json.failed, 1);
  assert.equal(r.json.results[1].ok, false);
  assert.ok(Array.isArray(r.json.results[1].suggestions));
  const doc = (await api('GET', `/api/docs/${docId}`)).json.doc;
  assert.equal(doc.currentSessionId, r.json.session.id);
  assert.equal(doc.annotations.filter((a) => a.sessionId === r.json.session.id).length, 2);
});

test('annotations attach to the current session unless told otherwise', async () => {
  const s = await api('POST', `/api/docs/${docId}/sessions`, { title: 'Follow-up' });
  const withSession = await api('POST', `/api/docs/${docId}/annotations`, { text: 'Hello World', note: '' });
  assert.equal(withSession.json.annotation.sessionId, s.json.session.id);
  const without = await api('POST', `/api/docs/${docId}/annotations`, { text: 'Hello World', note: '', sessionId: null });
  assert.equal(without.json.annotation.sessionId, null);
  const explicit = await api('POST', `/api/docs/${docId}/annotations`, { text: 'Hello World', note: '', sessionId: 's_nope00' });
  assert.equal(explicit.status, 404);
});

test('sessions can be updated, listed and removed together with their highlights', async () => {
  const s = await api('POST', `/api/docs/${docId}/sessions`, { title: 'Temp', highlights: [{ text: 'Second line', note: 'x' }] });
  const sid = s.json.session.id;
  const upd = await api('PATCH', `/api/docs/${docId}/sessions/${sid}`, { flow: 'now with a flow', title: 'Temp 2' });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.session.flow, 'now with a flow');
  const before = (await api('GET', `/api/docs/${docId}`)).json.doc.annotations.length;
  const del = await api('DELETE', `/api/docs/${docId}/sessions/${sid}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.removedAnnotations, 1);
  const doc = (await api('GET', `/api/docs/${docId}`)).json.doc;
  assert.equal(doc.annotations.length, before - 1);
  assert.ok(!doc.sessions.some((x) => x.id === sid));
  assert.equal((await api('DELETE', `/api/docs/${docId}/sessions/${sid}`)).status, 404);
});

test('focus accepts a page or an annotation id', async () => {
  assert.equal((await api('POST', `/api/docs/${docId}/focus`, { page: 2 })).status, 200);
  assert.equal((await api('POST', `/api/docs/${docId}/focus`, { page: 99 })).status, 400);
});

test('clearing annotations by tag removes only that tag', async () => {
  const r = await api('DELETE', `/api/docs/${docId}/annotations?tag=evidence`);
  assert.equal(r.status, 200);
  assert.equal(r.json.removed, 1);
  const all = await api('DELETE', `/api/docs/${docId}/annotations`);
  assert.ok(all.json.removed >= 1);
});

test('viewer page and vendor assets are served', async () => {
  const page = await api('GET', `/view/${docId}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.text, /id="app"/);
  const js = await api('GET', '/vendor/pdfjs/pdf.mjs');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const file = await fetch(`${base}/api/docs/${docId}/file`);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.equal((await api('GET', '/assets/../package.json')).status, 404);
});

test('JSON endpoints refuse bodies that are not declared as JSON (CSRF guard)', async () => {
  const res = await fetch(`${base}/api/docs`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ path: pdfPath }) });
  assert.equal(res.status, 415);
});

test('anchor annotations validate client-supplied rects', async () => {
  const r = await api('POST', `/api/docs/${docId}/annotations`, { page: 1, anchor: { startItem: 0, startChar: 0, endItem: 0, endChar: 3 }, rects: [{ x: 'a', y: 1, w: 1, h: 1 }] });
  assert.equal(r.status, 400);
});

test('huge page ranges are clamped instead of iterated', async () => {
  const t0 = Date.now();
  const r = await api('GET', `/api/docs/${docId}/text?pages=1-999999999`);
  assert.equal(r.status, 200);
  assert.equal(r.json.pages.length, 2);
  assert.ok(Date.now() - t0 < 2000);
});

test('over-long quotes are rejected before any matching work', async () => {
  const r = await api('POST', `/api/docs/${docId}/annotations`, { text: 'x'.repeat(5000), note: '' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /too long/i);
});

test('requests with a foreign Host header are refused (DNS-rebinding guard)', async () => {
  // fetch() silently drops a custom Host header, so use the raw http client
  const http = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: handle.port, path: `/api/docs/${docId}/text?pages=1`, headers: { host: 'evil.example:1234' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('activate makes a document current without reopening it, and delete removes it', async () => {
  const other = await makeFixturePdf(fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-other-')));
  const opened = await api('POST', '/api/docs', { path: other });
  const otherId = opened.json.doc.id;
  assert.equal((await api('GET', '/api/docs/current')).json.doc.id, otherId);
  const act = await api('POST', `/api/docs/${docId}/activate`);
  assert.equal(act.status, 200);
  assert.equal((await api('GET', '/api/docs/current')).json.doc.id, docId);
  const list = await api('GET', '/api/docs');
  assert.ok(list.json.docs.find((d) => d.id === otherId && d.exists === true));
  const del = await api('DELETE', `/api/docs/${otherId}`);
  assert.equal(del.status, 200);
  assert.equal((await api('GET', `/api/docs/${otherId}`)).status, 404);
});

test('every viewer hears docs.changed when the document list changes', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/docs/${docId}/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const r = await api('POST', `/api/docs/${docId}/activate`);
  assert.equal(r.status, 200);
  let buf = '';
  const deadline = Date.now() + 3000;
  while (!buf.includes('docs.changed') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
  }
  ctrl.abort();
  assert.match(buf, /event: docs\.changed/);
});

test('reveal is refused for unknown documents and skipped under PDFPIN_NO_LAUNCH', async () => {
  assert.equal((await api('POST', '/api/docs/nope/reveal')).status, 404);
  const r = await api('POST', `/api/docs/${docId}/reveal`);
  assert.equal(r.status, 200);
  assert.equal(r.json.launched, false);
});

test('colour follows the tag: same tag keeps its colour, new tags take the next one', async () => {
  const fresh = await api('POST', '/api/docs', { path: pdfPath });
  const id = fresh.json.doc.id;
  await api('DELETE', `/api/docs/${id}/annotations`);
  const add = (text, tag, color) => api('POST', `/api/docs/${id}/annotations`, { text, tag, color, note: '' });

  const a = await add('Hello World', 'coverage');
  const b = await add('Second line', 'bugs');
  const c = await add('Eclipser achieved', 'coverage');
  assert.equal(a.json.annotation.color, 'yellow');       // first tag gets the first palette colour
  assert.notEqual(b.json.annotation.color, 'yellow');    // a different tag gets a different one
  assert.equal(c.json.annotation.color, a.json.annotation.color); // same tag, same colour

  const explicit = await add('higher code coverage', 'coverage', 'purple');
  assert.equal(explicit.json.annotation.color, 'purple'); // an explicit colour always wins

  const untagged = await api('POST', `/api/docs/${id}/annotations`, { text: 'Page two', note: '' });
  assert.equal(untagged.json.annotation.color, 'yellow'); // no tag, no rule: the default
});

test('the palette offers twelve named colours and rejects anything else', async () => {
  const { COLORS } = await import('../src/server/docs.js');
  assert.equal(COLORS.length, 12);
  for (const c of ['yellow', 'green', 'blue', 'pink', 'purple', 'orange', 'teal', 'red', 'cyan', 'lime', 'indigo', 'grape']) {
    assert.ok(COLORS.includes(c), `missing ${c}`);
  }
  const ok = await api('POST', `/api/docs/${docId}/annotations`, { text: 'Hello World', note: '', color: 'teal' });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.annotation.color, 'teal');
  const bad = await api('POST', `/api/docs/${docId}/annotations`, { text: 'Hello World', note: '', color: 'chartreuse' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /chartreuse/);
});

test('the open dialog is skipped under PDFPIN_NO_LAUNCH and reports it', async () => {
  const r = await api('POST', '/api/open-dialog');
  assert.equal(r.status, 200);
  assert.equal(r.json.cancelled, true);
  assert.equal(r.json.doc, undefined);
  assert.equal(r.json.unavailable, undefined);
});
