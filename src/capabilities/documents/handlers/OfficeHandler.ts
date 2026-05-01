/**
 * Office Handler
 *
 * Handles office formats: docx, pptx, odt, odp, ods, rtf.
 * Uses officeparser (lazy-loaded) for AST-based extraction.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { DOCUMENT_DEFAULTS } from '../../../core/constants.js';
import type {
  IFormatHandler,
  DocumentFormat,
  DocumentReadOptions,
  DocumentPiece,
} from '../types.js';

// =====================================================================
// officeparser Meteor/webpack compatibility patch
// =====================================================================
//
// PROBLEM: When this code runs inside a Meteor server bundle (icos /
// Everworker), parseOffice() throws:
//
//   [OfficeParser]: A dynamic import callback was not specified.
//
// ROOT CAUSE: With Buffer input (no filename), parseOffice falls back
// to magic-byte detection, which calls loadFileType() inside
// officeparser's `dist/utils/moduleLoader.js`. That helper uses
//
//     new Function('s', 'return import(s)')(specifier)
//
// to bypass bundler static analysis. V8 parses the synthesized function
// body in the global scope where Meteor has NOT registered a host
// dynamic-import callback (it only registers one for code inside its
// own module wrapper). V8 then refuses the import().
//
// FIX: We import `file-type` from oneringai's module scope (where the
// callback IS registered), then overwrite officeparser's loadFileType
// with a cached wrapper. parseOffice's full dispatch logic still runs;
// the broken `new Function(...)` path is never reached.
//
// WHY NOT extension hint: officeparser has no extensionHint / format
// option in OfficeParserConfig (verified against types.d.ts and
// OfficeParser.js). The only way it learns the format from a Buffer is
// magic-byte detection.
//
// WHY NOT temp file: works, but adds disk dependency for environments
// (k8s read-only root, restricted tmpfs) where /tmp may be unavailable.
//
// FRAGILITY — REVIEW ON EVERY officeparser BUMP:
//   1. officeparser pins to `~6.1.0` so MINOR bumps are deliberate.
//   2. The internal path is `dist/utils/moduleLoader.js`, exported name
//      `loadFileType`. If either is renamed/removed, the patch throws
//      loudly at first use (we want this — never silent).
//   3. officeparser's package.json `exports` field restricts subpaths
//      to "." only, so we resolve via require.resolve('officeparser')
//      then walk the directory tree to bypass the restriction.
//   4. There's a unit test at
//      `src/capabilities/documents/__tests__/OfficeHandler.patch.test.ts`
//      that exercises this path against a real .pptx — run it after
//      every officeparser version bump.
//
// To verify in isolation, see scripts/verify-officeparser-patch.mjs.
// =====================================================================

const requireCjs = createRequire(import.meta.url);

let parseOffice: ((file: Buffer, config?: any) => Promise<any>) | null = null;
let patchApplied = false;

function applyOfficeParserPatch(): void {
  if (patchApplied) return;
  const officeparserMain = requireCjs.resolve('officeparser');
  const moduleLoaderPath = join(dirname(officeparserMain), 'utils', 'moduleLoader.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const moduleLoader = requireCjs(moduleLoaderPath) as { loadFileType?: unknown };
  if (typeof moduleLoader.loadFileType !== 'function') {
    throw new Error(
      `[OfficeHandler] officeparser internal layout changed: ` +
        `expected loadFileType function at ${moduleLoaderPath}. ` +
        `Review the Meteor/webpack patch in OfficeHandler.ts after this version bump.`,
    );
  }
  (moduleLoader as { loadFileType: () => Promise<{ fileTypeFromBuffer: typeof fileTypeFromBuffer }> }).loadFileType =
    async () => ({ fileTypeFromBuffer });
  patchApplied = true;
}

async function getParseOffice(): Promise<(file: Buffer, config?: any) => Promise<any>> {
  if (!parseOffice) {
    applyOfficeParserPatch();
    const mod = await import('officeparser');
    parseOffice = mod.parseOffice;
  }
  return parseOffice;
}

export class OfficeHandler implements IFormatHandler {
  readonly name = 'OfficeHandler';
  readonly supportedFormats: DocumentFormat[] = ['docx', 'pptx', 'odt', 'odp', 'ods', 'rtf'];

  async handle(
    buffer: Buffer,
    filename: string,
    format: DocumentFormat,
    options: DocumentReadOptions
  ): Promise<DocumentPiece[]> {
    const parse = await getParseOffice();

    const extractImages = options.extractImages !== false;
    const includeSpeakerNotes = options.formatOptions?.office?.includeSpeakerNotes !== false;

    const ast = await parse(buffer, {
      extractAttachments: extractImages,
      ignoreNotes: !includeSpeakerNotes,
    });

    const pieces: DocumentPiece[] = [];
    let pieceIndex = 0;

    // Convert AST content nodes to markdown
    const content = ast.content || [];
    const markdown = this.astToMarkdown(content, format);

    if (format === 'pptx' || format === 'odp') {
      // Split by slides
      const slides = this.splitBySlides(content);
      for (let i = 0; i < slides.length; i++) {
        const slideContent = this.astToMarkdown(slides[i] ?? [], format);
        if (slideContent.trim()) {
          const sizeBytes = Buffer.byteLength(slideContent, 'utf-8');
          pieces.push({
            type: 'text',
            content: slideContent,
            metadata: {
              sourceFilename: filename,
              format,
              index: pieceIndex++,
              section: `Slide ${i + 1}`,
              sizeBytes,
              estimatedTokens: Math.ceil(sizeBytes / DOCUMENT_DEFAULTS.CHARS_PER_TOKEN),
            },
          });
        }
      }
    } else {
      // Single text piece for other formats
      if (markdown.trim()) {
        const sizeBytes = Buffer.byteLength(markdown, 'utf-8');
        pieces.push({
          type: 'text',
          content: markdown,
          metadata: {
            sourceFilename: filename,
            format,
            index: pieceIndex++,
            sizeBytes,
            estimatedTokens: Math.ceil(sizeBytes / DOCUMENT_DEFAULTS.CHARS_PER_TOKEN),
          },
        });
      }
    }

    // Extract images from attachments
    if (extractImages && ast.attachments?.length > 0) {
      for (const attachment of ast.attachments) {
        if (attachment.type === 'image' && attachment.data) {
          const imageData = attachment.data;
          const sizeBytes = Math.ceil(imageData.length * 0.75); // base64 → bytes estimate
          pieces.push({
            type: 'image',
            base64: imageData,
            mimeType: attachment.mimeType || 'image/png',
            metadata: {
              sourceFilename: filename,
              format,
              index: pieceIndex++,
              sizeBytes,
              estimatedTokens: DOCUMENT_DEFAULTS.IMAGE_TOKENS_AUTO,
              label: attachment.altText || attachment.name || undefined,
            },
          });
        }
      }
    }

    return pieces;
  }

  /**
   * Split AST content into slide groups
   */
  private splitBySlides(content: any[]): any[][] {
    const slides: any[][] = [];
    let currentSlide: any[] = [];

    for (const node of content) {
      if (node.type === 'slide') {
        if (currentSlide.length > 0) {
          slides.push(currentSlide);
        }
        currentSlide = [node];
      } else {
        currentSlide.push(node);
      }
    }

    if (currentSlide.length > 0) {
      slides.push(currentSlide);
    }

    // If no slide nodes found, return all content as one group
    if (slides.length === 0 && content.length > 0) {
      slides.push(content);
    }

    return slides;
  }

  /**
   * Convert AST nodes to markdown
   */
  private astToMarkdown(nodes: any[], format: DocumentFormat): string {
    const parts: string[] = [];

    for (const node of nodes) {
      const md = this.nodeToMarkdown(node, format);
      if (md) parts.push(md);
    }

    return parts.join('\n\n');
  }

  /**
   * Convert a single AST node to markdown
   */
  private nodeToMarkdown(node: any, format: DocumentFormat): string {
    if (!node) return '';

    switch (node.type) {
      case 'heading': {
        const level = node.metadata?.level || 1;
        const prefix = '#'.repeat(Math.min(level, 6));
        return `${prefix} ${node.text || ''}`;
      }

      case 'paragraph':
        return this.formatText(node);

      case 'text':
        return this.formatText(node);

      case 'list': {
        const items = node.children || [];
        return items
          .map((item: any, i: number) => {
            const indent = '  '.repeat(node.metadata?.indentation || 0);
            const prefix = node.metadata?.listType === 'ordered' ? `${i + 1}.` : '-';
            return `${indent}${prefix} ${item.text || this.getNodeText(item)}`;
          })
          .join('\n');
      }

      case 'table': {
        return this.tableToMarkdown(node);
      }

      case 'slide': {
        const slideNum = node.metadata?.slideNumber || '';
        const childContent = node.children
          ? node.children.map((c: any) => this.nodeToMarkdown(c, format)).filter(Boolean).join('\n\n')
          : (node.text || '');
        return slideNum ? `### Slide ${slideNum}\n\n${childContent}` : childContent;
      }

      case 'note':
        return `> **Note:** ${node.text || this.getNodeText(node)}`;

      case 'sheet': {
        const sheetName = node.metadata?.sheetName || 'Sheet';
        const childContent = node.children
          ? node.children.map((c: any) => this.nodeToMarkdown(c, format)).filter(Boolean).join('\n')
          : '';
        return `## Sheet: ${sheetName}\n\n${childContent}`;
      }

      case 'page': {
        const pageNum = node.metadata?.pageNumber || '';
        const childContent = node.children
          ? node.children.map((c: any) => this.nodeToMarkdown(c, format)).filter(Boolean).join('\n\n')
          : (node.text || '');
        return pageNum ? `--- Page ${pageNum} ---\n\n${childContent}` : childContent;
      }

      case 'image':
        return `[Image: ${node.metadata?.altText || node.metadata?.attachmentName || 'embedded image'}]`;

      case 'chart':
        return `[Chart: ${node.metadata?.attachmentName || 'embedded chart'}]`;

      default:
        return node.text || this.getNodeText(node);
    }
  }

  /**
   * Get text from a node recursively
   */
  private getNodeText(node: any): string {
    if (node.text) return node.text;
    if (node.children) {
      return node.children.map((c: any) => this.getNodeText(c)).join('');
    }
    return '';
  }

  /**
   * Format text with markdown formatting
   */
  private formatText(node: any): string {
    if (!node.children || node.children.length === 0) {
      return node.text || '';
    }

    return node.children.map((child: any) => {
      let text = child.text || this.getNodeText(child);
      if (!text) return '';

      const fmt = child.formatting;
      if (fmt) {
        if (fmt.bold) text = `**${text}**`;
        if (fmt.italic) text = `_${text}_`;
        if (fmt.strikethrough) text = `~~${text}~~`;
      }

      // Handle hyperlinks
      if (child.metadata?.link && child.metadata?.linkType === 'external') {
        text = `[${text}](${child.metadata.link})`;
      }

      return text;
    }).join('');
  }

  /**
   * Convert table node to markdown table
   */
  private tableToMarkdown(node: any): string {
    if (!node.children || node.children.length === 0) return '';

    const rows: string[][] = [];
    for (const row of node.children) {
      if (row.type === 'row' && row.children) {
        rows.push(row.children.map((cell: any) => {
          const text = cell.text || this.getNodeText(cell);
          // Escape pipes in cell content
          return text.replace(/\|/g, '\\|').trim();
        }));
      }
    }

    if (rows.length === 0) return '';

    // Build markdown table
    const maxCols = Math.max(...rows.map((r) => r.length));
    const normalizedRows = rows.map((r) => {
      while (r.length < maxCols) r.push('');
      return r;
    });

    const firstRow = normalizedRows[0] ?? [];
    const header = `| ${firstRow.join(' | ')} |`;
    const separator = `| ${firstRow.map(() => '---').join(' | ')} |`;
    const body = normalizedRows.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n');

    return body ? `${header}\n${separator}\n${body}` : `${header}\n${separator}`;
  }
}
