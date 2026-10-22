import { isDeepStrictEqual } from 'node:util';
import { AIError, InvalidConfigError } from '../../../domain/errors/AIErrors.js';
import { ContentType } from '../../../domain/entities/Content.js';
import type { InputItem } from '../../../domain/entities/Message.js';
import type { TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';
import type { EvidencePluginNextGen } from '../plugins/EvidencePluginNextGen.js';
import type { ContextBudget, IContextPluginNextGen } from '../types.js';
import { nativeFingerprint } from './fingerprint.js';
import { removableMessageGroups, hasUnacknowledgedEvidence, sanitizeToolPairsWithOrigins } from '../tool-pairs.js';
import type { ContextCompactionReport, ContextCompactionStrategyConfig, ContextCompactionTarget,
  NativeCompactionDriver, NativeContinuationSnapshot } from './types.js';
import { withAbort } from '../../tool-execution/cancellation.js';

export interface CompositionFrame {
  input: InputItem[];
  prefix: InputItem[];
  budget: ContextBudget;
  request: TextGenerateOptions;
  providerInputTokens?: number;
  assertCurrent?(): void;
}

const fail = (message: string, details?: Record<string, unknown>): never => {
  const error = new AIError(message, 'CONTEXT_COMPACTION_INVALID', 409);
  Object.assign(error, { details }); throw error;
};

export const frameTokens = (frame: CompositionFrame): number => frame.providerInputTokens ?? frame.budget.totalUsed;
export const frameCapacity = (frame: CompositionFrame): number => frame.budget.maxTokens - frame.budget.responseReserve;

/** Native history cannot split a provider window, a user turn or a pending dependency. */
export function nativePrefixCutoff(history: readonly InputItem[], pending: readonly InputItem[], recentTurns: number,
  nativePrefixLength = 0): number {
  const turns = history.flatMap((item, index) => item.type === 'message' && item.role === 'user'
    && item.content.some(block => block.type === ContentType.INPUT_TEXT) ? [index] : []);
  let cutoff = recentTurns === 0 ? history.length : turns.length > recentTurns ? turns[turns.length - recentTurns]! : 0;
  const groups = removableMessageGroups(history, pending);
  const allowed = new Set(groups.flat());
  for (let index = 0; index < cutoff; index++) {
    const item = history[index]!;
    if (!allowed.has(index) || hasUnacknowledgedEvidence(item)
      || (item.type !== 'message' && item.type !== 'compaction' && item.type !== 'reasoning')
      || (item.type === 'message' && (item.role === 'developer' || item.content.some(block =>
        ![ContentType.INPUT_TEXT, ContentType.OUTPUT_TEXT, ContentType.TOOL_USE, ContentType.TOOL_RESULT, ContentType.THINKING].includes(block.type)
        || (block.type === ContentType.TOOL_RESULT && !!block.__images?.length))))) { cutoff = index; break; }
  }
  for (;;) {
    const crossing = groups.filter(group => group.some(index => index < cutoff) && group.some(index => index >= cutoff));
    if (!crossing.length) break;
    cutoff = Math.min(cutoff, ...crossing.flat());
  }
  return cutoff > 0 && cutoff < nativePrefixLength ? 0 : cutoff;
}

/** Stop before any historical action whose acknowledged settlement cannot be established. */
async function acknowledgedCutoff(history: readonly InputItem[], cutoff: number, evidence: EvidencePluginNextGen,
  check: () => void, signal?: AbortSignal): Promise<number> {
  const groups = removableMessageGroups(history, []);
  for (const group of groups.filter(indices => indices.every(index => index < cutoff)).sort((a, b) => Math.min(...a) - Math.min(...b))) {
    const records = new Map<string, import('../../../domain/interfaces/IEvidenceStorage.js').EvidenceRecord>();
    for (const index of group) {
      const item = history[index]!;
      if (item.type !== 'message') continue;
      for (const block of item.content) if (block.type === ContentType.TOOL_RESULT) {
        if (!block.evidence?.reference || block.evidence.status === 'storage_failed') return Math.min(...group);
        check();
        const record = await withAbort(evidence.storage.readRecord(block.evidence.reference), signal); check();
        if (!record || !Object.hasOwn(record, 'result') || record.source.completion !== 'settled'
          || record.source.callId !== block.tool_use_id || record.source.executionId !== block.evidence.executionId) return Math.min(...group);
        records.set(block.tool_use_id, record);
      }
    }
    for (const index of group) {
      const item = history[index]!;
      if (item.type !== 'message') continue;
      for (const block of item.content) if (block.type === ContentType.TOOL_USE) {
        const record = records.get(block.id);
        if (!record || record.source.toolName !== block.name) return Math.min(...group);
        try { if (!isDeepStrictEqual(JSON.parse(block.arguments), record.source.arguments)) return Math.min(...group); }
        catch { return Math.min(...group); }
      }
    }
  }
  return cutoff;
}

/** One bounded policy operation. Plugin mutation is best effort; native replacement is atomic. */
export async function composeContext(args: {
  config: Readonly<ContextCompactionStrategyConfig>;
  target: ContextCompactionTarget;
  trigger: 'manual' | 'pre-call';
  criticalThreshold: number;
  targetToFree: number;
  signal?: AbortSignal;
  plugins: readonly IContextPluginNextGen[];
  driver?: NativeCompactionDriver;
  evidence?: EvidencePluginNextGen;
  continuation?: NativeContinuationSnapshot;
  history: readonly InputItem[];
  pending: readonly InputItem[];
  initial: CompositionFrame;
  measure(): Promise<CompositionFrame>;
  capture(): () => void;
  compactPlugin(name: string, target: number): Promise<number>;
  apply(history: InputItem[], continuation: NativeContinuationSnapshot): void;
}): Promise<ContextCompactionReport> {
  const native = args.config.history !== 'off';
  const report: ContextCompactionReport = { status: 'skipped', trigger: args.trigger,
    inputTokensBefore: null, inputTokensAfter: null, accounting: native ? 'provider' : 'local', checkpointed: false,
    plugins: { status: 'skipped', reason: args.config.plugins === 'off' ? 'disabled' : 'not_selected', compacted: [] },
    history: { mode: native ? 'native' : 'off', status: 'skipped', reason: native ? 'not_selected' : 'disabled', sourceReferences: [] } };
  const check = (): void => { args.signal?.throwIfAborted(); args.driver?.assertCurrent(); };
  check();
  const automaticDisabled = args.trigger === 'pre-call' && args.config.automatic === false;
  if (native && (!args.driver || !args.evidence)) throw new InvalidConfigError('Native history requires an Agent native adapter and enabled built-in evidence');
  let frame = args.initial; frame.assertCurrent?.(); check();
  report.inputTokensBefore = frameTokens(frame); report.inputTokensAfter = frameTokens(frame);
  const underPressure = () => frameTokens(frame) / frameCapacity(frame) > args.criticalThreshold;
  try {
    if (args.config.plugins === 'auto' && args.target !== 'history') {
      report.plugins.reason = automaticDisabled ? 'disabled' : 'not_needed';
      if (!automaticDisabled && underPressure()) {
        const order: Record<string, number> = { in_context_memory: 0, working_memory: 1 };
        let remaining = args.targetToFree;
        for (const plugin of [...args.plugins].filter(plugin => plugin.isCompactable() && !['evidence', 'task_state'].includes(plugin.name))
          .sort((a, b) => (order[a.name] ?? 10) - (order[b.name] ?? 10))) {
          if (remaining <= 0) break;
          check();
          // Keep the operation lease until an old, uncooperative plugin settles.
          const freed = await args.compactPlugin(plugin.name, remaining); check();
          if (!Number.isSafeInteger(freed) || freed < 0) fail('Plugin reported invalid reclaimed token count');
          if (freed > 0) {
            report.plugins.compacted = [...report.plugins.compacted, plugin.name]; remaining -= freed;
            report.plugins.status = 'compacted'; report.status = 'compacted'; report.inputTokensAfter = null;
          }
        }
        report.plugins.status = report.plugins.compacted.length ? 'compacted' : 'skipped';
        report.plugins.reason = report.plugins.compacted.length ? undefined : 'no_reduction';
        frame = await args.measure(); check();
        report.inputTokensAfter = frameTokens(frame);
      }
    }
    if (native && args.target !== 'plugins') {
      const needed = args.trigger === 'manual' || underPressure();
      report.history.reason = automaticDisabled ? 'disabled' : 'not_needed';
      if (!automaticDisabled && needed) {
        const assertSnapshot = args.capture();
        const stable = () => { check(); assertSnapshot(); frame.assertCurrent?.(); };
        const history = structuredClone([...args.history]);
        const pending = structuredClone([...args.pending]);
        const turns = typeof args.config.history === 'object' ? args.config.history.preserveRecentTurns ?? 2 : 2;
        let cutoff = nativePrefixCutoff(history, pending, turns, args.continuation?.prefixLength);
        cutoff = await acknowledgedCutoff(history, cutoff, args.evidence!, stable, args.signal); stable();
        if (cutoff && cutoff < (args.continuation?.prefixLength ?? 0)) cutoff = 0;
        report.history.reason = history.length ? 'protected' : 'empty';
        if (cutoff) {
          if ((args.continuation?.sourceReferences.length ?? 0) >= 128) fail('Native source retention limit reached; restore a trusted full checkpoint before further compaction');
          const prefix = history.slice(0, cutoff), tail = history.slice(cutoff);
          if (args.driver!.binding.provider === 'anthropic' && tail.some(item => item.type === 'reasoning'
            || (item.type === 'message' && item.content.some(block => block.type === ContentType.THINKING)))) {
            fail('Retained Anthropic thinking is not portable across native system/tool revisions; preserveRecentTurns: 0 or a fresh compatible context is required');
          }
          const instructions = [frame.request.instructions, ...frame.input.flatMap(item => item.type === 'message' && item.role === 'developer'
            ? item.content.flatMap(block => block.type === ContentType.INPUT_TEXT || block.type === ContentType.OUTPUT_TEXT ? [block.text] : []) : [])].filter(Boolean).join('\n\n');
          const source = { ...frame.request, input: prefix, instructions, response_format: undefined, tool_choice: undefined };
          const sourceTokens = await args.driver!.countInput(source); stable();
          if (sourceTokens === null || sourceTokens > (args.driver!.maxSourceTokens ?? frameCapacity(frame))) fail('Native compaction source cannot fit the provider window');
          const reference = await args.evidence!._retainCompactionSource(structuredClone(prefix)); stable();
          const record = await withAbort(args.evidence!.storage.readRecord(reference), args.signal); stable();
          if (!record || !isDeepStrictEqual(record.result, { items: prefix })) fail('Native source archival was redacted, lost or changed; original history retained');
          report.history.sourceReferences = [reference];
          const compacted = await args.driver!.compact({ ...source,
            managedDispatch: { prepare: async () => {}, assertCurrent: stable } });
          report.history.invocationId = compacted.invocationId; report.history.provider = args.driver!.binding.provider;
          stable();
          const output = structuredClone(compacted.response.input);
          if (!output.length || output.filter(item => item.type === 'compaction').length !== 1
            || output.some(item => item.type === 'message' && item.role === 'developer')) fail('Invalid canonical native continuation');
          if (!isDeepStrictEqual(output, sanitizeToolPairsWithOrigins(output).map(entry => entry.item))) fail('Canonical native window contains incomplete tool dependencies');
          const candidate = [...output, ...tail];
          // Frame contributions are kept outside the history prefix and remain exact.
          const request = { ...frame.request, input: sanitizeToolPairsWithOrigins([...frame.prefix, ...candidate, ...pending]).map(entry => entry.item) };
          const after = await args.driver!.countInput(request); stable();
          if (after === null) throw new AIError('Native continuation token count is unavailable', 'CONTEXT_COMPACTION_INVALID');
          if (after < frameTokens(frame) && after <= frameCapacity(frame)) {
            const snapshot: NativeContinuationSnapshot = { version: 1, binding: { ...args.driver!.binding, scope: structuredClone(args.evidence!.storage.scope) },
              protocol: compacted.response.protocol, prefixLength: output.length, prefixHash: nativeFingerprint(output),
              sourceReferences: [...(args.continuation?.sourceReferences ?? []), reference],
              ...(compacted.response.state ? { state: structuredClone(compacted.response.state) } : {}) };
            stable(); args.apply(candidate, snapshot);
            report.history.status = 'compacted'; report.history.reason = undefined;
            report.inputTokensAfter = after;
          } else report.history.reason = 'no_reduction';
        }
      }
    }
    if (report.history.status !== 'compacted') report.inputTokensAfter = frameTokens(frame);
    report.status = report.plugins.status === 'compacted' || report.history.status === 'compacted' ? 'compacted' : 'skipped';
    return report;
  } catch (error) {
    if (error && typeof error === 'object') Object.assign(error, { compaction: structuredClone(report) });
    throw error;
  }
}
