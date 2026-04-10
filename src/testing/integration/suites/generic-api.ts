/**
 * Generic API Tool Integration Test Suite
 *
 * Tests the generic `{connector}_api` tool that every connector with a baseURL gets.
 * This suite works with ANY connector — it just makes a simple GET request.
 */

import type { IntegrationTestSuite } from '../types.js';
import { registerSuite } from '../runner.js';

const genericApiSuite: IntegrationTestSuite = {
  id: 'generic-api',
  // Special: matches any service type — the runner should offer this for all connectors
  serviceType: '*',
  name: 'Generic API',
  description:
    'Tests the generic API tool available on all connectors with a baseURL. Makes a simple authenticated GET request.',
  requiredParams: [],
  optionalParams: [
    {
      key: 'testApiEndpoint',
      label: 'Test Endpoint',
      description:
        'Relative API endpoint to GET (default varies by service, e.g., "/me" for Graph, "/" for most)',
      type: 'string',
      required: false,
    },
  ],
  tests: [
    {
      name: 'Authenticated GET request',
      toolName: 'api',
      description: 'Makes a simple authenticated GET request to verify connectivity and auth',
      critical: true,
      execute: async (tools, ctx) => {
        const tool = tools.get('api')!;
        // Use provided endpoint or try common ones
        const endpoint = ctx.params.testApiEndpoint || '/';
        const result = await tool.execute({
          method: 'GET',
          endpoint,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'API GET failed', data: result };
        }
        return {
          success: true,
          message: `API returned status ${result.status || 200}`,
          data: result,
        };
      },
    },
  ],
};

registerSuite(genericApiSuite);
export { genericApiSuite };
