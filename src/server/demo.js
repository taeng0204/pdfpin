// A one-page paper written for the guided tour. Made here rather than shipped so every sentence is
// ours: the tour's quotes always match, and no one else's work is bundled with the app.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const TITLE = 'pdfpin: Reading a Paper Alongside an AI Agent';
const AUTHORS = 'T. Lim';
const AFFILIATION = '';

const BODY = [
  ['h', 'Abstract'],
  ['p', 'pdfpin is a PDF reader with a command line attached. An AI agent reads the text of a paper, marks the passages that answer your question, and writes a short note on each one. You read those marks in the paper itself, rather than in a chat window that has lost sight of the page.'],
  ['h', '1.  How the marking works'],
  ['p', 'The agent never sees the page as an image. It asks for the page text, quotes a sentence back, and pdfpin finds that sentence in the document and draws the marker over it.'],
  ['p', 'Matching ignores case, line breaks and end-of-line hyphenation, and it forgives small typos, so a quote copied by hand still lands where it should. A quote that spans two pages does not resolve, so the agent splits it and marks each half.'],
  ['h', '2.  Sessions, tags and colour'],
  ['p', 'One question makes one session: a title, a short overview of what was found, and the highlights that support it. The panel stacks sessions newest first, so a paper slowly collects a record of everything you asked about it.'],
  ['p', 'Every highlight carries a tag, and colour follows the tag, so one topic keeps one colour across the whole paper. You can tag your own highlights with the same words the agent used.'],
  ['h', '3.  Where the work lives'],
  ['p', 'Nothing leaves your machine. The daemon listens on loopback only, and your notes sit in plain JSON beside the path of the PDF they belong to. When you want to hand the reading to someone else, export a session as an annotated PDF or as Markdown.'],
];

/** The sentences the tour highlights. Kept beside the text so the two cannot drift apart. */
export const DEMO_QUOTES = [
  'The agent never sees the page as an image',
  'Matching ignores case, line breaks and end-of-line hyphenation',
  'A quote that spans two pages does not resolve',
  'The daemon listens on loopback only',
];

export const DEMO_FILENAME = 'pdfpin-intro.pdf';

const PAGE = { w: 595, h: 842 };            // A4 in points
const MARGIN = 72;
const WIDTH = PAGE.w - MARGIN * 2;

function wrap(text, font, size) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > WIDTH && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Write the demo paper into `dir` and return its path. */
export async function buildDemoPdf(dir) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('pdfpin: Reading a Paper Alongside an AI Agent');
  pdf.setAuthor('T. Lim');
  const body = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const page = pdf.addPage([PAGE.w, PAGE.h]);

  let y = PAGE.h - MARGIN;
  const draw = (text, font, size, { gap = 4, centre = false, colour = rgb(0.1, 0.1, 0.1) } = {}) => {
    for (const line of wrap(text, font, size)) {
      const x = centre ? (PAGE.w - font.widthOfTextAtSize(line, size)) / 2 : MARGIN;
      y -= size + gap;
      page.drawText(line, { x, y, size, font, color: colour });
    }
  };

  draw(TITLE, bold, 17, { gap: 6, centre: true });
  y -= 6;
  draw(AUTHORS, body, 11, { gap: 3, centre: true });
  if (AFFILIATION) draw(AFFILIATION, italic, 10, { gap: 3, centre: true });
  y -= 14;
  for (const [kind, text] of BODY) {
    if (kind === 'h') { y -= 10; draw(text, bold, 12, { gap: 4 }); y -= 2; } else { draw(text, body, 11, { gap: 5 }); y -= 6; }
  }

  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, DEMO_FILENAME);
  await fs.writeFile(file, await pdf.save());
  return file;
}
