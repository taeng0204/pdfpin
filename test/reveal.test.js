import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealCommand } from '../src/server/reveal.js';

test('revealCommand selects the file in the platform file manager', () => {
  assert.deepEqual(revealCommand('darwin', '/papers/a b.pdf'), { cmd: 'open', args: ['-R', '/papers/a b.pdf'] });
  assert.deepEqual(revealCommand('win32', 'C:\\papers\\a b.pdf'), { cmd: 'explorer.exe', args: ['/select,C:\\papers\\a b.pdf'] });
  assert.deepEqual(revealCommand('linux', '/papers/a.pdf'), { cmd: 'xdg-open', args: ['/papers'] });
});
