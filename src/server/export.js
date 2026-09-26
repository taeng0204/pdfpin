// Export: real /Highlight annotations into a copy of the PDF (pdf-lib), or a Markdown report.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFName, PDFArray, PDFHexString, PDFString } from 'pdf-lib';
import { ApiError } from './docs.js';
import { getPageIndex, toPdfRect } from './pdftext.js';

const PALETTE = { yellow: '#FFE066', green: '#8CE99A', blue: '#74C0FC', pink: '#FAA2C1', purple: '#B197FC', orange: '#FFC078' };

const rgb = (name) => {
  const hex = PALETTE[name] || PALETTE.yellow;
  return [1, 3, 5].map((i) => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4));
};

/** ISO date → PDF date string (D:YYYYMMDDHHmmSSZ); undefined when unparsable. Plain strings become names in ctx.obj, hence PDFString. */
const pdfDate = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : PDFString.of(`D:${new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`);
};

const defaultOut = (doc, suffix) => path.join(path.dirname(doc.path), path.basename(doc.path, path.extname(doc.path)) + suffix);

export async function exportDocument(docManager, doc, { out, format = 'pdf' } = {}) {
  const writers = { pdf: exportPdf, md: exportMarkdown };
  const write = writers[format];
  if (!write) throw new ApiError(400, `Unknown export format "${format}". Use one of: ${Object.keys(writers).join(', ')}`);
  const fresh = docManager.store.get(doc.id) || doc;
  const target = path.resolve(out || defaultOut(fresh, format === 'pdf' ? '.annotated.pdf' : '.annotations.md'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const count = await write(docManager, fresh, target);
  return { path: target, count, format };
}

async function exportPdf(docManager, doc, target) {
  const pdfDoc = await PDFDocument.load(await fs.readFile(doc.path), { ignoreEncryption: true });
  const source = await docManager.pdf(doc);
  const ctx = pdfDoc.context;
  let count = 0;
  for (const a of doc.annotations) {
    if (!a.rects?.length || a.page < 1 || a.page > pdfDoc.getPageCount()) continue;
    const index = await getPageIndex(source, a.page);
    const boxes = a.rects.map((r) => toPdfRect(index, r));
    // QuadPoints per rect: upper-left, upper-right, lower-left, lower-right (what Acrobat and pdf.js expect).
    const quad = boxes.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1]);
    const rect = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
    const text = (a.title ? `${a.title}\n\n` : '') + (a.note || '');
    const annot = ctx.obj({
      Type: 'Annot', Subtype: 'Highlight', F: 4, CA: 0.9,
      Rect: rect, QuadPoints: quad, C: rgb(a.color),
      Contents: PDFHexString.fromText(text), T: PDFHexString.fromText(a.tag || 'pdfpin'),
      M: pdfDate(a.updatedAt), CreationDate: pdfDate(a.createdAt),
    });
    annotsOf(pdfDoc.getPage(a.page - 1)).push(ctx.register(annot));
    count++;
  }
  await fs.writeFile(target, await pdfDoc.save());
  return count;
}

/** The page's Annots array (resolving an indirect reference), created when missing. */
function annotsOf(page) {
  const key = PDFName.of('Annots');
  let arr = page.node.lookupMaybe(key, PDFArray);
  if (!arr) {
    arr = page.doc.context.obj([]);
    page.node.set(key, arr);
  }
  return arr;
}

async function exportMarkdown(_docManager, doc, target) {
  const lines = [`# ${doc.title}`, '', `Source: \`${doc.path}\``, ''];
  if (doc.summary && (doc.summary.title || doc.summary.body)) {
    if (doc.summary.title) lines.push(`## ${doc.summary.title}`, '');
    if (doc.summary.body) lines.push(doc.summary.body, '');
  }
  const byPage = new Map();
  for (const a of doc.annotations) {
    if (!byPage.has(a.page)) byPage.set(a.page, []);
    byPage.get(a.page).push(a);
  }
  for (const page of [...byPage.keys()].sort((x, y) => x - y)) {
    lines.push(`## Page ${page}`, '');
    for (const a of byPage.get(page)) {
      if (a.quote) lines.push(a.quote.split('\n').map((l) => `> ${l}`).join('\n'), '');
      if (a.title) lines.push(`**${a.title}**`, '');
      if (a.note) lines.push(a.note, '');
      lines.push(`_${[a.color, a.tag && `#${a.tag}`, a.id].filter(Boolean).join(' · ')}_`, '');
    }
  }
  await fs.writeFile(target, lines.join('\n'));
  return doc.annotations.length;
}
