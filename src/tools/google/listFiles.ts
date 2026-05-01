/**
 * Google Drive - List Files Tool
 *
 * Lists files and folders in Google Drive.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GoogleListFilesResult,
  type GoogleDriveFile,
  type GoogleDriveFileListResponse,
  getGoogleUserId,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  googleFetch,
  formatFileSize,
  formatGoogleToolError,
} from './types.js';

interface ListFilesArgs {
  folderId?: string;
  search?: string;
  limit?: number;
  targetUser?: string;
}

/**
 * Convert a Drive file to our list item format
 */
function mapDriveFile(file: GoogleDriveFile): GoogleListFilesResult['items'] extends (infer T)[] | undefined ? T : never {
  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
  const size = file.size ? parseInt(file.size, 10) : 0;

  return {
    name: file.name,
    type: isFolder ? 'folder' : 'file',
    size,
    sizeFormatted: formatFileSize(size),
    mimeType: file.mimeType,
    lastModified: file.modifiedTime,
    webUrl: file.webViewLink,
    id: file.id,
  };
}

/**
 * Create a Google Drive list_files tool
 *
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 */
export function createGoogleListFilesTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<ListFilesArgs, GoogleListFilesResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    folderId: {
      type: 'string',
      description: 'Folder ID to list contents of. Omit for root ("My Drive").',
    },
    search: {
      type: 'string',
      description: 'Filter files by name (optional). Searches within the specified folder.',
    },
    limit: {
      type: 'number',
      description: 'Max results (1-200). Default: 100.',
    },
  };
  if (exposeTargetUser) {
    properties.targetUser = TARGET_USER_PARAM_SCHEMA;
  }

  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_files',
        description: `List files and folders in Google Drive.

By default lists files in the root folder ("My Drive"). Use folderId to browse a specific folder.

**Finding folder IDs:**
- Use this tool without folderId to see root-level items
- Use the search_files tool to find specific files/folders
- Extract from Google Drive URLs: \`https://drive.google.com/drive/folders/{folderId}\`

**The search parameter** lets you filter results by name within the specified folder (or root).

EXAMPLES:
- List root: {}
- List folder: { "folderId": "1ABC_def_GHI" }
- Filter by name: { "search": "quarterly report" }`,
        parameters: {
          type: 'object',
          properties,
        },
      },
      blocking: true,
      timeout: 30000,
    },

    describeCall: (args: ListFilesArgs): string => {
      if (args.search) return `List files matching "${args.search}"`;
      if (args.folderId) return `List files in folder: ${args.folderId}`;
      return 'List files in root';
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `List files in Google Drive via ${connector.displayName}`,
    },

    execute: async (
      args: ListFilesArgs,
      context?: ToolContext
    ): Promise<GoogleListFilesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;

      try {
        // Validate service account auth (Drive endpoint doesn't take user-prefix in URL)
        getGoogleUserId(connector, args.targetUser, actAs);

        const pageSize = Math.min(args.limit ?? 100, 200);

        // Build the query
        const queryParts: string[] = ['trashed = false'];

        if (args.folderId) {
          queryParts.push(`'${args.folderId}' in parents`);
        } else if (!args.search) {
          // Only restrict to root when not searching
          queryParts.push("'root' in parents");
        }

        if (args.search) {
          // Google Drive 'contains' is a full-text operator; single quotes in
          // the value are not supported — strip them to avoid query syntax errors
          const sanitized = args.search.replace(/'/g, '');
          queryParts.push(`name contains '${sanitized}'`);
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
              fields: 'files(id,name,mimeType,size,webViewLink,modifiedTime),nextPageToken,incompleteSearch',
              pageSize,
              orderBy: 'folder,name',
            },
          }
        );

        const items = (result.files ?? []).map(mapDriveFile);

        return {
          success: true,
          items,
          totalCount: items.length,
          hasMore: Boolean(result.nextPageToken),
        };
      } catch (error) {
        return {
          success: false,
          error: formatGoogleToolError('Failed to list files', error),
        };
      }
    },
  };
}
