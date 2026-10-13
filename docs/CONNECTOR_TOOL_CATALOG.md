# Connector & Tool Catalog

**Version:** 1.1.1 | **Last verified against source:** 2026-08-28

This is the canonical map of how tools enter a OneRingAI agent. It answers
three questions that are easy to conflate:

1. Which connectors can OneRingAI configure?
2. Which connectors receive purpose-built tools?
3. Which tools exist without a connector?

For authentication fields and credential URLs, see the
[complete vendor reference](../USER_GUIDE.md#complete-vendor-reference). For
tool parameters and longer examples, see
[Tools & Function Calling](../USER_GUIDE.md#tools--function-calling).

## The four tool sources

| Source | How it is added | Examples |
|--------|-----------------|----------|
| Application tools | Pass `ToolFunction[]` to `Agent.create({ tools })` or register with `agent.tools` | Your business logic, database queries, internal APIs |
| Generated built-ins | Import individual exports or resolve them through `ToolRegistry` / `ToolCatalogRegistry` | Filesystem, shell, desktop, routines, custom-tool management, `web_fetch` |
| Context-plugin tools | Enabled by `context.features` or a custom context plugin | `store_*`, `memory_*`, `tool_catalog_*`, `todo_*` |
| Connector tools | `ConnectorTools.for(connectorName)` | Authenticated generic API calls plus specialized GitHub, Slack, Microsoft, Google, media, search, and other packs |

`agent.tools` and `agent.context.tools` are the same `ToolManager` instance, so
permissions, circuit breakers, execution plugins, enable/disable state, and
events apply regardless of where a tool came from.

## What every service connector gets

When a connector has a `baseURL`, `ConnectorTools.for(name)` creates a generic
authenticated API tool:

```text
{connectorName}_api({ method, endpoint, body?, queryParams?, headers? })
```

The tool:

- uses the connector as the single source of truth for authentication;
- prevents the LLM from overriding protected auth headers;
- supports `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`;
- binds `userId` and optional `accountId` through `ToolContext`;
- inherits connector retry, timeout, circuit-breaker, and metrics behavior;
- uses `session` permission scope by default.

If a specialized factory exists for the connector's `serviceType`, its tools
are appended automatically. All returned tool names are prefixed with the
actual connector name, so a base tool such as `send_email` becomes
`work_google_send_email` for a connector named `work-google`.

## First-party specialized connector packs

Names below are **base names**. `ConnectorTools.for()` prefixes every name with
the connector name and also includes `{connectorName}_api` when a `baseURL` is
present.

| Service type | Dedicated tools | Base tool names |
|--------------|----------------:|-----------------|
| `github` | 8 | `search_files`, `search_code`, `read_file`, `list_branches`, `get_pr`, `pr_files`, `pr_comments`, `create_pr` |
| `slack` | 10 | `list_channels`, `get_channel_info`, `set_channel_topic`, `get_messages`, `get_thread`, `post_message`, `search_messages`, `get_mentions`, `add_reaction`, `get_users` |
| `microsoft` | 11 | `create_draft_email`, `send_email`, `create_meeting`, `edit_meeting`, `get_meeting`, `list_meetings`, `find_meeting_slots`, `get_meeting_transcript`, `read_file`, `list_files`, `search_files` |
| `google-api` | 11 | `create_draft_email`, `send_email`, `create_meeting`, `edit_meeting`, `get_meeting`, `list_meetings`, `find_meeting_slots`, `get_meeting_transcript`, `read_file`, `list_files`, `search_files` |
| `telegram` | 6 | `telegram_get_me`, `telegram_get_chat`, `telegram_send_message`, `telegram_send_photo`, `telegram_get_updates`, `telegram_set_webhook` |
| `twilio` | 4 | `send_sms`, `send_whatsapp`, `list_messages`, `get_message` |
| `zoom` | 3 | `zoom_create_meeting`, `zoom_update_meeting`, `zoom_get_transcript` |

### Web search and scraping

| Service types | Dedicated tool | Notes |
|---------------|----------------|-------|
| `serper`, `brave-search`, `tavily`, `rapidapi-search` | `web_search` | All four have built-in vendor templates |
| `zenrows`, `jina-reader`, `firecrawl`, `scrapingbee` | `web_scrape` | ZenRows has a built-in template; the other service types can be used with manually configured connectors |

`web_fetch` is different: it is a connector-free built-in for ordinary HTTP
fetching and document conversion. Use a search connector to discover URLs and a
scrape connector when sites require a rendering or anti-bot service.

### AI media connectors

AI model connectors use `vendor`, rather than an external-service template.
Their media factories are also discovered by `ConnectorTools.for()`:

| AI vendor | Dedicated media tools |
|-----------|-----------------------|
| OpenAI | `generate_image`, `generate_video`, `video_status`, `text_to_speech`, `speech_to_text` |
| Google | `generate_image`, `generate_video`, `video_status`, `text_to_speech` |
| xAI / Grok | `generate_image`, `generate_video`, `video_status` |

The external Google Workspace template uses service type `google-api`; the AI
provider connector uses vendor `google`. They are intentionally separate so a
Gemini key and a user's Google Workspace OAuth identity do not get conflated.

## All 50 external-service templates

Every template below currently declares a `baseURL`, so it receives the generic
authenticated API tool. “Dedicated” means the specialized pack is added too.

| Category | Template | ID / service type | Tool surface from `ConnectorTools.for()` |
|----------|----------|-------------------|------------------------------------------|
| Major vendors | Microsoft | `microsoft` | Generic API + 11 Microsoft Graph tools |
| Major vendors | Google Workspace | `google-api` | Generic API + 11 Gmail/Calendar/Meet/Drive tools |
| Communication | Slack | `slack` | Generic API + 10 Slack tools |
| Communication | Discord | `discord` | Generic API |
| Communication | Telegram | `telegram` | Generic API + 6 Telegram tools |
| Communication | X (Twitter) | `twitter` | Generic API |
| Communication | Zoom | `zoom` | Generic API + 3 Zoom tools |
| Communication | HeyReach | `heyreach` | Generic API |
| Development | GitHub | `github` | Generic API + 8 GitHub tools |
| Development | GitLab | `gitlab` | Generic API |
| Development | Bitbucket | `bitbucket` | Generic API |
| Development | Jira | `jira` | Generic API |
| Development | Linear | `linear` | Generic API |
| Development | Asana | `asana` | Generic API |
| Development | Trello | `trello` | Generic API |
| Productivity | Notion | `notion` | Generic API |
| Productivity | Airtable | `airtable` | Generic API |
| Productivity | Confluence | `confluence` | Generic API |
| Productivity | Cal.com | `cal-com` | Generic API |
| Productivity | Calendly | `calendly` | Generic API |
| CRM | Salesforce | `salesforce` | Generic API |
| CRM | HubSpot | `hubspot` | Generic API |
| CRM | Pipedrive | `pipedrive` | Generic API |
| Payments | Stripe | `stripe` | Generic API |
| Payments | PayPal | `paypal` | Generic API |
| Payments | QuickBooks | `quickbooks` | Generic API |
| Payments | Ramp | `ramp` | Generic API |
| Cloud | Amazon Web Services | `aws` | Generic API; callers remain responsible for choosing an appropriate endpoint/signing setup |
| Cloud | Cloudflare | `cloudflare` | Generic API |
| Storage | Dropbox | `dropbox` | Generic API |
| Storage | Box | `box` | Generic API |
| Email | SendGrid | `sendgrid` | Generic API |
| Email | Mailchimp | `mailchimp` | Generic API |
| Email | Postmark | `postmark` | Generic API |
| Email | Mailgun | `mailgun` | Generic API |
| Email | EmailBison | `emailbison` | Generic API |
| Monitoring | Datadog | `datadog` | Generic API |
| Monitoring | PagerDuty | `pagerduty` | Generic API |
| Monitoring | Sentry | `sentry` | Generic API |
| Search | Serper | `serper` | Generic API + `web_search` |
| Search | Brave Search | `brave-search` | Generic API + `web_search` |
| Search | Tavily | `tavily` | Generic API + `web_search` |
| Search | RapidAPI Web Search | `rapidapi-search` | Generic API + `web_search` |
| Scrape | ZenRows | `zenrows` | Generic API + `web_scrape` |
| Other | ipinfo | `ipinfo` | Generic API |
| Other | Clay | `clay` | Generic API |
| Other | Twilio | `twilio` | Generic API + 4 Twilio tools |
| Other | Zendesk | `zendesk` | Generic API |
| Other | Intercom | `intercom` | Generic API |
| Other | Shopify | `shopify` | Generic API |

Templates configure authentication and sensible endpoint defaults; they do not
claim to model every operation of every vendor. For generic-only services, use
the authenticated API tool, call `Connector.fetch()` directly, or register a
domain-specific factory with `ConnectorTools.registerService()`.

## Generated connector-free built-ins

`ToolRegistry.getBuiltInTools()` currently exposes 39 generated entries in
eight categories. These are the stable registry entries; optional plugin and
connector tools are intentionally discovered at runtime instead.

| Category | Count | Tools |
|----------|------:|-------|
| Filesystem | 6 | `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `list_directory` |
| Shell | 5 | `bash`, `bg_process_kill`, `bg_process_list`, `bg_process_output`, `dev_server` |
| Desktop | 11 | `desktop_screenshot`, `desktop_get_cursor`, `desktop_get_screen_size`, `desktop_keyboard_key`, `desktop_keyboard_type`, `desktop_mouse_click`, `desktop_mouse_drag`, `desktop_mouse_move`, `desktop_mouse_scroll`, `desktop_window_focus`, `desktop_window_list` |
| Code | 1 | `execute_javascript` |
| JSON | 1 | `json_manipulate` |
| Web | 1 | `web_fetch` |
| Custom-tool management | 6 | `custom_tool_draft`, `custom_tool_test`, `custom_tool_save`, `custom_tool_load`, `custom_tool_list`, `custom_tool_delete` |
| Routines | 8 | `generate_routine`, `routine_get`, `routine_list`, `routine_update`, `routine_delete`, `routine_get_task_steps`, `routine_update_task`, `routine_list_executions` |

## Context-plugin and dynamic tools

| Feature / system | Tool surface |
|------------------|--------------|
| Any enabled `IStoreHandler` plugin | Five shared tools: `store_get`, `store_set`, `store_delete`, `store_list`, `store_action` |
| `memory: true` | Six reads: `memory_recall`, `memory_graph`, `memory_search`, `memory_search_documents`, `memory_find_entity`, `memory_list_facts` |
| `memoryWrite: true` | Six writes: `memory_remember`, `memory_link`, `memory_upsert_entity`, `memory_forget`, `memory_restore`, `memory_set_agent_rule` |
| `toolCatalog: true` | `tool_catalog_search`, `tool_catalog_load`, `tool_catalog_unload` |
| `userInfo: true` | `todo_add`, `todo_update`, `todo_remove` in addition to the shared store tools |
| Agent orchestrator | `assign_turn`, `delegate_interactive`, `send_message`, `list_agents`, `destroy_agent` |
| MCP clients | Whatever tool definitions the connected MCP servers advertise |

Custom context plugins can provide instructions, content, tools, persisted
state, compaction, and an `IStoreHandler`. Custom tool execution plugins do not
add tools; they wrap execution with logging, analytics, argument transforms,
caching, UI updates, or other policies.

## Discovery APIs

```typescript
import {
  ConnectorTools,
  ToolRegistry,
  ToolCatalogRegistry,
  listVendors,
} from '@everworker/oneringai';

// The 50 configured auth templates.
const templates = listVendors();

// Generic + specialized tools for one configured connector.
const githubTools = ConnectorTools.for('work-github');

// Every configured external connector that currently resolves to tools.
const byConnector = ConnectorTools.discoverAll();

// Service types with a registered specialized factory.
const specializedServices = ConnectorTools.listSupportedServices();

// Generated built-ins only, connector tools only, or their runtime union.
const builtIns = ToolRegistry.getBuiltInTools();
const connectorTools = ToolRegistry.getAllConnectorTools();
const allVisibleTools = ToolRegistry.getAllTools();

// Resolve scoped catalog categories for an application/tool picker.
const resolved = ToolCatalogRegistry.resolveTools(/* category scope */);
```

`ConnectorTools.discoverAll()` and `ToolRegistry.getAllConnectorTools()` inspect
configured connector instances, not every possible template. A template does
not become a live connector until the application creates or restores one.

## Identity, scoping, and permissions

- Use `identities` on an agent to declare which connector names/accounts are
  visible to that agent.
- Use `Connector.scoped()` with an `IConnectorAccessPolicy` for tenant- or
  user-specific registry views.
- Use `accountId` for multiple accounts under one named connector.
- Use `actAs` only for the Microsoft/Google URL-scoped tools that support the
  on-behalf-of lock; tenant-global search/Drive/free-busy endpoints follow the
  underlying token's visibility.
- Connector tools still pass through `ToolManager`, so the normal permission
  policy chain, user rules, approval scopes, circuit breakers, and execution
  plugins apply.

## Related documentation

- [Connectors & Authentication](../USER_GUIDE.md#connectors--authentication)
- [Tools & Function Calling](../USER_GUIDE.md#tools--function-calling)
- [External API Integration](../USER_GUIDE.md#external-api-integration)
- [Vendor Templates](../USER_GUIDE.md#vendor-templates)
- [Tool Catalog](../USER_GUIDE.md#tool-catalog-dynamic-tool-loadingunloading)
- [Tool Permissions](../USER_GUIDE.md#tool-permissions)


## Execution outcomes and cancellation

The shared ToolManager exposes additive `executeWithOutcome()` metadata and
per-execution signals. Generic authenticated API tools forward `ToolContext.signal`
to `Connector.fetch()`. Caller cancellation is composed with connector deadlines
and remains effective during native response-body reading and retry backoff.
Specialized tools and transports must forward/observe signals themselves; local
cancellation does not guarantee remote effect prevention.

Connector header-timeout and retry defaults remain unchanged. Optional
`timeoutScope: 'operation'` includes token waiting, retries, and body consumption;
optional `retryPolicy: 'safe'` permits retries only for eligible GET/HEAD/OPTIONS.
`skipRetry` skips network and status retries. Consume or cancel response bodies.
See [Tool outcomes and cancellation](./TOOL_OUTCOMES_AND_CANCELLATION.md) for
outcome provenance, uncertainty, raw-result compatibility, and examples.
