// Ask the operating system for a PDF. The daemon runs on the user's machine, so it can show a real
// file chooser and learn the absolute path; a browser file picker would only ever hand back bytes.
import { execFile } from 'node:child_process';

const PS_SCRIPT = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'PDF files (*.pdf)|*.pdf'; $d.Title = 'Open a PDF'; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }`;

export function pickCommand(platform) {
  if (platform === 'darwin') {
    return { cmd: 'osascript', args: ['-e', 'POSIX path of (choose file with prompt "Open a PDF" of type {"com.adobe.pdf"})'] };
  }
  if (platform === 'win32') {
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-STA', '-Command', PS_SCRIPT] };
  }
  return { cmd: 'zenity', args: ['--file-selection', '--title=Open a PDF', '--file-filter=PDF | *.pdf'] };
}

/**
 * { path } when a file was chosen, { cancelled: true } when the person backed out, or
 * { unavailable: true } when this machine has no chooser to offer.
 */
export function pickPdf() {
  if (process.env.PDFPIN_NO_LAUNCH) return Promise.resolve({ cancelled: true });
  const { cmd, args } = pickCommand(process.platform);
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5 * 60_000 }, (err, stdout) => {
      const picked = String(stdout || '').trim();
      if (picked) return resolve({ path: picked });
      if (err && (err.code === 'ENOENT' || err.code === 127)) return resolve({ unavailable: true });
      resolve({ cancelled: true });
    });
  });
}
