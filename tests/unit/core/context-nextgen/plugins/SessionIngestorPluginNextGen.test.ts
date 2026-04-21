/**
 * SessionIngestorPluginNextGen unit tests.
 *
 * We mock `Agent.create` so the plugin's internal LLM agent is replaced with
 * a stub whose `runDirect` returns canned extraction / merge responses. The
 * rest of the pipeline (mention resolution, dedup, updateFactDetails) runs
 * against a real in-memory MemorySystem.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '@/core/Agent.js';
import {
  SessionIngestorPluginNextGen,
  buildSessionExtractionPrompt,
  renderMessage,
} from '@/core/context-nextgen/plugins/SessionIngestorPluginNextGen.js';
import { MemorySystem } from '@/memory/MemorySystem.js';
import { InMemoryAdapter } from '@/memory/adapters/inmemory/InMemoryAdapter.js';

const USER = 'alice';
const AGENT = 'claude-work-agent';

function makeMem() {
  return new MemorySystem({ store: new InMemoryAdapter() });
}

type RunDirect = Agent['runDirect'];

function stubAgent(responses: string[]): {
  mock: ReturnType<typeof vi.spyOn>;
  calls: Array<{ prompt: string }>;
  restore: () => void;
} {
  const calls: Array<{ prompt: string }> = [];
  let idx = 0;
  const runDirect: RunDirect = (async (prompt: string) => {
    calls.push({ prompt });
    const out = responses[idx] ?? '';
    idx += 1;
    return {
      output_text: out,
      stop_reason: 'end',
      usage: undefined,
    } as Awaited<ReturnType<RunDirect>>;
  }) as RunDirect;
  const fakeAgent = {
    runDirect,
    destroy: () => {},
  } as unknown as Agent;
  const spy = vi.spyOn(Agent, 'create').mockReturnValue(fakeAgent);
  return {
    mock: spy,
    calls,
    restore: () => spy.mockRestore(),
  };
}

describe('SessionIngestorPluginNextGen — constructor guards', () => {
  it('throws when required config missing', () => {
    const mem = makeMem();
    expect(
      () => new SessionIngestorPluginNextGen({
        memory: mem,
        agentId: AGENT,
        userId: USER,
        connectorName: '',
        model: 'm', minBatchMessages: 1,
      }),
    ).toThrow(/connectorName/);
    expect(
      () => new SessionIngestorPluginNextGen({
        memory: mem,
        agentId: AGENT,
        userId: USER,
        connectorName: 'c',
        model: '',
      }),
    ).toThrow(/model/);
  });

  it('contributes nothing to context', async () => {
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });
    expect(plugin.getInstructions()).toBeNull();
    expect(await plugin.getContent()).toBeNull();
    expect(plugin.getTools()).toEqual([]);
    expect(plugin.getTokenSize()).toBe(0);
  });
});

describe('SessionIngestorPluginNextGen — watermark state', () => {
  it('persists lastIngestedMessageId via getState/restoreState', () => {
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });
    // @ts-expect-error private write for test
    plugin.lastIngestedMessageId = 'msg-42';
    const state = plugin.getState();

    const fresh = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });
    fresh.restoreState(state);
    expect(fresh.getLastIngestedMessageId()).toBe('msg-42');
  });

  it('drops watermark on userId mismatch during restore', () => {
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: 'bob',
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });
    plugin.restoreState({ version: 2, agentId: AGENT, userId: 'alice', lastIngestedMessageId: 'msg-9' });
    expect(plugin.getLastIngestedMessageId()).toBeNull();
  });

  it('ignores v1 state (legacy watermark index is untranslatable)', () => {
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });
    plugin.restoreState({ version: 1, agentId: AGENT, userId: USER, watermark: 99 });
    expect(plugin.getLastIngestedMessageId()).toBeNull();
  });
});

describe('SessionIngestorPluginNextGen — onBeforePrepare', () => {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    restore?.();
    restore = null;
  });

  it('no-ops when there are no new messages', async () => {
    const stub = stubAgent([]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });
    plugin.onBeforePrepare({ messages: [], currentInput: [] });
    await plugin.waitForIngest();
    expect(stub.calls.length).toBe(0);
  });

  it('extracts facts + bootstraps user/agent + writes new fact', async () => {
    const extractionJson = JSON.stringify({
      mentions: {},
      facts: [
        {
          subject: 'm_user',
          predicate: 'works_at',
          value: 'Everworker',
          kind: 'atomic',
          importance: 0.9,
          confidence: 1.0,
        },
      ],
    });
    const stub = stubAgent([extractionJson]);
    restore = stub.restore;

    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });

    plugin.onBeforePrepare({
      messages: [
        { id: 'm1', role: 'user', content: 'I work at Everworker' },
        { id: 'm2', role: 'assistant', content: 'Got it.' },
      ],
      currentInput: [],
    });
    await plugin.waitForIngest();

    // Watermark advanced to the newest message id that fit.
    expect(plugin.getLastIngestedMessageId()).toBe('m2');

    const facts = await mem.findFacts(
      { predicate: 'works_at' },
      {},
      { userId: USER },
    );
    expect(facts.items.length).toBe(1);
    expect(facts.items[0]!.value).toBe('Everworker');
    // Verify only one LLM call (no merge — nothing to merge)
    expect(stub.calls.length).toBe(1);
  });

  it('dedupes + invokes LLM merge on duplicate with new details', async () => {
    const firstExtraction = JSON.stringify({
      mentions: {},
      facts: [
        {
          subject: 'm_user',
          predicate: 'works_at',
          value: 'Everworker',
          kind: 'atomic',
          details: 'Joined Jan 2024 as platform lead.',
        },
      ],
    });
    const secondExtraction = JSON.stringify({
      mentions: {},
      facts: [
        {
          subject: 'm_user',
          predicate: 'works_at',
          value: 'Everworker',
          kind: 'atomic',
          details: 'Recently moved to focus on agent tooling.',
        },
      ],
    });
    const mergedDetails =
      'Joined Jan 2024 as platform lead; recently moved to focus on agent tooling.';
    const stub = stubAgent([firstExtraction, secondExtraction, mergedDetails]);
    restore = stub.restore;

    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });

    // Turn 1 — writes the fact
    plugin.onBeforePrepare({
      messages: [{ id: 't1', role: 'user', content: 'I work at Everworker, joined last year' }],
      currentInput: [],
    });
    await plugin.waitForIngest();

    // Turn 2 — re-extracts same fact, should hit dedup path + merge details
    plugin.onBeforePrepare({
      messages: [
        { id: 't1', role: 'user', content: 'I work at Everworker, joined last year' },
        { id: 't2', role: 'assistant', content: 'Noted.' },
        { id: 't3', role: 'user', content: 'Moved to agent tooling recently.' },
      ],
      currentInput: [],
    });
    await plugin.waitForIngest();

    // Should still be exactly ONE works_at fact (dedup'd)
    const facts = await mem.findFacts(
      { predicate: 'works_at' },
      {},
      { userId: USER },
    );
    expect(facts.items.length).toBe(1);
    expect(facts.items[0]!.details).toBe(mergedDetails);

    // 3 LLM calls: 2 extractions + 1 merge
    expect(stub.calls.length).toBe(3);
    // Last call was the merge prompt
    expect(stub.calls[2]!.prompt).toMatch(/merged narrative/);
  });

  it('keeps existing details when merge LLM call fails (fallback (a))', async () => {
    const firstExtraction = JSON.stringify({
      mentions: {},
      facts: [
        {
          subject: 'm_user',
          predicate: 'lives_in',
          value: 'Lisbon',
          kind: 'atomic',
          details: 'Original details.',
        },
      ],
    });
    const secondExtraction = JSON.stringify({
      mentions: {},
      facts: [
        {
          subject: 'm_user',
          predicate: 'lives_in',
          value: 'Lisbon',
          kind: 'atomic',
          details: 'New observation.',
        },
      ],
    });
    // Third call (merge) throws — simulate connector failure
    const calls: Array<{ prompt: string }> = [];
    let idx = 0;
    const runDirect: RunDirect = (async (prompt: string) => {
      calls.push({ prompt });
      idx += 1;
      if (idx === 3) throw new Error('connector down');
      const responses = [firstExtraction, secondExtraction];
      return {
        output_text: responses[idx - 1] ?? '',
        stop_reason: 'end',
        usage: undefined,
      } as Awaited<ReturnType<RunDirect>>;
    }) as RunDirect;
    const fakeAgent = { runDirect, destroy: () => {} } as unknown as Agent;
    const spy = vi.spyOn(Agent, 'create').mockReturnValue(fakeAgent);
    restore = () => spy.mockRestore();

    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });

    plugin.onBeforePrepare({
      messages: [{ id: 'L1', role: 'user', content: 'I live in Lisbon.' }],
      currentInput: [],
    });
    await plugin.waitForIngest();
    plugin.onBeforePrepare({
      messages: [
        { id: 'L1', role: 'user', content: 'I live in Lisbon.' },
        { id: 'L2', role: 'user', content: 'Near the river.' },
      ],
      currentInput: [],
    });
    await plugin.waitForIngest();

    // Details preserved (original) — the merge failed
    const facts = await mem.findFacts(
      { predicate: 'lives_in' },
      {},
      { userId: USER },
    );
    expect(facts.items.length).toBe(1);
    expect(facts.items[0]!.details).toBe('Original details.');
  });

  it('skips ingest while one is already in flight', async () => {
    // Extraction takes a tick
    let resolveFirst: ((v: unknown) => void) | null = null;
    const slowFirst = new Promise<unknown>((res) => {
      resolveFirst = res;
    });
    const runDirect: RunDirect = (async () => {
      await slowFirst;
      return {
        output_text: JSON.stringify({ mentions: {}, facts: [] }),
        stop_reason: 'end',
      } as Awaited<ReturnType<RunDirect>>;
    }) as RunDirect;
    const fakeAgent = { runDirect, destroy: () => {} } as unknown as Agent;
    const spy = vi.spyOn(Agent, 'create').mockReturnValue(fakeAgent);
    restore = () => spy.mockRestore();

    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'cx',
      model: 'mx', minBatchMessages: 1,
    });

    plugin.onBeforePrepare({
      messages: [{ id: 'F1', role: 'user', content: 'first' }],
      currentInput: [],
    });
    // Second call fires WHILE the first is still pending — should be skipped
    plugin.onBeforePrepare({
      messages: [
        { id: 'F1', role: 'user', content: 'first' },
        { id: 'F2', role: 'user', content: 'second' },
      ],
      currentInput: [],
    });

    resolveFirst?.(undefined);
    await plugin.waitForIngest();

    // Only one extraction fired.
    // (The second onBeforePrepare bailed because ingestInFlight was set.)
    // Watermark reflects only the first slice's newest id.
    expect(plugin.getLastIngestedMessageId()).toBe('F1');
  });
});

describe('SessionIngestorPluginNextGen — id-based watermark (H-1)', () => {
  let restore: (() => void) | null = null;
  beforeEach(() => { restore?.(); restore = null; });

  it('keeps ingesting NEW messages after a simulated compaction shifts the array', async () => {
    const emptyExtraction = JSON.stringify({ mentions: {}, facts: [] });
    const stub = stubAgent([emptyExtraction, emptyExtraction, emptyExtraction]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem, agentId: AGENT, userId: USER, connectorName: 'c', model: 'm', minBatchMessages: 1,
    });

    // Turn 1: 5 messages.
    const turn1 = [
      { id: 'a', role: 'user', content: '1' },
      { id: 'b', role: 'assistant', content: '2' },
      { id: 'c', role: 'user', content: '3' },
      { id: 'd', role: 'assistant', content: '4' },
      { id: 'e', role: 'user', content: '5' },
    ];
    plugin.onBeforePrepare({ messages: turn1, currentInput: [] });
    await plugin.waitForIngest();
    expect(plugin.getLastIngestedMessageId()).toBe('e');

    // Turn 2: simulate compaction drops a,b; then new messages f,g appended.
    const turn2 = [
      { id: 'c', role: 'user', content: '3' },
      { id: 'd', role: 'assistant', content: '4' },
      { id: 'e', role: 'user', content: '5' },
      { id: 'f', role: 'user', content: '6' },
      { id: 'g', role: 'assistant', content: '7' },
    ];
    const callsBefore = stub.calls.length;
    plugin.onBeforePrepare({ messages: turn2, currentInput: [] });
    await plugin.waitForIngest();
    // Ingest fired again (slice after 'e' → [f, g]).
    expect(stub.calls.length).toBeGreaterThan(callsBefore);
    expect(plugin.getLastIngestedMessageId()).toBe('g');

    // Turn 3: watermark is 'g'; simulate HUGE compaction that drops
    // everything INCLUDING 'g'. Now 'g' is not in the array. Plugin
    // should fall back to "take all" — triggering another ingest even
    // though the current array feels "older" from an index perspective.
    const turn3 = [
      { id: 'h', role: 'user', content: 'fresh start' },
    ];
    const callsBefore3 = stub.calls.length;
    plugin.onBeforePrepare({ messages: turn3, currentInput: [] });
    await plugin.waitForIngest();
    expect(stub.calls.length).toBeGreaterThan(callsBefore3);
    expect(plugin.getLastIngestedMessageId()).toBe('h');
  });
});

describe('SessionIngestorPluginNextGen — H-2 ownership guards', () => {
  let restore: (() => void) | null = null;
  beforeEach(() => { restore?.(); restore = null; });

  it('disables plugin when bootstrap returns a foreign-owned agent entity', async () => {
    const stub = stubAgent([]);
    restore = stub.restore;
    const mem = makeMem();
    // Pre-seed an agent entity with the SAME identifier, owned by another user.
    await mem.upsertEntity(
      {
        type: 'agent',
        displayName: 'foreign agent',
        identifiers: [{ kind: 'system_agent_id', value: AGENT }],
        permissions: { group: 'read', world: 'read' },
      },
      { userId: 'other_user' },
    );
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem, agentId: AGENT, userId: USER, connectorName: 'c', model: 'm', minBatchMessages: 1,
    });
    plugin.onBeforePrepare({
      messages: [{ id: 'z1', role: 'user', content: 'hello' }],
      currentInput: [],
    });
    await plugin.waitForIngest();
    expect(plugin.isDisabled()).toBe(true);
    // No LLM calls — bootstrap failed BEFORE extract.
    expect(stub.calls.length).toBe(0);

    // Subsequent turns are no-ops.
    plugin.onBeforePrepare({
      messages: [{ id: 'z2', role: 'user', content: 'anyone there?' }],
      currentInput: [],
    });
    await plugin.waitForIngest();
    expect(stub.calls.length).toBe(0);
  });

  it('drops mentions whose upsert returns a foreign-owned entity — no ghost-write', async () => {
    // Seed a group-readable entity owned by another user, identified by email.
    const mem = makeMem();
    const foreign = await mem.upsertEntity(
      {
        type: 'person',
        displayName: 'Foreign Bob',
        identifiers: [{ kind: 'email', value: 'bob@foreign.com' }],
        permissions: { group: 'read', world: 'read' },
      },
      { userId: 'other_user' },
    );

    const extraction = JSON.stringify({
      mentions: {
        m1: {
          surface: 'Bob',
          type: 'person',
          identifiers: [{ kind: 'email', value: 'bob@foreign.com' }],
        },
      },
      facts: [
        {
          subject: 'm1',
          predicate: 'prefers',
          value: 'jazz',
          kind: 'atomic',
        },
      ],
    });
    const stub = stubAgent([extraction]);
    restore = stub.restore;

    const plugin = new SessionIngestorPluginNextGen({
      memory: mem, agentId: AGENT, userId: USER, connectorName: 'c', model: 'm', minBatchMessages: 1,
    });
    plugin.onBeforePrepare({
      messages: [{ id: 'y1', role: 'user', content: 'My friend Bob (bob@foreign.com) loves jazz.' }],
      currentInput: [],
    });
    await plugin.waitForIngest();

    // No fact should be written on the foreign entity — mention was dropped.
    const factsOnForeign = await mem.findFacts(
      { subjectId: foreign.entity.id, predicate: 'prefers' },
      {},
      { userId: 'other_user' },
    );
    expect(factsOnForeign.items.length).toBe(0);
  });
});

describe('SessionIngestorPluginNextGen — H-3 truncation-aware watermark', () => {
  let restore: (() => void) | null = null;
  beforeEach(() => { restore?.(); restore = null; });

  it('advances watermark only to the last message that fit in the transcript budget', async () => {
    const extraction = JSON.stringify({ mentions: {}, facts: [] });
    const stub = stubAgent([extraction, extraction]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem, agentId: AGENT, userId: USER, connectorName: 'c', model: 'm', minBatchMessages: 1,
      maxTranscriptChars: 120, // tiny budget
    });
    // 4 messages, each ~50 chars after role prefix → only first 2 fit.
    const bigText = 'x'.repeat(40);
    plugin.onBeforePrepare({
      messages: [
        { id: 'p1', role: 'user', content: bigText },
        { id: 'p2', role: 'user', content: bigText },
        { id: 'p3', role: 'user', content: bigText },
        { id: 'p4', role: 'user', content: bigText },
      ],
      currentInput: [],
    });
    await plugin.waitForIngest();
    // Watermark should NOT be p4 (would drop messages). Should be p1 or p2.
    const wm = plugin.getLastIngestedMessageId();
    expect(wm === 'p1' || wm === 'p2').toBe(true);
    expect(wm).not.toBe('p4');
  });
});

describe('SessionIngestorPluginNextGen — C2 silent-drop logging + C4 clamping', () => {
  let restore: (() => void) | null = null;
  beforeEach(() => { restore?.(); restore = null; });

  it('logs a warn when a fact references an unknown subject label (C2)', async () => {
    // Extraction references a mention label that isn't in the mentions map.
    const extraction = JSON.stringify({
      mentions: {}, // no mentions!
      facts: [{ subject: 'm_ghost', predicate: 'likes', value: 'x' }],
    });
    const stub = stubAgent([extraction]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm', minBatchMessages: 1,
    });

    // Spy on warn logs to confirm the drop is observable.
    const warnings: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const loggerModule = await import('@/infrastructure/observability/Logger.js');
    const warnSpy = vi
      .spyOn(loggerModule.logger, 'warn')
      .mockImplementation((obj: unknown, msg?: string) => {
        warnings.push({ obj: obj as Record<string, unknown>, msg: msg ?? '' });
      });

    plugin.onBeforePrepare({
      messages: [{ id: 'p1', role: 'user', content: 'something' }],
      currentInput: [],
    });
    await plugin.waitForIngest();

    const drop = warnings.find((w) => w.msg.includes('subject label'));
    expect(drop).toBeTruthy();
    expect((drop!.obj as { missingLabel: string }).missingLabel).toBe('m_ghost');
    expect((drop!.obj as { role: string }).role).toBe('subject');
    expect(Array.isArray((drop!.obj as { knownLabels: string[] }).knownLabels)).toBe(true);
    warnSpy.mockRestore();
  });

  it('clamps LLM-supplied out-of-range confidence / importance at ingest (C4)', async () => {
    const extraction = JSON.stringify({
      mentions: {
        m1: { surface: 'Alice', type: 'person', identifiers: [{ kind: 'email', value: 'a@x.com' }] },
      },
      facts: [
        {
          subject: 'm_user',
          predicate: 'likes',
          value: 'coffee',
          confidence: 5, // out of range
          importance: -0.5, // out of range
        },
      ],
    });
    const stub = stubAgent([extraction]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm', minBatchMessages: 1,
    });

    // Spy on memory.addFact to observe the exact values going through.
    const addFactSpy = vi.spyOn(mem, 'addFact');

    plugin.onBeforePrepare({
      messages: [{ id: 'p1', role: 'user', content: 'I like coffee' }],
      currentInput: [],
    });
    await plugin.waitForIngest();

    // Find the call that wrote the `likes` fact (not the user/agent bootstraps).
    const likesCall = addFactSpy.mock.calls.find((c) => {
      const input = c[0] as { predicate?: string };
      return input.predicate === 'likes';
    });
    expect(likesCall).toBeDefined();
    const input = likesCall![0] as { confidence?: number; importance?: number };
    expect(input.confidence).toBe(1);
    expect(input.importance).toBe(0);
  });
});

describe('buildSessionExtractionPrompt', () => {
  it('includes pre-resolved m_user / m_agent labels', () => {
    const out = buildSessionExtractionPrompt({
      transcript: 'user: hi',
      agentId: 'agent-x',
      userId: 'user-y',
      diligence: 'normal',
      referenceDate: new Date('2026-06-01'),
    });
    expect(out).toMatch(/m_user/);
    expect(out).toMatch(/m_agent/);
    expect(out).toMatch(/id=user-y/);
    expect(out).toMatch(/id=agent-x/);
  });

  it('renders diligence directives for each level', () => {
    const minimal = buildSessionExtractionPrompt({
      transcript: 'x',
      agentId: 'a',
      userId: 'u',
      diligence: 'minimal',
      referenceDate: new Date(),
    });
    expect(minimal).toMatch(/Diligence: MINIMAL/);
    expect(minimal).toMatch(/no inference/);

    const thorough = buildSessionExtractionPrompt({
      transcript: 'x',
      agentId: 'a',
      userId: 'u',
      diligence: 'thorough',
      referenceDate: new Date(),
    });
    expect(thorough).toMatch(/Diligence: THOROUGH/);
    expect(thorough).toMatch(/tentative inferences/);
  });

  it('includes validity period calibration', () => {
    const out = buildSessionExtractionPrompt({
      transcript: 'x',
      agentId: 'a',
      userId: 'u',
      diligence: 'normal',
      referenceDate: new Date(),
    });
    expect(out).toMatch(/Validity period/);
    expect(out).toMatch(/validUntil/);
  });

  it('documents the primary extraction targets (user facts + other entities)', () => {
    const out = buildSessionExtractionPrompt({
      transcript: 'x',
      agentId: 'a',
      userId: 'u',
      diligence: 'normal',
      referenceDate: new Date(),
    });
    expect(out).toMatch(/USER facts \(subject: `m_user`\)/);
    expect(out).toMatch(/OTHER entities/);
  });

  it('includes the anti-pattern shape rule (suppresses utterance-event predicates)', () => {
    const out = buildSessionExtractionPrompt({
      transcript: 'x',
      agentId: 'a',
      userId: 'u',
      diligence: 'normal',
      referenceDate: new Date(),
    });
    // Shape rule must be present, not just a blocklist.
    expect(out).toMatch(/Shape rule/);
    expect(out).toMatch(/utterance event/);
    // A few concrete illustrations that the LLM has seen in earlier runs.
    for (const p of [
      'mentioned_by',
      'was_mentioned_in_conversation',
      'asked_about',
      'discussed_in',
      'talked_about',
      'entity_type',
    ]) {
      expect(out).toContain(p);
    }
  });

  it('instructs the extractor not to re-extract agent tool-writes, with tool_call/tool_result shape', () => {
    const out = buildSessionExtractionPrompt({
      transcript: 'x',
      agentId: 'a',
      userId: 'u',
      diligence: 'normal',
      referenceDate: new Date(),
    });
    expect(out).toMatch(/DO NOT re-extract|do NOT re-extract/);
    expect(out).toMatch(/AMBIENT/);
    // Strengthened rule now references the actual transcript markers the
    // renderer emits, so the LLM can see and apply the rule.
    expect(out).toMatch(/\[tool_call memory_\*/);
    expect(out).toMatch(/tool_result ok/);
    expect(out).toMatch(/tool_result error/);
    // Concrete duplicate-prevention examples for memory_upsert_entity.
    expect(out).toMatch(/has_task/);
    expect(out).toMatch(/due_date|deadline/);
    // Error case: failed writes are extraction-eligible (ambient is the safety net).
    expect(out).toMatch(/error.*write FAILED|failed.*extraction-eligible|safety net/i);
  });

  it('explicitly forbids agent-subject facts under every diligence level', () => {
    // Agent-subject writes are owned by `memory_set_agent_rule` (user-driven,
    // narrow trigger). The ambient ingestor must never emit them — no matter
    // how thorough the pass. Prompt must state this unambiguously.
    for (const diligence of ['minimal', 'normal', 'thorough'] as const) {
      const out = buildSessionExtractionPrompt({
        transcript: 'x',
        agentId: 'a',
        userId: 'u',
        diligence,
        referenceDate: new Date(),
      });
      expect(out).toMatch(/DO NOT extract facts with subject `m_agent`/);
      // The prompt must NOT reintroduce the old "agent learnings" section.
      expect(out).not.toMatch(/AGENT learnings \(subject: `m_agent`\)/);
    }
  });
});

