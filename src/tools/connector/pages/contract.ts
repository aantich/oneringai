import Ajv from 'ajv';
import type { Connector } from '../../../core/Connector.js';
import type { ToolFunction } from '../../../domain/entities/Tool.js';
import type { ToolContext } from '../../../domain/interfaces/IToolContext.js';
import type { EnhancedConnectorOptions } from '../enhancedProfiles.js';
import type { CursorCodec } from '../../../core/connector-execution/cursors.js';
import { canonical } from '../../../core/connector-execution/cursors.js';
import { microsoftPage } from '../../microsoft/collectionPages.js';
import { googlePage } from '../../google/collectionPages.js';
import { slackPage } from '../../slack/collectionPages.js';
import { githubPage } from '../../github/collectionPages.js';
import { badPage, coverage, fetchPage, type PageArgs } from './common.js';
import type { ConnectorPage } from './types.js';

const ajv = new Ajv({ strict: false, allErrors: false });
interface Invocation { reportFailure(error?: Error): void }
export interface CollectionContract {
  suffix: 'page' | 'strict'; parameters: NonNullable<ToolFunction['definition']['function']['parameters']>; description: string;
  execute(connector: Connector, args: unknown, context: ToolContext | undefined, codec: CursorCodec, invocation: Invocation): Promise<unknown>;
}
export function collectionContract(service: string, original: ToolFunction, options: EnhancedConnectorOptions): CollectionContract | undefined {
  const operation = original.definition.function.name;
  const read = service === 'microsoft' ? microsoftPage(operation) : service === 'google-api' ? googlePage(operation) : service === 'slack' ? slackPage(operation) : service === 'github' ? githubPage(operation) : undefined;
  const strict = service === 'slack' && operation === 'set_channel_topic';
  if (!read && !strict) return undefined;
  const parameters = structuredClone(original.definition.function.parameters ?? { type: 'object', properties: {} }) as Record<string, any>;
  const properties = parameters.properties as Record<string, any>;
  const required = new Set<string>(parameters.required ?? []);
  const defaults: PageArgs = {};
  if (strict) {
    properties.topic.maxLength = 250;
    properties.topic.description = 'Exact topic, at most 250 Unicode code points; sent unchanged or rejected.';
  } else {
    for (const key of ['limit', 'maxResults']) { delete properties[key]; required.delete(key); }
    const search = service === 'slack' && ['search_messages', 'get_mentions'].includes(operation);
    const maximum = service === 'github' || search ? 100 : service === 'google-api' ? 1000 : 200;
    defaults.pageSize = search ? 20 : operation === 'list_meetings' ? 25 : 100;
    properties.pageSize = { type: 'integer', minimum: 1, maximum, description: `Provider page-size hint (default ${defaults.pageSize}, max ${maximum}); the entire fetched page is returned.` };
    properties.continuation = { type: 'string', minLength: 1, maxLength: 65_536, description: 'Opaque continuation from this exact query/account/manager. Omit for the first page.' };
    const order = service === 'google-api' ? operation === 'list_meetings' ? ['startTime', 'updated'] : ['folder,name', 'name', 'name desc', 'modifiedTime desc']
      : service === 'microsoft' && operation !== 'search_files' ? operation === 'list_meetings' ? ['start/dateTime'] : ['name asc', 'name desc', 'lastModifiedDateTime asc', 'lastModifiedDateTime desc'] : undefined;
    if (order) { properties.orderBy = { type: 'string', enum: order }; defaults.orderBy = order[0]; }
    if (operation === 'list_meetings') defaults.timeZone = 'UTC';
    if (service === 'google-api' && operation !== 'list_meetings') {
      Object.assign(properties, { corpora: { type: 'string', enum: ['user', 'domain', 'drive', 'allDrives'] }, driveId: { type: 'string' }, supportsAllDrives: { type: 'boolean' }, includeItemsFromAllDrives: { type: 'boolean' } });
      defaults.corpora = 'user'; defaults.supportsAllDrives = true; defaults.includeItemsFromAllDrives = true;
    }
    if (properties.fileTypes) properties.fileTypes.items = { type: 'string', pattern: service === 'google-api' ? '^\\.?[A-Za-z0-9][A-Za-z0-9!#$&^_.+/\\-]*$' : '^\\.?[A-Za-z0-9]+$' };
    if (service === 'slack') {
      if (operation === 'list_channels') { defaults.type = 'public'; defaults.excludeArchived = true; }
      if (operation === 'get_users') defaults.includeDeactivated = false;
      if (search) { defaults.sort = 'timestamp'; defaults.sortDirection = 'desc'; properties.sortDirection = { type: 'string', enum: ['asc', 'desc'] }; }
    }
    if (service === 'github' && operation === 'search_files') required.add('ref');
    if (service === 'github' && operation === 'pr_comments') { properties.commentType = { type: 'string', enum: ['issue', 'review_comment', 'review'], description: 'One provider collection per call; traverse each separately for all discussion/review records.' }; defaults.commentType = 'issue'; }
  }
  parameters.required = [...required]; parameters.additionalProperties = false;
  const validate = ajv.compile(parameters);
  return {
    suffix: strict ? 'strict' : 'page', parameters: parameters as CollectionContract['parameters'],
    description: strict ? 'Set a Slack topic exactly, without truncation. Reject over 250 Unicode code points before transport. Provider validation still applies.'
      : `Read one whole provider page for ${operation}. Items retain provider fields. pageSize is a hint, not a total cutoff. Follow position.more with the identical query; stop on end/unknown or repeated positionId. returnedCount is not a total; searchCoverage is independent of pagination. ${service === 'github' && operation === 'search_files' ? 'An explicit ref is required. Provider tree truncation is incomplete coverage with no resumable position.' : ''}${service === 'github' && operation === 'search_code' ? 'Indexed default-branch code search only; ref is rejected. Provider search ceilings apply.' : ''}${service === 'github' && operation === 'pr_comments' ? 'commentType chooses issue, review_comment or review; traverse all three independently if required.' : ''}`,
    async execute(connector, input, context, codec, invocation) {
      let observed: unknown;
      try {
        if (!validate(input)) return badPage(`invalid arguments (${validate.errors?.[0]?.instancePath || '/'}: ${validate.errors?.[0]?.keyword})`);
        const args = { ...defaults, ...input as PageArgs };
        if (strict) {
          // AJV counts Unicode code points; avoid the legacy UTF-16 prefix slicing.
          const { data } = await fetchPage({ service, connector, args, context, userId: options.userId, observe: value => { observed = value; } }, '/conversations.setTopic', {}, { body: { channel: args.channel, topic: args.topic } });
          return { success: true, topic: data.channel?.topic?.value };
        }
        const { continuation, ...query } = args;
        // Canonicalize primitive defaults before signing; no model-selected tenant authority.
        const scope = { connector: connector.name, connectorId: connector.id, baseURL: connector.baseURL, service, profile: 'collections-v1', operation,
          accountId: options.accountId ?? context?.accountId ?? context?.connectorAccounts?.[connector.name],
          userId: context?.userId ?? options.userId, actAs: options.actAs, agentId: context?.agentId, sessionId: context?.sessionId,
          roles: context?.roles ? [...context.roles].sort() : undefined,
          identities: context?.identities?.map(identity => ({ ...identity, toolFilter: identity.toolFilter ? [...identity.toolFilter].sort() : undefined })).sort((a, b) => canonical(a).localeCompare(canonical(b))), query };
        const previous = continuation === undefined ? undefined : codec.decode(continuation, scope);
        const page = await read!({ service, connector, args: query, context, userId: options.userId, actAs: options.actAs, previous: previous?.position, observe: value => { observed = value; } });
        const searchCoverage = coverage(previous?.coverage, page.coverage);
        const result: ConnectorPage = { items: page.items, returnedCount: page.items.length, ...(page.reportedTotal === undefined ? {} : { reportedTotal: page.reportedTotal }), searchCoverage,
          position: { state: 'unknown', reason: page.unknown ?? 'provider_position_missing' } };
        if (page.next !== undefined) {
          try { result.position = { state: 'more', ...codec.encode(scope, page.next, searchCoverage) }; }
          catch { result.position = { state: 'unknown', reason: 'provider_continuation_exceeds_envelope_capacity' }; invocation.reportFailure(new Error('Provider continuation cannot be represented; the complete observation is retained'));
            return { ...result, observedPage: observed ?? page.source }; }
        } else if (page.end) result.position = { state: 'end' };
        if (result.position.state === 'unknown') {
          invocation.reportFailure(new Error(`Collection position unknown: ${result.position.reason}`));
          return { ...result, observedPage: observed ?? page.source };
        }
        return result;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error)); invocation.reportFailure(failure);
        return { success: false, error: failure.message, ...(observed === undefined ? {} : { observedPage: observed }) };
      }
    },
  };
}
