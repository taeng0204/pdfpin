import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/web/shortcuts.js', import.meta.url), 'utf8');
const listOf = (name) => {
  const body = src.split(`const ${name} = new Set([`)[1].split(']')[0];
  return body.match(/'[^']+'/g).map((s) => s.slice(1, -1));
};

test('the browser keeps different combinations on each platform', async () => {
  const mac = listOf('MAC_RESERVED');
  const other = listOf('OTHER_RESERVED');

  for (const b of ['mod+h', 'mod+q', 'mod+m', 'mod+w', 'mod+n', 'mod+t']) assert.ok(mac.includes(b), `mac should reserve ${b}`);
  for (const b of ['mod+n', 'mod+t', 'mod+w', 'mod+shift+n', 'mod+shift+t']) assert.ok(other.includes(b), `windows should reserve ${b}`);

  // the defaults we ship must be usable on both
  const { DEFAULT_KEYS } = await import('../src/server/settings.js');
  for (const [action, binding] of Object.entries(DEFAULT_KEYS)) {
    assert.equal(mac.includes(binding), false, `${action} (${binding}) clashes on macOS`);
    assert.equal(other.includes(binding), false, `${action} (${binding}) clashes on Windows`);
  }
});
