# pdfpin — Agent-friendly PDF viewer with a CLI for highlights and notes

Date: 2026-09-26
Status: approved by the author acting autonomously (the user asked for the tool to be built end-to-end with self-driven feedback rounds)

## 1. Goal

A local PDF viewer that an AI agent (Claude Code, Codex, Gemini CLI, …) can drive through a
CLI. The canonical flow:

> User: "Find the evidence in this paper for claim X."
> Agent: reads the PDF text with `pdfpin text`, then runs `pdfpin add --text "<quote>" --note "<why it matters>"`
> for each piece of evidence. The viewer highlights those passages live and lists the notes in a side panel.

Must run on macOS and Windows with the same code path. Clean, modern UI. Convenience features
chosen by the author (see §6).

## 2. Approach chosen

**Local web app + Node daemon + Node CLI.** One language (JavaScript, Node ≥ 18), no native build step.

- The daemon (`pdfpin` server) serves the viewer over `127.0.0.1:<port>`, keeps documents and
  annotations, pushes changes to viewers with Server-Sent Events.
- The viewer is a static page rendered by pdf.js (vendored via `pdfjs-dist`), opened in Chrome/Edge
  "app mode" when available (chromeless window) and in the default browser otherwise.
- The CLI is a thin HTTP client that auto-starts the daemon.

Rejected alternatives:
- Electron/Tauri app: better "native" feel, but packaging for two OSes and ~200 MB installs make it a
  poor fit for a tool agents install with one command. Can be layered on later since the UI is a web page.
- Python (PyMuPDF) server: exact glyph boxes for free, but a two-language stack and a second runtime
  to install. pdf.js in Node gives the same text items the browser renders, so offsets line up exactly.

## 3. Architecture

```
bin/pdfpin.js ─► src/cli/*   ──HTTP──►  src/server/index.js  ──SSE──►  src/web/* (browser)
                                        ├─ store.js     (~/.pdfpin/docs/<id>.json)
                                        ├─ pdftext.js   (pdf.js text items → page text + offset map)
                                        ├─ matcher.js   (normalise + exact/fuzzy substring search)
                                        ├─ export.js    (pdf-lib highlight annots, Markdown)
                                        └─ launch.js    (open browser / app mode, cross-platform)
```

### 3.1 Daemon lifecycle
- `~/.pdfpin/server.json` = `{port, pid, startedAt}` (override root with `PDFPIN_HOME`).
- CLI: read file → `GET /api/health`; if it fails, spawn `node src/server/index.js` detached
  (`stdio: 'ignore'`, `windowsHide: true`, `unref()`), poll health for up to 5 s.
- Default port 47831; if occupied by something else, choose a free port and record it.
- Server binds to loopback only; no CORS headers, so foreign origins cannot call mutating JSON endpoints.

### 3.2 Data model
```
Document   { id, path, title, pages, openedAt, summary?: {title, body}, annotations: Annotation[] }
Annotation { id, page, quote, note, title?, color, tag?, source: 'agent'|'user',
             anchor: {startItem, startChar, endItem, endChar},   // pdf.js text-item coordinates
             rects: [{x,y,w,h}], rectsSource: 'approx'|'dom',      // page units at scale 1, top-left origin
             score, createdAt, updatedAt }
```
- `id` of a document = first 10 hex chars of sha1(absolute path) so annotations persist per file.
- Annotation ids are short random strings (`a_` + 6 base36 chars).
- Colors: yellow, green, blue, pink, purple, orange (named; viewer maps to the palette).

### 3.3 Text index (`pdftext.js`)
For each page, from `page.getTextContent()`:
- Keep every item that has `str` (this is exactly the set that becomes `TextLayer.textDivs`).
- Page text = concat of `str`; after an item with `hasEOL` append `\n`; between two items on the same
  baseline whose boundary has no whitespace and whose horizontal gap > 0.1 × font height append a space.
- Keep `map[rawOffset] → {item, char}` where separators map to `{item, char: str.length}`.
- Also cache `page.getViewport({scale: 1})` for coordinate conversion and the item geometry
  (`transform`, `width`, `height`) for approximate rects.

### 3.4 Matching (`matcher.js`)
`normalize(s)` → `{text, map}`: NFKC (expands ligatures), lower-case, curly quotes → straight, dashes →
`-`, `-\s+` followed by a lower-case letter → removed (de-hyphenation), whitespace runs → one space.
Search order, per candidate page:
1. Exact substring in normalised space (all occurrences).
2. Fuzzy: Sellers' approximate-substring DP with max edits = max(2, ⌊0.2 · len⌋), best end then best start via reverse DP. Score = 1 − edits/len.
Results map back through `map` to raw offsets and then to `{startItem, startChar, endItem, endChar}`.
Multi-page quotes are not supported; the CLI tells the agent to split them.

### 3.5 Rects
- Server: approximate rects from item geometry, partial items proportional to character count, converted with `viewport.convertToViewportRectangle`. Used until the viewer reports better ones and for headless export.
- Viewer: builds a `Range` over the pdf.js text-layer spans and uses `getClientRects()` (exact glyph
  layout), merges same-line rects, reports them with `PATCH …/annotations/:id {rects}`. Text layers are
  built for every page at load (cheap; canvases stay lazy), so rects exist before a page is scrolled to.

