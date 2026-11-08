import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { isDeepStrictEqual } from 'node:util';
import { createHash, createHmac, createCipheriv } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { schemaCases } from './schema-cases.mjs';
import { createEqualityCases } from './equality-cases.mjs';

export function compileAjv(schema, profile) {
  const ajv = new Ajv(profile === 'helper'
    ? { allErrors: true, strict: false, strictSchema: true }
    : { allErrors: false, strict: false, logger: false });
  if (profile === 'helper') addFormats(ajv);
  return ajv.compile(schema);
}
export function outcome(compile, test) {
  let validate;
  try { validate = compile(structuredClone(test.schema), test.profile); }
  catch { return { admission: 'rejected' }; }
  return { admission: 'accepted', results: test.values.map(value => {
    try { return !!validate(structuredClone(value)); } catch { return 'validation-threw'; }
  }) };
}
export function oracle() {
  const key = new Uint8Array(32).fill(19), iv = new Uint8Array(12).fill(7);
  return {
    node: process.version,
    schemas: Object.fromEntries(schemaCases.map(test => [test.name, outcome(compileAjv, test)])),
    equality: Object.fromEntries(createEqualityCases().map(([name, a, b]) => [name, isDeepStrictEqual(a, b)])),
    crypto: ['', 'ordinary', '😀 café', '\ud800', '\udc00', '\u0000\uffff'].map(input => {
      const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from('oneringai-collections-v1'));
      const encrypted = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
      return { input, expected: {
        sha256: createHash('sha256').update(input).digest('hex'),
        hmac: createHmac('sha256', key).update(input).digest('hex'),
        encrypted: Buffer.concat([encrypted, cipher.getAuthTag()]).toString('hex'),
      } };
    }),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(process.argv[2], JSON.stringify(oracle()) + '\n');
}
