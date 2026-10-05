// "Is there a newer pdfpin?" — the one question this program asks the internet, and the only way a
// reader ever learns a fix exists: npm tells nobody who already installed. Nothing about your
// documents goes with it. The request carries the package name and nothing else, it is made at most
// once a day, and `updateCheck: false` or PDFPIN_NO_UPDATE_CHECK=1 stops it being made at all.
import fs from 'node:fs';
import path from 'node:path';

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
