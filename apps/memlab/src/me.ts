/**
 * `/me` command — shows exactly what `MemoryPluginNextGen` would inject about
 * the current user, so the operator can verify the self-learning loop is
 * actually binding facts to the user entity (not landing them as generic /
 * ownerless records).
 *
 * Calls `memory.getContext(userEntityId, {...})` — the same call the plugin
 * makes on every turn to render `## Your User Profile` — and formats the
 * result similarly, minus the markdown-injection escaping.
 *
 * Caller supplies `userEntityId` (typically from
 * `memoryPlugin.getBootstrappedIds().userEntityId`). If undefined, the
 * function prints a clear "bootstrap pending" message rather than guessing.
 */

import {
  type IFact,
  type MemorySystem,
  type ScopeFilter,
} from 'oneringai';
import chalk from 'chalk';
import type { UI } from './ui.js';

export async function renderMe(
  ui: UI,
  memory: MemorySystem,
  userEntityId: string | undefined,
  scope: ScopeFilter,
): Promise<void> {
  if (!userEntityId) {
    ui.dim(
      `  [user entity not bootstrapped yet — send at least one message first so MemoryPluginNextGen runs getContent()]`,
    );
    return;
  }

  const user = await memory.getEntity(userEntityId, scope);
  if (!user) {
    ui.dim(`  [user entity ${userEntityId} not found / not visible in current scope]`);
    return;
  }

  ui.print(chalk.bold.cyan(`  [user entity: ${user.displayName} (${user.id})]`));
  ui.dim(`    ownerId=${user.ownerId ?? '<none>'}  type=${user.type}`);

  // Pull the same view the plugin injects every turn: profile + top facts.
  const view = await memory.getContext(user.id, { topFactsLimit: 20, tiers: 'minimal' }, scope);

  if (view.profile?.details) {
    ui.print(chalk.bold(`    Profile (synthesized):`));
    for (const line of view.profile.details.split('\n')) {
      ui.print(chalk.dim(`      ${line}`));
    }
  } else {
    ui.dim(`    Profile: (not yet synthesized — regenerates after ≥10 atomic facts)`);
  }

  if (view.topFacts.length === 0) {
    ui.dim(`    Top facts: (none — ingestor hasn't written any user-subject facts yet)`);
    return;
  }
  ui.print(chalk.bold(`    Top facts (${view.topFacts.length}):`));
  for (const f of view.topFacts) {
    ui.print(chalk.dim(`      • ${renderFactLine(f)}`));
  }
}

function renderFactLine(f: IFact): string {
  const payload =
    f.details && f.details.length > 0
      ? f.details
      : f.objectId
        ? `→ ${f.objectId}`
        : f.value !== undefined
          ? JSON.stringify(f.value)
          : '';
  const conf = typeof f.confidence === 'number' ? ` (conf=${f.confidence.toFixed(2)})` : '';
  const origin =
    typeof f.sourceSignalId === 'string' && f.sourceSignalId.startsWith('session:')
      ? ' [ingestor]'
      : '';
  return `${f.predicate}: ${payload}${conf}${origin}`;
}
