import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lockState, lockHome, STALE_AFTER_MS } from '../src/server/lock.js';

const alive = () => true;
const dead = () => false;

test('a lock is held only while its owner keeps refreshing it and is still running', () => {
  const raw = JSON.stringify({ pid: 4242, token: 'abc' });
  const now = 1_000_000;

  assert.equal(lockState({ raw, mtimeMs: now - 1000, now, isAlive: alive }), 'held');
  assert.equal(lockState({ raw, mtimeMs: now - STALE_AFTER_MS - 1, now, isAlive: alive }), 'stale', 'it stopped refreshing');
  assert.equal(lockState({ raw, mtimeMs: now - 1000, now, isAlive: dead }), 'stale', 'its process is gone');
  assert.equal(lockState({ raw: 'not json', mtimeMs: now, now, isAlive: alive }), 'stale', 'we cannot tell who owns it');
  assert.equal(lockState({ raw: JSON.stringify({ token: 'x' }), mtimeMs: now, now, isAlive: alive }), 'stale', 'no pid to check');
});

test('a crashed daemon whose pid was handed to something else does not block a restart', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-lk-'));
  const file = path.join(home, 'daemon.lock');
  // the lock names a pid that is very much alive: this process
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token: 'from-the-crashed-one' }));
  const old = (Date.now() - STALE_AFTER_MS - 5000) / 1000;
  fs.utimesSync(file, old, old);

  const release = lockHome(home);
  assert.notEqual(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'from-the-crashed-one');
  assert.throws(() => lockHome(home), /already owns/i, 'but a lock we hold right now still blocks');
  release();
  assert.equal(fs.existsSync(file), false);
});

test('the owner keeps the lock fresh while it runs', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-hb-'));
  const file = path.join(home, 'daemon.lock');
  const release = lockHome(home, { heartbeatMs: 40 });
  const first = fs.statSync(file).mtimeMs;
  await new Promise((r) => setTimeout(r, 140));
  assert.ok(fs.statSync(file).mtimeMs > first, 'the timestamp moved on its own');
  release();
});
