import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Builds a small two-page PDF with known text and returns its path. */
export async function makeFixturePdf(dir) {
  const doc = await PDFDocument.create();
  doc.setTitle('Fixture Paper');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('Hello World', { x: 72, y: 700, size: 12, font });
  p1.drawText('Second line of text', { x: 72, y: 680, size: 12, font });
  p1.drawText('Eclipser achieved higher code coverage than KLEE.', { x: 72, y: 640, size: 10, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('Page two mentions fuzzing twice: fuzzing.', { x: 72, y: 700, size: 12, font });
  const bytes = await doc.save();
  const out = path.join(dir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpin-'))), 'fixture.pdf');
  await fs.writeFile(out, bytes);
  return out;
}
