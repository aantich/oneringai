// Runtime schemas accepted by the existing helper and collection-contract sites.
// Reuse this corpus when qualifying another implementation; AJV is the oracle.
const entry = (name, schema, values, profile = 'helper') => ({ name, schema, values, profile });
export const schemaCases = [
  entry('object admission and required fields', { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, [{ value: 'ok' }, {}, { value: 1 }, { value: 'ok', extra: true }]),
  entry('boolean subschemas', { type: 'object', properties: { rejected: false, accepted: true } }, [{}, { rejected: 1 }, { accepted: null }]),
  entry('nullable string', { type: 'string', nullable: true }, [null, 'ok', 1]),
  entry('nullable enum still constrains null', { type: 'string', nullable: true, enum: ['ok'] }, [null, 'ok', 'other']),
  entry('nullable false rejects null type', { type: 'null', nullable: false }, [null]),
  entry('nullable requires type', { nullable: true }, [null, 'ok']),
  entry('invalid keyword type', { type: 'string', minLength: '1' }, ['', 'ok']),
  entry('negative length', { type: 'string', minLength: -1 }, ['ok']),
  entry('invalid required keyword', { type: 'object', required: 'value' }, [{ value: 1 }]),
  entry('invalid schema type', { type: 'unknown' }, ['ok']),
  entry('invalid schema regex', { type: 'string', pattern: '[' }, ['ok']),
  entry('unknown helper keyword', { type: 'string', appKeyword: true }, ['ok']),
  entry('unknown collection keyword is ignored', { type: 'string', appKeyword: true }, ['ok'], 'collection'),
  entry('unknown helper format', { type: 'string', format: 'app-format' }, ['ok']),
  entry('collection format is not installed', { type: 'string', format: 'email' }, ['not-an-email', 'person@example.com'], 'collection'),
  entry('email format', { type: 'string', format: 'email' }, ['not-an-email', 'person@example.com', 'person@localhost']),
  entry('int32 numeric format', { type: 'number', format: 'int32' }, [0, 2147483647, 2147483648, 0.5]),
  entry('byte format', { type: 'string', format: 'byte' }, ['', 'YWJj', 'not base64!']),
  entry('UUID format', { type: 'string', format: 'uuid' }, ['00000000-0000-0000-0000-000000000000', 'urn:uuid:00000000-0000-0000-0000-000000000000', 'bad']),
  entry('leap dates', { type: 'string', format: 'date' }, ['2024-02-29', '2023-02-29']),
  entry('Unicode length', { type: 'string', maxLength: 1 }, ['x', '😀', 'xx']),
  entry('Unicode regex', { type: 'string', pattern: '^.$' }, ['x', '😀', 'xx']),
  entry('multipleOf floating semantics', { type: 'number', multipleOf: 0.1 }, [0.3, 0.2, 0.31]),
  entry('exclusive minimum', { type: 'number', exclusiveMinimum: 1 }, [1, 1.1]),
  entry('tuple with additionalItems', { type: 'array', items: [{ type: 'string' }, { type: 'number' }], additionalItems: false }, [[], ['ok'], ['ok', 1], ['ok', 1, true]]),
  entry('structural uniqueItems', { type: 'array', uniqueItems: true }, [[{ a: 1 }, { a: 2 }], [{ a: 1, b: 2 }, { b: 2, a: 1 }]]),
  entry('dependencies', { type: 'object', dependencies: { a: ['b'] } }, [{}, { a: 1 }, { a: 1, b: 2 }]),
  entry('conditional', { if: { type: 'number' }, then: { minimum: 10 }, else: { type: 'string' } }, [10, 1, 'ok', null]),
  entry('reference resolution', { definitions: { item: { type: 'string' } }, $ref: '#/definitions/item' }, ['ok', 1]),
  entry('reference siblings', { definitions: { item: { type: 'string' } }, $ref: '#/definitions/item', maxLength: 2 }, ['ok', 'too long', 1]),
  entry('unresolved reference', { $ref: '#/definitions/missing' }, ['ok']),
  entry('unresolved unselected reference', { type: 'object', properties: { optional: { $ref: '#/definitions/missing' } } }, [{}, { optional: 'ok' }]),
  entry('duplicate nested IDs', { $id: 'https://fixture.invalid/root', definitions: { a: { $id: 'duplicate', type: 'string' }, b: { $id: 'duplicate', type: 'number' } } }, ['ok']),
  entry('escaped JSON pointer', { definitions: { 'a/b~c': { type: 'number' } }, $ref: '#/definitions/a~1b~0c' }, [1, 'no']),
  entry('separate local validation roots', { $id: 'https://fixture.invalid/shared', type: 'string', minLength: 2 }, ['ok', 'x']),
  entry('second local root reusing schema ID', { $id: 'https://fixture.invalid/shared', type: 'string', maxLength: 2 }, ['ok', 'too long']),
  entry('unknown keyword in unused definition', { type: 'string', definitions: { unused: { appKeyword: true } } }, ['ok', 1]),
  entry('unknown format in unused definition', { type: 'string', definitions: { unused: { format: 'app-format' } } }, ['ok', 1]),
  entry('unresolved unused definition', { type: 'string', definitions: { unused: { $ref: '#/definitions/missing' } } }, ['ok', 1]),
  entry('invalid keyword in unused definition', { type: 'string', definitions: { unused: { minLength: '1' } } }, ['ok', 1]),
  entry('invalid keyword in unused $defs', { type: 'string', $defs: { unused: { minLength: '1' } } }, ['ok', 1]),
  entry('newer keyword ignored in collection', { type: 'array', contains: { type: 'number' }, minContains: 2 }, [[1], [1, 2], ['no']], 'collection'),
  entry('format minimum', { type: 'string', format: 'date', formatMinimum: '2025-01-01' }, ['2024-01-01', '2025-01-01', '2026-01-01']),
  entry('format exclusive minimum', { type: 'string', format: 'date', formatExclusiveMinimum: '2025-01-01' }, ['2024-01-01', '2025-01-01', '2026-01-01']),
  entry('invalid format limit without format', { type: 'string', formatMinimum: '2025-01-01' }, ['ok']),
  entry('orphan then', { type: 'string', then: { minLength: 1 } }, ['ok', '']),
  entry('orphan if', { if: { type: 'string' } }, ['ok', 1]),
  entry('custom patternProperties regex', { type: 'object', patternProperties: { '^.$': { type: 'number' } }, additionalProperties: false }, [{ '😀': 1 }, { '😀': 'no' }, { xx: 1 }]),
  entry('overflow parsed JSON number', { type: 'number' }, [JSON.parse('1e999'), 1, null]),
  entry('recursive local references', { definitions: { node: { type: 'object', properties: { child: { $ref: '#/definitions/node' } }, additionalProperties: false } }, $ref: '#/definitions/node' }, [{}, { child: {} }, { child: { other: 1 } }]),
  entry('own prototype-shaped keys', JSON.parse('{"type":"object","properties":{"constructor":{"type":"number"},"__proto__":{"type":"number"}},"additionalProperties":false}'), [JSON.parse('{"constructor":1,"__proto__":2}'), JSON.parse('{"constructor":"no"}'), { other: 1 }]),
  entry('prototype-shaped additional keys', { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false }, [JSON.parse('{"constructor":1}'), JSON.parse('{"__proto__":1}'), { toString: 1 }]),
  entry('nested identifier and local reference', { $id: 'https://fixture.invalid/root', definitions: { nested: { $id: 'nested', definitions: { value: { type: 'number' } }, $ref: '#/definitions/value' } }, $ref: 'nested' }, [1, 'no']),
  entry('nested identifier with supported allOf reference', { $id: 'https://fixture.invalid/root', definitions: { nested: { $id: 'nested', definitions: { value: { type: 'number' } }, allOf: [{ $ref: '#/definitions/value' }] } }, $ref: 'nested' }, [1, 'no']),
  entry('known newer metadata', { type: 'string', deprecated: true, contentSchema: { type: 'number' } }, ['ok', 1]),
  entry('invalid unknown collection child is ignored', { type: 'string', appSchema: { pattern: '[', $ref: '#/missing' } }, ['ok'], 'collection'),
  entry('empty required array', { type: 'object', required: [] }, [{}, { value: 1 }]),
  entry('propertyNames', { type: 'object', propertyNames: { pattern: '^a' } }, [{ a: 1 }, { b: 1 }]),
  entry('contains schema', { type: 'array', contains: { type: 'number' } }, [[], [1], ['no']]),
  entry('exclusive comparisons retain equality', { type: 'number', exclusiveMaximum: 2 }, [1, 2, 3]),
  entry('false additionalProperties through reference', { definitions: { closed: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false } }, $ref: '#/definitions/closed' }, [{ a: 'ok' }, { a: 'ok', b: 1 }]),
  entry('inherited property validation', { type: 'object', properties: { constructor: { type: 'string' } } }, [{}, { constructor: 'ok' }, { constructor: 1 }]),
  entry('inherited required admission', { type: 'object', required: ['constructor'] }, [{}, { constructor: 'ok' }, { constructor: undefined }]),
  entry('no mutation through optional inherited property', { type: 'object', properties: { constructor: {} } }, [{}, { constructor: 'ok' }]),
];

