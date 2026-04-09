/**
 * Vendor Logo Utilities
 *
 * Provides access to vendor logos using the simple-icons package.
 * All icons are SVG format and can be customized with colors.
 */

import * as simpleIcons from 'simple-icons';

/** Simple Icons icon data structure */
export interface SimpleIcon {
  title: string;
  slug: string;
  svg: string;
  path: string;
  source: string;
  hex: string;
  guidelines?: string;
  license?: {
    type: string;
    url?: string;
  };
}

/** Mapping from our vendor IDs to Simple Icons slugs */
export const VENDOR_ICON_MAP: Record<string, string | null> = {
  // Major Vendors (unified)
  microsoft: 'microsoft',
  google: 'google',
  'google-api': 'google',

  // Cloud
  aws: 'amazonwebservices',
  azure: 'microsoftazure',
  gcp: 'googlecloud',

  // Communication
  discord: 'discord',
  slack: 'slack',
  telegram: 'telegram',
  twitter: 'x',
  'microsoft-teams': 'microsoftteams',

  // CRM
  salesforce: 'salesforce',
  hubspot: 'hubspot',
  pipedrive: 'pipedrive',

  // Development
  github: 'github',
  gitlab: 'gitlab',
  bitbucket: 'bitbucket',
  jira: 'jira',
  confluence: 'confluence',
  trello: 'trello',
  linear: 'linear',
  asana: 'asana',

  // Productivity
  notion: 'notion',
  airtable: 'airtable',
  'google-workspace': 'google',
  'google-drive': 'googledrive',
  'microsoft-365': 'microsoft365',
  onedrive: 'onedrive',

  // Payments
  stripe: 'stripe',
  paypal: 'paypal',
  quickbooks: 'quickbooks',
  ramp: null, // No Simple Icon available

  // Email
  sendgrid: 'sendgrid',
  mailchimp: 'mailchimp',
  postmark: 'postmark',

  // Storage
  dropbox: 'dropbox',
  box: 'box',

  // Monitoring
  datadog: 'datadog',
  pagerduty: 'pagerduty',
  sentry: 'sentry',

  // Search
  serper: null, // No Simple Icon available
  'brave-search': 'brave',
  tavily: null, // No Simple Icon available
  rapidapi: 'rapidapi',

  // Scrape
  zenrows: null, // No Simple Icon available

  // Other
  twilio: 'twilio',
  zendesk: 'zendesk',
  intercom: 'intercom',
  shopify: 'shopify',
};

/** Fallback placeholder configs for vendors without Simple Icons (or removed due to trademark) */
const FALLBACK_PLACEHOLDERS: Record<string, { color: string; letter: string }> = {
  // Major Vendors (fallbacks in case Simple Icons doesn't work)
  microsoft: { color: '#00A4EF', letter: 'M' },
  google: { color: '#4285F4', letter: 'G' },

  // Cloud (trademark removed from Simple Icons)
  aws: { color: '#FF9900', letter: 'A' },
  azure: { color: '#0078D4', letter: 'A' },

  // Communication (trademark removed)
  slack: { color: '#4A154B', letter: 'S' },
  'microsoft-teams': { color: '#6264A7', letter: 'T' },
  twitter: { color: '#000000', letter: 'X' },

  // CRM (trademark removed)
  salesforce: { color: '#00A1E0', letter: 'S' },
  pipedrive: { color: '#1A1F26', letter: 'P' },

  // Productivity (trademark removed)
  'microsoft-365': { color: '#D83B01', letter: 'M' },
  onedrive: { color: '#0078D4', letter: 'O' },

  // Email (trademark removed)
  sendgrid: { color: '#1A82E2', letter: 'S' },
  postmark: { color: '#FFDE00', letter: 'P' },

  // Payments (no Simple Icon available)
  ramp: { color: '#F2C94C', letter: 'R' },

  // Search (no Simple Icon available)
  serper: { color: '#4A90A4', letter: 'S' },
  tavily: { color: '#7C3AED', letter: 'T' },
  rapidapi: { color: '#0055DA', letter: 'R' },

  // Scrape (no Simple Icon available)
  zenrows: { color: '#00D4AA', letter: 'Z' },

  // Other (trademark removed)
  twilio: { color: '#F22F46', letter: 'T' },
};

/**
 * Convert slug to Simple Icons key format (e.g., 'amazonwebservices' -> 'siAmazonwebservices')
 */
function slugToKey(slug: string): string {
  return `si${slug.charAt(0).toUpperCase()}${slug.slice(1)}`;
}

/**
 * Get the Simple Icon for a slug
 */
function getSimpleIcon(slug: string): SimpleIcon | undefined {
  const key = slugToKey(slug);
  return (simpleIcons as Record<string, SimpleIcon>)[key];
}

