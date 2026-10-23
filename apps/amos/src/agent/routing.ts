import type { ModelExecutionConfig, ModelRoutingDiagnostics } from '@everworker/oneringai';
import type { AmosConfig } from '../config/types.js';

/** Rebuild bounded host rules from JSON. Never deserialize an executable callback. */
export function resolveAmosModelExecution(settings: AmosConfig): ModelExecutionConfig | undefined {
  if (!settings.modelExecution) return undefined;
  const { routing, ...base } = settings.modelExecution;
  if (!routing) return base;
  const rules = { ...settings.routingRules };
  if (Object.keys(rules).length > 64 || Object.entries(rules).some(([category, route]) => !category.length || category.length > 128
    || typeof route !== 'string' || route !== 'default' && !Object.hasOwn(routing.routes, route))) throw new Error('Invalid or excessive AMOS routing rules');
  return { ...base, routing: { ...routing,
    ...(settings.routingRules ? { select: ({ hints }) => hints.taskType && Object.hasOwn(rules, hints.taskType) ? rules[hints.taskType]! : 'default' } : {}),
  } };
}

/** Plain diagnostics, independent of model answer text or completion claims. */
export function describeRouting(value: ModelRoutingDiagnostics): string {
  const reason = value.reason ? `; ${value.reason}` : '';
  return `[Route: ${value.selectedRoute}; ${value.connector} / ${value.model}; ${value.source}${value.selectorFailure ? ` (${value.selectorFailure})` : ''}; selection ${value.selectionMs.toFixed(1)}ms${reason}]`;
}
