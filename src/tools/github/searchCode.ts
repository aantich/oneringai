/**
 * GitHub Search Code Tool
 *
 * Search for code content across a GitHub repository.
 * Mirrors the local `grep` tool for remote GitHub repos.
 *
 * Uses the GitHub Code Search API with text-match support for default branch.
 * Falls back to tree + blob scanning when a specific branch/ref is requested,
 * since GitHub's code search API only indexes the default branch.
 *
 * Note: GitHub's code search API has a rate limit of 30 requests/minute.
 */

import type { Connector } from '../../core/Connector.js';
import type { ToolFunction, ToolContext } from '../../domain/entities/Tool.js';
import {
  type GitHubSearchCodeResult,
  type GitHubSearchCodeResponse,
  type GitHubTreeResponse,
  type GitHubRepoResponse,
  resolveRepository,
  githubFetch,
  formatGitHubToolError,
} from './types.js';

/**
 * Arguments for the search_code tool
 */
export interface SearchCodeArgs {
  /** Repository in "owner/repo" format or full GitHub URL */
  repository?: string;
  /** Search query (keyword or phrase) */
  query: string;
  /** Branch, tag, or commit SHA. Defaults to the repository's default branch. */
  ref?: string;
  /** Filter by programming language (e.g., "typescript", "python") */
  language?: string;
  /** Filter by file path (e.g., "src/", "lib/utils") */
  path?: string;
  /** Filter by file extension (e.g., "ts", "py") */
  extension?: string;
  /** Maximum number of results (default: 30, max: 100) */
  limit?: number;
}

/** Max files to scan in tree-based fallback */
const TREE_SEARCH_MAX_FILES = 50;

/**
 * Language → common file extensions mapping for tree-based search
 */
const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: ['ts', 'tsx', 'mts', 'cts'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  python: ['py', 'pyw'],
  go: ['go'],
  rust: ['rs'],
  java: ['java'],
  ruby: ['rb'],
  php: ['php'],
  c: ['c', 'h'],
  'c++': ['cpp', 'cc', 'cxx', 'hpp', 'hxx', 'h'],
  'c#': ['cs'],
  swift: ['swift'],
  kotlin: ['kt', 'kts'],
  scala: ['scala'],
  shell: ['sh', 'bash', 'zsh'],
  html: ['html', 'htm'],
  css: ['css', 'scss', 'sass', 'less'],
  json: ['json'],
  yaml: ['yaml', 'yml'],
  markdown: ['md', 'mdx'],
};

/**
 * Check if a file path matches the given filters
 */
function matchesFilters(
  filePath: string,
  pathFilter?: string,
  extensionFilter?: string,
  languageFilter?: string
): boolean {
  if (pathFilter && !filePath.startsWith(pathFilter.replace(/\/$/, '') + '/') && !filePath.startsWith(pathFilter)) {
    return false;
  }
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (extensionFilter && ext !== extensionFilter.toLowerCase()) {
    return false;
  }
  if (languageFilter) {
    const langExts = LANGUAGE_EXTENSIONS[languageFilter.toLowerCase()];
    if (langExts && ext && !langExts.includes(ext)) {
      return false;
    }
  }
  return true;
}

/**
 * Create a GitHub search_code tool
 */
export function createSearchCodeTool(
  connector: Connector,
  userId?: string
): ToolFunction<SearchCodeArgs, GitHubSearchCodeResult> {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'search_code',
        description: `Search for code content across a GitHub repository.

USAGE:
- Search by keyword, function name, class name, or any text
- Filter by language, path, or file extension
- Optionally specify a branch/tag/SHA with "ref" (defaults to the default branch)
- Returns matching files with text fragments showing context

BRANCH SUPPORT:
- Default branch: uses GitHub's fast Code Search API
- Other branches: scans files via Git Trees API (slower, limited to ${TREE_SEARCH_MAX_FILES} files)
- Use list_branches to discover available branches first

RATE LIMITS:
- GitHub's code search API is limited to 30 requests per minute
- Results may be incomplete for very large repositories

EXAMPLES:
- Find function: { "query": "function handleAuth", "language": "typescript" }
- Find imports: { "query": "import React", "extension": "tsx" }
- Search in path: { "query": "TODO", "path": "src/utils" }
- Search on branch: { "query": "handleAuth", "ref": "feature/auth", "extension": "ts" }
- Limit results: { "query": "console.log", "limit": 10 }`,
        parameters: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description:
                'Repository in "owner/repo" format or full GitHub URL. Optional if connector has a default repository.',
            },
            query: {
              type: 'string',
              description: 'Search query — keyword, function name, or any text to find in code',
            },
            ref: {
              type: 'string',
              description:
                'Branch, tag, or commit SHA to search. Defaults to the repository\'s default branch. Note: non-default branches use a slower tree-based search.',
            },
            language: {
              type: 'string',
              description: 'Filter by programming language (e.g., "typescript", "python", "go")',
            },
            path: {
              type: 'string',
              description: 'Filter by file path prefix (e.g., "src/", "lib/utils")',
            },
            extension: {
              type: 'string',
              description: 'Filter by file extension without dot (e.g., "ts", "py", "go")',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 30, max: 100)',
            },
          },
          required: ['query'],
        },
      },
    },

    describeCall: (args: SearchCodeArgs): string => {
      const parts = [`"${args.query}"`];
      if (args.language) parts.push(`lang:${args.language}`);
      if (args.ref) parts.push(`@${args.ref}`);
      if (args.repository) parts.push(`in ${args.repository}`);
      return parts.join(' ');
    },

    permission: {
      scope: 'session',
      riskLevel: 'low',
      approvalMessage: `Search code in a GitHub repository via ${connector.displayName}`,
    },

    execute: async (args: SearchCodeArgs, context?: ToolContext): Promise<GitHubSearchCodeResult> => {
      const effectiveUserId = context?.userId ?? userId;
      const effectiveAccountId = context?.accountId;
      const resolved = resolveRepository(args.repository, connector);
      if (!resolved.success) {
        return { success: false, error: resolved.error };
      }
      const { owner, repo } = resolved.repo;

      try {
        // Determine if we need tree-based search (non-default branch)
        let useTreeSearch = false;
        if (args.ref) {
          // Check if ref matches default branch
          const repoInfo = await githubFetch<GitHubRepoResponse>(
            connector,
            `/repos/${owner}/${repo}`,
            { userId: effectiveUserId, accountId: effectiveAccountId }
          );
          useTreeSearch = args.ref !== repoInfo.default_branch;
        }

        if (useTreeSearch) {
          return await treeBasedSearch(
            connector,
            owner,
            repo,
            args,
            effectiveUserId,
            effectiveAccountId
          );
        }

        // Standard GitHub Code Search API (default branch)
        return await apiBasedSearch(
          connector,
          owner,
          repo,
          args,
          effectiveUserId,
          effectiveAccountId
        );
      } catch (error) {
        return {
          success: false,
          error: formatGitHubToolError('Failed to search code', error),
        };
      }
    },
  };
}

