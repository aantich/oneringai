/** Offline actual Responses request decisions. Fetch is replaced; no keys or network are used. */
import assert from 'node:assert/strict';
import { Agent, Connector, Vendor, assessModelParameters } from '@everworker/oneringai';
import type { ModelParameterDecision } from '@everworker/oneringai';
const originalFetch = globalThis.fetch, bodies: Array<Record<string, any>> = [], decisions: ModelParameterDecision[] = [];
globalThis.fetch = async (input, init) => {
  const body = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body)); bodies.push(body);
  return Response.json({ id: `offline-${bodies.length}`, object: 'response', status: 'completed', model: body.model,
    output: [{ type: 'message', id: 'answer', role: 'assistant', content: [{ type: 'output_text', text: 'OFFLINE_OK', annotations: [] }] }], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } });
};
Connector.create({ name: 'parameter-demo', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: 'offline-placeholder-never-sent' } });
const agent = Agent.create({ connector: 'parameter-demo', model: 'gpt-6-sol', temperature: 0, thinking: { enabled: true, effort: 'high' },
  parameterPolicy: { temperature: 'omit-unsupported', observe: decision => { decisions.push(decision); } },
  context: { model: 'gpt-6-sol', features: { workingMemory: false, inContextMemory: false } } });
try {
  await agent.run('Offline request'); assert.equal(bodies[0]!.temperature, undefined); assert.equal(agent.getTemperature(), 0);
  await agent.runDirect('Offline conditional request', { temperature: 0, thinking: { enabled: true, effort: 'none' } }); assert.equal(bodies[1]!.temperature, 0);
  await assert.rejects(agent.runDirect('Explicit raw invalid option', { thinking: { enabled: true, effort: 'high' }, vendorOptions: { temperature: 0 } }), /vendorOptions.temperature/);
  assert.equal(bodies.length, 2); assert.equal(assessModelParameters({ vendor: Vendor.Custom, model: 'gpt-6-sol', endpoint: 'custom' }).temperature.support, 'unknown');
  console.log(JSON.stringify({ passed: true, requests: bodies.map(body => ({ model: body.model, temperature: body.temperature ?? null, reasoning: body.reasoning })), decisions, savedTemperature: agent.getTemperature() }));
} finally { agent.destroy(); Connector.remove('parameter-demo'); globalThis.fetch = originalFetch; }
