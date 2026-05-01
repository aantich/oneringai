/**
 * Google Drive - Read File Tool
 *
 * Downloads a file from Google Drive and converts it to markdown
 * using DocumentReader. Handles both native Google formats (Docs, Sheets, Slides)
 * and uploaded binary files.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import { DocumentReader, mergeTextPieces } from '../../capabilities/documents/DocumentReader.js';
import { FormatDetector } from '../../capabilities/documents/FormatDetector.js';
import {
  type GoogleReadFileResult,
  type GoogleDriveFile,
  getGoogleUserId,
  googleFetch,
  formatFileSize,
  getFileSizeLimit,
  isGoogleNativeFormat,
  GOOGLE_NATIVE_MIME_TYPES,
  SUPPORTED_EXTENSIONS,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  GoogleAPIError,
  formatGoogleToolError,
} from './types.js';

// ---- Args ----

interface ReadFileArgs {
  fileId: string;
  targetUser?: string;
}

// ---- Config ----

export interface GoogleReadFileConfig {
  /** Default max file size in bytes (default: 50 MB). */
  maxFileSizeBytes?: number;
  /** Per-extension size limits in bytes. Merged with built-in defaults. */
  fileSizeLimits?: Record<string, number>;
}

// ---- Tool Factory ----

/**
 * @param config Optional file size limits.
 *
 * NOTE on `actAs` lock — this tool does NOT participate. It hits
 * `/drive/v3/files/{fileId}`, fetched by ID and not user-scoped at the URL
 * level. Data scope is whatever the underlying token can see.
 */
