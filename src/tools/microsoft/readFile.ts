/**
 * Microsoft Graph - Read File Tool
 *
 * Downloads a file from OneDrive or SharePoint and converts it to markdown
 * using DocumentReader. Never returns raw binary content.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { DocumentReader, mergeTextPieces } from '../../capabilities/documents/DocumentReader.js';
import { FormatDetector } from '../../capabilities/documents/FormatDetector.js';
import {
  getUserPathPrefix,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  microsoftFetch,
  getDrivePrefix,
  resolveFileEndpoints,
  formatFileSize,
  getFileSizeLimit,
  isWebUrl,
  isMicrosoftFileUrl,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  SUPPORTED_EXTENSIONS,
  MicrosoftAPIError,
  formatMicrosoftToolError,
  type GraphDriveItem,
  type MicrosoftReadFileResult,
} from './types.js';

// ---- Args ----

interface ReadFileArgs {
  source: string;
  driveId?: string;
  siteId?: string;
  targetUser?: string;
}

// ---- Config ----

export interface MicrosoftReadFileConfig {
  /** Default max file size in bytes (default: 50 MB). Applied when no per-extension limit matches. */
  maxFileSizeBytes?: number;
  /** Per-extension size limits in bytes, e.g. `{ '.pptx': 200 * 1024 * 1024 }`. Merged with built-in defaults. */
  fileSizeLimits?: Record<string, number>;
}

// ---- Tool Factory ----

