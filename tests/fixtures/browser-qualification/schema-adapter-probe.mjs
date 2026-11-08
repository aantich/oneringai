// Reuse the production adapter: qualification and delivery must not drift.
import { createSchemaCompiler } from '../../../src/infrastructure/runtime/schemaCompiler.browser.ts';
export const compileAdapterProbe = (schema, profile) => createSchemaCompiler(profile).compile(schema);
