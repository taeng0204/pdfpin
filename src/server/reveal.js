// Show a file in the platform's file manager (Finder / Explorer / the folder on Linux).
import path from 'node:path';
import { spawn } from 'node:child_process';

export function revealCommand(platform, filePath) {
  if (platform === 'darwin') return { cmd: 'open', args: ['-R', filePath] };
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [`/select,${filePath}`] };
  return { cmd: 'xdg-open', args: [path.dirname(filePath)] };
}

export function revealFile(filePath) {
  if (process.env.PDFPIN_NO_LAUNCH) return false;
  const { cmd, args } = revealCommand(process.platform, filePath);
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
