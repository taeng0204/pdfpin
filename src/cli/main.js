// pdfpin command-line interface.
import fs from 'node:fs';
import path from 'node:path';
import { Command, Option } from 'commander';
import { VERSION, defaultHome } from '../server/index.js';
import { docIdFor } from '../server/store.js';
import { COLORS } from '../server/docs.js';
import { Client, CliError, ensureDaemon, stopDaemon, readServerInfo, healthy } from './client.js';
import { openViewer } from './launch.js';
import { GUIDE } from './guide.js';

const program = new Command();
const home = defaultHome();
const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);
const trunc = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const json = (v) => out(JSON.stringify(v, null, 2));
/** Shells often deliver a literal backslash-n; agents mean a line break. */
const unescapeText = (s) => (typeof s === 'string' ? s.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t') : s);

program
  .name('pdfpin')
  .description('Agent-friendly PDF viewer: pin highlights and explanations onto a PDF from the CLI.')
  .version(VERSION)
  .option('-d, --doc <ref>', 'target document: id, path or file name (default: the current document)')
  .configureOutput({ writeErr: (s) => process.stderr.write(s) });

/** Resolve the document reference for API URLs. Paths are turned into ids client-side. */
function docRef() {
  const ref = program.opts().doc;
  if (!ref) return 'current';
  if (/[\\/]/.test(ref) || fs.existsSync(ref)) return docIdFor(path.resolve(ref));
  return ref;
}

async function client({ start = true } = {}) {
  const info = await ensureDaemon({ home, start });
  if (!info) throw new CliError('The pdfpin daemon is not running. Run `pdfpin open <file.pdf>` first.');
  return new Client(info);
}

function colorOption() {
  return new Option('-c, --color <color>', 'highlight colour').choices(COLORS);
}

function printAdded(a, alternatives) {
  const tag = a.tag ? `  #${a.tag}` : '';
  const score = a.score < 1 ? `  (fuzzy ${Math.round(a.score * 100)}%)` : '';
  out(`✔ ${a.id}  p.${a.page}  ${a.color}${tag}  "${trunc(a.quote, 70)}"${score}`);
  if (alternatives?.length) {
    const pages = [...new Set(alternatives.map((x) => x.page))];
    out(`  ↳ ${alternatives.length} more match${alternatives.length > 1 ? 'es' : ''} on ${pages.map((p) => `p.${p}`).join(', ')} — use --page or --all to choose`);
  }
}

function printNotFound(message, extra) {
  err(`✘ ${message}`);
  for (const s of extra?.suggestions || []) err(`  ? p.${s.page} (${Math.round(s.score * 100)}%): ${trunc(s.context, 160)}`);
  if (extra?.suggestions?.length) err('  Retry with the exact wording from `pdfpin text`.');
}

program
  .command('open')
  .description('open a PDF in the viewer (starts the daemon if needed) and make it the current document')
  .argument('<file>', 'path to a PDF file')
  .option('--no-browser', 'do not launch a viewer window')
  .option('--browser', 'use the default browser instead of an app-mode window')
  .option('--json', 'machine-readable output')
  .action(async (file, opts) => {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) throw new CliError(`File not found: ${abs}`);
    const c = await client();
    const { doc } = await c.call('POST', '/api/docs', { path: abs });
    const url = `${c.base}${doc.viewerUrl}`;
    let launched = 'not launched';
    if (opts.browser !== false) {
      launched = doc.viewers > 0 ? 'already open' : openViewer(url, { mode: opts.browser === true ? 'browser' : undefined, home });
    }
    if (opts.json) return json({ ...doc, url, launched });
    out(`Opened "${doc.title}" (${doc.pages} pages, ${doc.annotations.length} annotations) · id ${doc.id}`);
    out(`Viewer: ${url}  [${launched}]`);
  });

program
  .command('text')
  .description('print page text (use it to find exact quotes)')
  .option('-p, --pages <spec>', 'pages to print, e.g. "1-3,7" (default: all)')
  .option('--json', 'machine-readable output')
  .action(async (opts) => {
    const c = await client({ start: false });
    const q = opts.pages ? `?pages=${encodeURIComponent(opts.pages)}` : '';
    const r = await c.call('GET', `/api/docs/${docRef()}/text${q}`);
    if (opts.json) return json(r);
    for (const p of r.pages) out(`=== Page ${p.page} ===\n${p.text.trim()}\n`);
  });

