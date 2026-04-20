/**
 * Browse mode — direct read-only queries against MemorySystem. No agent,
 * no LLM calls (except `search` which uses the embedder if available).
 */

import chalk from 'chalk';
import type { IFact, IEntity, MemorySystem, ScopeFilter } from '@everworker/oneringai';
import type { UI } from './ui.js';
import { parseArgs, renderTable } from './ui.js';

export interface BrowseConfig {
  ui: UI;
  memory: MemorySystem;
  userId: string;
  /** True if an embedder was wired into the MemorySystem. Controls whether `search` is offered. */
  hasEmbedder: boolean;
}

const HELP = `Commands:
  entities [type=<type>] [limit=<N>]       List entities (optionally filtered by type)
  entity <id>                              Show entity detail + profile + related facts
  facts [subject=<id>] [object=<id>]       List facts
        [predicate=<p>] [kind=atomic|document]
        [minConfidence=<0..1>] [minImportance=<0..1>]
        [text=<substring>] [limit=<N>]
  search <query> [topK=<N>]                Semantic search (requires embedder)
  tasks [limit=<N>]                        Open tasks via listOpenTasks
  topics [days=<N>] [limit=<N>]            Recent topics via listRecentTopics
  stats                                    Counts of entities and facts
  help                                     Show this help
  /back                                    Return to main REPL
`;

export async function runBrowse(cfg: BrowseConfig): Promise<void> {
  const { ui, memory, userId, hasEmbedder } = cfg;
  const scope: ScopeFilter = { userId };

  ui.heading(`browse — direct queries over MemorySystem`);
  ui.dim(`userId=${userId} — type 'help' for commands, '/back' to return`);

  for (;;) {
    const input = (await ui.prompt(chalk.bold.yellow('browse> '))).trim();
    if (!input) continue;
    if (input === '/back' || input === '/exit' || input === '/quit') return;

    const firstSpace = input.indexOf(' ');
    const cmd = (firstSpace < 0 ? input : input.slice(0, firstSpace)).toLowerCase();
    const tail = firstSpace < 0 ? '' : input.slice(firstSpace + 1).trim();

    try {
      switch (cmd) {
        case 'help':
          ui.print(HELP);
          break;
        case 'entities':
          await cmdEntities(ui, memory, scope, tail);
          break;
        case 'entity':
          await cmdEntity(ui, memory, scope, tail);
          break;
        case 'facts':
          await cmdFacts(ui, memory, scope, tail);
          break;
        case 'search':
          if (!hasEmbedder) {
            ui.warn('semantic search unavailable — no embedder was configured (need OPENAI_API_KEY).');
          } else {
            await cmdSearch(ui, memory, scope, tail);
          }
          break;
        case 'tasks':
          await cmdTasks(ui, memory, scope, tail);
          break;
        case 'topics':
          await cmdTopics(ui, memory, scope, tail);
          break;
        case 'stats':
          await cmdStats(ui, memory, scope);
          break;
        default:
          ui.warn(`unknown command '${cmd}' — type 'help'`);
      }
    } catch (err) {
      ui.error(err instanceof Error ? err.message : String(err));
    }
  }
}

// ============================================================================
// Command handlers
// ============================================================================

async function cmdEntities(
  ui: UI,
  memory: MemorySystem,
  scope: ScopeFilter,
  tail: string,
): Promise<void> {
  const { flags } = parseArgs(tail);
  const limit = clamp(toInt(flags.limit) ?? 100, 1, 500);
  const page = await memory.listEntities(
    flags.type ? { type: flags.type } : {},
    { limit },
    scope,
  );
  if (!page.items.length) {
    ui.dim('  (no entities)');
    return;
  }
  const rows = page.items.map((e) => [
    e.type,
    e.displayName,
    e.id,
    `${e.identifiers.length} id(s)`,
    e.updatedAt.toISOString().slice(0, 19),
  ]);
  ui.print(renderTable(['type', 'displayName', 'id', 'ids', 'updatedAt'], rows));
  ui.dim(`  ${page.items.length} shown${page.nextCursor ? ' (more available)' : ''}`);
}

