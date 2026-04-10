/**
 * Tests for GitHub Connector Tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '../../../../src/core/Connector.js';
import { ConnectorTools } from '../../../../src/tools/connector/ConnectorTools.js';
import { parseRepository, resolveRepository } from '../../../../src/tools/github/types.js';
import { createSearchFilesTool } from '../../../../src/tools/github/searchFiles.js';
import { createSearchCodeTool } from '../../../../src/tools/github/searchCode.js';
import { createGitHubReadFileTool } from '../../../../src/tools/github/readFile.js';
import { createGetPRTool } from '../../../../src/tools/github/getPR.js';
import { createPRFilesTool } from '../../../../src/tools/github/prFiles.js';
import { createPRCommentsTool } from '../../../../src/tools/github/prComments.js';
import { createCreatePRTool } from '../../../../src/tools/github/createPR.js';

// Import to trigger side-effect registration
import '../../../../src/tools/github/index.js';

/**
 * Create a mock connector with a mocked fetch method
 */
function createMockConnector(name: string, options?: Record<string, unknown>): Connector {
  const connector = Connector.create({
    name,
    serviceType: 'github',
    auth: { type: 'api_key', apiKey: 'test-token' },
    baseURL: 'https://api.github.com',
    options,
  });
  return connector;
}

/**
 * Create a mock Response
 */
function mockResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

