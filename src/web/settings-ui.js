// The settings sheet (⌘, by default). Changes save as you make them.
import { api } from './api.js';
import { state, emit, on, COLORS } from './state.js';
import { t, LANGUAGE_NAMES } from './i18n.js';
import { icons } from './icons.js';
import { eventBinding, formatBinding, isReserved, IS_MAC } from './shortcuts.js';
import { toast } from './toast.js';

const ACTIONS = ['documents', 'history', 'settings', 'search', 'nextPage', 'prevPage', 'nextHighlight', 'prevHighlight', 'zoomIn', 'zoomOut', 'zoomReset', 'theme', 'toggleHighlights'];

export function openSettings() {
  const existing = document.querySelector('.settings-root');
  if (existing) { existing.querySelector('.set-close').click(); return; } // same button opens and closes
  const root = document.createElement('div');
  root.className = 'dialog-root settings-root';
  root.innerHTML = `
    <div class="dialog-backdrop"></div>
    <div class="dialog settings" role="dialog" aria-modal="true" aria-label="${t('settings.title')}">
      <div class="settings-head">
        <h2 class="dialog-title"></h2>
        <button class="icon-btn set-close"></button>
      </div>
      <div class="settings-body"></div>
      <div class="settings-foot">
        <button class="btn set-reset"></button>
        <button class="btn primary set-done"></button>
      </div>
    </div>`;
  root.querySelector('.set-close').innerHTML = icons.close;
  document.body.appendChild(root);

  const body = root.querySelector('.settings-body');
  let capturing = null; // the action currently listening for a new binding

  // The sheet's own labels follow the language too, so redraw whenever the shell restrings itself.
  const offStrings = on('strings', () => render());
  const close = () => { stopCapture(); offStrings(); root.classList.add('out'); setTimeout(() => root.remove(), 140); document.removeEventListener('keydown', onKey, true); };
  root.querySelector('.set-close').onclick = close;
  root.querySelector('.set-done').onclick = close;
  root.querySelector('.dialog-backdrop').onclick = close;

  async function save(patch) {
    try {
      const r = await api('PATCH', '/api/settings', patch);
      state.settings = r.settings;
      emit('settings');   // the shell restrings itself, which redraws this sheet through 'strings'
      render();
    } catch (e) {
      toast(t('settings.saveFailed', { message: e.message }), { error: true });
      render();
    }
  }
  root.querySelector('.set-reset').onclick = async () => {
    try {
      const r = await api('DELETE', '/api/settings');
      state.settings = r.settings;
      emit('settings');
      render();
    } catch (e) { toast(t('settings.saveFailed', { message: e.message }), { error: true }); }
  };

  function stopCapture() {
    capturing = null;
    for (const b of body.querySelectorAll('.key-btn')) b.classList.remove('capturing');
  }

  function onKey(e) {
    if (capturing) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { stopCapture(); render(); return; }
      const binding = eventBinding(e);
      if (!binding) return;
      const action = capturing;
      stopCapture();
      save({ keys: { [action]: binding } });
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }
  document.addEventListener('keydown', onKey, true);

  function section(title, hint) {
    const el = document.createElement('section');
    el.className = 'set-section';
    el.innerHTML = `<h3></h3>${hint ? '<p class="set-hint"></p>' : ''}<div class="set-rows"></div>`;
    el.querySelector('h3').textContent = title;
    if (hint) el.querySelector('.set-hint').textContent = hint;
    return el;
  }
  function row(label, control) {
    const el = document.createElement('div');
    el.className = 'set-row';
    const l = document.createElement('span');
    l.className = 'set-label';
    l.textContent = label;
    el.append(l, control);
    return el;
  }
  function select(value, options, onChange) {
    const el = document.createElement('select');
    el.className = 'set-select';
    for (const [v, label] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      el.appendChild(o);
    }
    el.value = value;
    el.onchange = () => onChange(el.value);
    return el;
  }
  function checkbox(checked, onChange) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.className = 'set-check';
    el.checked = checked;
    el.onchange = () => onChange(el.checked);
    return el;
  }

  function render() {
    const s = state.settings;
    if (!s) return;
    root.querySelector('.dialog-title').textContent = t('settings.title');
    root.querySelector('.set-reset').textContent = t('common.reset');
    root.querySelector('.set-done').textContent = t('common.done');
    root.querySelector('.dialog').setAttribute('aria-label', t('settings.title'));
    body.replaceChildren();

    const look = section(t('settings.appearance'));
    const rows = look.querySelector('.set-rows');
    rows.append(
      row(t('settings.language'), select(s.language, [['auto', t('settings.languageAuto')], ['en', LANGUAGE_NAMES.en], ['ko', LANGUAGE_NAMES.ko]], (v) => save({ language: v }))),
      row(t('settings.theme'), select(s.theme, [['system', t('settings.themeSystem')], ['light', t('settings.themeLight')], ['dark', t('settings.themeDark')]], (v) => save({ theme: v }))),
      row(t('settings.dimPages'), checkbox(s.dimPages, (v) => save({ dimPages: v }))),
      row(t('settings.zoom'), select(String(s.zoom), [['fit-width', t('settings.zoomFitWidth')], ['fit-page', t('settings.zoomFitPage')]], (v) => save({ zoom: v }))),
    );
    body.appendChild(look);

    const pal = section(t('settings.palette'), t('settings.paletteHint'));
    const grid = document.createElement('div');
    grid.className = 'set-palette';
    for (const c of COLORS) {
      const on = s.palette.includes(c);
      const b = document.createElement('button');
      b.className = `color-dot hl-color-${c}${on ? ' on' : ''}`;
      b.title = c;
      b.setAttribute('aria-pressed', on);
      b.onclick = () => {
        const next = on ? s.palette.filter((x) => x !== c) : COLORS.filter((x) => x === c || s.palette.includes(x));
        if (!next.length) { toast(t('settings.paletteEmpty')); return; }
        save({ palette: next });
      };
      grid.appendChild(b);
    }
    pal.querySelector('.set-rows').appendChild(grid);
    body.appendChild(pal);

    const keys = section(t('settings.shortcuts'), t('settings.shortcutsHint'));
    const krows = keys.querySelector('.set-rows');
    for (const action of ACTIONS) {
      const binding = s.keys[action];
      const b = document.createElement('button');
      b.className = 'key-btn';
      b.textContent = formatBinding(binding);
      b.onclick = () => { stopCapture(); capturing = action; b.classList.add('capturing'); b.textContent = t('settings.press'); };
      const r = row(t(`action.${action}`), b);
      if (isReserved(binding)) {
        const warn = document.createElement('p');
        warn.className = 'set-warn';
        warn.textContent = t('settings.reservedWarning', { key: formatBinding(binding) });
        r.appendChild(warn);
        r.classList.add('has-warn');
      }
      krows.appendChild(r);
    }
    body.appendChild(keys);
  }

  render();
  root.querySelector('.set-done').focus();
}