async function cmdEntity(
  ui: UI,
  memory: MemorySystem,
  scope: ScopeFilter,
  tail: string,
): Promise<void> {
  const id = tail.split(/\s+/)[0];
  if (!id) {
    ui.warn('usage: entity <id>');
    return;
  }
  const entity = await memory.getEntity(id, scope);
  if (!entity) {
    ui.warn(`no entity ${id}`);
    return;
  }

  ui.heading(`${entity.displayName}  (${entity.type})`);
  ui.print(`  id:         ${entity.id}`);
  ui.print(`  aliases:    ${(entity.aliases ?? []).join(', ') || '—'}`);
  ui.print(`  identifiers:`);
  for (const ident of entity.identifiers) {
    ui.print(`    ${ident.kind}=${ident.value}`);
  }
  if (entity.metadata && Object.keys(entity.metadata).length) {
    ui.print(`  metadata:`);
    for (const [k, v] of Object.entries(entity.metadata)) {
      ui.print(`    ${k}: ${safeStr(v)}`);
    }
  }
  ui.print(`  createdAt:  ${entity.createdAt.toISOString()}`);
  ui.print(`  updatedAt:  ${entity.updatedAt.toISOString()}`);
  ui.print(`  version:    ${entity.version}`);

  const profile = await memory.getProfile(entity.id, scope);
  if (profile && profile.details) {
    ui.heading('profile');
    ui.print(profile.details);
  }

  const factsPage = await memory.findFacts(
    { touchesEntity: entity.id },
    { limit: 50, orderBy: { field: 'createdAt', direction: 'desc' } },
    scope,
  );
  ui.heading(`facts mentioning this entity (${factsPage.items.length})`);
  if (factsPage.items.length === 0) {
    ui.dim('  (none)');
  } else {
    const rows = await Promise.all(factsPage.items.map(async (f) => await formatFactRow(f, memory, scope)));
    ui.print(renderTable(['predicate', 'subject', 'object/value', 'kind', 'conf', 'imp'], rows));
  }
}

