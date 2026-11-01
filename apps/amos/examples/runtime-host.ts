/** Ready-to-run trusted AMOS host. Offline by default; real providers require both live flags. */
import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Connector, Vendor } from 'oneringai';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage, OneRingAIDriver } from 'oneringai/agent-runtime';
import type { AgentDriver, RuntimeSessionOptions, RuntimeSessionReference } from 'oneringai/agent-runtime';
import { CodexSdkDriver } from 'oneringai/agent-runtime/codex';
import { ClaudeAgentSdkDriver } from 'oneringai/agent-runtime/claude';
import { OpenAIManagedDriver } from 'oneringai/agent-runtime/openai-managed';
import { ClaudeManagedDriver } from 'oneringai/agent-runtime/claude-managed';
import type { AmosRuntimeHost } from '../src/runtime/AmosRuntimeController.js';

const drivers = ['oneringai.agent', 'openai.codex.sdk', 'anthropic.agent.sdk', 'openai.agents.api', 'anthropic.managed.api'] as const;
export type ExampleDriver = typeof drivers[number];

/** Testable host construction; the controller only receives the established public runtime APIs. */
export async function createExampleRuntimeHost(dataDir: string, driver: ExampleDriver, live = false) {
  const root = path.resolve(dataDir, 'agent-runtime');
  const transferRoot = path.join(root, 'transfers'); const workspace = path.join(root, 'workspace');
  await mkdir(root, { recursive: true, mode: 0o700 }); await mkdir(transferRoot, { recursive: true, mode: 0o700 }); await mkdir(workspace, { recursive: true, mode: 0o700 });
  const referenceFile = path.join(root, 'reference.json');
  let resume: RuntimeSessionReference | undefined;
  try {
    const file = await open(referenceFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.stat()).isFile() || (await file.stat()).size > 1024) throw new Error('Invalid runtime reference file');
      const value = JSON.parse(await file.readFile('utf8')) as RuntimeSessionReference;
      if (value.version !== 1 || typeof value.id !== 'string' || !/^session_[a-zA-Z0-9-]+$/.test(value.id)) throw new Error('Invalid runtime reference file');
      resume = value;
    } finally { await file.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const saveReference = async (reference: RuntimeSessionReference | undefined) => {
    if (!reference) await rm(referenceFile, { force: true });
    else {
      const temporary = `${referenceFile}.${randomUUID()}.tmp`; const file = await open(temporary, 'wx', 0o600);
      try { try { await file.writeFile(JSON.stringify(reference)); await file.sync(); } finally { await file.close(); } await rename(temporary, referenceFile); }
      finally { await rm(temporary, { force: true }); }
    }
    const directory = await open(root, 'r'); try { await directory.sync(); } finally { await directory.close(); }
  };
  if (!live) {
    const { offlineHarness } = await import('../../../examples/agent-runtime/harness-fixtures.js');
    const host = offlineHarness(driver, root);
    return { ...host, resume, saveReference, referenceFile };
  }
  if (process.env.ONERINGAI_ALLOW_LIVE !== '1') throw new Error('Real-provider mode requires ONERINGAI_ALLOW_LIVE=1; project live testing remains paused');
  const anthropic = driver.startsWith('anthropic'); const connector = `amos-${driver}`;
  Connector.create({ name: connector, vendor: anthropic ? Vendor.Anthropic : Vendor.OpenAI, auth: { type: 'api_key_provider', getApiKey: async () => {
    const key = process.env[anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'];
    if (!key) throw new Error(`${anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} required`); return key;
  } } });
  const implementations: Record<ExampleDriver, () => AgentDriver> = {
    'oneringai.agent': () => new OneRingAIDriver({ trustAgentPolicy: true }),
    'openai.codex.sdk': () => new CodexSdkDriver(),
    'anthropic.agent.sdk': () => new ClaudeAgentSdkDriver(),
    'openai.agents.api': () => new OpenAIManagedDriver(),
    'anthropic.managed.api': () => new ClaudeManagedDriver(),
  };
  const localCodex = driver === 'openai.codex.sdk'; const hostedOpenAI = driver === 'openai.agents.api';
  const options: RuntimeSessionOptions = {
    execution: { driver, connector, model: anthropic ? 'claude-sonnet-4-6' : hostedOpenAI ? 'gpt-6-astra' : 'gpt-6.1-sol' },
    context: { userId: 'local-owner' },
    environment: localCodex ? { type: 'local-directory', path: workspace } : driver.endsWith('.api') ? { type: 'provider-managed' } : { type: 'none' },
    policy: { filesystem: localCodex ? 'read-only' : hostedOpenAI ? 'workspace-write' : 'denied', commands: localCodex || hostedOpenAI ? 'sandboxed' : 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' },
  };
  const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [implementations[driver]()], sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'control')), fileTransfer: () => ({ root: transferRoot, maxBytes: 1024 * 1024, mediaTypes: ['text/plain', 'application/json'] }), resolveTools: () => ({ fingerprint: 'amos-example-note-v1', tools: [{ definition: { type: 'function', function: { name: 'read_demo_note', description: 'Read the host-authorized demonstration note.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }, execute: async () => ({ note: 'The runtime uses a named Connector, one host tool pipeline, and scoped session references.' }) }] }) }) });
  return { runtime, options, definition: { id: 'amos-assistant', instructions: 'Be accurate and concise. Use read_demo_note when asked about the demonstration note.', tools: ['read_demo_note'] }, resume, saveReference, transferRoot, referenceFile };
}

export async function createAmosRuntimeHost(dataDir: string): Promise<AmosRuntimeHost> {
  const driver = process.env.AMOS_RUNTIME_DRIVER ?? 'oneringai.agent';
  if (!drivers.includes(driver as ExampleDriver)) throw new Error(`AMOS_RUNTIME_DRIVER must be one of ${drivers.join(', ')}`);
  return createExampleRuntimeHost(dataDir, driver as ExampleDriver, process.env.AMOS_RUNTIME_LIVE === '1');
}
