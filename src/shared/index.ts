/**
 * @everworker/oneringai/shared
 *
 * Lightweight subpath export containing only pure data constants and types.
 * Zero Node.js dependencies — safe for Cloudflare Workers, Deno, and browsers.
 *
 * Usage:
 *   import { Vendor, MODEL_REGISTRY, SERVICE_DEFINITIONS } from '@everworker/oneringai/shared';
 */

// ============ Vendor ============
export { Vendor, VENDORS, isVendor } from '../core/Vendor.js';
export type { Vendor as VendorType } from '../core/Vendor.js';

// ============ Models ============
export {
  MODEL_REGISTRY,
  LLM_MODELS,
  getModelInfo,
  getModelsByVendor,
  getActiveModels,
  getDeprecatedModels,
  resolveModelName,
  calculateCost,
} from '../domain/entities/Model.js';
export type {
  ILLMDescription,
  ProcessingMode,
  TokenPricing,
  LongContextTokenPricing,
} from '../domain/entities/Model.js';
export type {
  ModelLifecycleStatus,
  ModelAvailability,
  ModelEndpoint,
} from '../domain/types/SharedTypes.js';
export { MODEL_REGISTRY_SCHEMA_VERSION } from '../domain/types/SharedTypes.js';

// ============ Services ============
export {
  SERVICE_DEFINITIONS,
  Services,
  SERVICE_URL_PATTERNS,
  SERVICE_INFO,
  detectServiceFromURL,
  getServiceInfo,
  getServiceDefinition,
  getServicesByCategory,
  getAllServiceIds,
  isKnownService,
} from '../domain/entities/Services.js';
export type {
  ServiceCategory,
  ServiceDefinition,
  ServiceType,
  ServiceInfo,
} from '../domain/entities/Services.js';

// Sparse endpoint companions; no runtime probing or provider SDK dependency.
export { getRealtimeModelCapabilities, getTranscriptionCapabilities } from '../capabilities/metadata/realtime.js';
export type { EndpointCapabilitySupport, RealtimeTransport, RealtimeReasoningEffort, CapabilityProvenance,
  RealtimeModelCapabilityQuery, RealtimeModelCapabilities, TranscriptionCapabilityQuery, TranscriptionCapabilities } from '../capabilities/metadata/realtime.js';
export { assessModelParameters } from '../capabilities/metadata/parameters.js';
export type { ModelParameterEndpoint, ModelParameterQuery, ModelParameterAssessment, ModelParameterDecision, ModelParameterPolicy } from '../capabilities/metadata/parameters.js';
export { VENDOR_PRESENTATIONS, getVendorPresentation } from '../capabilities/metadata/vendorPresentation.js';
export type { VendorPresentation } from '../capabilities/metadata/vendorPresentation.js';
