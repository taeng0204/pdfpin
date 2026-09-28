// Viewer and CLI preferences, kept on the daemon so every window agrees and the CLI can read them.
import fs from 'node:fs';
import path from 'node:path';
import { COLORS } from './palette.js';

export const LANGUAGES = ['auto', 'en', 'ko'];
export const COLOR_BY = ['tag', 'session'];
export const THEMES = ['system', 'light', 'dark'];

export const DEFAULT_KEYS = {
  documents: 'mod+d',
  history: 'mod+j',
  settings: 'mod+,',
  search: 'mod+f',
  zoomIn: 'mod+=',
  zoomOut: 'mod+-',
  zoomReset: 'mod+0',
  nextPage: 'ArrowRight',
  prevPage: 'ArrowLeft',
  nextHighlight: 'n',
  prevHighlight: 'p',
  theme: 'd',
  toggleHighlights: 'h',
};

export const DEFAULT_SETTINGS = Object.freeze({
  language: 'auto',
  colorBy: 'tag',
  theme: 'system',
  dimPages: true,
  zoom: 'fit-width',
  palette: [...COLORS],
  keys: { ...DEFAULT_KEYS },
});

const clone = (s) => ({ ...s, palette: [...s.palette], keys: { ...s.keys } });

export class SettingsError extends Error {}

/** Validate a patch and return the merged settings. Throws SettingsError with a readable message. */
export function mergeSettings(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SettingsError('Settings must be an object');
  const next = clone(current);
  for (const [k, v] of Object.entries(patch)) {
    switch (k) {
      case 'language':
        if (!LANGUAGES.includes(v)) throw new SettingsError(`language must be one of: ${LANGUAGES.join(', ')}`);
        next.language = v;
        break;
      case 'colorBy':
        if (!COLOR_BY.includes(v)) throw new SettingsError(`colorBy must be one of: ${COLOR_BY.join(', ')}`);
        next.colorBy = v;
        break;
      case 'theme':
        if (!THEMES.includes(v)) throw new SettingsError(`theme must be one of: ${THEMES.join(', ')}`);
        next.theme = v;
        break;
      case 'dimPages':
        if (typeof v !== 'boolean') throw new SettingsError('dimPages must be true or false');
        next.dimPages = v;
        break;
      case 'zoom': {
        const ok = v === 'fit-width' || v === 'fit-page' || (typeof v === 'number' && v >= 0.25 && v <= 4);
        if (!ok) throw new SettingsError('zoom must be "fit-width", "fit-page" or a number between 0.25 and 4');
        next.zoom = v;
        break;
      }
      case 'palette': {
        if (!Array.isArray(v) || !v.length) throw new SettingsError('palette must list at least one colour');
        const unknown = v.filter((c) => !COLORS.includes(c));
        if (unknown.length) throw new SettingsError(`unknown colour(s): ${unknown.join(', ')}. Choose from: ${COLORS.join(', ')}`);
        if (new Set(v).size !== v.length) throw new SettingsError('palette must not repeat a colour');
        next.palette = [...v];
        break;
      }
      case 'keys': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SettingsError('keys must be an object');
        for (const [action, binding] of Object.entries(v)) {
          if (!(action in DEFAULT_KEYS)) throw new SettingsError(`unknown action "${action}". Known: ${Object.keys(DEFAULT_KEYS).join(', ')}`);
          if (typeof binding !== 'string' || !binding.trim()) throw new SettingsError(`the binding for "${action}" must be a non-empty string`);
          next.keys[action] = binding.trim();
        }
        // Name the action the user did *not* just touch, so the message points at the real clash.
        for (const changed of Object.keys(v)) {
          const binding = next.keys[changed].toLowerCase();
          const other = Object.keys(next.keys).find((a) => a !== changed && next.keys[a].toLowerCase() === binding);
          if (other) throw new SettingsError(`"${next.keys[changed]}" is already bound to "${other}"`);
        }
        break;
      }
      default:
        throw new SettingsError(`unknown setting "${k}"`);
    }
  }
  return next;
}

export class SettingsStore {
  constructor(home) {
    this.file = path.join(home, 'settings.json');
    this.value = this._read();
  }

  _read() {
    try {
      return mergeSettings(DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return clone(DEFAULT_SETTINGS); // missing, unreadable or stale: fall back to the defaults
    }
  }

  get() {
    return clone(this.value);
  }

  update(patch) {
    this.value = mergeSettings(this.value, patch);
    this._write();
    return this.get();
  }

  reset() {
    this.value = clone(DEFAULT_SETTINGS);
    this._write();
    return this.get();
  }

  _write() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
