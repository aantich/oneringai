# C9-C — browser-safe vendor presentation

Stage-entry API: immutable `VENDOR_PRESENTATIONS: Readonly<Record<Vendor,
VendorPresentation>>` and bounded `getVendorPresentation(id)` on root and `/shared`.
Each row has `id`, `displayName`, CSS-ready `color`. Unknown IDs return undefined;
hosts choose their fallback and compose ordinary object overrides. No theme engine,
mutation registry, logo download, model defaults or provider detection is added.

Initial labels/colors preserve the ICOS `LLM_VENDOR_DISPLAY` map read on 2026-10-28;
Custom keeps its existing fallback label/color. These are consumer presentation
choices, not claims of immutable official branding. The SDK's Vendor.Custom means
an OpenAI-compatible endpoint; ICOS ordinary custom services keep their existing
service ownership/auth classification. Catalog membership is never authorization.

Existing Vendor/VENDORS/isVendor, logo/color utilities, service templates, model
registry and auth behavior remain unchanged. AMOS reuses the new base labels while
retaining its five existing local label overrides. Tests pair presentation with
identity/classification fixtures and check immutability, bounded unknown lookup,
ESM/CJS and browser bundling. No ICOS files or dependency pins are changed.

Review: preserve all eleven consumer palette entries plus Custom fallback, freeze
nested rows, bound lookups and reject prototype/unknown keys without coercion. AMOS
adopts base names with five local overrides, preserving every existing displayed
label and vendor/default-model/connector behavior. Existing logo utilities remain
separate and unchanged. All 9,196 unit tests pass (23 new catalog/app cases plus the final cross-slice capacity regression); source
and built browser bundling, 53 root/shared ESM/CJS assertions, build/types/lint,
compatibility, examples and generated API pass. Final cumulative artifact audit is
recorded in the ledger. No live calls or ICOS edits occurred.

Final review also guards AMOS's local override table with own-key lookup, so an
unknown restored vendor such as `constructor` stays a literal host fallback rather
than an Object prototype value. No supported vendor label or authentication rule
changes. The cumulative package audit checks referenced example helper closure;
all final commands run sequentially around the clean build to avoid dist races.


Final cumulative gate: 1,413 public assertions over twelve fixtures and all 52
offline modes pass on the final build. The 313-file local package artifact includes
its reporter/helper closure; all five new library examples run after extraction.
All 3,075 audited local links resolve. See [final evidence](../evaluations/CONSUMER_FINAL_VALIDATION_2026_10_28.json).
