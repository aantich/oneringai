/**
 * GitHub Integration Test Suite
 *
 * Tests: search_files, search_code, read_file, list_branches, get_pr, pr_files, pr_comments, create_pr
 */

import type { IntegrationTestSuite } from '../types.js';
import { registerSuite } from '../runner.js';

const githubSuite: IntegrationTestSuite = {
  id: 'github',
  serviceType: 'github',
  name: 'GitHub',
  description: 'Tests GitHub tools: file search, code search, file reading, branches, and PRs.',
  requiredParams: [
    {
      key: 'testRepository',
      label: 'Test Repository',
      description: 'Repository in owner/repo format (e.g., "octocat/Hello-World")',
      type: 'string',
      required: true,
    },
  ],
  optionalParams: [
    {
      key: 'testPRNumber',
      label: 'Test PR Number',
      description: 'Existing PR number for get_pr/pr_files/pr_comments tests',
      type: 'string',
      required: false,
    },
    {
      key: 'testCodeQuery',
      label: 'Code Search Query',
      description: 'Query for search_code test (default: "import")',
      type: 'string',
      required: false,
      default: 'import',
    },
  ],
  tests: [
    // --- File operations ---
    {
      name: 'Search files in repository',
      toolName: 'search_files',
      description: 'Searches for files by name/path pattern',
      requiredParams: ['testRepository'],
      critical: true, // Verifies repo access
      execute: async (tools, ctx) => {
        const tool = tools.get('search_files')!;
        const result = await tool.execute({
          repository: ctx.params.testRepository,
          query: 'README',
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Search files failed', data: result };
        }
        // Store a file path for later read test
        if (result.files?.length > 0) {
          ctx.state.testFilePath = result.files[0].path || result.files[0].name;
        }
        return {
          success: true,
          message: `Found ${result.files?.length ?? 0} files`,
          data: result,
        };
      },
    },
    {
      name: 'Search code in repository',
      toolName: 'search_code',
      description: 'Searches for code content across the repository',
      requiredParams: ['testRepository'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('search_code')!;
        const query = ctx.params.testCodeQuery || 'import';
        const result = await tool.execute({
          repository: ctx.params.testRepository,
          query,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Search code failed', data: result };
        }
        return {
          success: true,
          message: `Found ${result.results?.length ?? result.items?.length ?? 0} code matches`,
          data: result,
        };
      },
    },
    {
      name: 'Read a file from repository',
      toolName: 'read_file',
      description: 'Reads content of a file (README or from search results)',
      requiredParams: ['testRepository'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('read_file')!;
        const filePath = (ctx.state.testFilePath as string) || 'README.md';
        const result = await tool.execute({
          repository: ctx.params.testRepository,
          path: filePath,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Read file failed', data: result };
        }
        return {
          success: true,
          message: `Read ${filePath} (${result.content?.length ?? 0} chars)`,
          data: result,
        };
      },
    },

    // --- Branches ---
    {
      name: 'List branches',
      toolName: 'list_branches',
      description: 'Lists repository branches',
      requiredParams: ['testRepository'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('list_branches')!;
        const result = await tool.execute({
          repository: ctx.params.testRepository,
        });
        if (!result.success) {
          return { success: false, message: result.error || 'List branches failed', data: result };
        }
        return {
          success: true,
          message: `Found ${result.branches?.length ?? 0} branches`,
          data: result,
        };
      },
    },

    // --- Pull Requests ---
    {
      name: 'Get pull request',
      toolName: 'get_pr',
      description: 'Gets details of a pull request',
      requiredParams: ['testRepository', 'testPRNumber'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('get_pr')!;
        const result = await tool.execute({
          repository: ctx.params.testRepository,
          pullNumber: parseInt(ctx.params.testPRNumber!, 10),
        });
        if (!result.success) {
          return { success: false, message: result.error || 'Get PR failed', data: result };
        }
        return {
          success: true,
          message: `PR #${ctx.params.testPRNumber}: ${result.title || result.data?.title || 'OK'}`,
          data: result,
        };
      },
    },
    {
      name: 'Get PR files',
      toolName: 'pr_files',
      description: 'Lists files changed in a pull request',
      requiredParams: ['testRepository', 'testPRNumber'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('pr_files')!;
        const result = await tool.execute({
          repository: ctx.params.testRepository,
          pullNumber: parseInt(ctx.params.testPRNumber!, 10),
        });
        if (!result.success) {
          return { success: false, message: result.error || 'PR files failed', data: result };
        }
        return {
          success: true,
          message: `PR has ${result.files?.length ?? 0} changed files`,
          data: result,
        };
      },
    },
    {
      name: 'Get PR comments',
      toolName: 'pr_comments',
      description: 'Lists comments on a pull request',
      requiredParams: ['testRepository', 'testPRNumber'],
      critical: false,
      execute: async (tools, ctx) => {
        const tool = tools.get('pr_comments')!;
        const result = await tool.execute({
          repository: ctx.params.testRepository,
          pullNumber: parseInt(ctx.params.testPRNumber!, 10),
        });
        if (!result.success) {
          return { success: false, message: result.error || 'PR comments failed', data: result };
        }
        return {
          success: true,
          message: `PR has ${result.comments?.length ?? 0} comments`,
          data: result,
        };
      },
    },
  ],
};

registerSuite(githubSuite);
export { githubSuite };
