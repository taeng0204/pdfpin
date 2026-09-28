export const GUIDE = `pdfpin — highlight and annotate a PDF from the command line (for AI agents and humans)

MODEL
  A *session* is one interaction: the question or purpose (title), an overview of what you found (flow),
  and the highlights you marked, each with its own note. The viewer shows sessions newest-first as the
  document's history; older sessions collapse. Highlights without a session are the reader's own.

WORKFLOW (typical "find the evidence for X in this paper" task)
  1. pdfpin open paper.pdf                 # starts the viewer; the file becomes the *current* document
  2. pdfpin text                           # read the whole paper (or: pdfpin text -p 3-5)
  3. pdfpin mark --json '{
       "title": "Evidence that Eclipser beats KLEE",
       "flow": "Two lines of evidence: coverage (1) and bugs found (2). Caveat: no SMT solver, see (3).",
       "highlights": [
         {"text": "<exact quote>", "note": "why it matters", "color": "green", "tag": "coverage"},
         {"text": "<exact quote>", "note": "…", "color": "pink", "tag": "bugs", "page": 2}
       ]}'
     → one structured call creates the session and its highlights; failed quotes are listed with candidates.
  4. pdfpin add --text "<quote>" --note "…"     # more highlights attach to the latest session
     pdfpin session update --flow "…"           # refine the overview after reading more
  5. pdfpin focus <annotation id> | --session <id>   # scroll the reader to it (optional)

RULES OF THUMB
  • Quote text exactly as it appears in \`pdfpin text\` (a sentence or a phrase, 5–300 characters). Matching is
    case-/whitespace-insensitive, ignores line-break hyphenation and tolerates small typos.
  • Quotes cannot cross a page boundary: split them.
  • Exit code 2 = something was not found; the output lists up to three nearby candidates. Retry with one.
  • Prefer --page when the same phrase occurs several times; --all highlights every occurrence.
  • Notes render a small Markdown subset (**bold**, *italic*, \`code\`, lists, links, line breaks). Keep them short.
  • Colour is decided for you: by tag (the default) or by session, whichever the reader chose in the viewer.
    Pass --color only when a highlight must keep one particular colour; it is then never repainted.
    Palette: yellow, green, blue, pink, purple, orange, teal, red, cyan, lime, indigo, grape.
  • Refer to highlights from the flow by tag or by number (1), (2)…
  • One question → one session. Start a new session for a new question instead of clearing old ones.

COMMANDS
  open <file.pdf> [--no-browser] [--in-browser]  open a PDF (auto-starts the daemon; app window or default browser)
  text [-p 1-3,7] [--json]                       page text with "=== Page N ===" markers
  find <query> [-p N] [--json]                   locate a phrase: page, score, context
  mark --json '{title, flow, highlights:[…]}' | --from f.json | --stdin   session + highlights in one call
  add --text "…" --note "…" [-p N] [--color c] [--tag t] [--title "…"] [--all] [-s <session>|--no-session]
  add --json '<array|object>' | --from f.json | --stdin
  session start --title "…" [--flow "…"] | update [id] --title/--flow | list | use <id|none> | rm <id>
  list [--json] [--tag t] [-s <session>]         sessions and their highlights
  note <id> [--note …] [--color …] [--tag …] [--title …]   (giving --tag makes the colour follow that tag)
  tags [list] | tags rename <from> <to> | tags color <tag> <color|auto> | tags rm <tag>
  rm <id…> | clear [--tag t]
  focus <id> | --page N | --session <id>
  export [--out path] [--format pdf|md]          annotated PDF (real highlight annotations) or Markdown by session
  settings [key=value...] [--reset]              language, theme, palette and shortcuts (shared by every viewer)
  docs | status | stop | guide
  All commands accept -d/--doc <id|path|file name> to target a document other than the current one.
`;
