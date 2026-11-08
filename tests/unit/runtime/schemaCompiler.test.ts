import { describe, expect, it } from 'vitest';
import { createSchemaCompiler as nodeCompiler } from '../../../src/infrastructure/runtime/schemaCompiler.js';
import { createSchemaCompiler as browserCompiler } from '../../../src/infrastructure/runtime/schemaCompiler.browser.js';

describe('private schema boundary', () => {
  it.each([nodeCompiler, browserCompiler])('normalizes resource and cache IDs with trailing root fragments for %s', create => {
    for (const profile of ['helper', 'collection'] as const) {
      for (const id of ['#/', 'https://fixture.invalid/root#/', 'urn:example:root#/']) {
        const schema = { $id: id, definitions: { value: { type: 'string' } }, $ref: '#/definitions/value' };
        const before = structuredClone(schema), validate = create(profile).compile(schema);
        expect(validate('ok')).toBe(true); expect(validate(1)).toBe(false); expect(schema).toEqual(before);
      }
      const compiler = create(profile);
      compiler.compile({ $id: 'https://fixture.invalid/root#/', type: 'string' });
      expect(() => compiler.compile({ $id: 'https://fixture.invalid/root#', type: 'number' })).toThrow();
    }
  });
  it.each([nodeCompiler, browserCompiler])('discovers metadata IDs without validating or rewriting unused data for %s', create => {
    for (const profile of ['helper', 'collection'] as const) {
      for (const key of profile === 'helper' ? ['contentSchema'] : ['contentSchema', 'appSchema']) {
        const schema = { $id: 'https://fixture.invalid/area/root', [key]: { $id: 'nested/value', type: 'string' }, $ref: 'nested/value' };
        const before = structuredClone(schema), validate = create(profile).compile(schema);
        expect(validate('ok')).toBe(true); expect(validate(1)).toBe(false); expect(schema).toEqual(before);
        expect(() => create(profile).compile({ ...schema, definitions: { other: { $id: 'nested/value', type: 'number' } } })).toThrow();
      }
      const data = { $id: 'unused', type: 'not-a-schema', pattern: '[', nullable: true, $ref: '#/missing' };
      const schema = { contentSchema: data, const: data }, before = structuredClone(schema);
      expect(create(profile).compile(schema)(structuredClone(data))).toBe(true); expect(schema).toEqual(before);
    }
    // Collection extensions are ignored as keywords, but remain pointer targets.
    const schema = { appSchema: { type: 'string', nullable: true }, $ref: '#/appSchema' };
    expect(create('collection').compile(schema)(null)).toBe(true);
  });
  it.each([nodeCompiler, browserCompiler])('preserves strict helper admission while retaining permissive collections for %s', create => {
    const schemas = [
      { type: 'object', properties: { a: { type: 'string' } }, patternProperties: { '^a': { type: 'string' } } },
      { type: 'array', items: { type: 'string' }, additionalItems: false },
      { type: 'array', additionalItems: { type: 'number' } },
    ];
    for (const schema of schemas) {
      expect(() => create('helper').compile(schema)).toThrow();
      expect(create('collection').compile(schema)(schema.type === 'array' ? ['ok'] : { a: 'ok' })).toBe(true);
    }
    // An all-annotation pattern map is skipped before the native overlap check.
    expect(create('helper').compile({ properties: { a: {} }, patternProperties: { '^a': { title: 'metadata' } } })({ a: 1 })).toBe(true);
    expect(() => create('helper').compile({ properties: { a: {} }, patternProperties: { '^a': {}, '^b': { type: 'number' } } })).toThrow();
  });
  it.each([nodeCompiler, browserCompiler])('ignores inactive branches but still admits explicitly referenced targets for %s', create => {
    for (const profile of ['helper', 'collection'] as const) {
      for (const branch of [true, {}, { title: 'metadata only' }]) for (const condition of [{ $ref: '#/missing' }, { pattern: '[' }]) {
        const schema = { if: condition, then: branch }, before = structuredClone(schema);
        expect(create(profile).compile(schema)('ok')).toBe(true); expect(schema).toEqual(before);
      }
      expect(() => create(profile).compile({ if: { $ref: '#/missing' }, then: false })).toThrow();
      expect(() => create(profile).compile({ if: { $ref: '#/missing' }, then: {}, $ref: '#/if' })).toThrow();
      expect(() => create(profile).compile({ if: { type: 'number', minLength: 'bad' }, then: {} })).toThrow();
    }
    expect(create('collection').compile({ type: 'array', items: { type: 'string' }, additionalItems: { $ref: '#/missing' } })(['ok'])).toBe(true);
    expect(create('collection').compile({ then: { $ref: '#/missing' } })('ok')).toBe(true);
  });
  it.each([nodeCompiler, browserCompiler])('processes referenced annotation descendants and preserves unreferenced data for %s', create => {
    for (const annotation of ['default', 'const', 'examples']) {
      const target = { type: 'object', properties: { value: { type: 'string', nullable: true } } };
      const schema = { [annotation]: annotation === 'examples' ? [target] : target,
        $ref: `#/${annotation}${annotation === 'examples' ? '/0' : ''}` };
      // const is also a validation constraint; reference it from an unused
      // definition so its data payload does not constrain the root instance.
      const root = annotation === 'const' ? { definitions: { carrier: schema }, $ref: '#/definitions/carrier/const' } : schema;
      const before = structuredClone(root), validate = create('helper').compile(root);
      expect(validate({ value: null })).toBe(true); expect(validate({ value: 1 })).toBe(false);
      expect(root).toEqual(before);
    }
    for (const child of [{ $ref: '#/missing' }, { type: 'string', appKeyword: true }, { type: 'string', format: 'unknown-format' }]) {
      expect(() => create('helper').compile({ $ref: '#/default', default: { properties: { value: child } } })).toThrow();
    }
    const data = { type: 'not-a-schema', pattern: '[', $ref: '#/missing', nullable: 'not-a-boolean' };
    expect(create('helper').compile({ type: 'string', default: data })('ok')).toBe(true);
    expect(create('helper').compile({ const: data })(data)).toBe(true);
    expect(create('collection').compile({ $ref: '#/default', default: { type: 'number', divisibleBy: 2 } })(3)).toBe(true);
    for (const key of ['const', 'enum']) {
      const target = { type: 'object', properties: { a: { type: 'string', nullable: true } } };
      const schema = key === 'const' ? { const: target, $ref: '#/const' } : { enum: [target], $ref: '#/enum/0' };
      const before = structuredClone(schema), validate = create('helper').compile(schema);
      expect(validate(structuredClone(target))).toBe(true); expect(schema).toEqual(before);
    }
  });
  it.each([nodeCompiler, browserCompiler])('retains lexical IDs inside referenced annotation trees for %s', create => {
    const schema = { $id: 'https://fixture.invalid/area/root', $ref: '#/default',
      definitions: { value: { type: 'string', nullable: true } }, default: {
      $id: 'nested/child', properties: { value: { $ref: '../root#/definitions/value' } },
    } };
    const validate = create('helper').compile(schema);
    expect(validate({ value: null })).toBe(true); expect(validate({ value: 1 })).toBe(false);
    expect(() => create('helper').compile({ $ref: '#/default', default: {
      $id: 'https://fixture.invalid/unregistered', definitions: { value: { type: 'string' } },
      properties: { value: { $ref: '#/definitions/value' } },
    } })).toThrow();
  });
  it.each([nodeCompiler, browserCompiler])('does not register empty IDs as duplicate roots for %s', create => {
    for (const profile of ['helper', 'collection'] as const) for (const id of ['', '#', '#/']) {
      const compiler = create(profile), schema = { $id: id, type: 'string' };
      const first = compiler.compile(schema), second = compiler.compile({ $id: id, type: 'number' });
      expect(first('ok')).toBe(true); expect(second(1)).toBe(true);
      expect(compiler.compile(schema)).toBe(first);
    }
  });
  it.each([nodeCompiler, browserCompiler])('resolves URNs and nested lexical scopes without mutating schemas for %s', create => {
    const body = { type: 'object', properties: { currency: { $ref: '#/definitions/currency' } },
      definitions: { currency: { type: 'string', enum: ['USD'] } }, required: ['currency'] };
    const nested = { $id: 'child', ...body };
    const schemas = [{ $id: 'urn:example:currency', ...body },
      ...['allOf', 'anyOf', 'oneOf'].map(key => ({ $id: 'https://fixture.invalid/root', [key]: [nested] })),
      { $id: 'https://fixture.invalid/root', not: { not: nested } },
      { $id: 'https://fixture.invalid/root', definitions: { nested }, allOf: [{ $ref: 'child' }] }];
    for (const profile of ['helper', 'collection'] as const) for (const schema of schemas) {
      const before = structuredClone(schema), validate = create(profile).compile(schema);
      expect(validate({ currency: 'USD' })).toBe(true);
      expect(validate({ currency: 1 })).toBe(false);
      expect(validate({ currency: 'EUR' })).toBe(false);
      expect(schema).toEqual(before);
    }
  });
  it.each([nodeCompiler, browserCompiler])('ignores collection extensions while preserving schema data and helper admission for %s', create => {
    for (const [schema, value] of [
      [{ type: 'number', divisibleBy: 2 }, 3], [{ type: 'string', disallow: 'string' }, 'valid'],
      [{ type: 'string', extends: { minLength: 10 } }, 'ok'],
      [{ type: 'object', properties: { extends: { type: 'string', disallow: 'string' } } }, { extends: 'ok' }],
      [{ allOf: [{ type: 'string', extends: { $ref: '#/missing' } }] }, 'ok'],
      [{ const: { extends: { minLength: 10 }, disallow: 'string', divisibleBy: 2 } }, { extends: { minLength: 10 }, disallow: 'string', divisibleBy: 2 }],
    ] as const) {
      const before = structuredClone(schema), validate = create('collection').compile(schema);
      expect(validate(value)).toBe(true); expect(schema).toEqual(before);
      if (!('const' in schema)) expect(() => create('helper').compile(schema)).toThrow();
    }
    const validation = create('collection').compile({ type: 'number', multipleOf: 2, divisibleBy: 3 });
    expect(validation(2)).toBe(true); expect(validation(3)).toBe(false);
  });
  it.each([nodeCompiler, browserCompiler])('keeps input/schema unchanged and independent local roots for %s', create => {
    const schema = { $id: 'https://fixture.invalid/root', type: 'object', properties: { constructor: {} }, additionalProperties: false };
    const before = structuredClone(schema), input = {}, primary = create('helper'), local = create('helper');
    const first = primary.compile(schema), second = local.compile({ ...schema });
    expect(first(input)).toBe(true); expect(second(input)).toBe(true);
    expect(Object.keys(input)).toEqual([]); expect(schema).toEqual(before);
    expect(() => primary.compile({ ...schema })).toThrow();
    expect(primary.compile(schema)).toBe(first);
  });
  it.each([nodeCompiler, browserCompiler])('rejects invalid schemas before data validation for %s', create => {
    for (const schema of [{ type: 'string', minLength: '1' }, { $ref: '#/missing' }, { type: 'string', format: 'unknown-format' }]) expect(() => create('helper').compile(schema)).toThrow();
  });
  it.each([nodeCompiler, browserCompiler])('preserves collection options and nullable helper semantics for %s', create => {
    const collection = create('collection').compile({ type: 'string', format: 'email' });
    expect(collection('not-an-email')).toBe(true);
    const helper = create('helper').compile({ type: 'string', nullable: true });
    expect(helper(null)).toBe(true); expect(helper(42)).toBe(false);
    expect(helper.errors?.[0]?.keyword).toBe('type');
  });
});
