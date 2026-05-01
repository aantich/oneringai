/**
 * Microsoft Graph - Search Files Tool
 *
 * Searches across OneDrive and SharePoint for files matching a query.
 * Uses the Microsoft Search API with KQL support.
 * Returns metadata and snippets only — never file contents.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  microsoftFetch,
  formatFileSize,
  formatMicrosoftToolError,
  shouldExposeTargetUserParam,
  TARGET_USER_PARAM_SCHEMA,
  type GraphDriveItemListResponse,
  type GraphSearchResponse,
  type MicrosoftSearchFilesResult,
} from './types.js';

// ---- Args ----

interface SearchFilesArgs {
  query: string;
  siteId?: string;
  fileTypes?: string[];
  limit?: number;
  targetUser?: string;
}

// ---- Constants ----

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---- Tool Factory ----

/**
 * @param actAs Lock the on-behalf-of user; when set, the LLM cannot override.
 *              NOTE: this tool currently uses Microsoft's tenant-global `/search/query`
 *              endpoint, which doesn't take a user-prefix in the URL. The lock here is
 *              for schema consistency — `targetUser` is hidden when `actAs` is set so
 *              the LLM doesn't see an arg it can't use.
 */
export function createMicrosoftSearchFilesTool(
  connector: Connector,
  userId?: string,
  actAs?: string,
): ToolFunction<SearchFilesArgs, MicrosoftSearchFilesResult> {
  const exposeTargetUser = shouldExposeTargetUserParam(connector, actAs);
  const properties: Record<string, unknown> = {
    query: {
      type: 'string',
      description:
        'Search query. Supports plain text and KQL syntax (e.g., "budget report", "filename:spec.docx", "author:john filetype:pptx").',
    },
    siteId: {
      type: 'string',
      description: 'Optional SharePoint site ID to limit search to a specific site.',
    },
    fileTypes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional file type filter. Array of extensions without dots (e.g., ["docx", "pdf", "xlsx"]).',
    },
    limit: {
      type: 'number',
      description: `Maximum number of results (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT}).`,
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
        description: `Search for files across Microsoft OneDrive and SharePoint.

Use this tool when you need to **find** files by name, content, or metadata across all of the user's OneDrive and SharePoint sites. This is a powerful full-text search — it searches inside document content, not just filenames.

**Supports Microsoft's KQL (Keyword Query Language):**
- Simple text: \`"quarterly report"\`
- By filename: \`filename:budget.xlsx\`
- By author: \`author:"Jane Smith"\`
- By date: \`lastModifiedTime>2024-01-01\`
- Combined: \`project proposal filetype:docx\`

**Filter by file type:** Use the \`fileTypes\` parameter (e.g., \`["docx", "pdf"]\`) to restrict results to specific formats.

**Limit to a SharePoint site:** Provide the \`siteId\` parameter to search only within a specific site.

**Returns:** A list of matching files with name, path, site, snippet (text preview), size, and webUrl. Does NOT return file contents — use the read_file tool to read a specific result.

**Tip:** Start with a broad search, then use read_file on the most relevant results.`,
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
      const types = args.fileTypes?.length ? ` [${args.fileTypes.join(',')}]` : '';
      return `Search: "${args.query}"${types}`;
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Search files in OneDrive/SharePoint via ${connector.displayName}`,
    },

    execute: async (
      args: SearchFilesArgs,
      context?: ToolContext,
    ): Promise<MicrosoftSearchFilesResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const limit = Math.min(Math.max(1, args.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

      try {
        // When siteId is provided, use drive-scoped search (simpler and correctly scoped).
        // The global Search API's siteId filtering requires contentSources which is fragile.
        if (args.siteId) {
          return await searchViaDriveEndpoint(
            connector, args, limit, effectiveUserId, effectiveAccountId,
          );
        }

        // Global search via Microsoft Search API (cross-site, full-text, KQL)
        let queryString = args.query;
        if (args.fileTypes?.length) {
          const typeFilter = args.fileTypes.map((t) => `filetype:${t.replace(/^\./, '')}`).join(' OR ');
          queryString = `(${queryString}) (${typeFilter})`;
        }

        const searchRequest: Record<string, unknown> = {
          requests: [
            {
              entityTypes: ['driveItem'],
              query: { queryString },
              from: 0,
              size: limit,
              fields: [
                'id', 'name', 'size', 'webUrl', 'lastModifiedDateTime',
                'parentReference', 'file',
              ],
            },
          ],
        };

        const data = await microsoftFetch<GraphSearchResponse>(connector, '/search/query', {
          method: 'POST',
          body: searchRequest,
          userId: effectiveUserId,
          accountId: effectiveAccountId,
        });

        // Parse results
        const container = data.value?.[0]?.hitsContainers?.[0];
        if (!container?.hits?.length) {
          return {
            success: true,
            results: [],
            totalCount: 0,
            hasMore: false,
          };
        }

        const results = container.hits.map((hit) => {
          const resource = hit.resource;
          return {
            name: resource.name,
            path: resource.parentReference?.path?.replace(/\/drive\/root:/, '') || undefined,
            site: resource.parentReference?.siteId || undefined,
            snippet: hit.summary || undefined,
            size: resource.size,
            sizeFormatted: formatFileSize(resource.size),
            webUrl: resource.webUrl,
            id: resource.id,
            lastModified: resource.lastModifiedDateTime,
          };
        });

        return {
          success: true,
          results,
          totalCount: container.total,
          hasMore: container.moreResultsAvailable,
        };
      } catch (error) {
        return {
          success: false,
          error: formatMicrosoftToolError('Search failed', error),
        };
      }
    },
  };
}

// ---- Helpers ----

/**
 * Site-scoped search using the drive search endpoint.
 * More reliable than the global Search API for filtering by siteId.
 */
async function searchViaDriveEndpoint(
  connector: Connector,
  args: SearchFilesArgs,
  limit: number,
  effectiveUserId?: string,
  effectiveAccountId?: string,
): Promise<MicrosoftSearchFilesResult> {
  const drivePrefix = `/sites/${args.siteId}/drive`;

  // Escape single quotes for OData search syntax
  const escapedQuery = args.query.replace(/'/g, "''");
  const endpoint = `${drivePrefix}/root/search(q='${escapedQuery}')`;

  const data = await microsoftFetch<GraphDriveItemListResponse>(connector, endpoint, {
    userId: effectiveUserId,
    accountId: effectiveAccountId,
    queryParams: {
      '$top': limit,
      '$select': 'id,name,size,webUrl,lastModifiedDateTime,parentReference,file',
    },
  });

  let items = data.value || [];

  // Client-side file type filter (the drive search endpoint doesn't support filetype: in query)
  if (args.fileTypes?.length) {
    const extSet = new Set(args.fileTypes.map((t) => t.replace(/^\./, '').toLowerCase()));
    items = items.filter((item) => {
      const ext = item.name.split('.').pop()?.toLowerCase();
      return ext && extSet.has(ext);
    });
  }

  const results = items.map((item) => ({
    name: item.name,
    path: item.parentReference?.path?.replace(/\/drive\/root:/, '') || undefined,
    site: item.parentReference?.siteId || undefined,
    snippet: undefined,
    size: item.size,
    sizeFormatted: formatFileSize(item.size),
    webUrl: item.webUrl,
    id: item.id,
    lastModified: item.lastModifiedDateTime,
  }));

  return {
    success: true,
    results,
    totalCount: results.length,
    hasMore: !!data['@odata.nextLink'],
  };
}
