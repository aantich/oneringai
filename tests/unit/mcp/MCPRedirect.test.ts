import { it, expect } from 'vitest';
import { MCPRegistry } from '../../../src/core/mcp/MCPRegistry.js';
import { probeMcpRedirects } from '../../../scripts/release/mcp-redirect-probe.mjs';

it('preserves same-origin MCP redirects and blocks cross-origin headers and bodies', async () => {
  expect(await probeMcpRedirects({ MCPRegistry })).toEqual({ sameOrigin: 'connected', crossOrigin: 'blocked', forwardedRequests: 0 });
});
