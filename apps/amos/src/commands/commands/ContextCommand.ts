/**
 * ContextCommand - Detailed context inspection
 *
 * Phase 3: Exposes the library's rich context inspection APIs through AMOS.
 *
 * Subcommands:
 *   /context            - Show overview (budget + utilization)
 *   /context budget     - Detailed token budget
 *   /context breakdown  - Per-component token breakdown
 *   /context cache      - Cache statistics
 *   /context memory     - Memory entries
 *   /context history    - Alias for /history
 */

import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult } from '../../config/types.js';
import { describeLoopDiagnostics } from '../../agent/loopDiagnostics.js';

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format number with commas
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Create a progress bar
 */
function createProgressBar(percent: number, width: number = 10): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export class ContextCommand extends BaseCommand {
  readonly name = 'context';
  readonly aliases = ['ctx'];
  readonly description = 'Show context inspection details';
  readonly usage = '/context [budget|breakdown|cache|memory|history|evidence|strategy|policy|compact|task|loop]';

  get detailedHelp(): string {
    return `
/context - Context Inspection

USAGE:
  /context              Show context overview (utilization bar)
  /context budget       Detailed token budget
  /context breakdown    Per-component token breakdown
  /context evidence [id] [offset]  Metadata list or explicit bounded evidence preview
  /context task         Inspect host task state, including unconfirmed/pending actions
  /context loop         Inspect managed-loop phase, recovery and completion diagnostics
  /context task add <revision> <category> <id> <text...>
  /context task correct <revision> <old-id> <new-id> <text...>
  /context task resolve <revision> <id>
  /context task prune <revision> <id> [id...]
  /context task resolve-prune <revision> <id> [id...]
  /context task prune-action <revision> <execution-id> [execution-id...]
  /context task confirm-prune <revision> <execution-id> <terminal-status> <proof...>
                        Explicit host recovery; confirm only verified remote outcomes.
                        Validated host edits; /session save checkpoints them.
  /context strategy [algorithmic|observation-masking|structured-summary]
                        Inspect/select an opt-in automatic strategy. Summaries can bill a helper plus one repair per trigger.
  /context policy <auto|off> <native|off> [manual]
                        Select independent plugin/history controls. "manual" disables automatic reductions.
  /context compact [all|plugins|history]
                        Explicit reduction and checkpoint; native calls use the main model and can bill even without reduction.
  /context cache        Cache statistics
  /context memory       Memory entries
  /context history [n]  Show conversation history

EXAMPLES:
  /context
  /context budget
  /context breakdown
  /context history 20
`;
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { app, args } = context;
    const agent = app.getAgent();

    if (!agent?.isReady()) {
      return this.error('Agent not initialized. Start a conversation first.');
    }

    const { subcommand } = this.parseSubcommand(args);

    switch (subcommand) {
      case null:
      case 'overview':
        return this.showOverview(context);
      case 'budget':
        return this.showBudget(context);
      case 'breakdown':
        return this.showBreakdown(context);
      case 'cache':
        return this.showCache(context);
      case 'memory':
        return this.showMemory(context);
      case 'task': {
        const runner = app.getAgent()!;
        if (!runner.getTaskState) return this.error('Task-state inspection is unavailable in this runner.');
        try {
          const state = runner.getTaskState();
          if (!state) return this.error('Task state is disabled. Enable taskState in AMOS config and reload.');
          if (args.length === 1) return this.success(`Task ${JSON.stringify(state.taskId)}, revision ${state.revision}. Unconfirmed receipts do not prove remote completion.\n${JSON.stringify(state, null, 2)}`);
          if (!runner.updateTaskState) return this.error('Task-state editing is unavailable.');
          const revision = /^(0|[1-9][0-9]*)$/.test(args[2] ?? '') ? Number(args[2]) : NaN;
          if (!Number.isSafeInteger(revision)) return this.error('Provide the current non-negative integer task revision.');
          const source = { label: 'Explicit AMOS host command' };
          let delta: import('@everworker/oneringai').TaskStateHostDelta;
          if (args[1] === 'add' && args.length >= 6 && ['objective','constraint','decision','question','artifact'].includes(args[3]!)) {
            delta = { notes: [{ id: args[4]!, category: args[3] as import('@everworker/oneringai').TaskStateCategory, text: args.slice(5).join(' '), source }] };
          } else if (args[1] === 'correct' && args.length >= 6) {
            const prior = state.notes.find(n => n.id === args[3]);
            if (!prior) return this.error('Correction target not found; inspect /context task.');
            delta = { notes: [{ id: args[4]!, category: prior.category, text: args.slice(5).join(' '), supersedes: prior.id, source }] };
          } else if (args[1] === 'resolve' && args.length === 4) delta = { resolve: [args[3]!] };
          else if (args[1] === 'prune' && args.length >= 4) delta = { prune: { noteIds: args.slice(3) } };
          else if (args[1] === 'resolve-prune' && args.length >= 4) delta = { resolve: args.slice(3), prune: { noteIds: args.slice(3) } };
          else if (args[1] === 'prune-action' && args.length >= 4) delta = { prune: { executionIds: args.slice(3) } };
          else if (args[1] === 'confirm-prune' && args.length >= 6 && ['completed', 'failed', 'skipped', 'cancelled'].includes(args[4]!)) {
            delta = { confirmActions: [{ executionId: args[3]!, status: args[4] as import('@everworker/oneringai').TaskStatus, source: { label: args.slice(5).join(' ') } }], prune: { executionIds: [args[3]!] } };
          } else return this.error('Use /context task add, correct, resolve, prune, resolve-prune, prune-action or confirm-prune with the current revision. See /help context for arguments.');
          const updated = runner.updateTaskState(delta, revision);
          return this.success(`Task state updated to revision ${updated.revision} in memory. Use /session save to checkpoint it.`);
        } catch (error) {
          const code = (error as { code?: string })?.code;
          if (code === 'TASK_STATE_CAPACITY') return this.error('Task-state capacity reached. Inspect /context task; prune resolved/superseded notes with task prune, or explicitly resolve and remove notes atomically with task resolve-prune. Use task confirm-prune only after verifying a terminal remote outcome. Then /session save.');
          return this.error(code === 'TASK_STATE_CONFLICT' ? 'Task revision changed; inspect /context task and retry with the current revision.' : 'Task-state edit/inspection rejected. Check task configuration, current revision, record IDs, limits, and that no execution is running.');
        }
      }
      case 'loop': {
        if (args.length !== 1) return this.error('Use /context loop to inspect the latest managed execution.');
        const runner = app.getAgent()!;
        if (!runner.getLoopDiagnostics) return this.error('Loop inspection is unavailable in this runner.');
        const diagnostics = runner.getLoopDiagnostics();
        return this.success(diagnostics ? `${describeLoopDiagnostics(diagnostics)}\n${JSON.stringify(diagnostics, null, 2)}`
          : 'No managed-loop diagnostics. Enable a loopPolicy and run a task to inspect progress.');
      }
      case 'compact': {
        if (args.length > 2 || (args[1] && !['all', 'plugins', 'history'].includes(args[1]))) return this.error('Use /context compact [all|plugins|history].');
        const runner = app.getAgent()!;
        if (!runner.compactContext) return this.error('Compaction is unavailable.');
        try { return this.success(JSON.stringify(await runner.compactContext(args[1] as import('@everworker/oneringai').ContextCompactionTarget | undefined), null, 2)); }
        catch { return this.error('Compaction failed. Inspect current context, /helpers usage and session storage before retrying. A native call can be billed or context committed even if checkpointing fails. No tool action is replayed.'); }
      }
      case 'policy': {
        if (args.length < 3 || args.length > 4 || !['auto', 'off'].includes(args[1]!) || !['native', 'off'].includes(args[2]!)
          || (args[3] !== undefined && args[3] !== 'manual')) return this.error('Use /context policy <auto|off> <native|off> [manual].');
        const runner = app.getAgent()!;
        if (!runner.setContextCompaction) return this.error('Composition policy is unavailable.');
        const config = app.getConfig();
        const previous = { strategy: config.contextStrategy, policy: config.contextCompaction,
          hadStrategy: Object.hasOwn(config, 'contextStrategy'), hadPolicy: Object.hasOwn(config, 'contextCompaction') };
        try {
          const policy: import('@everworker/oneringai').ContextCompactionStrategyConfig = {
            plugins: args[1] as 'auto' | 'off', history: args[2] as 'native' | 'off', automatic: args[3] !== 'manual' };
          runner.setContextCompaction(policy); app.updateConfig({ contextStrategy: 'context-compaction', contextCompaction: policy });
          try { await app.saveConfig(); }
          catch {
            if (previous.strategy === 'context-compaction' && previous.policy) runner.setContextCompaction(previous.policy);
            else runner.setContextStrategy?.(previous.strategy ?? 'algorithmic');
            for (const current of new Set([config, app.getConfig()])) {
              if (previous.hadStrategy) current.contextStrategy = previous.strategy; else delete current.contextStrategy;
              if (previous.hadPolicy) current.contextCompaction = previous.policy; else delete current.contextCompaction;
            }
            return this.error('Unable to save policy; previous settings restored.');
          }
          return this.success(`Composition selected: plugins=${policy.plugins}, history=${policy.history}, automatic=${policy.automatic}. Inspect /context strategy and /preset inspect for support.`);
        } catch (error) { return this.error(error instanceof Error ? error.message : 'Policy selection failed.'); }
      }
      case 'strategy': {
        const runner = app.getAgent()!;
        const selected = args[1];
        if (args.length > 2 || (selected && !['algorithmic', 'observation-masking', 'structured-summary', 'context-compaction'].includes(selected))) return this.error('Use /context strategy [algorithmic|observation-masking|structured-summary|context-compaction].');
        try {
          if (selected) {
            if (!runner.setContextStrategy) return this.error('Strategy selection is unavailable.');
            const strategy = selected as NonNullable<import('../../config/types.js').AmosConfig['contextStrategy']>;
            const previousConfig = app.getConfig();
            const previous = previousConfig.contextStrategy;
            const hadStrategy = Object.hasOwn(previousConfig, 'contextStrategy');
            const previousRuntime = runner.getContextCompaction?.().strategy ?? previous ?? 'algorithmic';
            runner.setContextStrategy(strategy); app.updateConfig({ contextStrategy: strategy });
            try { await app.saveConfig(); } catch {
              let restored = true;
              try {
                if (!['algorithmic', 'observation-masking', 'structured-summary', 'context-compaction'].includes(previousRuntime)) throw new Error('Unsupported prior strategy');
                runner.setContextStrategy(previousRuntime as typeof strategy);
              } catch { restored = false; }
              try {
                app.updateConfig({ contextStrategy: previous });
                // Partial merges intentionally ignore undefined. Restore this one
                // optional field explicitly on the owner and pre-update shared view.
                for (const config of new Set([previousConfig, app.getConfig()])) {
                  if (hadStrategy) config.contextStrategy = previous;
                  else delete config.contextStrategy;
                }
              } catch { restored = false; }
              if (!restored) return this.error('Unable to save context strategy; previous selection could not be fully restored. Reload the agent before continuing.');
              return this.error('Unable to save context strategy; previous selection restored.');
            }
          }
          const diagnostic = runner.getContextCompaction?.();
          if (!diagnostic) return this.success('Context strategy inspection is unavailable.');
          const last = diagnostic.last;
          if (diagnostic.composition) return this.success(`Strategy: ${diagnostic.strategy}\n${JSON.stringify(diagnostic.composition, null, 2)}\nNative accounting is provider-counted; estimates remain local diagnostics. /context compact [all|plugins|history] performs explicit work; /helpers usage shows actual calls and unknown usage.`);
          return this.success(`Strategy: ${diagnostic.strategy}. Algorithmic is the default; alternatives are experimental and opt-in.\n`
            + (last ? `Last pre-call transaction (${last.strategy}): ${last.applied ? 'applied' : 'not applied'}; estimated savings ${last.tokensFreed} tokens; helper requested ${last.helperInvoked}; fallback ${last.fallback ?? 'none'}.\nSources: ${last.sourceReferences.map(r => r.id).join(', ') || 'none'}.\n` : 'No transactional compaction recorded in the last preparation.\n')
            + 'Structured summaries use the configured compactor budget with at most one repair. Inspect /helpers usage for actual calls, known cost and unknowns.');
        } catch (error) { return this.error(error instanceof Error ? error.message : 'Strategy change failed.'); }
      }
      case 'evidence':
        try {
          if (args.length > 3) return this.error('Use /context evidence [id] [offset].');
          const runner = app.getAgent()!;
          const offset = args[2] === undefined ? 0 : Number(args[2]);
          if (!Number.isSafeInteger(offset) || offset < 0) return this.error('Offset must be a non-negative integer.');
          return this.success(await runner.inspectEvidence?.(args[1], offset) ?? 'Evidence inspection is unavailable.');
        } catch { return this.error('Evidence inspection failed: data may be unavailable, corrupt, or storage may be busy.'); }
      case 'history':
        // Delegate to /history command
        return this.showHistory(context);
      default:
        return this.error(`Unknown subcommand: ${subcommand}\n\nUsage: ${this.usage}`);
    }
  }

  /**
   * Show context overview (budget + utilization)
   */
  private async showOverview(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const agent = app.getAgent()!;

    const budget = await agent.getContextBudget();
    const metrics = await agent.getContextMetrics();

    if (!budget) {
      return this.error('Unable to retrieve context budget.');
    }

    const statusIcon = budget.status === 'ok' ? '✅' : budget.status === 'warning' ? '⚠️' : '🔴';
    const statusText = budget.status === 'ok' ? 'OK' : budget.status === 'warning' ? 'Warning - approaching limit' : 'Critical - at limit';

    const modeIcon = metrics?.mode === 'planning' ? '📋' :
                     metrics?.mode === 'executing' ? '⚡' : '💬';

    const progressBar = createProgressBar(budget.utilizationPercent, 10);

    const lines = [
      'Context Overview',
      '────────────────────────────────────',
      `Utilization: ${progressBar} ${budget.utilizationPercent.toFixed(0)}% (${budget.status})`,
      `Tokens: ${formatNumber(budget.used)} / ${formatNumber(budget.available + budget.used)} available`,
      '',
      `Status: ${statusIcon}  ${statusText}`,
    ];

    if (metrics) {
      lines.push(`Mode: ${modeIcon} ${metrics.mode}${metrics.hasPlan ? ' (plan active)' : ''}`);
    }

    lines.push('');
    lines.push('Use /context budget for detailed budget');
    lines.push('Use /context breakdown for token breakdown');

    return this.success(lines.join('\n'));
  }

  /**
   * Show detailed context budget
   */
  private async showBudget(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const agent = app.getAgent()!;

    const budget = await agent.getContextBudget();

    if (!budget) {
      return this.error('Unable to retrieve context budget.');
    }

    const statusIcon = budget.status === 'ok' ? '✅' : budget.status === 'warning' ? '⚠️' : '🔴';
    const reservePercent = budget.total > 0 ? (budget.reserved / budget.total) * 100 : 0;

    const lines = [
      'Context Budget',
      '────────────────────────────────────',
      `Total:      ${formatNumber(budget.total).padStart(10)} tokens`,
      `Reserved:   ${formatNumber(budget.reserved).padStart(10)} tokens (${reservePercent.toFixed(0)}% for response)`,
      `Used:       ${formatNumber(budget.used).padStart(10)} tokens`,
      `Available:  ${formatNumber(budget.available).padStart(10)} tokens`,
      `Utilization: ${budget.utilizationPercent.toFixed(1).padStart(9)}%`,
      `Status:     ${statusIcon} ${budget.status.toUpperCase()}`,
    ];

    lines.push('');
    lines.push(budget.accounting === 'provider' ? 'Provider-counted complete input frame; this count is not billable usage.' : budget.source === 'prepared'
      ? `Last prepared revision: ${budget.revision} — estimated tokens, not provider usage.`
      : 'Estimate before first preparation — not provider usage.');
    return this.success(lines.join('\n'));
  }

  /**
   * Show per-component token breakdown
   */
  private async showBreakdown(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const agent = app.getAgent()!;

    const breakdown = await agent.getContextBreakdown();

    if (!breakdown) {
      return this.error('Unable to retrieve context breakdown.');
    }

    if (breakdown.components.length === 0) {
      return this.success('Token Breakdown by Component\n────────────────────────────────────\nNo components in context.');
    }

    const lines = [
      'Token Breakdown by Component',
      '────────────────────────────────────',
    ];

    lines.push(breakdown.source === 'prepared'
      ? `Last prepared revision: ${breakdown.revision} — estimated tokens, not provider usage.`
      : 'Estimate before first preparation — not provider usage.');
    if (breakdown.providerCountedInputTokens !== undefined) lines.push(`Provider-counted input: ${formatNumber(breakdown.providerCountedInputTokens)} tokens. Component figures below remain local estimates, including opaque state.`);
    lines.push('');

    for (const comp of breakdown.components) {
      const bar = createProgressBar(comp.percent, 20);
      const nameFormatted = comp.name.padEnd(20);
      const tokensFormatted = formatNumber(comp.tokens).padStart(7);
      const percentFormatted = `(${comp.percent.toFixed(1)}%)`.padStart(8);
      lines.push(`${nameFormatted} ${tokensFormatted}  ${percentFormatted}  ${bar}`);
    }

    lines.push('────────────────────────────────────');
    lines.push(`${'Total:'.padEnd(20)} ${formatNumber(breakdown.totalUsed).padStart(7)} tokens`);

    const selection = breakdown.selection;
    if (selection) {
      lines.push('', `Context selection: ${selection.layout}; ${selection.selectedDataTokens}/${selection.maxDataTokens} estimated data tokens.`);
      for (const entry of selection.entries) lines.push(`${JSON.stringify(entry.id)}: ${entry.status} (${entry.reason}), ~${entry.estimatedTokens} tokens`);
      if (!selection.entries.length) lines.push('No explicit data blocks; legacy plugin content is retained.');
      const usage = selection.accounting;
      if (usage.opaqueOrMultimodal) lines.push('Local input estimate includes opaque or multimodal data; inspect actual provider usage.');
      const count = (value: number | null) => value === null ? 'unknown' : formatNumber(value);
      lines.push(`Provider input: ${count(usage.providerInputTokens)}; estimate delta: ${count(usage.inputTokenDelta)}.`);
      lines.push(`Provider prompt cache: read ${count(usage.cachedInputTokens)}, written ${count(usage.cacheCreationInputTokens)} tokens. Distinct from local tool/memory caches.`);
    } else lines.push('', 'Context selection unavailable: legacy configuration or no selected preparation yet. Provider prompt cache usage is unknown here.');
    return this.success(lines.join('\n'));
  }

  /**
   * Show cache statistics
   */
  private async showCache(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const agent = app.getAgent()!;

    const cacheStats = await agent.getCacheStats();

    if (!cacheStats) {
      const lines = [
        'Cache Statistics',
        '────────────────────────────────────',
        'The OneRingAI Agent API does not expose tool-cache statistics.',
      ];
      return this.success(lines.join('\n'));
    }

    const hitRatePercent = cacheStats.hitRate;
    const effectiveness = hitRatePercent >= 50 ? 'high effectiveness' :
                          hitRatePercent >= 20 ? 'moderate effectiveness' : 'low effectiveness';

    const lines = [
      'Cache Statistics',
      '────────────────────────────────────',
      `Entries:   ${formatNumber(cacheStats.entries)}`,
      `Hits:      ${formatNumber(cacheStats.hits)}`,
      `Misses:    ${formatNumber(cacheStats.misses)}`,
      `Hit Rate:  ${hitRatePercent.toFixed(0)}% (${effectiveness})`,
    ];

    return this.success(lines.join('\n'));
  }

  /**
   * Show memory entries
   */
  private async showMemory(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const agent = app.getAgent()!;

    const entries = await agent.getMemoryEntries();
    const metrics = await agent.getContextMetrics();

    const totalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);

    const lines = [
      `Memory Entries (${entries.length} total, ${formatBytes(totalBytes)})`,
      '────────────────────────────────────',
    ];

    if (entries.length === 0) {
      lines.push('No memory entries stored.');
      lines.push('');
      lines.push('Memory is populated as the agent stores intermediate');
      lines.push('results during task execution.');
    } else {
      for (const entry of entries) {
        const keyFormatted = entry.key.length > 18 ? entry.key.slice(0, 15) + '...' : entry.key.padEnd(18);
        const descFormatted = entry.description.length > 25 ? entry.description.slice(0, 22) + '...' : entry.description;
        const sizeFormatted = `(${formatBytes(entry.sizeBytes)})`;
        lines.push(`• ${keyFormatted}  ${descFormatted.padEnd(25)}  ${sizeFormatted}`);
      }

      if (metrics) {
        lines.push('');
        lines.push(`Total: ${metrics.memoryStats.totalEntries} entries, ${formatBytes(metrics.memoryStats.totalSizeBytes)}`);
      }
    }

    return this.success(lines.join('\n'));
  }

  /**
   * Show conversation history (delegates to /history behavior)
   */
  private async showHistory(context: CommandContext): Promise<CommandResult> {
    const { app, args } = context;
    const agent = app.getAgent()!;

    // Parse count from args (skip 'history' subcommand)
    const countArg = args[1];
    const count = countArg ? parseInt(countArg, 10) : 10;
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      return this.error('History count must be an integer between 1 and 1000.');
    }

    const history = await agent.getConversationHistory(count);

    if (history.length === 0) {
      return this.success('No conversation history yet.\n\nStart a conversation to see history here.');
    }

    const lines: string[] = [
      `Last ${history.length} message${history.length !== 1 ? 's' : ''}:`,
      '',
    ];

    for (const entry of history) {
      const roleIcon = entry.role === 'user' ? '👤' :
                       entry.role === 'assistant' ? '🤖' : '⚙️';
      const roleLabel = entry.role.charAt(0).toUpperCase() + entry.role.slice(1);
      const time = entry.timestamp.toLocaleTimeString();

      // Truncate long content
      const maxLength = 200;
      const content = entry.content.length > maxLength
        ? entry.content.substring(0, maxLength) + '...'
        : entry.content;

      lines.push(`${roleIcon} [${time}] ${roleLabel}:`);
      lines.push(`   ${content.replace(/\n/g, '\n   ')}`);
      lines.push('');
    }

    lines.push('Use /context history [count] to show more or fewer messages');

    return this.success(lines.join('\n'));
  }
}