### 3.6 HTTP API (JSON)
```
GET    /api/health
GET    /api/docs                       list;  POST /api/docs {path}  open (becomes "current")
GET    /api/docs/current               GET /api/docs/:id
GET    /api/docs/:id/file              PDF bytes
GET    /api/docs/:id/text?pages=1-3,7
GET    /api/docs/:id/find?q=&page=
POST   /api/docs/:id/annotations       one object or an array; each {text, note, page?, color?, tag?, title?, all?} or {anchor, quote, …}
PATCH  /api/docs/:id/annotations/:aid  {note?, color?, tag?, title?, rects?}
DELETE /api/docs/:id/annotations/:aid  DELETE /api/docs/:id/annotations[?tag=]
PUT    /api/docs/:id/summary {title, body} | DELETE
POST   /api/docs/:id/focus {annotationId | page}
POST   /api/docs/:id/export {out?, format: 'pdf'|'md'}
GET    /api/docs/:id/events            SSE: annotation.added|updated|removed, annotations.cleared, summary.updated, focus, doc.reloaded
POST   /api/shutdown
GET    /view/:id                       viewer page;  /vendor/pdfjs/*  from node_modules
```
Batch `POST` returns per-item results; items that fail to match do not abort the others. HTTP 422 with
`{error, suggestions}` when nothing matched (suggestions = best fuzzy candidates with page + snippet).

### 3.7 CLI
`-d, --doc <id|path>` on every command selects a document; default is the current one.
```
pdfpin open <file.pdf> [--no-browser] [--in-browser]   start daemon if needed, open viewer, print doc id
pdfpin text [-p 1-3,7] [--json]                     page text with "=== Page N ===" markers
pdfpin find <query> [-p N] [--json]                  matches with page and context
pdfpin add --text "…" --note "…" [-p N] [--color c] [--tag t] [--title "…"] [--all]
pdfpin add --json '<array>' | --from file.json | --stdin  (batch)
pdfpin list [--json] [--tag t]
pdfpin note <id> [--note …] [--color …] [--tag …] [--title …]
pdfpin rm <id…> ;  pdfpin clear [--tag t] [--yes]
pdfpin summary --title "…" --body "…" | --clear
pdfpin focus <id> | --page N
pdfpin export [--out path] [--format pdf|md]
pdfpin docs ; pdfpin status ; pdfpin stop ; pdfpin guide
```
Exit codes: 0 ok, 1 usage/error, 2 text not found (with suggestions printed). `pdfpin guide` prints
the agent-oriented usage guide; `skill/SKILL.md` carries the same content for Claude Code / Codex.

### 3.8 Viewer (src/web)
Vanilla ES modules, no build step. Layout: top bar (title, page N / M input, search, zoom, fit,
theme, panel toggle); scrolling page column (lazy hi-DPI canvases, text layers, highlight overlay);
right panel (summary card, filters, annotation cards grouped by page); evidence strip (a slim
minimap of highlight positions on the right edge of the page column).

Interactions: hover a highlight → popover with title/note; click → select card; click a card →
scroll to highlight and pulse it; `n`/`p` next/prev annotation; `⌘/Ctrl+F` search; `⌘/Ctrl +/−/0`
zoom; `t` panel; `Esc` close. Selecting text shows a floating toolbar (colour dots + note) to add a
user annotation. Live toasts when an agent adds annotations. Light/dark theme with optional page
dimming in dark mode. Notes render a safe Markdown subset (bold, italic, code, links, lists, line breaks).

### 3.9 Export
- PDF: pdf-lib adds a `/Highlight` annotation per rect group (QuadPoints from rects converted to PDF
  user space via the page viewport), with `/Contents` = note and `/T` = tag or "pdfpin". Output next to
  the source as `<name>.annotated.pdf` unless `--out` is given.
- Markdown: summary, then per page: quote, note, colour/tag.

## 4. Error handling
- Missing file / not a PDF → clear CLI error, exit 1.
- No current document → "Run `pdfpin open <file>` first."
- Text not found → exit 2 and up to 3 fuzzy suggestions so the agent can retry with an exact quote.
- Daemon failed to start → print the log path `~/.pdfpin/server.log` and exit 1.
- Viewer loses SSE → reconnects with back-off and reloads the document state.

## 5. Testing
`node --test` suites: matcher (normalisation, hyphenation, ligatures, fuzzy, multiple hits), pdftext
(fixture PDF generated with pdf-lib), store (round trip, ids), server API (ephemeral port,
`PDFPIN_HOME` in a temp dir, batch add, 422 suggestions, SSE delivery), export (annotation objects
present). Viewer verified manually in Chrome with screenshots plus an external visual review.

## 6. Convenience features included
Live SSE updates and toasts · evidence strip minimap · grouping by page and filtering by tag/colour/
text · keyboard navigation · in-document search · user-made highlights with notes · copy quote as a
Markdown citation with page number · agent summary card · batch add via JSON · `pdfpin guide` and a
SKILL.md · export to annotated PDF and Markdown · dark mode with page dimming · persistent annotations
per file · Chrome/Edge app-mode window.

Out of scope for v0.1: multi-page quotes, freehand/shape annotations, collaboration, PDF editing.
