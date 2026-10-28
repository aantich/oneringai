/** Pure browser-safe presentation. Host overrides do not mutate vendor identity or authentication. */
import assert from 'node:assert/strict';
import { Vendor, VENDOR_PRESENTATIONS, getVendorPresentation } from '@everworker/oneringai/shared';
const local = { ...getVendorPresentation(Vendor.Google)!, displayName: 'Google AI' };
assert.equal(local.id, Vendor.Google); assert.equal(getVendorPresentation(Vendor.Google)!.displayName, 'Google');
assert.equal(getVendorPresentation('ordinary-custom-service'), undefined);
assert.equal(getVendorPresentation(Vendor.Custom)!.id, Vendor.Custom);
console.log(JSON.stringify({ passed: true, vendors: Object.values(VENDOR_PRESENTATIONS), hostOverride: local, unknown: getVendorPresentation('ordinary-custom-service') ?? null,
  notice: 'Presentation does not decide LLM/service ownership or authentication.' }));
