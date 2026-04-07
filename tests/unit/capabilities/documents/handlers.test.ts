/**
 * Unit tests for Document Format Handlers
 */

import { describe, it, expect } from 'vitest';
import { TextHandler } from '../../../../src/capabilities/documents/handlers/TextHandler.js';
import { ImageHandler } from '../../../../src/capabilities/documents/handlers/ImageHandler.js';
import { HTMLHandler } from '../../../../src/capabilities/documents/handlers/HTMLHandler.js';
import { ExcelHandler, excelToMarkdownKV } from '../../../../src/capabilities/documents/handlers/ExcelHandler.js';
import type { DocumentReadOptions } from '../../../../src/capabilities/documents/types.js';

const defaultOptions: DocumentReadOptions = {};

describe('TextHandler', () => {
  const handler = new TextHandler();

  it('should handle plain text', async () => {
    const buffer = Buffer.from('Hello, world!');
    const pieces = await handler.handle(buffer, 'hello.txt', 'txt', defaultOptions);

    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.type).toBe('text');
    expect(pieces[0]!.type === 'text' && pieces[0]!.content).toBe('Hello, world!');
    expect(pieces[0]!.metadata.format).toBe('txt');
    expect(pieces[0]!.metadata.sourceFilename).toBe('hello.txt');
  });

  it('should handle markdown', async () => {
    const buffer = Buffer.from('# Hello\n\nWorld');
    const pieces = await handler.handle(buffer, 'README.md', 'md', defaultOptions);

    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.type === 'text' && pieces[0]!.content).toBe('# Hello\n\nWorld');
  });

  it('should wrap JSON in code fence', async () => {
    const json = '{"key": "value"}';
    const buffer = Buffer.from(json);
    const pieces = await handler.handle(buffer, 'data.json', 'json', defaultOptions);

    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.type === 'text' && pieces[0]!.content).toBe('```json\n{"key": "value"}\n```');
  });

  it('should wrap XML in code fence', async () => {
    const xml = '<root><item>hello</item></root>';
    const buffer = Buffer.from(xml);
    const pieces = await handler.handle(buffer, 'data.xml', 'xml', defaultOptions);

    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.type === 'text' && pieces[0]!.content).toBe(`\`\`\`xml\n${xml}\n\`\`\``);
  });

  it('should wrap YAML in code fence', async () => {
    const yaml = 'key: value\nlist:\n  - item1';
    const buffer = Buffer.from(yaml);
    const pieces = await handler.handle(buffer, 'config.yaml', 'yaml', defaultOptions);

    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.type === 'text' && pieces[0]!.content).toContain('```yaml');
  });

  it('should estimate tokens correctly', async () => {
    const text = 'a'.repeat(400); // 400 chars ≈ 100 tokens
    const buffer = Buffer.from(text);
    const pieces = await handler.handle(buffer, 'test.txt', 'txt', defaultOptions);

    expect(pieces[0]!.metadata.estimatedTokens).toBe(100);
  });
});

describe('ImageHandler', () => {
  const handler = new ImageHandler();

  it('should handle PNG image', async () => {
    const buffer = Buffer.from('fake-png-data');
    const pieces = await handler.handle(buffer, 'photo.png', 'png', defaultOptions);

    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.type).toBe('image');
    if (pieces[0]!.type === 'image') {
      expect(pieces[0]!.base64).toBe(buffer.toString('base64'));
      expect(pieces[0]!.mimeType).toBe('image/png');
    }
  });

  it('should handle JPG image', async () => {
    const buffer = Buffer.from('fake-jpg-data');
    const pieces = await handler.handle(buffer, 'photo.jpg', 'jpg', defaultOptions);

    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.type).toBe('image');
    if (pieces[0]!.type === 'image') {
      expect(pieces[0]!.mimeType).toBe('image/jpeg');
    }
  });

  it('should handle SVG with both image and text', async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
    const buffer = Buffer.from(svgContent);
    const pieces = await handler.handle(buffer, 'logo.svg', 'svg', defaultOptions);

    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.type).toBe('image');
    expect(pieces[1]!.type).toBe('text');
    if (pieces[1]!.type === 'text') {
      expect(pieces[1]!.content).toContain('```svg');
      expect(pieces[1]!.content).toContain('<svg');
    }
  });

  it('should set label to filename', async () => {
    const buffer = Buffer.from('fake');
    const pieces = await handler.handle(buffer, 'my-photo.png', 'png', defaultOptions);

    expect(pieces[0]!.metadata.label).toBe('my-photo.png');
  });
});

