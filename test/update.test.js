import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isNewer, updateState, readCache } from '../src/server/update.js';

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-update-'));
const answers = (latest, log = []) => Object.assign(
  async (url) => { log.push(url); return { ok: true, json: async () => ({ latest }) }; },
  { log },
);
const refuses = () => async () => { throw new Error('getaddrinfo ENOTFOUND'); };

const base = { name: '@taeng0204/pdfpin', current: '0.3.1', enabled: true, env: {} };

test('newer means newer, and a prerelease is never offered', () => {
  assert.equal(isNewer('0.4.0', '0.3.1'), true);
  assert.equal(isNewer('0.3.2', '0.3.1'), true);
  assert.equal(isNewer('1.0.0', '0.9.9'), true);
  assert.equal(isNewer('0.3.1', '0.3.1'), false);
  assert.equal(isNewer('0.3.0', '0.3.1'), false, 'a rollback is not an update');
  assert.equal(isNewer('0.10.0', '0.9.0'), true, 'ten is after nine, not before it');
  assert.equal(isNewer('0.4.0-rc.1', '0.3.1'), false, 'nobody is nudged onto a prerelease');
  assert.equal(isNewer(undefined, '0.3.1'), false);
});

test('turned off, it asks nothing at all', async () => {
  const home = tmpHome();
  const fetchImpl = answers('9.9.9');
  assert.deepEqual(
    await updateState({ ...base, home, enabled: false, fetchImpl }),
    { current: '0.3.1', latest: null, newer: false, checked: false },
  );
  await updateState({ ...base, home, env: { PDFPIN_NO_UPDATE_CHECK: '1' }, fetchImpl });
  assert.equal(fetchImpl.log.length, 0, 'no request was made');
  assert.equal(readCache(home), null, 'and nothing was written');
});

test('it asks once and then reads the answer it kept', async () => {
  const home = tmpHome();
  const fetchImpl = answers('0.4.0');
  const first = await updateState({ ...base, home, fetchImpl, now: 1_000 });
  assert.deepEqual(first, { current: '0.3.1', latest: '0.4.0', newer: true, checked: true });
  assert.equal(fetchImpl.log.length, 1);
  assert.match(fetchImpl.log[0], /registry\.npmjs\.org.*dist-tags$/);
  assert.match(fetchImpl.log[0], /%40taeng0204%2Fpdfpin/, 'the scoped name is escaped');

  const hour = 60 * 60 * 1000;
  const again = await updateState({ ...base, home, fetchImpl, now: 1_000 + 23 * hour });
  assert.deepEqual(again, first, 'same answer');
  assert.equal(fetchImpl.log.length, 1, 'without asking again');

  await updateState({ ...base, home, fetchImpl, now: 1_000 + 25 * hour });
  assert.equal(fetchImpl.log.length, 2, 'a day later it asks once more');
});

test('offline says nothing rather than guessing, and keeps the last answer', async () => {
  const home = tmpHome();
  assert.deepEqual(
    await updateState({ ...base, home, fetchImpl: refuses() }),
    { current: '0.3.1', latest: null, newer: false, checked: false },
  );

  await updateState({ ...base, home, fetchImpl: answers('0.4.0'), now: 1_000 });
  const stale = await updateState({ ...base, home, fetchImpl: refuses(), now: 1_000 + 48 * 60 * 60 * 1000 });
  assert.equal(stale.latest, '0.4.0', 'yesterday\'s answer is better than none');
  assert.equal(stale.newer, true);
});

test('a reader already on the newest version is told nothing', async () => {
  const home = tmpHome();
  const r = await updateState({ ...base, home, current: '0.4.0', fetchImpl: answers('0.4.0') });
  assert.equal(r.newer, false);
  assert.equal(r.checked, true, 'it did look');
});
