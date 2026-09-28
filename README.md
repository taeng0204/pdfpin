# pdfpin

An agent-friendly PDF viewer. A local viewer with a side panel of notes, plus a CLI that lets
AI agents (Claude Code, Codex, Gemini CLI, …) or humans pin highlights and explanations onto a PDF.

> "Find the evidence in this paper for X" → the agent reads the PDF with `pdfpin text`, then runs one
> `pdfpin mark --json '{title, flow, highlights:[…]}'` call. The viewer shows the session (its overview and
> colour-coded highlights with notes) live, and keeps every session as the document's history.

Works on macOS and Windows (and Linux) with Node ≥ 18. No native build step.

## Install

```bash
npm install -g .          # from this directory, or: npm install -g pdfpin (when published)
pdfpin guide              # usage guide for agents
```

For Claude Code, copy `skill/SKILL.md` to `~/.claude/skills/pdfpin/SKILL.md` (or the project's
`.claude/skills/pdfpin/`) so the agent knows when and how to use it.

## Use

```bash
pdfpin open paper.pdf                       # starts the daemon, opens the viewer window
pdfpin text -p 1-3                          # read page text (find exact quotes here)
pdfpin mark --json '{"title":"Evidence for X","flow":"Two passages: (1) … (2) …","highlights":[{"text":"…","note":"…","tag":"coverage"}]}'
pdfpin add --text "exact quote" --note "why it matters" --tag claim-1 --color green   # attaches to the latest session
pdfpin session start --title "…" · session update --flow "…" · session list · session rm <id>
pdfpin list · pdfpin rm <id> · pdfpin clear --tag claim-1
pdfpin focus <id>                           # scroll the viewer to a highlight
pdfpin export                               # paper.annotated.pdf with real highlight annotations
pdfpin export --format md                   # Markdown report
pdfpin status · pdfpin stop
```

## Viewer

- Live updates: highlights and notes appear as the agent adds them (toast + card).
- Side panel: sessions newest-first (title, overview, highlights grouped by tag/colour with notes);
  older sessions collapse into the document's history. Filter by text / tag / colour, focus one session,
  inline edit, copy a note as a Markdown citation, copy everything, export.
- Hover a highlight for a popover with the note; click to select; `n`/`p` step through notes.
- Evidence strip: a minimap of highlights along the right edge; click to jump.
- Search in the document (`⌘/Ctrl+F`), zoom (`⌘/Ctrl +/−/0`, ctrl+wheel), fit width / fit page.
- Select text on a page → floating toolbar → highlight in a colour, optionally with a note.
- Light / dark theme (`d`), dimmed pages in dark mode, hide highlights (`h`).
- History panel (`⌘H` / `Ctrl+H`, or `t`) and Documents drawer (`⌘D` / `Ctrl+D`, or `l`).
  On macOS the system takes plain `⌘H`, so the History panel answers to `⌘⇧H`.
- Documents drawer (`⌘D`, `l`, or the library button): every PDF opened so far with its note count, tags and
  latest session; click one to open it instantly (it also becomes the CLI's current document).
- Twelve highlight colours; a tag keeps one colour across a document and a new tag takes the next free one.

## How it works

```
pdfpin (CLI) ──HTTP──▶ daemon on 127.0.0.1 ──SSE──▶ viewer (pdf.js in Chrome/Edge app mode or your browser)
                        ├─ text index per page (pdf.js in Node; same items as the viewer's text layer)
                        ├─ matcher: normalisation + exact/fuzzy search → {item, char} anchors
                        └─ store: ~/.pdfpin/docs/<id>.json  (override with PDFPIN_HOME)
```

Quotes are matched against the page text after normalisation (case, whitespace, ligatures,
curly quotes, end-of-line hyphenation), falling back to an approximate match with a bounded
edit distance. The viewer turns anchors into exact glyph rectangles through the text layer.

Environment: `PDFPIN_HOME` (data dir), `PDFPIN_PORT` (daemon port, default 47831),
`PDFPIN_BROWSER=browser` or `pdfpin open --in-browser` (default browser instead of an app-mode window),
`PDFPIN_CHROME=/path/to/chrome`.

## Develop

```bash
npm test                  # node --test
node bin/pdfpin.js open some.pdf
```
