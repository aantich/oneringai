/**
 * User-specific agent behavior rules — list + render for the REPL.
 *
 * Mirrors (but does NOT share) the filter logic in
 * `MemoryPluginNextGen.renderRulesBlock` — deliberate narrow focus on the
 * `agent_behavior_rule` predicate that `memory_set_agent_rule` writes today.
 * The plugin's own render block is intentionally broader (any fact on the
 * agent entity, minus `profile` docs) so a future rule-inference engine
 * emitting arbitrary predicates surfaces automatically; memlab's `/rules`
 * command keeps the narrower shape because it's a test-harness UI, not the
 * agent's view of reality.
 */

import {
  AGENT_BEHAVIOR_RULE_PREDICATE,
  type IFact,
  type MemorySystem,
  type ScopeFilter,
} from '@everworker/oneringai';
import chalk from 'chalk';
import type { UI } from './ui.js';

/**
 * Fetch non-archived `agent_behavior_rule` facts owned by the current user.
 * Ordered newest-first. Safe to call at any point in the session.
 */
export async function listActiveRules(
  memory: MemorySystem,
  scope: ScopeFilter,
): Promise<IFact[]> {
  const page = await memory.findFacts(
    { predicate: AGENT_BEHAVIOR_RULE_PREDICATE, archived: false },
    { limit: 100, orderBy: { field: 'createdAt', direction: 'desc' } },
    scope,
  );
  // Strict owner filter — matches the render-block logic. The memory layer
  // enforces `ownerId` on every fact, but defence-in-depth against legacy
  // data or permissions loopholes is cheap here.
  if (!scope.userId) return page.items;
  return page.items.filter((f) => f.ownerId === scope.userId);
}

/**
 * Pretty-print a rules list. Pass `title` to differentiate session-start
 * banners ("Existing rules at session start") from on-demand `/rules` output
 * ("Active rules").
 */
export function renderRules(
  ui: UI,
  rules: IFact[],
  opts?: { title?: string },
): void {
  const title = opts?.title ?? 'Active rules';
  if (rules.length === 0) {
    ui.dim(`  [${title}: none]`);
    return;
  }
  ui.print(chalk.bold.cyan(`  [${title}: ${rules.length}]`));
  for (const f of rules) {
    const body = typeof f.details === 'string' ? f.details.trim() : '(empty)';
    ui.print(chalk.dim(`    • [${f.id}] ${body}`));
  }
  ui.dim(
    `    (supersede via memory_set_agent_rule(replaces=<id>) · drop via memory_forget(<id>))`,
  );
}
