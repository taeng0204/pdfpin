---
name: pdfpin
description: Highlight passages in a PDF and attach explanations that a human reads in the pdfpin viewer. Use when asked to find evidence, cite passages, review or annotate a paper/PDF, or when the user says "pdfpin", "highlight in the PDF", "mark the evidence", "show me where it says".
---

# pdfpin — pin highlights and notes onto a PDF

`pdfpin` is a CLI plus a local viewer. You (the agent) read the PDF text with the CLI, then mark
passages with short notes; the human sees them live in the viewer's side panel.

## Model

- A **session** = one interaction: `title` (the question or purpose), `flow` (your overview: what
  you found, how the pieces connect, caveats), and its **highlights**, each with a `note`.
- The side panel lists sessions newest-first as the document's history. Older sessions collapse.
- Highlights without a session belong to the reader (made by hand in the viewer).

## Workflow

1. Open the document (starts the daemon and the viewer window if needed):
   ```bash
   pdfpin open "paper.pdf"
   ```
2. Read the text. Quote from this output — matching is exact-first, then fuzzy:
   ```bash
   pdfpin text            # whole document, "=== Page N ===" markers
   pdfpin text -p 3-5     # a page range
   pdfpin find "phrase"   # page + context for a phrase
   ```
3. Mark in one structured call:
   ```bash
   pdfpin mark --json '{
     "title": "Evidence that the method beats the baseline",
     "flow": "Two lines of evidence: coverage (1) and bugs (2). Caveat: (3) shows the approximation.",
     "highlights": [
       {"text": "exact sentence from the PDF", "note": "Headline result, +8.6% coverage", "tag": "coverage"},
       {"text": "exact sentence from the PDF", "note": "40 bugs on 22 binaries", "tag": "bugs", "page": 2},
       {"text": "exact sentence from the PDF", "note": "Approximate constraints, no SMT", "tag": "caveat"}
     ]}'
   ```
   Output: the session id, one line per highlight, and `N added, M failed`. Failed quotes come with
   nearby candidates; fix them with `pdfpin add --session <id> --text "…" --note "…"`.
4. Refine if needed: `pdfpin session update --flow "…"`, `pdfpin note <id> --note "…"`, `pdfpin rm <id>`.
5. Optionally point the reader somewhere: `pdfpin focus --session <id>` or `pdfpin focus <annotation id>`.

## Rules

- Quote text **exactly as printed in `pdfpin text`** (5–300 characters, one page at a time; split quotes that cross pages).
  Case, whitespace and end-of-line hyphenation do not matter; small typos are tolerated.
- Read narrowly. `pdfpin find "phrase"` when you can guess the wording, `pdfpin text -p 4-6` for a
  section. Pushing a whole paper through `pdfpin text` spends the context you need for the notes.
- Check which document you are on before marking (`pdfpin docs`, or the header of `pdfpin list`).
  `pdfpin open` makes a document current, and every command takes `-d <id|path|file name>`.
- Exit code 2 = something was not found. The output lists up to three nearby candidates with page numbers; retry with one.
- If the reply says the PDF carries no text layer, stop retrying: it is a scan and no quote will ever match.
- The same phrase can occur several times: pass `"page": N`, or `"all": true` to highlight every occurrence.
- `flow` is the reader's overview: 2–5 sentences, refer to highlights by number (1), (2) or by tag. Notes: one or
  two sentences on *why* the passage matters. Markdown subset (`**bold**`, `*italic*`, `` `code` ``, `- lists`, links).
- One question → one session. Do not clear old sessions; the reader keeps them as history.
- **Leave the colour out.** The viewer colours highlights by tag (default) or by session, whichever the reader
  picked, and they can repaint any tag afterwards. Set `"color"` only when one highlight must keep a specific
  colour; that pins it. Palette: yellow, green, blue, pink, purple, orange, teal, red, cyan, lime, indigo, grape.
  So give every highlight a `tag` — that is what makes the colours mean something to the reader.
- Tags are shared with the reader: they can tag their own highlights with yours, rename a tag everywhere
  (`pdfpin tags rename <from> <to>`) or recolour it. Reuse a tag that already exists rather than inventing
  a near-duplicate; `pdfpin tags` lists what the document already uses.
- `pdfpin list` shows sessions and highlights; `pdfpin export` writes `<name>.annotated.pdf` with real PDF
  highlight annotations; `--format md` writes a Markdown report grouped by session.
- Every command accepts `-d <id|path|file name>` to target a document that is not the current one.

Run `pdfpin guide` for the full command reference.
