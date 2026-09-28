// Tag manager: rename, recolour or drop a tag across the whole document.
import { state, emit } from './state.js';
import { t } from './i18n.js';
import { icons } from './icons.js';
import { confirmDialog, pickColor } from './dialog.js';
import { toast } from './toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function openTags(docApi) {
  const existing = document.querySelector('.tags-root');
  if (existing) { existing.querySelector('.set-close').click(); return; }
  const root = document.createElement('div');
  root.className = 'dialog-root tags-root';
  root.innerHTML = `
    <div class="dialog-backdrop"></div>
    <div class="dialog settings" role="dialog" aria-modal="true">
      <div class="settings-head"><h2 class="dialog-title"></h2><button class="icon-btn set-close"></button></div>
      <div class="settings-body"><p class="set-hint"></p><div class="tag-rows"></div></div>
      <div class="settings-foot"><span></span><button class="btn primary set-done"></button></div>
    </div>`;
  root.querySelector('.set-close').innerHTML = icons.close;
  document.body.appendChild(root);
  const rows = root.querySelector('.tag-rows');

  const close = () => { root.classList.add('out'); setTimeout(() => root.remove(), 140); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (e.target.closest?.('.tag-name')) { e.target.value = e.target.dataset.tag; e.target.blur(); return; }
    e.preventDefault(); e.stopPropagation(); close();
  };
  document.addEventListener('keydown', onKey, true);
  root.querySelector('.set-close').onclick = close;
  root.querySelector('.set-done').onclick = close;
  root.querySelector('.dialog-backdrop').onclick = close;

  async function refresh() {
    root.querySelector('.dialog-title').textContent = t('tags.title');
    root.querySelector('.set-hint').textContent = t('tags.hint');
    root.querySelector('.set-done').textContent = t('common.done');
    let tags = [];
    try { tags = (await docApi.tags()).tags; } catch (e) { toast(e.message, { error: true }); }
    rows.replaceChildren();
    if (!tags.length) { rows.innerHTML = `<div class="hist-empty">${t('tags.empty')}</div>`; return; }
    for (const row of tags) rows.appendChild(tagRow(row));
  }

  function tagRow(row) {
    const el = document.createElement('div');
    el.className = 'tag-row';
    el.innerHTML = `
      <button class="color-dot hl-color-${row.color}" title="${t('color.change')}"></button>
      <input class="tag-name" value="${esc(row.tag)}" data-tag="${esc(row.tag)}" spellcheck="false">
      <span class="tag-count">${t('tags.count', { n: row.count })}${row.pinned ? ` · ${t('tags.pinned', { n: row.pinned })}` : ''}</span>
      <button class="icon-btn act-del" title="${t('tags.remove')}">${icons.trash}</button>`;

    el.querySelector('.color-dot').onclick = async (e) => {
      const picked = await pickColor(e.currentTarget, row.override);
      if (picked === undefined) return;
      try { await docApi.updateTag(row.tag, { color: picked }); await refresh(); }
      catch (err) { toast(err.message, { error: true }); }
    };

    const input = el.querySelector('.tag-name');
    const commit = async () => {
      const name = input.value.trim();
      if (!name || name === row.tag) { input.value = row.tag; return; }
      try {
        await docApi.updateTag(row.tag, { name });
        toast(t('tags.renamed', { tag: name }), { duration: 2200 });
        await refresh();
      } catch (err) { toast(err.message, { error: true }); input.value = row.tag; }
    };
    input.onblur = commit;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } };

    el.querySelector('.act-del').onclick = async () => {
      const ok = await confirmDialog({
        title: t('tags.removeTitle'),
        body: `<p>${t('tags.removeBody', { tag: esc(row.tag), n: row.count })}</p>`,
        confirmText: t('tags.remove'),
        cancelText: t('common.cancel'),
        danger: true,
      });
      if (!ok) return;
      try { await docApi.removeTag(row.tag); toast(t('tags.removed', { tag: row.tag }), { duration: 2200 }); await refresh(); }
      catch (err) { toast(err.message, { error: true }); }
    };
    return el;
  }

  refresh();
}

/** Keep the shared <datalist> in step with the document, so every tag field can suggest them. */
export function refreshTagOptions() {
  const list = document.getElementById('tag-options');
  if (!list) return;
  const tags = [...new Set([...state.annotations.values()].map((a) => a.tag).filter(Boolean))].sort();
  list.replaceChildren(...tags.map((tag) => { const o = document.createElement('option'); o.value = tag; return o; }));
  emit('tags');
}

export const knownTags = () => [...new Set([...state.annotations.values()].map((a) => a.tag).filter(Boolean))].sort();
