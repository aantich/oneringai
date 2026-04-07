/**
 * Document Reader Types
 *
 * Core types for the universal file-to-LLM-content converter.
 */

// ============ Document Formats ============

export type DocumentFormat =
  | 'docx' | 'pptx' | 'odt' | 'odp' | 'ods' | 'rtf'
  | 'xlsx' | 'csv'
  | 'pdf'
  | 'html'
  | 'txt' | 'md' | 'json' | 'xml' | 'yaml' | 'yml'
  | 'png' | 'jpg' | 'jpeg' | 'gif' | 'webp' | 'svg';

export type DocumentFamily =
  | 'office'
  | 'spreadsheet'
  | 'pdf'
  | 'html'
  | 'text'
  | 'image';

// ============ Document Pieces ============

export interface PieceMetadata {
  sourceFilename: string;
  format: DocumentFormat;
  index: number;
  section?: string;
  sizeBytes: number;
  estimatedTokens: number;
  label?: string;
}

export interface DocumentTextPiece {
  type: 'text';
  content: string;
  metadata: PieceMetadata;
}

export interface DocumentImagePiece {
  type: 'image';
  base64: string;
  mimeType: string;
  width?: number;
  height?: number;
  metadata: PieceMetadata;
}

export type DocumentPiece = DocumentTextPiece | DocumentImagePiece;

// ============ Document Result ============

export interface DocumentMetadata {
  filename: string;
  format: DocumentFormat;
  family: DocumentFamily;
  mimeType: string;
  totalPieces: number;
  totalTextPieces: number;
  totalImagePieces: number;
  totalSizeBytes: number;
  estimatedTokens: number;
  processingTimeMs: number;
  formatSpecific?: Record<string, unknown>;
}

export interface DocumentResult {
  success: boolean;
  pieces: DocumentPiece[];
  metadata: DocumentMetadata;
  error?: string;
  warnings: string[];
}

// ============ Source Types ============

export interface FileSource {
  type: 'file';
  path: string;
}

export interface URLSource {
  type: 'url';
  url: string;
  headers?: Record<string, string>;
}

export interface BufferSource {
  type: 'buffer';
  buffer: Buffer | Uint8Array;
  filename: string;
  mimeType?: string;
}

export interface BlobSource {
  type: 'blob';
  blob: Blob;
  filename: string;
}

export type DocumentSource = FileSource | URLSource | BufferSource | BlobSource;

// ============ Image Filtering ============

export interface ImageFilterOptions {
  /** Skip images narrower than this (default: 50px) */
  minWidth?: number;
  /** Skip images shorter than this (default: 50px) */
  minHeight?: number;
  /** Skip images smaller than this in bytes (default: 1024) */
  minSizeBytes?: number;
  /** Maximum images to keep (default: 50 at extraction, 20 at content conversion) */
  maxImages?: number;
  /** Exclude images whose filename/label matches these patterns */
  excludePatterns?: RegExp[];
}

// ============ Format-Specific Options ============

export interface ExcelFormatOptions {
  /** Maximum rows per sheet (default: 1000) */
  maxRows?: number;
  /** Maximum columns per sheet (default: 50) */
  maxColumns?: number;
  /** Table output format (default: 'markdown') */
  tableFormat?: 'markdown' | 'csv' | 'json' | 'markdown-kv';
  /** Include formulas as comments (default: false) */
  includeFormulas?: boolean;
}

export interface PDFFormatOptions {
  /** Include PDF metadata in output (default: true) */
  includeMetadata?: boolean;
}

export interface HTMLFormatOptions {
  /** Maximum HTML length to process (default: 50000) */
  maxLength?: number;
}

export interface OfficeFormatOptions {
  /** Include speaker notes for PPTX (default: true) */
  includeSpeakerNotes?: boolean;
}

// ============ Read Options ============

export interface DocumentReadOptions {
  /** Maximum estimated tokens in output (default: 100000) */
  maxTokens?: number;
  /** Maximum output size in bytes (default: 5MB) */
  maxOutputBytes?: number;
  /** Extract images from documents (default: true) */
  extractImages?: boolean;
  /** Image detail level for LLM (default: 'auto') */
  imageDetail?: 'auto' | 'low' | 'high';
  /** Image filtering options */
  imageFilter?: ImageFilterOptions;
  /** Specific pages/sheets to read (format-dependent) */
  pages?: number[] | string[];
  /** Additional transformers to apply */
  transformers?: IDocumentTransformer[];
  /** Skip built-in transformers (default: false) */
  skipDefaultTransformers?: boolean;
  /** Format-specific options */
  formatOptions?: {
    excel?: ExcelFormatOptions;
    pdf?: PDFFormatOptions;
    html?: HTMLFormatOptions;
    office?: OfficeFormatOptions;
  };
}

// ============ Config ============

export interface DocumentReaderConfig {
  /** Default options for all read() calls */
  defaults?: DocumentReadOptions;
  /** Custom format handlers (override built-in) */
  handlers?: Map<DocumentFamily, IFormatHandler>;
  /** Maximum download size for URL sources (default: 50MB) */
  maxDownloadSizeBytes?: number;
  /** Download timeout for URL sources (default: 60000ms) */
  downloadTimeoutMs?: number;
}

// ============ Pluggable Interfaces ============

export interface TransformerContext {
  filename: string;
  format: DocumentFormat;
  family: DocumentFamily;
  options: DocumentReadOptions;
}

export interface IDocumentTransformer {
  readonly name: string;
  readonly appliesTo: DocumentFormat[];
  readonly priority?: number;
  transform(pieces: DocumentPiece[], context: TransformerContext): Promise<DocumentPiece[]>;
}

export interface IFormatHandler {
  readonly name: string;
  readonly supportedFormats: DocumentFormat[];
  handle(
    buffer: Buffer,
    filename: string,
    format: DocumentFormat,
    options: DocumentReadOptions
  ): Promise<DocumentPiece[]>;
}

// ============ Format Detection ============

export interface FormatDetectionResult {
  format: DocumentFormat;
  family: DocumentFamily;
  mimeType: string;
  confidence: 'high' | 'medium' | 'low';
}

// ============ Content Bridge Types ============

export interface DocumentToContentOptions {
  /** Image detail for LLM content (default: 'auto') */
  imageDetail?: 'auto' | 'low' | 'high';
  /** Additional image filtering at content conversion time */
  imageFilter?: ImageFilterOptions;
  /** Maximum images in content output (default: 20) */
  maxImages?: number;
  /** Merge adjacent text pieces into one (default: true) */
  mergeAdjacentText?: boolean;
}
