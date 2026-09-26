export const GUIDE = `pdfpin — highlight and annotate a PDF from the command line (for AI agents and humans)

WORKFLOW (typical "find the evidence for X in this paper" task)
  1. pdfpin open paper.pdf                 # starts the viewer; the file becomes the *current* document
  2. pdfpin text                           # read the whole paper (or: pdfpin text -p 3-5)
  3. pdfpin add --text "<exact quote>" --note "<why this supports X>" [--page N] [--color green] [--tag "X"]
     ... one call per passage, or a single batch call:
     pdfpin add --json '[{"text":"...","note":"...","page":4,"color":"green"},{"text":"...","note":"..."}]'
  4. pdfpin summary --title "Evidence for X" --body "3 passages support X: ..."   # shown at the top of the side panel
  5. pdfpin focus <annotation id>          # scroll the viewer to a highlight (optional)

RULES OF THUMB
  • Quote text exactly as it appears in \`pdfpin text\` (a sentence or a phrase, 5–300 characters). Matching is
    case-/whitespace-insensitive, ignores line-break hyphenation and tolerates small typos.
  • Quotes cannot cross a page boundary: split them.
  • If a quote is not found you get exit code 2 and up to three nearby candidates; retry with one of them.
  • Prefer --page when the same phrase occurs several times; --all highlights every occurrence.
  • Notes render a small Markdown subset (**bold**, *italic*, \`code\`, lists, links, line breaks). Keep them short.
  • Use --tag to group highlights per question (e.g. --tag "claim-1"); the viewer can filter by tag.
  • --color: yellow (default), green, blue, pink, purple, orange. A consistent colour per tag helps readers.

COMMANDS
  open <file.pdf> [--no-browser] [--in-browser]  open a PDF (auto-starts the daemon; app window or default browser)
  text [-p 1-3,7] [--json]                       page text with "=== Page N ===" markers
  find <query> [-p N] [--json]                   locate a phrase: page, score, context
  add --text "…" --note "…" [-p N] [--color c] [--tag t] [--title "…"] [--all]
  add --json '<array|object>' | --from f.json | --stdin
  list [--json] [--tag t]                        annotations of the current document
  note <id> [--note …] [--color …] [--tag …] [--title …]
  rm <id…> | clear [--tag t]
  summary --title "…" --body "…" | --clear
  focus <id> | --page N
  export [--out path] [--format pdf|md]          annotated PDF (real highlight annotations) or Markdown
  docs | status | stop | guide
  All commands accept -d/--doc <id|path|file name> to target a document other than the current one.
`;
