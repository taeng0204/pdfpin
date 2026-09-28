// Archived sessions: bring one back, or delete it and its highlights for good.
import { state, archivedSessions } from './state.js';
import { t } from './i18n.js';
import { icons } from './icons.js';
import { confirmDialog } from './dialog.js';
import { toast } from './toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function openArchive(docApi) {
  const existing = document.querySelector('.archive-root');
  if (existing) { existing.querySelector('.set-close').click(); return; }
  const root = document.createElement('div');
  root.className = 'dialog-root archive-root';
  root.innerHTML = `
    <div class="dialog-backdrop"></div>
    <div class="dialog settings" role="dialog" aria-modal="true">
      <div class="settings-head"><h2 class="dialog-title"></h2><button class="icon-btn set-close"></button></div>
      <div class="settings-body"><p class="set-hint"></p><div class="arch-rows"></div></div>
      <div class="settings-foot"><span></span><button class="btn primary set-done"></button></div>
    </div>`;
  root.querySelector('.set-close').innerHTML = icons.close;
  document.body.appendChild(root);
  const rows = root.querySelector('.arch-rows');

  const close = () => { root.classList.add('out'); setTimeout(() => root.remove(), 140); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  root.querySelector('.set-close').onclick = close;
  root.querySelector('.set-done').onclick = close;
  root.querySelector('.dialog-backdrop').onclick = close;

  function render() {
    root.querySelector('.dialog-title').textContent = t('archive.title');
    root.querySelector('.set-hint').textContent = t('archive.hint');
    root.querySelector('.set-done').textContent = t('common.done');
    const list = archivedSessions();
    rows.replaceChildren();
    if (!list.length) { rows.innerHTML = `<div class="hist-empty">${t('archive.empty')}</div>`; return; }
    for (const s of list) rows.appendChild(row(s));
  }

  function row(s) {
    const n = [...state.annotations.values()].filter((a) => a.sessionId === s.id).length;
    const el = document.createElement('div');
    el.className = 'arch-row';
    el.innerHTML = `
      <span class="mini-dot hl-color-${s.color}"></span>
      <div class="arch-main">
        <div class="arch-title"></div>
        <div class="arch-meta">${t('archive.count', { n })} · ${t('archive.when', { when: new Date(s.archivedAt || s.createdAt).toLocaleDateString() })}</div>
      </div>
      <button class="icon-btn act-restore" title="${t('archive.restore')}">${icons.restore}</button>
      <button class="icon-btn act-del" title="${t('archive.delete')}">${icons.trash}</button>`;
    el.querySelector('.arch-title').textContent = s.title || t('session.untitled');

    el.querySelector('.act-restore').onclick = async () => {
      try { await docApi.archiveSession(s.id, false); toast(t('archive.restored', { title: s.title || t('session.untitled') }), { duration: 2200 }); render(); }
      catch (err) { toast(err.message, { error: true }); }
    };
    el.querySelector('.act-del').onclick = async () => {
      const ok = await confirmDialog({
        title: t('session.deleteTitle'),
        body: `<p><strong>${esc(s.title || t('session.untitled'))}</strong></p><p>${n ? t('session.deleteBodyWith', { n }) : t('session.deleteBodyEmpty')}</p>`,
        confirmText: n ? t('session.deleteConfirm', { n }) : t('session.deleteConfirmEmpty'),
        cancelText: t('common.cancel'),
        danger: true,
      });
      if (!ok) return;
      try { await docApi.removeSession(s.id); toast(t('session.deleted', { title: s.title || t('session.untitled') }), { duration: 2200 }); render(); }
      catch (err) { toast(err.message, { error: true }); }
    };
    return el;
  }

  render();
  return { render };
}
