/** Offline real-app test: isolated data, fake OS encryption, signed fixture identity and fake SSE. */
import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const currentPlanModels = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-sol',
  'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
const availableModels = ['gpt-4.1-mini', ...currentPlanModels, 'hosea-offline-unknown'];
const scratch = await mkdtemp(join(tmpdir(), 'hosea-chatgpt-electron-'));
const bootstrap = join(scratch, 'bootstrap.cjs');
await writeFile(bootstrap, `
const { app, shell, safeStorage } = require('electron');
app.on('browser-window-created', (_event, window) => {
 // Native construction/show must finish before hide() can take effect on macOS.
 const hide = () => setImmediate(() => { if (!window.isDestroyed()) {
   window.hide(); window.setTitle('Hosea — Offline test · Temporary data');
 } });
 window.on('show', hide);
 hide();
 window.on('page-title-updated', event => event.preventDefault());
 window.webContents.setBackgroundThrottling(false);
});
const crypto = require('node:crypto');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'hosea-offline', alg: 'RS256', use: 'sig' };
let nonce = ''; let clientId = 'oaiapp_hosea_offline'; let signIns = 0; let requests = [];
let refreshCount = 0;
globalThis.__hoseaChatGPTTest = { requests, emptyModelCatalog: false, get signIns() { return signIns; } };
safeStorage.isEncryptionAvailable = () => true;
safeStorage.getSelectedStorageBackend = () => 'test';
safeStorage.encryptString = text => Buffer.from(Buffer.from(text).map(b => b ^ 53));
safeStorage.decryptString = bytes => Buffer.from(bytes.map(b => b ^ 53)).toString();
const originalFetch = globalThis.fetch;
function jwt() {
 const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
 const body = enc({ alg: 'RS256', kid: jwk.kid }) + '.' + enc({ iss: 'https://auth.openai.com', aud: clientId,
   sub: 'hosea-offline-user', email: 'offline@example.test', nonce, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 });
 return body + '.' + crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url');
}
shell.openExternal = async address => {
 const url = new URL(address);
 if (url.origin !== 'https://auth.openai.com') return;
 nonce = url.searchParams.get('nonce'); signIns++;
 const callback = new URL(url.searchParams.get('redirect_uri'));
 callback.search = new URLSearchParams({ state: url.searchParams.get('state'), code: 'offline-code', client_id: clientId });
 await originalFetch(callback);
};
globalThis.fetch = async (input, init) => {
 const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
 if (url.hostname === '127.0.0.1') return originalFetch(input, init);
 if (url.origin === 'https://auth.openai.com') {
   if (url.pathname === '/.well-known/openid-configuration') return Response.json({ issuer: url.origin, jwks_uri: url.origin + '/jwks', revocation_endpoint: url.origin + '/revoke' });
   if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
   if (url.pathname === '/revoke') return new Response('', { status: 200 });
   if (url.pathname.endsWith('/oauth/token')) return Response.json({ access_token: 'offline-chatgpt-access', refresh_token: 'offline-refresh',
     id_token: jwt(), expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' });
 }
 if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/models') {
   if (globalThis.__hoseaChatGPTTest.emptyModelCatalog) { globalThis.__hoseaChatGPTTest.emptyModelCatalog = false; return Response.json({ models: [] }); }
   return Response.json({ models: ${JSON.stringify(availableModels)}.map(slug => ({ slug, display_name: slug, visibility: 'list' })) });
 }
 if (url.origin !== 'https://api.openai.com' || url.pathname !== '/v1/responses') throw new Error('Offline QA blocked network request');
 const body = JSON.parse(init?.body ?? await input.clone().text());
 const authorization = new Headers(init?.headers ?? input.headers).get('authorization');
 requests.push({ body, authorization });
 const responseId = 'resp_qa_' + requests.length;
 const latestUser = [...body.input].reverse().find(i => i.role === 'user');
 const prompt = typeof latestUser?.content === 'string' ? latestUser.content : JSON.stringify(latestUser?.content);
 const hasResult = body.input.some(i => i.type === 'function_call_output');
 const tool = prompt?.includes('write marker') && !hasResult;
 const item = tool ? { type: 'function_call', id: 'fc_qa', call_id: 'call_qa', name: 'store_set',
   ...(authorization === 'Bearer offline-chatgpt-access' ? { namespace: 'oneringai' } : {}),
   arguments: JSON.stringify({ store: 'whiteboard', key: 'qa_marker', description: 'QA marker', value: 'preserved across authentication', priority: 'high' }), status: 'completed' }
   : { type: 'message', id: 'msg_qa', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Offline QA complete', annotations: [] }] };
 const response = { id: responseId, object: 'response', created_at: 1, model: body.model, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
 const events = [{ type: 'response.created', response: { ...response, output: [], status: 'in_progress' } },
   { type: 'response.output_item.added', output_index: 0, item: { ...item, ...(tool ? { arguments: '' } : { content: [] }) } },
   ...(tool ? [{ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: item.arguments }]
     : [{ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Offline QA complete' },
       { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text: 'Offline QA complete' }]),
   { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }];
 return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join('') + 'data: [DONE]\\n\\n', { headers: { 'Content-Type': 'text/event-stream' } });
};
require(${JSON.stringify(resolve(appRoot, 'dist/main/index.cjs'))});
`);
let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap],
    env: { ...process.env, HOSEA_DATA_DIR: join(scratch, 'data'), HOSEA_ENABLE_BACKEND: '0', HOSEA_DESIGN_PREVIEW: '0', NODE_ENV: 'production' }, timeout: 60_000 });
  const page = await app.firstWindow();
  console.log('Electron ready');
  page.setDefaultTimeout(20_000);
  await page.waitForFunction(() => !!window.hosea?.service, undefined, { timeout: 60_000 });
  // The readiness method is asynchronous; explicitly await the resolved service state.
  await page.waitForFunction(async () => await window.hosea.service.isReady(), undefined, { timeout: 60_000 });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false, 'offline QA must not present a window as the real workspace');
  await page.evaluate(() => {
    const marker = document.createElement('div');
    marker.textContent = 'OFFLINE TEST · TEMPORARY DATA';
    marker.setAttribute('aria-hidden', 'true');
    Object.assign(marker.style, { position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '4px 10px', borderRadius: '4px', background: '#fff3cd', color: '#664d03',
      font: '12px system-ui', pointerEvents: 'none' });
    document.body.append(marker);
  });
  const onboarding = page.getByRole('dialog').filter({ hasText: 'Make yourself at home.' });
  await onboarding.getByRole('button', { name: /Continue with ChatGPT/ }).waitFor();
  // Fresh data always shows release notes, whose IPC read can finish after service readiness.
  const news = page.getByRole('dialog').filter({ hasText: "What's New in hosea" });
  await news.getByRole('button', { name: 'Got it', exact: true }).click();
  await news.waitFor({ state: 'hidden' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(scratch, 'onboarding-options.png'), animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 600));
  await page.screenshot({ path: join(scratch, 'onboarding-options-narrow.png'), animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1380, 900));
  await onboarding.getByRole('button', { name: /Continue with ChatGPT/ }).click();
  await page.screenshot({ path: join(scratch, 'onboarding-chatgpt.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await page.getByRole('button', { name: 'Reconnect ChatGPT', exact: true }).waitFor();
  await app.evaluate(() => { globalThis.__hoseaChatGPTTest.emptyModelCatalog = true; });
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No models are available for this ChatGPT account.' }).waitFor();
  assert.equal(await page.evaluate(() => window.hosea.agentConfig.getActive()), null);
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.getByRole('dialog').getByText('Select Model', { exact: true }).waitFor();
  const modelPicker = page.getByRole('dialog').locator('select');
  const modelOptions = await modelPicker.locator('option').evaluateAll(options => options.map(o => ({ id: o.value, label: o.textContent })));
  assert.deepEqual(modelOptions.map(o => o.id), ['', ...availableModels], 'only account-available models are offered, in account order');
  for (const id of currentPlanModels) {
    assert.equal(modelOptions.find(option => option.id === id)?.label, `${id} (1050K context)`, 'registered plan models retain their context limits');
  }
  assert.match(modelOptions.find(option => option.id === 'gpt-4.1-mini')?.label ?? '', /\(\d+K context\)$/);
  assert.equal(modelOptions.find(option => option.id === 'hosea-offline-unknown')?.label, 'hosea-offline-unknown (context limit unknown)');
  assert.equal(await modelPicker.inputValue(), 'gpt-4.1-mini');
  await page.screenshot({ path: join(scratch, 'onboarding-models.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Get Started', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const onboarded = await page.evaluate(() => window.hosea.agentConfig.getActive());
  assert.equal(onboarded?.connector, 'hosea-chatgpt');
  assert.equal(onboarded?.model, 'gpt-4.1-mini');
  const authConnector = await page.evaluate(() => window.hosea.connector.list().then(list => list.find(c => c.name === 'hosea-chatgpt')));
  assert.equal(authConnector?.vendor, 'openai', 'first-run ChatGPT connector must use OpenAI');
  assert.equal(authConnector?.source, 'built-in');
  assert.equal(authConnector?.authMode, 'chatgpt-plan');
  assert.equal((await page.evaluate(() => window.hosea.chatGPT.useAPIKeys())).success, true);
  console.log('First-run ChatGPT onboarding verified');
  // Remove only the fixture's generated connection so the existing collision test starts empty.
  await page.evaluate(() => window.hosea.connector.delete('hosea-chatgpt'));
  const setup = await page.evaluate(async () => {
    const bridge = window.hosea;
    const added = await bridge.connector.add({ name: 'qa-api', vendor: 'openai', auth: { type: 'api_key', apiKey: 'offline-api-key' } });
    if (!added.success) throw new Error(added.error);
    const collision = await bridge.connector.add({ name: 'hosea-chatgpt', vendor: 'anthropic', auth: { type: 'api_key', apiKey: 'offline-other-key' } });
    if (!collision.success) throw new Error(collision.error);
    const config = await bridge.agentConfig.createDefault('qa-api', 'gpt-4.1');
    if (!config.success || !config.id) throw new Error(config.error);
    await bridge.agentConfig.update(config.id, { permissionsEnabled: false, dynamicUIEnabled: false });
    const first = await bridge.agent.createInstance(config.id);
    const second = await bridge.agent.createInstance(config.id);
    if (!first.success || !second.success) throw new Error(first.error || second.error);
    return { configId: config.id, first: first.instanceId, second: second.instanceId };
  });
  async function turn(id, prompt) {
    return page.evaluate(async ({ id, prompt }) => {
      const chunks = [];
      const remove = window.hosea.agent.onStreamChunkInstance((instance, chunk) => { if (instance === id) chunks.push(chunk); });
      try { await window.hosea.agent.streamInstance(id, prompt); return chunks; } finally { if (typeof remove === 'function') remove(); }
    }, { id, prompt });
  }
  console.log('Agents created');
  const initial = await turn(setup.first, 'write marker');
  assert.equal(initial.some(c => c.type === 'error'), false, JSON.stringify(initial));
  assert.ok(initial.some(c => c.type === 'tool:start' || c.type === 'tool_start'), 'native Agent executed its context tool');
  const before = await page.evaluate(id => window.hosea.internals.getAllForInstance(id), setup.first);
  assert.ok(JSON.stringify(before).includes('qa_marker'), 'plugin marker exists before authorization');
  console.log('Tool and plugin verified');
  for (const modal of await page.getByRole('dialog').all()) { const close = modal.getByRole('button', { name: 'Close', exact: true }); if (await close.count()) await close.click(); }
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Manage models', exact: true }).click();
  await page.getByRole('button', { name: 'Reconnect ChatGPT', exact: true }).click();
  await page.getByText('You’re using your ChatGPT plan', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByRole('button', { name: 'Reconnect ChatGPT', exact: true }).waitFor();
  const connection = await page.evaluate(() => window.hosea.chatGPT.status());
  console.log('Authorization returned');
  assert.equal(connection.usePlan, true, JSON.stringify(connection));
  const sharedCard = page.locator('.connector-card').filter({ hasText: 'Managed by shared ChatGPT connection' });
  await sharedCard.getByText('OpenAI', { exact: true }).waitFor();
  assert.equal(await sharedCard.locator('.connector-card__name').innerText(), 'hosea-chatgpt-2');
  await page.screenshot({ path: join(scratch, 'providers-connected.png') });
  const models = await page.evaluate(() => window.hosea.connector.fetchModels('openai', undefined, undefined, 'qa-api'));
  assert.deepEqual(models.models, availableModels);
  console.log('Models verified');
  const first = await turn(setup.first, 'Continue after shared sign-in');
  console.log('First existing chat rebound');
  const second = await turn(setup.second, 'Use the same shared sign-in');
  for (const chunks of [first, second]) assert.equal(chunks.some(c => c.type === 'error'), false, JSON.stringify(chunks));
  const after = await page.evaluate(id => window.hosea.internals.getAllForInstance(id), setup.first);
  assert.ok(JSON.stringify(after).includes('qa_marker'), 'plugin marker survives automatic account rebinding');
  const direct = await page.evaluate(() => window.hosea.agent.send('Collect a subscription stream through Agent.run'));
  assert.equal(direct.success, true, JSON.stringify(direct));
  assert.ok(direct.response.includes('Offline QA complete'));
  const third = await page.evaluate(async () => {
    const connections = await window.hosea.connector.list();
    if (connections.find(c => c.name === 'hosea-chatgpt')?.vendor !== 'anthropic') throw new Error('Existing connection was overwritten');
    const shared = connections.find(c => c.vendor === 'openai' && c.source === 'built-in');
    if (!shared || shared.name === 'hosea-chatgpt') throw new Error('Shared connection did not avoid name collision');
    const config = await window.hosea.agentConfig.createDefault(shared.name, 'gpt-4.1');
    if (!config.success || !config.id) throw new Error(config.error);
    await window.hosea.agentConfig.update(config.id, { permissionsEnabled: false, dynamicUIEnabled: false });
    return window.hosea.agent.createInstance(config.id);
  });
  assert.equal(third.success, true, JSON.stringify(third));
  const planTool = await turn(third.instanceId, 'write marker');
  assert.equal(planTool.some(c => c.type === 'error'), false, JSON.stringify(planTool));
  assert.ok(planTool.some(c => c.type === 'tool:start' || c.type === 'tool_start'));
  const diagnostics = await app.evaluate(() => ({ signIns: globalThis.__hoseaChatGPTTest.signIns, requests: globalThis.__hoseaChatGPTTest.requests }));
  assert.equal(diagnostics.signIns, 2);
  const planRequests = diagnostics.requests.filter(r => r.authorization === 'Bearer offline-chatgpt-access');
  assert.equal(planRequests.length, 5);
  assert.ok(planRequests.some(r => r.body.input.some(i => i.type === 'function_call' && i.namespace === 'oneringai')));
  for (const { body } of planRequests) {
    assert.equal(body.store, false); assert.equal(body.stream, true); assert.ok(Array.isArray(body.input));
    assert.equal(body.temperature, undefined); assert.equal(body.max_output_tokens, undefined);
    assert.equal(body.tools[0].type, 'namespace');
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).waitFor();
  const signedOut = await turn(setup.second, 'This must not fall back to API-key billing');
  assert.ok(signedOut.some(c => c.type === 'error'));
  const count = await app.evaluate(() => globalThis.__hoseaChatGPTTest.requests.length);
  assert.equal(count, diagnostics.requests.length, 'signed-out turn did not dispatch inference');
  for (const modal of await page.getByRole('dialog').all()) { const close = modal.getByRole('button', { name: 'Close', exact: true }); if (await close.count()) await close.click(); }
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Manage models', exact: true }).click();
  // The connection screen is also reachable through the model-provider section of navigation.
  const card = page.getByRole('region', { name: 'ChatGPT connection' });
  await card.waitFor();
  await card.screenshot({ path: join(scratch, 'chatgpt-connection.png') });
  await page.screenshot({ path: join(scratch, 'providers-desktop.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 800));
  await page.screenshot({ path: join(scratch, 'providers-narrow.png') });
  await page.evaluate(async () => { document.documentElement.dataset.theme = 'dark'; await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {}))); });
  await page.screenshot({ path: join(scratch, 'providers-dark.png') });
  await page.getByRole('button', { name: 'Use configured API keys', exact: true }).click();
  await page.getByRole('button', { name: 'Use configured API keys', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.hosea.chatGPT.status())).usePlan, false);
  const explicitAPI = await turn(setup.second, 'Explicitly use configured API-key billing');
  assert.equal(explicitAPI.some(c => c.type === 'error'), false, JSON.stringify(explicitAPI));
  const apiRequest = await app.evaluate(() => globalThis.__hoseaChatGPTTest.requests.at(-1));
  assert.equal(apiRequest.authorization, 'Bearer offline-api-key');
  assert.equal(apiRequest.body.temperature, 0.7);
  console.log(JSON.stringify({ success: true, signIns: diagnostics.signIns, modelRequests: count,
    checks: ['existing and new agents share one authorization', 'plugin restoration', 'namespaced tools', 'no billing fallback', 'account-specific models', 'Agent.run stream collection', 'keyless first-time setup', 'preserved conflicting provider name', 'explicit API-key switch'], artifacts: scratch }));
} catch (error) {
  console.error('Offline Electron QA artifacts:', scratch);
  const page = app?.windows()[0];
  if (page) await page.screenshot({ path: join(scratch, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
  // Screenshots/logs are kept for review, credentials contain fixture values only.
  await rm(join(scratch, 'data'), { recursive: true, force: true });
}
