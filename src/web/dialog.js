// Minimal confirm dialog: returns a Promise<boolean>. Enter confirms, Esc cancels, focus stays inside.
export function confirmDialog({ title, body = '', confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
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
