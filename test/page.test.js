// The viewer's page. A tag that does not close where it means to fails nothing and throws nothing:
// the browser ends it at the first raw '>' and renders the rest of the markup as text in the
// window. The guard has to be on the source. A parser has already decided where the broken bytes
// went by the time you can ask it, and jsdom and Chrome do not decide the same thing — jsdom drops
// them, so a DOM assertion here would pass on a page that is visibly broken in the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadViewerDom } from './helpers/dom.js';

const html = fs.readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const { document } = loadViewerDom().window;

const headLines = () => html
  .slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
  .split('\n')
  .filter((l) => l.trim());

// One tag, one comment, or a tag with its own closing tag. Anything after that on the same line is
// markup the browser will show as text, which is exactly what a truncated attribute leaves behind.
const ONE_TAG = /^\s*(<!--[\s\S]*?-->|<([a-zA-Z][\w-]*)\b[^>]*>(?:[^<]*<\/\2>)?)\s*$/;

test('every line of the head is a single tag, with no markup trailing it', () => {
  const spilling = headLines().filter((l) => !ONE_TAG.test(l));
  assert.deepEqual(spilling.map((l) => l.slice(0, 70)), [], 'this line would spill into the window');
});

test('the tab icon is one valid drawing, the same pin the logo uses', () => {
  const href = document.querySelector('link[rel="icon"]')?.getAttribute('href');
  assert.ok(href?.startsWith('data:image/svg+xml,'), 'inline, so a tab needs no second request');
  const svg = decodeURIComponent(href.slice('data:image/svg+xml,'.length));
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/, 'it decodes to an svg');
  // The mark in the header, the logo and the app icon are all this path. The tab must not drift.
  const pin = 'M14.5 3.5 20.5 9.5';
  assert.ok(svg.includes(pin), 'the same pin as the logo');
  assert.ok(document.querySelector('.brand svg path')?.getAttribute('d').includes(pin), 'and as the header mark');
});

test('the page still points at the manifest, which is what makes it installable', () => {
  assert.equal(document.querySelector('link[rel="manifest"]')?.getAttribute('href'), '/assets/manifest.webmanifest');
});
