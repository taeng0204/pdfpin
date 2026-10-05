// "Is there a newer pdfpin?" — the one question this program asks the internet, and the only way a
// reader ever learns a fix exists: npm tells nobody who already installed. Nothing about your
// documents goes with it. The request carries the package name and nothing else, it is made at most
// once a day, and `updateCheck: false` or PDFPIN_NO_UPDATE_CHECK=1 stops it being made at all.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIST_TAGS = 'https://registry.npmjs.org/-/package';
const EVERY_MS = 24 * 60 * 60 * 1000;

const cacheFile = (home) => path.join(home, 'update.json');

/**
 * Semver as far as this needs it. A prerelease is never "newer": nobody should be nudged onto one
 * by a line in a sidebar, and `latest` is not supposed to point at one anyway.
 */
export function isNewer(latest, current) {
  if (typeof latest !== 'string' || typeof current !== 'string') return false;
  if (latest.includes('-')) return false;
  const parts = (v) => v.split('-')[0].split('.').map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0));
  const [a, b] = [parts(latest), parts(current)];
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

async function latestFromRegistry(name, fetchImpl, timeoutMs) {
  const res = await fetchImpl(`${DIST_TAGS}/${encodeURIComponent(name)}/dist-tags`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  const body = await res.json();
  return typeof body?.latest === 'string' ? body.latest : null;
}

export function readCache(home) {
  try { return JSON.parse(fs.readFileSync(cacheFile(home), 'utf8')); } catch { return null; }
}

/**
 * What the viewer asks for when it opens. Offline, blocked, or npm having a day all come back the
 * same way: the last answer we had, or no answer. Never a guess, and never a reason to fail.
 */
export async function updateState({ home, name, current, enabled, env = process.env, now = Date.now(), fetchImpl = fetch, timeoutMs = 3000 }) {
  const quiet = { current, latest: null, newer: false, checked: false };
  if (!enabled || env.PDFPIN_NO_UPDATE_CHECK) return quiet;

  const cached = readCache(home);
  const fromCache = () => (cached?.latest ? { current, latest: cached.latest, newer: isNewer(cached.latest, current), checked: true } : quiet);
  if (cached && now - (cached.at ?? 0) < EVERY_MS) return fromCache();

  let latest = null;
  try { latest = await latestFromRegistry(name, fetchImpl, timeoutMs); } catch { /* offline is not an error here */ }
  if (latest === null) return fromCache();

  try { fs.writeFileSync(cacheFile(home), `${JSON.stringify({ latest, at: now })}\n`); } catch { /* a cache we cannot write just means asking again tomorrow */ }
  return { current, latest, newer: isNewer(latest, current), checked: true };
}

export const packageRoot = () => fileURLToPath(new URL('../..', import.meta.url));

/**
 * Where this copy of pdfpin came from, because only one of them is ours to replace.
 *   'registry'  npm unpacked it into a global node_modules; `npm install -g` updates it in place
 *   'linked'    `npm install -g .` or `npm link` pointed the global name at a checkout. Replacing
 *               it would silently detach the person from the tree they are working in, so we do
 *               not: they update it with git, and the button says so.
 */
export function installKind(name, root = packageRoot()) {
  const tail = path.join('node_modules', ...name.split('/'));
  return path.resolve(root).endsWith(tail) ? 'registry' : 'linked';
}

const tail = (s, n = 400) => { const t = String(s).trim(); return t.length > n ? `…${t.slice(-n)}` : t; };

function run(cmd, args, { timeoutMs, spawnImpl }) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnImpl(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ ok: false, err: e.message }); }
    let out = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? { ok: true, out } : { ok: false, err: tail(out) || `npm exited with ${code}` }); });
  });
}

/**
 * The update button. Runs the same command the README gives, then hands the restart to the CLI,
 * which already knows how to notice that the daemon it is talking to is the old one and replace it.
 * The viewer's event stream reconnects on its own, so the window comes back without being told.
 */
export async function runUpdate({ name, latest, root = packageRoot(), spawnImpl = spawn, timeoutMs = 180000, restart = true }) {
  if (installKind(name, root) === 'linked') {
    return { ok: false, kind: 'linked', root, error: `This pdfpin is linked to ${root}. Update it there with git, not from here.` };
  }
  const r = await run('npm', ['install', '-g', `${name}@${latest}`], { timeoutMs, spawnImpl });
  if (!r.ok) return { ok: false, kind: 'failed', error: r.err };
  if (restart) {
    // Answer first, then go: this process is about to be stopped by the command it just started.
    setTimeout(() => {
      try {
        const child = spawnImpl(process.execPath, [path.join(root, 'bin', 'pdfpin.js'), 'open'], {
          detached: true, stdio: 'ignore', env: { ...process.env, PDFPIN_NO_LAUNCH: '1' },
        });
        child.unref?.();
      } catch { /* the next command anyone runs will replace us anyway */ }
    }, 400).unref?.();
  }
  return { ok: true, version: latest };
}
