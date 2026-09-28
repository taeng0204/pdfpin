// Installing the agent skill. Claude Code and Codex read the same SKILL.md format from
// <agent home>/skills/<name>/, and both discover it without any config change, so one file
// shipped with the package serves both. Copies rather than symlinks: Windows needs a privilege
// for those, and a copy survives the package being reinstalled somewhere else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SKILL_NAME = 'pdfpin';
const MARKER = '.pdfpin-install.json'; // what we last wrote, so an edit of yours is recognisable

export const AGENTS = [
  { id: 'claude', label: 'Claude Code', dir: '.claude' },
  { id: 'codex', label: 'Codex', dir: '.codex' },
];

/** The skill directory shipped inside this package. */
export function sourceDir() {
  return fileURLToPath(new URL('../../skill/', import.meta.url));
}

export function targets(home = os.homedir()) {
  return AGENTS.map((a) => ({
    id: a.id,
    label: a.label,
    agentHome: path.join(home, a.dir),
    dest: path.join(home, a.dir, 'skills', SKILL_NAME),
  }));
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

function sourceFiles() {
  const dir = sourceDir();
  return fs.readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => ({ name, body: fs.readFileSync(path.join(dir, name)) }));
}

function readMarker(dest) {
  try { return JSON.parse(fs.readFileSync(path.join(dest, MARKER), 'utf8')); } catch { return null; }
}

function digestAt(dest, name) {
  try { return sha(fs.readFileSync(path.join(dest, name))); } catch { return null; }
}

/**
 * One row per agent.
 *   present  the agent is installed on this machine (its home directory exists)
 *   state    'absent'   nothing there
 *            'current'  the shipped skill, unchanged
 *            'outdated' ours, but from an older pdfpin
 *            'modified' pdfpin did not write it: edited here, or copied in by hand
 */
export function status(home = os.homedir()) {
  const files = sourceFiles();
  return targets(home).map((t) => {
    const present = fs.existsSync(t.agentHome);
    if (!fs.existsSync(path.join(t.dest, 'SKILL.md'))) return { ...t, present, state: 'absent' };
    const current = files.every((f) => digestAt(t.dest, f.name) === sha(f.body));
    if (current) return { ...t, present, state: 'current' };
    const marker = readMarker(t.dest);
    const ours = marker?.files && Object.entries(marker.files).every(([n, d]) => digestAt(t.dest, n) === d);
    return { ...t, present, state: ours ? 'outdated' : 'modified' };
  });
}

function writeMarker(dest, files) {
  const marker = { name: SKILL_NAME, files: Object.fromEntries(files.map((f) => [f.name, sha(f.body)])) };
  fs.writeFileSync(path.join(dest, MARKER), `${JSON.stringify(marker, null, 2)}\n`);
}

/** Write the skill into one target. Returns 'installed' | 'updated' | 'current' | 'modified'. */
export function install(target, { force = false } = {}) {
  const before = target.state;
  const files = sourceFiles();
  if (before === 'current' && !force) {
    // a copy someone made by hand holds exactly what we ship, so adopt it and it can be updated later
    if (!readMarker(target.dest)) writeMarker(target.dest, files);
    return 'current';
  }
  if (before === 'modified' && !force) return 'modified';
  fs.mkdirSync(target.dest, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(target.dest, f.name), f.body);
  writeMarker(target.dest, files);
  return before === 'absent' ? 'installed' : 'updated';
}

/**
 * Remove the skill from one target. Only the files we wrote are deleted, and the directory only
 * if that leaves it empty, so anything you put beside the skill stays.
 */
export function remove(target, { force = false } = {}) {
  if (target.state === 'absent') return 'absent';
  if (target.state === 'modified' && !force) return 'modified';
  const names = [...sourceFiles().map((f) => f.name), MARKER, ...Object.keys(readMarker(target.dest)?.files ?? {})];
  for (const name of new Set(names)) fs.rmSync(path.join(target.dest, name), { force: true });
  try { fs.rmdirSync(target.dest); } catch { /* something else lives there */ }
  return 'removed';
}

/**
 * What a global install should do on its own: write the skill for every agent already on the
 * machine, so pdfpin works from an agent the moment it is installed. A plain `npm install` in a
 * clone is a build, not an install, so it does nothing there; `PDFPIN_NO_SKILL=1` opts out; and a
 * copy pdfpin did not write is reported, never replaced.
 */
export function autoInstall({ env = process.env, home = os.homedir() } = {}) {
  if (env.PDFPIN_NO_SKILL) return { skipped: 'PDFPIN_NO_SKILL is set' };
  if (env.npm_config_global !== 'true') return { skipped: 'not a global install' };
  const present = status(home).filter((t) => t.present);
  if (!present.length) return { skipped: 'no agent found on this machine' };
  return { results: present.map((target) => ({ target, result: install(target) })) };
}

/**
 * npm hides what a postinstall script prints, and it may refuse to run the script at all, so the
 * skill can land in your home without you being told — or quietly not land. Say which it was, once,
 * on the first `pdfpin open` that follows. The flag is only written once there was something to
 * say, so a skill installed later is still announced.
 */
export function pendingNotice(pdfpinHome, home = os.homedir()) {
  const flag = path.join(pdfpinHome, '.skill-notice');
  if (fs.existsSync(flag)) return null;
  const rows = status(home);
  const names = (list) => list.map((t) => t.label).join(' and ');
  const installed = rows.filter((t) => t.state === 'current' || t.state === 'outdated');
  const missing = rows.filter((t) => t.present && t.state === 'absent');

  let line = null;
  if (installed.length) {
    line = `Skill installed for ${names(installed)} — ask your agent to highlight the evidence in a PDF.\n`
      + '`pdfpin skill` shows where it lives, `pdfpin skill remove` takes it out.';
  } else if (missing.length) {
    line = `${names(missing)} ${missing.length > 1 ? 'are' : 'is'} on this machine, but cannot drive pdfpin yet.\n`
      + 'Run `pdfpin skill install` to hand over the skill.';
  }
  if (!line) return null;

  try {
    fs.mkdirSync(pdfpinHome, { recursive: true });
    fs.writeFileSync(flag, `${new Date().toISOString()}\n`);
  } catch { return null; }
  return line;
}
