// Verify the officeparser temp-file workaround used by OfficeHandler.
//
// What this checks:
//   Passing a path string to officeparser's parseOffice() avoids the
//   magic-byte detection path that breaks under Meteor's server bundle.
//   This is what OfficeHandler does internally — it writes the input
//   Buffer to a temp file with the known extension, then calls
//   parseOffice with the path.
//
// Run after every officeparser version bump:
//   node scripts/verify-officeparser-patch.mjs
//
// See the comment block at the top of
// `src/capabilities/documents/handlers/OfficeHandler.ts` for full context.

import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOffice } from 'officeparser';

const PPTX = '/Users/aantich/dev/oneringai/docs/architecture.pptx';

const buf = await readFile(PPTX);
console.log('[verify] file size:', buf.length, 'bytes');

const tmpDir = await mkdtemp(join(tmpdir(), 'oneringai-verify-'));
const tmpPath = join(tmpDir, 'doc.pptx');
await writeFile(tmpPath, buf);

try {
  const t0 = Date.now();
  const ast = await parseOffice(tmpPath, {
    extractAttachments: false,
    ignoreNotes: false,
    outputErrorToConsole: true,
  });
  const dt = Date.now() - t0;

  console.log('[verify] parse completed in', dt, 'ms');
  console.log('[verify] ast.content nodes:', Array.isArray(ast.content) ? ast.content.length : 'N/A');
  console.log('[verify] metadata title:', ast.metadata?.title);

  const slides = (ast.content || []).filter((n) => n.type === 'slide');
  console.log('[verify] slide count:', slides.length);

  function nodeText(node) {
    if (node.text) return node.text;
    if (node.children) return node.children.map(nodeText).join(' ');
    return '';
  }
  if (slides.length > 0) {
    const firstSlideText = nodeText(slides[0]).slice(0, 200);
    console.log('[verify] first slide text (200 chars):', JSON.stringify(firstSlideText));
  }

  if (!Array.isArray(ast.content) || ast.content.length === 0) {
    console.error('[FAIL] ast.content is empty — parser produced no output');
    process.exit(1);
  }
  console.log('[PASS] temp-file approach works and parser produced content');
} finally {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}
