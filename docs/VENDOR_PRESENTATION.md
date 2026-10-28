# Vendor presentation without identity changes

C9-C exports immutable `VENDOR_PRESENTATIONS` and bounded
`getVendorPresentation(id)` from root and browser-safe `/shared`. Rows contain
`id`, `displayName` and CSS-ready `color`. Unknown IDs return undefined so the host
chooses its fallback. Lookups do not fetch data, download logos or import provider
SDKs/Node modules.

```typescript
import { Vendor, getVendorPresentation } from '@everworker/oneringai/shared';
const presentation = getVendorPresentation(Vendor.Google);
const hostChoice = { ...presentation, displayName: 'Google AI' };
```

The initial palette preserves the consumer's existing display map: OpenAI, Anthropic,
Google, Google Vertex, Groq, Together AI, Perplexity, Grok (xAI), DeepSeek, Mistral and
Ollama. Custom retains its existing fallback label/color. These are presentation
choices, not claims of immutable official branding. Compose ordinary host overrides;
there is no mutable SDK theme registry.

Existing `Vendor`, `VENDORS`, `isVendor`, logo/color utilities, service templates,
model identities/defaults and authentication behavior remain unchanged. In the SDK,
`Vendor.Custom` denotes an OpenAI-compatible endpoint. ICOS also has ordinary custom
service records: those retain their host-owned service/auth classification. Catalog
membership must never decide platform-managed credentials or LLM/service ownership.

AMOS `/vendor` reuses the catalog while preserving its existing Google AI, Google
Vertex AI, xAI Grok, Mistral AI and Ollama (Local) labels as host overrides. Existing
vendor IDs, connector checks and default-model selection are unchanged. There is
no new voice UI or color theme engine.

Run `npm run example:vendor-presentation` offline. Built root/shared ESM/CJS and
browser checks cover identity, CSS values, unknown handling and immutable data.
ICOS adopts the catalog only through separate consumer work preserving its current
palette/custom-service policy. Branch implementation does not imply a release.
