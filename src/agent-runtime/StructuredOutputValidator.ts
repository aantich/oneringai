import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { parseStructuredOutput } from '../core/StructuredOutput.js';
import { AgentStructuredOutputError } from './errors.js';
import type { JsonValue, RuntimeResponseFormat } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });

export function parseAndValidateStructuredOutput(
  outputText: string,
  format: RuntimeResponseFormat,
  sanitize?: (value: JsonValue) => JsonValue,
): JsonValue | undefined {
  if (format.type === 'text') return undefined;

  const parsed = parseStructuredOutput(outputText, {
    type: 'json_schema',
    name: format.name,
    schema: format.schema,
    strict: format.strict,
  });
  if (!parsed.ok) {
    throw new AgentStructuredOutputError(`Agent output is not valid JSON: ${parsed.error.message}`, parsed.error);
  }

  let validate: ValidateFunction;
  try {
    validate = ajv.compile(format.schema);
  } catch (error) {
    throw new AgentStructuredOutputError(
      `Invalid runtime JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined,
    );
  }

  const value = sanitize ? sanitize(parsed.value as JsonValue) : parsed.value;
  if (!validate(value)) {
    throw new AgentStructuredOutputError(formatValidationErrors(validate.errors));
  }
  return value as JsonValue;
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  const details = (errors ?? [])
    .slice(0, 5)
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'does not match the schema'}`)
    .join('; ');
  return `Agent output does not conform to the requested JSON Schema${details ? `: ${details}` : ''}`;
}