describe('HTMLHandler', () => {
  const handler = new HTMLHandler();

  it('should convert HTML to markdown', async () => {
    const html = '<html><head><title>Test</title></head><body><h1>Hello</h1><p>World</p></body></html>';
    const buffer = Buffer.from(html);
    const pieces = await handler.handle(buffer, 'page.html', 'html', defaultOptions);

    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.type).toBe('text');
    if (pieces[0]!.type === 'text') {
      expect(pieces[0]!.content).toContain('Hello');
      expect(pieces[0]!.content).toContain('World');
    }
  });

  it('should strip script and style tags', async () => {
    const html = '<html><body><script>alert("xss")</script><style>.hide{display:none}</style><p>Content</p></body></html>';
    const buffer = Buffer.from(html);
    const pieces = await handler.handle(buffer, 'page.html', 'html', defaultOptions);

    if (pieces[0]!.type === 'text') {
      expect(pieces[0]!.content).not.toContain('alert');
      expect(pieces[0]!.content).not.toContain('display:none');
      expect(pieces[0]!.content).toContain('Content');
    }
  });

  it('should respect maxLength option', async () => {
    const longContent = '<p>' + 'x'.repeat(200) + '</p>';
    const html = `<html><body>${longContent}</body></html>`;
    const buffer = Buffer.from(html);
    const pieces = await handler.handle(buffer, 'page.html', 'html', {
      formatOptions: { html: { maxLength: 100 } },
    });

    if (pieces[0]!.type === 'text') {
      expect(pieces[0]!.content.length).toBeLessThanOrEqual(150); // some overhead from truncation marker
    }
  });
});

// ── Helper: build CSV buffer ──────────────────────────────────────
function csvBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf-8');
}

// ── Helper: build XLSX buffer via exceljs ─────────────────────────
async function xlsxBuffer(
  sheets: { name: string; rows: (string | number)[][] }[],
): Promise<Buffer> {
  const exceljs = await import('exceljs');
  const Workbook = exceljs.Workbook || (exceljs as any).default?.Workbook;
  const wb = new Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const row of sheet.rows) {
      ws.addRow(row);
    }
  }
  const arrayBuf = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

describe('ExcelHandler – markdown-kv format', () => {
  const handler = new ExcelHandler();
  const kvOptions: DocumentReadOptions = {
    formatOptions: { excel: { tableFormat: 'markdown-kv' } },
  };

  // ── CSV tests ───────────────────────────────────────────────────

  it('should convert CSV to markdown-kv records', async () => {
    const buf = csvBuffer('Name,Age,City\nAlice,30,NYC\nBob,25,LA');
    const pieces = await handler.handle(buf, 'data.csv', 'csv', kvOptions);

    expect(pieces).toHaveLength(1);
    const content = pieces[0]!.type === 'text' ? pieces[0]!.content : '';

    expect(content).toContain('### Record 1');
    expect(content).toContain('- **Name**: Alice');
    expect(content).toContain('- **Age**: 30');
    expect(content).toContain('- **City**: NYC');
    expect(content).toContain('### Record 2');
    expect(content).toContain('- **Name**: Bob');
    expect(content).toContain('- **Age**: 25');
    expect(content).toContain('- **City**: LA');
  });

  it('should skip empty values in markdown-kv', async () => {
    const buf = csvBuffer('Name,Age,City\nAlice,,NYC');
    const pieces = await handler.handle(buf, 'data.csv', 'csv', kvOptions);

    const content = pieces[0]!.type === 'text' ? pieces[0]!.content : '';

    expect(content).toContain('- **Name**: Alice');
    expect(content).not.toContain('- **Age**:');
    expect(content).toContain('- **City**: NYC');
  });

  it('should handle headers-only CSV (no data rows)', async () => {
    const buf = csvBuffer('Name,Age,City');
    const pieces = await handler.handle(buf, 'data.csv', 'csv', kvOptions);

    const content = pieces[0]!.type === 'text' ? pieces[0]!.content : '';

    expect(content).toContain('- **Name**');
    expect(content).toContain('- **Age**');
    expect(content).toContain('- **City**');
    expect(content).not.toContain('### Record');
  });

  it('should handle single data row CSV', async () => {
    const buf = csvBuffer('X,Y\n1,2');
    const pieces = await handler.handle(buf, 'data.csv', 'csv', kvOptions);

    const content = pieces[0]!.type === 'text' ? pieces[0]!.content : '';

    expect(content).toContain('### Record 1');
    expect(content).toContain('- **X**: 1');
    expect(content).toContain('- **Y**: 2');
    expect(content).not.toContain('### Record 2');
  });

  // ── XLSX tests ──────────────────────────────────────────────────

  it('should convert XLSX to markdown-kv with sheet headers', async () => {
    const buf = await xlsxBuffer([
      { name: 'People', rows: [['Name', 'Age'], ['Alice', 30], ['Bob', 25]] },
    ]);
    const pieces = await handler.handle(buf, 'data.xlsx', 'xlsx', kvOptions);

    expect(pieces).toHaveLength(1);
    const content = pieces[0]!.type === 'text' ? pieces[0]!.content : '';

    expect(content).toContain('## Sheet: People');
    expect(content).toContain('### Record 1');
    expect(content).toContain('- **Name**: Alice');
    expect(content).toContain('- **Age**: 30');
    expect(content).toContain('### Record 2');
    expect(content).toContain('- **Name**: Bob');
  });

  it('should produce one piece per XLSX sheet', async () => {
    const buf = await xlsxBuffer([
      { name: 'Sheet1', rows: [['A', 'B'], ['1', '2']] },
      { name: 'Sheet2', rows: [['X', 'Y'], ['3', '4']] },
    ]);
    const pieces = await handler.handle(buf, 'data.xlsx', 'xlsx', kvOptions);

    expect(pieces).toHaveLength(2);

    const c1 = pieces[0]!.type === 'text' ? pieces[0]!.content : '';
    const c2 = pieces[1]!.type === 'text' ? pieces[1]!.content : '';

    expect(c1).toContain('## Sheet: Sheet1');
    expect(c1).toContain('- **A**: 1');
    expect(c2).toContain('## Sheet: Sheet2');
    expect(c2).toContain('- **X**: 3');
  });

  it('should respect maxRows option', async () => {
    const buf = csvBuffer('H\nA\nB\nC\nD\nE');
    const pieces = await handler.handle(buf, 'data.csv', 'csv', {
      formatOptions: { excel: { tableFormat: 'markdown-kv', maxRows: 3 } },
    });

    const content = pieces[0]!.type === 'text' ? pieces[0]!.content : '';

    // maxRows=3 → 1 header + 2 data rows
    expect(content).toContain('### Record 1');
    expect(content).toContain('### Record 2');
    expect(content).not.toContain('### Record 3');
  });

  it('should respect maxColumns option', async () => {
    const buf = csvBuffer('A,B,C,D\n1,2,3,4');
    const pieces = await handler.handle(buf, 'data.csv', 'csv', {
      formatOptions: { excel: { tableFormat: 'markdown-kv', maxColumns: 2 } },
    });

    const content = pieces[0]!.type === 'text' ? pieces[0]!.content : '';

    expect(content).toContain('- **A**: 1');
    expect(content).toContain('- **B**: 2');
    expect(content).not.toContain('- **C**');
    expect(content).not.toContain('- **D**');
  });
});

