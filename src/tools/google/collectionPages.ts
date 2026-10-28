import { getGoogleCalendarUserId, getGoogleUserId } from './types.js';
import { buildFileTypeQuery } from './searchFiles.js';
import { fetchPage, pageToken, rows, type PageReader } from '../connector/pages/common.js';

const quote = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export function googlePage(operation: string): PageReader | undefined {
  if (!['list_files', 'search_files', 'list_meetings'].includes(operation)) return undefined;
  return async request => {
    const { args, connector, previous } = request;
    if (previous !== undefined && typeof previous !== 'string') throw new Error('Invalid Google page position');
    if (operation === 'list_meetings') {
      const user = getGoogleCalendarUserId(connector, args.targetUser, request.actAs);
      const { data } = await fetchPage(request, `/calendar/v3/calendars/${encodeURIComponent(user)}/events`, {
        timeMin: args.startDateTime, timeMax: args.endDateTime, timeZone: args.timeZone, maxResults: args.pageSize,
        singleEvents: true, orderBy: args.orderBy, pageToken: previous,
      });
      return { items: rows(data.items ?? [], 'items'), coverage: 'complete', ...pageToken(data.nextPageToken, Object.hasOwn(data, 'nextPageToken')), source: data };
    }
    getGoogleUserId(connector, args.targetUser);
    const parts = ['trashed = false'];
    if (args.folderId) parts.push(`'${quote(args.folderId)}' in parents`);
    else if (operation === 'list_files' && !args.search) parts.push("'root' in parents");
    if (operation === 'search_files') parts.push(`fullText contains '${quote(args.query)}'`);
    else if (args.search) parts.push(`name contains '${quote(args.search)}'`);
    if (args.fileTypes?.length) parts.push(buildFileTypeQuery(args.fileTypes));
    const { data } = await fetchPage(request, '/drive/v3/files', { q: parts.join(' and '), fields: 'files(*),nextPageToken,incompleteSearch',
      pageSize: args.pageSize, orderBy: args.orderBy, pageToken: previous, corpora: args.corpora, driveId: args.driveId,
      supportsAllDrives: args.supportsAllDrives, includeItemsFromAllDrives: args.includeItemsFromAllDrives });
    return { items: rows(data.files ?? [], 'files'), coverage: data.incompleteSearch === true ? 'incomplete' : data.incompleteSearch === false ? 'complete' : 'unknown',
      ...pageToken(data.nextPageToken, Object.hasOwn(data, 'nextPageToken')), source: data };
  };
}
