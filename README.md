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
pdfpin tags                                 # every tag with its count and colour
pdfpin tags rename claim evidence · tags color evidence lime · tags rm evidence
pdfpin settings                             # language, theme, palette, shortcuts
pdfpin settings language=ko keys.history=mod+e
pdfpin status · pdfpin stop
```

## Viewer

- Live updates: highlights and notes appear as the agent adds them (toast + card).
- Side panel: sessions newest-first (title, overview, highlights grouped by tag/colour with notes);
  older sessions collapse into the document's history. Filter by text / tag / colour, focus one session,
  inline edit, copy a note as a Markdown citation, copy everything, export.
- Hover a highlight for a popover with the note; click to select; `n`/`p` step through notes.
- Highlight rail: a minimap of every highlight along the right edge, beside the scrollbar. Click a tick
  to jump to it. It hides itself when the document has no highlights.
- Search in the document (`⌘/Ctrl+F`), zoom (`⌘/Ctrl +/−/0`, ctrl+wheel), fit width / fit page.
- Select text on a page → floating toolbar → highlight in a colour, optionally with a note.
- Light / dark theme (`d`) or follow the system, dimmed pages in dark mode, hide highlights (`h`).
  The theme switches instantly: the page bitmaps are dimmed with a canvas filter that cannot fade
  cheaply, so fading the surfaces around them only made the gutter lag behind the pages.
- Pages render, load their fonts and build their text layers only near the viewport, so a long PDF
  opens as fast as a short one. Search runs on the page index rather than on the DOM.
- `←` / `→` turn one page; `n` / `p` step through highlights.
- Settings sheet at `⌘,` / `Ctrl+,`: language (English or 한국어), theme, opening zoom, which colours
  the palette uses, and every shortcut. Settings live on the daemon, so all windows and the CLI agree.
- History panel at `⌘J` / `Ctrl+J` and Documents drawer at `⌘D` / `Ctrl+D`, both rebindable.
- Documents drawer (`⌘D`, `l`, or the library button): every PDF opened so far with its note count, tags and
  latest session; click one to open it instantly (it also becomes the CLI's current document).
- Twelve highlight colours. Colour follows the tag by default, or the session if you prefer one colour
  per question (`⌘,` → Colour highlights by). Click the dot beside a group to repaint that tag or session;
  a colour the agent asked for by name is never repainted.
- Tags are shared between the agent and you. Type a tag into any highlight's note editor, or pick one of
  the document's tags straight from the selection toolbar, and it takes that tag's colour. The tag manager
  in the panel header renames a tag everywhere (renaming onto an existing tag merges them), recolours it,
  or takes it off its highlights.

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
