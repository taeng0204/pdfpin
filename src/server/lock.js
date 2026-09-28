// One daemon per data directory. Two would each cache documents and overwrite the other's writes.
//
// A pid alone is not enough to tell a live owner from a crashed one: after a crash the operating
// system may hand that number to an unrelated process, and the directory would stay locked for
// good. So the owner also keeps the lock file's timestamp fresh, and a lock that stopped being
// refreshed is treated as abandoned however healthy its pid looks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const HEARTBEAT_MS = 5_000;
export const STALE_AFTER_MS = 20_000;

const claimed = new Set(); // two Stores in one process would clobber each other just as badly

export function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** 'held' when someone is still using it, 'stale' when it was abandoned. */
export function lockState({ raw, mtimeMs, now = Date.now(), isAlive: alive = isAlive }) {
  let owner;
  try { owner = JSON.parse(raw); } catch { return 'stale'; }
  if (!owner || typeof owner.pid !== 'number') return 'stale';
  if (now - mtimeMs > STALE_AFTER_MS) return 'stale';
  return alive(owner.pid) ? 'held' : 'stale';
}

/** Claim `home` for this process. Returns a release function; throws when someone else holds it. */
export function lockHome(home, { heartbeatMs = HEARTBEAT_MS } = {}) {
  const key = path.resolve(home);
  if (claimed.has(key)) throw new Error(`This process already owns ${home}`);
  const file = path.join(home, 'daemon.lock');
  const mine = JSON.stringify({ pid: process.pid, token: crypto.randomBytes(8).toString('hex'), startedAt: new Date().toISOString() });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx' });
      claimed.add(key);
      const beat = setInterval(() => {
        try { fs.writeFileSync(file, mine); } catch { /* it will be noticed as stale */ }
      }, heartbeatMs);
      beat.unref?.();
      return () => {
        clearInterval(beat);
        claimed.delete(key);
        try { if (fs.readFileSync(file, 'utf8') === mine) fs.unlinkSync(file); } catch { /* already gone */ }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let raw;
      let mtimeMs;
      try { raw = fs.readFileSync(file, 'utf8'); mtimeMs = fs.statSync(file).mtimeMs; } catch { continue; }
      if (lockState({ raw, mtimeMs }) === 'held') {
        const pid = (() => { try { return JSON.parse(raw).pid; } catch { return '?'; } })();
        throw new Error(`Another pdfpin daemon (pid ${pid}) already owns ${home}`);
      }
      try { fs.unlinkSync(file); } catch { /* raced with its owner exiting */ }
    }
  }
  throw new Error(`Could not claim ${home}`);
}
