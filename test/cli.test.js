import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeFixturePdf } from './helpers/fixture.js';

const BIN = path.resolve('bin/pdfpin.js');

function run(args, env) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('cli drives a daemon end to end: open, text, add, list, rm, stop', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-cli-'));
  const env = { PDFPIN_HOME: home, PDFPIN_PORT: '0' };
  const pdf = await makeFixturePdf(home);
  try {
    const open = run(['open', pdf, '--no-browser'], env);
    assert.equal(open.code, 0, open.err);
    assert.match(open.out, /Fixture Paper/);
    assert.match(open.out, /http:\/\/127\.0\.0\.1:\d+\/view\//);

    const text = run(['text', '-p', '2'], env);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, /=== Page 2/);
    assert.match(text.out, /Page two/);

    const add = run(['add', '--text', 'higher code coverage than KLEE', '--note', 'coverage claim', '--color', 'green', '--tag', 'ev'], env);
    assert.equal(add.code, 0, add.err);
    assert.match(add.out, /a_[0-9a-z]{6}/);
    assert.match(add.out, /p\.1/);

    const miss = run(['add', '--text', 'quantum gravity waveguide', '--note', 'x'], env);
    assert.equal(miss.code, 2);
    assert.match(miss.err, /not found/i);

    const batch = run(['add', '--json', JSON.stringify([{ text: 'Hello World', note: 'hi' }, { text: 'zzz nope', note: '' }])], env);
    assert.equal(batch.code, 2, batch.err); // partial failure still exits 2 so agents notice
    assert.match(batch.out, /1 added/);
    assert.match(batch.out + batch.err, /1 failed/);

    const list = run(['list', '--json'], env);
    assert.equal(list.code, 0, list.err);
    const rows = JSON.parse(list.out).annotations;
    assert.equal(rows.length, 2);

    const rm = run(['rm', rows[0].id], env);
    assert.equal(rm.code, 0, rm.err);

    const find = run(['find', 'fuzzing', '--json'], env);
    assert.equal(JSON.parse(find.out).hits.length, 2);

    const mark = run(['mark', '--json', JSON.stringify({ title: 'Evidence for X', flow: 'two passages:\\n- a\\n- b', highlights: [{ text: 'Page two', note: 'p2', color: 'blue', tag: 'ev' }, { text: 'zzz nope' }] })], env);
    assert.equal(mark.code, 2, mark.err); // one highlight failed
    assert.match(mark.out, /session s_[0-9a-z]{6}/);
    assert.match(mark.out, /1 added, 1 failed/);
    const listed = JSON.parse(run(['list', '--json'], env).out);
    assert.equal(listed.sessions.length, 1);
    assert.equal(listed.sessions[0].flow, 'two passages:\n- a\n- b'); // literal \n becomes a line break
    assert.equal(listed.annotations.filter((a) => a.sessionId === listed.sessions[0].id).length, 1);
    const attached = run(['add', '--text', 'Hello World', '--note', 'attached to current session'], env);
    assert.equal(attached.code, 0, attached.err);
    const detached = run(['add', '--text', 'Hello World', '--note', 'no session', '--no-session'], env);
    assert.equal(detached.code, 0, detached.err);
    const after = JSON.parse(run(['list', '--json'], env).out);
    assert.equal(after.annotations.filter((a) => a.sessionId === listed.sessions[0].id).length, 2);
    assert.equal(after.annotations.filter((a) => !a.sessionId).length, 2);
    const upd = run(['session', 'update', '--flow', 'final overview'], env);
    assert.equal(upd.code, 0, upd.err);
    const sessions = run(['session', 'list'], env);
    assert.match(sessions.out, /Evidence for X/);
    const legacy = run(['summary', '--title', 'x'], env);
    assert.equal(legacy.code, 1);
    assert.match(legacy.err, /replaced by sessions/);

    const status = run(['status'], env);
    assert.match(status.out, /running/);

    const stop = run(['stop'], env);
    assert.equal(stop.code, 0, stop.err);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(fs.existsSync(path.join(home, 'server.json')), false);
  } finally {
    run(['stop'], env);
  }
});

test('cli guide prints agent instructions without a daemon', () => {
  const r = run(['guide'], { PDFPIN_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-g-')) });
  assert.equal(r.code, 0);
  assert.match(r.out, /pdfpin add --text/);
});

test('a foreign pdfpin daemon on the default port does not block a second home', async () => {
  const { createServer } = await import('../src/server/index.js');
  const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-a-'));
  const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-b-'));
  const a = await createServer({ home: homeA, port: 0 });
  const env = { PDFPIN_HOME: homeB, PDFPIN_PORT: String(a.port) };
  try {
    const pdf = await makeFixturePdf(homeB);
    const open = run(['open', pdf, '--no-browser'], env);
    assert.equal(open.code, 0, open.err);
    const info = JSON.parse(fs.readFileSync(path.join(homeB, 'server.json'), 'utf8'));
    assert.notEqual(info.port, a.port);
  } finally {
    run(['stop'], env);
    await a.close();
  }
});
