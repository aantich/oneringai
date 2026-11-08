// Private Node facilities. The browser build selects primitives.browser.ts.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export { createHash, createHmac, randomUUID } from 'node:crypto';
export { isDeepStrictEqual } from 'node:util';

export const byteLength = (text: string, encoding: BufferEncoding = 'utf8'): number => Buffer.byteLength(text, encoding);
export const encodeUTF8 = (text: string): Uint8Array => Buffer.from(text, 'utf8');
export const decodeUTF8 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');
export const encodeBase64 = (bytes: Uint8Array, url = false): string => Buffer.from(bytes).toString(url ? 'base64url' : 'base64');
export const decodeBase64 = (text: string): Uint8Array => Buffer.from(text, 'base64');
export const randomHex = (length: number): string => randomBytes(length).toString('hex');
export const randomKey = (length: number): Uint8Array => randomBytes(length);
export function sealGCM(key: Uint8Array, iv: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): { ciphertext: Uint8Array; tag: Uint8Array } {
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
  return { ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]), tag: cipher.getAuthTag() };
}
export function openGCM(key: Uint8Array, iv: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): Uint8Array {
  const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]);
}
