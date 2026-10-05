import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { status, install, remove, supported, autoUpdate, destPath, APP_NAME, BUNDLE_ID } from '../src/cli/app.js';
import { VERSION } from '../src/server/index.js';

const onMac = process.platform === 'darwin';
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-app-'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/** A bundle shaped like one we wrote, without running osacompile: enough for status to read. */
function fakeBundle(home, { version = VERSION, launcher = '#!/bin/sh\nexit 0\n', marked = true } = {}) {
  const app = destPath(home);
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), '<plist/>');
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'launch.sh'), launcher);
  if (marked) {
    fs.writeFileSync(path.join(app, 'Contents', 'Resources', '.pdfpin-app.json'),
      JSON.stringify({ name: APP_NAME, version, launcher: sha(launcher) }));
  }
  return app;
}

test('the launcher is macOS only, and says so instead of failing', () => {
  assert.equal(supported('darwin'), true);
  assert.equal(supported('win32'), false);
  assert.equal(supported('linux'), false);
  if (!onMac) assert.equal(install({ home: tmpHome() }), 'unsupported');
});

test('nothing in ~/Applications reads as absent, and removing it is not an error', () => {
  const home = tmpHome();
  const r = status(home);
  assert.equal(r.state, 'absent');
  assert.equal(r.installed, null);
  assert.equal(r.app, path.join(home, 'Applications', APP_NAME));
  assert.equal(remove({ home }), 'absent');
});

test('a bundle this pdfpin wrote is current; one from an older pdfpin is outdated', () => {
  const home = tmpHome();
  fakeBundle(home);
  assert.equal(status(home).state, 'current');

  fakeBundle(home, { version: '0.0.1' });
  const old = status(home);
  assert.equal(old.state, 'outdated');
  assert.equal(old.installed, '0.0.1');
  assert.equal(old.version, VERSION);
});

test('a bundle pdfpin did not write is reported, never replaced or removed', () => {
  const home = tmpHome();
  const app = fakeBundle(home, { marked: false });
  assert.equal(status(home).state, 'modified');
  assert.equal(install({ home }), 'modified');
  assert.equal(remove({ home }), 'modified');
  assert.ok(fs.existsSync(app), 'it is still there');

  assert.equal(remove({ home, force: true }), 'removed');
  assert.equal(fs.existsSync(app), false);
});

test('an edited launcher counts as modified, so an update cannot clobber it', () => {
  const home = tmpHome();
  fakeBundle(home);
  const launcher = path.join(destPath(home), 'Contents', 'Resources', 'launch.sh');
  fs.writeFileSync(launcher, '#!/bin/sh\n# mine now\nexit 0\n');
  assert.equal(status(home).state, 'modified');
});

test('an update only touches a launcher that is already there', () => {
  const home = tmpHome();
  const asGlobal = { npm_config_global: 'true' };
  assert.ok(autoUpdate({ env: {}, home }).skipped, 'a local install is not an update');
  assert.ok(autoUpdate({ env: { ...asGlobal, PDFPIN_NO_APP: '1' }, home }).skipped, 'opted out');
  assert.ok(autoUpdate({ env: asGlobal, home }).skipped, 'nothing is installed here');
  assert.equal(fs.existsSync(destPath(home)), false, 'an update never puts one in ~/Applications');
});

test('an update leaves a bundle you wrote yourself alone', { skip: !onMac && 'macOS only' }, () => {
  const home = tmpHome();
  fakeBundle(home, { marked: false });
  assert.equal(autoUpdate({ env: { npm_config_global: 'true' }, home }).result, 'modified');
  assert.equal(status(home).state, 'modified', 'still theirs');
});

test('an update rebuilds a launcher left over from an older pdfpin, and stops there', { skip: !onMac && 'macOS only' }, () => {
  const home = tmpHome();
  fakeBundle(home, { version: '0.0.1' });
  assert.equal(status(home).state, 'outdated');

  assert.equal(autoUpdate({ env: { npm_config_global: 'true' }, home }).result, 'updated');
  assert.equal(status(home).state, 'current');
  assert.ok(fs.existsSync(path.join(destPath(home), 'Contents/Resources/droplet.icns')), 'a real bundle, not a patched one');

  assert.equal(autoUpdate({ env: { npm_config_global: 'true' }, home }).result, 'current', 'and the next update has nothing to do');
});

test('install builds a launchable bundle and marks it as ours', { skip: !onMac && 'macOS only' }, () => {
  const home = tmpHome();
  assert.equal(install({ home }), 'installed');

  const app = destPath(home);
  const res = path.join(app, 'Contents', 'Resources');
  for (const f of ['Contents/MacOS/droplet', 'Contents/Resources/launch.sh', 'Contents/Resources/droplet.icns', 'Contents/Resources/Scripts/main.scpt']) {
    assert.ok(fs.existsSync(path.join(app, f)), `${f} is in the bundle`);
  }
  assert.equal(fs.existsSync(path.join(res, 'Assets.car')), false, 'the template artwork is gone');
  assert.ok(fs.statSync(path.join(res, 'launch.sh')).mode & 0o111, 'the launcher is executable');

  const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
  assert.match(plist, new RegExp(BUNDLE_ID.replace(/\./g, '\\.')));
  assert.match(plist, /com\.adobe\.pdf/);
  assert.match(plist, /LSUIElement/);
  assert.match(plist, new RegExp(VERSION.replace(/\./g, '\\.')));

  assert.equal(status(home).state, 'current');
  assert.equal(install({ home }), 'current');
  assert.equal(install({ home, force: true }), 'updated');
  assert.equal(remove({ home }), 'removed');
});
