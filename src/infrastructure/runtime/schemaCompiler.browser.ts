// Private CSP-compatible runtime schema adapter. Admission metadata is generated.
import { Validator, ValidatorResult } from 'jsonschema';
import traverse from 'json-schema-traverse';
import { fullFormats as formatPredicates } from 'ajv-formats/dist/formats.js';
import uri from 'fast-uri';
import { normalizeId, resolveUrl } from 'ajv/dist/compile/resolve.js';
import helperMeta from './schemaMeta.helper.generated.cjs';
import collectionMeta from './schemaMeta.collection.generated.cjs';
import keywords from './schemaKeywords.generated.json';
import rules from './schemaRules.generated.json';
import type { SchemaCompiler, SchemaValidator, SchemaProfile } from './schemaTypes.js';
import type { Options, SchemaContext } from 'jsonschema';

const fullFormats = formatPredicates as Record<string, any>;
type Node = Record<string, any>;
type RuntimeValidator = Validator & { types: Record<string, (value: unknown) => boolean>; resolve(schema: Node, ref: string, context: unknown): { subschema: Node; switchSchema: string }; validateSchema(value: unknown, schema: Node, options: Options, context: SchemaContext): ValidatorResult };
type RuntimeContext = SchemaContext & { path: Array<string | number>; resolve(ref: string): string };
const known = new Set(keywords);
const base = 'https://oneringai.invalid/schema';
function compileInterpreted(input: object, profile: SchemaProfile): SchemaValidator {
  const meta = profile === 'helper' ? helperMeta : collectionMeta;
  const schema = structuredClone(input) as Node;
  if (!meta(schema)) throw new Error('Invalid JSON schema');
  schema.$id ??= base;
  const validator = new Validator() as RuntimeValidator;
  const identifiers = new Set<string>();
  const indexed = new Set<Node>();
  const scopes = new Map<Node, string>();
  const children = new Map<Node | undefined, Array<{ node: Node; keyword: string }>>();
  // AJV discovers resource IDs through all object keys (except traversal's data
  // exclusions). Discovery must not turn ignored metadata into active schemas.
  const resourceScopes = new Map<string | undefined, string>();
  traverse(schema, { allKeys: true }, (node, _pointer, _root, parentPointer) => {
    const parent = resourceScopes.get(parentPointer) ?? base;
    const scope = typeof node.$id === 'string' ? normalizeId(resolveUrl(uri, parent, node.$id)) : parent;
    resourceScopes.set(_pointer, scope);
    scopes.set(node, scope);
    if (typeof node.$id === 'string') {
      if (identifiers.has(scope)) throw new Error('Duplicate schema ID');
      identifiers.add(scope);
      validator.schemas[scope] = node;
    }
  });
  const indexTree = (root: Node, parentScope: string): void => {
    const contexts = new Map<string | undefined, string>();
    const pointers = new Map<string, Node>();
    traverse(root, (node, pointer, _root, parentPointer, parentKeyword) => {
      const parent = contexts.get(parentPointer) ?? parentScope;
      const scope = scopes.get(node) ?? (typeof node.$id === 'string' ? normalizeId(resolveUrl(uri, parent, node.$id)) : parent);
      contexts.set(pointer, scope);
      pointers.set(pointer, node);
      if (parentPointer !== undefined && parentKeyword !== 'definitions' && parentKeyword !== '$defs') {
        const parentNode = pointers.get(parentPointer);
        const list = children.get(parentNode) ?? []; list.push({ node, keyword: parentKeyword! }); children.set(parentNode, list);
      }
      indexed.add(node);
      scopes.set(node, scope);
    });
  };
  // jsonschema's scanner and child contexts use WHATWG URL resolution, which
  // rejects relative fragments on URNs. Reuse AJV's RFC 3986 resolver and the
  // already traversed schema scopes instead; no schema code generation/eval.
  indexTree(schema, base);
  const contextFor = (local: Node, options: Options, path: Array<string | number>, fallback: string): RuntimeContext => {
    const scope = scopes.get(local) ?? fallback;
    return {
      schema: local, options, path, base: scope, schemas: validator.schemas,
      propertyPath: 'instance' + path.map(key => `[${JSON.stringify(key)}]`).join(''),
      resolve: ref => resolveUrl(uri, scope, ref),
      makeChild: (child, key) => contextFor(child as Node, options, key === undefined ? path : [...path, key], scope),
    };
  };
  const validateSchema = validator.validateSchema.bind(validator);
  // Combinators and reference targets in the interpreter sometimes reuse the
  // parent's context. Restore the lexical scope on every schema entry.
  validator.validateSchema = (value, local, options, context) => validateSchema(value, local, options,
    contextFor(local, options, (context as RuntimeContext).path, context.base));
  // A JSON Pointer may enter annotations (default/examples/const) that are data
  // until referenced. Reuse the interpreter's pointer resolver to recover the
  // lexical parent scope, including IDs on ancestors, without validating data.
  const referenceParentScope = (ref: string): string => {
    const [document, fragment] = ref.split('#');
    let scope = scopes.get(validator.schemas[document!] as Node) ?? document!;
    let pointer = '';
    for (const part of fragment?.startsWith('/') ? fragment.slice(1).split('/').slice(0, -1) : []) {
      pointer += '/' + part;
      const ancestor = validator.resolve(schema, document + '#' + pointer, contextFor(schema, {}, [], base)).subschema;
      if (scopes.has(ancestor)) scope = scopes.get(ancestor)!;
      else if (!['properties', 'patternProperties', 'enum', 'dependencies', 'definitions'].includes(part)
        && typeof ancestor?.$id === 'string') scope = normalizeId(resolveUrl(uri, scope, ancestor.$id));
    }
    return scope;
  };
  const active = new Set<Node>();
  const validationKeywords = new Set(rules[profile]);
  const checkKeywords = (node: Node): void => {
    if (profile === 'helper' && Object.keys(node).some(key => !known.has(key))) throw new Error('Unknown schema keyword');
  };
  const alwaysValid = (node: Node | boolean): boolean => {
    if (typeof node === 'boolean') return node;
    checkKeywords(node);
    return !Object.keys(node).some(key => validationKeywords.has(key));
  };
  const inactiveConditionals = new Set<Node>();
  const references = new Map<Node, ReturnType<RuntimeValidator['resolve']>>();
  const visit = (node: Node): void => {
    if (active.has(node)) return;
    active.add(node);
    if (!meta(node)) throw new Error('Invalid active JSON schema');
    // The current AJV compiler rejects a nested ID that directly aliases its own
    // fragment (stack overflow). Preserve admission; the allOf form is supported.
    if (node !== schema && node.$id && node.$ref && uri.resolve(scopes.get(node)!, node.$ref).startsWith(scopes.get(node)! + '#')) throw new Error('Unsupported nested ID alias');
    if (node.$schema !== undefined && !['http://json-schema.org/draft-07/schema#', 'http://json-schema.org/draft-07/schema'].includes(node.$schema)) throw new Error('Unknown meta-schema');
    if (node.id !== undefined) throw new Error('Unsupported id keyword');
    if (profile === 'helper') {
      checkKeywords(node);
      if (node.format !== undefined && !Object.hasOwn(fullFormats, node.format)) throw new Error('Unknown format');
      if (node.if !== undefined && node.then === undefined && node.else === undefined
        || node.if === undefined && (node.then !== undefined || node.else !== undefined)) throw new Error('Orphan conditional');
      if (node.additionalItems !== undefined && !Array.isArray(node.items)) throw new Error('additionalItems requires tuple items');
      const patterns = Object.keys(node.patternProperties ?? {}).filter(key => key !== '__proto__');
      // AJV skips an entirely annotation-only pattern map before checking overlap.
      if (patterns.some(pattern => !alwaysValid(node.patternProperties[pattern]))) {
        for (const pattern of patterns) for (const property of Object.keys(node.properties ?? {})) {
          if (new RegExp(pattern).test(property)) throw new Error('Property matches patternProperties');
        }
      }
      for (const keyword of ['formatMinimum', 'formatMaximum', 'formatExclusiveMinimum', 'formatExclusiveMaximum']) {
        if (node[keyword] !== undefined && (typeof node[keyword] !== 'string' || typeof fullFormats[node.format]?.compare !== 'function')) throw new Error('Invalid format limit');
      }
    }
    const hasThen = node.then !== undefined && !alwaysValid(node.then);
    const hasElse = node.else !== undefined && !alwaysValid(node.else);
    if (!hasThen && !hasElse) inactiveConditionals.add(node);
    if (node.nullable !== undefined) {
      if (typeof node.nullable !== 'boolean' || node.type === undefined) throw new Error('Invalid nullable');
      const types = Array.isArray(node.type) ? node.type : [node.type];
      if (!node.nullable && types.includes('null')) throw new Error('Invalid nullable');
    }
    if (node.pattern !== undefined) new RegExp(node.pattern, 'u');
    for (const pattern of Object.keys(node.patternProperties ?? {})) new RegExp(pattern, 'u');
    if (node.$ref !== undefined) {
      const resolved = validator.resolve(node, node.$ref, contextFor(node, {}, [], base));
      references.set(node, resolved);
      if (!indexed.has(resolved.subschema)) indexTree(resolved.subschema, referenceParentScope(resolved.switchSchema));
      visit(resolved.subschema);
    }
    for (const child of children.get(node) ?? []) {
      if (child.keyword === 'additionalItems' && !Array.isArray(node.items)
        || child.keyword === 'if' && inactiveConditionals.has(node)
        || child.keyword === 'then' && (node.if === undefined || !hasThen)
        || child.keyword === 'else' && (node.if === undefined || !hasElse)) continue;
      visit(child.node);
    }
  };
  visit(schema);
  // A referenced const/enum payload can also constrain the instance literally.
  // Capture literals before normalizing any reached schema, so interpretation
  // never changes the data against which const/enum must compare.
  const literals = new Map<Node, Node>();
  for (const node of active) {
    const values: Node = {};
    for (const key of ['const', 'enum']) if (Object.hasOwn(node, key)) values[key] = structuredClone(node[key]);
    literals.set(node, values);
  }
  // Retain the original pointer locations and $id scope when AJV applies siblings.
  for (const node of active) {
    if (node.nullable) {
      const types = Array.isArray(node.type) ? node.type : [node.type];
      if (!types.includes('null')) node.type = [...types, 'null'];
    }
    if (node.properties || node.additionalProperties !== undefined) {
      node.properties = Object.assign(Object.create(null), node.properties);
      delete node.properties.__proto__;
    }
    // AJV strict:false ignores unknown collection keywords. The interpreter
    // implements older extensions (notably extends before its keyword hooks),
    // so remove these only from schema nodes in our detached copy. Data inside
    // const/enum/default and property-map names must remain untouched.
    if (profile === 'collection') for (const key of Object.keys(node)) if (!known.has(key)) delete node[key];
    if (node.$ref !== undefined && Object.keys(node).some(key => key !== '$ref')) {
      const reference = { $ref: node.$ref };
      scopes.set(reference, scopes.get(node)!);
      references.set(reference, references.get(node)!);
      node.allOf = [...node.allOf ?? [], reference];
      delete node.$ref;
    }
  }
  const failure = (instance: unknown, local: Node, options: Options, context: SchemaContext, keyword: string): ValidatorResult => {
    const result = new ValidatorResult(instance, local, options, context);
    result.addError({ name: keyword, argument: '', message: `must satisfy ${keyword}` });
    return result;
  };
  const attributes = validator.attributes as Record<string, (value: any, local: Node, options: Options, context: SchemaContext) => ValidatorResult | undefined>;
  // Keep compile-time targets even when an ignored collection keyword is removed.
  const resolveReference = validator.resolve.bind(validator);
  validator.resolve = (local, ref, context) => references.get(local) ?? resolveReference(local, ref, context);
  const validateIf = attributes.if!;
  attributes.if = (value, local, options, context) => inactiveConditionals.has(local) ? undefined : validateIf.call(validator, value, local, options, context);
  for (const keyword of ['const', 'enum']) {
    const original = attributes[keyword]!;
    attributes[keyword] = (value, local, options, context) => original.call(validator, value,
      { ...local, [keyword]: literals.get(local)![keyword] }, options, context);
  }
  // AJV inspects ordinary property access, including inherited values, without
  // assigning rewritten values back into the input. jsonschema's stock property
  // visitor can assign undefined to an inherited property even with no rewrite.
  attributes.properties = (value, local, options, context) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result = new ValidatorResult(value, local, options, context);
    for (const [key, child] of Object.entries(local.properties as Node)) {
      if (value[key] === undefined) continue;
      const nested = validator.validateSchema(value[key], child as Node, options, context.makeChild(child as Node, key));
      result.errors.push(...nested.errors);
    }
    return result;
  };
  attributes.required = (value, local, options, context) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result = new ValidatorResult(value, local, options, context);
    for (const key of local.required as string[]) if (value[key] === undefined) result.addError({ name: 'required', argument: key, message: `must have required property '${key}'` });
    return result;
  };
  // jsonschema's documented per-instance keyword hooks isolate adaptations.
  validator.types.number = value => typeof value === 'number';
  attributes.multipleOf = function (value, local, options, context) {
    if (typeof value !== 'number') return;
    const quotient = value / local.multipleOf;
    if (quotient !== Math.floor(quotient)) return failure(value, local, options, context, 'multipleOf');
    return undefined;
  };
  attributes.pattern = function (value, local, options, context) {
    if (typeof value === 'string' && !new RegExp(local.pattern, 'u').test(value)) return failure(value, local, options, context, 'pattern');
    return undefined;
  };
  for (const keyword of ['minLength', 'maxLength']) attributes[keyword] = function (value, local, options, context) {
    if (typeof value === 'string' && (keyword === 'minLength' ? [...value].length < local[keyword] : [...value].length > local[keyword])) return failure(value, local, options, context, keyword);
    return undefined;
  };
  attributes.format = function (value, local, options, context) {
    if (profile !== 'helper') return;
    const format = fullFormats[local.format];
    if (format === true) return;
    const type = format.type ?? 'string';
    if (typeof value !== type) return;
    const validate = format.validate ?? format;
    if (!(validate instanceof RegExp ? validate.test(value) : validate(value))) return failure(value, local, options, context, 'format');
    return undefined;
  };
  for (const keyword of ['formatMinimum', 'formatMaximum', 'formatExclusiveMinimum', 'formatExclusiveMaximum']) attributes[keyword] = function (value, local, options, context) {
    if (profile !== 'helper' || typeof value !== 'string') return;
    const compare = fullFormats[local.format]?.compare;
    if (!compare) return failure(value, local, options, context, keyword);
    const compared = compare(value, local[keyword]);
    const invalid = keyword === 'formatMinimum' ? compared < 0 : keyword === 'formatMaximum' ? compared > 0 : keyword === 'formatExclusiveMinimum' ? compared <= 0 : compared >= 0;
    if (invalid) return failure(value, local, options, context, keyword);
    return undefined;
  };
  const validate: SchemaValidator = (value: unknown): boolean => {
    const result = validator.validateSchema(value, schema, {}, contextFor(schema, {}, [], base));
    validate.errors = result.errors.map(error => ({
      instancePath: error.path.length ? '/' + error.path.map(key => String(key).replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '',
      keyword: error.name, message: error.message,
    }));
    if (profile === 'collection') validate.errors = validate.errors.slice(0, 1);
    return result.valid;
  };
  return validate;
}

/** One synchronous browser implementation; compiler lifetime belongs to its caller. */
export function createSchemaCompiler(profile: SchemaProfile): SchemaCompiler {
  const compiled = new WeakMap<object, SchemaValidator>();
  const ids = new Map<string, object>();
  return {
    compile(schema) {
      const cached = compiled.get(schema);
      if (cached) return cached;
      const id = typeof (schema as Node).$id === 'string' ? normalizeId((schema as Node).$id) || undefined : undefined;
      if (id !== undefined && ids.has(id)) throw new Error(`schema with key or id "${id}" already exists`);
      const validate = compileInterpreted(schema, profile);
      compiled.set(schema, validate);
      if (id !== undefined) ids.set(id, schema);
      return validate;
    },
    errorsText(errors) { return errors?.length ? errors.map(error => `data${error.instancePath} ${error.message ?? error.keyword}`).join(', ') : 'No errors'; },
  };
}
