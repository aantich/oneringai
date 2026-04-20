/**
 * /chat-auto — the "retrieve-only agent + background ingestor" architecture.
 *
 * The main agent has READ-ONLY memory tools (`memory_recall`, `memory_graph`,
 * `memory_search`, `memory_list_facts`, `memory_find_entity`). A separate
 * `SessionIngestorPluginNextGen` runs after each turn on a cheaper extraction
 * model and writes facts derived from the conversation.
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
      // Read-only memory plugin. NO memoryWrite — the agent cannot mutate.
      features: {
        memory: true,
        memoryWrite: false,
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

  ui.heading(`chat-auto — read-only agent + background ingestor`);
  ui.dim(`  chat model       : ${primary.connectorName} / ${chatModel}`);
  ui.dim(`  extraction model : ${primary.connectorName} / ${extractModel}`);
  ui.dim(`  userId=${userId} agentId=${agentId} — /back to return`);
  ui.print('');

  const scope: ScopeFilter = { userId };

  try {
    for (;;) {
      const input = (await ui.prompt(chalk.bold.blue('you> '))).trim();
      if (!input) continue;
      if (BACK_COMMANDS.has(input.toLowerCase())) return;

      try {
        await streamOnce(agent, input, ui);
      } catch (err) {
        ui.error(err instanceof Error ? err.message : String(err));
        continue;
      }

      // Fire the ingestor on the completed turn. The production pattern has
      // this triggered automatically at the top of NEXT turn's prepare(),
      // which means the operator wouldn't see results until *after* their
      // next input. In this test bed we force it synchronously here.
      const factsBefore = await countFacts(memory, scope);
      const t0 = Date.now();
      try {
        await agent.context.prepare();
      } catch (err) {
        ui.dim(`  [ingestor prepare() error: ${err instanceof Error ? err.message : String(err)}]`);
      }
      await sessionIngestor.waitForIngest();
      const dt = Date.now() - t0;
      const factsAfter = await memory.findFacts(
        {},
        { limit: 500, orderBy: { field: 'createdAt', direction: 'desc' } },
        scope,
      );
      const newFacts = factsAfter.items.slice(0, factsAfter.items.length - factsBefore);
      renderIngestSummary(ui, newFacts, dt, memory, scope);
    }
  } finally {
    sessionIngestor.destroy();
    agent.destroy();
  }
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

function renderIngestSummary(
  ui: UI,
  newFacts: IFact[],
  elapsedMs: number,
  memory: MemorySystem,
  scope: ScopeFilter,
): void {
  if (!newFacts.length) {
    ui.dim(chalk.italic(`  [ingestor: 0 new facts, ${elapsedMs}ms]`));
    return;
  }
  ui.print(chalk.bold.magenta(`  [ingestor: ${newFacts.length} new fact${newFacts.length > 1 ? 's' : ''}, ${elapsedMs}ms]`));
  // Fire async detail rendering (don't block the next prompt).
  void renderFactDetails(ui, newFacts, memory, scope);
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
