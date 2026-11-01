import type { AgentRunInput, RuntimeRunOptions, RuntimeSessionReference } from 'oneringai/agent-runtime';

export const runtimeHelp = [
  'Ordinary text starts a turn. Commands:',
  '/inspect /status /reference /save /stop /detach /resume [reference-json] /new /exit',
  '/run {"input":"task","options":{"requestId":"stable-id"}}',
  '/result <run-id>',
  '/observe {"runId":"run-id","afterSequence":123}',
  '/upload {"path":"input.txt","mediaType":"text/plain","name":"optional.txt"}',
  '/download {"reference":"scoped-artifact-reference","path":"answer.txt"}',
  '/delete [reference-json] — explicitly cancels/disposes and deletes owned resources',
  'Per-run model/reasoning/responseFormat/metadata use /run options; driver capabilities apply.',
  'Native context/routing/routine/helper/tool mutation commands require standard AMOS mode.',
].join('\n');

export function commandObject(text: string, allowed: readonly string[], usage: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`Expected JSON: ${usage}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Expected only documented fields: ${usage}`);
  return value as Record<string, unknown>;
}
export function runtimeReference(text: string): RuntimeSessionReference {
  const value = commandObject(text, ['version', 'id'], '{"version":1,"id":"session_..."}');
  if (value.version !== 1 || typeof value.id !== 'string' || !/^session_[a-zA-Z0-9-]+$/.test(value.id)) throw new Error('Expected a version 1 runtime session reference');
  return value as unknown as RuntimeSessionReference;
}
export function runtimeRun(text: string): { input: AgentRunInput; options: RuntimeRunOptions } {
  const value = commandObject(text, ['input', 'options'], '/run {"input":"task","options":{...}}');
  if (typeof value.input !== 'string') {
    const input = value.input as Record<string, unknown> | undefined;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['parts', 'metadata'].includes(key)) || !Array.isArray(input.parts) || input.parts.some(part => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return true;
      const fields = part as Record<string, unknown>;
      return fields.type === 'text' ? typeof fields.text !== 'string' || Object.keys(fields).some(key => !['type', 'text'].includes(key))
        : fields.type !== 'workspace-file' || typeof fields.path !== 'string' || (fields.mediaType !== undefined && typeof fields.mediaType !== 'string') || Object.keys(fields).some(key => !['type', 'path', 'mediaType'].includes(key));
    })) throw new Error('Run input must be text or documented text/workspace-file parts');
  }
  const options = value.options === undefined ? {} : value.options;
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['requestId', 'model', 'reasoning', 'responseFormat', 'metadata'].includes(key))) throw new Error('Run options allow only requestId, model, reasoning, responseFormat and metadata; scope and credentials belong to the host');
  return { input: value.input as AgentRunInput, options: options as RuntimeRunOptions };
}