describe('renderMessage (transcript builder)', () => {
  it('renders plain string content verbatim', () => {
    expect(renderMessage({ role: 'user', content: 'hi there' })).toBe('user: hi there');
  });

  it('renders array-content text parts concatenated', () => {
    const m = {
      role: 'assistant',
      content: [{ text: 'Hello,' }, { text: 'world.' }],
    };
    expect(renderMessage(m)).toBe('assistant: Hello, world.');
  });

  it('renders tool_call with serialized args so the extractor can see captured facts', () => {
    const m = {
      role: 'assistant',
      content: [
        {
          type: 'tool_call',
          name: 'memory_upsert_entity',
          arguments: {
            type: 'task',
            displayName: 'Call the doctor',
            metadata: { state: 'pending', dueAt: '2026-04-30T09:00:00Z' },
          },
        },
      ],
    };
    const out = renderMessage(m);
    expect(out).toMatch(/\[tool_call memory_upsert_entity/);
    expect(out).toContain('"type":"task"');
    expect(out).toContain('"displayName":"Call the doctor"');
    expect(out).toContain('"dueAt":"2026-04-30T09:00:00Z"');
  });

  it('truncates oversized tool_call args to cap transcript cost', () => {
    const m = {
      role: 'assistant',
      content: [
        {
          type: 'tool_call',
          name: 'memory_remember',
          arguments: { subject: 'me', predicate: 'big', value: 'x'.repeat(2000) },
        },
      ],
    };
    const out = renderMessage(m);
    // Cap is 500; with room for closing quote + structure, payload must be trimmed.
    expect(out.length).toBeLessThan(650);
    expect(out).toMatch(/…/); // truncation ellipsis
  });

  it('renders tool_result with ok tag when call succeeded', () => {
    const m = {
      role: 'assistant',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't1',
          result: { fact: { id: 'abc', predicate: 'full_name' } },
        },
      ],
    };
    const out = renderMessage(m);
    expect(out).toMatch(/\[tool_result ok/);
    expect(out).toContain('full_name');
  });

  it('renders tool_result with error tag when the tool returned an error', () => {
    const m = {
      role: 'assistant',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't2',
          result: { error: 'No entity matching surface=Everworker.ai' },
        },
      ],
    };
    const out = renderMessage(m);
    expect(out).toMatch(/\[tool_result error/);
    expect(out).toContain('Everworker');
  });

  it('honors is_error / isError flags at the content level', () => {
    const m = {
      role: 'assistant',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't3',
          is_error: true,
          content: 'boom',
        },
      ],
    };
    expect(renderMessage(m)).toMatch(/\[tool_result error/);
  });

  it('tolerates a tool_call with no args', () => {
    const m = {
      role: 'assistant',
      content: [{ type: 'tool_call', name: 'memory_recall' }],
    };
    expect(renderMessage(m)).toBe('assistant: [tool_call memory_recall]');
  });
});

