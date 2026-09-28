// The side panel, driven the way a reader drives it: through clicks on the rendered DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadViewerDom, recordingApi, stubViewer, stubHighlights, annotation, session } from './helpers/dom.js';

let state; let setAnnotations; let setSessions; let api;

const SESSIONS = [
  session({ id: 's_one', title: 'What does it measure?', flow: 'Two numbers carry it.' }),
  session({ id: 's_two', title: 'Can it be steered?', flow: 'No, and here is why.' }),
];
const ANNOTATIONS = [
  annotation({ id: 'a_1', sessionId: 's_one', tag: 'scope', color: 'yellow' }),
  annotation({ id: 'a_2', sessionId: 's_one', tag: 'result', color: 'green', page: 2 }),
  annotation({ id: 'a_3', sessionId: 's_two', tag: 'scope', color: 'yellow', page: 3 }),
];

const sections = () => [...document.querySelectorAll('.session')];
const sectionOf = (id) => sections().find((s) => s.dataset.session === id);
const editors = () => document.querySelectorAll('.session-editor');
const cardEditors = () => document.querySelectorAll('.card-edit-tag');

function seed() {
  setSessions(SESSIONS, 's_two');
  setAnnotations(ANNOTATIONS);
}

before(async () => {
  loadViewerDom();
  state = (await import('../src/web/state.js')).state;
  ({ setAnnotations, setSessions } = await import('../src/web/state.js'));
  const { initPanel } = await import('../src/web/panel.js');
  api = recordingApi();
  initPanel({ docApi: api, viewer: stubViewer(), highlights: stubHighlights() });
  seed();
});

test('the panel renders one section per session, newest first', () => {
  assert.deepEqual(sections().map((s) => s.dataset.session), ['s_two', 's_one']);
  assert.equal(document.querySelectorAll('.card').length, 3);
  assert.equal(state.sessions.length, 2);
});

test('pressing edit on a session opens exactly one editor, however often it is pressed', () => {
  const sec = sectionOf('s_one');
  sec.querySelector('.act-sedit').click();
  assert.equal(editors().length, 1);

  sectionOf('s_one').querySelector('.act-sedit').click();
  sectionOf('s_one').querySelector('.act-sedit').click();
  assert.equal(editors().length, 1, 'a second press must not stack another editor');
  assert.equal(sectionOf('s_one').querySelectorAll('.session-editor').length, 1);
});

test('pressing edit again keeps what was typed', () => {
  const input = sectionOf('s_one').querySelector('.session-edit-title');
  input.value = 'a title I am still typing';
  sectionOf('s_one').querySelector('.act-sedit').click();
  assert.equal(sectionOf('s_one').querySelector('.session-edit-title').value, 'a title I am still typing');
});

test('editing another session moves the editor rather than opening a second one', () => {
  sectionOf('s_two').querySelector('.act-sedit').click();
  assert.equal(editors().length, 1);
  assert.equal(sectionOf('s_two').querySelectorAll('.session-editor').length, 1);
  assert.equal(sectionOf('s_one').querySelectorAll('.session-editor').length, 0);
});

test('cancelling closes the editor and puts the overview back', () => {
  sectionOf('s_two').querySelector('.act-scancel').click();
  assert.equal(editors().length, 0);
  assert.match(sectionOf('s_two').querySelector('.session-flow').textContent, /No, and here is why/);
});

test('saving a session sends the edited title and flow once', () => {
  sectionOf('s_one').querySelector('.act-sedit').click();
  const box = sectionOf('s_one').querySelector('.session-editor');
  box.querySelector('.session-edit-title').value = 'A better question';
  box.querySelector('textarea').value = 'A better overview';
  box.querySelector('.act-ssave').click();

  const saves = api.calls.filter((c) => c.name === 'updateSession');
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].args, ['s_one', { title: 'A better question', flow: 'A better overview' }]);
});

test('a card editor is single too, and moves between cards', () => {
  const cards = [...document.querySelectorAll('.card')];
  cards[0].querySelector('.act-edit').click();
  assert.equal(cardEditors().length, 1);

  [...document.querySelectorAll('.card')][1].querySelector('.act-edit').click();
  assert.equal(cardEditors().length, 1, 'the first card must have given its editor up');

  const open = document.querySelector('.card-edit-tag').closest('.card');
  assert.equal(open.dataset.id, [...document.querySelectorAll('.card')][1].dataset.id);
});

test('a tag is only sent when it actually changed, so the colour rule is left alone', () => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.dataset.id === 'a_1');
  card.querySelector('.act-edit').click();
  const live = [...document.querySelectorAll('.card')].find((c) => c.dataset.id === 'a_1');
  live.querySelector('.card-edit').value = 'a fresh note';
  live.querySelector('.act-save').click();

  const [last] = api.calls.filter((c) => c.name === 'update').slice(-1);
  assert.deepEqual(last.args, ['a_1', { note: 'a fresh note' }]);
});
