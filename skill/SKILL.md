---
name: pdfpin
description: Highlight passages in a PDF and attach explanations that a human reads in the pdfpin viewer. Use when asked to find evidence, cite passages, review or annotate a paper/PDF, or when the user says "pdfpin", "highlight in the PDF", "mark the evidence", "show me where it says".
---

# pdfpin — pin highlights and notes onto a PDF

`pdfpin` is a CLI plus a local viewer. You (the agent) read the PDF text with the CLI, then
add highlights with short notes; the human sees them live in the viewer's side panel.

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
3. Add highlights. One per passage, or a batch in one call:
   ```bash
   pdfpin add --text "exact sentence or phrase from the PDF" --note "Why it matters (Markdown)" --tag "claim-1" --color green
   pdfpin add --json '[{"text":"...","note":"...","page":4,"color":"green","tag":"claim-1"},{"text":"...","note":"..."}]'
   ```
4. Summarise your finding at the top of the panel:
   ```bash
   pdfpin summary --title "Evidence for X" --body "Three passages support X:\n- ...\n- ..."
   ```
5. Optionally point the reader somewhere: `pdfpin focus <annotation id>` or `pdfpin focus --page 4`.

## Rules

- Quote text **exactly as printed in `pdfpin text`** (5–300 characters, one page at a time; split quotes that cross pages).
  Case, whitespace and end-of-line hyphenation do not matter; small typos are tolerated.
- Exit code 2 = text not found. The output lists up to three nearby candidates with page numbers; retry with one of them.
- The same phrase can occur several times: pass `--page N`, or `--all` to highlight every occurrence.
- Notes: short, specific, Markdown subset (`**bold**`, `*italic*`, `` `code` ``, `- lists`, links). Say *why* the passage matters for the question.
- Use `--tag` per question/claim and a consistent colour per tag. Colours: yellow (default), green, blue, pink, purple, orange.
- Before answering a new question on the same PDF, either keep old tags (the reader can filter) or `pdfpin clear --tag <old>`.
- `pdfpin list` shows what is already there; `pdfpin rm <id>` / `pdfpin note <id> --note "..."` fix mistakes.
- `pdfpin export` writes `<name>.annotated.pdf` with real PDF highlight annotations; `--format md` writes a Markdown report.
- Every command accepts `-d <id|path|file name>` to target a document that is not the current one.

Run `pdfpin guide` for the full command reference.