// Check schema admission separately from whether any particular output exercises
// the invalid keyword. An invalid schema must fail before the provider call.
for (const [keyword, value] of Object.entries({
  type: 1, enum: [], const: undefined, minimum: '1', maximum: null,
  exclusiveMinimum: true, exclusiveMaximum: false, multipleOf: 0,
  maxLength: -1, minLength: 0.5, pattern: 1, maxItems: -1, minItems: '1',
  uniqueItems: 'yes', maxProperties: -1, minProperties: 1.5,
  required: ['a', 'a'], properties: [], patternProperties: [],
  additionalProperties: null, items: 1, additionalItems: [], contains: 1,
  dependencies: { a: [1] }, allOf: [], anyOf: [1], oneOf: {}, not: 1,
  propertyNames: 1, if: 1, then: 1, else: 1,
  title: 1, description: 1, readOnly: 'yes', writeOnly: 'no', examples: 1,
  $id: 1, $ref: 1, $comment: 1, definitions: [], $defs: [],
  nullable: 1, format: 1, formatMaximum: 1,
})) {
  if (value === undefined) continue;
  schemaCases.push(entry(`admission keyword ${keyword}`, { [keyword]: value }, [null, {}, 'ok', 1]));
}

// Lexical reference scopes and ignored collection extensions found in review.
for (const profile of ['helper', 'collection']) {
  const body = { type: 'object', properties: { currency: { $ref: '#/definitions/currency' } },
    definitions: { currency: { type: 'string', enum: ['USD'] } }, required: ['currency'] };
  const values = [{ currency: 'USD' }, { currency: 'EUR' }, { currency: 1 }, {}];
  schemaCases.push(entry(`${profile} URN root local fragment`, { $id: 'urn:example:currency', ...body }, values, profile));
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'not']) {
    const nested = { $id: 'nested', ...body };
    const schema = keyword === 'not' ? { not: { not: nested } } : { [keyword]: [nested] };
    schemaCases.push(entry(`${profile} lexical ID under ${keyword}`, { $id: 'https://fixture.invalid/root', ...schema }, values, profile));
  }
  schemaCases.push(entry(`${profile} nested ID reference and sibling`, { $id: 'https://fixture.invalid/root',
    definitions: { nested: { $id: 'child', ...body } }, allOf: [{ $ref: 'child', additionalProperties: true }] }, values, profile));
  for (const [keyword, value, type, input] of [['divisibleBy', 2, 'number', 3], ['disallow', 'string', 'string', 'valid'], ['extends', { minLength: 10 }, 'string', 'ok']]) {
    schemaCases.push(entry(`${profile} legacy ${keyword} keyword`, { type, [keyword]: value }, [input], profile));
    schemaCases.push(entry(`${profile} nested legacy ${keyword} keyword`, { type: 'object', properties: { [keyword]: { type, [keyword]: value } } }, [{ [keyword]: input }], profile));
  }
}
schemaCases.push(entry('collection unknown keyword data stays exact', { const: { extends: { minLength: 10 }, disallow: 'string', divisibleBy: 2 } }, [{ extends: { minLength: 10 }, disallow: 'string', divisibleBy: 2 }, {}], 'collection'));
schemaCases.push(entry('collection ignored extends cannot resolve refs', { type: 'string', extends: { $ref: '#/missing' } }, ['ok'], 'collection'));

