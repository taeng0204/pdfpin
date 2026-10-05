// Installing the macOS launcher. A double-clicked app, a Dock icon and "Open With" all need a
// bundle, which npm cannot ship: an .app is a directory of compiled AppleScript and a signature,
// and both have to be made on the machine that will run them. So the bundle is built here from
// pieces that travel well — the applet source below and the viewer icon already in src/web.
// macOS only. Windows and Linux reach the viewer through the CLI and the browser's own install.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../server/index.js';

export const APP_NAME = 'pdfpin.app';
export const BUNDLE_ID = 'io.github.taeng0204.pdfpin';
const MARKER = 'Contents/Resources/.pdfpin-app.json'; // what we last wrote, so an edit of yours is recognisable

/** Only macOS has .app bundles; everywhere else this command has nothing to install. */
export const supported = (platform = process.platform) => platform === 'darwin';

/** ~/Applications needs no administrator, and Spotlight and the Dock look there. */
export const destDir = (home = os.homedir()) => path.join(home, 'Applications');
export const destPath = (home = os.homedir()) => path.join(destDir(home), APP_NAME);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const iconSource = () => fileURLToPath(new URL('../web/icon-512.png', import.meta.url));

// `on run` is a plain launch, which raises whatever the viewer was last showing; `on open` is a
// double-clicked PDF or one dropped on the icon. Both hand off to launch.sh and exit.
const APPLET = `on run
	runLauncher("")
end run

on open theFiles
	repeat with f in theFiles
		runLauncher(quoted form of POSIX path of (f as text))
	end repeat
end open

on runLauncher(arg)
	set sh to quoted form of (POSIX path of (path to me) & "Contents/Resources/launch.sh")
	do shell script sh & " " & arg
end runLauncher
`;

const LAUNCHER = `#!/bin/sh
# a double-clicked app has no console, so leave failures somewhere findable
mkdir -p "$HOME/.pdfpin" 2>/dev/null; exec 2>>"$HOME/.pdfpin/app.log"
# A double-click has no login shell: PATH is bare and nvm never ran, so find the CLI ourselves.
set -u
BIN=""
for d in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin "$HOME"/.volta/bin "$HOME"/.bun/bin; do
  [ -x "$d/pdfpin" ] && BIN="$d" && break
done
if [ -z "$BIN" ]; then
  osascript -e 'display alert "pdfpin" message "pdfpin is not installed. Run: npm install -g @taeng0204/pdfpin"' >/dev/null 2>&1
  exit 1
fi
PATH="$BIN:$PATH"; export PATH
if [ $# -gt 0 ] && [ -n "$1" ]; then set -- "$1"; else set --; fi
if ! ERR=$(pdfpin open "$@" 2>&1 >/dev/null); then
  osascript -e "display alert \\"pdfpin\\" message \\"\${ERR:-Could not start pdfpin.}\\"" >/dev/null 2>&1
  exit 1
fi

# The window belongs to the browser, not to this bundle, so without this a click on our icon does
# nothing visible whenever the viewer is already up. Two things make that raise unreliable if you
# do it naively: the browser spawns a helper process per renderer, tab and GPU, every one of them
# carrying the same profile flag, and raising a helper is silently a no-op; and a window that was
# only just created cannot be raised yet. So: take the one process that is the browser itself, and
# keep asking until the activation actually took.
PROFILE="\${PDFPIN_HOME:-$HOME/.pdfpin}/browser-profile"
viewer_pid() {
  ps -o pid=,command= -ax 2>/dev/null | grep -F -- "user-data-dir=$PROFILE" \\
    | grep -v -- "--type=" | grep -v grep | awk '{print $1}' | head -1
}
i=0
while [ $i -lt 40 ]; do
  PID=$(viewer_pid)
  if [ -n "$PID" ]; then
    osascript -e "tell application \\"System Events\\" to set frontmost of (first process whose unix id is $PID) to true" >/dev/null 2>&1
    [ "$(osascript -e 'tell application "System Events" to get unix id of first process whose frontmost is true' 2>/dev/null)" = "$PID" ] && exit 0
  fi
  i=$((i + 1)); sleep 0.25
done
echo "$(date '+%Y-%m-%d %H:%M:%S') could not bring the viewer window forward (pid=\${PID:-none})" >> "\${PDFPIN_HOME:-$HOME/.pdfpin}/app.log"
exit 0
`;

function readMarker(app) {
  try { return JSON.parse(fs.readFileSync(path.join(app, MARKER), 'utf8')); } catch { return null; }
}

/**
 * What is sitting in ~/Applications.
 *   'absent'    nothing there
 *   'current'   ours, built by this pdfpin
 *   'outdated'  ours, built by an older pdfpin
 *   'modified'  a bundle pdfpin did not write, or one whose launcher was edited here
 */
export function status(home = os.homedir()) {
  const app = destPath(home);
  const row = { app, supported: supported(), version: VERSION };
  if (!fs.existsSync(path.join(app, 'Contents', 'Info.plist'))) return { ...row, state: 'absent', installed: null };
  const marker = readMarker(app);
  let launcher = null;
  try { launcher = sha(fs.readFileSync(path.join(app, 'Contents/Resources/launch.sh'))); } catch { /* not ours */ }
  const ours = marker && marker.launcher === launcher;
  if (!ours) return { ...row, state: 'modified', installed: marker?.version ?? null };
  return { ...row, state: marker.version === VERSION ? 'current' : 'outdated', installed: marker.version };
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });

