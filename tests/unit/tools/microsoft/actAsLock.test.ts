/**
 * Tests for the `actAs` lock on Microsoft Graph connector tools.
 *
 * The lock is set ONCE at tool instantiation (typically by the host app when
 * wiring tools into a specific agent) and the LLM cannot override it at call time.
 *
 * Behaviors verified here:
 *   1. With `actAs` set, the JSON schema OMITS the `targetUser` property entirely
 *      so the LLM can't even attempt to express an unauthorized identity.
 *   2. With `actAs` set, every Graph call uses `/users/${actAs}` regardless of any
 *      `targetUser` arg the LLM might still pass (defense in depth).
 *   3. Without `actAs` on a delegated connector, `targetUser` is OMITTED from the
 *      schema (the OAuth token already binds identity).
 *   4. Without `actAs` on an app-only connector, `targetUser` is REQUIRED in the
 *      schema (existing behavior preserved).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '../../../../src/core/Connector.js';
import { ConnectorTools } from '../../../../src/tools/connector/ConnectorTools.js';
import {
  getUserPathPrefix,
  shouldExposeTargetUserParam,
} from '../../../../src/tools/microsoft/types.js';
import { createSendEmailTool } from '../../../../src/tools/microsoft/sendEmail.js';
import { createDraftEmailTool } from '../../../../src/tools/microsoft/createDraftEmail.js';
import { createMeetingTool } from '../../../../src/tools/microsoft/createMeeting.js';
import { createListMeetingsTool } from '../../../../src/tools/microsoft/listMeetings.js';
import { createGetMeetingTool } from '../../../../src/tools/microsoft/getMeeting.js';
import { createMicrosoftListFilesTool } from '../../../../src/tools/microsoft/listFiles.js';

// Trigger registration side-effects
import '../../../../src/tools/microsoft/index.js';

function makeAppConnector(name: string): Connector {
  return Connector.create({
    name,
    serviceType: 'microsoft',
    auth: {
      type: 'oauth',
      flow: 'client_credentials',
      clientId: 'cid',
      clientSecret: 'csec',
      tokenUrl: 'https://login.microsoftonline.com/t/oauth2/v2.0/token',
    },
    baseURL: 'https://graph.microsoft.com/v1.0',
  });
}

function makeDelegatedConnector(name: string): Connector {
  return Connector.create({
    name,
    serviceType: 'microsoft',
    auth: {
      type: 'oauth',
      flow: 'authorization_code',
      clientId: 'cid',
      clientSecret: 'csec',
      tokenUrl: 'https://login.microsoftonline.com/t/oauth2/v2.0/token',
      authorizationUrl: 'https://login.microsoftonline.com/t/oauth2/v2.0/authorize',
      redirectUri: 'http://localhost/cb',
    },
    baseURL: 'https://graph.microsoft.com/v1.0',
  });
}

function mockResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

function getProperties(tool: { definition: { function: { parameters: { properties: Record<string, unknown> } } } }) {
  return tool.definition.function.parameters.properties;
}

describe('Microsoft tools — actAs lock', () => {
  beforeEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });
  afterEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  // -----------------------------------------------------------------------
  // getUserPathPrefix — pure helper
  // -----------------------------------------------------------------------

  describe('getUserPathPrefix', () => {
    it('uses actAs over targetUser on app-only auth', () => {
      const c = makeAppConnector('msft-1');
      expect(getUserPathPrefix(c, 'llm-supplied@x.com', 'locked@x.com'))
        .toBe('/users/locked@x.com');
    });

    it('uses actAs when targetUser is undefined on app-only auth', () => {
      const c = makeAppConnector('msft-2');
      expect(getUserPathPrefix(c, undefined, 'locked@x.com')).toBe('/users/locked@x.com');
    });

    it('falls back to targetUser when actAs is undefined on app-only auth', () => {
      const c = makeAppConnector('msft-3');
      expect(getUserPathPrefix(c, 'llm-supplied@x.com')).toBe('/users/llm-supplied@x.com');
    });

    it('throws when both actAs and targetUser are undefined on app-only auth', () => {
      const c = makeAppConnector('msft-4');
      expect(() => getUserPathPrefix(c, undefined, undefined)).toThrow(/targetUser is required/);
    });

    it('returns /me on delegated auth and ignores both args', () => {
      const c = makeDelegatedConnector('msft-5');
      expect(getUserPathPrefix(c, 'foo@x.com', 'bar@x.com')).toBe('/me');
    });

    // F1 — empty/whitespace strings must behave like undefined.
    // Without normalization, '' ?? targetUser returns '' (since '' is not nullish),
    // breaking the lock UX in subtle ways.
    it('treats actAs="" like unset, falling back to targetUser', () => {
      const c = makeAppConnector('msft-6');
      expect(getUserPathPrefix(c, 'llm@x.com', '')).toBe('/users/llm@x.com');
    });

    it('treats actAs whitespace-only like unset, falling back to targetUser', () => {
      const c = makeAppConnector('msft-7');
      expect(getUserPathPrefix(c, 'llm@x.com', '   ')).toBe('/users/llm@x.com');
    });

    it('treats targetUser="" like unset, throws when also no actAs', () => {
      const c = makeAppConnector('msft-8');
      expect(() => getUserPathPrefix(c, '', undefined)).toThrow(/targetUser is required/);
    });

    it('trims surrounding whitespace on actAs', () => {
      const c = makeAppConnector('msft-9');
      expect(getUserPathPrefix(c, undefined, '  alice@x.com  ')).toBe('/users/alice@x.com');
    });
  });

  // -----------------------------------------------------------------------
  // shouldExposeTargetUserParam
  // -----------------------------------------------------------------------

  describe('shouldExposeTargetUserParam', () => {
    it('app-only without actAs → expose', () => {
      expect(shouldExposeTargetUserParam(makeAppConnector('a1'))).toBe(true);
    });
    it('app-only with actAs → hide (locked)', () => {
      expect(shouldExposeTargetUserParam(makeAppConnector('a2'), 'x@y.com')).toBe(false);
    });
    it('delegated without actAs → hide (token binds identity)', () => {
      expect(shouldExposeTargetUserParam(makeDelegatedConnector('a3'))).toBe(false);
    });
    it('delegated with actAs → hide', () => {
      expect(shouldExposeTargetUserParam(makeDelegatedConnector('a4'), 'x@y.com')).toBe(false);
    });
    // F1 — empty actAs treated as unset for schema purposes too
    it('app-only with actAs="" → expose (treated as unset)', () => {
      expect(shouldExposeTargetUserParam(makeAppConnector('a5'), '')).toBe(true);
    });
    it('app-only with actAs="   " → expose (treated as unset)', () => {
      expect(shouldExposeTargetUserParam(makeAppConnector('a6'), '   ')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Schema shape — every Microsoft tool
  // -----------------------------------------------------------------------

  describe('per-tool schema (sendEmail)', () => {
    it('app-only + locked → no targetUser in schema', () => {
      const c = makeAppConnector('msft-se-locked');
      const tool = createSendEmailTool(c, undefined, 'locked@x.com');
      expect(getProperties(tool)).not.toHaveProperty('targetUser');
    });

    it('app-only + unlocked → targetUser in schema', () => {
      const c = makeAppConnector('msft-se-unlocked');
      const tool = createSendEmailTool(c, undefined);
      expect(getProperties(tool)).toHaveProperty('targetUser');
    });

    it('delegated + unlocked → no targetUser in schema (token binds)', () => {
      const c = makeDelegatedConnector('msft-se-deleg');
      const tool = createSendEmailTool(c, undefined);
      expect(getProperties(tool)).not.toHaveProperty('targetUser');
    });
  });

  describe('per-tool schema (other Microsoft tools)', () => {
    it('createDraftEmail — locked hides targetUser', () => {
      const c = makeAppConnector('msft-cd-locked');
      expect(getProperties(createDraftEmailTool(c, undefined, 'x@y.com')))
        .not.toHaveProperty('targetUser');
      const c2 = makeAppConnector('msft-cd-unlocked');
      expect(getProperties(createDraftEmailTool(c2, undefined)))
        .toHaveProperty('targetUser');
    });

    it('createMeeting — locked hides targetUser', () => {
      const c = makeAppConnector('msft-cm-locked');
      expect(getProperties(createMeetingTool(c, undefined, 'x@y.com')))
        .not.toHaveProperty('targetUser');
    });

    it('listMeetings — locked hides targetUser', () => {
      const c = makeAppConnector('msft-lm-locked');
      expect(getProperties(createListMeetingsTool(c, undefined, 'x@y.com')))
        .not.toHaveProperty('targetUser');
    });

    it('getMeeting — locked hides targetUser', () => {
      const c = makeAppConnector('msft-gm-locked');
      expect(getProperties(createGetMeetingTool(c, undefined, 'x@y.com')))
        .not.toHaveProperty('targetUser');
    });

    it('listFiles — locked hides targetUser', () => {
      const c = makeAppConnector('msft-lf-locked');
      expect(getProperties(createMicrosoftListFilesTool(c, undefined, 'x@y.com')))
        .not.toHaveProperty('targetUser');
    });
  });

  // -----------------------------------------------------------------------
  // Runtime — locked URL is used regardless of LLM arg
  // -----------------------------------------------------------------------

  describe('runtime — locked tools always hit /users/{actAs}', () => {
    it('sendEmail uses locked path even if LLM supplies a different targetUser', async () => {
      const c = makeAppConnector('msft-rt-1');
      const fetchSpy = vi.spyOn(c, 'fetch');
      fetchSpy.mockResolvedValue(mockResponse({}, 202));

      const tool = createSendEmailTool(c, undefined, 'locked@acme.com');

      // The LLM tries to override — in reality this arg is removed from the
      // schema, but defense in depth: if it somehow gets through, it MUST be ignored.
      const result = await tool.execute({
        to: ['recipient@acme.com'],
        subject: 'subj',
        body: '<p>body</p>',
        // @ts-expect-error — testing defense in depth: LLM could try this path
        targetUser: 'attacker@acme.com',
      });

      expect(result.success).toBe(true);
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toBe('/users/locked@acme.com/sendMail');
      expect(calledUrl).not.toContain('attacker@acme.com');
      fetchSpy.mockRestore();
    });

    it('listMeetings uses locked path even if LLM supplies targetUser', async () => {
      const c = makeAppConnector('msft-rt-2');
      const fetchSpy = vi.spyOn(c, 'fetch');
      fetchSpy.mockResolvedValue(mockResponse({ value: [] }));

      const tool = createListMeetingsTool(c, undefined, 'locked@acme.com');
      const result = await tool.execute({
        startDateTime: '2025-01-01T00:00:00',
        endDateTime: '2025-01-02T00:00:00',
        // @ts-expect-error — defense in depth
        targetUser: 'attacker@acme.com',
      });

      expect(result.success).toBe(true);
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl.startsWith('/users/locked@acme.com/calendarView')).toBe(true);
      expect(calledUrl).not.toContain('attacker@acme.com');
      fetchSpy.mockRestore();
    });

    it('unlocked app-only tool with LLM-supplied targetUser uses that user', async () => {
      const c = makeAppConnector('msft-rt-3');
      const fetchSpy = vi.spyOn(c, 'fetch');
      fetchSpy.mockResolvedValue(mockResponse({}, 202));

      const tool = createSendEmailTool(c, undefined); // no actAs
      const result = await tool.execute({
        to: ['recipient@acme.com'],
        subject: 'subj',
        body: '<p>body</p>',
        targetUser: 'alice@acme.com',
      });

      expect(result.success).toBe(true);
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toBe('/users/alice@acme.com/sendMail');
      fetchSpy.mockRestore();
    });

    it('delegated tool always hits /me regardless of actAs / targetUser', async () => {
      const c = makeDelegatedConnector('msft-rt-4');
      const fetchSpy = vi.spyOn(c, 'fetch');
      fetchSpy.mockResolvedValue(mockResponse({}, 202));

      // Even setting actAs on delegated must be a no-op
      const tool = createSendEmailTool(c, undefined, 'locked@acme.com');
      const result = await tool.execute({
        to: ['recipient@acme.com'],
        subject: 'subj',
        body: '<p>body</p>',
      });

      expect(result.success).toBe(true);
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl).toBe('/me/sendMail');
      fetchSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // ConnectorTools.for — actAs flows through to factories
  // -----------------------------------------------------------------------

  describe('ConnectorTools.for() with actAs option', () => {
    it('passes actAs to the registered factory and yields locked-schema tools', () => {
      const c = makeAppConnector('msft-ct');
      const tools = ConnectorTools.for(c, undefined, { actAs: 'locked@acme.com' });

      const sendEmail = tools.find(t => /send_email/i.test(t.definition.function.name));
      expect(sendEmail).toBeDefined();
      expect(getProperties(sendEmail!)).not.toHaveProperty('targetUser');
    });

    it('without actAs option, schema includes targetUser on app-only', () => {
      const c = makeAppConnector('msft-ct-nolock');
      const tools = ConnectorTools.for(c);

      const sendEmail = tools.find(t => /send_email/i.test(t.definition.function.name));
      expect(sendEmail).toBeDefined();
      expect(getProperties(sendEmail!)).toHaveProperty('targetUser');
    });
  });

  // -----------------------------------------------------------------------
  // F5 — Documentation tests for non-participating tools
  //
  // These tools intentionally do NOT honor the actAs lock because their
  // request URL is not user-scoped at the URL level. Locking them at the
  // library layer would be misleading — data scope follows the underlying
  // token. These tests exist to PROVE that gap stays a deliberate decision:
  // if someone ever adds actAs handling here, the test fails and they must
  // revisit the design (and update the docstring + CHANGELOG).
  // -----------------------------------------------------------------------

  describe('non-participating tools (intentional gap)', () => {
    it('searchFiles always exposes targetUser in schema, regardless of actAs', () => {
      const c = makeAppConnector('msft-np-1');
      const tools = ConnectorTools.for(c, undefined, { actAs: 'locked@acme.com' });
      const search = tools.find(t => /search_files/i.test(t.definition.function.name));
      expect(search).toBeDefined();
      // Lock is set, but searchFiles ignores it — schema still has targetUser
      expect(getProperties(search!)).toHaveProperty('targetUser');
    });
  });
});
