<img src="https://raw.githubusercontent.com/taeng0204/pdfpin/main/docs/images/logo.png" alt="pdfpin" width="180">

A PDF viewer your agent can highlight in.

You ask a question. The agent marks the passages that answer it and writes a short note on each
one. Any PDF with a text layer works, not only papers, and you get there from the agent you are
already using.

![The viewer: a paper on the left, the agent's answer on the right](https://raw.githubusercontent.com/taeng0204/pdfpin/main/docs/images/viewer-light.png)

Nothing leaves your machine. The daemon listens on loopback only and your notes sit in plain JSON
beside the path of the PDF they belong to.

## Install

Node 22.13 or newer, on macOS, Windows or Linux. No native build step.
pdf.js 6 sets that floor; nothing else here needs it.

```bash
npm install -g @taeng0204/pdfpin
pdfpin open paper.pdf
```

Or from a clone, which is also how you work on it:

```bash
npm install && npm install -g .
```

A guided tour runs the first time. It writes a one-page demo paper, asks it two questions through
the same API an agent uses, and hands the last two steps to you. Re-run it from settings any time.

Installing globally also puts the agent skill in place, which is what lets an agent drive pdfpin
at all. Claude Code and Codex read the same skill format, so one file goes to
`~/.claude/skills/pdfpin/` and `~/.codex/skills/pdfpin/` — only for the agents you actually have —
and both pick it up on their next run with nothing to configure. `PDFPIN_NO_SKILL=1 npm install -g .`
skips it, and so does npm when it declines to run install scripts — in that case the first
`pdfpin open` says so. `pdfpin skill` shows where it landed, `pdfpin skill install` adds or updates one
(`--claude` or `--codex` for a single agent), and `pdfpin skill remove` takes it out again. A copy
you edited yourself is never replaced without `--force`.

Then just ask: *"find the evidence in this paper for X and highlight it."*

## What an agent does

Read the page text, quote from it, attach a note. One question becomes one session.

```bash
pdfpin open paper.pdf
pdfpin text -p 1-3
pdfpin mark --json '{
  "title": "What evidence backs the speed-up claim?",
  "flow": "Two numbers carry it: the benchmark (1) and the median saving (2). The cost is in (3).",
  "highlights": [
    {"text": "a benchmark of 40 production pipelines", "note": "What it was measured on.", "tag": "setup"},
    {"text": "reduced median wall-clock time by 31%",  "note": "The headline number.",      "tag": "result"}
  ]}'
```

Quote exactly what `pdfpin text` printed. Matching forgives case, whitespace, end-of-line
hyphenation and small typos; a quote that spans two pages does not resolve, so split it. When a
quote is not found the command exits with status 2 and prints the nearest candidates.

A scanned PDF has no text to quote. pdfpin says so rather than pretending the quote was wrong; run
the file through OCR first.

`pdfpin guide` prints the full command reference.

## What you do

| | |
|---|---|
| `⌘D` / `Ctrl+D` | documents: open a PDF, switch between them |
| `⌘E` / `Ctrl+E` | the notes panel |
| `⌘,` / `Ctrl+,` | settings: language, theme, colours, shortcuts |
| `o` | open a PDF through your system's file chooser |
| `←` `→` | turn a page |
| `n` `p` | step through highlights |
| `⌘F` / `Ctrl+F` | search the document |
| `d` · `h` | theme · show or hide highlights |

Every shortcut is rebindable, and settings live on the daemon so all your windows agree.

Click a note to jump to it; click a highlight to read its note. Drag across a sentence to add your
own, and tag it with one of the agent's tags to join that topic. Sessions stack newest first, so a
paper collects a record of everything you asked about it. Old sessions archive rather than delete.

Colour follows the tag, or the session if you prefer one colour per question. A colour the agent
asked for by name is never repainted. The tag manager renames a tag everywhere, recolours it, or
takes it off its highlights.

Export a session as an annotated PDF with real highlight annotations, or as Markdown.

The viewer is an ordinary page served from your own machine, so a browser can install it as an
app: open `http://127.0.0.1:47831` in a tab and use the browser's install button. That gives you
pdfpin's icon in the Dock or the Start menu, and a window that comes forward when you click it.
It is optional. An installed window needs the daemon to be running already, while `pdfpin open`
starts one and opens a window itself. `PDFPIN_PORT` changes the address it points at.

On macOS there is also a real launcher. `pdfpin app install` builds `pdfpin.app` into
`~/Applications`, using only tools macOS already has. Unlike the browser's install it starts the
daemon itself, so clicking it from the Dock works from cold, and it registers for PDFs: double-click
one, or right-click → Open With → pdfpin, and that file opens in the viewer. It does not make itself
the default PDF application. `pdfpin app` says whether it is installed and `pdfpin app remove` takes
it out again; a bundle pdfpin did not write is reported, never replaced without `--force`.

Updating pdfpin rebuilds a launcher that is already there, the way it already refreshes the agent
skill, so `npm install -g @taeng0204/pdfpin` is the whole update and nothing is left pointing at the
version before it. It never installs one you did not ask for; `PDFPIN_NO_APP=1` opts out of the
rebuild as `PDFPIN_NO_SKILL=1` does for the skill.

## Where things live

`~/.pdfpin` holds one JSON file per document plus your settings; `PDFPIN_HOME` moves it. Other
environment variables: `PDFPIN_PORT` (default 47831), `PDFPIN_BROWSER=browser` to use your default
browser instead of an app-mode window, `PDFPIN_CHROME` to point at a specific Chromium.

`docs/design.md` explains how a quote becomes a highlight, and why the pieces are arranged this way.

## Develop

```bash
npm test
node bin/pdfpin.js open some.pdf
```

MIT licensed.