// Referenced annotations become schemas only when reached through a reference.
for (const profile of ['helper', 'collection']) {
  const target = { type: 'object', properties: { value: { type: 'string', nullable: true } } };
  const values = [{ value: null }, { value: 'ok' }, { value: 1 }];
  schemaCases.push(entry(`${profile} default reference descendants`, { $ref: '#/default', default: target }, values, profile));
  schemaCases.push(entry(`${profile} examples reference descendants`, { $ref: '#/examples/0', examples: [target] }, values, profile));
  schemaCases.push(entry(`${profile} const reference descendants`, { $ref: '#/definitions/carrier/const', definitions: { carrier: { const: target } } }, values, profile));
  for (const [name, child] of [['missing reference', { $ref: '#/missing' }], ['unknown keyword', { type: 'string', appKeyword: true }], ['legacy extension', { type: 'number', divisibleBy: 2 }]]) {
    schemaCases.push(entry(`${profile} annotation ${name}`, { $ref: '#/default', default: { properties: { value: child } } }, values, profile));
  }
  schemaCases.push(entry(`${profile} unused annotation data`, { type: 'string', default: { type: 'not-a-schema', pattern: '[', nullable: 'bad', $ref: '#/missing' } }, ['ok', 1], profile));
}
for (const key of ['const', 'enum']) {
  const target = { type: 'object', properties: { value: { type: 'string', nullable: true } } };
  const schema = key === 'const' ? { const: target, $ref: '#/const' } : { enum: [target], $ref: '#/enum/0' };
  schemaCases.push(entry(`referenced ${key} stays exact literal data`, schema, [structuredClone(target), {}, { value: null }]));
}

