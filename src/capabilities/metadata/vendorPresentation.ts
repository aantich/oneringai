import { Vendor } from '../../core/Vendor.js';
export interface VendorPresentation { readonly id: Vendor; readonly displayName: string; readonly color: string }
const row = (id: Vendor, displayName: string, color: string): VendorPresentation => Object.freeze({ id, displayName, color });
/** Optional consumer presentation, independent of vendor/service identity and authentication. */
export const VENDOR_PRESENTATIONS: Readonly<Record<Vendor, VendorPresentation>> = Object.freeze({
  [Vendor.OpenAI]: row(Vendor.OpenAI, 'OpenAI', '#10a37f'),
  [Vendor.Anthropic]: row(Vendor.Anthropic, 'Anthropic', '#d4a27f'),
  [Vendor.Google]: row(Vendor.Google, 'Google', '#4285f4'),
  [Vendor.GoogleVertex]: row(Vendor.GoogleVertex, 'Google Vertex', '#4285f4'),
  [Vendor.Groq]: row(Vendor.Groq, 'Groq', '#f55036'),
  [Vendor.Together]: row(Vendor.Together, 'Together AI', '#6366f1'),
  [Vendor.Perplexity]: row(Vendor.Perplexity, 'Perplexity', '#20808d'),
  [Vendor.Grok]: row(Vendor.Grok, 'Grok (xAI)', '#1da1f2'),
  [Vendor.DeepSeek]: row(Vendor.DeepSeek, 'DeepSeek', '#0066ff'),
  [Vendor.Mistral]: row(Vendor.Mistral, 'Mistral', '#ff7000'),
  [Vendor.Ollama]: row(Vendor.Ollama, 'Ollama', '#ffffff'),
  [Vendor.Custom]: row(Vendor.Custom, 'Custom', '#6c757d'),
});
/** Pure bounded lookup. Unknown IDs have no implicit vendor/auth fallback. */
export function getVendorPresentation(id: string): VendorPresentation | undefined {
  return typeof id === 'string' && id.length <= 128 && Object.hasOwn(VENDOR_PRESENTATIONS, id) ? VENDOR_PRESENTATIONS[id as Vendor] : undefined;
}