/**
 * Generate a placeholder SVG for vendors without official icons
 */
function generatePlaceholderSvg(letter: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="${color}"/><text x="12" y="17" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="white" text-anchor="middle">${letter}</text></svg>`;
}

/**
 * Vendor logo information
 */
export interface VendorLogo {
  /** Vendor ID */
  vendorId: string;
  /** SVG content */
  svg: string;
  /** Brand color (hex without #) */
  hex: string;
  /** Whether this is a placeholder (no official icon) */
  isPlaceholder: boolean;
  /** Simple Icons slug (if available) */
  simpleIconsSlug?: string;
}

/**
 * Check if a vendor has a logo available
 */
export function hasVendorLogo(vendorId: string): boolean {
  const slug = VENDOR_ICON_MAP[vendorId];
  if (slug === undefined) {
    return false;
  }
  // Check Simple Icons first, fall back to placeholder
  if (slug !== null && getSimpleIcon(slug)) {
    return true;
  }
  return vendorId in FALLBACK_PLACEHOLDERS;
}

/**
 * Get logo for a vendor
 *
 * @param vendorId - The vendor ID (e.g., 'github', 'slack')
 * @returns VendorLogo object or undefined if not available
 *
 * @example
 * ```typescript
 * const logo = getVendorLogo('github');
 * if (logo) {
 *   console.log(logo.svg);  // SVG content
 *   console.log(logo.hex);  // Brand color
 * }
 * ```
 */
export function getVendorLogo(vendorId: string): VendorLogo | undefined {
  const slug = VENDOR_ICON_MAP[vendorId];

  // Unknown vendor
  if (slug === undefined) {
    return undefined;
  }

  // Try Simple Icons first (if slug is not null)
  if (slug !== null) {
    const icon = getSimpleIcon(slug);
    if (icon) {
      return {
        vendorId,
        svg: icon.svg,
        hex: icon.hex,
        isPlaceholder: false,
        simpleIconsSlug: slug,
      };
    }
  }

  // Fall back to placeholder (for trademark-removed icons or icons marked as null)
  const fallback = FALLBACK_PLACEHOLDERS[vendorId];
  if (fallback) {
    return {
      vendorId,
      svg: generatePlaceholderSvg(fallback.letter, fallback.color),
      hex: fallback.color.replace('#', ''),
      isPlaceholder: true,
    };
  }

  return undefined;
}

/**
 * Get SVG content for a vendor logo
 *
 * @param vendorId - The vendor ID
 * @param color - Optional color override (hex without #)
 * @returns SVG string or undefined
 */
export function getVendorLogoSvg(vendorId: string, color?: string): string | undefined {
  const logo = getVendorLogo(vendorId);
  if (!logo) return undefined;

  if (color && !logo.isPlaceholder) {
    // Replace fill color in SVG
    return logo.svg.replace(/fill="[^"]*"/g, `fill="#${color}"`);
  }

  return logo.svg;
}

/**
 * Get the brand color for a vendor
 *
 * @param vendorId - The vendor ID
 * @returns Hex color string (without #) or undefined
 */
export function getVendorColor(vendorId: string): string | undefined {
  const logo = getVendorLogo(vendorId);
  return logo?.hex;
}

/**
 * Get all available vendor logos
 *
 * @returns Map of vendor ID to VendorLogo
 */
export function getAllVendorLogos(): Map<string, VendorLogo> {
  const logos = new Map<string, VendorLogo>();

  for (const vendorId of Object.keys(VENDOR_ICON_MAP)) {
    const logo = getVendorLogo(vendorId);
    if (logo) {
      logos.set(vendorId, logo);
    }
  }

  return logos;
}

/**
 * List vendor IDs that have logos available
 */
export function listVendorsWithLogos(): string[] {
  return Object.keys(VENDOR_ICON_MAP).filter(hasVendorLogo);
}

/**
 * CDN URL for Simple Icons (useful for web applications)
 */
export const SIMPLE_ICONS_CDN = 'https://cdn.simpleicons.org';

/**
 * Get CDN URL for a vendor's logo
 *
 * @param vendorId - The vendor ID
 * @param color - Optional color (hex without #)
 * @returns CDN URL or undefined if vendor doesn't have a Simple Icons entry
 */
export function getVendorLogoCdnUrl(vendorId: string, color?: string): string | undefined {
  const slug = VENDOR_ICON_MAP[vendorId];
  if (!slug) return undefined;

  if (color) {
    return `${SIMPLE_ICONS_CDN}/${slug}/${color}`;
  }
  return `${SIMPLE_ICONS_CDN}/${slug}`;
}
