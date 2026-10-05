// One card when a newer pdfpin exists. npm tells nobody who already installed, so without this a
// reader stays on the version they first downloaded and never learns a fix was written. It lives
// here, in the window a person looks at, and nowhere in the CLI: an agent reading our output should
// never have to step over a line about versions.
import { api } from './api.js';
import { t } from './i18n.js';

const SEEN = 'pdfpin.update.dismissed'; // per browser, per version: dismissing 0.4.0 says nothing about 0.5.0

const seen = (version) => {
  try { return localStorage.getItem(SEEN) === version; } catch { return false; }
};
const remember = (version) => {
  try { localStorage.setItem(SEEN, version); } catch { /* a private window just asks again */ }
};

const COMMAND = 'npm install -g @taeng0204/pdfpin';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The daemon stops itself and a fresh one takes the port, so for a second or two nothing answers.
 * Wait for a version that is not the one we started on, then let the page come back new.
 */
async function waitForTheNewOne(was, { tries = 90, every = 800 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    await sleep(every);
    try {
      const h = await api('GET', '/api/health');
      if (h?.version && h.version !== was) return true;
    } catch { /* it is still on its way up */ }
  }
  return false;
}

export async function initUpdateNotice() {
  const el = document.getElementById('update-notice');
  if (!el) return;
  let state;
  // Offline, or a daemon too old to answer: either way there is nothing to say.
  try { state = await api('GET', '/api/update'); } catch { return; }
  if (!state?.newer || seen(state.latest)) return;

  const linked = state.kind === 'linked';
  el.innerHTML = `
    <span class="update-mark" aria-hidden="true">✨</span>
    <div class="update-body">
      <p class="update-title"></p>
      <p class="update-sub"></p>
      <code class="update-cmd" hidden></code>
    </div>
    <button class="update-go btn primary" type="button" hidden></button>
    <button class="update-close" type="button" aria-label="">×</button>`;

  const title = el.querySelector('.update-title');
  const sub = el.querySelector('.update-sub');
  const cmd = el.querySelector('.update-cmd');
  const go = el.querySelector('.update-go');
  const close = el.querySelector('.update-close');

  title.textContent = t('update.title', { version: state.latest });
  sub.textContent = t('update.youHave', { version: state.current });
  close.title = t('update.dismiss');
  close.setAttribute('aria-label', t('update.dismiss'));
  close.onclick = () => { remember(state.latest); el.hidden = true; };

  if (linked) {
    // A checkout wearing the global name. Replacing it would quietly detach them from their tree.
    el.classList.add('linked');
    sub.textContent = t('update.linked');
  } else {
    go.hidden = false;
    go.textContent = t('update.button');
    go.onclick = async () => {
      go.disabled = true;
      el.classList.add('working');
      sub.textContent = t('update.working');
      let r;
      try { r = await api('POST', '/api/update'); } catch (e) { r = { ok: false, error: e.message }; }
      el.classList.remove('working');
      if (!r?.ok) {
        el.classList.add('failed');
        go.hidden = true;
        title.textContent = t('update.failed');
        sub.textContent = r?.error || '';
        cmd.textContent = COMMAND;
        cmd.hidden = false;
        return;
      }
      go.hidden = true;
      el.classList.add('done');
      title.textContent = t('update.doneTitle', { version: r.version });
      sub.textContent = t('update.done');
      if (await waitForTheNewOne(state.current)) location.reload();
      else sub.textContent = t('update.reopen');
    };
  }
  el.hidden = false;
}
