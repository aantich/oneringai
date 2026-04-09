/**
 * Services - Single source of truth for external service definitions
 *
 * All service metadata is defined in one place (SERVICE_DEFINITIONS).
 * Other exports are derived from this to maintain DRY principles.
 */

/**
 * Service category type
 */
export type ServiceCategory =
  | 'major-vendors'
  | 'communication'
  | 'development'
  | 'productivity'
  | 'crm'
  | 'payments'
  | 'cloud'
  | 'storage'
  | 'email'
  | 'monitoring'
  | 'search'
  | 'scrape'
  | 'other';

/**
 * Complete service definition - single source of truth
 */
export interface ServiceDefinition {
  /** Unique identifier (e.g., 'slack', 'github') */
  id: string;
  /** Human-readable name (e.g., 'Slack', 'GitHub') */
  name: string;
  /** Service category */
  category: ServiceCategory;
  /** URL pattern for auto-detection from baseURL */
  urlPattern: RegExp;
  /** Default base URL for API calls */
  baseURL: string;
  /** Documentation URL */
  docsURL?: string;
  /** Common OAuth scopes */
  commonScopes?: string[];
}

/**
 * Master list of all service definitions
 * This is the SINGLE SOURCE OF TRUTH - all other exports derive from this
 */
export const SERVICE_DEFINITIONS: readonly ServiceDefinition[] = [
  // ============ Major Vendors ============
  {
    id: 'microsoft',
    name: 'Microsoft',
    category: 'major-vendors',
    urlPattern: /graph\.microsoft\.com|login\.microsoftonline\.com/i,
    baseURL: 'https://graph.microsoft.com/v1.0',
    docsURL: 'https://learn.microsoft.com/en-us/graph/',
    commonScopes: ['User.Read', 'Files.ReadWrite', 'Mail.Read', 'Calendars.ReadWrite'],
  },
  {
    id: 'google-api',
    name: 'Google',
    category: 'major-vendors',
    urlPattern: /googleapis\.com|accounts\.google\.com/i,
    baseURL: 'https://www.googleapis.com',
    docsURL: 'https://developers.google.com/',
    commonScopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
  },

  // ============ Communication ============
  {
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    urlPattern: /slack\.com/i,
    baseURL: 'https://slack.com/api',
    docsURL: 'https://api.slack.com/methods',
    commonScopes: ['chat:write', 'channels:read', 'users:read'],
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'communication',
    urlPattern: /discord\.com|discordapp\.com/i,
    baseURL: 'https://discord.com/api/v10',
    docsURL: 'https://discord.com/developers/docs',
    commonScopes: ['bot', 'messages.read'],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'communication',
    urlPattern: /api\.telegram\.org/i,
    baseURL: 'https://api.telegram.org',
    docsURL: 'https://core.telegram.org/bots/api',
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    category: 'communication',
    urlPattern: /api\.x\.com|api\.twitter\.com/i,
    baseURL: 'https://api.x.com/2',
    docsURL: 'https://developer.x.com/en/docs/x-api',
    commonScopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'communication',
    urlPattern: /api\.zoom\.us|zoom\.us/i,
    baseURL: 'https://api.zoom.us/v2',
    docsURL: 'https://developers.zoom.us/docs/api/',
    commonScopes: ['meeting:read', 'meeting:write', 'recording:read', 'user:read'],
  },

  // ============ Development & Project Management ============
  {
    id: 'github',
    name: 'GitHub',
    category: 'development',
    urlPattern: /api\.github\.com/i,
    baseURL: 'https://api.github.com',
    docsURL: 'https://docs.github.com/en/rest',
    commonScopes: ['repo', 'read:user', 'read:org'],
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'development',
    urlPattern: /gitlab\.com|gitlab\./i,
    baseURL: 'https://gitlab.com/api/v4',
    docsURL: 'https://docs.gitlab.com/ee/api/',
    commonScopes: ['api', 'read_user', 'read_repository'],
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    category: 'development',
    urlPattern: /api\.bitbucket\.org|bitbucket\.org/i,
    baseURL: 'https://api.bitbucket.org/2.0',
    docsURL: 'https://developer.atlassian.com/cloud/bitbucket/rest/',
    commonScopes: ['repository', 'pullrequest'],
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'development',
    urlPattern: /atlassian\.net.*jira|jira\./i,
    baseURL: 'https://your-domain.atlassian.net/rest/api/3',
    docsURL: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
    commonScopes: ['read:jira-work', 'write:jira-work'],
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'development',
    urlPattern: /api\.linear\.app/i,
    baseURL: 'https://api.linear.app/graphql',
    docsURL: 'https://developers.linear.app/docs',
    commonScopes: ['read', 'write'],
  },
  {
    id: 'asana',
    name: 'Asana',
    category: 'development',
    urlPattern: /api\.asana\.com/i,
    baseURL: 'https://app.asana.com/api/1.0',
    docsURL: 'https://developers.asana.com/docs',
  },
  {
    id: 'trello',
    name: 'Trello',
    category: 'development',
    urlPattern: /api\.trello\.com/i,
    baseURL: 'https://api.trello.com/1',
    docsURL: 'https://developer.atlassian.com/cloud/trello/rest/',
    commonScopes: ['read', 'write'],
  },

  // ============ Productivity & Collaboration ============
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    urlPattern: /api\.notion\.com/i,
    baseURL: 'https://api.notion.com/v1',
    docsURL: 'https://developers.notion.com/reference',
  },
  {
    id: 'airtable',
    name: 'Airtable',
    category: 'productivity',
    urlPattern: /api\.airtable\.com/i,
    baseURL: 'https://api.airtable.com/v0',
    docsURL: 'https://airtable.com/developers/web/api',
    commonScopes: ['data.records:read', 'data.records:write'],
  },
  {
    id: 'confluence',
    name: 'Confluence',
    category: 'productivity',
    urlPattern: /atlassian\.net.*wiki|confluence\./i,
    baseURL: 'https://your-domain.atlassian.net/wiki/rest/api',
    docsURL: 'https://developer.atlassian.com/cloud/confluence/rest/',
    commonScopes: ['read:confluence-content.all', 'write:confluence-content'],
  },

  // ============ CRM & Sales ============
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    urlPattern: /salesforce\.com|force\.com/i,
    baseURL: 'https://your-instance.salesforce.com/services/data/v58.0',
    docsURL: 'https://developer.salesforce.com/docs/apis',
    commonScopes: ['api', 'refresh_token'],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    urlPattern: /api\.hubapi\.com|api\.hubspot\.com/i,
    baseURL: 'https://api.hubapi.com',
    docsURL: 'https://developers.hubspot.com/docs/api',
    commonScopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    category: 'crm',
    urlPattern: /api\.pipedrive\.com/i,
    baseURL: 'https://api.pipedrive.com/v1',
    docsURL: 'https://developers.pipedrive.com/docs/api/v1',
  },

  // ============ Payments & Finance ============
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'payments',
    urlPattern: /api\.stripe\.com/i,
    baseURL: 'https://api.stripe.com/v1',
    docsURL: 'https://stripe.com/docs/api',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'payments',
    urlPattern: /api\.paypal\.com|api-m\.paypal\.com/i,
    baseURL: 'https://api-m.paypal.com/v2',
    docsURL: 'https://developer.paypal.com/docs/api/',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    category: 'payments',
    urlPattern: /quickbooks\.api\.intuit\.com|intuit\.com.*quickbooks/i,
    baseURL: 'https://quickbooks.api.intuit.com/v3',
    docsURL: 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account',
    commonScopes: ['com.intuit.quickbooks.accounting'],
  },
  {
    id: 'ramp',
    name: 'Ramp',
    category: 'payments',
    urlPattern: /api\.ramp\.com/i,
    baseURL: 'https://api.ramp.com/developer/v1',
    docsURL: 'https://docs.ramp.com/reference',
  },

  // ============ Cloud Providers ============
  {
    id: 'aws',
    name: 'Amazon Web Services',
    category: 'cloud',
    urlPattern: /amazonaws\.com/i,
    baseURL: 'https://aws.amazon.com',
    docsURL: 'https://docs.aws.amazon.com/',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'cloud',
    urlPattern: /api\.cloudflare\.com/i,
    baseURL: 'https://api.cloudflare.com/client/v4',
    docsURL: 'https://developers.cloudflare.com/api/',
  },

  // ============ Storage ============
  {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'storage',
    urlPattern: /api\.dropboxapi\.com|dropbox\.com/i,
    baseURL: 'https://api.dropboxapi.com/2',
    docsURL: 'https://www.dropbox.com/developers/documentation',
    commonScopes: ['files.content.read', 'files.content.write'],
  },
  {
    id: 'box',
    name: 'Box',
    category: 'storage',
    urlPattern: /api\.box\.com/i,
    baseURL: 'https://api.box.com/2.0',
    docsURL: 'https://developer.box.com/reference/',
  },

  // ============ Email ============
  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'email',
    urlPattern: /api\.sendgrid\.com/i,
    baseURL: 'https://api.sendgrid.com/v3',
    docsURL: 'https://docs.sendgrid.com/api-reference',
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'email',
    urlPattern: /api\.mailchimp\.com|mandrillapp\.com/i,
    baseURL: 'https://server.api.mailchimp.com/3.0',
    docsURL: 'https://mailchimp.com/developer/marketing/api/',
  },
  {
    id: 'postmark',
    name: 'Postmark',
    category: 'email',
    urlPattern: /api\.postmarkapp\.com/i,
    baseURL: 'https://api.postmarkapp.com',
    docsURL: 'https://postmarkapp.com/developer',
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    category: 'email',
    urlPattern: /api\.mailgun\.net|api\.eu\.mailgun\.net/i,
    baseURL: 'https://api.mailgun.net/v3',
    docsURL: 'https://documentation.mailgun.com/docs/mailgun/api-reference/',
  },

  // ============ Monitoring & Observability ============
  {
    id: 'datadog',
    name: 'Datadog',
    category: 'monitoring',
    urlPattern: /api\.datadoghq\.com/i,
    baseURL: 'https://api.datadoghq.com/api/v2',
    docsURL: 'https://docs.datadoghq.com/api/',
  },
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    category: 'monitoring',
    urlPattern: /api\.pagerduty\.com/i,
    baseURL: 'https://api.pagerduty.com',
    docsURL: 'https://developer.pagerduty.com/api-reference/',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'monitoring',
    urlPattern: /sentry\.io/i,
    baseURL: 'https://sentry.io/api/0',
    docsURL: 'https://docs.sentry.io/api/',
  },

  // ============ Search ============
  {
    id: 'serper',
    name: 'Serper',
    category: 'search',
    urlPattern: /serper\.dev/i,
    baseURL: 'https://google.serper.dev',
    docsURL: 'https://serper.dev/docs',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    category: 'search',
    urlPattern: /api\.search\.brave\.com/i,
    baseURL: 'https://api.search.brave.com/res/v1',
    docsURL: 'https://brave.com/search/api/',
  },
  {
    id: 'tavily',
    name: 'Tavily',
    category: 'search',
    urlPattern: /api\.tavily\.com/i,
    baseURL: 'https://api.tavily.com',
    docsURL: 'https://tavily.com/docs',
  },
  {
    id: 'rapidapi-search',
    name: 'RapidAPI Search',
    category: 'search',
    urlPattern: /real-time-web-search\.p\.rapidapi\.com/i,
    baseURL: 'https://real-time-web-search.p.rapidapi.com',
    docsURL: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/real-time-web-search',
  },

  // ============ Scraping ============
  {
    id: 'zenrows',
    name: 'ZenRows',
    category: 'scrape',
    urlPattern: /api\.zenrows\.com/i,
    baseURL: 'https://api.zenrows.com/v1',
    docsURL: 'https://docs.zenrows.com/universal-scraper-api/api-reference',
  },

  // ============ Other ============
  {
    id: 'twilio',
    name: 'Twilio',
    category: 'other',
    urlPattern: /api\.twilio\.com/i,
    baseURL: 'https://api.twilio.com/2010-04-01',
    docsURL: 'https://www.twilio.com/docs/usage/api',
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    category: 'other',
    urlPattern: /zendesk\.com/i,
    baseURL: 'https://your-subdomain.zendesk.com/api/v2',
    docsURL: 'https://developer.zendesk.com/api-reference/',
    commonScopes: ['read', 'write'],
  },
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'other',
    urlPattern: /api\.intercom\.io/i,
    baseURL: 'https://api.intercom.io',
    docsURL: 'https://developers.intercom.com/docs/',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'other',
    urlPattern: /shopify\.com.*admin/i,
    baseURL: 'https://your-store.myshopify.com/admin/api/2024-01',
    docsURL: 'https://shopify.dev/docs/api',
    commonScopes: ['read_products', 'write_products', 'read_orders'],
  },
] as const;

