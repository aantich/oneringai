import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
const required = new Set([manifest.main, manifest.module, manifest.types]);

function collectTargets(target) {
  if (typeof target === 'string') required.add(target);
  else if (target && typeof target === 'object') for (const child of Object.values(target)) collectTargets(child);
}
collectTargets(manifest.exports ?? {});

const missing = [];
for (const path of required) {
  if (typeof path !== 'string') continue;
  try {
    await access(new URL(path, `file://${packageRoot}/`));
  } catch {
    missing.push(path);
  }
}

if (missing.length > 0) {
  throw new Error(`Package exports reference missing files:\n${missing.join('\n')}`);
}

console.log(`Verified ${required.size} package export files`);

// Source tests cannot detect duplicate bundled registries/classes across entry points.
for (const format of ['esm', 'cjs']) {
  const load = format === 'esm'
    ? path => import(new URL(path, `file://${packageRoot}/`).href)
    : (await import('node:module')).createRequire(import.meta.url);
  const root = await load(`${packageRoot}/dist/index.${format === 'esm' ? 'js' : 'cjs'}`);
  const api = await load(`${packageRoot}/dist/agent-runtime/index.${format === 'esm' ? 'js' : 'cjs'}`);
  const { ChatGPTPlanAuth } = await load(`${packageRoot}/dist/auth/openai.${format === 'esm' ? 'js' : 'cjs'}`);
  const name = `package-runtime-identity-${format}`;
  root.Connector.create({ name, vendor: root.Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-package-identity' } });
  const runtime = new api.AgentRuntime({ backend: new api.LocalExecutionBackend({ drivers: [new api.OneRingAIDriver({ trustAgentPolicy: true })] }) });
  try {
    await runtime.createAgent({ id: 'identity', instructions: '' }).inspect({ execution: { driver: 'oneringai.agent', connector: name, model: 'gpt-4' }, context: {}, policy: { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } });
  } finally { await runtime.destroy(); root.Connector.remove(name); }
  const auth = new ChatGPTPlanAuth({ applicationName: 'Package export test', openBrowser() { throw new Error('Unexpected browser launch'); }, storage: {
    async load() { return JSON.stringify({ version: 1, hostId: 'urn:uuid:fixture', activeId: null, usePlan: false,
      profiles: [{ id: 'package-account', clientId: 'oaiapp_package' }] }); },
    async save() { throw new Error('Unexpected credential write'); },
  } });
  await auth.initialize();
  try {
    const connector = auth.createConnector(name, 'package-account');
    if (root.Connector.get(name) !== connector || connector.getOptions().openaiAccountId !== 'package-account') {
      throw new Error(`OpenAI auth ${format} does not share the root Connector registry`);
    }
  } finally { root.Connector.remove(name); }
}
console.log('Verified ESM/CJS root, runtime, and OpenAI auth Connector identity without provider calls');