/**
 * The viewer icon at every size the Dock and Finder ask for. `sips` and `iconutil` ship with
 * macOS, so this needs nothing installed: a one-resolution icns would be scaled and look soft.
 */
function buildIcon(work, out) {
  const set = path.join(work, 'icon.iconset');
  fs.mkdirSync(set, { recursive: true });
  for (const [size, name] of [[16, 'icon_16x16'], [32, 'icon_16x16@2x'], [32, 'icon_32x32'], [64, 'icon_32x32@2x'],
    [128, 'icon_128x128'], [256, 'icon_128x128@2x'], [256, 'icon_256x256'], [512, 'icon_256x256@2x'], [512, 'icon_512x512']]) {
    run('sips', ['-z', String(size), String(size), iconSource(), '--out', path.join(set, `${name}.png`)]);
  }
  run('iconutil', ['-c', 'icns', set, '-o', out]);
}

function plist(app) {
  const p = path.join(app, 'Contents', 'Info.plist');
  const B = '/usr/libexec/PlistBuddy';
  const set = (key, type, value) => {
    try { run(B, ['-c', `Set :${key} ${value}`, p]); } catch { run(B, ['-c', `Add :${key} ${type} ${value}`, p]); }
  };
  set('CFBundleName', 'string', 'pdfpin');
  set('CFBundleDisplayName', 'string', 'pdfpin');
  set('CFBundleIdentifier', 'string', BUNDLE_ID);
  set('CFBundleShortVersionString', 'string', VERSION);
  set('CFBundleVersion', 'string', VERSION);
  // The launcher hands off and exits, so a Dock tile and a menu bar would only flash and go.
  set('LSUIElement', 'bool', 'true');
  // Declare PDFs and nothing else: the applet template may claim every file, or none at all.
  // 'Alternate' keeps whatever opens PDFs today in charge and adds pdfpin to "Open With".
  try { run(B, ['-c', 'Delete :CFBundleDocumentTypes', p]); } catch { /* the template had none */ }
  for (const c of [
    'Add :CFBundleDocumentTypes array',
    'Add :CFBundleDocumentTypes:0:CFBundleTypeName string PDF',
    'Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer',
    'Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate',
    'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array',
    'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string pdf',
    'Add :CFBundleDocumentTypes:0:LSItemContentTypes array',
    'Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string com.adobe.pdf',
  ]) run(B, ['-c', c, p]);
}

/**
 * Build the bundle into ~/Applications. Returns 'installed' | 'updated' | 'current' | 'modified'
 * | 'unsupported'. A bundle pdfpin did not write is reported, never replaced, without --force.
 */
export function install({ home = os.homedir(), force = false } = {}) {
  if (!supported()) return 'unsupported';
  const before = status(home);
  if (before.state === 'current' && !force) return 'current';
  if (before.state === 'modified' && !force) return 'modified';

  const app = destPath(home);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpin-app-'));
  try {
    const src = path.join(work, 'applet.applescript');
    fs.writeFileSync(src, APPLET);
    fs.mkdirSync(destDir(home), { recursive: true });
    // osacompile refuses to write over an existing bundle, and a leftover from an older build
    // would keep files we no longer write.
    fs.rmSync(app, { recursive: true, force: true });
    run('osacompile', ['-o', app, src]);

    const res = path.join(app, 'Contents', 'Resources');
    const launcher = path.join(res, 'launch.sh');
    fs.writeFileSync(launcher, LAUNCHER, { mode: 0o755 });
    buildIcon(work, path.join(res, 'droplet.icns'));
    fs.rmSync(path.join(res, 'Assets.car'), { force: true }); // the template's own artwork, now unused
    plist(app);
    fs.writeFileSync(path.join(app, MARKER), `${JSON.stringify({ name: APP_NAME, version: VERSION, launcher: sha(Buffer.from(LAUNCHER)) }, null, 2)}\n`);

    // Ad-hoc signing is enough for a bundle built on the machine that runs it, and without it
    // every edit above would leave the signature broken rather than merely absent.
    try { run('codesign', ['-f', '-s', '-', '--deep', app]); } catch { /* unsigned still launches */ }
    // Tell Launch Services the bundle is there, or "Open With" waits for a rescan. Only for the
    // real ~/Applications: registering a bundle built elsewhere under the same identifier would
    // point "Open With" at a copy that is about to be thrown away.
    if (app === destPath()) {
      try {
        run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app]);
      } catch { /* it will be picked up eventually */ }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return before.state === 'absent' ? 'installed' : 'updated';
}

/** Remove the bundle. One pdfpin did not write is left alone without --force. */
export function remove({ home = os.homedir(), force = false } = {}) {
  const before = status(home);
  if (before.state === 'absent') return 'absent';
  if (before.state === 'modified' && !force) return 'modified';
  fs.rmSync(before.app, { recursive: true, force: true });
  return 'removed';
}
