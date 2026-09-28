import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { status, install, remove, sourceDir, autoInstall, pendingNotice, AGENTS } from '../src/cli/skill.js';

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-skill-'));
const rowsOf = (home) => Object.fromEntries(status(home).map((r) => [r.id, r]));
const skillAt = (row) => path.join(row.dest, 'SKILL.md');

test('the packaged skill is a skill both agents can read', () => {
  // a Windows checkout carries CRLF, which neither agent minds and this test should not either
  const head = fs.readFileSync(path.join(sourceDir(), 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n').split('---')[1];
  assert.match(head, /\nname: pdfpin\n/);
  assert.match(head, /\ndescription: .+/);
});

test('an agent that is not installed here is reported, not written to', () => {
  const home = tmpHome();
  const rows = status(home);
  assert.deepEqual(rows.map((r) => r.id), AGENTS.map((a) => a.id));
  assert.ok(rows.every((r) => !r.present && r.state === 'absent'));
  assert.equal(fs.existsSync(path.join(home, '.claude')), false);
});

test('install writes the skill for each agent and says so only once', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  assert.equal(rowsOf(home).codex.present, true);

  assert.equal(install(rowsOf(home).codex), 'installed');
  const row = rowsOf(home).codex;
  assert.equal(row.state, 'current');
  assert.equal(fs.readFileSync(skillAt(row), 'utf8'), fs.readFileSync(path.join(sourceDir(), 'SKILL.md'), 'utf8'));
  assert.equal(install(row), 'current');
});

test('a copy made by hand is adopted, and a later version updates it', () => {
  const home = tmpHome();
  const row = rowsOf(home).claude;
  fs.mkdirSync(row.dest, { recursive: true });
  fs.copyFileSync(path.join(sourceDir(), 'SKILL.md'), skillAt(row));
  assert.equal(rowsOf(home).claude.state, 'current');

  assert.equal(install(rowsOf(home).claude), 'current');
  // pretend this copy came from an older pdfpin: the marker still matches what is on disk
  fs.writeFileSync(skillAt(row), '---\nname: pdfpin\n---\nold\n');
  const marker = JSON.parse(fs.readFileSync(path.join(row.dest, '.pdfpin-install.json'), 'utf8'));
  marker.files['SKILL.md'] = 'stale';
  fs.writeFileSync(path.join(row.dest, '.pdfpin-install.json'), JSON.stringify(marker));
  assert.equal(rowsOf(home).claude.state, 'modified');
});

test('an edited copy is left alone until --force', () => {
  const home = tmpHome();
  assert.equal(install(rowsOf(home).codex), 'installed');
  const row = rowsOf(home).codex;
  fs.appendFileSync(skillAt(row), '\nmy own note\n');
  assert.equal(rowsOf(home).codex.state, 'modified');

  assert.equal(install(rowsOf(home).codex), 'modified');
  assert.match(fs.readFileSync(skillAt(row), 'utf8'), /my own note/);
  assert.equal(remove(rowsOf(home).codex), 'modified');
  assert.equal(fs.existsSync(skillAt(row)), true);

  assert.equal(install(rowsOf(home).codex, { force: true }), 'updated');
  assert.equal(rowsOf(home).codex.state, 'current');
});

test('remove takes back what it wrote and leaves anything else', () => {
  const home = tmpHome();
  install(rowsOf(home).claude);
  const row = rowsOf(home).claude;
  fs.writeFileSync(path.join(row.dest, 'notes-of-my-own.md'), 'keep me');

  assert.equal(remove(rowsOf(home).claude), 'removed');
  assert.equal(fs.existsSync(skillAt(row)), false);
  assert.equal(fs.readFileSync(path.join(row.dest, 'notes-of-my-own.md'), 'utf8'), 'keep me');
  assert.equal(remove(rowsOf(home).claude), 'absent');
});

test('a global install writes the skill, a build in a clone does not', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  assert.equal(autoInstall({ env: {}, home }).skipped, 'not a global install');
  assert.equal(autoInstall({ env: { npm_config_global: 'true', PDFPIN_NO_SKILL: '1' }, home }).skipped, 'PDFPIN_NO_SKILL is set');
  assert.equal(rowsOf(home).claude.state, 'absent');

  const env = { npm_config_global: 'true' };
  const { results } = autoInstall({ env, home });
  assert.deepEqual(results.map((r) => [r.target.id, r.result]), [['claude', 'installed']]);
  assert.equal(rowsOf(home).claude.state, 'current');
  assert.equal(autoInstall({ env, home }).results[0].result, 'current');
});

test('a machine with neither agent is left alone', () => {
  const home = tmpHome();
  assert.equal(autoInstall({ env: { npm_config_global: 'true' }, home }).skipped, 'no agent found on this machine');
  assert.deepEqual(fs.readdirSync(home), []);
});

test('the skill is announced once, and only once there is something to announce', () => {
  const home = tmpHome();
  const pdfpinHome = path.join(home, '.pdfpin');
  assert.equal(pendingNotice(pdfpinHome, home), null);
  assert.equal(fs.existsSync(path.join(pdfpinHome, '.skill-notice')), false);

  install(rowsOf(home).codex);
  const notice = pendingNotice(pdfpinHome, home);
  assert.match(notice, /Skill installed for Codex/);
  assert.equal(pendingNotice(pdfpinHome, home), null);
});

test('an agent left without the skill is told how to get it', () => {
  // npm may warn about install scripts and one day refuse to run them; the hint is the way back
  const home = tmpHome();
  const pdfpinHome = path.join(home, '.pdfpin');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });

  const notice = pendingNotice(pdfpinHome, home);
  assert.match(notice, /Claude Code and Codex are on this machine/);
  assert.match(notice, /pdfpin skill install/);
  assert.equal(pendingNotice(pdfpinHome, home), null, 'said once is enough');
});

test('a machine with no agent at all is told nothing', () => {
  const home = tmpHome();
  const pdfpinHome = path.join(home, '.pdfpin');
  assert.equal(pendingNotice(pdfpinHome, home), null);
  assert.equal(fs.existsSync(path.join(pdfpinHome, '.skill-notice')), false);
});
