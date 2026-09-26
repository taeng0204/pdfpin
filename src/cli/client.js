// HTTP client for the pdfpin daemon, including auto-start of the daemon process.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultHome, serverInfoPath, DEFAULT_PORT } from '../server/index.js';

const SERVER_ENTRY = fileURLToPath(new URL('../server/index.js', import.meta.url));

export class CliError extends Error {
  constructor(message, { exitCode = 1, extra = {} } = {}) {
    super(message);
    this.exitCode = exitCode;
    this.extra = extra;
  }
}

export function readServerInfo(home = defaultHome()) {
  try { return JSON.parse(fs.readFileSync(serverInfoPath(home), 'utf8')); } catch { return null; }
}

export async function healthy(port, timeoutMs = 800) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal });
    const j = await r.json();
    return j?.ok === true ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Returns server info, starting the daemon when it is not running. */
export async function ensureDaemon({ home = defaultHome(), port = Number(process.env.PDFPIN_PORT ?? DEFAULT_PORT), start = true } = {}) {
  const info = readServerInfo(home);
  if (info && (await healthy(info.port))) return info;
  if (!start) return null;
  fs.mkdirSync(home, { recursive: true });
  try { fs.unlinkSync(serverInfoPath(home)); } catch { /* no stale file */ }
  const child = spawn(process.execPath, [SERVER_ENTRY, '--home', home, '--port', String(port)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, PDFPIN_HOME: home },
  });
  child.unref();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await sleep(120);
    const fresh = readServerInfo(home);
    if (fresh && (await healthy(fresh.port))) return fresh; // ours, or a sibling that won the race
  }
  throw new CliError(`The pdfpin daemon did not start. See ${path.join(home, 'server.log')}`);
}

export async function stopDaemon(home = defaultHome()) {
  const info = readServerInfo(home);
  if (!info || !(await healthy(info.port))) {
    try { fs.unlinkSync(serverInfoPath(home)); } catch { /* ignore */ }
    return false;
  }
  try { await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, { method: 'POST' }); } catch { /* it may die mid-response */ }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    await sleep(100);
    if (!(await healthy(info.port, 300))) break;
  }
  if (await healthy(info.port, 300)) return false;
  try { fs.unlinkSync(serverInfoPath(home)); } catch { /* already removed by the daemon */ }
  return true;
}

export class Client {
  constructor(info) {
    this.base = `http://127.0.0.1:${info.port}`;
    this.info = info;
  }

  async call(method, url, body) {
    let res;
    try {
      res = await fetch(this.base + url, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new CliError(`Cannot reach the pdfpin daemon at ${this.base}: ${e.message}`);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      const { error, ...extra } = json;
      throw new CliError(error || `HTTP ${res.status}`, { exitCode: res.status === 422 ? 2 : 1, extra });
    }
    return json;
  }
}
