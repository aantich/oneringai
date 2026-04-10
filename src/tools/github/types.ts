/**
 * GitHub Tools - Shared Types and Helpers
 *
 * Foundation for all GitHub connector tools.
 * Provides repository resolution, authenticated fetch, and result types.
 */

import type { Connector } from '../../core/Connector.js';

// ============================================================================
// Repository Resolution
// ============================================================================

/**
 * Parsed GitHub repository reference
 */
export interface GitHubRepository {
  owner: string;
  repo: string;
}

/**
 * Parse a repository string into owner and repo.
 *
 * Accepts:
 * - "owner/repo" format
 * - Full GitHub URLs: "https://github.com/owner/repo", "https://github.com/owner/repo/..."
 *
 * @throws Error if the format is not recognized
 */
export function parseRepository(input: string): GitHubRepository {
  if (!input || input.trim().length === 0) {
    throw new Error('Repository cannot be empty');
  }

  const trimmed = input.trim();

  // Try URL format
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        return { owner: segments[0]!, repo: segments[1]!.replace(/\.git$/, '') };
      }
    }
  } catch {
    // Not a URL, try owner/repo format
  }

  // Try owner/repo format
  const parts = trimmed.split('/');
  if (parts.length === 2 && parts[0]!.length > 0 && parts[1]!.length > 0) {
    return { owner: parts[0]!, repo: parts[1]! };
  }

  throw new Error(
    `Invalid repository format: "${input}". Expected "owner/repo" or "https://github.com/owner/repo"`
  );
}

/**
 * Resolve a repository from tool args or connector default.
 *
 * Priority:
 * 1. Explicit `repository` parameter
 * 2. `connector.getOptions().defaultRepository`
 *
 * @returns GitHubRepository or an error result
 */
