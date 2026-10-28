import { resolveRepository } from './types.js';
import { matchGlobPattern } from './searchFiles.js';
import { badPage, fetchPage, nextURL, rows, total, type PageReader } from '../connector/pages/common.js';

export function githubPage(operation: string): PageReader | undefined {
  if (!['search_files', 'search_code', 'list_branches', 'pr_files', 'pr_comments'].includes(operation)) return undefined;
  return async request => {
    const { connector, args, previous } = request;
    const resolved = resolveRepository(args.repository, connector); if (!resolved.success) return badPage(resolved.error);
    const root = `/repos/${encodeURIComponent(resolved.repo.owner)}/${encodeURIComponent(resolved.repo.repo)}`;
    if (operation === 'search_files') {
      if (previous !== undefined) return badPage('GitHub tree endpoint has no continuation');
      const { data } = await fetchPage(request, `${root}/git/trees/${encodeURIComponent(args.ref)}`, { recursive: 1 });
      const items = rows(data.tree, 'tree').filter(item => item.type === 'blob' && matchGlobPattern(args.pattern, item.path));
      return { items, coverage: data.truncated === true ? 'incomplete' : data.truncated === false ? 'complete' : 'unknown', end: true, source: data };
    }
    if (operation === 'search_code' && args.ref !== undefined) return badPage('indexed code-search pages do not support ref; use explicit-ref tree search and read files');
    const endpoint = operation === 'search_code' ? '/search/code' : operation === 'list_branches' ? `${root}/branches`
      : operation === 'pr_files' ? `${root}/pulls/${args.pull_number}/files`
      : args.commentType === 'review_comment' ? `${root}/pulls/${args.pull_number}/comments` : args.commentType === 'review' ? `${root}/pulls/${args.pull_number}/reviews` : `${root}/issues/${args.pull_number}/comments`;
    const query: Record<string, unknown> = { per_page: args.pageSize };
    if (operation === 'list_branches' && args.protected_only !== undefined) query.protected = args.protected_only;
    if (operation === 'search_code') {
      query.q = `${args.query} repo:${resolved.repo.owner}/${resolved.repo.repo}` + ['language', 'path', 'extension'].filter(key => args[key]).map(key => ` ${key}:${args[key]}`).join('');
      query.sort = args.sort; query.order = args.sortDirection;
    }
    const { data, headers } = await fetchPage(request, previous === undefined ? endpoint : nextURL(connector, previous, endpoint), previous === undefined ? query : {},
      operation === 'search_code' ? { headers: { Accept: 'application/vnd.github.text-match+json' } } : {});
    let items = rows(operation === 'search_code' ? data.items : data, operation === 'search_code' ? 'items' : 'response');
    if (operation === 'list_branches' && args.filter) items = items.filter(item => typeof item.name === 'string' && item.name.toLowerCase().includes(args.filter.toLowerCase()));
    const link = headers.get('link');
    const matches = link ? [...link.matchAll(/<([^>]+)>\s*;\s*rel="([^"]+)"/g)] : [];
    const next = matches.find(match => match[2]!.split(/\s+/).includes('next'))?.[1];
    let position: { next?: unknown; end?: boolean; unknown?: string };
    if (next) { try { position = { next: nextURL(connector, next, endpoint) }; } catch { position = { unknown: 'provider_continuation_origin_path_or_value_invalid' }; } }
    else position = link && !matches.length ? { unknown: 'provider_link_header_unusable' } : { end: true };
    const reportedTotal = operation === 'search_code' ? total(data.total_count) : undefined;
    // Provider ceilings are not evidence that the requested corpus was exhausted.
    const searchCoverage = operation === 'search_code' ? data.incomplete_results === true || (reportedTotal ?? 0) > 1000 ? 'incomplete' : data.incomplete_results === false ? 'complete' : 'unknown'
      : operation === 'pr_files' ? 'unknown' : 'complete';
    return { items, reportedTotal, coverage: searchCoverage, ...position, source: { body: data, ...(link ? { link } : {}) } };
  };
}
