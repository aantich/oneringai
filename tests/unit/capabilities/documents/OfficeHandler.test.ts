/**
 * OfficeHandler — temp-file workaround test
 *
 * OfficeHandler writes the input Buffer to a temp file with the correct
 * extension before calling officeparser. This avoids officeparser's
 * magic-byte detection path, which breaks inside Meteor server bundles
 * (the `new Function('s', 'return import(s)')` trick fails because V8
 * has no host dynamic-import callback registered for that scope).
 *
 * This test pins the end-to-end behavior against a real .pptx so we
 * notice if a future officeparser bump changes the path-string code
 * path. Run after every officeparser version bump.
 *
 * See the comment block at the top of
 * `src/capabilities/documents/handlers/OfficeHandler.ts` for full
 * context.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { OfficeHandler } from '../../../../src/capabilities/documents/handlers/OfficeHandler.js';

const REPO_PPTX = resolve(__dirname, '../../../../docs/architecture.pptx');

describe('OfficeHandler — pptx parsing via temp file', () => {
  const handler = new OfficeHandler();

  // Skip if the repo sample isn't present (e.g. published-package consumer)
  if (!existsSync(REPO_PPTX)) {
    it.skip('architecture.pptx not found — skipping integration check', () => undefined);
    return;
  }

  it('parses a real .pptx Buffer end-to-end', async () => {
    const buffer = readFileSync(REPO_PPTX);
    const pieces = await handler.handle(buffer, 'architecture.pptx', 'pptx', {});

    // Must produce at least one text piece
    const textPieces = pieces.filter((p) => p.type === 'text');
    expect(textPieces.length).toBeGreaterThan(0);

    // Slides should be partitioned (we know architecture.pptx has multiple)
    const slidePieces = textPieces.filter((p) => p.metadata.section?.startsWith('Slide '));
    expect(slidePieces.length).toBeGreaterThan(0);

    // Sanity: extracted text is non-empty and looks like real content
    const allText = textPieces
      .map((p) => (p.type === 'text' ? p.content : ''))
      .join('\n')
      .trim();
    expect(allText.length).toBeGreaterThan(20);
  });
});
