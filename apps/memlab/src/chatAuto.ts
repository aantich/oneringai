/**
 * /chat-auto — agent + background ingestor architecture.
 *
 * The agent has full memory tools (5 read + 6 write, including
 * `memory_set_agent_rule` for user-driven behavior directives) with
 * instructions that memory writes are for EXPLICIT user requests only
 * (create task, schedule event, "remember that X", corrections, "be terse").
 * Ambient observations are captured by a separate
 * `SessionIngestorPluginNextGen` on a cheaper extraction model — it never
 * writes agent-subject facts, so user-directive rules flow exclusively
 * through the agent's explicit `memory_set_agent_rule` call.
 *
 * Ingestion cadence: batched by `minBatchMessages` (library default 6). The
 * natural `onBeforePrepare` hook only fires when the batch is full, so simple
 * turns don't pay an LLM round trip. On `/back`, `/exit`, SIGINT, or SIGTERM,
 * memlab calls `sessionIngestor.flush()` to ingest any trailing batch before
 * destroying the agent. No extraction guarantee for SIGKILL / hard crashes.
 *
 * After every user→agent turn we:
 *   1. Snapshot the fact count (scope-filtered).
 *   2. Call `agent.context.prepare()` to fire `onBeforePrepare` hooks
 *      (kicks the ingestor).
 *   3. Await `sessionIngestor.waitForIngest()` to see results synchronously.
 *   4. Diff facts and render what was written (predicate, subject, object).
 */

import {
  Agent,
  SessionIngestorPluginNextGen,
  StreamEventType,
  type IFact,
  type MemorySystem,
  type ScopeFilter,
} from '@everworker/oneringai';
import chalk from 'chalk';
import type { UI } from './ui.js';
import type { VendorEntry } from './env.js';
import { listActiveRules, renderRules } from './rules.js';

export interface ChatAutoConfig {
  ui: UI;
  primary: VendorEntry;
  memory: MemorySystem;
  userId: string;
  agentId: string;
}

const BACK_COMMANDS = new Set(['/back', '/exit', '/quit']);

