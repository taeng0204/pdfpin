import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ellipsis } from '../src/web/text.js';

test('a label that fits is left alone', () => {
  assert.equal(ellipsis('How does the agent know?', 40), 'How does the agent know?');
  assert.equal(ellipsis('  padded  ', 40), 'padded');
  assert.equal(ellipsis(undefined, 40), '');
});

test('a long label is cut at a word and says so', () => {
  assert.equal(ellipsis('How does the agent know where to put a highlight?', 40),
    'How does the agent know where to put a…');
});

test('a label with no space near the cut is cut where it must be', () => {
  assert.equal(ellipsis('세션에 하이라이트가 하나도 남지 않으면 세션도 함께 사라집니다', 10), '세션에 하이라이트가…');
  assert.equal(ellipsis('x'.repeat(50), 10), `${'x'.repeat(10)}…`);
});
