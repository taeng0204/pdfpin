// Runs after `npm install -g`. Puts the agent skill in place so pdfpin is usable from Claude Code
// or Codex without a second command, and brings a macOS launcher that is already installed in line
// with the version that just landed — so updating is one npm command and nothing is left behind
// still pointing at the old one. It must never fail the install, so everything is swallowed.
import { autoInstall } from '../src/cli/skill.js';
import { autoUpdate } from '../src/cli/app.js';

try {
  const { results } = autoInstall();
  for (const { target, result } of results ?? []) {
    if (result === 'modified') {
      console.log(`pdfpin: left ${target.dest} as it is — pdfpin did not write it. \`pdfpin skill install --force\` replaces it.`);
    } else if (result !== 'current') {
      console.log(`pdfpin: skill ${result} for ${target.label} · ${target.dest}`);
    }
  }
  if (results?.some(({ result }) => result === 'installed')) {
    console.log('pdfpin: ask your agent to "highlight the evidence in this PDF". `pdfpin skill remove` undoes this.');
  }
} catch { /* a skill that did not install is not a reason to fail an install */ }

try {
  const { result, app } = autoUpdate();
  if (result === 'updated') console.log(`pdfpin: launcher updated · ${app}`);
  else if (result === 'modified') console.log(`pdfpin: left ${app} as it is — pdfpin did not write it. \`pdfpin app install --force\` replaces it.`);
} catch { /* nor is a launcher that did not rebuild */ }