// ============ Derived Exports (all from SERVICE_DEFINITIONS) ============

/**
 * Service type - union of all service IDs
 */
export type ServiceType = (typeof SERVICE_DEFINITIONS)[number]['id'];

/**
 * Services constant object for easy access
 * Usage: Services.Slack, Services.GitHub, etc.
 */
export const Services = Object.fromEntries(
  SERVICE_DEFINITIONS.map((def) => [
    // Convert kebab-case to PascalCase for object key
    def.id
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(''),
    def.id,
  ])
) as { [K in string]: ServiceType };

/**
 * URL patterns for auto-detection (derived from SERVICE_DEFINITIONS)
 */
export const SERVICE_URL_PATTERNS: ReadonlyArray<{ service: string; pattern: RegExp }> =
  SERVICE_DEFINITIONS.map((def) => ({
    service: def.id,
    pattern: def.urlPattern,
  }));

/**
 * Service info lookup (derived from SERVICE_DEFINITIONS)
 */
export interface ServiceInfo {
  id: string;
  name: string;
  category: ServiceCategory;
  baseURL: string;
  docsURL?: string;
  commonScopes?: string[];
}

/**
 * Service info map (derived from SERVICE_DEFINITIONS)
 */
export const SERVICE_INFO: Record<string, ServiceInfo> = Object.fromEntries(
  SERVICE_DEFINITIONS.map((def) => [
    def.id,
    {
      id: def.id,
      name: def.name,
      category: def.category,
      baseURL: def.baseURL,
      docsURL: def.docsURL,
      commonScopes: def.commonScopes,
    },
  ])
);

