import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCommand } from '../src/server/filedialog.js';

test('each platform gets a native file chooser', () => {
  const mac = pickCommand('darwin');
  assert.equal(mac.cmd, 'osascript');
  assert.match(mac.args.join(' '), /choose file/);
  assert.match(mac.args.join(' '), /com\.adobe\.pdf/);

  const win = pickCommand('win32');
  assert.match(win.cmd, /powershell/i);
  assert.match(win.args.join(' '), /OpenFileDialog/);
  assert.match(win.args.join(' '), /\*\.pdf/);

  const linux = pickCommand('linux');
  assert.equal(linux.cmd, 'zenity');
  assert.match(linux.args.join(' '), /--file-selection/);
});
