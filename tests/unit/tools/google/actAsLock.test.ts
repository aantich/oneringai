/**
 * Tests for the `actAs` lock on Google API connector tools.
 *
 * Mirrors tests/unit/tools/microsoft/actAsLock.test.ts. See that file for the
 * intent and behavior contract — Google's tools follow the same pattern via
 * `getGoogleUserId(connector, targetUser?, actAs?)`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connector } from '../../../../src/core/Connector.js';
import { ConnectorTools } from '../../../../src/tools/connector/ConnectorTools.js';
import {
  getGoogleUserId,
  shouldExposeTargetUserParam,
} from '../../../../src/tools/google/types.js';
import { createGoogleSendEmailTool } from '../../../../src/tools/google/sendEmail.js';
import { createGoogleDraftEmailTool } from '../../../../src/tools/google/createDraftEmail.js';
import { createGoogleMeetingTool } from '../../../../src/tools/google/createMeeting.js';
import { createGoogleListMeetingsTool } from '../../../../src/tools/google/listMeetings.js';
import { createGoogleGetMeetingTool } from '../../../../src/tools/google/getMeeting.js';

import '../../../../src/tools/google/index.js';

function makeServiceAccountConnector(name: string): Connector {
  return Connector.create({
    name,
    serviceType: 'google-api',
    auth: {
      type: 'oauth',
      flow: 'jwt_bearer',
      clientId: 'cid',
      privateKey: 'pk',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    },
    baseURL: 'https://www.googleapis.com',
  });
}

function makeDelegatedConnector(name: string): Connector {
  return Connector.create({
    name,
    serviceType: 'google-api',
    auth: {
      type: 'oauth',
      flow: 'authorization_code',
      clientId: 'cid',
      clientSecret: 'csec',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/auth',
      redirectUri: 'http://localhost/cb',
    },
    baseURL: 'https://www.googleapis.com',
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

describe('Google tools — actAs lock', () => {
  beforeEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });
  afterEach(() => {
    Connector.clear();
    ConnectorTools.clearCache();
  });

  describe('getGoogleUserId', () => {
    it('uses actAs over targetUser on service-account auth', () => {
      const c = makeServiceAccountConnector('g-1');
      expect(getGoogleUserId(c, 'llm@x.com', 'locked@x.com')).toBe('locked@x.com');
    });

    it('uses actAs when targetUser is undefined on service-account auth', () => {
      const c = makeServiceAccountConnector('g-2');
      expect(getGoogleUserId(c, undefined, 'locked@x.com')).toBe('locked@x.com');
    });

    it('falls back to targetUser when actAs is undefined on service-account auth', () => {
      const c = makeServiceAccountConnector('g-3');
      expect(getGoogleUserId(c, 'llm@x.com')).toBe('llm@x.com');
    });

    it('throws when both actAs and targetUser are undefined on service-account auth', () => {
      const c = makeServiceAccountConnector('g-4');
      expect(() => getGoogleUserId(c, undefined, undefined)).toThrow(/targetUser is required/);
    });

    it('returns "me" on delegated auth and ignores both args', () => {
      const c = makeDelegatedConnector('g-5');
      expect(getGoogleUserId(c, 'foo@x.com', 'bar@x.com')).toBe('me');
    });

    // F1 — empty/whitespace strings must behave like undefined.
    it('treats actAs="" like unset, falling back to targetUser', () => {
      const c = makeServiceAccountConnector('g-6');
      expect(getGoogleUserId(c, 'llm@x.com', '')).toBe('llm@x.com');
    });

    it('treats actAs whitespace-only like unset, falling back to targetUser', () => {
      const c = makeServiceAccountConnector('g-7');
      expect(getGoogleUserId(c, 'llm@x.com', '   ')).toBe('llm@x.com');
    });

    it('treats targetUser="" like unset, throws when also no actAs', () => {
      const c = makeServiceAccountConnector('g-8');
      expect(() => getGoogleUserId(c, '', undefined)).toThrow(/targetUser is required/);
    });

    it('trims surrounding whitespace on actAs', () => {
      const c = makeServiceAccountConnector('g-9');
      expect(getGoogleUserId(c, undefined, '  alice@x.com  ')).toBe('alice@x.com');
    });
  });

  describe('shouldExposeTargetUserParam', () => {
    it('service-account without actAs → expose', () => {
      expect(shouldExposeTargetUserParam(makeServiceAccountConnector('s1'))).toBe(true);
    });
    it('service-account with actAs → hide', () => {
      expect(shouldExposeTargetUserParam(makeServiceAccountConnector('s2'), 'x@y.com')).toBe(false);
    });
    it('delegated without actAs → hide', () => {
      expect(shouldExposeTargetUserParam(makeDelegatedConnector('s3'))).toBe(false);
    });
    it('delegated with actAs → hide', () => {
      expect(shouldExposeTargetUserParam(makeDelegatedConnector('s4'), 'x@y.com')).toBe(false);
    });
    it('service-account with actAs="" → expose (treated as unset)', () => {
      expect(shouldExposeTargetUserParam(makeServiceAccountConnector('s5'), '')).toBe(true);
    });
    it('service-account with actAs="   " → expose (treated as unset)', () => {
      expect(shouldExposeTargetUserParam(makeServiceAccountConnector('s6'), '   ')).toBe(true);
    });
  });

  describe('per-tool schema (sendEmail)', () => {
    it('service-account + locked → no targetUser in schema', () => {
      const c = makeServiceAccountConnector('g-se-locked');
      const tool = createGoogleSendEmailTool(c, undefined, 'locked@x.com');
      expect(getProperties(tool)).not.toHaveProperty('targetUser');
    });

    it('service-account + unlocked → targetUser in schema', () => {
      const c = makeServiceAccountConnector('g-se-unlocked');
      const tool = createGoogleSendEmailTool(c, undefined);
      expect(getProperties(tool)).toHaveProperty('targetUser');
    });

    it('delegated + unlocked → no targetUser in schema (token binds)', () => {
      const c = makeDelegatedConnector('g-se-deleg');
      const tool = createGoogleSendEmailTool(c, undefined);
      expect(getProperties(tool)).not.toHaveProperty('targetUser');
    });
  });

  describe('per-tool schema (other Google tools)', () => {
    it('createDraftEmail — locked hides targetUser', () => {
      expect(getProperties(createGoogleDraftEmailTool(
        makeServiceAccountConnector('g-cd-l'), undefined, 'x@y.com',
      ))).not.toHaveProperty('targetUser');
      expect(getProperties(createGoogleDraftEmailTool(
        makeServiceAccountConnector('g-cd-u'), undefined,
      ))).toHaveProperty('targetUser');
    });

    it('createMeeting — locked hides targetUser', () => {
      expect(getProperties(createGoogleMeetingTool(
        makeServiceAccountConnector('g-cm-l'), undefined, 'x@y.com',
      ))).not.toHaveProperty('targetUser');
    });

    it('listMeetings — locked hides targetUser', () => {
      expect(getProperties(createGoogleListMeetingsTool(
        makeServiceAccountConnector('g-lm-l'), undefined, 'x@y.com',
      ))).not.toHaveProperty('targetUser');
    });

    it('getMeeting — locked hides targetUser', () => {
      expect(getProperties(createGoogleGetMeetingTool(
        makeServiceAccountConnector('g-gm-l'), undefined, 'x@y.com',
      ))).not.toHaveProperty('targetUser');
    });

    // listFiles intentionally does NOT participate in the actAs lock —
    // /drive/v3/files is not user-scoped at the URL level. See F5 below for
    // the documentation test that proves the gap.
  });

  describe('runtime — locked tools always hit /calendar/{actAs}/...', () => {
    it('listMeetings uses locked path even when LLM passes targetUser', async () => {
      const c = makeServiceAccountConnector('g-rt-1');
      const fetchSpy = vi.spyOn(c, 'fetch');
      fetchSpy.mockResolvedValue(mockResponse({ items: [] }));

      const tool = createGoogleListMeetingsTool(c, undefined, 'locked@acme.com');
      const result = await tool.execute({
        startDateTime: '2025-01-01T00:00:00Z',
        endDateTime: '2025-01-02T00:00:00Z',
        // @ts-expect-error — defense in depth
        targetUser: 'attacker@acme.com',
      });

      expect(result.success).toBe(true);
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl.includes('/calendar/v3/calendars/locked@acme.com/events')).toBe(true);
      expect(calledUrl).not.toContain('attacker@acme.com');
      fetchSpy.mockRestore();
    });

    it('unlocked service-account tool with LLM-supplied targetUser uses that user', async () => {
      const c = makeServiceAccountConnector('g-rt-2');
      const fetchSpy = vi.spyOn(c, 'fetch');
      fetchSpy.mockResolvedValue(mockResponse({ items: [] }));

      const tool = createGoogleListMeetingsTool(c, undefined); // no actAs
      const result = await tool.execute({
        startDateTime: '2025-01-01T00:00:00Z',
        endDateTime: '2025-01-02T00:00:00Z',
        targetUser: 'alice@acme.com',
      });

      expect(result.success).toBe(true);
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl.includes('/calendar/v3/calendars/alice@acme.com/events')).toBe(true);
      fetchSpy.mockRestore();
    });

    it('delegated tool always hits /me/... regardless of actAs / targetUser', async () => {
      const c = makeDelegatedConnector('g-rt-3');
      const fetchSpy = vi.spyOn(c, 'fetch');
      fetchSpy.mockResolvedValue(mockResponse({ items: [] }));

      const tool = createGoogleListMeetingsTool(c, undefined, 'locked@acme.com');
      const result = await tool.execute({
        startDateTime: '2025-01-01T00:00:00Z',
        endDateTime: '2025-01-02T00:00:00Z',
      });

      expect(result.success).toBe(true);
      const calledUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(calledUrl.includes('/calendar/v3/calendars/me/events')).toBe(true);
      fetchSpy.mockRestore();
    });
  });

  describe('ConnectorTools.for() with actAs option (Google)', () => {
    it('passes actAs through and yields locked-schema tools', () => {
      const c = makeServiceAccountConnector('g-ct');
      const tools = ConnectorTools.for(c, undefined, { actAs: 'locked@acme.com' });
      const sendEmail = tools.find(t => /send_email/i.test(t.definition.function.name));
      expect(sendEmail).toBeDefined();
      expect(getProperties(sendEmail!)).not.toHaveProperty('targetUser');
    });
  });

  // -----------------------------------------------------------------------
  // F5 — Documentation tests for non-participating tools
  //
  // These tools' endpoints aren't user-scoped at the URL level, so the
  // library cannot enforce actAs against them. They keep targetUser in their
  // schema regardless of any agent-level lock; data scope follows the token.
  // -----------------------------------------------------------------------

  describe('non-participating tools (intentional gap)', () => {
    const toolsExpectingTargetUser = [
      'list_files',
      'search_files',
      'read_file',
      'get_meeting_transcript',
      'find_meeting_slots',
    ];

    for (const baseName of toolsExpectingTargetUser) {
      it(`${baseName} always exposes targetUser, regardless of actAs`, () => {
        const c = makeServiceAccountConnector(`g-np-${baseName}`);
        const tools = ConnectorTools.for(c, undefined, { actAs: 'locked@acme.com' });
        const tool = tools.find(t => t.definition.function.name.endsWith(baseName));
        expect(tool, `tool ${baseName} should be registered`).toBeDefined();
        // Lock is set, but this tool ignores it — schema still has targetUser
        expect(getProperties(tool!)).toHaveProperty('targetUser');
      });
    }
  });
});