/**
 * Search using GitHub's Code Search API (fast, default branch only)
 */
async function apiBasedSearch(
  connector: Connector,
  owner: string,
  repo: string,
  args: SearchCodeArgs,
  userId?: string,
  accountId?: string
): Promise<GitHubSearchCodeResult> {
  const qualifiers = [`repo:${owner}/${repo}`];
  if (args.language) qualifiers.push(`language:${args.language}`);
  if (args.path) qualifiers.push(`path:${args.path}`);
  if (args.extension) qualifiers.push(`extension:${args.extension}`);

  const q = `${args.query} ${qualifiers.join(' ')}`;
  const perPage = Math.min(args.limit ?? 30, 100);

  const result = await githubFetch<GitHubSearchCodeResponse>(
    connector,
    `/search/code`,
    {
      userId,
      accountId,
      accept: 'application/vnd.github.text-match+json',
      queryParams: { q, per_page: perPage },
    }
  );

  const matches = result.items.map((item) => ({
    file: item.path,
    fragment: item.text_matches?.[0]?.fragment,
  }));

  return {
    success: true,
    matches,
    count: result.total_count,
    truncated: result.incomplete_results || result.total_count > perPage,
  };
}

/**
 * Search by fetching the file tree and scanning blobs (slower, supports any ref)
 */
async function treeBasedSearch(
  connector: Connector,
  owner: string,
  repo: string,
  args: SearchCodeArgs,
  userId?: string,
  accountId?: string
): Promise<GitHubSearchCodeResult> {
  const ref = args.ref!;
  const perPage = Math.min(args.limit ?? 30, 100);

  // Fetch full tree for the ref
  const tree = await githubFetch<GitHubTreeResponse>(
    connector,
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { userId, accountId }
  );

  // Filter to blobs matching path/extension/language criteria
  const candidates = tree.tree
    .filter(
      (entry) =>
        entry.type === 'blob' &&
        matchesFilters(entry.path, args.path, args.extension, args.language)
    )
    // Skip very large files (>500KB) and binary-looking files
    .filter((entry) => (entry.size ?? 0) < 500_000)
    // Sort smaller files first (more likely text, faster to fetch)
    .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
    .slice(0, TREE_SEARCH_MAX_FILES);

  if (candidates.length === 0) {
    return {
      success: true,
      matches: [],
      count: 0,
      truncated: false,
    };
  }

  // Search each candidate file for the query
  const queryLower = args.query.toLowerCase();
  const matches: { file: string; fragment?: string }[] = [];

  // Fetch files in parallel (batches of 10)
  const batchSize = 10;
  for (let i = 0; i < candidates.length && matches.length < perPage; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const blob = await githubFetch<{ content: string; encoding: string; size: number }>(
          connector,
          `/repos/${owner}/${repo}/git/blobs/${entry.sha}`,
          { userId, accountId }
        );
        const content = Buffer.from(blob.content, 'base64').toString('utf-8');
        return { path: entry.path, content };
      })
    );

    for (const result of results) {
      if (matches.length >= perPage) break;
      if (result.status !== 'fulfilled') continue;

      const { path, content } = result.value;
      const contentLower = content.toLowerCase();
      const idx = contentLower.indexOf(queryLower);
      if (idx === -1) continue;

      // Extract a fragment around the match (similar to GitHub's text_matches)
      const lineStart = content.lastIndexOf('\n', idx) + 1;
      const lineEnd = content.indexOf('\n', idx + args.query.length);
      const fragment = content.substring(
        lineStart,
        lineEnd === -1 ? Math.min(content.length, lineStart + 200) : Math.min(lineEnd, lineStart + 200)
      );

      matches.push({ file: path, fragment });
    }
  }

  const scannedAll = candidates.length <= TREE_SEARCH_MAX_FILES && !tree.truncated;

  return {
    success: true,
    matches,
    count: matches.length,
    truncated: !scannedAll,
  };
}
