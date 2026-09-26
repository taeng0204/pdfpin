// Open the viewer URL: Chromium-based browser in app mode when available, else the default browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function candidates() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Chromium.app/Contents/MacOS/Chromium', 'Brave Browser.app/Contents/MacOS/Brave Browser'];
    return apps.flatMap((a) => [path.join('/Applications', a), path.join(home, 'Applications', a)]);
  }
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LocalAppData].filter(Boolean);
    const rel = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'Chromium\\Application\\chrome.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'];
    return roots.flatMap((r) => rel.map((x) => path.join(r, x)));
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'];
}

export function findChromium() {
  if (process.env.PDFPIN_CHROME && fs.existsSync(process.env.PDFPIN_CHROME)) return process.env.PDFPIN_CHROME;
  return candidates().find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

function detach(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
  child.on('error', () => { /* reported by caller through the fallback path */ });
  child.unref();
  return child;
}

export function openDefaultBrowser(url) {
  if (process.platform === 'darwin') return detach('open', [url]);
  if (process.platform === 'win32') return detach('cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]);
  return detach('xdg-open', [url]);
}

/**
 * mode: 'app' (chromeless window, default when a Chromium browser exists) | 'browser' (default browser).
 * Returns a short description of what was launched.
 */
export function openViewer(url, { mode = process.env.PDFPIN_BROWSER || 'app', home } = {}) {
  const chrome = mode === 'app' ? findChromium() : null;
  if (chrome) {
    const profile = path.join(home, 'browser-profile');
    fs.mkdirSync(profile, { recursive: true });
    detach(chrome, [`--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1480,980', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-features=TranslateUI,MediaRouter']);
    return `app window (${path.basename(chrome)})`;
  }
  openDefaultBrowser(url);
  return 'default browser';
}
