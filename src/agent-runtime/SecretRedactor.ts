import { toJsonValue } from './internal.js';
import type { JsonValue } from './types.js';

function secretForms(secrets: readonly string[]): string[] {
  return [...new Set(secrets.filter(Boolean).flatMap(secret => [secret, JSON.stringify(secret).slice(1, -1)]))]
    .sort((left, right) => right.length - left.length);
}

export function createRedactor(secrets: readonly string[]): (text: string) => string {
  const forms = secretForms(secrets);
  return text => forms.reduce((safe, secret) => safe.split(secret).join('[REDACTED]'), text);
}

/** Redact decoded JSON strings/keys without corrupting JSON escaping. */
export function redactJson(value: unknown, redact: (text: string) => string): JsonValue {
  const converted = toJsonValue(value);
  if (typeof converted === 'string') return redact(converted);
  if (Array.isArray(converted)) return converted.map(item => redactJson(item, redact));
  if (converted && typeof converted === 'object') return Object.fromEntries(Object.entries(converted)
    .map(([key, item]) => [redact(key), redactJson(item, redact)]));
  return converted;
}

/** Keep only a possible secret prefix between chunks. A truncated prefix is withheld on finish. */
export class StreamingSecretRedactor {
  private buffer = '';
  private readonly secrets: string[];
  constructor(secrets: readonly string[]) { this.secrets = secretForms(secrets); }
  push(chunk: string): string { this.buffer += chunk; return this.drain(false); }
  finish(): string { return this.drain(true); }
  private drain(final: boolean): string {
    let output = '';
    while (this.buffer) {
      const complete = this.secrets.find(secret => this.buffer.startsWith(secret));
      if (complete) { output += '[REDACTED]'; this.buffer = this.buffer.slice(complete.length); continue; }
      const partial = this.secrets.some(secret => secret.startsWith(this.buffer));
      if (partial && !final) break;
      if (partial) { output += '[REDACTED]'; this.buffer = ''; break; }
      output += this.buffer[0]; this.buffer = this.buffer.slice(1);
    }
    return output;
  }
}