// ============ Utility Functions ============

// Pre-compiled pattern cache for faster detection
let compiledPatterns: Array<{ service: string; pattern: RegExp }> | null = null;

/**
 * Get compiled patterns (lazy initialization)
 */
function getCompiledPatterns(): Array<{ service: string; pattern: RegExp }> {
  if (!compiledPatterns) {
    compiledPatterns = SERVICE_DEFINITIONS.map((def) => ({
      service: def.id,
      pattern: def.urlPattern,
    }));
  }
  return compiledPatterns;
}

/**
 * Detect service type from a URL
 * @param url - Base URL or full URL to check
 * @returns Service type string or undefined if not recognized
 */
export function detectServiceFromURL(url: string): string | undefined {
  const patterns = getCompiledPatterns();

  for (const { service, pattern } of patterns) {
    if (pattern.test(url)) {
      return service;
    }
  }

  return undefined;
}

/**
 * Get service info by service type
 */
export function getServiceInfo(serviceType: string): ServiceInfo | undefined {
  return SERVICE_INFO[serviceType];
}

/**
 * Get service definition by service type
 */
export function getServiceDefinition(serviceType: string): ServiceDefinition | undefined {
  return SERVICE_DEFINITIONS.find((def) => def.id === serviceType);
}

/**
 * Get all services in a category
 */
export function getServicesByCategory(category: ServiceCategory): ServiceDefinition[] {
  return SERVICE_DEFINITIONS.filter((def) => def.category === category);
}

/**
 * Get all service IDs
 */
export function getAllServiceIds(): string[] {
  return SERVICE_DEFINITIONS.map((def) => def.id);
}

/**
 * Check if a service ID is known
 */
export function isKnownService(serviceId: string): boolean {
  return SERVICE_DEFINITIONS.some((def) => def.id === serviceId);
}
