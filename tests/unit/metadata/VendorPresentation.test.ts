import { describe, it, expect } from 'vitest';
import { Vendor, VENDORS, isVendor, VENDOR_PRESENTATIONS, getVendorPresentation, getServiceDefinition, Services } from '@/index.js';
describe('optional browser-safe vendor presentation', () => {
  it.each(VENDORS)('covers %s with immutable identity and valid CSS color', vendor => {
    const row = getVendorPresentation(vendor)!; expect(row.id).toBe(vendor); expect(row.displayName.length).toBeGreaterThan(0); expect(row.color).toMatch(/^#[0-9a-f]{6}$/i); expect(Object.isFrozen(row)).toBe(true);
  });
  it.each(['unknown', '__proto__', 'constructor', 'OPENAI', 'microsoft', '', 'x'.repeat(129)])('returns explicit unknown for %s', value => { expect(getVendorPresentation(value)).toBeUndefined(); });
  it('keeps catalog and returned rows immutable while hosts compose local overrides', () => {
    expect(Object.isFrozen(VENDOR_PRESENTATIONS)).toBe(true); expect(() => { (VENDOR_PRESENTATIONS.openai as any).color = '#000000'; }).toThrow();
    const local = { ...VENDOR_PRESENTATIONS.openai, displayName: 'Local OpenAI', color: '#abcdef' }; expect(local.displayName).toBe('Local OpenAI'); expect(getVendorPresentation('openai')!.displayName).toBe('OpenAI');
  });
  it('does not change identity/service classification or turn arbitrary custom services into LLM vendors', () => {
    expect(Object.keys(VENDOR_PRESENTATIONS).sort()).toEqual([...VENDORS].sort()); expect(isVendor(Vendor.Custom)).toBe(true); expect(isVendor(Services.Slack)).toBe(false); expect(getVendorPresentation(Services.Slack)).toBeUndefined(); expect(getServiceDefinition(Services.Slack)).toBeDefined();
    expect(getVendorPresentation(Vendor.GoogleVertex)).toMatchObject({ displayName: 'Google Vertex', color: '#4285f4' }); expect(getVendorPresentation(Vendor.Grok)).toMatchObject({ displayName: 'Grok (xAI)', color: '#1da1f2' });
  });
});
