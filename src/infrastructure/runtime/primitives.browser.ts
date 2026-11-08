import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { gcm } from '@noble/ciphers/aes.js';
import comparisons from 'assert/build/internal/util/comparisons.js';

const encoder = new TextEncoder();
// Buffer.toString('utf8') retains a leading BOM; TextDecoder strips it by default.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
export const encodeUTF8 = (text: string): Uint8Array => encoder.encode(text);
export const decodeUTF8 = (bytes: Uint8Array): string => decoder.decode(bytes);
export const byteLength = (text: string, _encoding?: 'utf8' | 'utf-8'): number => encodeUTF8(text).length;
export const randomUUID = (): string => globalThis.crypto.randomUUID();
export const isDeepStrictEqual: (a: unknown, b: unknown) => boolean = comparisons.isDeepStrictEqual;
export function encodeBase64(bytes: Uint8Array, url = false): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const result = btoa(text);
  return url ? result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : result;
}
export function decodeBase64(text: string): Uint8Array {
  // Match Buffer's tolerant decoding. Protocols still validate their envelopes.
  let clean = text.split('=')[0]!.replace(/[^A-Za-z0-9+/_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  clean += '='.repeat((4 - clean.length % 4) % 4);
  return Uint8Array.from(atob(clean), value => value.charCodeAt(0));
}
const hex = (bytes: Uint8Array): string => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
interface Digest { update(value: string | Uint8Array): Digest; digest(encoding: 'hex' | 'base64url' | 'base64'): string }
function digestAdapter(state: ReturnType<typeof sha256.create> | ReturnType<typeof hmac.create>): Digest {
  return {
    update(value) { state.update(typeof value === 'string' ? encodeUTF8(value) : value); return this; },
    digest(encoding) { const bytes = state.digest(); return encoding === 'hex' ? hex(bytes) : encodeBase64(bytes, encoding === 'base64url'); },
  };
}
export function createHash(algorithm: string): Digest {
  if (algorithm !== 'sha256') throw new Error(`Unsupported internal digest: ${algorithm}`);
  return digestAdapter(sha256.create());
}
export function createHmac(algorithm: string, key: Uint8Array): Digest {
  if (algorithm !== 'sha256') throw new Error(`Unsupported internal MAC: ${algorithm}`);
  return digestAdapter(hmac.create(sha256, key));
}
export function randomKey(length: number): Uint8Array { return globalThis.crypto.getRandomValues(new Uint8Array(length)); }
export const randomHex = (length: number): string => hex(randomKey(length));
export function sealGCM(key: Uint8Array, iv: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): { ciphertext: Uint8Array; tag: Uint8Array } {
  const result = gcm(key, iv, aad).encrypt(plaintext);
  return { ciphertext: result.subarray(0, -16), tag: result.subarray(-16) };
}
export function openGCM(key: Uint8Array, iv: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(ciphertext.length + tag.length); bytes.set(ciphertext); bytes.set(tag, ciphertext.length);
  return gcm(key, iv, aad).decrypt(bytes);
}
