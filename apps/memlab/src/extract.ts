/**
 * Extract mode — takes arbitrary pasted text (possibly a pasted email) and
 * runs it through SignalIngestor. Prints the resolved entities + facts so the
 * operator can inspect what the extractor produced against what the resolver
 * did with it.
 */

import {
  ConnectorExtractor,
  EmailSignalAdapter,
  PlainTextAdapter,
  SignalIngestor,
  type EmailSignal,
  type IFact,
  type IngestionResult,
  type MemorySystem,
  type ScopeFilter,
} from '@everworker/oneringai';
import chalk from 'chalk';
import type { UI } from './ui.js';
import type { VendorEntry } from './env.js';
import { renderTable } from './ui.js';

export interface ExtractConfig {
  ui: UI;
  primary: VendorEntry;
  memory: MemorySystem;
  userId: string;
}

export async function runExtract(cfg: ExtractConfig): Promise<void> {
  const { ui, primary, memory, userId } = cfg;
  const extractModel = process.env.MEMLAB_EXTRACT_MODEL?.trim() || primary.extractModel;

  const extractor = new ConnectorExtractor({
    connector: primary.connectorName,
    model: extractModel,
  });

  const ingestor = new SignalIngestor({
    memory,
    extractor,
    adapters: [new PlainTextAdapter(), new EmailSignalAdapter()],
  });

  ui.heading(`extract — ${primary.connectorName} / ${extractModel}`);
  ui.dim('Paste arbitrary text or a raw email. Empty input returns to main REPL.');

  try {
    for (;;) {
      const text = await ui.multiline('Paste content');
      if (!text.trim()) return;

      const parsedEmail = tryParseEmail(text);
      const sourceId = `memlab-${Date.now()}`;
      const scope: ScopeFilter = { userId };

      const before = await memory.listEntities({}, { limit: 1000 }, scope);
      const beforeIds = new Set(before.items.map((e) => e.id));

      let result: IngestionResult;
      try {
        if (parsedEmail) {
          ui.dim(`  routing via EmailSignalAdapter (from=${parsedEmail.from.email})`);
          result = await ingestor.ingest<EmailSignal>({
            kind: 'email',
            raw: parsedEmail,
            sourceSignalId: sourceId,
            scope,
          });
        } else {
          ui.dim('  routing via PlainTextAdapter');
          result = await ingestor.ingestText({
            text,
            sourceSignalId: sourceId,
            scope,
          });
        }
      } catch (err) {
        ui.error(err instanceof Error ? err.message : String(err));
        continue;
      }

      await renderResult(ui, result, beforeIds, memory, scope);
    }
  } finally {
    extractor.destroy();
  }
}

async function renderResult(
  ui: UI,
  result: IngestionResult,
  priorEntityIds: Set<string>,
  memory: MemorySystem,
  scope: ScopeFilter,
): Promise<void> {
  ui.heading(`entities (${result.entities.length})`);
  if (result.entities.length === 0) {
    ui.dim('  (none resolved)');
  } else {
    const rows = result.entities.map((e) => [
      e.label,
      priorEntityIds.has(e.entity.id) ? chalk.yellow('matched') : chalk.green('new'),
      e.entity.type,
      e.entity.displayName,
      e.entity.id,
      e.resolved ? '' : chalk.yellow(`${e.mergeCandidates.length} candidate(s)`),
    ]);
    ui.print(renderTable(['label', 'status', 'type', 'displayName', 'id', 'notes'], rows));
  }

  ui.heading(`facts (${result.facts.length})`);
  if (result.facts.length === 0) {
    ui.dim('  (none written)');
  } else {
    const rows = await Promise.all(
      result.facts.map(async (f) => [
        f.predicate,
        await labelFor(memory, f.subjectId, scope),
        await objectLabel(f, memory, scope),
        f.kind,
        fmtNum(f.confidence),
        fmtNum(f.importance),
      ]),
    );
    ui.print(renderTable(['predicate', 'subject', 'object/value', 'kind', 'conf', 'imp'], rows));
  }

  if (result.mergeCandidates.length) {
    ui.heading(`merge candidates (${result.mergeCandidates.length})`);
    for (const m of result.mergeCandidates) {
      ui.print(`  ${chalk.yellow(m.label)} surface="${m.surface}"`);
      for (const c of m.candidates.slice(0, 3)) {
        ui.print(chalk.dim(`    → ${c.entity.displayName} (${c.entity.id}) conf=${c.confidence.toFixed(2)} match=${c.matchedOn}`));
      }
    }
  }

  if (result.unresolved.length) {
    ui.heading(`unresolved (${result.unresolved.length})`);
    for (const u of result.unresolved) ui.print(chalk.red(`  [${u.where}] ${u.reason}`));
  }

  if (result.newPredicates.length) {
    ui.dim(`  (new predicates not in registry: ${result.newPredicates.join(', ')})`);
  }
}

async function labelFor(memory: MemorySystem, id: string, scope: ScopeFilter): Promise<string> {
  const e = await memory.getEntity(id, scope);
  if (!e) return `<${id}>`;
  return `${e.displayName} (${e.type})`;
}

async function objectLabel(f: IFact, memory: MemorySystem, scope: ScopeFilter): Promise<string> {
  if (f.objectId) return labelFor(memory, f.objectId, scope);
  if (f.kind === 'document') return truncate(f.details ?? '', 80);
  if (f.value !== undefined) {
    const s = typeof f.value === 'string' ? f.value : JSON.stringify(f.value);
    return truncate(s, 80);
  }
  return '';
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function fmtNum(n: number | undefined): string {
  return n === undefined ? '—' : n.toFixed(2);
}

// ============================================================================
// Light-weight email header detector + parser
// ============================================================================

/**
 * Detect an email-shaped input by looking for `From:` / `To:` / `Subject:`
 * headers followed by a blank line. Returns a normalized EmailSignal or null
 * if the input doesn't look like email.
 */
function tryParseEmail(text: string): EmailSignal | null {
  const lines = text.split(/\r?\n/);
  if (!/^\s*(from|to|cc|subject):/i.test(lines[0] ?? '')) return null;

  let bodyStart = -1;
  const headers: Record<string, string> = {};
  let lastKey = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') {
      bodyStart = i + 1;
      break;
    }
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m) {
      const key = m[1]!.toLowerCase();
      headers[key] = m[2]!;
      lastKey = key;
    } else if (lastKey) {
      headers[lastKey] += ' ' + line.trim();
    }
  }
  if (bodyStart < 0 || !headers.from) return null;

  const parseList = (raw: string | undefined): { email: string; name?: string }[] => {
    if (!raw) return [];
    return raw
      .split(/[,;]/)
      .map((s) => parseAddress(s.trim()))
      .filter((a): a is { email: string; name?: string } => a !== null);
  };

  const from = parseAddress(headers.from);
  if (!from) return null;

  return {
    from,
    to: parseList(headers.to),
    cc: parseList(headers.cc),
    subject: headers.subject,
    body: lines.slice(bodyStart).join('\n').trim(),
  };
}

function parseAddress(raw: string): { email: string; name?: string } | null {
  if (!raw) return null;
  const bracket = /^(.*?)<([^>]+)>$/.exec(raw);
  if (bracket) {
    const name = bracket[1]!.trim().replace(/^"|"$/g, '');
    const email = bracket[2]!.trim();
    if (!email.includes('@')) return null;
    return name ? { email, name } : { email };
  }
  const addr = raw.trim();
  if (!addr.includes('@')) return null;
  return { email: addr };
}
