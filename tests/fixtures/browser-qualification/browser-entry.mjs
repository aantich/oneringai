import comparisons from 'assert/build/internal/util/comparisons.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { gcm } from '@noble/ciphers/aes.js';
import { schemaCases } from './schema-cases.mjs';
import { createEqualityCases } from './equality-cases.mjs';
import { compileAdapterProbe } from './schema-adapter-probe.mjs';
import { probeTransport } from './transport-probe.mjs';

const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
async function run(expected) {
  const report = { schemas: [], equality: [], crypto: [], transport: undefined };
  for (const test of schemaCases) {
    let actual;
    try {
      const validate = compileAdapterProbe(structuredClone(test.schema), test.profile);
      actual = { admission: 'accepted', results: test.values.map(value => {
        try { return !!validate(structuredClone(value)); } catch { return 'validation-threw'; }
      }) };
    } catch { actual = { admission: 'rejected' }; }
    if (JSON.stringify(actual) !== JSON.stringify(expected.schemas[test.name])) report.schemas.push({ name: test.name, actual, expected: expected.schemas[test.name] });
  }
  for (const [name, a, b] of createEqualityCases()) {
    const actual = comparisons.isDeepStrictEqual(a, b);
    if (actual !== expected.equality[name]) report.equality.push({ name, actual, expected: expected.equality[name] });
  }
  const key = new Uint8Array(32).fill(19), iv = new Uint8Array(12).fill(7), aad = new TextEncoder().encode('oneringai-collections-v1');
  for (const vector of expected.crypto) {
    const bytes = new TextEncoder().encode(vector.input);
    const actual = { sha256: hex(sha256(bytes)), hmac: hex(hmac(sha256, key, bytes)), encrypted: hex(gcm(key, iv, aad).encrypt(bytes)) };
    if (JSON.stringify(actual) !== JSON.stringify(vector.expected)) report.crypto.push({ input: vector.input, actual, expected: vector.expected });
  }
  report.transport = await probeTransport();
  report.passed = !report.schemas.length && !report.equality.length && !report.crypto.length;
  return report;
}
globalThis.runQualification = run;
if (typeof document === 'undefined') globalThis.onmessage = async ({ data }) => {
  try { globalThis.postMessage({ report: await run(data) }); }
  catch (error) { globalThis.postMessage({ error: String(error?.stack ?? error) }); }
};