/**
 * @param config Optional file size limits.
 * @param actAs  Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createMicrosoftReadFileTool(
  connector: Connector,
  userId?: string,
  config?: MicrosoftReadFileConfig,
  actAs?: string,
): ToolFunction<ReadFileArgs, MicrosoftReadFileResult> {
  // Reuse a single DocumentReader instance across invocations (stateless, no resources to leak)
  const reader = DocumentReader.create();
  const defaultLimit = config?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const sizeOverrides = config?.fileSizeLimits;

  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    source: {
      type: 'string',
      description:
        'The file to read. Accepts a web URL (SharePoint/OneDrive link), a file path within the drive (e.g., "/Documents/report.docx"), or a Graph API item ID.',
    },
    driveId: {
      type: 'string',
      description:
        'Optional drive ID. Omit to use the default drive. Only needed when accessing a specific non-default drive.',
    },
    siteId: {
      type: 'string',
      description:
        'Optional SharePoint site ID. Use this instead of driveId to access files in a specific SharePoint site\'s default drive.',
    },
  };
  if (exposeTargetUser) {
    properties.targetUser = TARGET_USER_PARAM_SCHEMA;
  }

  return {
    definition: {
      type: 'function',
      function: {
        name: 'read_file',
        description: `Read a file from Microsoft OneDrive or SharePoint and return its content as **markdown text**.

Use this tool when you need to read the contents of a document stored in OneDrive or SharePoint. The file is downloaded and automatically converted to clean markdown — you will never receive raw binary data.

**Supported formats:** .docx, .pptx, .xlsx, .csv, .pdf, .odt, .odp, .ods, .rtf, .html, .txt, .md, .json, .xml, .yaml
**Not supported:** .doc, .xls, .ppt (legacy Office formats), images, videos, executables.

**The \`source\` parameter is flexible — you can provide any of these:**
- A SharePoint or OneDrive **web URL**: \`https://contoso.sharepoint.com/sites/team/Shared Documents/report.docx\`
- A OneDrive **sharing link**: \`https://1drv.ms/w/s!AmVg...\`
- A **file path** within the drive: \`/Documents/Q4 Report.docx\`
- A Graph API **item ID**: \`01ABCDEF123456\`

When given a web URL, the tool automatically resolves it to the correct Graph API call — no need to manually extract drive or item IDs.

**Maximum file size:** 50 MB (100 MB for presentations). For larger files, use the search or list tools to find smaller alternatives.

**Returns:** The file content as markdown text, along with metadata (filename, size, MIME type, webUrl). For spreadsheets, each sheet is converted to markdown key-value records — every row becomes a block of "**Header**: value" pairs, which is easier for LLMs to parse than wide tables. For presentations, each slide becomes a section.`,
        parameters: {
          type: 'object',
          properties,
          required: ['source'],
        },
      },
      blocking: true,
      timeout: 60000,
    },

    describeCall: (args: ReadFileArgs): string => {
      const src = args.source.length > 80 ? args.source.slice(0, 77) + '...' : args.source;
      return `Read: ${src}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Read a file from OneDrive/SharePoint via ${connector.displayName}`,
    },

    execute: async (
      args: ReadFileArgs,
      context?: ToolContext,
    ): Promise<MicrosoftReadFileResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      // Validate source is non-empty
      if (!args.source || !args.source.trim()) {
        return {
          success: false,
          error: 'The "source" parameter is required. Provide a file URL, path, or item ID.',
        };
      }

      // Validate URLs are Microsoft-owned (SharePoint/OneDrive)
      if (isWebUrl(args.source) && !isMicrosoftFileUrl(args.source)) {
        return {
          success: false,
          error:
            `The URL "${args.source}" does not appear to be a SharePoint or OneDrive link. ` +
            `This tool only supports URLs from *.sharepoint.com, onedrive.live.com, or 1drv.ms. ` +
            `For other URLs, use the web_fetch tool instead.`,
        };
      }

      try {
        // 1. Resolve endpoints
        const userPrefix = getUserPathPrefix(connector, args.targetUser, actAs);
        const drivePrefix = getDrivePrefix(userPrefix, {
          siteId: args.siteId,
          driveId: args.driveId,
        });
        const { metadataEndpoint, contentEndpoint, isSharedUrl } = resolveFileEndpoints(
          args.source,
          drivePrefix,
        );

        // 2. Get file metadata
        // Note: /shares/ endpoint may not support $select for some sharing link types
        const metadataQueryParams: Record<string, string> = isSharedUrl
          ? {}
          : { '$select': 'id,name,size,file,folder,webUrl,parentReference' };
        const metadata = await microsoftFetch<GraphDriveItem>(connector, metadataEndpoint, {
          userId: effectiveUserId,
          accountId: effectiveAccountId,
          queryParams: metadataQueryParams,
        });

        // Validate it's a file, not a folder
        if (metadata.folder) {
          return {
            success: false,
            error:
              `"${metadata.name}" is a folder, not a file. ` +
              `Use the list_files tool to browse folder contents.`,
          };
        }

        // Check file size (per-extension limits, then default)
        const ext = getExtension(metadata.name);
        const sizeLimit = getFileSizeLimit(ext, sizeOverrides, defaultLimit);
        if (metadata.size > sizeLimit) {
          return {
            success: false,
            filename: metadata.name,
            sizeBytes: metadata.size,
            error:
              `File "${metadata.name}" is ${formatFileSize(metadata.size)}, which exceeds ` +
              `the ${formatFileSize(sizeLimit)} limit for ${ext || 'this file type'}. ` +
              `Consider downloading a smaller version or using the search tool to find an alternative.`,
          };
        }

        // Check extension support
        if (ext && !SUPPORTED_EXTENSIONS.has(ext) && !FormatDetector.isBinaryDocumentFormat(ext)) {
          return {
            success: false,
            filename: metadata.name,
            mimeType: metadata.file?.mimeType,
            error:
              `File format "${ext}" is not supported for text extraction. ` +
              `Supported formats: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
          };
        }

        // 3. Download binary content
        const response = await connector.fetch(
          contentEndpoint,
          { method: 'GET' },
          effectiveUserId,
          effectiveAccountId,
        );

        if (!response.ok) {
          throw new MicrosoftAPIError(response.status, response.statusText, await response.text());
        }

        const arrayBuffer = await response.arrayBuffer();
        // Buffer.from(ArrayBuffer) creates a zero-copy view (no data duplication).
        // PDFHandler will copy to a standalone Uint8Array only when needed for pdf.js workers.
        const buffer = Buffer.from(arrayBuffer);

        // 4. Convert to markdown via DocumentReader
        const result = await reader.read(
          { type: 'buffer', buffer, filename: metadata.name },
          {
            extractImages: false,
            formatOptions: {
              excel: { tableFormat: 'markdown-kv' },
            },
          },
        );

        if (!result.success) {
          return {
            success: false,
            filename: metadata.name,
            error: `Failed to convert "${metadata.name}" to markdown: ${result.error ?? 'unknown error'}`,
          };
        }

        const markdown = mergeTextPieces(result.pieces);

        if (!markdown || markdown.trim().length === 0) {
          return {
            success: true,
            filename: metadata.name,
            sizeBytes: metadata.size,
            mimeType: metadata.file?.mimeType,
            webUrl: metadata.webUrl,
            markdown: '*(empty document — no text content found)*',
          };
        }

        return {
          success: true,
          filename: metadata.name,
          sizeBytes: metadata.size,
          mimeType: metadata.file?.mimeType,
          webUrl: metadata.webUrl,
          markdown,
        };
      } catch (error) {
        if (error instanceof MicrosoftAPIError) {
          if (error.status === 404) {
            return {
              success: false,
              error: `File not found. Check that the source "${args.source}" is correct and you have access.${error.requestId ? ` [request-id: ${error.requestId}]` : ''}`,
            };
          }
          if (error.status === 403 || error.status === 401) {
            return {
              success: false,
              error: `Access denied${error.code ? ` (${error.code})` : ''}. The connector may not have sufficient permissions (Files.Read or Sites.Read.All required).${error.requestId ? ` [request-id: ${error.requestId}]` : ''}`,
            };
          }
        }
        return {
          success: false,
          error: formatMicrosoftToolError('Failed to read file', error),
        };
      }
    },
  };
}

// ---- Helpers ----

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return '';
  return filename.slice(dot).toLowerCase();
}
