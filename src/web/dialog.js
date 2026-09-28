// Minimal confirm dialog: returns a Promise<boolean>. Enter confirms, Esc cancels, focus stays inside.
import { t } from './i18n.js';
import { COLORS } from './state.js';

/**
 * A small palette anchored to `anchor`. Resolves to a colour name, null for "back to automatic",
 * or undefined when dismissed.
 */
export function pickColor(anchor, current) {
  return new Promise((resolve) => {
    document.querySelector('.color-pick')?.remove();
    const el = document.createElement('div');
    el.className = 'popover color-pick';
    el.innerHTML = `<div class="swatches">${COLORS.map((c) => `<button class="color-dot hl-color-${c}${c === current ? ' on' : ''}" data-color="${c}" title="${c}"></button>`).join('')}</div><button class="pick-auto"></button>`;
    el.querySelector('.pick-auto').textContent = t('color.auto');
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.top = `${Math.min(r.bottom + 6, window.innerHeight - el.offsetHeight - 8)}px`;
    el.style.left = `${Math.max(8, Math.min(r.left - 8, window.innerWidth - el.offsetWidth - 8))}px`;
    const done = (v) => { el.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true); resolve(v); };
    const away = (e) => { if (!el.contains(e.target)) done(undefined); };
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(undefined); } };
    setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc, true); }, 0);
    el.addEventListener('click', (e) => {
      const dot = e.target.closest('.color-dot');
      if (dot) return done(dot.dataset.color);
      if (e.target.closest('.pick-auto')) return done(null);
    });
  });
}

export function confirmDialog({ title, body = '', confirmText, cancelText, danger = false }) {
  confirmText ??= t('common.ok');
  cancelText ??= t('common.cancel');
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'dialog-root';
    root.innerHTML = `
      <div class="dialog-backdrop"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title" class="dialog-title"></h2>
        <div class="dialog-body"></div>
        <div class="dialog-actions">
          <button class="btn dlg-cancel"></button>
          <button class="btn primary dlg-confirm"></button>
        </div>
      </div>`;
    root.querySelector('.dialog-title').textContent = title;
    root.querySelector('.dialog-body').innerHTML = body;
    const cancel = root.querySelector('.dlg-cancel');
    const ok = root.querySelector('.dlg-confirm');
    cancel.textContent = cancelText;
    ok.textContent = confirmText;
    if (danger) ok.classList.add('danger');
    const previous = document.activeElement;
    const done = (v) => { root.classList.add('out'); setTimeout(() => root.remove(), 140); document.removeEventListener('keydown', onKey, true); previous?.focus?.(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === ok ? cancel : ok).focus(); }
      else e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    root.querySelector('.dialog-backdrop').onclick = () => done(false);
    document.body.appendChild(root);
    (danger ? cancel : ok).focus();
  });
}
