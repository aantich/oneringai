// Isolated P0 probe: no production substitution is installed by this script.
// A candidate mismatch exits unsuccessfully; it must not be counted as coverage.
import assert from 'node:assert/strict';
import { createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { compileAjv, outcome } from './oracle.mjs';
import { createEqualityCases } from './equality-cases.mjs';
import { Validator as WorkerValidator } from '@cfworker/json-schema';
import { Validator as JsonValidator } from 'jsonschema';
import deepEqual from 'deep-equal';
import browserAssert from 'assert/build/assert.js';
import { circularDeepEqual, strictCircularDeepEqual } from 'fast-equals';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { gcm } from '@noble/ciphers/aes.js';
import { schemaCases } from './schema-cases.mjs';
import { compileAdapterProbe } from './schema-adapter-probe.mjs';

const report = { node: process.version, schemas: {}, equality: {}, crypto: {} };
const candidates = {
  'jsonschema bounded adapter probe': compileAdapterProbe,
  '@cfworker/json-schema draft 7': schema => {
    const validator = new WorkerValidator(schema, '7', false);
    return value => validator.validate(value).valid;
  },
  '@cfworker/json-schema draft 2019-09': schema => {
    const validator = new WorkerValidator(schema, '2019-09', false);
    return value => validator.validate(value).valid;
  },
  jsonschema: schema => {
    schema.$id ??= 'https://oneringai.invalid/schema';
    const validator = new JsonValidator();
    validator.addSchema(schema);
    return value => validator.validate(value, schema).valid;
  },
};
for (const [name, compile] of Object.entries(candidates)) {
  const mismatches = [];
  for (const test of schemaCases) {
    const expected = outcome(compileAjv, test);
    const actual = outcome(compile, test);
    if (!isDeepStrictEqual(expected, actual)) mismatches.push({ name: test.name, profile: test.profile, expected, actual });
  }
  report.schemas[name] = { total: schemaCases.length, matches: schemaCases.length - mismatches.length, mismatches };
}

const equalityCases = createEqualityCases();
for (const [name, compare] of Object.entries({
  'deep-equal strict': (a, b) => deepEqual(a, b, { strict: true }),
  'fast-equals circular': circularDeepEqual,
  'fast-equals strict circular': strictCircularDeepEqual,
  'browser assert strict': (a, b) => {
    try { browserAssert.deepStrictEqual(a, b); return true; }
    catch (error) { if (error?.code === 'ERR_ASSERTION') return false; throw error; }
  },
})) {
  const mismatches = [];
  for (const [test, a, b] of equalityCases) {
    const expected = isDeepStrictEqual(a, b);
    let actual;
    try { actual = compare(a, b); } catch { actual = 'threw'; }
    if (actual !== expected) mismatches.push({ name: test, expected, actual });
  }
  report.equality[name] = { total: equalityCases.length, matches: equalityCases.length - mismatches.length, mismatches };
}

const key = new Uint8Array(32).fill(19), iv = new Uint8Array(12).fill(7);
const encoder = new TextEncoder();
for (const input of ['', 'ordinary', '😀 café', '\ud800', '\udc00', '\u0000\uffff']) {
  const bytes = encoder.encode(input);
  assert.equal(Buffer.from(sha256(bytes)).toString('hex'), createHash('sha256').update(input).digest('hex'));
  assert.equal(Buffer.from(hmac(sha256, key, bytes)).toString('hex'), createHmac('sha256', key).update(input).digest('hex'));
  const aad = encoder.encode('oneringai-collections-v1');
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tagged = Buffer.concat([encrypted, cipher.getAuthTag()]);
  assert.deepEqual(gcm(key, iv, aad).encrypt(bytes), new Uint8Array(tagged));
  assert.deepEqual(gcm(key, iv, aad).decrypt(tagged), bytes);
  const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(aad); decipher.setAuthTag(tagged.subarray(-16));
  assert.deepEqual(new Uint8Array(Buffer.concat([decipher.update(tagged.subarray(0, -16)), decipher.final()])), bytes);
  const damaged = new Uint8Array(tagged); damaged[0] ^= 1;
  assert.throws(() => gcm(key, iv, aad).decrypt(damaged));
}
report.crypto = { status: 'pass', unicodeVectors: 6, operations: ['SHA-256', 'HMAC-SHA-256', 'AES-256-GCM', 'tamper rejection'] };
report.passed = Object.values(report.schemas).some(result => result.mismatches.length === 0)
  && Object.values(report.equality).some(result => result.mismatches.length === 0);
const target = process.argv.indexOf('--report');
if (target >= 0) await writeFile(process.argv[target + 1], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
