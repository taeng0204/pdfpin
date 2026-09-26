# pdfpin implementation plan

Spec: docs/superpowers/specs/2026-09-26-pdfpin-design.md. Each task ends with passing tests and a commit.

1. **matcher.js** (TDD) — `normalize()`, `findExact()`, `findFuzzy()`, `search(pageText, query, {maxEdits})`
   returning `[{start, end, score}]` in raw offsets. Tests: whitespace/case, curly quotes, ligatures,
   de-hyphenation, fuzzy with typos, multiple hits, no match.
2. **pdftext.js** (TDD) — `openPdf(path)`, `getPageIndex(doc, n)` → `{text, map, items, viewport}`,
   `offsetsToAnchor()`, `approxRects(index, anchor)`. Fixture: pdf-lib generated 2-page PDF.
3. **store.js** (TDD) — `Store(home)`: `openDocument(path)`, `get`, `list`, `current`, `addAnnotation`,
   `updateAnnotation`, `removeAnnotation`, `clear`, `setSummary`. JSON files under `home/docs`.
4. **server/index.js** (TDD) — HTTP API from spec §3.6, SSE hub, static files, vendor pdf.js.
   Tests hit an ephemeral port with `PDFPIN_HOME` in a temp dir.
5. **cli** — commander commands, daemon ensure/spawn, launch.js (app mode detection, default
   browser). `pdfpin guide` text and `skill/SKILL.md`.
6. **web viewer** — index.html, app.css, modules: viewer (render/lazy/zoom/text layers), highlights
   (anchor → Range → rects, overlay, popover), panel, search, selection toolbar, strip, toasts,
   keyboard, theme, markdown. Verified in Chrome via DevTools MCP screenshots.
7. **export.js** (TDD) — pdf-lib highlight annots, Markdown export; CLI `export`.
8. **Feedback rounds** — end-to-end run on a real paper; Codex code review; Gemini screenshot
   review; fix findings; repeat until clean. README.
