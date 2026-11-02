/**
 * PDF Handler
 *
 * Handles PDF format using unpdf (lazy-loaded).
 * Extracts text per page and optionally images.
 */

import { DOCUMENT_DEFAULTS } from '../../../core/constants.js';
import type {
  IFormatHandler,
  DocumentFormat,
  DocumentReadOptions,
  DocumentPiece,
} from '../types.js';

// Lazy-loaded unpdf functions
let unpdfModule: typeof import('unpdf') | null = null;

async function getUnpdf() {
  if (!unpdfModule) unpdfModule = await import('unpdf');
  return unpdfModule;
}

export class PDFHandler implements IFormatHandler {
  readonly name = 'PDFHandler';
  readonly supportedFormats: DocumentFormat[] = ['pdf'];

  async handle(
    buffer: Buffer,
    filename: string,
    format: DocumentFormat,
    options: DocumentReadOptions
  ): Promise<DocumentPiece[]> {
    const unpdf = await getUnpdf();
    const pieces: DocumentPiece[] = [];
    let pieceIndex = 0;

    // pdf.js (via unpdf) transfers the underlying ArrayBuffer to a worker, which
    // detaches it from the original view. Parse one private copy, share its proxy
    // across extraction operations, and destroy that proxy on every exit.
    const copyBuffer = () => new Uint8Array(buffer);

    const pdf = await unpdf.getDocumentProxy(copyBuffer());
    try {
      // Extract metadata
      let metadata: any = {};
      const includeMetadata = options.formatOptions?.pdf?.includeMetadata !== false;
      if (includeMetadata) {
        try {
          metadata = await unpdf.getMeta(pdf);
        } catch (metaError) {
          console.warn(`[PDFHandler] Metadata extraction failed for ${filename}: ${metaError instanceof Error ? metaError.message : String(metaError)}`);
        }
      }

      // Extract text (per page)
      const textResult = await unpdf.extractText(pdf, { mergePages: false });
      const pages: string[] = textResult.text;

      // Filter to requested pages
      const requestedPages = options.pages;
      const pageEntries = pages.map((text: string, i: number) => ({ text, pageNum: i + 1 }));

      const filteredPages = requestedPages && requestedPages.length > 0
        ? pageEntries.filter((p) =>
            requestedPages.some((rp) => {
              const num = typeof rp === 'string' ? parseInt(rp, 10) : rp;
              return num === p.pageNum;
            })
          )
        : pageEntries;

      // Add metadata piece if available
      if (includeMetadata && metadata?.info) {
        const metaParts: string[] = [];
        if (metadata.info.Title) metaParts.push(`**Title:** ${metadata.info.Title}`);
        if (metadata.info.Author) metaParts.push(`**Author:** ${metadata.info.Author}`);
        if (metadata.info.Subject) metaParts.push(`**Subject:** ${metadata.info.Subject}`);
        if (metadata.info.Creator) metaParts.push(`**Creator:** ${metadata.info.Creator}`);
        if (pages.length) metaParts.push(`**Pages:** ${pages.length}`);

        if (metaParts.length > 0) {
          const metaContent = metaParts.join('\n');
          const sizeBytes = Buffer.byteLength(metaContent, 'utf-8');
          pieces.push({
            type: 'text',
            content: metaContent,
            metadata: {
              sourceFilename: filename,
              format,
              index: pieceIndex++,
              section: 'Metadata',
              sizeBytes,
              estimatedTokens: Math.ceil(sizeBytes / DOCUMENT_DEFAULTS.CHARS_PER_TOKEN),
            },
          });
        }
      }

      // Add text pieces per page
      for (const page of filteredPages) {
        const text = page.text.trim();
        if (!text) continue;

        const sizeBytes = Buffer.byteLength(text, 'utf-8');
        pieces.push({
          type: 'text',
          content: text,
          metadata: {
            sourceFilename: filename,
            format,
            index: pieceIndex++,
            section: `Page ${page.pageNum}`,
            sizeBytes,
            estimatedTokens: Math.ceil(sizeBytes / DOCUMENT_DEFAULTS.CHARS_PER_TOKEN),
          },
        });
      }

      // unpdf returns raw pixel arrays for one page, not an { images } object.
      // Encode those pixels as actual PNG bytes before labeling them image/png.
      if (options.extractImages !== false) {
        for (const { pageNum } of filteredPages) {
          try {
            const images = await unpdf.extractImages(pdf, pageNum);
            for (const img of images) {
              const { PNG } = await import('pngjs');
              const image = new PNG({ width: img.width, height: img.height });
              const rgba = image.data;
              for (let pixel = 0; pixel < img.width * img.height; pixel++) {
                const source = pixel * img.channels, target = pixel * 4;
                rgba[target] = img.data[source]!;
                rgba[target + 1] = img.data[source + (img.channels === 1 ? 0 : 1)]!;
                rgba[target + 2] = img.data[source + (img.channels === 1 ? 0 : 2)]!;
                rgba[target + 3] = img.channels === 4 ? img.data[source + 3]! : 255;
              }
              const png = PNG.sync.write(image);
              pieces.push({
                type: 'image', base64: png.toString('base64'), mimeType: 'image/png',
                width: img.width, height: img.height,
                metadata: {
                  sourceFilename: filename, format, index: pieceIndex++, sizeBytes: png.length,
                  estimatedTokens: DOCUMENT_DEFAULTS.IMAGE_TOKENS_AUTO,
                  section: `Page ${pageNum}`, label: img.key,
                },
              });
            }
          } catch (imgError) {
            console.warn(`[PDFHandler] Image extraction failed for ${filename} page ${pageNum}: ${imgError instanceof Error ? imgError.message : String(imgError)}`);
          }
        }
      }

      return pieces;
    } finally { await pdf.loadingTask.destroy(); }
  }
}
