import { getAuthenticatedUserId, toSlackTimestamp } from './types.js';
import { badPage, fetchPage, pageToken, rows, total, type PageReader } from '../connector/pages/common.js';

export function slackPage(operation: string): PageReader | undefined {
  const endpoint: Record<string, string> = { list_channels: '/conversations.list', get_messages: '/conversations.history', get_thread: '/conversations.replies', get_users: '/users.list', search_messages: '/search.messages', get_mentions: '/search.messages' };
  if (!endpoint[operation]) return undefined;
  return async request => {
    const { args, previous } = request;
    if (operation === 'search_messages' || operation === 'get_mentions') {
      let query = args.query;
      let selfUserId: string | undefined;
      let page: unknown = previous === undefined ? 1 : previous;
      if (operation === 'get_mentions') {
        if (previous !== undefined && (!previous || typeof previous !== 'object' || !('page' in previous) || !('selfUserId' in previous))) return badPage('invalid mention query position');
        const prior = previous as { page: unknown; selfUserId: unknown } | undefined;
        page = prior?.page ?? 1;
        const user = await getAuthenticatedUserId(request.connector, request.context?.userId ?? request.userId, request.context?.accountId);
        if (!user) return badPage('authentication omitted the Slack user ID');
        if (prior && prior.selfUserId !== user) return badPage('authenticated Slack identity changed; restart the mention query deliberately');
        selfUserId = user;
        query = `<@${user}>` + (args.channel ? ` in:<#${args.channel}>` : '');
      }
      if (!Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > 100) return badPage('invalid Slack search page');
      const { data } = await fetchPage(request, endpoint[operation]!, { query, page, count: args.pageSize, sort: args.sort, sort_dir: args.sortDirection });
      const messages = data.messages, items = rows(messages?.matches, 'messages.matches');
      const paging = messages?.pagination ?? messages?.paging;
      const current = total(paging?.page), pages = total(paging?.page_count ?? paging?.pages);
      const valid = current === page && pages !== undefined && (pages === 0 || pages >= Number(page));
      return { items, reportedTotal: total(messages?.total ?? paging?.total_count ?? paging?.total), coverage: 'unknown', source: data,
        ...(!valid ? { unknown: 'provider_search_position_unknown' } : Number(page) < pages! ? Number(page) >= 100 ? { unknown: 'provider_search_page_ceiling' } : { next: selfUserId ? { page: Number(page) + 1, selfUserId } : Number(page) + 1 } : { end: true }) };
    }
    if (previous !== undefined && typeof previous !== 'string') return badPage('invalid Slack cursor');
    if (operation === 'get_users' && args.userId) {
      if (previous !== undefined) return badPage('single-user lookup has no continuation');
      const { data } = await fetchPage(request, '/users.info', { user: args.userId });
      if (!data.user || typeof data.user !== 'object') return badPage('provider omitted user');
      return { items: [data.user], coverage: 'complete', end: true, source: data };
    }
    const params: Record<string, unknown> = { limit: args.pageSize, cursor: previous };
    if (operation === 'list_channels') Object.assign(params, { types: ({ public: 'public_channel', private: 'private_channel', dm: 'im', mpim: 'mpim', all: 'public_channel,private_channel,im,mpim' } as Record<string, string>)[args.type], exclude_archived: args.excludeArchived });
    if (operation === 'get_messages' || operation === 'get_thread') Object.assign(params, { channel: args.channel, ts: args.ts,
      oldest: args.oldest === undefined ? undefined : toSlackTimestamp(args.oldest), latest: args.latest === undefined ? undefined : toSlackTimestamp(args.latest) });
    const { data } = await fetchPage(request, endpoint[operation]!, params);
    const key = operation === 'list_channels' ? 'channels' : operation === 'get_users' ? 'members' : 'messages';
    let items = rows(data[key], key);
    if (operation === 'get_users' && !args.includeDeactivated) items = items.filter(item => item.deleted !== true);
    const next = data.response_metadata?.next_cursor;
    const position = typeof next === 'string' && next.trim() ? { next } : data.has_more === true ? { unknown: 'provider_more_without_usable_cursor' }
      : data.has_more === false ? { end: true } : data.response_metadata && Object.hasOwn(data.response_metadata, 'next_cursor') ? pageToken(next, true) : { unknown: 'provider_cursor_status_missing' };
    return { items, coverage: 'complete', ...position, source: data };
  };
}
