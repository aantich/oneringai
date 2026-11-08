import { describe, expect, it } from 'vitest';
import * as native from '../../../src/infrastructure/runtime/primitives.js';
import * as browser from '../../../src/infrastructure/runtime/primitives.browser.js';

describe('private browser primitives against native Node operations', () => {
  it.each([[239, 187, 191, 97], [239, 187, 191], [97, 239, 187, 191], [255, 97], [237, 160, 128], [226, 130]])('preserves BOM and malformed UTF-8 bytes %j', vector => {
    const bytes = new Uint8Array(vector);
    expect(browser.decodeUTF8(bytes)).toBe(native.decodeUTF8(bytes));
  });
  it.each(['', 'ordinary', '😀 café', '\ud800', '\udc00', '\u0000\uffff'])('preserves bytes, digests, chained hashes and authenticated encryption for %j', text => {
    const bytes = native.encodeUTF8(text), key = new Uint8Array(32).fill(19), iv = new Uint8Array(12).fill(7);
    const aad = native.encodeUTF8('oneringai-collections-v1');
    expect(browser.encodeUTF8(text)).toEqual(new Uint8Array(bytes));
    expect(browser.byteLength(text)).toBe(native.byteLength(text));
    expect(browser.decodeUTF8(bytes)).toBe(native.decodeUTF8(bytes));
    for (const encoding of ['hex', 'base64', 'base64url'] as const) {
      expect(browser.createHash('sha256').update('prefix\0').update(text).digest(encoding)).toBe(native.createHash('sha256').update('prefix\0').update(text).digest(encoding));
      expect(browser.createHmac('sha256', key).update(text).digest(encoding)).toBe(native.createHmac('sha256', key).update(text).digest(encoding));
    }
    const left = native.sealGCM(key, iv, aad, bytes), right = browser.sealGCM(key, iv, aad, bytes);
    expect(right.ciphertext).toEqual(new Uint8Array(left.ciphertext)); expect(right.tag).toEqual(new Uint8Array(left.tag));
    expect(browser.openGCM(key, iv, aad, left.ciphertext, left.tag)).toEqual(new Uint8Array(bytes));
    expect(new Uint8Array(native.openGCM(key, iv, aad, right.ciphertext, right.tag))).toEqual(new Uint8Array(bytes));
    const damaged = new Uint8Array(right.tag); damaged[0] = damaged[0]! ^ 1;
    expect(() => browser.openGCM(key, iv, aad, right.ciphertext, damaged)).toThrow();
  });
  it.each(['', 'YQ', 'YQ==', 'Y Q==\n', '-_8', '+/8=', 'a', 'abcde', 'ab!cd', 'YQ=ignored'])('matches tolerant base64 decoding for %j', encoded => {
    expect(browser.decodeBase64(encoded)).toEqual(new Uint8Array(native.decodeBase64(encoded)));
    const bytes = native.decodeBase64(encoded);
    expect(browser.encodeBase64(bytes)).toBe(native.encodeBase64(bytes));
    expect(browser.encodeBase64(bytes, true)).toBe(native.encodeBase64(bytes, true));
  });
  it('preserves rich comparisons used by context/evidence guards', () => {
    const cycle = (): Record<string, unknown> => { const item: Record<string, unknown> = { value: 1 }; item.self = item; return item; };
    const symbol = Symbol('owned');
    for (const [left, right] of [
      [{ a: 1, b: 2 }, { b: 2, a: 1 }], [{ a: -0 }, { a: 0 }], [{ a: NaN }, { a: NaN }],
      [new Array(1), [undefined]], [{ [symbol]: 1 }, { [symbol]: 2 }],
      [new Date(12), new Date(12)], [new Uint8Array([1]), new Uint8Array([2])],
      [new Map([[{ a: 1 }, 2]]), new Map([[{ a: 1 }, 2]])],
      [new Set([1, 2]), new Set([2, 1])], [cycle(), cycle()],
    ]) expect(browser.isDeepStrictEqual(left, right)).toBe(native.isDeepStrictEqual(left, right));
  });
});
