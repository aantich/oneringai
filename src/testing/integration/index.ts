/**
 * Integration Test Suite Registry
 *
 * Imports all test suites (side-effect registers them) and re-exports the public API.
 *
 * Usage:
 *   import { IntegrationTestRunner } from '@everworker/oneringai';
 *   const suites = IntegrationTestRunner.getAllSuites();
 *   const result = await IntegrationTestRunner.runSuite(suite, tools, params);
 */

// Side-effect imports: each suite registers itself with the runner
import './suites/google.js';
import './suites/microsoft.js';
import './suites/slack.js';
import './suites/github.js';
import './suites/telegram.js';
import './suites/twilio.js';
import './suites/zoom.js';
import './suites/web-search.js';
import './suites/web-scrape.js';
import './suites/generic-api.js';

// Public API
export { IntegrationTestRunner, registerSuite } from './runner.js';
export type {
  IntegrationTestSuite,
  IntegrationTestCase,
  TestCaseResult,
  TestSuiteResult,
  TestContext,
  TestParam,
  RunSuiteOptions,
} from './types.js';

// Named suite exports for direct access
export { googleWorkspaceSuite } from './suites/google.js';
export { microsoftSuite } from './suites/microsoft.js';
export { slackSuite } from './suites/slack.js';
export { githubSuite } from './suites/github.js';
export { telegramSuite } from './suites/telegram.js';
export { twilioSuite } from './suites/twilio.js';
export { zoomSuite } from './suites/zoom.js';
export {
  serperSuite,
  braveSearchSuite,
  tavilySuite,
  rapidapiSearchSuite,
} from './suites/web-search.js';
export {
  zenrowsSuite,
  jinaReaderSuite,
  firecrawlSuite,
  scrapingbeeSuite,
} from './suites/web-scrape.js';
export { genericApiSuite } from './suites/generic-api.js';
