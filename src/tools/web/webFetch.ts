/**
 * Web Fetch Tool - Simple HTTP fetch with content quality detection
 */

import { load } from 'cheerio';
import { ToolFunction } from '../../domain/entities/Tool.js';
import { detectContentQuality } from './contentDetector.js';
import { htmlToMarkdown } from './htmlToMarkdown.js';
import { FormatDetector } from '../../capabilities/documents/FormatDetector.js';
import { DocumentReader, mergeTextPieces } from '../../capabilities/documents/DocumentReader.js';

interface WebFetchArgs {
  url: string;
  userAgent?: string;
  timeout?: number;
}

interface WebFetchResult {
  success: boolean;
  url: string;
  title: string;
  content: string;
  contentType: 'html' | 'json' | 'text' | 'document' | 'error';
  qualityScore: number;
  requiresJS: boolean;
  suggestedAction?: string;
  issues?: string[];
  error?: string;
  // Markdown conversion metadata
  excerpt?: string;
  byline?: string;
  wasReadabilityUsed?: boolean;
  wasTruncated?: boolean;
  // Document metadata (when contentType is 'document')
  documentMetadata?: Record<string, unknown>;
}

export const webFetch: ToolFunction<WebFetchArgs, WebFetchResult> = {
  definition: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: `Fetch and extract content from a URL — works with web pages AND document files (PDF, DOCX, XLSX, PPTX, etc.). Document URLs are automatically detected and converted to markdown text.

WEB PAGES:
This tool performs HTTP fetch and HTML parsing. It works well for:
- Static websites (blogs, documentation, articles)
- Server-rendered HTML pages
- Content that doesn't require JavaScript

DOCUMENT URLs:
When the URL points to a document file (detected via Content-Type header or URL extension), the document is automatically downloaded and converted to markdown:
- PDF files: extracted as markdown with per-page sections
- Word (.docx), PowerPoint (.pptx): converted to structured markdown
- Excel (.xlsx), CSV, ODS: tables converted to markdown tables
- OpenDocument formats (.odt, .odp, .ods): converted like MS Office equivalents
- Returns contentType: "document" and includes documentMetadata in the result

LIMITATIONS:
- Cannot execute JavaScript
- May fail on React/Vue/Angular sites (will return low quality score)
- May get blocked by bot protection
- Cannot handle dynamic content loading

QUALITY DETECTION:
The tool analyzes the fetched content and returns a quality score (0-100):
- 80-100: Excellent quality, content extracted successfully
- 50-79: Moderate quality, some content extracted
- 0-49: Low quality, likely needs JavaScript or has errors

If the quality score is low or requiresJS is true, consider using a scraping service connector for better results.

RETURNS:
{
  success: boolean,
  url: string,
  title: string,
  content: string,          // Clean markdown (converted from HTML or document)
  contentType: string,      // 'html' | 'json' | 'text' | 'document' | 'error'
  qualityScore: number,     // 0-100 (quality of extraction)
  requiresJS: boolean,      // True if site likely needs JavaScript
  suggestedAction: string,  // Suggestion if quality is low
  issues: string[],         // List of detected issues
  excerpt: string,          // Short summary excerpt (if extracted)
  byline: string,           // Author info (if extracted)
  wasTruncated: boolean,    // True if content was truncated
  documentMetadata: object, // Document metadata (format, pages, etc.) — only for document URLs
  error: string             // Error message if failed
}

EXAMPLES:
Fetch a blog post:
{
  url: "https://example.com/blog/article"
}

Fetch a PDF document:
{
  url: "https://example.com/reports/q4-2025.pdf"
}

Fetch an Excel spreadsheet:
{
  url: "https://example.com/data/metrics.xlsx"
}`,

      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch. Must start with http:// or https://',
          },
          userAgent: {
            type: 'string',
            description: 'Optional custom user agent string. Default is a generic bot user agent.',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 10000)',
          },
        },
        required: ['url'],
      },
    },
    blocking: true,
    timeout: 15000,
  },

  permission: { scope: 'session' as const, riskLevel: 'low' as const, sensitiveArgs: ['url'] },

  execute: async (args: WebFetchArgs): Promise<WebFetchResult> => {
    try {
      // Validate URL
      try {
        new URL(args.url);
      } catch {
        return {
          success: false,
          url: args.url,
          title: '',
          content: '',
          contentType: 'error',
          qualityScore: 0,
          requiresJS: false,
          error: 'Invalid URL format',
        };
      }

      // Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), args.timeout || 10000);

      let response: Response;
      try {
        response = await fetch(args.url, {
          headers: {
            'User-Agent':
              args.userAgent ||
              'Mozilla/5.0 (compatible; OneRingAI/1.0; +https://github.com/oneringai/agents)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // Check response status
      if (!response.ok) {
        return {
          success: false,
          url: args.url,
          title: '',
          content: '',
          contentType: 'error',
          qualityScore: 0,
          requiresJS: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Get content type
      const contentType = response.headers.get('content-type') || '';

      // Handle document formats (PDF, DOCX, XLSX, etc.)
      const urlExt = (() => {
        try {
          const pathname = new URL(args.url).pathname;
          const ext = pathname.split('.').pop()?.toLowerCase();
          return ext ? `.${ext}` : '';
        } catch { return ''; }
      })();

      if (FormatDetector.isDocumentMimeType(contentType) || FormatDetector.isBinaryDocumentFormat(urlExt)) {
        try {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Extract filename from URL or Content-Disposition
          const disposition = response.headers.get('content-disposition');
          let filename = 'document';
          if (disposition) {
            const match = disposition.match(/filename[^;=\n]*=(['"]?)([^'"\n;]*)\1/);
            if (match?.[2]) filename = match[2];
          } else {
            try {
              const basename = new URL(args.url).pathname.split('/').pop();
              if (basename && basename.includes('.')) filename = basename;
            } catch { /* ignore */ }
          }

          const reader = DocumentReader.create();
          const result = await reader.read(
            { type: 'buffer', buffer, filename },
            { extractImages: false }
          );

          if (result.success) {
            return {
              success: true,
              url: args.url,
              title: `Document: ${filename}`,
              content: mergeTextPieces(result.pieces),
              contentType: 'document',
              qualityScore: 100,
              requiresJS: false,
              documentMetadata: result.metadata as unknown as Record<string, unknown>,
            };
          }
        } catch {
          // Fall through to regular handling
        }
      }

      // Handle JSON responses
      if (contentType.includes('application/json')) {
        const json = await response.json();
        return {
          success: true,
          url: args.url,
          title: 'JSON Response',
          content: JSON.stringify(json, null, 2),
          contentType: 'json',
          qualityScore: 100,
          requiresJS: false,
        };
      }

      // Handle plain text
      if (contentType.includes('text/plain')) {
        const text = await response.text();
        return {
          success: true,
          url: args.url,
          title: 'Text Response',
          content: text,
          contentType: 'text',
          qualityScore: 100,
          requiresJS: false,
        };
      }

      // Get HTML
      const html = await response.text();

      // Parse with cheerio for quality detection
      const $ = load(html);

      // Convert HTML to clean markdown
      const mdResult = await htmlToMarkdown(html, args.url);

      // Use markdown result title or fallback to cheerio extraction
      const title = mdResult.title || $('title').text() || $('h1').first().text() || 'Untitled';

      // Detect content quality (using markdown content for text analysis)
      const quality = detectContentQuality(html, mdResult.markdown, $);

      return {
        success: true,
        url: args.url,
        title,
        content: mdResult.markdown,
        contentType: 'html',
        qualityScore: quality.score,
        requiresJS: quality.requiresJS,
        suggestedAction: quality.suggestion,
        issues: quality.issues,
        excerpt: mdResult.excerpt,
        byline: mdResult.byline,
        wasReadabilityUsed: mdResult.wasReadabilityUsed,
        wasTruncated: mdResult.wasTruncated,
      };
    } catch (error: unknown) {
      // Handle abort errors specially
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          url: args.url,
          title: '',
          content: '',
          contentType: 'error',
          qualityScore: 0,
          requiresJS: false,
          error: `Request timeout after ${args.timeout || 10000}ms`,
        };
      }

      return {
        success: false,
        url: args.url,
        title: '',
        content: '',
        contentType: 'error',
        qualityScore: 0,
        requiresJS: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
