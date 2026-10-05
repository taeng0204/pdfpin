// One quiet line when a newer pdfpin exists. npm tells nobody who already installed, so without
// this a reader stays on the version they first downloaded and never learns a fix was written.
// It lives here, in the window a person looks at, and nowhere in the CLI: an agent reading our
// output should never have to step over a line about versions.
import { api } from './api.js';
import { t } from './i18n.js';

const SEEN = 'pdfpin.update.dismissed'; // per browser, per version: dismissing 0.4.0 says nothing about 0.5.0

const seen = (version) => {
  try { return localStorage.getItem(SEEN) === version; } catch { return false; }
};
const remember = (version) => {
  try { localStorage.setItem(SEEN, version); } catch { /* a private window just asks again */ }
};

export async function initUpdateNotice() {
  const el = document.getElementById('update-notice');
  if (!el) return;
  let state;
  // Offline, or a daemon too old to answer: either way there is nothing to say.
  try { state = await api('GET', '/api/update'); } catch { return; }
  if (!state?.newer || seen(state.latest)) return;

  el.innerHTML = `<span class="update-text"></span>`
    + `<code class="update-cmd"></code>`
    + `<button class="update-close" type="button"></button>`;
  el.querySelector('.update-text').textContent = t('update.available', { version: state.latest });
  el.querySelector('.update-cmd').textContent = 'npm install -g @taeng0204/pdfpin';
  const close = el.querySelector('.update-close');
  close.textContent = '×';
  close.title = t('update.dismiss');
  close.setAttribute('aria-label', t('update.dismiss'));
  close.onclick = () => { remember(state.latest); el.hidden = true; };
  el.hidden = false;
}
