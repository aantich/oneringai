/**
 * Excel Handler
 *
 * Handles spreadsheet formats: xlsx, csv.
 * Uses exceljs (lazy-loaded) for typed cell values and sheet names.
 */

import { DOCUMENT_DEFAULTS } from '../../../core/constants.js';
import type {
  IFormatHandler,
  DocumentFormat,
  DocumentReadOptions,
  DocumentPiece,
} from '../types.js';

// Lazy-loaded exceljs
let ExcelJS: any = null;

async function getExcelJS(): Promise<any> {
  if (!ExcelJS) {
    ExcelJS = await import('exceljs');
  }
  return ExcelJS;
}

export class ExcelHandler implements IFormatHandler {
  readonly name = 'ExcelHandler';
  readonly supportedFormats: DocumentFormat[] = ['xlsx', 'csv'];

  async handle(
    buffer: Buffer,
    filename: string,
    format: DocumentFormat,
    options: DocumentReadOptions
  ): Promise<DocumentPiece[]> {
    const exceljs = await getExcelJS();
    const Workbook = exceljs.Workbook || exceljs.default?.Workbook;

    const excelOpts = {
      maxRows: options.formatOptions?.excel?.maxRows ?? DOCUMENT_DEFAULTS.MAX_EXCEL_ROWS,
      maxColumns: options.formatOptions?.excel?.maxColumns ?? DOCUMENT_DEFAULTS.MAX_EXCEL_COLUMNS,
      tableFormat: options.formatOptions?.excel?.tableFormat ?? 'markdown' as const,
      includeFormulas: options.formatOptions?.excel?.includeFormulas ?? false,
    };

    const workbook = new Workbook();

    if (format === 'csv') {
      await workbook.csv.read(
        new (await import('node:stream')).Readable({
          read() {
            this.push(buffer);
            this.push(null);
          },
        })
      );
    } else {
      await workbook.xlsx.load(buffer);
    }

    const pieces: DocumentPiece[] = [];
    let pieceIndex = 0;

    // Filter sheets if specific pages requested
    const requestedSheets = options.pages;

    workbook.eachSheet((worksheet: any, sheetId: number) => {
      // Check if sheet is requested
      if (requestedSheets && requestedSheets.length > 0) {
        const isRequested = requestedSheets.some((p) => {
          if (typeof p === 'number') return sheetId === p;
          return worksheet.name === p || String(sheetId) === p;
        });
        if (!isRequested) return;
      }

      const content = this.sheetToContent(worksheet, excelOpts);
      if (!content.trim()) return;

      const sheetContent = format === 'csv'
        ? content
        : `## Sheet: ${worksheet.name}\n\n${content}`;

      const sizeBytes = Buffer.byteLength(sheetContent, 'utf-8');
      pieces.push({
        type: 'text',
        content: sheetContent,
        metadata: {
          sourceFilename: filename,
          format,
          index: pieceIndex++,
          section: format === 'csv' ? undefined : worksheet.name,
          sizeBytes,
          estimatedTokens: Math.ceil(sizeBytes / DOCUMENT_DEFAULTS.CHARS_PER_TOKEN),
        },
      });
    });

    return pieces;
  }

  /**
   * Convert a worksheet to the configured format
   */
  private sheetToContent(worksheet: any, opts: { maxRows: number; maxColumns: number; tableFormat: string; includeFormulas: boolean }): string {
    switch (opts.tableFormat) {
      case 'csv':
        return this.sheetToCSV(worksheet, opts);
      case 'json':
        return this.sheetToJSON(worksheet, opts);
      case 'markdown-kv':
        return this.sheetToMarkdownKV(worksheet, opts);
      default:
        return this.sheetToMarkdownTable(worksheet, opts);
    }
  }

  /**
   * Convert worksheet to markdown table
   */
  private sheetToMarkdownTable(worksheet: any, opts: { maxRows: number; maxColumns: number; tableFormat: string; includeFormulas: boolean }): string {
    const rows = this.extractRows(worksheet, opts);
    if (rows.length === 0) return '';

    // Normalize column count
    const maxCols = Math.min(
      Math.max(...rows.map((r) => r.length)),
      opts.maxColumns
    );

    const normalizedRows = rows.map((r) => {
      const truncated = r.slice(0, maxCols);
      while (truncated.length < maxCols) truncated.push('');
      return truncated;
    });

    // Build markdown table
    const firstRow = normalizedRows[0] ?? [];
    const header = `| ${firstRow.join(' | ')} |`;
    const separator = `| ${firstRow.map(() => '---').join(' | ')} |`;
    const body = normalizedRows
      .slice(1)
      .map((r) => `| ${r.join(' | ')} |`)
      .join('\n');

    let result = `${header}\n${separator}`;
    if (body) result += `\n${body}`;

    if (worksheet.rowCount > opts.maxRows) {
      result += `\n\n_...truncated (${worksheet.rowCount - opts.maxRows} more rows)_`;
    }

    return result;
  }

