export { ConnectorEmbedder } from './ConnectorEmbedder.js';
export type { ConnectorEmbedderConfig } from './ConnectorEmbedder.js';

export {
  ConnectorProfileGenerator,
  parseProfileResponse,
} from './ConnectorProfileGenerator.js';
export type { ConnectorProfileGeneratorConfig } from './ConnectorProfileGenerator.js';

export { defaultProfilePrompt } from './defaultPrompt.js';
export type { PromptContext } from './defaultPrompt.js';

export { createMemorySystemWithConnectors } from './createMemorySystemWithConnectors.js';
export type {
  MemoryConnectorsConfig,
  MemorySystemWithConnectorsConfig,
} from './createMemorySystemWithConnectors.js';

// Extraction helpers — signal → memory pipeline.
export {
  defaultExtractionPrompt,
  DEFAULT_EXTRACTION_PROMPT_VERSION,
} from './defaultExtractionPrompt.js';
export type { ExtractionPromptContext, PreResolvedBinding } from './defaultExtractionPrompt.js';

export { ExtractionResolver } from './ExtractionResolver.js';
export type {
  ExtractionMention,
  ExtractionFactSpec,
  ExtractionOutput,
  IngestionResolvedEntity,
  IngestionError,
  IngestionResult,
  ExtractionResolverOptions,
} from './ExtractionResolver.js';

// Extraction-output parser (rich + back-compat forms).
export { parseExtractionWithStatus } from './parseExtraction.js';
export type { ParseExtractionResult, ParseStatus } from './parseExtraction.js';

// Restraint posture — tunable LLM-eagerness controls (v5+).
export {
  EAGERNESS_PRESETS,
  buildEagernessProfile,
  getEagernessPreset,
  resolveEagerness,
} from './EagernessProfile.js';
export type {
  EagernessLevel,
  EagernessPreset,
  EagernessProfile,
  EagernessStage,
  SkepticPassMode,
} from './EagernessProfile.js';

export { StaticAnchorRegistry } from './AnchorRegistry.js';
export type { Anchor, AnchorRegistry } from './AnchorRegistry.js';

export { emitRestraintEvent } from './RestraintEvent.js';
export type {
  RestraintEvent,
  RestraintEventKind,
  RestraintEventListener,
  RestraintModelInfo,
  RestraintStage,
} from './RestraintEvent.js';

export { applyRestrainedExtractionContract } from './RestrainedExtractionContract.js';
export type {
  RestrainedExtractionInput,
  RestrainedExtractionOptions,
  RestrainedExtractionResult,
} from './RestrainedExtractionContract.js';

export { SkepticPass, defaultSkepticPrompt, parseSkepticOutput } from './SkepticPass.js';
export type {
  SkepticPassConfig,
  SkepticPromptContext,
  SkepticReviewContext,
  SkepticReviewItem,
  SkepticReviewResult,
} from './SkepticPass.js';

// Signal ingestion — raw source (email, plain text, custom) → facts.
export {
  SignalIngestor,
  ConnectorExtractor,
  parseExtractionResponse,
  PlainTextAdapter,
  EmailSignalAdapter,
  CalendarSignalAdapter,
} from './signals/index.js';
export type {
  SignalIngestorConfig,
  ContextHintsConfig,
  IngestSignalInput,
  IngestTextInput,
  IngestExtractedInput,
  ConnectorExtractorConfig,
  ParticipantSeed,
  SeedFact,
  ExtractedSignal,
  SignalSourceAdapter,
  IExtractor,
  PlainTextRaw,
  EmailAddress,
  EmailSignal,
  EmailSignalAdapterOptions,
  CalendarAttendee,
  CalendarSignal,
  CalendarSignalAdapterOptions,
} from './signals/index.js';
