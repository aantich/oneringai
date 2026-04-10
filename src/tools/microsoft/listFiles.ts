/**
 * Microsoft Graph - List Files Tool
 *
 * Lists files and folders in a OneDrive or SharePoint directory.
 * Returns metadata only — never file contents.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  getUserPathPrefix,
  microsoftFetch,
  getDrivePrefix,
  encodeSharingUrl,
  isWebUrl,
  formatFileSize,
  formatMicrosoftToolError,
  type GraphDriveItem,
  type GraphDriveItemListResponse,
  type MicrosoftListFilesResult,
} from './types.js';

// ---- Args ----

interface ListFilesArgs {
  path?: string;
  driveId?: string;
  siteId?: string;
  search?: string;
  limit?: number;
  targetUser?: string;
}

// ---- Constants ----

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SELECT_FIELDS = 'id,name,size,lastModifiedDateTime,file,folder,webUrl';

// ---- Tool Factory ----

export function createMicrosoftListFilesTool(
  connector: Connector,
  userId?: string,
): ToolFunction<ListFilesArgs, MicrosoftListFilesResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'list_files',
        description: `List files and folders in a Microsoft OneDrive or SharePoint directory.

Use this tool to browse the contents of a folder, discover available files before reading them, or search within a specific folder. Returns file/folder metadata (name, size, type, last modified, URL) — **never returns file contents**.

**The \`path\` parameter is flexible — you can provide:**
- A **folder path** within the drive: \`/Documents/Projects\` or \`/\` for root
- A SharePoint/OneDrive **folder URL**: \`https://contoso.sharepoint.com/sites/team/Shared Documents/Projects\`
- Omit entirely to list the root of the drive

**Optional search:** Use the \`search\` parameter to filter by filename within the folder tree. This uses Microsoft's server-side search (fast, works across subfolders).

**Tip:** To read a file's content after finding it, use the read_file tool with the file's webUrl or id from these results.`,
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Folder path (e.g., "/Documents/Projects") or a web URL to a SharePoint/OneDrive folder. Omit to list root.',
            },
            driveId: {
              type: 'string',
              description: 'Optional drive ID for a specific non-default drive.',
            },
            siteId: {
              type: 'string',
              description: 'Optional SharePoint site ID to access that site\'s default document library.',
            },
            search: {
              type: 'string',
              description:
                'Optional search query to filter results by filename or content. Searches within the specified folder and all subfolders.',
            },
            limit: {
              type: 'number',
              description: `Maximum number of items to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT}).`,
            },
            targetUser: {
              type: 'string',
              description: 'User ID or email. Only needed with application-only (client_credentials) auth.',
            },
          },
        },
      },
      blocking: true,
      timeout: 30000,
    },

    describeCall: (args: ListFilesArgs): string => {
      const loc = args.path || '/';
      const suffix = args.search ? ` (search: "${args.search}")` : '';
      return `List: ${loc}${suffix}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `List files in OneDrive/SharePoint via ${connector.displayName}`,
    },

    execute: async (
      args: ListFilesArgs,
      context?: ToolContext,
    ): Promise<MicrosoftListFilesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const limit = Math.min(Math.max(1, args.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

      try {
        const userPrefix = getUserPathPrefix(connector, args.targetUser);
        const drivePrefix = getDrivePrefix(userPrefix, {
          siteId: args.siteId,
          driveId: args.driveId,
        });

        let endpoint: string;

        if (args.search) {
          // Search within drive (or folder)
          const folderBase = args.path && !isWebUrl(args.path)
            ? `${drivePrefix}/root:${normalizePath(args.path)}:`
            : drivePrefix;
          endpoint = `${folderBase}/search(q='${encodeSearchQuery(args.search)}')`;
        } else if (args.path) {
          // List specific folder
          if (isWebUrl(args.path)) {
            // Web URL → sharing link → children
            const token = encodeSharingUrl(args.path.trim());
            endpoint = `/shares/${token}/driveItem/children`;
          } else {
            const path = normalizePath(args.path);
            endpoint = path === '/'
              ? `${drivePrefix}/root/children`
              : `${drivePrefix}/root:${path}:/children`;
          }
        } else {
          // List root
          endpoint = `${drivePrefix}/root/children`;
        }

        // $orderby is not supported on the search() endpoint — only include for list operations
        const queryParams: Record<string, string | number | boolean> = {
          '$top': limit,
          '$select': SELECT_FIELDS,
        };
        if (!args.search) {
          queryParams['$orderby'] = 'name asc';
        }

        const data = await microsoftFetch<GraphDriveItemListResponse>(connector, endpoint, {
          userId: effectiveUserId,
          accountId: effectiveAccountId,
          queryParams,
        });

        const items = (data.value || []).map(mapDriveItem);

        return {
          success: true,
          items,
          totalCount: items.length,
          hasMore: !!data['@odata.nextLink'],
        };
      } catch (error) {
        return {
          success: false,
          error: formatMicrosoftToolError('Failed to list files', error),
        };
      }
    },
  };
}

// ---- Helpers ----

function mapDriveItem(item: GraphDriveItem) {
  return {
    name: item.name,
    type: (item.folder ? 'folder' : 'file') as 'file' | 'folder',
    size: item.size,
    sizeFormatted: formatFileSize(item.size),
    mimeType: item.file?.mimeType,
    lastModified: item.lastModifiedDateTime,
    webUrl: item.webUrl,
    id: item.id,
    childCount: item.folder?.childCount,
  };
}

function normalizePath(path: string): string {
  let p = path.trim();
  if (!p.startsWith('/')) p = '/' + p;
  if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1);
  return p;
}

function encodeSearchQuery(query: string): string {
  // Escape special characters for OData search(q='...') syntax
  return query
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''");
}
