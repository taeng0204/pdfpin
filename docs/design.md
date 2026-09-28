# How pdfpin is put together

This is the shape of the system and the reasoning behind the parts that are not obvious.
`README.md` covers what it does; this covers why it is built this way.

## The pieces

```
pdfpin (CLI)  ──HTTP──▶  daemon on 127.0.0.1  ──SSE──▶  viewer (pdf.js in a browser window)
                          ├─ store      documents, sessions, highlights, settings (JSON on disk)
                          ├─ pdftext    page text and geometry, from pdf.js running in Node
                          ├─ matcher    normalisation + exact/fuzzy search over page text
                          └─ export     annotated PDF (pdf-lib) and Markdown
```

One language, no native build step, no bundler. The viewer is plain ES modules served straight
from `src/web`, so what you read in the repository is what runs in the browser.

## Why a daemon instead of an app

An agent needs a command it can run and a window a person can watch, and those two things outlive
each other. A background daemon owns the state; the CLI and the viewer are both clients of it. That
is also what makes a highlight appear in the window the instant the agent adds it, with no polling.

It binds to loopback only and refuses requests whose `Host` header is not loopback, so nothing on
the network can reach it. Writes must arrive as `application/json`, which a cross-origin form cannot
send without a preflight. A lock file in the data directory stops a second daemon from running on
the same documents.

## Why not Electron

Packaging for two operating systems and a two-hundred-megabyte download is a poor trade for a tool
you install with one command, and the agent needs the CLI either way. The viewer is an ordinary web
page, so an Electron shell can be laid on top later without touching the daemon.

## How a quote becomes a highlight

The agent quotes a sentence; the daemon has to find it. Both sides work from the same page text,
built from the same pdf.js text items the browser lays out, so offsets line up exactly
(`src/shared/pagetext.js`).

Matching normalises case, whitespace, ligatures, curly quotes and end-of-line hyphenation, then
looks for an exact substring. Failing that it runs an approximate search with a bounded edit
distance, so a quote typed from memory still lands. A match resolves to `{item, char}` anchors
rather than to pixels, which survives zooming and re-rendering.

The daemon computes approximate rectangles from text-item geometry. When the page is on screen the
viewer measures the real glyph boxes with a DOM `Range` and sends them back, so the marker sits on
the words rather than near them.

## What is kept, and where

`~/.pdfpin` (or `PDFPIN_HOME`): one JSON file per document, plus `settings.json`, `server.json`
and the daemon lock. A document record holds its sessions and its highlights. Colours are stored on
each highlight but derived from a rule, and a highlight remembers whether its colour was derived or
chosen, so changing the rule never overwrites a colour someone picked on purpose.

A document file that cannot be parsed is renamed aside rather than replaced, so a damaged file never
costs you the notes inside it.

## Speed

Canvases, embedded fonts and DOM text layers are built only for pages near the viewport and released
when they scroll away. Search runs on the page index, which needs no DOM, and measures glyph boxes
only for pages that are currently laid out. A long PDF therefore opens about as fast as a short one.
