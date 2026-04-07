/**
 * Document Format Handlers
 */

import type { DocumentFamily, IFormatHandler } from '../types.js';
import { TextHandler } from './TextHandler.js';
import { ImageHandler } from './ImageHandler.js';
import { HTMLHandler } from './HTMLHandler.js';
import { OfficeHandler } from './OfficeHandler.js';
import { ExcelHandler } from './ExcelHandler.js';
import { PDFHandler } from './PDFHandler.js';

export { TextHandler } from './TextHandler.js';
export { ImageHandler } from './ImageHandler.js';
export { HTMLHandler } from './HTMLHandler.js';
export { OfficeHandler } from './OfficeHandler.js';
export { ExcelHandler, excelToMarkdownKV } from './ExcelHandler.js';
export type { MarkdownKVSheet, ExcelToMarkdownKVOptions } from './ExcelHandler.js';
export { PDFHandler } from './PDFHandler.js';

/**
 * Get all default format handlers mapped by family
 */
export function getDefaultHandlers(): Map<DocumentFamily, IFormatHandler> {
  return new Map<DocumentFamily, IFormatHandler>([
    ['text', new TextHandler()],
    ['image', new ImageHandler()],
    ['html', new HTMLHandler()],
    ['office', new OfficeHandler()],
    ['spreadsheet', new ExcelHandler()],
    ['pdf', new PDFHandler()],
  ]);
}
