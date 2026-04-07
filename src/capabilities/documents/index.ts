/**
 * Document Reader Capability
 *
 * Universal file-to-LLM-content converter.
 * Reads arbitrary formats (Office, PDF, spreadsheets, HTML, text, images)
 * and produces arrays of DocumentPiece objects.
 */

// Core
export { DocumentReader, mergeTextPieces } from './DocumentReader.js';
export { FormatDetector } from './FormatDetector.js';

// Types
export type {
  DocumentFormat,
  DocumentFamily,
  DocumentPiece,
  DocumentTextPiece,
  DocumentImagePiece,
  PieceMetadata,
  DocumentResult,
  DocumentMetadata,
  DocumentSource,
  FileSource,
  URLSource,
  BufferSource,
  BlobSource,
  DocumentReadOptions,
  DocumentReaderConfig,
  ImageFilterOptions,
  ExcelFormatOptions,
  PDFFormatOptions,
  HTMLFormatOptions,
  OfficeFormatOptions,
  IDocumentTransformer,
  IFormatHandler,
  TransformerContext,
  FormatDetectionResult,
  DocumentToContentOptions,
} from './types.js';

// Handlers
export {
  TextHandler,
  ImageHandler,
  HTMLHandler,
  OfficeHandler,
  ExcelHandler,
  excelToMarkdownKV,
  PDFHandler,
  getDefaultHandlers,
} from './handlers/index.js';

export type {
  MarkdownKVSheet,
  ExcelToMarkdownKVOptions,
} from './handlers/index.js';

// Transformers
export {
  documentHeaderTransformer,
  tableFormattingTransformer,
  truncationTransformer,
  getDefaultTransformers,
} from './transformers/index.js';
