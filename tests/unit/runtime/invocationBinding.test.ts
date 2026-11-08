import { describe, expect, it } from 'vitest';
import { ambientInvocation, explicitInvocation, getInvocation, withInvocation } from '../../../src/core/model-execution/invocationBinding.browser.js';
import type { InvocationState } from '../../../src/core/model-execution/invocationTypes.js';

const deferred = (): { promise: Promise<void>; resolve(): void } => {
  let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
};
const state = (signal = new AbortController().signal): InvocationState => ({ signal,
  beginTransport: () => { throw new Error('No transport in binding ownership fixture'); }, endTransport: () => undefined });

describe('explicit browser invocation ownership', () => {
  it('keeps concurrent owners across awaits without an ambient slot or SDK signal lookup', async () => {
    const a = state(), b = state(), gateA = deferred(), gateB = deferred();
    const left = withInvocation(a, async () => {
      await gateA.promise; expect(explicitInvocation(a.signal)).toBe(a); expect(explicitInvocation(b.signal)).toBe(b);
      expect(explicitInvocation(AbortSignal.any([a.signal]))).toBeUndefined();
    });
    const right = withInvocation(b, async () => { await gateB.promise; expect(getInvocation(b.signal)).toBe(b); });
    expect(ambientInvocation()).toBeUndefined(); expect(getInvocation()).toBeUndefined();
    gateA.resolve(); await left;
    expect(getInvocation(a.signal)).toBeUndefined(); expect(getInvocation(b.signal)).toBe(b);
    gateB.resolve(); await right; expect(getInvocation(b.signal)).toBeUndefined();
  });
  it('retains the outer owner while nested iterator pulls settle', async () => {
    const owner = state(), outer = deferred(), inner = deferred();
    const operation = withInvocation(owner, async () => { await outer.promise; });
    const pull = withInvocation(owner, async () => { await inner.promise; });
    inner.resolve(); await pull; expect(getInvocation(owner.signal)).toBe(owner);
    outer.resolve(); await operation; expect(getInvocation(owner.signal)).toBeUndefined();
  });
  it('cleans synchronous errors and retains cancelled late work until it settles', async () => {
    const failed = state(); expect(() => withInvocation(failed, () => { throw new Error('fixture'); })).toThrow('fixture');
    expect(getInvocation(failed.signal)).toBeUndefined();
    const controller = new AbortController(), late = state(controller.signal), gate = deferred();
    const work = withInvocation(late, async () => { await gate.promise; });
    controller.abort(); expect(getInvocation(late.signal)).toBe(late);
    gate.resolve(); await work; expect(getInvocation(late.signal)).toBeUndefined();
  });
});
