import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/web/i18n.js', import.meta.url), 'utf8');
const keysOf = (name) => {
  const body = src.split(`const ${name} = {`)[1].split('\n};')[0];
  return body.match(/^\s*'[^']+':/gm).map((s) => s.trim().slice(1, -2));
};

test('the Korean table covers every English string and adds none of its own', () => {
  const en = keysOf('EN');
  const ko = keysOf('KO');
  assert.deepEqual(en.filter((k) => !ko.includes(k)), [], 'missing Korean strings');
  assert.deepEqual(ko.filter((k) => !en.includes(k)), [], 'Korean strings with no English original');
  assert.ok(en.length > 100);
});

test('every action in the default keymap has a label in both languages', async () => {
  const { DEFAULT_KEYS } = await import('../src/server/settings.js');
  const en = keysOf('EN');
  for (const action of Object.keys(DEFAULT_KEYS)) assert.ok(en.includes(`action.${action}`), `action.${action} has no label`);
});

test('placeholders in a translation match the original', () => {
  const grab = (name) => {
    const body = src.split(`const ${name} = {`)[1].split('\n};')[0];
    const out = {};
    for (const m of body.matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)) out[m[1]] = m[2];
    return out;
  };
  const en = grab('EN');
  const ko = grab('KO');
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [k, v] of Object.entries(en)) {
    if (!ko[k]) continue;
    assert.deepEqual(vars(ko[k]), vars(v), `placeholders differ for ${k}`);
  }
});
