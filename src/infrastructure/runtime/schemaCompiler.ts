import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import type { SchemaCompiler, SchemaProfile, SchemaIssue } from './schemaTypes.js';
/** Preserve the existing two AJV configurations and their caller-owned lifetimes. */
export function createSchemaCompiler(profile: SchemaProfile): SchemaCompiler {
  const ajv = new Ajv(profile === 'helper' ? { allErrors: true, strict: false, strictSchema: true } : { allErrors: false, strict: false });
  if (profile === 'helper') addFormats(ajv);
  return { compile: schema => ajv.compile(schema), errorsText: (errors?: SchemaIssue[] | null) => ajv.errorsText(errors as ErrorObject[] | null | undefined) };
}