describe('GitHub Tools', () => {
  beforeEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  afterEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  // ========================================================================
  // parseRepository
  // ========================================================================

  describe('parseRepository', () => {
    it('should parse owner/repo format', () => {
      expect(parseRepository('facebook/react')).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('should parse full GitHub URL', () => {
      expect(parseRepository('https://github.com/facebook/react')).toEqual({
        owner: 'facebook',
        repo: 'react',
      });
    });

    it('should parse GitHub URL with extra path segments', () => {
      expect(parseRepository('https://github.com/facebook/react/tree/main/src')).toEqual({
        owner: 'facebook',
        repo: 'react',
      });
    });

    it('should parse GitHub URL with .git suffix', () => {
      expect(parseRepository('https://github.com/facebook/react.git')).toEqual({
        owner: 'facebook',
        repo: 'react',
      });
    });

    it('should parse www.github.com URL', () => {
      expect(parseRepository('https://www.github.com/owner/repo')).toEqual({
        owner: 'owner',
        repo: 'repo',
      });
    });

    it('should trim whitespace', () => {
      expect(parseRepository('  owner/repo  ')).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should throw on empty string', () => {
      expect(() => parseRepository('')).toThrow('cannot be empty');
    });

    it('should throw on invalid format', () => {
      expect(() => parseRepository('just-a-name')).toThrow('Invalid repository format');
    });

    it('should throw on too many segments', () => {
      expect(() => parseRepository('a/b/c')).toThrow('Invalid repository format');
    });
  });

  // ========================================================================
  // resolveRepository
  // ========================================================================

  describe('resolveRepository', () => {
    it('should use explicit repository parameter', () => {
      const connector = createMockConnector('gh');
      const result = resolveRepository('owner/repo', connector);
      expect(result).toEqual({ success: true, repo: { owner: 'owner', repo: 'repo' } });
    });

    it('should fall back to connector defaultRepository', () => {
      const connector = createMockConnector('gh', { defaultRepository: 'default/repo' });
      const result = resolveRepository(undefined, connector);
      expect(result).toEqual({ success: true, repo: { owner: 'default', repo: 'repo' } });
    });

    it('should prefer explicit param over connector default', () => {
      const connector = createMockConnector('gh', { defaultRepository: 'default/repo' });
      const result = resolveRepository('explicit/repo', connector);
      expect(result).toEqual({ success: true, repo: { owner: 'explicit', repo: 'repo' } });
    });

    it('should return error when no repository available', () => {
      const connector = createMockConnector('gh');
      const result = resolveRepository(undefined, connector);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('No repository specified');
      }
    });

    it('should return error for invalid repository format', () => {
      const connector = createMockConnector('gh');
      const result = resolveRepository('bad-format', connector);
      expect(result.success).toBe(false);
    });
  });

  // ========================================================================
  // Tool Registration
  // ========================================================================

  describe('Tool Registration', () => {
    it('should register github service with ConnectorTools', () => {
      expect(ConnectorTools.hasServiceTools('github')).toBe(true);
    });

    it('should return 9 tools (8 GitHub + 1 generic API) via ConnectorTools.for()', () => {
      const connector = createMockConnector('my-github');
      const tools = ConnectorTools.for(connector);
      expect(tools).toHaveLength(9);
    });

    it('should prefix tool names with connector name', () => {
      const connector = createMockConnector('my-github');
      const tools = ConnectorTools.for(connector);
      const names = tools.map((t) => t.definition.function.name);

      expect(names).toContain('my-github_api');
      expect(names).toContain('my-github_search_files');
      expect(names).toContain('my-github_search_code');
      expect(names).toContain('my-github_read_file');
      expect(names).toContain('my-github_list_branches');
      expect(names).toContain('my-github_get_pr');
      expect(names).toContain('my-github_pr_files');
      expect(names).toContain('my-github_pr_comments');
      expect(names).toContain('my-github_create_pr');
    });

  });

  // ========================================================================
  // Tool Definitions
  // ========================================================================

  describe('Tool Definitions', () => {
    let connector: Connector;

    beforeEach(() => {
      connector = createMockConnector('gh-def');
    });

    it('search_files has correct name and required params', () => {
      const tool = createSearchFilesTool(connector);
      expect(tool.definition.function.name).toBe('search_files');
      expect(tool.definition.function.parameters?.required).toContain('pattern');
    });

    it('search_code has correct name and required params', () => {
      const tool = createSearchCodeTool(connector);
      expect(tool.definition.function.name).toBe('search_code');
      expect(tool.definition.function.parameters?.required).toContain('query');
    });

    it('read_file has correct name and required params', () => {
      const tool = createGitHubReadFileTool(connector);
      expect(tool.definition.function.name).toBe('read_file');
      expect(tool.definition.function.parameters?.required).toContain('path');
    });

    it('get_pr has correct name and required params', () => {
      const tool = createGetPRTool(connector);
      expect(tool.definition.function.name).toBe('get_pr');
      expect(tool.definition.function.parameters?.required).toContain('pull_number');
    });

    it('pr_files has correct name and required params', () => {
      const tool = createPRFilesTool(connector);
      expect(tool.definition.function.name).toBe('pr_files');
      expect(tool.definition.function.parameters?.required).toContain('pull_number');
    });

    it('pr_comments has correct name and required params', () => {
      const tool = createPRCommentsTool(connector);
      expect(tool.definition.function.name).toBe('pr_comments');
      expect(tool.definition.function.parameters?.required).toContain('pull_number');
    });

    it('create_pr has correct name and required params', () => {
      const tool = createCreatePRTool(connector);
      expect(tool.definition.function.name).toBe('create_pr');
      const required = tool.definition.function.parameters?.required;
      expect(required).toContain('title');
      expect(required).toContain('head');
      expect(required).toContain('base');
    });

    it('read-only tools have low risk level', () => {
      const readTools = [
        createSearchFilesTool(connector),
        createSearchCodeTool(connector),
        createGitHubReadFileTool(connector),
        createGetPRTool(connector),
        createPRFilesTool(connector),
        createPRCommentsTool(connector),
      ];

      for (const tool of readTools) {
        expect(tool.permission?.riskLevel).toBe('low');
      }
    });

    it('create_pr has medium risk level', () => {
      const tool = createCreatePRTool(connector);
      expect(tool.permission?.riskLevel).toBe('medium');
    });
  });

  // ========================================================================
  // Tool Execution (with mocked fetch)
  // ========================================================================

  describe('Tool Execution', () => {
    let connector: Connector;
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      connector = createMockConnector('gh-exec', { defaultRepository: 'test-owner/test-repo' });
      fetchSpy = vi.spyOn(connector, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    describe('search_files', () => {
      it('should fetch tree and filter by glob pattern', async () => {
        // First call: get default branch
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ default_branch: 'main' })
        );
        // Second call: get tree
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            sha: 'abc',
            tree: [
              { path: 'src/index.ts', type: 'blob', size: 100, sha: 'a1', mode: '100644', url: '' },
              { path: 'src/utils.ts', type: 'blob', size: 200, sha: 'a2', mode: '100644', url: '' },
              { path: 'README.md', type: 'blob', size: 50, sha: 'a3', mode: '100644', url: '' },
              { path: 'src', type: 'tree', sha: 'a4', mode: '040000', url: '' },
            ],
            truncated: false,
          })
        );

        const tool = createSearchFilesTool(connector);
        const result = await tool.execute({ pattern: '**/*.ts' });

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
        expect(result.files?.map((f) => f.path)).toEqual(['src/index.ts', 'src/utils.ts']);
      });

      it('should use provided ref without fetching default branch', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            sha: 'abc',
            tree: [
              { path: 'test.ts', type: 'blob', size: 10, sha: 'a1', mode: '100644', url: '' },
            ],
            truncated: false,
          })
        );

        const tool = createSearchFilesTool(connector);
        await tool.execute({ pattern: '**/*.ts', ref: 'develop' });

        // Should only be one fetch call (tree, not repo info)
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0]?.[0]).toContain('/git/trees/develop');
      });

      it('should handle API errors', async () => {
        fetchSpy.mockResolvedValueOnce(mockResponse({ default_branch: 'main' }));
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ message: 'Not Found' }, 404)
        );

        const tool = createSearchFilesTool(connector);
        const result = await tool.execute({ pattern: '**/*.ts' });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('search_code', () => {
      it('should search code with query and return matches', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            total_count: 2,
            incomplete_results: false,
            items: [
              {
                name: 'auth.ts',
                path: 'src/auth.ts',
                sha: 'abc',
                html_url: 'https://github.com/...',
                repository: { full_name: 'test-owner/test-repo' },
                text_matches: [{ fragment: 'function handleAuth() {', matches: [] }],
              },
              {
                name: 'login.ts',
                path: 'src/login.ts',
                sha: 'def',
                html_url: 'https://github.com/...',
                repository: { full_name: 'test-owner/test-repo' },
                text_matches: [{ fragment: 'import { handleAuth }', matches: [] }],
              },
            ],
          })
        );

        const tool = createSearchCodeTool(connector);
        const result = await tool.execute({ query: 'handleAuth' });

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
        expect(result.matches).toHaveLength(2);
        expect(result.matches?.[0]?.file).toBe('src/auth.ts');
        expect(result.matches?.[0]?.fragment).toContain('handleAuth');
      });

      it('should include language and path qualifiers in query', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ total_count: 0, incomplete_results: false, items: [] })
        );

        const tool = createSearchCodeTool(connector);
        await tool.execute({
          query: 'test',
          language: 'typescript',
          path: 'src/',
          extension: 'ts',
        });

        const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
        expect(calledUrl).toContain('language%3Atypescript');
        expect(calledUrl).toContain('path%3Asrc%2F');
        expect(calledUrl).toContain('extension%3Ats');
      });
    });

    describe('read_file (GitHub)', () => {
      it('should read and decode base64 file content', async () => {
        const content = 'line 1\nline 2\nline 3';
        const base64Content = Buffer.from(content).toString('base64');

        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            type: 'file',
            encoding: 'base64',
            size: content.length,
            name: 'test.ts',
            path: 'src/test.ts',
            content: base64Content,
            sha: 'abc123',
          })
        );

        const tool = createGitHubReadFileTool(connector);
        const result = await tool.execute({ path: 'src/test.ts' });

        expect(result.success).toBe(true);
        expect(result.lines).toBe(3);
        expect(result.content).toContain('line 1');
        expect(result.content).toContain('line 2');
        expect(result.content).toContain('line 3');
        expect(result.sha).toBe('abc123');
      });

      it('should apply offset and limit', async () => {
        const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
        const content = lines.join('\n');
        const base64Content = Buffer.from(content).toString('base64');

        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            type: 'file',
            encoding: 'base64',
            size: content.length,
            name: 'big.ts',
            path: 'big.ts',
            content: base64Content,
            sha: 'abc',
          })
        );

        const tool = createGitHubReadFileTool(connector);
        const result = await tool.execute({ path: 'big.ts', offset: 10, limit: 5 });

        expect(result.success).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.content).toContain('line 10');
        expect(result.content).toContain('line 14');
        expect(result.content).not.toContain('line 9');
        expect(result.content).not.toContain('line 15');
      });

      it('should fall back to blob API for large files', async () => {
        const content = 'large file content';
        const base64Content = Buffer.from(content).toString('base64');

        // Contents API returns git_url without content
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            type: 'file',
            size: 2000000,
            name: 'large.bin',
            path: 'large.bin',
            sha: 'abc',
            git_url: 'https://api.github.com/repos/test-owner/test-repo/git/blobs/abc',
          })
        );

        // Blob API returns content
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            content: base64Content,
            encoding: 'base64',
            sha: 'abc',
            size: content.length,
          })
        );

        const tool = createGitHubReadFileTool(connector);
        const result = await tool.execute({ path: 'large.bin' });

        expect(result.success).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('should return error for directories', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ type: 'dir', size: 0, name: 'src', path: 'src', sha: 'abc' })
        );

        const tool = createGitHubReadFileTool(connector);
        const result = await tool.execute({ path: 'src' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('not a file');
      });
    });

    describe('get_pr', () => {
      it('should return PR details', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            number: 42,
            title: 'Add feature',
            body: 'Description here',
            state: 'open',
            draft: false,
            user: { login: 'author' },
            labels: [{ name: 'enhancement' }],
            requested_reviewers: [{ login: 'reviewer1' }],
            mergeable: true,
            head: { ref: 'feature-branch', sha: 'abc' },
            base: { ref: 'main', sha: 'def' },
            html_url: 'https://github.com/test-owner/test-repo/pull/42',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-02T00:00:00Z',
            additions: 10,
            deletions: 5,
            changed_files: 3,
          })
        );

        const tool = createGetPRTool(connector);
        const result = await tool.execute({ pull_number: 42 });

        expect(result.success).toBe(true);
        expect(result.data?.number).toBe(42);
        expect(result.data?.title).toBe('Add feature');
        expect(result.data?.author).toBe('author');
        expect(result.data?.labels).toEqual(['enhancement']);
        expect(result.data?.reviewers).toEqual(['reviewer1']);
        expect(result.data?.head).toBe('feature-branch');
        expect(result.data?.base).toBe('main');
        expect(result.data?.draft).toBe(false);
      });
    });

    describe('pr_files', () => {
      it('should return changed files with diffs', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse([
            {
              sha: 'abc',
              filename: 'src/index.ts',
              status: 'modified',
              additions: 5,
              deletions: 2,
              changes: 7,
              patch: '@@ -1,3 +1,6 @@\n+new line',
            },
            {
              sha: 'def',
              filename: 'src/new.ts',
              status: 'added',
              additions: 10,
              deletions: 0,
              changes: 10,
            },
          ])
        );

        const tool = createPRFilesTool(connector);
        const result = await tool.execute({ pull_number: 42 });

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
        expect(result.files?.[0]?.filename).toBe('src/index.ts');
        expect(result.files?.[0]?.status).toBe('modified');
        expect(result.files?.[0]?.patch).toContain('+new line');
        expect(result.files?.[1]?.status).toBe('added');
      });
    });

    describe('pr_comments', () => {
      it('should merge and sort comments from all three endpoints', async () => {
        // Review comments (line-level)
        fetchSpy.mockResolvedValueOnce(
          mockResponse([
            {
              id: 1,
              user: { login: 'reviewer' },
              body: 'Fix this line',
              created_at: '2024-01-02T00:00:00Z',
              path: 'src/index.ts',
              line: 10,
            },
          ])
        );

        // Reviews
        fetchSpy.mockResolvedValueOnce(
          mockResponse([
            {
              id: 2,
              user: { login: 'reviewer' },
              body: 'Looks good overall',
              state: 'COMMENTED',
              submitted_at: '2024-01-03T00:00:00Z',
            },
          ])
        );

        // Issue comments
        fetchSpy.mockResolvedValueOnce(
          mockResponse([
            {
              id: 3,
              user: { login: 'author' },
              body: 'Thanks for the review!',
              created_at: '2024-01-01T00:00:00Z',
            },
          ])
        );

        const tool = createPRCommentsTool(connector);
        const result = await tool.execute({ pull_number: 42 });

        expect(result.success).toBe(true);
        expect(result.count).toBe(3);

        // Should be sorted by created_at (oldest first)
        expect(result.comments?.[0]?.type).toBe('comment');
        expect(result.comments?.[0]?.body).toBe('Thanks for the review!');
        expect(result.comments?.[1]?.type).toBe('review_comment');
        expect(result.comments?.[1]?.path).toBe('src/index.ts');
        expect(result.comments?.[2]?.type).toBe('review');
      });

      it('should skip empty-body approval reviews', async () => {
        fetchSpy.mockResolvedValueOnce(mockResponse([]));
        fetchSpy.mockResolvedValueOnce(
          mockResponse([
            {
              id: 1,
              user: { login: 'reviewer' },
              body: '',
              state: 'APPROVED',
              submitted_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 2,
              user: { login: 'reviewer' },
              body: 'Great work!',
              state: 'APPROVED',
              submitted_at: '2024-01-02T00:00:00Z',
            },
          ])
        );
        fetchSpy.mockResolvedValueOnce(mockResponse([]));

        const tool = createPRCommentsTool(connector);
        const result = await tool.execute({ pull_number: 42 });

        expect(result.count).toBe(1);
        expect(result.comments?.[0]?.body).toBe('Great work!');
      });
    });

    describe('create_pr', () => {
      it('should create a PR and return result', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({
            number: 99,
            html_url: 'https://github.com/test-owner/test-repo/pull/99',
            state: 'open',
            title: 'New Feature',
          })
        );

        const tool = createCreatePRTool(connector);
        const result = await tool.execute({
          title: 'New Feature',
          body: 'Description',
          head: 'feature',
          base: 'main',
        });

        expect(result.success).toBe(true);
        expect(result.data?.number).toBe(99);
        expect(result.data?.url).toContain('/pull/99');

        // Verify the POST body
        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.title).toBe('New Feature');
        expect(callBody.head).toBe('feature');
        expect(callBody.base).toBe('main');
        expect(callBody.draft).toBe(false);
      });

      it('should support draft PRs', async () => {
        fetchSpy.mockResolvedValueOnce(
          mockResponse({ number: 100, html_url: 'https://github.com/...', state: 'open', title: 'Draft' })
        );

        const tool = createCreatePRTool(connector);
        await tool.execute({
          title: 'Draft',
          head: 'wip',
          base: 'main',
          draft: true,
        });

        const callBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
        expect(callBody.draft).toBe(true);
      });
    });

    describe('describeCall', () => {
      it('search_files describes call correctly', () => {
        const tool = createSearchFilesTool(connector);
        expect(tool.describeCall?.({ pattern: '**/*.ts', repository: 'org/repo', ref: 'dev' })).toBe(
          '**/*.ts in org/repo @dev'
        );
      });

      it('search_code describes call correctly', () => {
        const tool = createSearchCodeTool(connector);
        expect(tool.describeCall?.({ query: 'TODO', language: 'ts', repository: 'org/repo' })).toBe(
          '"TODO" lang:ts in org/repo'
        );
      });

      it('read_file describes call correctly', () => {
        const tool = createGitHubReadFileTool(connector);
        expect(tool.describeCall?.({ path: 'src/app.ts', repository: 'org/repo' })).toBe(
          'src/app.ts in org/repo'
        );
      });

      it('get_pr describes call correctly', () => {
        const tool = createGetPRTool(connector);
        expect(tool.describeCall?.({ pull_number: 42, repository: 'org/repo' })).toBe('#42 in org/repo');
      });

      it('pr_files describes call correctly', () => {
        const tool = createPRFilesTool(connector);
        expect(tool.describeCall?.({ pull_number: 42, repository: 'org/repo' })).toBe(
          'files for #42 in org/repo'
        );
      });

      it('create_pr describes call correctly', () => {
        const tool = createCreatePRTool(connector);
        expect(tool.describeCall?.({ title: 'Fix bug', head: 'fix', base: 'main', repository: 'org/repo' })).toBe(
          'Fix bug in org/repo'
        );
      });
    });
  });
});
