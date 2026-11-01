/**
 * Local vendor-neutral Agent Runtime preview.
 *
 * Run the OneRingAI adapter:
 *   npx tsx examples/agent-runtime-local.ts oneringai
 *
 * Run the Codex SDK adapter in an isolated temporary workspace:
 *   npx tsx examples/agent-runtime-local.ts codex
 */

import 'dotenv/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, Connector, Vendor } from 'oneringai';
import type { ToolFunction } from 'oneringai';
import {
  AgentRuntime,
  LocalExecutionBackend,
  OneRingAIDriver,
} from 'oneringai/agent-runtime';
import type { AgentRun } from 'oneringai/agent-runtime';
import { CodexSdkDriver } from 'oneringai/agent-runtime/codex';

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  const mode = process.argv[2] ?? 'oneringai';
  if (mode !== 'oneringai' && mode !== 'codex') {
    throw new Error("Choose mode 'oneringai' or 'codex'");
  }

  Connector.create({
    name: 'agent-runtime-openai',
    vendor: Vendor.OpenAI,
    auth: { type: 'api_key', apiKey },
  });

  const probe: ToolFunction = {
    definition: {
      type: 'function',
      function: {
        name: 'runtime_probe',
        description: 'Return a marker proving the agent completed a tool call.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    execute: async () => ({ marker: 'ONERING_RUNTIME_OK' }),
  };
  const oneRingDriver = new OneRingAIDriver({
    trustAgentPolicy: true,
    factories: {
      demo: ({ context }) => Agent.create({
        connector: 'agent-runtime-openai',
        model: 'gpt-5.3-codex',
        userId: context.userId,
        instructions: 'Call runtime_probe before answering.',
        tools: [probe],
      }),
    },
  });
  const codexDriver = new CodexSdkDriver();
  const runtime = new AgentRuntime({
    backend: new LocalExecutionBackend({ drivers: [oneRingDriver, codexDriver] }),
  });

  let temporaryWorkspace: string | undefined;
  try {
    if (mode === 'oneringai') {
      const agent = runtime.agent({
        id: 'local-oneringai-demo',
        driver: oneRingDriver.id,
        model: 'gpt-5.3-codex',
        reasoning: { effort: 'low' },
        driverConfig: { source: { type: 'factory', name: 'demo' } },
      });
      const session = await agent.openSession({
        context: { userId: 'local-developer' },
        policy: oneRingPolicy(),
        observation: { mode: 'live', detail: 'reasoning' },
        controlMode: 'observe-only',
      });
      const run = await session.run('Call runtime_probe, then report its marker.', {
        model: 'gpt-5.3-codex',
        reasoning: { effort: 'low' },
      });
      await printRun(run);
    } else {
      const configuredWorkspace = process.env.CODEX_WORKSPACE;
      temporaryWorkspace = configuredWorkspace
        ? undefined
        : await mkdtemp(path.join(tmpdir(), 'oneringai-codex-example-'));
      const workspace = configuredWorkspace ?? temporaryWorkspace!;
      const agent = runtime.agent({
        id: 'local-codex-demo',
        driver: codexDriver.id,
        connector: 'agent-runtime-openai',
        model: 'gpt-5.3-codex',
        reasoning: { effort: 'low' },
        instructions: 'Work only inside the supplied workspace.',
        driverConfig: { skipGitRepoCheck: true },
      });
      const session = await agent.openSession({
        context: { userId: 'local-developer' },
        workspace: { type: 'local-directory', path: workspace },
        policy: codexPolicy(),
        observation: { mode: 'live', detail: 'reasoning' },
        controlMode: 'observe-only',
      });
      const run = await session.run(
        'Create runtime-demo.txt containing CODEX_RUNTIME_OK, then briefly report completion.',
        { model: 'gpt-5.3-codex', reasoning: { effort: 'low' } },
      );
      await printRun(run);
      console.log(`Workspace: ${workspace}`);
    }
  } finally {
    await runtime.destroy();
    Connector.remove('agent-runtime-openai');
    if (temporaryWorkspace) await rm(temporaryWorkspace, { recursive: true, force: true });
  }
}

async function printRun(run: AgentRun): Promise<void> {
  for await (const event of run.events()) {
    console.log(event.type, event.data);
  }
  const result = await run.result;
  console.log(`status=${result.status}`);
  console.log('configuration=', result.configuration);
  console.log(result.outputText);
}

function oneRingPolicy() {
  return {
    filesystem: 'denied' as const,
    commands: 'denied' as const,
    sandboxNetwork: 'denied' as const,
    providerWebSearch: 'denied' as const,
    approvals: 'deny' as const,
  };
}

function codexPolicy() {
  return {
    filesystem: 'workspace-write' as const,
    commands: 'sandboxed' as const,
    sandboxNetwork: 'denied' as const,
    providerWebSearch: 'denied' as const,
    approvals: 'deny' as const,
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
