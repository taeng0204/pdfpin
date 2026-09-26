import { icons } from './icons.js';
const host = () => document.getElementById('toasts');

export function toast(message, { color, action, onAction, duration = 5000, error = false } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  if (color) el.classList.add(`hl-color-${color}`);
  el.innerHTML = `<span class="dot"></span><span class="msg"></span>`;
  el.querySelector('.msg').textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.className = 'tb-btn';
    b.textContent = action;
    b.onclick = () => { onAction?.(); dismiss(); };
    el.appendChild(b);
  }
  const x = document.createElement('button');
  x.className = 'tb-btn';
  x.innerHTML = icons.close;
  x.style.padding = '2px 4px';
  x.querySelector('svg').style.cssText = 'width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2';
  x.onclick = dismiss;
  el.appendChild(x);
  host().appendChild(el);
  const t = setTimeout(dismiss, duration);
  function dismiss() { clearTimeout(t); el.classList.add('out'); setTimeout(() => el.remove(), 200); }
  return dismiss;
}