async function cmdFacts(
  ui: UI,
  memory: MemorySystem,
  scope: ScopeFilter,
  tail: string,
): Promise<void> {
  const { flags } = parseArgs(tail);
  const limit = clamp(toInt(flags.limit) ?? 50, 1, 500);

  const filter: Record<string, unknown> = {};
  if (flags.subject) filter.subjectId = flags.subject;
  if (flags.object) filter.objectId = flags.object;
  if (flags.predicate) filter.predicate = flags.predicate;
  if (flags.kind) filter.kind = flags.kind;
  const minConf = toNum(flags.minConfidence);
  if (minConf !== undefined) filter.minConfidence = minConf;

  const page = await memory.findFacts(
    filter as never,
    { limit, orderBy: { field: 'createdAt', direction: 'desc' } },
    scope,
  );

  const textFilter = flags.text?.toLowerCase();
  const minImp = toNum(flags.minImportance);
  const filtered = page.items.filter((f) => {
    if (minImp !== undefined && (f.importance ?? 0.5) < minImp) return false;
    if (textFilter) {
      const hay = [
        f.predicate,
        f.details ?? '',
        f.value !== undefined ? safeStr(f.value) : '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(textFilter)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    ui.dim('  (no facts)');
    return;
  }

  const rows = await Promise.all(filtered.map(async (f) => await formatFactRow(f, memory, scope)));
  ui.print(renderTable(['predicate', 'subject', 'object/value', 'kind', 'conf', 'imp'], rows));
  ui.dim(`  ${filtered.length} shown${page.nextCursor ? ' (more available)' : ''}`);
}

async function cmdSearch(
  ui: UI,
  memory: MemorySystem,
  scope: ScopeFilter,
  tail: string,
): Promise<void> {
  const { positional, flags } = parseArgs(tail);
  const query = positional.join(' ').trim();
  if (!query) {
    ui.warn('usage: search <query>');
    return;
  }
  const topK = clamp(toInt(flags.topK) ?? 10, 1, 50);
  const results = await memory.semanticSearch(query, {}, scope, topK);
  if (!results.length) {
    ui.dim('  (no results)');
    return;
  }
  const rows = await Promise.all(
    results.map(async ({ fact, score }) => {
      const [pred, subj, obj, kind, conf, imp] = await formatFactRow(fact, memory, scope);
      return [score.toFixed(3), pred, subj, obj, kind, conf, imp];
    }),
  );
  ui.print(renderTable(['score', 'predicate', 'subject', 'object/value', 'kind', 'conf', 'imp'], rows));
}

async function cmdTasks(
  ui: UI,
  memory: MemorySystem,
  scope: ScopeFilter,
  tail: string,
): Promise<void> {
  const { flags } = parseArgs(tail);
  const limit = clamp(toInt(flags.limit) ?? 50, 1, 200);
  const tasks = await memory.listOpenTasks(scope, { limit });
  if (!tasks.length) {
    ui.dim('  (no open tasks)');
    return;
  }
  const rows = tasks.map((t) => {
    const md = t.metadata ?? {};
    return [
      t.displayName,
      safeStr(md.state),
      safeStr(md.dueAt),
      safeStr(md.priority),
      safeStr(md.assigneeId),
      t.id,
    ];
  });
  ui.print(renderTable(['displayName', 'state', 'dueAt', 'priority', 'assignee', 'id'], rows));
}

async function cmdTopics(
  ui: UI,
  memory: MemorySystem,
  scope: ScopeFilter,
  tail: string,
): Promise<void> {
  const { flags } = parseArgs(tail);
  const days = clamp(toInt(flags.days) ?? 30, 1, 365);
  const limit = clamp(toInt(flags.limit) ?? 50, 1, 200);
  const topics = await memory.listRecentTopics(scope, { days, limit });
  if (!topics.length) {
    ui.dim('  (no recent topics)');
    return;
  }
  const rows = topics.map((t) => [t.displayName, t.id, t.updatedAt.toISOString().slice(0, 19)]);
  ui.print(renderTable(['displayName', 'id', 'updatedAt'], rows));
}

async function cmdStats(ui: UI, memory: MemorySystem, scope: ScopeFilter): Promise<void> {
  const ents = await memory.listEntities({}, { limit: 10_000 }, scope);
  const facts = await memory.findFacts({}, { limit: 10_000 }, scope);
  const byType: Record<string, number> = {};
  for (const e of ents.items) byType[e.type] = (byType[e.type] ?? 0) + 1;
  const byPred: Record<string, number> = {};
  for (const f of facts.items) byPred[f.predicate] = (byPred[f.predicate] ?? 0) + 1;

  ui.print(`entities: ${ents.items.length}`);
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    ui.print(`  ${t.padEnd(20)} ${n}`);
  }
  ui.print(`facts: ${facts.items.length}`);
  const topPreds = Object.entries(byPred).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [p, n] of topPreds) {
    ui.print(`  ${p.padEnd(20)} ${n}`);
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function formatFactRow(
  f: IFact,
  memory: MemorySystem,
  scope: ScopeFilter,
): Promise<string[]> {
  const subj = await labelFor(memory, f.subjectId, scope);
  let obj = '';
  if (f.objectId) obj = await labelFor(memory, f.objectId, scope);
  else if (f.kind === 'document') obj = truncate(f.details ?? '', 60);
  else if (f.value !== undefined) obj = truncate(safeStr(f.value), 60);
  return [
    f.predicate,
    subj,
    obj,
    f.kind,
    f.confidence === undefined ? '—' : f.confidence.toFixed(2),
    f.importance === undefined ? '—' : f.importance.toFixed(2),
  ];
}

const entityCache = new Map<string, IEntity | null>();
async function labelFor(memory: MemorySystem, id: string, scope: ScopeFilter): Promise<string> {
  if (!entityCache.has(id)) entityCache.set(id, await memory.getEntity(id, scope));
  const e = entityCache.get(id);
  return e ? `${e.displayName} (${e.type})` : `<${id}>`;
}

function safeStr(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function toInt(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

function toNum(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
