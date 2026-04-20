/**
 * Chat mode — memory-enabled Agent. Streams responses and surfaces every
 * memory_* tool call so the operator can see what the agent is reading/writing.
 */

import {
  Agent,
  StreamEventType,
  type MemorySystem,
} from '@everworker/oneringai';
import chalk from 'chalk';
import type { UI } from './ui.js';
import type { VendorEntry } from './env.js';

export interface ChatConfig {
  ui: UI;
  primary: VendorEntry;
  memory: MemorySystem;
  userId: string;
  agentId: string;
}

const BACK_COMMANDS = new Set(['/back', '/exit', '/quit']);

/**
 * Run the chat REPL until the user types `/back`. Destroys the agent on exit.
 */
export async function runChat(cfg: ChatConfig): Promise<void> {
  const { ui, primary, memory, userId, agentId } = cfg;
  const chatModel = process.env.MEMLAB_CHAT_MODEL?.trim() || primary.chatModel;

  const agent = Agent.create({
    connector: primary.connectorName,
    model: chatModel,
    name: agentId,
    userId,
    context: {
      model: chatModel,
      features: {
        memory: true,
        memoryWrite: true,
        workingMemory: false,
        inContextMemory: false,
      },
      plugins: { memory: { memory, userId, agentId } },
    },
  });

  ui.heading(`chat — ${primary.connectorName} / ${chatModel}`);
  ui.dim(`userId=${userId} agentId=${agentId} — type /back to return to main REPL`);

  try {
    for (;;) {
      const input = (await ui.prompt(chalk.bold.blue('you> '))).trim();
      if (!input) continue;
      if (BACK_COMMANDS.has(input.toLowerCase())) return;

      try {
        await streamOnce(agent, input, ui);
      } catch (err) {
        ui.error(err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
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
        const name = event.tool_name;
        const args = safeStringify(event.arguments);
        ui.print(chalk.dim(`  ↪ tool ${name}(${truncate(args, 200)})`));
        break;
      }

      case StreamEventType.TOOL_EXECUTION_DONE: {
        const name = event.tool_name;
        if (event.error) {
          ui.print(chalk.red(`  ✖ ${name} — ${event.error}`));
        } else {
          const result = summarizeResult(event.result);
          ui.print(chalk.dim(`  ✓ ${name} → ${truncate(result, 200)}`));
        }
        break;
      }

      case StreamEventType.ERROR: {
        ui.print('');
        ui.error(event.error?.message ?? 'unknown stream error');
        break;
      }

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