export function resolveRepository(
  repository: string | undefined,
  connector: Connector
): { success: true; repo: GitHubRepository } | { success: false; error: string } {
  const repoStr = repository ?? (connector.getOptions().defaultRepository as string | undefined);

  if (!repoStr) {
    return {
      success: false,
      error:
        'No repository specified. Provide a "repository" parameter (e.g., "owner/repo") or configure defaultRepository on the connector.',
    };
  }

  try {
    return { success: true, repo: parseRepository(repoStr) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// GitHub API Helpers
// ============================================================================

/**
 * Options for githubFetch
 */
export interface GitHubFetchOptions {
  method?: string;
  body?: unknown;
  userId?: string;
  accountId?: string;
  accept?: string;
  queryParams?: Record<string, string | number | boolean>;
}

/**
 * Error from GitHub API
 */
export class GitHubAPIError extends Error {
  /** Documentation URL from GitHub error response */
  public readonly documentationUrl: string | undefined;

  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown
  ) {
    let msg = statusText;
    let docUrl: string | undefined;

    if (typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>;
      if (typeof b.message === 'string') msg = b.message;
      if (typeof b.documentation_url === 'string') docUrl = b.documentation_url;
    }

    const parts = [`GitHub API error ${status}: ${msg}`];
    if (docUrl) parts.push(` — see ${docUrl}`);

    super(parts.join(''));
    this.name = 'GitHubAPIError';
    this.documentationUrl = docUrl;
  }
}

/**
 * Format any error caught in a GitHub tool's catch block into a detailed string.
 */
export function formatGitHubToolError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: ${String(error)}`;
}

/**
 * Make an authenticated GitHub API request through the connector.
 *
 * Adds standard GitHub headers and parses JSON response.
 * Throws GitHubAPIError on non-ok responses.
 */
export async function githubFetch<T = unknown>(
  connector: Connector,
  endpoint: string,
  options?: GitHubFetchOptions
): Promise<T> {
  let url = endpoint;

  // Add query params if provided
  if (options?.queryParams && Object.keys(options.queryParams).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.queryParams)) {
      params.append(key, String(value));
    }
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  const headers: Record<string, string> = {
    'Accept': options?.accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await connector.fetch(
    url,
    {
      method: options?.method ?? 'GET',
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    },
    options?.userId,
    options?.accountId
  );

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new GitHubAPIError(response.status, response.statusText, data);
  }

  return data as T;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result from search_files tool
 */
export interface GitHubSearchFilesResult {
  success: boolean;
  files?: { path: string; size: number; type: string }[];
  count?: number;
  truncated?: boolean;
  error?: string;
}

/**
 * Result from search_code tool
 */
export interface GitHubSearchCodeResult {
  success: boolean;
  matches?: { file: string; fragment?: string }[];
  count?: number;
  truncated?: boolean;
  error?: string;
}

/**
 * Result from read_file tool (GitHub variant)
 */
export interface GitHubReadFileResult {
  success: boolean;
  content?: string;
  path?: string;
  size?: number;
  lines?: number;
  truncated?: boolean;
  sha?: string;
  error?: string;
}

/**
 * Result from get_pr tool
 */
export interface GitHubGetPRResult {
  success: boolean;
  data?: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    author: string;
    labels: string[];
    reviewers: string[];
    mergeable: boolean | null;
    head: string;
    base: string;
    url: string;
    created_at: string;
    updated_at: string;
    additions: number;
    deletions: number;
    changed_files: number;
    draft: boolean;
  };
  error?: string;
}

/**
 * Result from pr_files tool
 */
export interface GitHubPRFilesResult {
  success: boolean;
  files?: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }[];
  count?: number;
  error?: string;
}

/**
 * A unified comment/review entry
 */
export interface GitHubPRCommentEntry {
  id: number;
  type: 'review' | 'comment' | 'review_comment';
  author: string;
  body: string;
  created_at: string;
  path?: string;
  line?: number;
  state?: string;
}

/**
 * Result from pr_comments tool
 */
export interface GitHubPRCommentsResult {
  success: boolean;
  comments?: GitHubPRCommentEntry[];
  count?: number;
  error?: string;
}

/**
 * A branch entry
 */
export interface GitHubBranchEntry {
  name: string;
  sha: string;
  protected: boolean;
}

/**
 * Result from list_branches tool
 */
export interface GitHubListBranchesResult {
  success: boolean;
  branches?: GitHubBranchEntry[];
  count?: number;
  error?: string;
}

/**
 * Result from create_pr tool
 */
export interface GitHubCreatePRResult {
  success: boolean;
  data?: {
    number: number;
    url: string;
    state: string;
    title: string;
  };
  error?: string;
}

// ============================================================================
// GitHub API Response Types (internal)
// ============================================================================

/** @internal */
export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

/** @internal */
export interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

/** @internal */
export interface GitHubRepoResponse {
  default_branch: string;
  [key: string]: unknown;
}

/** @internal */
export interface GitHubContentResponse {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  encoding?: string;
  size: number;
  name: string;
  path: string;
  content?: string;
  sha: string;
  git_url?: string;
  [key: string]: unknown;
}

/** @internal */
export interface GitHubBlobResponse {
  content: string;
  encoding: string;
  sha: string;
  size: number;
}

/** @internal */
export interface GitHubSearchCodeResponse {
  total_count: number;
  incomplete_results: boolean;
  items: {
    name: string;
    path: string;
    sha: string;
    html_url: string;
    repository: { full_name: string };
    text_matches?: {
      fragment: string;
      matches: { text: string; indices: [number, number] }[];
    }[];
  }[];
}

/** @internal */
export interface GitHubPRResponse {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  user: { login: string };
  labels: { name: string }[];
  requested_reviewers: { login: string }[];
  mergeable: boolean | null;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  html_url: string;
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
}

/** @internal */
export interface GitHubPRFileEntry {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

/** @internal */
export interface GitHubReviewCommentResponse {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
}

/** @internal */
export interface GitHubReviewResponse {
  id: number;
  user: { login: string };
  body: string;
  state: string;
  submitted_at: string;
}

/** @internal */
export interface GitHubIssueCommentResponse {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
}
