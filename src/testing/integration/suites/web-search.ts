/**
 * Web Search Integration Test Suite
 *
 * Tests the web_search tool across all search provider types:
 * serper, brave-search, tavily, rapidapi-search
 *
 * Each provider uses the same tool name (web_search) but different connectors.
 */

import type { IntegrationTestSuite } from '../types.js';
import { registerSuite } from '../runner.js';

function createWebSearchSuite(
  id: string,
  serviceType: string,
  name: string
): IntegrationTestSuite {
  return {
    id,
    serviceType,
    name,
    description: `Tests web_search tool via ${name} connector.`,
    requiredParams: [],
    optionalParams: [
      {
        key: 'testSearchQuery',
        label: 'Search Query',
        description: 'Query to search for (default: "latest AI news")',
        type: 'string',
        required: false,
        default: 'latest AI news',
      },
    ],
    tests: [
      {
        name: 'Basic web search',
        toolName: 'web_search',
        description: 'Performs a simple web search query',
        critical: true,
        execute: async (tools, ctx) => {
          const tool = tools.get('web_search')!;
          const query = ctx.params.testSearchQuery || 'latest AI news';
          const result = await tool.execute({ query });
          if (!result.success) {
            return { success: false, message: result.error || 'Web search failed', data: result };
          }
          const count = result.results?.length ?? 0;
          return {
            success: count > 0,
            message: count > 0 ? `Got ${count} search results` : 'Search returned no results',
            data: result,
          };
        },
      },
      {
        name: 'Search with result limit',
        toolName: 'web_search',
        description: 'Performs a search with explicit result count',
        critical: false,
        execute: async (tools, _ctx) => {
          const tool = tools.get('web_search')!;
          const result = await tool.execute({
            query: 'OpenAI GPT',
            numResults: 3,
          });
          if (!result.success) {
            return { success: false, message: result.error || 'Search failed', data: result };
          }
          return {
            success: true,
            message: `Got ${result.results?.length ?? 0} results (requested 3)`,
            data: result,
          };
        },
      },
    ],
  };
}

// Register one suite per search provider
const serperSuite = createWebSearchSuite('web-search-serper', 'serper', 'Serper');
const braveSearchSuite = createWebSearchSuite('web-search-brave', 'brave-search', 'Brave Search');
const tavilySuite = createWebSearchSuite('web-search-tavily', 'tavily', 'Tavily');
const rapidapiSearchSuite = createWebSearchSuite(
  'web-search-rapidapi',
  'rapidapi-search',
  'RapidAPI Search'
);

registerSuite(serperSuite);
registerSuite(braveSearchSuite);
registerSuite(tavilySuite);
registerSuite(rapidapiSearchSuite);

export { serperSuite, braveSearchSuite, tavilySuite, rapidapiSearchSuite };
