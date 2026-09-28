// A one-page paper written for the guided tour. Made here rather than shipped so every sentence is
// ours: the tour's quotes always match, and no one else's work is bundled with the app.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const TITLE = 'Warm Starts: Reusing Partial Results in Batch Pipelines';
const AUTHORS = 'A. Rivera    M. Okonkwo    S. Lindqvist';
const AFFILIATION = 'Institute for Applied Computing';

const BODY = [
  ['h', 'Abstract'],
  ['p', 'Batch pipelines recompute the same intermediate results every run. We present Warm Starts, a scheduler that keeps those results and reuses them when the inputs have not changed. Warm Starts needs no change to pipeline code.'],
  ['h', '1.  Evaluation'],
  ['p', 'We measured Warm Starts on a benchmark of 40 production pipelines drawn from three organisations. Each pipeline was run twice: once cold, once with a warm cache.'],
  ['p', 'Warm Starts reduced median wall-clock time by 31% across the benchmark. The gain came almost entirely from skipping recomputation; scheduling overhead stayed under one second per run.'],
  ['p', 'The saving is not free. Peak memory rose by 8% because partial results stay resident between stages, and the cache added 4.2 GB to the working set of the largest pipeline.'],
  ['h', '2.  Limitations'],
  ['p', 'Warm Starts assumes that inputs are content-addressed. Pipelines that read mutable paths fall back to a full recomputation, so deployments without content addressing see no benefit at all.'],
  ['p', 'We also did not measure pipelines shorter than ten seconds, where the bookkeeping is likely to cost more than it saves.'],
];

/** The sentences the tour highlights. Kept beside the text so the two cannot drift apart. */
export const DEMO_QUOTES = [
  'a benchmark of 40 production pipelines',
  'reduced median wall-clock time by 31%',
  'Peak memory rose by 8%',
  'Pipelines that read mutable paths fall back to a full recomputation',
];

export const DEMO_FILENAME = 'warm-starts.pdf';

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
  pdf.setTitle('Warm Starts');
  pdf.setAuthor('pdfpin demo');
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
  draw(AFFILIATION, italic, 10, { gap: 3, centre: true });
  y -= 14;
  for (const [kind, text] of BODY) {
    if (kind === 'h') { y -= 10; draw(text, bold, 12, { gap: 4 }); y -= 2; } else { draw(text, body, 11, { gap: 5 }); y -= 6; }
  }

  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, DEMO_FILENAME);
  await fs.writeFile(file, await pdf.save());
  return file;
}
