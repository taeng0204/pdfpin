// The guided tour. It drives the real API, so what you watch is exactly what an agent does.
import { api } from './api.js';
import { state, on, emit } from './state.js';
import { t } from './i18n.js';
import { icons } from './icons.js';
import { formatBinding } from './shortcuts.js';

const CANCELLED = Symbol('tour cancelled');
const TOTAL = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const tourWanted = () => new URLSearchParams(location.search).get('tour') === '1';

/** Build the demo document and land on it with the tour flag set. */
export async function startTour() {
  const { doc } = await api('POST', '/api/demo');
  location.href = `/view/${doc.id}?tour=1`;
}

export function runTour({ docApi, viewer, highlights }) {
  let cancelled = false;
  const offs = [];
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour-ring" hidden></div>
    <div class="tour-bar">
      <span class="tour-step"></span>
      <span class="tour-text"></span>
      <span class="tour-actions"><button class="tour-btn tour-skip-step" hidden></button><button class="tour-btn tour-skip"></button></span>
    </div>`;
  document.body.appendChild(root);
  const ring = root.querySelector('.tour-ring');
  const bar = root.querySelector('.tour-bar');
  const stepEl = root.querySelector('.tour-step');
  const textEl = root.querySelector('.tour-text');
  const skipStepBtn = root.querySelector('.tour-skip-step');
  const goBtn = document.createElement('button');
  goBtn.className = 'tour-btn go';
  goBtn.hidden = true;
  root.querySelector('.tour-actions').prepend(goBtn);
  root.querySelector('.tour-skip').textContent = t('tour.skip');
  root.querySelector('.tour-skip').onclick = () => finish();
  skipStepBtn.textContent = t('tour.skipStep');

  const guard = () => { if (cancelled) throw CANCELLED; };

  /** Show a button and wait for it. Watching steps advance when the reader is ready, not on a clock. */
  function press(label) {
    guard();
    goBtn.textContent = label;
    goBtn.hidden = false;
    return new Promise((resolve) => {
      const done = () => { goBtn.hidden = true; goBtn.onclick = null; document.removeEventListener('keydown', onKey); resolve(); };
      const onKey = (e) => { if (e.key === 'Enter' && !e.target.closest?.('input, textarea')) { e.preventDefault(); done(); } };
      goBtn.onclick = done;
      document.addEventListener('keydown', onKey);
      goBtn.focus();
    });
  }
  const say = (text, act) => { guard(); textEl.textContent = text; stepEl.textContent = t('tour.step', { n: act, total: TOTAL }); };

  function point(el) {
    if (!el) { ring.hidden = true; return; }
    const r = el.getBoundingClientRect();
    if (!r.width) { ring.hidden = true; return; }
    Object.assign(ring.style, { top: `${r.top - 6}px`, left: `${r.left - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    ring.hidden = false;
  }
  const unpoint = () => { ring.hidden = true; };

  /** Wait for something the reader does. Resolves early when they skip the step. */
  function until(subscribe) {
    guard();
    skipStepBtn.hidden = false;
    return new Promise((resolve) => {
      let done = false;
      const finishOnce = () => { if (done) return; done = true; skipStepBtn.hidden = true; skipStepBtn.onclick = null; off?.(); clearTimeout(nudge); resolve(); };
      const off = subscribe(finishOnce);
      skipStepBtn.onclick = finishOnce;
      const nudge = setTimeout(() => { if (!done) textEl.textContent = `${textEl.textContent}  ${t('tour.nudge')}`; }, 9000);
    });
  }

  // --- act one: the agent works, the reader watches -------------------------------------------
  async function act1(quotes) {
    say(t('tour.a1ready', { q: t('tour.q1') }), 1);
    await press(t('tour.ask'));

    say(t('tour.a1marking'), 1);
    bar.classList.add('asking');
    const s1 = (await docApi.addSession({ title: t('tour.q1'), flow: t('tour.q1flow') })).session;
    const marks = [
      { text: quotes[0], note: t('tour.q1n1'), tag: 'method' },
      { text: quotes[1], note: t('tour.q1n2'), tag: 'matching' },
      { text: quotes[2], note: t('tour.q1n3'), tag: 'limit' },
    ];
    for (const m of marks) {
      guard();
      const { annotation } = await docApi.add({ ...m, sessionId: s1.id });
      await sleep(200);
      const rects = await highlights.rectsFor(state.annotations.get(annotation.id) ?? annotation);
      viewer.scrollToRect(annotation.page, rects[0] || null);
      await sleep(700);
    }
    bar.classList.remove('asking');

    say(t('tour.a1done'), 1);
    await press(t('tour.next'));

    say(t('tour.a1second'), 1);
    await press(t('tour.askAgain'));
    const s2 = (await docApi.addSession({ title: t('tour.q2'), flow: t('tour.q2flow') })).session;
    await docApi.add({ text: quotes[3], note: t('tour.q2n1'), tag: 'privacy', sessionId: s2.id });
    await sleep(900);
    await press(t('tour.next'));
  }

  // --- act two: the two directions of the link ------------------------------------------------
  async function act2() {
    say(t('tour.a2card'), 2);
    const card = document.querySelector('.cards .card');
    point(card);
    await until((done) => on('select', ({ from }) => { if (from === 'panel') done(); }));
    unpoint();
    await sleep(400);

    guard();
    say(t('tour.a2hl'), 2);
    const rect = document.querySelector('.hl .hl-rect');
    point(rect);
    await until((done) => {
      const handler = (e) => { if (e.target.closest?.('.hl-rect')) done(); };
      document.addEventListener('click', handler, true);
      return () => document.removeEventListener('click', handler, true);
    });
    unpoint();
    highlights.hidePopover();   // leave the page clear for the next act
    await sleep(600);
  }

  // --- act three: the reader marks something themselves ----------------------------------------
  async function act3() {
    say(t('tour.a3select'), 3);
    point(document.querySelector('.page'));
    // the selection toolbar appears a tick after mouseup, so watch for it rather than for the event
    await until((done) => {
      const id = setInterval(() => { if (!document.getElementById('sel-toolbar').hidden) done(); }, 120);
      return () => clearInterval(id);
    });
    unpoint();
    guard();

    say(t('tour.a3tag'), 3);
    point(document.querySelector('.sel-tags'));
    await until((done) => on('annotation:upsert', (a) => { if (a.source === 'user') done(); }));
    unpoint();
    await sleep(500);
  }

  // --- the map ---------------------------------------------------------------------------------
  async function epilogue() {
    guard();
    const key = (action) => formatBinding(state.settings?.keys?.[action]);
    bar.classList.add('final');
    bar.innerHTML = `
      <div class="tour-final">
        <h2></h2><p class="tour-done-body"></p>
        <ul><li class="m1"></li><li class="m2"></li><li class="m3"></li></ul>
        <p class="tour-keep"></p>
        <div class="tour-final-actions"><button class="btn tour-close"></button><button class="btn primary tour-open"></button></div>
      </div>`;
    bar.querySelector('h2').textContent = t('tour.doneTitle');
    bar.querySelector('.tour-done-body').textContent = t('tour.doneBody');
    bar.querySelector('.m1').textContent = t('tour.mapDocs', { key: key('documents') });
    bar.querySelector('.m2').textContent = t('tour.mapHistory', { key: key('history') });
    bar.querySelector('.m3').textContent = t('tour.mapSettings', { key: key('settings') });
    bar.querySelector('.tour-keep').textContent = t('tour.keepDemo');
    bar.querySelector('.tour-close').textContent = t('common.done');
    bar.querySelector('.tour-open').textContent = t('tour.openReal');
    await new Promise((resolve) => {
      bar.querySelector('.tour-close').onclick = resolve;
      bar.querySelector('.tour-open').onclick = () => { resolve(); emit('tour:open-real'); };
    });
  }

  function finish() {
    cancelled = true;
    cleanup();
  }
  function cleanup() {
    for (const off of offs) off?.();
    root.remove();
    history.replaceState(null, '', location.pathname);
    api('PATCH', '/api/settings', { onboarded: true }).catch(() => {});
  }

  (async () => {
    try {
      const quotes = (await api('POST', '/api/demo')).quotes;
      await act1(quotes);
      await act2();
      await act3();
      await epilogue();
    } catch (e) {
      if (e !== CANCELLED) console.error('tour', e);
    } finally {
      if (!cancelled) cleanup();
    }
  })();

  return { finish };
}
