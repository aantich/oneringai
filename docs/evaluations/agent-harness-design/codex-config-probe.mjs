/**
 * Offline SDK serialization probe. A temporary fake executable records CLI
 * arguments and returns fixture events. No native Codex, API or MCP call occurs.
 * POSIX-only probe; does not establish Windows or live MCP compatibility.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Codex } from '@openai/codex-sdk';

if (process.platform === 'win32') {
  throw new Error('This fake-executable probe requires POSIX; Windows is unverified.');
}

const temporary = await mkdtemp(path.join(tmpdir(), 'oneringai-codex-config-'));
try {
  const executable = path.join(temporary, 'fake-codex');
  const capture = path.join(temporary, 'capture.json');
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
(async () => {
  for await (const chunk of process.stdin) { /* Drain fixture input. */ }
  fs.writeFileSync(process.env.PROBE_CAPTURE, JSON.stringify({
    args: process.argv.slice(2),
    brokerCredentialPresent: process.env.ONERINGAI_HOST_BROKER_TOKEN === 'fixture-only',
    unexpectedApiKey: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
  }));
  for (const event of [
    { type: 'thread.started', thread_id: 'fixture-thread' },
    { type: 'item.completed', item: { type: 'agent_message', id: 'fixture-message', text: 'fixture' } },
    { type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } },
  ]) process.stdout.write(JSON.stringify(event) + '\\n');
})().catch(() => { process.exitCode = 1; });
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const codex = new Codex({
    codexPathOverride: executable,
    env: {
      PATH: path.dirname(process.execPath),
      PROBE_CAPTURE: capture,
      ONERINGAI_HOST_BROKER_TOKEN: 'fixture-only',
    },
    config: {
      mcp_servers: {
        onering_host: {
          url: 'http://127.0.0.1:12345/mcp',
          bearer_token_env_var: 'ONERINGAI_HOST_BROKER_TOKEN',
          enabled_tools: ['search_records', 'read_record'],
          required: true,
        },
      },
    },
  });
  const result = await codex.startThread({ skipGitRepoCheck: true }).run('fixture');
  const observed = JSON.parse(await readFile(capture, 'utf8'));
  const overrides = observed.args.filter((_, index, args) => args[index - 1] === '--config');
  assert(overrides.includes('mcp_servers.onering_host.url="http://127.0.0.1:12345/mcp"'));
  assert(overrides.includes('mcp_servers.onering_host.required=true'));
  assert(overrides.includes('mcp_servers.onering_host.bearer_token_env_var="ONERINGAI_HOST_BROKER_TOKEN"'));
  assert(overrides.some(value => value.startsWith('mcp_servers.onering_host.enabled_tools=')
    && value.includes('search_records') && value.includes('read_record')));
  assert.equal(observed.brokerCredentialPresent, true);
  assert.equal(observed.unexpectedApiKey, false);
  assert.equal(observed.args.some(value => value.includes('fixture-only')), false);
  assert.equal(result.finalResponse, 'fixture');
  process.stdout.write('Installed Codex SDK configuration serialization passed; no live invocation.\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
