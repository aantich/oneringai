/**
 * Main REPL. Routes to /chat, /extract, /browse and handles /status /who
 * /agent /reset /dump /load /help /exit.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import {
  InMemoryAdapter,
  createMemorySystemWithConnectors,
  type IEntity,
  type IFact,
  type MemorySystem,
  type ScopeFilter,
  type NewEntity,
  type NewFact,
} from '@everworker/oneringai';
import { detectAndRegister, type VendorEntry } from './env.js';
import { UI } from './ui.js';
import { runChat } from './chat.js';
import { runChatAuto } from './chatAuto.js';
import { runExtract } from './extract.js';
import { runBrowse } from './browse.js';

const HELP = `Commands:
  /chat                  Chat with agent — full read+write memory tools, no background ingestion
  /chat-auto             Chat with agent (explicit-writes only) + background SessionIngestor
  /extract               Paste text/email → run extractor → show extracted facts
  /browse                Query the memory store directly (entities, facts, search)
  /who [<userId>]        Show or set current userId
  /agent [<agentId>]     Show or set current agentId
  /status                Show connectors, ids, counts
  /reset                 Wipe in-memory store (entities + facts)
  /dump <file>           Export memory to JSON
  /load <file>           Import memory from JSON (replaces current store)
  /help                  Show this help
  /exit                  Quit
`;

interface MemDump {
  version: 1;
  userId: string;
  agentId: string;
  entities: IEntity[];
  facts: IFact[];
}

export class App {
  private ui = new UI();
  private userId: string;
  private agentId: string;
  private primary!: VendorEntry;
  private memory!: MemorySystem;
  private hasEmbedder = false;

  constructor() {
    this.userId = process.env.MEMLAB_USER_ID?.trim() || 'user-1';
    this.agentId = process.env.MEMLAB_AGENT_ID?.trim() || 'agent-1';
  }

  async run(): Promise<void> {
    try {
      await this.bootstrap();
      await this.repl();
    } finally {
      this.ui.close();
    }
  }

  // --------------------------------------------------------------------------
  // Setup
  // --------------------------------------------------------------------------

  private async bootstrap(): Promise<void> {
    const entries = detectAndRegister();
    if (!entries.length) {
      this.ui.error('No vendor API keys found in env. Set at least one (e.g. OPENAI_API_KEY) and retry.');
      this.ui.dim('See .env.example for the full list.');
      process.exit(1);
    }
    this.primary = entries[0]!;

    const embedVendor = entries.find((e) => e.embeddingModel && e.embeddingDims);
    this.hasEmbedder = !!embedVendor;

    const profileModel = process.env.MEMLAB_PROFILE_MODEL?.trim() || this.primary.profileModel;

    this.memory = createMemorySystemWithConnectors({
      store: new InMemoryAdapter(),
      connectors: {
        ...(embedVendor && embedVendor.embeddingModel && embedVendor.embeddingDims
          ? {
              embedding: {
                connector: embedVendor.connectorName,
                model: embedVendor.embeddingModel,
                dimensions: embedVendor.embeddingDims,
              },
            }
          : {}),
        profile: {
          connector: this.primary.connectorName,
          model: profileModel,
        },
      },
    });

    this.ui.print(chalk.bold.magenta('\n╔════════════════════════════════════════╗'));
    this.ui.print(chalk.bold.magenta('║           memlab v0.1.0                ║'));
    this.ui.print(chalk.bold.magenta('╚════════════════════════════════════════╝'));
    this.ui.print('');
    this.ui.info(`primary connector : ${this.primary.connectorName}`);
    this.ui.info(`chat / extract / profile models : ${this.primary.chatModel} / ${this.primary.extractModel} / ${profileModel}`);
    if (embedVendor) {
      this.ui.info(`embedding         : ${embedVendor.connectorName} / ${embedVendor.embeddingModel} (${embedVendor.embeddingDims}d)`);
    } else {
      this.ui.warn('embedding         : disabled (no OpenAI-family key — `search` in /browse will be unavailable)');
    }
    this.ui.info(`userId / agentId  : ${this.userId} / ${this.agentId}`);
    const logFile = process.env.LOG_FILE ?? '(console)';
    this.ui.info(`logs              : ${logFile}  (tail -f ${logFile})`);
    this.ui.print('');
    this.ui.dim('Type /help for commands.');
    this.ui.print('');
  }

  // --------------------------------------------------------------------------
  // REPL
  // --------------------------------------------------------------------------

  private async repl(): Promise<void> {
    for (;;) {
      const line = (await this.ui.prompt(chalk.bold.magenta('memlab> '))).trim();
      if (!line) continue;

      const firstSpace = line.indexOf(' ');
      const cmd = (firstSpace < 0 ? line : line.slice(0, firstSpace)).toLowerCase();
      const arg = firstSpace < 0 ? '' : line.slice(firstSpace + 1).trim();

      try {
        switch (cmd) {
          case '/chat':
            await runChat({
              ui: this.ui,
              primary: this.primary,
              memory: this.memory,
              userId: this.userId,
              agentId: this.agentId,
            });
            break;
          case '/chat-auto':
            await runChatAuto({
              ui: this.ui,
              primary: this.primary,
              memory: this.memory,
              userId: this.userId,
              agentId: this.agentId,
            });
            break;
          case '/extract':
            await runExtract({
              ui: this.ui,
              primary: this.primary,
              memory: this.memory,
              userId: this.userId,
            });
            break;
          case '/browse':
            await runBrowse({
              ui: this.ui,
              memory: this.memory,
              userId: this.userId,
              hasEmbedder: this.hasEmbedder,
            });
            break;
          case '/who':
            if (arg) this.userId = arg;
            this.ui.info(`userId=${this.userId}`);
            break;
          case '/agent':
            if (arg) this.agentId = arg;
            this.ui.info(`agentId=${this.agentId}`);
            break;
          case '/status':
            await this.cmdStatus();
            break;
          case '/reset':
            await this.cmdReset();
            break;
          case '/dump':
            await this.cmdDump(arg);
            break;
          case '/load':
            await this.cmdLoad(arg);
            break;
          case '/help':
            this.ui.print(HELP);
            break;
          case '/exit':
          case '/quit':
            return;
          default:
            this.ui.warn(`Unknown command '${cmd}' — type /help`);
        }
      } catch (err) {
        this.ui.error(err instanceof Error ? err.message : String(err));
      }
    }
  }

  // --------------------------------------------------------------------------
  // Commands
  // --------------------------------------------------------------------------

  private async cmdStatus(): Promise<void> {
    const scope: ScopeFilter = { userId: this.userId };
    const ents = await this.memory.listEntities({}, { limit: 10_000 }, scope);
    const facts = await this.memory.findFacts({}, { limit: 10_000 }, scope);
    this.ui.print(`primary connector : ${this.primary.connectorName}`);
    this.ui.print(`embedding         : ${this.hasEmbedder ? 'available' : 'disabled'}`);
    this.ui.print(`userId            : ${this.userId}`);
    this.ui.print(`agentId           : ${this.agentId}`);
    this.ui.print(`entities          : ${ents.items.length}`);
    this.ui.print(`facts             : ${facts.items.length}`);
  }

  private async cmdReset(): Promise<void> {
    const ok = await this.ui.confirm('Wipe all entities and facts in memory?');
    if (!ok) return;

    const scope: ScopeFilter = { userId: this.userId };
    const facts = await this.memory.findFacts({}, { limit: 100_000 }, scope);
    for (const f of facts.items) {
      await this.memory.archiveFact(f.id, scope);
    }
    const ents = await this.memory.listEntities({}, { limit: 100_000 }, scope);
    for (const e of ents.items) {
      await this.memory.archiveEntity(e.id, scope);
    }
    this.ui.success(`Archived ${facts.items.length} facts and ${ents.items.length} entities.`);
  }

  private async cmdDump(arg: string): Promise<void> {
    if (!arg) {
      this.ui.warn('usage: /dump <file>');
      return;
    }
    const file = path.resolve(arg);
    const scope: ScopeFilter = { userId: this.userId };
    const ents = await this.memory.listEntities({}, { limit: 100_000 }, scope);
    const facts = await this.memory.findFacts({}, { limit: 100_000 }, scope);
    const dump: MemDump = {
      version: 1,
      userId: this.userId,
      agentId: this.agentId,
      entities: ents.items,
      facts: facts.items,
    };
    fs.writeFileSync(file, JSON.stringify(dump, null, 2), 'utf8');
    this.ui.success(`Wrote ${ents.items.length} entities and ${facts.items.length} facts to ${file}`);
  }

  private async cmdLoad(arg: string): Promise<void> {
    if (!arg) {
      this.ui.warn('usage: /load <file>');
      return;
    }
    const file = path.resolve(arg);
    if (!fs.existsSync(file)) {
      this.ui.error(`file not found: ${file}`);
      return;
    }
    const dump = JSON.parse(fs.readFileSync(file, 'utf8')) as MemDump;
    if (dump.version !== 1) {
      this.ui.error(`unsupported dump version ${dump.version}`);
      return;
    }
    const ok = await this.ui.confirm(
      `Replace current store with ${dump.entities.length} entities + ${dump.facts.length} facts?`,
    );
    if (!ok) return;

    await this.cmdResetSilent();
    const scope: ScopeFilter = { userId: this.userId };

    // Preserve original ids by passing them through; the adapter will reuse
    // them because NewEntity/NewFact don't carry ids but we use lower-level
    // creation through upsert so the shape matches. For simplicity, we
    // recreate fresh (ids will be reissued).
    const idRemap = new Map<string, string>();
    for (const e of dump.entities) {
      const ne: NewEntity = {
        type: e.type,
        displayName: e.displayName,
        aliases: e.aliases,
        identifiers: e.identifiers,
        metadata: e.metadata,
        ownerId: this.userId,
      };
      const result = await this.memory.upsertEntity(ne, scope);
      idRemap.set(e.id, result.entity.id);
    }
    for (const f of dump.facts) {
      const subj = idRemap.get(f.subjectId);
      if (!subj) continue;
      const nf: NewFact = {
        subjectId: subj,
        predicate: f.predicate,
        kind: f.kind,
        objectId: f.objectId ? idRemap.get(f.objectId) : undefined,
        value: f.value,
        details: f.details,
        confidence: f.confidence,
        importance: f.importance,
        sourceSignalId: f.sourceSignalId,
        ownerId: this.userId,
      };
      try {
        await this.memory.addFact(nf, scope);
      } catch (err) {
        this.ui.warn(`skip fact: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.ui.success(`Loaded dump from ${file}`);
  }

  private async cmdResetSilent(): Promise<void> {
    const scope: ScopeFilter = { userId: this.userId };
    const facts = await this.memory.findFacts({}, { limit: 100_000 }, scope);
    for (const f of facts.items) await this.memory.archiveFact(f.id, scope);
    const ents = await this.memory.listEntities({}, { limit: 100_000 }, scope);
    for (const e of ents.items) await this.memory.archiveEntity(e.id, scope);
  }
}
