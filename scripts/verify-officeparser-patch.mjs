// Verify the officeparser Meteor/webpack monkey-patch in OfficeHandler.ts.
//
// What this checks:
//   1. officeparser still exposes `loadFileType` at the expected internal
//      path (`dist/utils/moduleLoader.js`).
//   2. Replacing that export with a wrapper that pre-imports `file-type`
//      lets `parseOffice(buffer, ...)` parse a real .pptx without ever
//      hitting the broken `new Function('s', 'return import(s)')` path.
//
// Run after every officeparser version bump:
//   node scripts/verify-officeparser-patch.mjs
//
// See the comment block at the top of
// `src/capabilities/documents/handlers/OfficeHandler.ts` for full context.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { parseOffice } from 'officeparser';

const requireCjs = createRequire(import.meta.url);

// officeparser's package.json restricts exports to "." only.
// Bypass by resolving the main entry then walking to dist/utils/moduleLoader.js.
const mainPath = requireCjs.resolve('officeparser'); // → .../dist/index.js
const moduleLoaderPath = join(dirname(mainPath), 'utils', 'moduleLoader.js');
console.log('[verify] resolved moduleLoader path:', moduleLoaderPath);
const moduleLoader = requireCjs(moduleLoaderPath);
console.log('[verify] moduleLoader keys:', Object.keys(moduleLoader));
console.log('[verify] loadFileType is function:', typeof moduleLoader.loadFileType === 'function');

// 2. Monkey-patch with a wrapper that increments a counter so we can prove our override ran
let patchCalls = 0;
const originalLoadFileType = moduleLoader.loadFileType;
moduleLoader.loadFileType = async () => {
  patchCalls++;
  return { fileTypeFromBuffer };
};

// 3. First test: Buffer input (no extension hint) → must hit loadFileType path
const buf = await readFile('/Users/aantich/dev/oneringai/docs/architecture.pptx');
console.log('[verify] file size:', buf.length, 'bytes');

const t0 = Date.now();
const ast = await parseOffice(buf, {
  extractAttachments: false,
  ignoreNotes: false,
  outputErrorToConsole: true,
});
const dt = Date.now() - t0;

console.log('[verify] parse completed in', dt, 'ms');
console.log('[verify] patchCalls (must be >= 1):', patchCalls);
console.log('[verify] ast.content nodes:', Array.isArray(ast.content) ? ast.content.length : 'N/A');
console.log('[verify] metadata title:', ast.metadata?.title);

// 4. Sanity: extract some text to confirm parsing actually worked
const slides = (ast.content || []).filter((n) => n.type === 'slide');
console.log('[verify] slide count:', slides.length);

// 5. Print first 200 chars of text from first slide
function nodeText(node) {
  if (node.text) return node.text;
  if (node.children) return node.children.map(nodeText).join(' ');
  return '';
}
if (slides.length > 0) {
  const firstSlideText = nodeText(slides[0]).slice(0, 200);
  console.log('[verify] first slide text (200 chars):', JSON.stringify(firstSlideText));
}

// 6. Assert success
if (patchCalls < 1) {
  console.error('[FAIL] patch was never called — monkey-patch did NOT take effect');
  process.exit(1);
}
if (!Array.isArray(ast.content) || ast.content.length === 0) {
  console.error('[FAIL] ast.content is empty — parser produced no output');
  process.exit(1);
}
console.log('[PASS] monkey-patch works and parser produced content');