  /**
   * Convert worksheet to CSV
   */
  private sheetToCSV(worksheet: any, opts: { maxRows: number; maxColumns: number; tableFormat: string; includeFormulas: boolean }): string {
    const rows = this.extractRows(worksheet, opts);
    return rows
      .map((row) =>
        row
          .slice(0, opts.maxColumns)
          .map((cell) => {
            // Escape CSV values
            if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
              return `"${cell.replace(/"/g, '""')}"`;
            }
            return cell;
          })
          .join(',')
      )
      .join('\n');
  }

  /**
   * Convert worksheet to JSON
   */
  private sheetToJSON(worksheet: any, opts: { maxRows: number; maxColumns: number; tableFormat: string; includeFormulas: boolean }): string {
    const rows = this.extractRows(worksheet, opts);
    if (rows.length < 2) return '[]';

    const headers = (rows[0] ?? []).slice(0, opts.maxColumns);
    const data = rows.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((header, i) => {
        if (header && i < row.length) {
          obj[header] = row[i] ?? '';
        }
      });
      return obj;
    });

    return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
  }

  /**
   * Convert worksheet to Markdown-KV format.
   * Each row becomes a record block with `- **Header**: value` entries.
   */
  private sheetToMarkdownKV(worksheet: any, opts: { maxRows: number; maxColumns: number; tableFormat: string; includeFormulas: boolean }): string {
    const rows = this.extractRows(worksheet, opts);
    if (rows.length === 0) return '';

    const headers = (rows[0] ?? []).slice(0, opts.maxColumns);
    if (rows.length < 2) {
      // Headers only, no data rows
      return headers.map((h) => `- **${h}**`).join('\n');
    }

    const blocks: string[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]!;
      const lines: string[] = [`### Record ${i + 1}`];
      for (let j = 0; j < headers.length; j++) {
        const value = j < row.length ? row[j] ?? '' : '';
        if (value) {
          lines.push(`- **${headers[j]}**: ${value}`);
        }
      }
      blocks.push(lines.join('\n'));
    }

    let result = blocks.join('\n\n');

    if (worksheet.rowCount > opts.maxRows) {
      result += `\n\n_...truncated (${worksheet.rowCount - opts.maxRows} more rows)_`;
    }

    return result;
  }

  /**
   * Extract rows from worksheet as string arrays
   */
  private extractRows(worksheet: any, opts: { maxRows: number; maxColumns: number; tableFormat: string; includeFormulas: boolean }): string[][] {
    const rows: string[][] = [];
    let rowCount = 0;

    worksheet.eachRow({ includeEmpty: false }, (row: any) => {
      if (rowCount >= opts.maxRows) return;
      rowCount++;

      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        if (colNumber > opts.maxColumns) return;

        let value = '';
        if (opts.includeFormulas && cell.formula) {
          value = `${this.getCellValue(cell)} (=${cell.formula})`;
        } else {
          value = this.getCellValue(cell);
        }

        // Ensure cells array is properly filled
        while (cells.length < colNumber - 1) cells.push('');
        cells.push(value);
      });

      rows.push(cells);
    });

    return rows;
  }

  /**
   * Get cell value as string
   */
  private getCellValue(cell: any): string {
    if (cell.value === null || cell.value === undefined) return '';

    // Handle different cell types
    if (typeof cell.value === 'object') {
      // Rich text
      if (cell.value.richText) {
        return cell.value.richText.map((rt: any) => rt.text || '').join('');
      }
      // Hyperlink
      if (cell.value.hyperlink) {
        return cell.value.text || cell.value.hyperlink;
      }
      // Formula result
      if ('result' in cell.value) {
        return String(cell.value.result ?? '');
      }
      // Date
      if (cell.value instanceof Date) {
        return cell.value.toISOString().split('T')[0];
      }
      return String(cell.value);
    }

    return String(cell.value).replace(/\|/g, '\\|'); // Escape pipes for markdown
  }
}

// ── Standalone Utility ─────────────────────────────────────────────

export interface MarkdownKVSheet {
  name: string;
  content: string;
}

export interface ExcelToMarkdownKVOptions {
  maxRows?: number;
  maxColumns?: number;
  includeFormulas?: boolean;
}

/**
 * Convert an Excel (.xlsx) or CSV file buffer to Markdown-KV format.
 *
 * Each row becomes a record block:
 * ```
 * ### Record 1
 * - **Name**: Alice
 * - **Age**: 30
 * ```
 *
 * @returns For CSV: a single string. For Excel: an array of `{ name, content }` per sheet.
 */
export async function excelToMarkdownKV(
  buffer: Buffer,
  format: 'xlsx' | 'csv',
  options?: ExcelToMarkdownKVOptions,
): Promise<string | MarkdownKVSheet[]> {
  const handler = new ExcelHandler();
  const pieces = await handler.handle(buffer, 'input.' + format, format, {
    formatOptions: {
      excel: {
        tableFormat: 'markdown-kv',
        maxRows: options?.maxRows,
        maxColumns: options?.maxColumns,
        includeFormulas: options?.includeFormulas,
      },
    },
  });

  const textPieces = pieces.filter((p): p is import('../types.js').DocumentTextPiece => p.type === 'text');

  if (format === 'csv') {
    return textPieces.map((p) => p.content).join('\n\n');
  }

  // Excel: return array of sheets with names
  return textPieces.map((p) => ({
    name: p.metadata.section ?? `Sheet ${p.metadata.index + 1}`,
    content: p.content.replace(/^## Sheet: .+\n\n/, ''), // strip the sheet header added by handler
  }));
}
