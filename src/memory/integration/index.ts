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
