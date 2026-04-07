#!/usr/bin/env node

import { DocumentReader } from '@everworker/oneringai';
import type {
  DocumentReadOptions,
  DocumentResult,
  DocumentTextPiece,
  DocumentImagePiece,
} from '@everworker/oneringai';
import path from 'node:path';

// ── CLI Argument Parsing ────────────────────────────────────────────

interface CLIOptions {
  source: string;
  images: boolean;
  format?: 'csv' | 'json' | 'markdown' | 'markdown-kv';
  noHeader: boolean;
  maxTokens?: number;
}

function parseArgs(argv: string[]): CLIOptions | null {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return null;
  }

  const opts: CLIOptions = {
    source: '',
    images: false,
    noHeader: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--images') {
      opts.images = true;
    } else if (arg === '--no-header') {
      opts.noHeader = true;
    } else if (arg === '--format') {
      const val = args[++i];
      if (!val || !['csv', 'json', 'markdown', 'markdown-kv'].includes(val)) {
        console.error('Error: --format must be one of: csv, json, markdown, markdown-kv');
        process.exit(1);
      }
      opts.format = val as 'csv' | 'json' | 'markdown' | 'markdown-kv';
    } else if (arg === '--max-tokens') {
      const val = args[++i];
      const n = Number(val);
      if (!val || isNaN(n) || n <= 0) {
        console.error('Error: --max-tokens must be a positive number');
        process.exit(1);
      }
      opts.maxTokens = n;
    } else if (arg.startsWith('-')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else if (!opts.source) {
      opts.source = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!opts.source) {
    console.error('Error: No file path or URL provided.\n');
    printUsage();
    return null;
  }

  return opts;
}

function printUsage(): void {
  console.log(`
Usage: convert <file-or-url> [options]

Arguments:
  file-or-url          Path to a file or URL to convert

Options:
  --images             Include image pieces (metadata only, no base64)
  --format <fmt>       Excel table format: csv, json, markdown, markdown-kv (default: markdown)
  --no-header          Skip document header transformer
  --max-tokens <n>     Maximum estimated tokens in output
  -h, --help           Show this help message

Examples:
  convert ./report.pdf
  convert https://example.com/doc.xlsx
  convert ./slides.pptx --images
  convert ./data.xlsx --format csv
  convert ./big-doc.pdf --max-tokens 5000
`);
}

// ── Formatting Helpers ──────────────────────────────────────────────

const SEPARATOR = '\u2550'.repeat(50);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printHeader(result: DocumentResult): void {
  const m = result.metadata;
  console.log(`\n${SEPARATOR}`);
  console.log(`  Document: ${m.filename}`);
  console.log(`  Format: ${m.format} | Family: ${m.family} | MIME: ${m.mimeType}`);
  console.log(SEPARATOR);
}

function printTextPiece(piece: DocumentTextPiece, index: number, total: number): void {
  const meta = piece.metadata;
  const section = meta.section ? ` \u2014 ${meta.section}` : '';
  const tokens = meta.estimatedTokens > 0 ? ` (${meta.estimatedTokens} tokens)` : '';
  console.log(`\n--- Piece ${index + 1}/${total} [text]${section}${tokens} ---`);
  console.log(piece.content);
}

function printImagePiece(piece: DocumentImagePiece, index: number, total: number): void {
  const meta = piece.metadata;
  const section = meta.section ? ` \u2014 ${meta.section}` : '';
  console.log(`\n--- Piece ${index + 1}/${total} [image]${section} ---`);
  const label = meta.label ? ` | Label: ${meta.label}` : '';
  const dims = piece.width && piece.height ? `  Dimensions: ${piece.width}x${piece.height}\n` : '';
  console.log(`  Type: ${piece.mimeType} | Size: ${formatBytes(meta.sizeBytes)}${label}`);
  if (dims) process.stdout.write(dims);
}

function printFooter(result: DocumentResult): void {
  const m = result.metadata;
  const breakdown =
    m.totalImagePieces > 0
      ? ` (${m.totalTextPieces} text, ${m.totalImagePieces} images)`
      : '';
  console.log(`\n${SEPARATOR}`);
  console.log(`  Summary: ${m.totalPieces} pieces${breakdown}`);
  console.log(
    `  Total: ~${m.estimatedTokens.toLocaleString()} tokens | ${formatBytes(m.totalSizeBytes)} | ${m.processingTimeMs}ms`
  );
  if (result.warnings.length > 0) {
    console.log(`  Warnings: ${result.warnings.length}`);
    for (const w of result.warnings) {
      console.log(`    - ${w}`);
    }
  }
  console.log(SEPARATOR + '\n');
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (!opts) {
    process.exit(0);
  }

  // Build read options
  const readOptions: DocumentReadOptions = {
    extractImages: opts.images,
  };

  if (opts.maxTokens) {
    readOptions.maxTokens = opts.maxTokens;
  }

  if (opts.noHeader) {
    readOptions.skipDefaultTransformers = true;
  }

  if (opts.format) {
    readOptions.formatOptions = {
      excel: { tableFormat: opts.format },
    };
  }

  // Resolve source — if it looks like a URL, pass as-is; otherwise resolve the path
  let source = opts.source;
  if (!source.startsWith('http://') && !source.startsWith('https://')) {
    source = path.resolve(source);
  }

  try {
    const reader = DocumentReader.create();
    const result = await reader.read(source, readOptions);

    if (!result.success) {
      console.error(`Error: ${result.error ?? 'Unknown error reading document'}`);
      process.exit(1);
    }

    printHeader(result);

    const total = result.pieces.length;
    for (const piece of result.pieces) {
      if (piece.type === 'text') {
        printTextPiece(piece, piece.metadata.index, total);
      } else if (piece.type === 'image') {
        if (opts.images) {
          printImagePiece(piece, piece.metadata.index, total);
        }
      }
    }

    printFooter(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Fatal: ${msg}`);
    process.exit(1);
  }
}

main();
