/**
 * OfficeHandler — Meteor/webpack compatibility patch test
 *
 * This test pins the monkey-patch in OfficeHandler.ts that overrides
 * officeparser's loadFileType. The patch is fragile by nature (it
 * reaches into officeparser's internal `dist/utils/moduleLoader.js`),
 * so this test must run after every officeparser version bump.
 *
 * If this test fails after an officeparser bump, see the comment block
 * at the top of `src/capabilities/documents/handlers/OfficeHandler.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { OfficeHandler } from '../../../../src/capabilities/documents/handlers/OfficeHandler.js';

const requireCjs = createRequire(import.meta.url);

const REPO_PPTX = resolve(__dirname, '../../../../docs/architecture.pptx');

describe('OfficeHandler — officeparser internal layout', () => {
  it('officeparser still exposes loadFileType at the patched path', () => {
    const officeparserMain = requireCjs.resolve('officeparser');
    const moduleLoaderPath = join(dirname(officeparserMain), 'utils', 'moduleLoader.js');
    expect(existsSync(moduleLoaderPath)).toBe(true);
    const moduleLoader = requireCjs(moduleLoaderPath);
    expect(typeof moduleLoader.loadFileType).toBe('function');
  });
});

describe('OfficeHandler — pptx parsing with patch', () => {
  const handler = new OfficeHandler();

  // Skip if the repo sample isn't present (e.g. published-package consumer)
  if (!existsSync(REPO_PPTX)) {
    it.skip('architecture.pptx not found — skipping integration check', () => undefined);
    return;
  }

  it('parses a real .pptx Buffer (no path) end-to-end', async () => {
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