// ===========================================================================
// Batching + flush() — graceful-shutdown contract
// ===========================================================================

describe('SessionIngestorPluginNextGen — batching + flush', () => {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    restore?.();
    restore = null;
  });

  it('onBeforePrepare skips ingest when accumulated messages are below minBatchMessages', async () => {
    const stub = stubAgent([JSON.stringify({ mentions: {}, facts: [] })]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm',
      minBatchMessages: 4, // require 4; we'll feed 2
    });

    plugin.onBeforePrepare({
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        { id: 'm2', role: 'assistant', content: 'hello' },
      ],
      currentInput: [],
    });
    await plugin.waitForIngest();
    expect(stub.calls.length).toBe(0); // no LLM call because below threshold
  });

  it('onBeforePrepare fires once the batch reaches minBatchMessages', async () => {
    const stub = stubAgent([JSON.stringify({ mentions: {}, facts: [] })]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm',
      minBatchMessages: 2,
    });

    plugin.onBeforePrepare({
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        { id: 'm2', role: 'assistant', content: 'hello' },
      ],
      currentInput: [],
    });
    await plugin.waitForIngest();
    expect(stub.calls.length).toBe(1);
  });

  it('flush() forces an ingest regardless of threshold, on the last-seen snapshot', async () => {
    const stub = stubAgent([JSON.stringify({ mentions: {}, facts: [] })]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm',
      minBatchMessages: 100, // effectively unreachable
    });

    // onBeforePrepare stores snapshot but skips ingest (below threshold).
    plugin.onBeforePrepare({
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        { id: 'm2', role: 'assistant', content: 'hello' },
      ],
      currentInput: [],
    });
    await plugin.waitForIngest();
    expect(stub.calls.length).toBe(0);

    // flush() bypasses the threshold and runs on the stored snapshot.
    await plugin.flush();
    expect(stub.calls.length).toBe(1);
    expect(plugin.getLastIngestedMessageId()).toBe('m2');
  });

  it('flush() is a no-op before any prepare has fired (no stored snapshot)', async () => {
    const stub = stubAgent([]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm',
    });
    await plugin.flush();
    expect(stub.calls.length).toBe(0);
  });

  it('flush() accepts an explicit snapshot override', async () => {
    const stub = stubAgent([JSON.stringify({ mentions: {}, facts: [] })]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm',
      minBatchMessages: 100,
    });
    await plugin.flush({
      messages: [
        { id: 'x1', role: 'user', content: 'explicit' },
        { id: 'x2', role: 'assistant', content: 'ack' },
      ],
      currentInput: [],
    });
    expect(stub.calls.length).toBe(1);
    expect(plugin.getLastIngestedMessageId()).toBe('x2');
  });

  it('flush() is idempotent — a second call after the watermark advanced is a no-op', async () => {
    const stub = stubAgent([JSON.stringify({ mentions: {}, facts: [] })]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm',
      minBatchMessages: 1,
    });
    const snapshot = {
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        { id: 'm2', role: 'assistant', content: 'hello' },
      ],
      currentInput: [],
    };
    await plugin.flush(snapshot);
    expect(stub.calls.length).toBe(1);
    await plugin.flush(snapshot);
    expect(stub.calls.length).toBe(1); // watermark is at m2, nothing new to ingest
  });

  it('flush() on destroyed plugin does not run a new ingest', async () => {
    const stub = stubAgent([]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm',
      minBatchMessages: 1,
    });
    plugin.destroy();
    await plugin.flush({
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        { id: 'm2', role: 'assistant', content: 'hello' },
      ],
      currentInput: [],
    });
    expect(stub.calls.length).toBe(0);
  });

  it('exposes minBatchMessages via config; default is 6 when unset', async () => {
    // Confirm the library default by building a plugin with no minBatchMessages
    // and feeding 5 messages — the hook must skip.
    const stub = stubAgent([]);
    restore = stub.restore;
    const mem = makeMem();
    const plugin = new SessionIngestorPluginNextGen({
      memory: mem,
      agentId: AGENT,
      userId: USER,
      connectorName: 'c',
      model: 'm',
      // no minBatchMessages — take the default
    });
    plugin.onBeforePrepare({
      messages: [
        { id: 'a', role: 'user', content: '1' },
        { id: 'b', role: 'assistant', content: '2' },
        { id: 'c', role: 'user', content: '3' },
        { id: 'd', role: 'assistant', content: '4' },
        { id: 'e', role: 'user', content: '5' },
      ],
      currentInput: [],
    });
    await plugin.waitForIngest();
    expect(stub.calls.length).toBe(0); // 5 < default 6
  });
});

// ===========================================================================
// Prompt rule: don't extract task/event from imperative user requests
// ===========================================================================

describe('buildSessionExtractionPrompt — imperative-request rule', () => {
  it('instructs the extractor NOT to synthesize task/event entities from action requests', () => {
    const out = buildSessionExtractionPrompt({
      transcript: 'x',
      agentId: 'a',
      userId: 'u',
      diligence: 'normal',
      referenceDate: new Date(),
    });
    // New rule present and concrete.
    expect(out).toMatch(/imperative user requests|agent-action requests/i);
    expect(out).toMatch(/remind me to|schedule Y|track Z|add to my to-do/);
    expect(out).toMatch(/has_task|assigned_to|due_date|has_reminder|needs_to/);
    // Exception for fact-form statements is still allowed.
    expect(out).toMatch(/Exception.*fact.*extractable|calendar fact.*not asking the agent/i);
  });
});