program
  .command('find')
  .description('locate a phrase and print page, score and context')
  .argument('<query>')
  .option('-p, --page <n>', 'restrict to one page', Number)
  .option('--limit <n>', 'max hits', Number, 50)
  .option('--json', 'machine-readable output')
  .action(async (query, opts) => {
    const c = await client({ start: false });
    const qs = new URLSearchParams({ q: query, limit: String(opts.limit) });
    if (opts.page) qs.set('page', String(opts.page));
    const r = await c.call('GET', `/api/docs/${docRef()}/find?${qs}`);
    if (opts.json) return json(r);
    if (!r.hits.length) throw new CliError(`No match for "${trunc(query, 60)}"`, { exitCode: 2 });
    for (const h of r.hits) out(`p.${h.page}  ${h.exact ? 'exact' : `fuzzy ${Math.round(h.score * 100)}%`}  ${trunc(h.context, 200)}`);
  });

program
  .command('add')
  .description('highlight a quote and attach a note (single or batch)')
  .option('-t, --text <quote>', 'text to highlight, exactly as it appears in the PDF')
  .option('-n, --note <markdown>', 'explanation shown in the side panel', '')
  .option('-p, --page <n>', 'page to search (default: whole document)', Number)
  .addOption(colorOption())
  .option('--tag <tag>', 'group label, e.g. the question this evidence answers')
  .option('--title <title>', 'short heading for the note')
  .option('--all', 'highlight every occurrence instead of the first')
  .option('--json <spec>', 'batch: a JSON array (or one object) of {text, note, page, color, tag, title, all}')
  .option('--from <file>', 'batch: read the JSON spec from a file')
  .option('--stdin', 'batch: read the JSON spec from stdin')
  .option('--json-output', 'machine-readable output')
  .action(async (opts) => {
    let spec;
    if (opts.json || opts.from || opts.stdin) {
      const raw = opts.json ?? (opts.from ? fs.readFileSync(opts.from, 'utf8') : fs.readFileSync(0, 'utf8'));
      try { spec = JSON.parse(raw); } catch (e) { throw new CliError(`Invalid JSON spec: ${e.message}`); }
    } else {
      if (!opts.text) throw new CliError('Provide --text "<quote>" (or a batch via --json/--from/--stdin). See `pdfpin guide`.');
      spec = { text: opts.text, note: unescapeText(opts.note), page: opts.page, color: opts.color, tag: opts.tag, title: unescapeText(opts.title), all: !!opts.all };
    }
    const c = await client({ start: false });
    const ref = docRef();
    if (Array.isArray(spec)) {
      const r = await c.call('POST', `/api/docs/${ref}/annotations`, spec);
      if (opts.jsonOutput) json(r);
      else {
        for (const it of r.results) {
          if (it.ok) (it.annotations || [it.annotation]).forEach((a) => printAdded(a, it.alternatives));
          else printNotFound(`${it.error}`, it);
        }
        out(`${r.added} added, ${r.failed} failed`);
      }
      if (r.failed) process.exitCode = 2;
      return;
    }
    try {
      const r = await c.call('POST', `/api/docs/${ref}/annotations`, spec);
      if (opts.jsonOutput) return json(r);
      (r.annotations || [r.annotation]).forEach((a) => printAdded(a, r.alternatives));
    } catch (e) {
      if (e instanceof CliError && e.exitCode === 2 && !opts.jsonOutput) { printNotFound(e.message, e.extra); process.exitCode = 2; return; }
      throw e;
    }
  });

