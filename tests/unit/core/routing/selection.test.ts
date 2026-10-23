import { describe, expect, it, vi } from 'vitest';
import { copyRoutingConfig, hasProviderBoundState, restrictDataHandling, routingOptions, selectModelRoute } from '@/core/model-execution/routing.js';
import type { ModelRoutingConfig } from '@/core/model-execution/types.js';
import type { InputItem } from '@/domain/entities/Message.js';
const candidates = [
  { route: 'default', connector: 'primary', model: 'main', eligible: true, reasons: [] },
  { route: 'fast', connector: 'primary', model: 'fast', eligible: true, reasons: [] },
];
const signal = () => new AbortController().signal;
const config = (extra: Partial<ModelRoutingConfig> = {}): ModelRoutingConfig => ({ routes: { fast: { model: 'fast' } }, ...extra });

describe('bounded host model selection', () => {
  it.each([null, {}, { routes: [] }, { routes: { default: { model: 'x' } } }, { routes: { x: {} } },
    { routes: {}, select: 1 }, { routes: {}, timeoutMs: 0 }, { routes: {}, sticky: 'forever' },
    { routes: {}, fallback: 'missing' }, { routes: { x: { model: 'x', maxOutputTokens: 0 } } },
    { routes: { x: { model: 'x', priceBound: { inputPerMillion: -1, outputPerMillion: 1 } } } },
    { routes: { x: { model: 'x', dataHandling: { allowProviderTools: 'yes' } } } },
    { routes: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [String(i), { model: 'x' }])) },
  ])('rejects malformed configuration %j', value => expect(() => copyRoutingConfig(value as ModelRoutingConfig)).toThrow());
  it('copies nested profiles and keeps selector identity', () => {
    const select = () => 'fast'; const source = config({ select }); const copied = copyRoutingConfig(source)!;
    source.routes.fast!.model = 'mutated'; expect(copied.routes.fast!.model).toBe('fast'); expect(copied.select).toBe(select);
    expect(copyRoutingConfig(undefined)).toBeUndefined();
  });
  it.each([{ route: '' }, { route: 'x'.repeat(65) }, { phase: 'x'.repeat(129) }, { taskType: 1 }, { tenant: 'forged' }, []])('rejects malformed host hints %j', value => expect(() => routingOptions(value as never)).toThrow());
  it('uses default without selector and allows explicit named route', async () => {
    expect((await selectModelRoute(config(), undefined, candidates, undefined, signal(), 'one')).source).toBe('default');
    expect((await selectModelRoute(config(), { route: 'fast' }, candidates, undefined, signal(), 'two')).selectedRoute).toBe('fast');
    await expect(selectModelRoute(undefined, { route: 'fast' }, candidates, undefined, signal(), 'three')).rejects.toThrow('require');
  });
  it('freezes bounded selector metadata and excludes input, route option and authority', async () => {
    const select = vi.fn(context => {
      expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen(context.candidates[0])).toBe(true);
      expect(Object.isFrozen(context.hints)).toBe(true); expect(context.hints).toEqual({ phase: 'research', taskType: 'lookup' });
      expect(context).not.toHaveProperty('input'); expect(context).not.toHaveProperty('modelTask');
      return { route: 'fast', reason: 'measured lookup category' };
    });
    const result = await selectModelRoute(config({ select }), { phase: 'research', taskType: 'lookup' }, candidates, undefined, signal(), 'one');
    expect(result).toMatchObject({ executionId: 'one', selectedRoute: 'fast', source: 'policy', reason: 'measured lookup category' });
    expect(select).toHaveBeenCalledTimes(1);
  });
  it('explicit opt-out skips selector and sticky state', async () => {
    const select = vi.fn(() => 'fast');
    const result = await selectModelRoute(config({ select, sticky: 'phase' }), null, candidates, { route: 'fast', connector: 'primary', model: 'fast' }, signal(), 'one');
    expect(result).toMatchObject({ selectedRoute: 'default', source: 'disabled' }); expect(select).not.toHaveBeenCalled();
  });
  it('pins a phase but permits explicit escalation', async () => {
    const select = vi.fn(() => 'default'), prior = { route: 'fast', connector: 'primary', model: 'fast' };
    expect((await selectModelRoute(config({ select, sticky: 'phase' }), { phase: 'p' }, candidates, prior, signal(), 'one')).source).toBe('sticky');
    expect((await selectModelRoute(config({ select, sticky: 'phase' }), { route: 'default', phase: 'p' }, candidates, prior, signal(), 'two')).source).toBe('explicit');
    expect(select).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, { route: 'unknown' }, 'unknown', { route: 'fast', reason: 'x'.repeat(513) }, { route: 'fast', grant: 'admin' }])('does not hide invalid decisions %j with fallback', async value => {
    await expect(selectModelRoute(config({ select: () => value as never, fallback: 'default' }), undefined, candidates, undefined, signal(), 'one')).rejects.toThrow();
  });
  it('falls back once on selector exception', async () => {
    const select = vi.fn(() => { throw new Error('local lookup failed'); });
    expect(await selectModelRoute(config({ select }), undefined, candidates, undefined, signal(), 'one')).toMatchObject({ selectedRoute: 'default', source: 'fallback', selectorFailure: 'exception' });
    expect(select).toHaveBeenCalledTimes(1);
  });
  it('bounds a pending selector and ignores its late result', async () => {
    let late!: (route: string) => void; let seen!: AbortSignal;
    const result = await selectModelRoute(config({ timeoutMs: 5, select: context => { seen = context.signal; return new Promise(resolve => { late = resolve; }); } }), undefined, candidates, undefined, signal(), 'one');
    expect(result).toMatchObject({ source: 'fallback', selectorFailure: 'timeout', selectedRoute: 'default' });
    expect(seen.aborted).toBe(true); late('fast'); await Promise.resolve(); expect(result.selectedRoute).toBe('default');
  });
  it('never falls back on host cancellation', async () => {
    const controller = new AbortController(); const pending = selectModelRoute(config({ select: () => new Promise(() => {}) }), undefined, candidates, undefined, controller.signal, 'one');
    controller.abort(new Error('host stop')); await expect(pending).rejects.toThrow('host stop');
  });
  it('does not fall back when the task deadline expires while a synchronous selector runs', async () => {
    const deadline = Date.now() + 5;
    await expect(selectModelRoute(config({ timeoutMs: 100, select: () => { while (Date.now() <= deadline) { /* controlled local blocking fixture */ } return 'fast'; } }),
      undefined, candidates, undefined, signal(), 'one', deadline)).rejects.toThrow('deadline');
  });
  it('keeps inherited data prohibitions', () => {
    expect(restrictDataHandling(undefined)).toBeUndefined();
    expect(restrictDataHandling({ allowProviderTools: false }, { allowProviderTools: true, allowProviderCaching: true })).toEqual({ allowProviderTools: false, allowProviderCaching: true });
  });
  it.each([
    { type: 'reasoning', encrypted_content: 'opaque' }, { type: 'compaction', encrypted_content: 'opaque' },
    { type: 'computer_call_output' }, { type: 'message', content: [{ type: 'provider_state', state: {} }] },
    { type: 'message', content: [{ type: 'thinking', signature: 'signed' }] },
    { type: 'message', content: [{ type: 'tool_use', thoughtSignature: 'signed' }] },
  ])('protects protocol-bound representation %j', item => expect(hasProviderBoundState([item as InputItem])).toBe(true));
  it('does not mistake ordinary tool-return JSON or prompt text for protocol authority', () => {
    expect(hasProviderBoundState([{ type: 'function_call_output', call_id: 'c', output: '{"signature":"business data"}' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '{"type":"reasoning"}' }] }] as InputItem[])).toBe(false);
  });
});
