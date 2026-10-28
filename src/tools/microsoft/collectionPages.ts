import { getUserPathPrefix, getDrivePrefix, isWebUrl, encodeSharingUrl } from './types.js';
import { normalizePath, encodeSearchQuery } from './listFiles.js';
import { badPage, fetchPage, nextURL, rows, total, type PageReader } from '../connector/pages/common.js';

const path = (value: string): string => normalizePath(value).split('/').map(encodeURIComponent).join('/');
export function microsoftPage(operation: string): PageReader | undefined {
  if (!['list_files', 'search_files', 'list_meetings'].includes(operation)) return undefined;
  return async request => {
    const { args, connector, previous } = request;
    // Tenant/site search is not an on-behalf-of URL and must not invent that lock.
    const rawUser = operation === 'search_files' ? '/me' : getUserPathPrefix(connector, args.targetUser, request.actAs);
    const user = rawUser.startsWith('/users/') ? '/users/' + encodeURIComponent(rawUser.slice(7)) : rawUser;
    const drive = getDrivePrefix(user, { siteId: args.siteId && encodeURIComponent(args.siteId), driveId: args.driveId && encodeURIComponent(args.driveId) });
    if (operation === 'search_files' && !args.siteId) {
      const from = previous === undefined ? 0 : previous;
      if (!Number.isSafeInteger(from) || Number(from) < 0) return badPage('invalid Microsoft search offset');
      let query = args.query;
      if (args.fileTypes?.length) query = `(${query}) (${args.fileTypes.map((v: string) => 'filetype:' + v.replace(/^\./, '')).join(' OR ')})`;
      const { data } = await fetchPage(request, '/search/query', {}, { body: { requests: [{ entityTypes: ['driveItem'], query: { queryString: query }, from, size: args.pageSize }] } });
      const containers = rows(data.value, 'value').flatMap(group => rows(group.hitsContainers, 'hitsContainers'));
      const items = containers.flatMap(container => rows(container.hits ?? [], 'hits'));
      const one = containers.length === 1 ? containers[0] : undefined;
      const more = one?.moreResultsAvailable;
      return { items, ...(total(one?.total) === undefined ? {} : { reportedTotal: total(one.total) }), coverage: 'unknown', source: data,
        ...(more === false ? { end: true } : more === true && items.length ? { next: Number(from) + items.length } : { unknown: more === true ? 'provider_more_without_progress' : 'provider_search_position_unknown' }) };
    }
    if (operation === 'search_files' && args.fileTypes?.length) return badPage('site-scoped search does not support fileTypes; narrow the provider query explicitly');
    let endpoint: string;
    const params: Record<string, unknown> = { '$top': args.pageSize };
    const headers: Record<string, string> = {};
    if (operation === 'list_meetings') {
      endpoint = `${user}/calendarView`;
      Object.assign(params, { startDateTime: args.startDateTime, endDateTime: args.endDateTime, '$orderby': args.orderBy });
      headers.Prefer = `outlook.timezone="${args.timeZone}"`;
    } else if (operation === 'search_files') endpoint = `${drive}/root/search(q='${encodeURIComponent(encodeSearchQuery(args.query))}')`;
    else if (args.search) endpoint = `${args.path && !isWebUrl(args.path) ? drive + '/root:' + path(args.path) + ':' : drive}/search(q='${encodeURIComponent(encodeSearchQuery(args.search))}')`;
    else if (args.path && isWebUrl(args.path)) endpoint = `/shares/${encodeSharingUrl(args.path.trim())}/driveItem/children`;
    else endpoint = !args.path || normalizePath(args.path) === '/' ? `${drive}/root/children` : `${drive}/root:${path(args.path)}:/children`;
    if (operation === 'list_files' && !args.search) params['$orderby'] = args.orderBy;
    const { data } = await fetchPage(request, previous === undefined ? endpoint : nextURL(connector, previous, endpoint), previous === undefined ? params : {}, { headers });
    let position: { next?: unknown; end?: boolean; unknown?: string };
    if (!Object.hasOwn(data, '@odata.nextLink')) position = { end: true };
    else { try { position = { next: nextURL(connector, data['@odata.nextLink'], endpoint) }; } catch { position = { unknown: 'provider_continuation_origin_path_or_value_invalid' }; } }
    return { items: rows(data.value, 'value'), ...(total(data['@odata.count']) === undefined ? {} : { reportedTotal: total(data['@odata.count']) }),
      coverage: operation === 'search_files' || args.search ? 'unknown' : 'complete', ...position, source: data };
  };
}