// beta.2: resource discovery, strict admission and inactive keyword applicability.
for (const profile of ['helper', 'collection']) {
  for (const id of ['#/', 'https://fixture.invalid/root#/', 'urn:example:root#/']) {
    schemaCases.push(entry(`${profile} normalized root ${id}`, { $id: id, definitions: { value: { type: 'string' } }, $ref: '#/definitions/value' }, ['ok', 1], profile));
  }
  const metadata = { $id: 'https://fixture.invalid/area/root', contentSchema: { $id: 'nested/value', type: 'string' }, $ref: 'nested/value' };
  schemaCases.push(entry(`${profile} metadata resource`, metadata, ['ok', 1], profile));
  schemaCases.push(entry(`${profile} duplicate metadata resource`, { ...metadata, definitions: { other: { $id: 'nested/value', type: 'number' } } }, ['ok', 1], profile));
  const data = { $id: 'unused', type: 'not-a-schema', pattern: '[', nullable: true, $ref: '#/missing' };
  schemaCases.push(entry(`${profile} unused metadata stays literal`, { contentSchema: data, const: data }, [structuredClone(data), {}], profile));
  schemaCases.push(entry(`${profile} strict pattern overlap`, { properties: { a: { type: 'string' } }, patternProperties: { '^a': { type: 'string' } } }, [{ a: 'ok' }, { a: 1 }], profile));
  schemaCases.push(entry(`${profile} non-tuple additionalItems`, { type: 'array', items: { type: 'string' }, additionalItems: false }, [['ok'], [1]], profile));
  for (const [name, condition, branch] of [['ref', { $ref: '#/missing' }, {}], ['regex', { pattern: '[' }, true], ['metadata', { $ref: '#/missing' }, { title: 'no constraints' }]]) {
    schemaCases.push(entry(`${profile} inactive conditional ${name}`, { if: condition, then: branch }, ['ok', 1], profile));
  }
  schemaCases.push(entry(`${profile} active false conditional branch`, { if: { $ref: '#/missing' }, then: false }, ['ok'], profile));
  schemaCases.push(entry(`${profile} ignored condition explicitly referenced`, { if: { $ref: '#/missing' }, then: {}, $ref: '#/if' }, ['ok'], profile));
  schemaCases.push(entry(`${profile} ignored additionalItems ref`, { type: 'array', items: { type: 'string' }, additionalItems: { $ref: '#/missing' } }, [['ok']], profile));
  schemaCases.push(entry(`${profile} orphan then ref`, { then: { $ref: '#/missing' } }, ['ok'], profile));
  schemaCases.push(entry(`${profile} annotation-only patterns`, { properties: { a: {} }, patternProperties: { '^a': { title: 'metadata' } } }, [{ a: 1 }], profile));
  schemaCases.push(entry(`${profile} mixed active patterns`, { properties: { a: {} }, patternProperties: { '^a': {}, '^b': { type: 'number' } } }, [{ a: 1 }, { b: 'bad' }], profile));
}
schemaCases.push(entry('collection extension resource ID', { $id: 'https://fixture.invalid/root', appSchema: { $id: 'value', type: 'string' }, $ref: 'value' }, ['ok', 1], 'collection'));
schemaCases.push(entry('collection extension pointer target', { appSchema: { type: 'string', nullable: true }, $ref: '#/appSchema' }, [null, 'ok', 1], 'collection'));
