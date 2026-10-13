/** Stage 02 offline demonstration; --live-anthropic adds explicitly opt-in LLM calls. Build first. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Agent, Connector, StreamEventType, ToolManager, Vendor } from '@everworker/oneringai';
import type { ToolExecutionOutcome, ToolFunction } from '@everworker/oneringai';

const tool = (name: string, execute: ToolFunction['execute']): ToolFunction => ({
  definition: { type: 'function', function: { name, description: 'Offline demonstration', parameters: { type: 'object', properties: {} } } }, execute,
});

export async function demonstrateToolOutcomes(): Promise<ToolExecutionOutcome[]> {
  const manager = new ToolManager(); const outcomes: ToolExecutionOutcome[] = [];
  manager.on('tool:outcome', outcome => outcomes.push(outcome));
  manager.register(tool('domain_data', async () => ({ success: false, value: 'valid domain data' })));
  manager.register(tool('normalized_failure', async () => { throw new Error('Example failure'); }));
  manager.register(tool('cooperative', async (_args, context) => new Promise((_resolve, reject) => {
    context?.signal?.addEventListener('abort', () => reject(context.signal!.reason), { once: true });
  })));
  let finish!: (value: string) => void;
  manager.register(tool('noncooperative', async () => new Promise<string>(resolve => { finish = resolve; })));
  try {
    const domain = await manager.executeWithOutcome('domain_data', {});
    const failure = await manager.executeWithOutcome('normalized_failure', {});
    if (domain.outcome.status !== 'succeeded' || failure.outcome.status !== 'failed') throw new Error('Outcome demonstration failed');
    console.log('Raw application data:', domain.result);
    console.log('Legacy normalized failure:', failure.result);
    for (const name of ['cooperative', 'noncooperative']) {
      await manager.execute(name, {}, { timeoutMs: 20, callId: name, runId: 'offline-demo' }).catch(error => {
        if (error.outcome?.status !== 'timed_out') throw error;
      });
    }
    const late = new Promise<ToolExecutionOutcome>(resolve => manager.once('tool:late-complete', resolve));
    finish('Operation completed after the caller stopped waiting');
    const completion = await late;
    if (completion.callId !== 'noncooperative' || completion.status !== 'succeeded') throw new Error('Late completion correlation failed');
    console.log('Late completion (diagnostic only):', completion.status, completion.callId);
    return outcomes;
  } finally { manager.destroy(); }
}

/** Registration updates affect future calls, including when an admitted call awaits plugins. */
export async function demonstrateInvocationSnapshot(): Promise<void> {
  const manager = new ToolManager();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  manager.register(tool('selected', async () => 'original selection'));
  manager.executionPipeline.use({ name: 'host-gate', beforeExecute: async () => gate });
  try {
    const admitted = manager.execute('selected', {});
    manager.register(tool('selected', async () => 'replacement selection'));
    release();
    if (await admitted !== 'original selection') throw new Error('Admission snapshot changed');
    if (await manager.execute('selected', {}) !== 'replacement selection') throw new Error('Replacement not used by future call');
    console.log('Invocation selection retained; replacement used by the next call.');
  } finally { release(); manager.destroy(); }
}

export async function demonstrateConnectorCancellation(): Promise<void> {
  const server = createServer((_request, response) => { response.writeHead(200); response.write('first chunk'); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  const name = 'stage02-loopback';
  const connector = Connector.create({ name, auth: { type: 'api_key', apiKey: 'loopback-demo-only' }, baseURL: `http://127.0.0.1:${address.port}`, retry: { maxRetries: 0 } });
  const host = new AbortController();
  try {
    const response = await connector.fetch('/stream', { signal: host.signal, timeout: 1000, timeoutScope: 'operation', retryPolicy: 'safe' });
    const reader = response.body!.getReader(); await reader.read();
    const waiting = reader.read().catch(error => error); host.abort(new DOMException('Host cancelled body read', 'AbortError'));
    const error = await waiting; if (!(error instanceof Error) || error.name !== 'AbortError') throw new Error('Connector cancellation failed');
    console.log('Loopback body read cancelled; no claim about remote effects.');
  } finally {
    Connector.remove(name); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

/** Opt-in, billable example: named tool selection and semantic outcomes in both modes. */
export async function demonstrateAnthropicNamedTools(): Promise<void> {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ quiet: true });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY in .env for --live-anthropic');
  const connector = 'example-anthropic-named-tools';
  Connector.create({ name: connector, vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey } });
  try {
    for (const mode of ['run', 'stream'] as const) {
      let calls = 0;
      const outcomes: ToolExecutionOutcome[] = [];
      const model = 'claude-haiku-4-5-20251001';
      const agent = Agent.create({ connector, model, maxIterations: 4,
        thinking: { enabled: false }, emptyResponseRetry: { enabled: false },
        instructions: 'Run each probe once, then report DOMAIN_VALID and LOCAL_FAILURE_VERIFIED verbatim. Do not retry either probe.',
        tools: [tool('domain_probe', async () => ({ success: false, marker: 'DOMAIN_VALID' })),
          tool('failure_probe', async () => { throw new Error('LOCAL_FAILURE_VERIFIED'); })],
        context: { model, features: { workingMemory: false, inContextMemory: false } },
        hooks: { 'before:llm': async context => {
          const target = ['domain_probe', 'failure_probe'][calls++];
          // In-place modifications work in both run() and stream().
          context.options.tool_choice = target ? { type: 'function', function: { name: target } } : 'auto';
          context.options.parallel_tool_calls = false;
          context.options.max_output_tokens = 256;
          return {};
        } },
      });
      agent.tools.on('tool:outcome', outcome => outcomes.push(outcome));
      try {
        let text = '';
        if (mode === 'run') text = (await agent.run('Run the probes and report both markers.')).output_text ?? '';
        else for await (const event of agent.stream('Run the probes and report both markers.')) {
          if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
        }
        if (!text.includes('DOMAIN_VALID') || !text.includes('LOCAL_FAILURE_VERIFIED')
          || outcomes.length !== 2 || outcomes[0]?.toolName !== 'domain_probe' || outcomes[0]?.status !== 'succeeded'
          || outcomes[1]?.toolName !== 'failure_probe' || outcomes[1]?.status !== 'failed') {
          throw new Error(`Unexpected ${mode} probe results`);
        }
        console.log(`${mode}:`, outcomes.map(outcome => `${outcome.toolName}=${outcome.status}`).join(', '));
      } finally { agent.destroy(); }
    }
  } finally { Connector.remove(connector); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const outcome of await demonstrateToolOutcomes()) console.log(outcome.toolName, outcome.status, outcome.completion, outcome.cancellation);
  await demonstrateInvocationSnapshot();
  await demonstrateConnectorCancellation();
  if (process.argv.includes('--live-anthropic')) await demonstrateAnthropicNamedTools();
}