describe('excelToMarkdownKV utility', () => {
  it('should return a string for CSV input', async () => {
    const buf = csvBuffer('Name,Score\nAlice,95\nBob,87');
    const result = await excelToMarkdownKV(buf, 'csv');

    expect(typeof result).toBe('string');
    const text = result as string;
    expect(text).toContain('### Record 1');
    expect(text).toContain('- **Name**: Alice');
    expect(text).toContain('- **Score**: 95');
    expect(text).toContain('### Record 2');
    expect(text).toContain('- **Name**: Bob');
  });

  it('should return sheet array for XLSX input', async () => {
    const buf = await xlsxBuffer([
      { name: 'Sales', rows: [['Product', 'Revenue'], ['Widget', 100]] },
      { name: 'Costs', rows: [['Item', 'Amount'], ['Rent', 500]] },
    ]);
    const result = await excelToMarkdownKV(buf, 'xlsx');

    expect(Array.isArray(result)).toBe(true);
    const sheets = result as { name: string; content: string }[];
    expect(sheets).toHaveLength(2);

    expect(sheets[0]!.name).toBe('Sales');
    expect(sheets[0]!.content).toContain('- **Product**: Widget');
    expect(sheets[0]!.content).toContain('- **Revenue**: 100');
    // Sheet header should be stripped by the utility
    expect(sheets[0]!.content).not.toContain('## Sheet:');

    expect(sheets[1]!.name).toBe('Costs');
    expect(sheets[1]!.content).toContain('- **Item**: Rent');
    expect(sheets[1]!.content).toContain('- **Amount**: 500');
  });

  it('should forward options (maxRows, maxColumns)', async () => {
    const buf = csvBuffer('A,B,C\n1,2,3\n4,5,6\n7,8,9');
    const result = await excelToMarkdownKV(buf, 'csv', { maxRows: 2, maxColumns: 2 });

    const text = result as string;
    // maxRows=2 → 1 header + 1 data row
    expect(text).toContain('### Record 1');
    expect(text).not.toContain('### Record 2');
    // maxColumns=2 → only A, B
    expect(text).toContain('- **A**: 1');
    expect(text).toContain('- **B**: 2');
    expect(text).not.toContain('- **C**');
  });
});