export async function runChatAuto(cfg: ChatAutoConfig): Promise<void> {
  const { ui, primary, memory, userId, agentId } = cfg;
  const chatModel = process.env.MEMLAB_CHAT_MODEL?.trim() || primary.chatModel;
  const extractModel = process.env.MEMLAB_EXTRACT_MODEL?.trim() || primary.extractModel;

  const agent = Agent.create({
    connector: primary.connectorName,
    model: chatModel,
    name: agentId,
    userId,
    context: {
      model: chatModel,
      // Memory reads + writes. Write tools are available for EXPLICIT user
      // requests ("remind me to X", "remember that Y", "correct: Z"); ambient
      // observations flow through the SessionIngestor below. See
      // `MemoryWritePluginNextGen` instructions for the decision rule.
      features: {
        memory: true,
        memoryWrite: true,
        workingMemory: false,
        inContextMemory: false,
      },
      plugins: { memory: { memory, userId, agentId } },
    },
  });

  // Register SessionIngestor manually — no feature flag for it. Uses the
  // extraction model (typically cheaper/faster than the chat model).
  const sessionIngestor = new SessionIngestorPluginNextGen({
    memory,
    agentId,
    userId,
    connectorName: primary.connectorName,
    model: extractModel,
    diligence: 'normal',
  });
  agent.context.registerPlugin(sessionIngestor);

  ui.heading(`chat-auto — agent (explicit-writes) + background ingestor`);
  ui.dim(`  chat model       : ${primary.connectorName} / ${chatModel}`);
  ui.dim(`  extraction model : ${primary.connectorName} / ${extractModel}`);
  ui.dim(`  userId=${userId} agentId=${agentId} — /back to return · /rules to list active rules`);
  ui.dim(`  ingestor batches every ≥6 messages; final flush runs on /back, /exit, or Ctrl-C.`);
  ui.dim(`  behavior rules   : say "be terse" / "reply in Russian" → agent calls memory_set_agent_rule`);
  ui.dim(`                     → shown as "## User-specific instructions for this agent" next turn.`);
  ui.print('');

  const scope: ScopeFilter = { userId };

  // Session-start banner: list any rules already in memory for this
  // (userId, agentId) pair so the operator knows what the agent will honor.
  try {
    const existing = await listActiveRules(memory, scope);
    if (existing.length > 0) {
      renderRules(ui, existing, { title: 'Existing rules at session start' });
      ui.print('');
    }
  } catch (err) {
    ui.dim(`  (could not list existing rules: ${err instanceof Error ? err.message : String(err)})`);
  }

  // Install graceful-shutdown hooks so an SIGINT/SIGTERM still flushes the
  // ingestor. On /back we run the same flush path explicitly below.
  let signalFired = false;
  const onSignal = async (sig: string): Promise<void> => {
    if (signalFired) return;
    signalFired = true;
    ui.print('');
    ui.dim(`  ${sig} received — flushing ingestor before exit…`);
    try {
      await flushAndRenderIfAny(ui, agent, sessionIngestor, memory, scope);
    } catch (err) {
      ui.error(`flush on ${sig} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    sessionIngestor.destroy();
    agent.destroy();
    process.exit(0);
  };
  const sigintHandler = (): void => { void onSignal('SIGINT'); };
  const sigtermHandler = (): void => { void onSignal('SIGTERM'); };
  process.once('SIGINT', sigintHandler);
  process.once('SIGTERM', sigtermHandler);

  try {
    for (;;) {
      const input = (await ui.prompt(chalk.bold.blue('you> '))).trim();
      if (!input) continue;
      if (BACK_COMMANDS.has(input.toLowerCase())) return;

      if (input.toLowerCase() === '/rules') {
        try {
          const rules = await listActiveRules(memory, scope);
          renderRules(ui, rules, { title: 'Active rules' });
        } catch (err) {
          ui.error(`/rules failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }

      const factsBefore = await countFacts(memory, scope);
      try {
        await streamOnce(agent, input, ui);
      } catch (err) {
        ui.error(err instanceof Error ? err.message : String(err));
        continue;
      }

      // Natural batching: `onBeforePrepare` on each turn fires ingest only
      // when at least `minBatchMessages` (default 6) have accumulated. Below
      // threshold, nothing runs. We await whatever IS in flight (may have
      // been kicked on this turn or a prior one) to surface results ASAP.
      const t0 = Date.now();
      await sessionIngestor.waitForIngest();
      const dt = Date.now() - t0;

      const newFacts = await diffFacts(memory, scope, factsBefore);
      renderTurnSummary(ui, newFacts, dt, memory, scope);
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('SIGTERM', sigtermHandler);
    // Final flush on /back — run synchronously before destroying so the
    // trailing batch (messages since the last threshold trigger) lands in
    // memory. This is the graceful-shutdown guarantee we promise in docs.
    try {
      await flushAndRenderIfAny(ui, agent, sessionIngestor, memory, scope);
    } catch (err) {
      ui.error(`final flush failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    sessionIngestor.destroy();
    agent.destroy();
  }
}

/**
 * Shared "force-ingest-then-summarise" path used by /back and signal
 * handlers. Refreshes the ingestor's stored snapshot via a prepare() pass
 * so the last in-flight turn's messages are included, then awaits flush.
 */
async function flushAndRenderIfAny(
  ui: UI,
  agent: Agent,
  sessionIngestor: SessionIngestorPluginNextGen,
  memory: MemorySystem,
  scope: ScopeFilter,
): Promise<void> {
  const factsBefore = await countFacts(memory, scope);
  try {
    // Refreshes `lastSnapshot` in the plugin so flush() sees current messages.
    await agent.context.prepare();
  } catch {
    // Ignore — prepare() may fail if the context is already in a degraded
    // state at shutdown; the plugin's previous stored snapshot will be used.
  }
  const t0 = Date.now();
  await sessionIngestor.flush();
  const dt = Date.now() - t0;
  const newFacts = await diffFacts(memory, scope, factsBefore);
  if (newFacts.length > 0) {
    ui.dim(`  [final flush — extracting deferred batch]`);
    renderTurnSummary(ui, newFacts, dt, memory, scope);
  }
}

async function diffFacts(
  memory: MemorySystem,
  scope: ScopeFilter,
  factsBefore: number,
): Promise<import('@everworker/oneringai').IFact[]> {
  const factsAfter = await memory.findFacts(
    {},
    { limit: 500, orderBy: { field: 'createdAt', direction: 'desc' } },
    scope,
  );
  return factsAfter.items.slice(0, Math.max(0, factsAfter.items.length - factsBefore));
}

async function streamOnce(agent: Agent, input: string, ui: UI): Promise<void> {
  ui.write(chalk.bold.green('agent> '));
  let wroteText = false;

  for await (const event of agent.stream(input)) {
    switch (event.type) {
      case StreamEventType.OUTPUT_TEXT_DELTA:
        ui.write(event.delta);
        wroteText = true;
        break;

      case StreamEventType.OUTPUT_TEXT_DONE:
        if (wroteText) ui.write('\n');
        wroteText = false;
        break;

      case StreamEventType.TOOL_EXECUTION_START: {
        const args = safeStringify(event.arguments);
        ui.print(chalk.dim(`  ↪ ${event.tool_name}(${truncate(args, 200)})`));
        break;
      }

      case StreamEventType.TOOL_EXECUTION_DONE: {
        if (event.error) {
          ui.print(chalk.red(`  ✖ ${event.tool_name} — ${event.error}`));
        } else {
          const result = summarizeResult(event.result);
          ui.print(chalk.dim(`  ✓ ${event.tool_name} → ${truncate(result, 200)}`));
        }
        break;
      }

      case StreamEventType.ERROR:
        ui.print('');
        ui.error(event.error?.message ?? 'unknown stream error');
        break;

      case StreamEventType.RESPONSE_COMPLETE: {
        const usage = event.usage;
        if (usage) {
          ui.dim(`  [${usage.input_tokens}+${usage.output_tokens}=${usage.total_tokens} tok, ${event.iterations} iter]`);
        }
        break;
      }
    }
  }
}

async function countFacts(memory: MemorySystem, scope: ScopeFilter): Promise<number> {
  const page = await memory.findFacts({}, { limit: 500 }, scope);
  return page.items.length;
}

/**
 * Render the post-turn fact diff, split by origin so the operator can tell
 * agent-driven writes (via memory_* tools) apart from ingestor-driven writes
 * (via the background extraction pipeline).
 *
 * Origin signal: the `SessionIngestorPluginNextGen` stamps every fact it
 * writes with `sourceSignalId: 'session:<agentId>:<userId>:<timestamp>'`.
 * Agent-driven writes don't set a `sourceSignalId`. We use that as the
 * discriminator — `session:` prefix → ingestor, everything else → agent.
 */
function renderTurnSummary(
  ui: UI,
  newFacts: IFact[],
  ingestElapsedMs: number,
  memory: MemorySystem,
  scope: ScopeFilter,
): void {
  const fromIngestor = newFacts.filter(isIngestorFact);
  const fromAgent = newFacts.filter((f) => !isIngestorFact(f));

  if (fromAgent.length > 0) {
    ui.print(chalk.bold.cyan(`  [agent writes: ${fromAgent.length} new fact${fromAgent.length > 1 ? 's' : ''}]`));
    void renderFactDetails(ui, fromAgent, memory, scope);
  }

  if (fromIngestor.length === 0 && fromAgent.length === 0) {
    ui.dim(chalk.italic(`  [ingestor: 0 new facts, ${ingestElapsedMs}ms]`));
    return;
  }
  if (fromIngestor.length > 0) {
    ui.print(chalk.bold.magenta(`  [ingestor: ${fromIngestor.length} new fact${fromIngestor.length > 1 ? 's' : ''}, ${ingestElapsedMs}ms]`));
    void renderFactDetails(ui, fromIngestor, memory, scope);
  } else {
    // Agent wrote something this turn but the ingestor didn't fire or
    // extracted nothing — still show the elapsed time so the "no ingest"
    // signal is visible.
    ui.dim(chalk.italic(`  [ingestor: 0 new facts, ${ingestElapsedMs}ms]`));
  }
}

function isIngestorFact(f: IFact): boolean {
  return typeof f.sourceSignalId === 'string' && f.sourceSignalId.startsWith('session:');
}

async function renderFactDetails(
  ui: UI,
  facts: IFact[],
  memory: MemorySystem,
  scope: ScopeFilter,
): Promise<void> {
  for (const f of facts) {
    const subj = await entityLabel(memory, f.subjectId, scope);
    let obj = '';
    if (f.objectId) obj = await entityLabel(memory, f.objectId, scope);
    else if (f.value !== undefined) obj = safeStringify(f.value);
    else if (f.details) obj = truncate(f.details, 60);
    ui.print(chalk.dim(`    • ${subj}  ${chalk.cyan(f.predicate)}  ${obj}`));
  }
}

async function entityLabel(memory: MemorySystem, id: string, scope: ScopeFilter): Promise<string> {
  const e = await memory.getEntity(id, scope);
  return e ? `${e.displayName}` : `<${id}>`;
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function summarizeResult(result: unknown): string {
  if (result === null || result === undefined) return 'null';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
