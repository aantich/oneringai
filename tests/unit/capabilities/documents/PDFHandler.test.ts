/**
 * PDFHandler — live round-trip regression test.
 *
 * Why this exists: PDFHandler explicitly copies the input buffer on every
 * unpdf call because pdf.js detaches the underlying ArrayBuffer when posting
 * to a worker. The Buffer→File refactor (eliminating `new Uint8Array(buf)`
 * wrappers in upload providers) deliberately did NOT touch PDFHandler — but
 * we want a permanent guard so any future "cleanup" PR that drops the
 * `copyBuffer` call (or that touches Buffer handling generally) gets caught.
 *
 * Strategy: build a minimal valid PDF in memory, run it through
 * `PDFHandler.handle` twice with the SAME source buffer, assert text comes
 * back both times. If the buffer's underlying ArrayBuffer were detached on
 * the first call, round 2 would either throw or return an empty page.
 */

import { describe, it, expect } from 'vitest';
import { PDFHandler } from '../../../../src/capabilities/documents/handlers/PDFHandler.js';
import type { DocumentReadOptions } from '../../../../src/capabilities/documents/types.js';

const defaultOptions: DocumentReadOptions = {};

/**
 * Hand-build a minimal valid PDF whose single page renders the literal text.
 * Object byte-offsets are computed at runtime so the xref table is correct.
 */
function buildMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects: Array<{ num: number; body: string }> = [
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      num: 3,
      body:
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    },
    { num: 4, body: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream` },
    { num: 5, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ];

  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  let body = header;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += `${obj.num} 0 obj\n${obj.body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'binary');

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'binary');
}

describe('PDFHandler — live unpdf round-trip', () => {
  it('extracts text from a freshly built PDF buffer', async () => {
    const handler = new PDFHandler();
    const pdfBuffer = buildMinimalPdf('Hello PDFHandler refactor');

    const pieces = await handler.handle(pdfBuffer, 'minimal.pdf', 'pdf', defaultOptions);

    expect(pieces.length).toBeGreaterThan(0);
    const allText = pieces
      .map((p) => (p.type === 'text' ? p.content : ''))
      .join('\n');
    expect(allText).toContain('Hello PDFHandler refactor');
  });

  it('extracts the same text from the SAME buffer twice (no detach regression)', async () => {
    // Regression guard: if PDFHandler.copyBuffer() ever stops copying, unpdf
    // detaches the ArrayBuffer on the first call and round 2 fails.
    const handler = new PDFHandler();
    const pdfBuffer = buildMinimalPdf('Round trip stability');

    const round1 = await handler.handle(pdfBuffer, 'doc.pdf', 'pdf', defaultOptions);
    const round2 = await handler.handle(pdfBuffer, 'doc.pdf', 'pdf', defaultOptions);

    expect(round1.length).toBeGreaterThan(0);
    expect(round2.length).toBeGreaterThan(0);

    const text1 = round1.map((p) => (p.type === 'text' ? p.content : '')).join('\n');
    const text2 = round2.map((p) => (p.type === 'text' ? p.content : '')).join('\n');
    expect(text1).toContain('Round trip stability');
    expect(text2).toBe(text1);

    // Sanity: the original buffer should still be readable / non-detached.
    // (Buffer is fine; what we're really checking is that our test fixture
    // was not damaged out from under us.)
    expect(pdfBuffer.length).toBeGreaterThan(0);
    expect(pdfBuffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
