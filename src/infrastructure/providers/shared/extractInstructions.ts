import type { InputItem } from '../../../domain/entities/Message.js';
import { MessageRole } from '../../../domain/entities/Message.js';
import { ContentType } from '../../../domain/entities/Content.js';
import { InvalidConfigError } from '../../../domain/errors/AIErrors.js';

/**
 * Lower canonical developer messages into a provider's dedicated instruction
 * field. User data, tool results and opaque continuation items are never lifted.
 * Preserve top-level instructions first, then developer text in input order.
 * Neither the caller's input nor its content blocks are modified.
 */
export function extractInstructions(
  input: string | InputItem[],
  instructions?: string,
): { input: string | InputItem[]; instructions?: string } {
  if (typeof input === 'string') return { input, instructions };
  const parts = instructions ? [instructions] : [];
  const remaining: InputItem[] = [];
  let extracted = false;
  for (const item of input) {
    if (item.type !== 'message' || item.role !== MessageRole.DEVELOPER) {
      remaining.push(item);
      continue;
    }
    extracted = true;
    for (const block of item.content) {
      if (block.type !== ContentType.INPUT_TEXT && block.type !== ContentType.OUTPUT_TEXT) {
        throw new InvalidConfigError(`Developer instructions support text blocks only for this provider; received '${block.type}'`);
      }
      if (typeof block.text !== 'string') {
        throw new InvalidConfigError('Developer instruction text must be a string');
      }
      if (block.text) parts.push(block.text);
    }
  }
  return {
    input: extracted ? remaining : input,
    instructions: extracted && parts.length ? parts.join('\n\n') : instructions,
  };
}
