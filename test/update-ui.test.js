// The one line a reader sees when a newer pdfpin exists, driven through the page it really renders.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadViewerDom } from './helpers/dom.js';

let initUpdateNotice;

const notice = () => document.getElementById('update-notice');
const reply = (body, { ok = true } = {}) => async () => ({ ok, text: async () => JSON.stringify(body) });

before(async () => {
  loadViewerDom();
  ({ initUpdateNotice } = await import('../src/web/update-ui.js'));
});

beforeEach(() => {
  notice().hidden = true;
  notice().replaceChildren();
  try { localStorage.clear(); } catch { /* jsdom always has one */ }
});

test('nothing is said when this is already the newest pdfpin', async () => {
  globalThis.fetch = reply({ current: '0.4.0', latest: '0.4.0', newer: false, checked: true });
  await initUpdateNotice();
  assert.equal(notice().hidden, true);
});

test('a newer version is named, and a registry install gets a button', async () => {
  globalThis.fetch = reply({ current: '0.3.1', latest: '0.4.0', newer: true, checked: true, kind: 'registry' });
  await initUpdateNotice();
  assert.equal(notice().hidden, false);
  assert.match(notice().querySelector('.update-title').textContent, /0\.4\.0/);
  assert.match(notice().querySelector('.update-sub').textContent, /0\.3\.1/, 'and what you are on');
  assert.equal(notice().querySelector('.update-go').hidden, false);
});

test('a checkout wearing the global name is told to use git, not a button', async () => {
  globalThis.fetch = reply({ current: '0.3.1', latest: '0.4.0', newer: true, checked: true, kind: 'linked' });
  await initUpdateNotice();
  assert.equal(notice().hidden, false);
  assert.equal(notice().querySelector('.update-go').hidden, true, 'npm must not overwrite a checkout');
  assert.match(notice().querySelector('.update-sub').textContent, /git/i);
});

test('a failed update says why and hands over the command', async () => {
  globalThis.fetch = async (url, opts) => (opts?.method === 'POST'
    ? { ok: true, text: async () => JSON.stringify({ ok: false, kind: 'failed', error: 'EACCES: permission denied' }) }
    : { ok: true, text: async () => JSON.stringify({ current: '0.3.1', latest: '0.4.0', newer: true, kind: 'registry' }) });
  await initUpdateNotice();
  await notice().querySelector('.update-go').onclick();
  assert.match(notice().querySelector('.update-sub').textContent, /EACCES/);
  assert.equal(notice().querySelector('.update-cmd').hidden, false);
  assert.equal(notice().querySelector('.update-go').hidden, true);
});

test('closing it keeps it closed for that version, but not for the one after', async () => {
  globalThis.fetch = reply({ current: '0.3.1', latest: '0.4.0', newer: true, checked: true, kind: 'registry' });
  await initUpdateNotice();
  notice().querySelector('.update-close').click();
  assert.equal(notice().hidden, true);

  await initUpdateNotice();
  assert.equal(notice().hidden, true, 'the same version stays dismissed');


  globalThis.fetch = reply({ current: '0.3.1', latest: '0.5.0', newer: true, checked: true, kind: 'registry' });
  await initUpdateNotice();
  assert.equal(notice().hidden, false, 'a later one speaks up again');
});

test('a daemon that cannot answer leaves the page as it was', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  await initUpdateNotice();
  assert.equal(notice().hidden, true);

  globalThis.fetch = reply({ error: 'Not found' }, { ok: false });
  await initUpdateNotice();
  assert.equal(notice().hidden, true, 'and so does one too old to know the route');
});
