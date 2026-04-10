/**
 * Web Scrape Integration Test Suite
 *
 * Tests the web_scrape tool across scrape provider types:
 * zenrows, jina-reader, firecrawl, scrapingbee
 */

import type { IntegrationTestSuite } from '../types.js';
import { registerSuite } from '../runner.js';

function createWebScrapeSuite(
  id: string,
  serviceType: string,
  name: string
): IntegrationTestSuite {
  return {
    id,
    serviceType,
    name,
    description: `Tests web_scrape tool via ${name} connector.`,
    requiredParams: [],
    optionalParams: [
      {
        key: 'testScrapeUrl',
        label: 'URL to Scrape',
        description: 'URL to scrape (default: "https://example.com")',
        type: 'url',
        required: false,
        default: 'https://example.com',
      },
    ],
    tests: [
      {
        name: 'Scrape a web page',
        toolName: 'web_scrape',
        description: 'Scrapes content from a URL',
        critical: true,
        execute: async (tools, ctx) => {
          const tool = tools.get('web_scrape')!;
          const url = ctx.params.testScrapeUrl || 'https://example.com';
          const result = await tool.execute({ url });
          if (!result.success) {
            return { success: false, message: result.error || 'Web scrape failed', data: result };
          }
          const contentLen = result.content?.length ?? result.text?.length ?? 0;
          return {
            success: contentLen > 0,
            message:
              contentLen > 0
                ? `Scraped ${contentLen} chars`
                : 'Scrape returned empty content',
            data: result,
          };
        },
      },
      {
        name: 'Scrape with markdown output',
        toolName: 'web_scrape',
        description: 'Scrapes a page requesting markdown format',
        critical: false,
        execute: async (tools, ctx) => {
          const tool = tools.get('web_scrape')!;
          const url = ctx.params.testScrapeUrl || 'https://example.com';
          const result = await tool.execute({ url, format: 'markdown' });
          if (!result.success) {
            return { success: false, message: result.error || 'Markdown scrape failed', data: result };
          }
          return {
            success: true,
            message: `Scraped ${result.content?.length ?? result.text?.length ?? 0} chars as markdown`,
            data: result,
          };
        },
      },
    ],
  };
}

const zenrowsSuite = createWebScrapeSuite('web-scrape-zenrows', 'zenrows', 'ZenRows');
const jinaReaderSuite = createWebScrapeSuite('web-scrape-jina', 'jina-reader', 'Jina Reader');
const firecrawlSuite = createWebScrapeSuite('web-scrape-firecrawl', 'firecrawl', 'Firecrawl');
const scrapingbeeSuite = createWebScrapeSuite(
  'web-scrape-scrapingbee',
  'scrapingbee',
  'ScrapingBee'
);

registerSuite(zenrowsSuite);
registerSuite(jinaReaderSuite);
registerSuite(firecrawlSuite);
registerSuite(scrapingbeeSuite);

export { zenrowsSuite, jinaReaderSuite, firecrawlSuite, scrapingbeeSuite };
