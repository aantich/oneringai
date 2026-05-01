/**
 * Google Drive - Search Files Tool
 *
 * Searches for files across Google Drive using full-text search.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleSearchFilesResult,
  type GoogleDriveFile,
  type GoogleDriveFileListResponse,
  getGoogleUserId,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  googleFetch,
  formatFileSize,
  formatGoogleToolError,
} from './types.js';

interface SearchFilesArgs {
  query: string;
  fileTypes?: string[];
  folderId?: string;
  limit?: number;
  targetUser?: string;
}

/**
 * Map common file type names to Google Drive MIME types or file extensions
 */
function buildFileTypeQuery(fileTypes: string[]): string {
  const mimeTypeMap: Record<string, string> = {
    'doc': "mimeType = 'application/vnd.google-apps.document'",
    'docs': "mimeType = 'application/vnd.google-apps.document'",
    'document': "mimeType = 'application/vnd.google-apps.document'",
    'sheet': "mimeType = 'application/vnd.google-apps.spreadsheet'",
    'sheets': "mimeType = 'application/vnd.google-apps.spreadsheet'",
    'spreadsheet': "mimeType = 'application/vnd.google-apps.spreadsheet'",
    'slide': "mimeType = 'application/vnd.google-apps.presentation'",
    'slides': "mimeType = 'application/vnd.google-apps.presentation'",
    'presentation': "mimeType = 'application/vnd.google-apps.presentation'",
    'folder': "mimeType = 'application/vnd.google-apps.folder'",
    'pdf': "mimeType = 'application/pdf'",
    'docx': "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
    'xlsx': "mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
    'pptx': "mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'",
    'csv': "mimeType = 'text/csv'",
    'txt': "mimeType = 'text/plain'",
    'image': "mimeType contains 'image/'",
    'video': "mimeType contains 'video/'",
    'audio': "mimeType contains 'audio/'",
  };

  // Validate MIME type format: type/subtype (e.g., "application/pdf")
  const mimeRegex = /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/;

  const conditions = fileTypes.map(ft => {
    const lower = ft.toLowerCase().replace(/^\./, '');
    if (mimeTypeMap[lower]) return mimeTypeMap[lower]!;
    // Only allow valid MIME types in the query; fall back to name search for anything else
    if (mimeRegex.test(ft)) return `mimeType = '${ft}'`;
    return `name contains '${lower.replace(/'/g, '')}'`;
  });

  if (conditions.length === 1) return conditions[0]!;
  return `(${conditions.join(' or ')})`;
}

/**
 * Create a Google Drive search_files tool
 *
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createGoogleSearchFilesTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<SearchFilesArgs, GoogleSearchFilesResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    query: {
      type: 'string',
      description: 'Search query. Searches file names and contents.',
    },
    fileTypes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Filter by file type. Examples: "doc", "sheet", "pdf", "image". Optional.',
    },
    folderId: {
      type: 'string',
      description: 'Restrict search to a specific folder (optional).',
    },
    limit: {
      type: 'number',
      description: 'Max results (1-100). Default: 20.',
    },
  };
  if (exposeTargetUser) {
    properties.targetUser = TARGET_USER_PARAM_SCHEMA;
  }

  return {
    definition: {
      type: 'function',
      function: {
        name: 'search_files',
        description: `Search for files across Google Drive using full-text search.

Searches file names AND file contents. Returns matching files with metadata.

**File type filters:** Use common names like "doc", "sheet", "slide", "pdf", "docx", "xlsx", "image", "folder", etc.

EXAMPLES:
- Search all: { "query": "quarterly report" }
- Search by type: { "query": "budget", "fileTypes": ["sheet", "xlsx"] }
- Search in folder: { "query": "notes", "folderId": "1ABC_def_GHI" }`,
        parameters: {
          type: 'object',
          properties,
          required: ['query'],
        },
      },
      blocking: true,
      timeout: 30000,
    },

    describeCall: (args: SearchFilesArgs): string => {
      return `Search Drive: "${args.query}"`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Search files in Google Drive via ${connector.displayName}`,
    },

    execute: async (
      args: SearchFilesArgs,
      context?: ToolContext
    ): Promise<GoogleSearchFilesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        // Validate service account auth (Drive endpoint doesn't take user-prefix in URL)
        getGoogleUserId(connector, args.targetUser, actAs);

        const pageSize = Math.min(args.limit ?? 20, 100);

        // Build the query
        // Google Drive 'contains' is a full-text operator; single quotes in
        // the value are not supported — strip them to avoid query syntax errors
        const sanitizedQuery = args.query.replace(/'/g, '');
        const queryParts: string[] = [
          `fullText contains '${sanitizedQuery}'`,
          'trashed = false',
        ];

        if (args.fileTypes && args.fileTypes.length > 0) {
          queryParts.push(buildFileTypeQuery(args.fileTypes));
        }

        if (args.folderId) {
          queryParts.push(`'${args.folderId}' in parents`);
        }

        const query = queryParts.join(' and ');

        const result = await googleFetch<GoogleDriveFileListResponse>(
          connector,
          '/drive/v3/files',
          {
            userId: effectiveUserId,
            accountId: effectiveAccountId,
            queryParams: {
              q: query,
              fields: 'files(id,name,mimeType,size,webViewLink,modifiedTime,parents,description),nextPageToken',
              pageSize,
            },
          }
        );

        const results = (result.files ?? []).map((file: GoogleDriveFile) => {
          const size = file.size ? parseInt(file.size, 10) : 0;
          return {
            name: file.name,
            path: file.parents?.[0],
            snippet: file.description,
            size,
            sizeFormatted: formatFileSize(size),
            webUrl: file.webViewLink,
            id: file.id,
            lastModified: file.modifiedTime,
            mimeType: file.mimeType,
          };
        });

        return {
          success: true,
          results,
          totalCount: results.length,
          hasMore: Boolean(result.nextPageToken),
        };
      } catch (error) {
        return {
          success: false,
          error: formatGoogleToolError('Failed to search files', error),
        };
      }
    },
  };
}