export function createGoogleReadFileTool(
  connector: Connector,
  userId?: string,
  config?: GoogleReadFileConfig,
): ToolFunction<ReadFileArgs, GoogleReadFileResult> {
  const reader = DocumentReader.create();
  const defaultLimit = config?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const sizeOverrides = config?.fileSizeLimits;

  return {
    definition: {
      type: 'function',
      function: {
        name: 'read_file',
        description: `Read a file from Google Drive and return its content as **markdown text**.

Use this tool when you need to read the contents of a document stored in Google Drive. The file is downloaded and automatically converted to clean markdown — you will never receive raw binary data.

**Supported formats:**
- **Google-native:** Google Docs, Google Sheets, Google Slides (automatically exported and converted)
- **Uploaded files:** .docx, .pptx, .xlsx, .csv, .pdf, .odt, .odp, .ods, .rtf, .html, .txt, .md, .json, .xml, .yaml
- **Not supported:** images, videos, executables, Google Forms, Google Drawings

**The \`fileId\` parameter:** Use the file ID from Google Drive. You can get this from:
- The list_files or search_files tools
- A Google Drive URL: \`https://docs.google.com/document/d/{fileId}/edit\`
- A shared link: \`https://drive.google.com/file/d/{fileId}/view\`

**Maximum file size:** 50 MB (100 MB for presentations).

**Returns:** The file content as markdown text, along with metadata (filename, size, MIME type, webUrl). For spreadsheets, each sheet is converted to markdown key-value records. For presentations, each slide becomes a section.`,
        parameters: {
          type: 'object',
          properties: {
            fileId: {
              type: 'string',
              description: 'The Google Drive file ID. Get this from list_files, search_files, or from a Drive URL.',
            },
            targetUser: {
              type: 'string',
              description: 'User email for service-account auth. Ignored in delegated auth.',
            },
          },
          required: ['fileId'],
        },
      },
      blocking: true,
      timeout: 60000,
    },

    describeCall: (args: ReadFileArgs): string => {
      return `Read: ${args.fileId}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Read a file from Google Drive via ${connector.displayName}`,
    },

    execute: async (
      args: ReadFileArgs,
      context?: ToolContext,
    ): Promise<GoogleReadFileResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      if (!args.fileId || !args.fileId.trim()) {
        return {
          success: false,
          error: 'The "fileId" parameter is required. Provide a Google Drive file ID.',
        };
      }

      try {
        // Ensure user auth is valid for service accounts (Drive endpoint doesn't
        // take user-prefix in URL; this is validation only)
        getGoogleUserId(connector, args.targetUser);

        // 1. Get file metadata
        const metadata = await googleFetch<GoogleDriveFile>(
          connector,
          `/drive/v3/files/${args.fileId}`,
          {
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            queryParams: {
              fields: 'id,name,mimeType,size,webViewLink,modifiedTime,trashed',
            },
          }
        );

        if (metadata.trashed) {
          return {
            success: false,
            filename: metadata.name,
            error: `File "${metadata.name}" is in the trash. Restore it first to read its contents.`,
          };
        }

        const mimeType = metadata.mimeType;
        const isNative = isGoogleNativeFormat(mimeType);

        // 2. Handle Google-native formats (Docs, Sheets, Slides)
        if (isNative) {
          const exportConfig = GOOGLE_NATIVE_MIME_TYPES[mimeType];

          if (!exportConfig) {
            return {
              success: false,
              filename: metadata.name,
              mimeType,
              error: `Google format "${mimeType}" is not supported for text extraction. Supported: Google Docs, Sheets, Slides.`,
            };
          }

          // For Google Docs, export as plain text (no conversion needed)
          if (mimeType === 'application/vnd.google-apps.document') {
            const textContent = await googleFetch<string>(
              connector,
              `/drive/v3/files/${args.fileId}/export`,
              {
                userId: effectiveUserId,
                accountId: effectiveAccountId,
                queryParams: { mimeType: 'text/plain' },
                accept: 'text/plain',
              }
            );

            const markdown = typeof textContent === 'string' ? textContent : String(textContent);

            if (!markdown || markdown.trim().length === 0) {
              return {
                success: true,
                filename: metadata.name,
                mimeType,
                webUrl: metadata.webViewLink,
                markdown: '*(empty document — no text content found)*',
              };
            }

            return {
              success: true,
              filename: metadata.name,
              mimeType,
              webUrl: metadata.webViewLink,
              markdown,
            };
          }

          // For Sheets and Slides, export as xlsx/pptx and convert via DocumentReader
          const exportResponse = await connector.fetch(
            `/drive/v3/files/${args.fileId}/export?mimeType=${encodeURIComponent(exportConfig.exportMimeType)}`,
            { method: 'GET' },
            effectiveUserId,
            effectiveAccountId,
          );

          if (!exportResponse.ok) {
            throw new GoogleAPIError(
              exportResponse.status,
              exportResponse.statusText,
              await exportResponse.text(),
            );
          }

          const arrayBuffer = await exportResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          const result = await reader.read(
            { type: 'buffer', buffer, filename: `${metadata.name}${exportConfig.extension}` },
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

          return {
            success: true,
            filename: metadata.name,
            mimeType,
            webUrl: metadata.webViewLink,
            markdown: markdown && markdown.trim().length > 0
              ? markdown
              : '*(empty document — no text content found)*',
          };
        }

        // 3. Handle uploaded binary files (docx, pdf, etc.)
        const fileSize = metadata.size ? parseInt(metadata.size, 10) : 0;
        const ext = getExtension(metadata.name);

        // Check file size
        const sizeLimit = getFileSizeLimit(ext, sizeOverrides, defaultLimit);
        if (fileSize > sizeLimit) {
          return {
            success: false,
            filename: metadata.name,
            sizeBytes: fileSize,
            error: `File "${metadata.name}" is ${formatFileSize(fileSize)}, which exceeds ` +
              `the ${formatFileSize(sizeLimit)} limit for ${ext || 'this file type'}.`,
          };
        }

        // Check extension support
        if (ext && !SUPPORTED_EXTENSIONS.has(ext) && !FormatDetector.isBinaryDocumentFormat(ext)) {
          return {
            success: false,
            filename: metadata.name,
            mimeType,
            error: `File format "${ext}" is not supported for text extraction. ` +
              `Supported formats: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
          };
        }

        // Download binary content
        const response = await connector.fetch(
          `/drive/v3/files/${args.fileId}?alt=media`,
          { method: 'GET' },
          effectiveUserId,
          effectiveAccountId,
        );

        if (!response.ok) {
          throw new GoogleAPIError(response.status, response.statusText, await response.text());
        }

        const arrayBuffer = await response.arrayBuffer();
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
            sizeBytes: fileSize,
            mimeType,
            webUrl: metadata.webViewLink,
            markdown: '*(empty document — no text content found)*',
          };
        }

        return {
          success: true,
          filename: metadata.name,
          sizeBytes: fileSize,
          mimeType,
          webUrl: metadata.webViewLink,
          markdown,
        };
      } catch (error) {
        if (error instanceof GoogleAPIError) {
          if (error.status === 404) {
            return {
              success: false,
              error: `File not found. Check that the file ID "${args.fileId}" is correct and you have access.`,
            };
          }
          if (error.status === 403 || error.status === 401) {
            return {
              success: false,
              error: 'Access denied. The connector may not have sufficient permissions (drive.readonly or drive scope required).',
            };
          }
        }
        return {
          success: false,
          error: formatGoogleToolError('Failed to read file', error),
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