program
  .command('list')
  .description('list annotations of the document')
  .option('--tag <tag>', 'only this tag')
  .option('--json', 'machine-readable output')
  .action(async (opts) => {
    const c = await client({ start: false });
    const { doc } = await c.call('GET', `/api/docs/${docRef()}`);
    let anns = doc.annotations;
    if (opts.tag) anns = anns.filter((a) => a.tag === opts.tag);
    if (opts.json) return json({ doc: { id: doc.id, title: doc.title, pages: doc.pages, summary: doc.summary }, annotations: anns });
    if (doc.summary?.title) out(`Summary: ${doc.summary.title}`);
    if (!anns.length) return out('No annotations.');
    for (const a of anns) {
      out(`${a.id}  p.${String(a.page).padEnd(3)} ${a.color.padEnd(6)} ${a.tag ? `#${a.tag} ` : ''}"${trunc(a.quote, 60)}"${a.note ? `  — ${trunc(a.note.replace(/\s+/g, ' '), 80)}` : ''}`);
    }
  });

program
  .command('note')
  .description('edit an annotation')
  .argument('<id>')
  .option('-n, --note <markdown>')
  .option('--title <title>')
  .option('--tag <tag>')
  .addOption(colorOption())
  .action(async (id, opts) => {
    const c = await client({ start: false });
    const patch = {};
    for (const k of ['note', 'title', 'tag', 'color']) if (opts[k] !== undefined) patch[k] = k === 'note' || k === 'title' ? unescapeText(opts[k]) : opts[k];
    if (!Object.keys(patch).length) throw new CliError('Nothing to change.');
    const { annotation } = await c.call('PATCH', `/api/docs/${docRef()}/annotations/${id}`, patch);
    printAdded(annotation);
  });

program
  .command('rm')
  .description('remove annotations by id')
  .argument('<ids...>')
  .action(async (ids) => {
    const c = await client({ start: false });
    for (const id of ids) { await c.call('DELETE', `/api/docs/${docRef()}/annotations/${id}`); out(`removed ${id}`); }
  });

program
  .command('clear')
  .description('remove all annotations (optionally only one tag)')
  .option('--tag <tag>')
  .action(async (opts) => {
    const c = await client({ start: false });
    const q = opts.tag ? `?tag=${encodeURIComponent(opts.tag)}` : '';
    const r = await c.call('DELETE', `/api/docs/${docRef()}/annotations${q}`);
    out(`removed ${r.removed} annotation(s)`);
  });

program
  .command('summary')
  .description('set the summary card shown at the top of the side panel')
  .option('--title <title>')
  .option('--body <markdown>')
  .option('--clear', 'remove the summary')
  .action(async (opts) => {
    const c = await client({ start: false });
    if (opts.clear) { await c.call('DELETE', `/api/docs/${docRef()}/summary`); return out('summary cleared'); }
    if (!opts.title && !opts.body) throw new CliError('Provide --title and/or --body (or --clear).');
    await c.call('PUT', `/api/docs/${docRef()}/summary`, { title: unescapeText(opts.title) || '', body: unescapeText(opts.body) || '' });
    out('summary updated');
  });

program
  .command('focus')
  .description('scroll every open viewer to an annotation or a page')
  .argument('[id]', 'annotation id')
  .option('-p, --page <n>', 'page number', Number)
  .action(async (id, opts) => {
    if (!id && !opts.page) throw new CliError('Give an annotation id or --page N.');
    const c = await client({ start: false });
    const r = await c.call('POST', `/api/docs/${docRef()}/focus`, id ? { annotationId: id } : { page: opts.page });
    out(`focused p.${r.page}${r.annotationId ? ` (${r.annotationId})` : ''}`);
  });

program
  .command('export')
  .description('export an annotated PDF (real highlight annotations) or a Markdown report')
  .option('-o, --out <path>', 'output file (default: next to the PDF)')
  .option('-f, --format <fmt>', 'pdf | md', 'pdf')
  .action(async (opts) => {
    const c = await client({ start: false });
    const r = await c.call('POST', `/api/docs/${docRef()}/export`, { out: opts.out ? path.resolve(opts.out) : undefined, format: opts.format });
    out(`exported ${r.count} annotation(s) → ${r.path}`);
  });

program
  .command('docs')
  .description('list documents known to the daemon')
  .option('--json', 'machine-readable output')
  .action(async (opts) => {
    const c = await client({ start: false });
    const r = await c.call('GET', '/api/docs');
    if (opts.json) return json(r);
    if (!r.docs.length) return out('No documents. Run `pdfpin open <file.pdf>`.');
    for (const d of r.docs) out(`${d.current ? '*' : ' '} ${d.id}  ${d.annotationCount.toString().padStart(3)} ann  ${d.title}  (${d.path})`);
  });

program
  .command('status')
  .description('show daemon status')
  .action(async () => {
    const info = readServerInfo(home);
    const h = info ? await healthy(info.port) : null;
    if (!h) return out(`daemon: not running (home ${home})`);
    out(`daemon: running · ${info.url} · pid ${info.pid} · v${h.version} · home ${home}`);
    const c = new Client(info);
    const { docs } = await c.call('GET', '/api/docs');
    const cur = docs.find((d) => d.current);
    if (cur) out(`current: ${cur.title} (${cur.annotationCount} annotations) · ${cur.path}`);
  });

program
  .command('stop')
  .description('stop the daemon')
  .action(async () => {
    out((await stopDaemon(home)) ? 'daemon stopped' : 'daemon was not running');
  });

program
  .command('guide')
  .description('print the usage guide for agents')
  .action(() => out(GUIDE));

program.parseAsync(process.argv).catch((e) => {
  if (e instanceof CliError) {
    if (e.exitCode === 2) printNotFound(e.message, e.extra);
    else err(`✘ ${e.message}`);
    process.exit(e.exitCode);
  }
  err(`✘ ${e?.stack || e}`);
  process.exit(1);
});
