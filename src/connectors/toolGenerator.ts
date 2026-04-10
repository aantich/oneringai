/**
 * Tool Generator - Auto-generate tools for registered connectors
 *
 * @deprecated Use ConnectorTools.for() instead.
 * This module predates the ConnectorTools pattern and lacks support for
 * multi-account OAuth, ToolContext propagation, and security features
 * (protected headers, safe JSON serialization).
 *
 * Migration:
 * ```typescript
 * // Before (deprecated):
 * const tool = generateWebAPITool();
 *
 * // After:
 * const tools = ConnectorTools.for('my-connector');
 * // Or for all connectors:
 * const allTools = ConnectorTools.discoverAll();
 * ```
 */

import { ToolFunction } from '../domain/entities/Tool.js';
import { Connector } from '../core/Connector.js';
import { authenticatedFetch } from './authenticatedFetch.js';
import { logger } from '../infrastructure/observability/Logger.js';

interface APIRequestArgs {
  authProvider: string;
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
  headers?: Record<string, string>;
}

interface APIRequestResult {
  success: boolean;
  status: number;
  statusText: string;
  data: any;
  error?: string;
}

/**
 * Generate a universal API request tool for all registered OAuth providers
 *
 * This tool allows the AI agent to make authenticated requests to any registered API.
 * The tool description is dynamically generated based on registered providers.
 *
 * @deprecated Use ConnectorTools.for() instead.
 * This function does not support multi-account OAuth or ToolContext propagation.
 *
 * @returns ToolFunction that can call any registered OAuth API
 */
export function generateWebAPITool(): ToolFunction<APIRequestArgs, APIRequestResult> {
  logger.warn('[toolGenerator] generateWebAPITool() is deprecated. Use ConnectorTools.for() instead.');
  return {
    definition: {
      type: 'function',
      function: {
        name: 'api_request',
        description: `Make authenticated HTTP request to any registered OAuth API.

This tool automatically handles OAuth authentication for registered providers.

REGISTERED PROVIDERS:
${Connector.getDescriptionsForTools()}

HOW TO USE:
1. Choose the appropriate authProvider based on which API you need to access
2. Provide the URL (full URL or path relative to provider's baseURL)
3. Specify the HTTP method (GET, POST, etc.)
4. For POST/PUT/PATCH, include the request body

EXAMPLES:
Read Microsoft emails:
{
  authProvider: "microsoft",
  url: "/v1.0/me/messages",
  method: "GET"
}

List GitHub repositories:
{
  authProvider: "github",
  url: "/user/repos",
  method: "GET"
}

Create Salesforce account:
{
  authProvider: "salesforce",
  url: "/services/data/v57.0/sobjects/Account",
  method: "POST",
  body: { Name: "Acme Corp", Industry: "Technology" }
}`,

        parameters: {
          type: 'object',
          properties: {
            authProvider: {
              type: 'string',
              enum: Connector.list(),
              description:
                'Which connector to use for authentication. Choose based on the API you need to access.',
            },
            url: {
              type: 'string',
              description:
                'URL to request. Can be full URL (https://...) or path relative to provider baseURL (e.g., "/v1.0/me")',
            },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
              description: 'HTTP method (default: GET)',
            },
            body: {
              description:
                'Request body for POST/PUT/PATCH requests. Will be JSON-stringified automatically.',
            },
            headers: {
              type: 'object',
              description:
                'Additional headers to include. Authorization header is added automatically.',
            },
          },
          required: ['authProvider', 'url'],
        },
      },
      blocking: true,
      timeout: 30000,
    },

    execute: async (args: APIRequestArgs): Promise<APIRequestResult> => {
      try {
        // Get connector info
        const connector = Connector.get(args.authProvider);

        // Build full URL
        const fullUrl = args.url.startsWith('http')
          ? args.url
          : `${connector.baseURL}${args.url}`;

        // Prepare request options
        const requestOptions: RequestInit = {
          method: args.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...args.headers,
          },
        };

        // Add body for POST/PUT/PATCH
        if (args.body && (args.method === 'POST' || args.method === 'PUT' || args.method === 'PATCH')) {
          requestOptions.body = JSON.stringify(args.body);
        }

        // Make authenticated request
        const response = await authenticatedFetch(fullUrl, requestOptions, args.authProvider);

        // Get response data
        const contentType = response.headers.get('content-type') || '';
        let data: any;

        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return {
          success: response.ok,
          status: response.status,
          statusText: response.statusText,
          data,
        };
      } catch (error) {
        return {
          success: false,
          status: 0,
          statusText: 'Error',
          data: null,
          error: (error as Error).message,
        };
      }
    },
  };
}
