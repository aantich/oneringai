/**
 * @everworker/oneringai — memory layer.
 *
 * Self-contained knowledge store. Entities are pure identity; facts carry all
 * knowledge (atomic triples + long-form documents including canonical profiles).
 * Storage is pluggable via IMemoryStore. Embedding, profile generation, and rule
 * inference are optional capabilities injected via config.
 *
 * Public surface. No consumers should import internals directly.
 */

// ---- Runtime values ----
export {
  MemorySystem,
  ScopeInvariantError,
  ProfileGeneratorMissingError,
  SemanticSearchUnavailableError,
  InvalidTaskTransitionError,
  FactSupersededError,
} from './MemorySystem.js';
export type {
  TaskStateHistoryEntry,
  TransitionTaskStateOptions,
  TransitionTaskStateResult,
} from './MemorySystem.js';
export { InMemoryAdapter, OptimisticConcurrencyError, ScopeViolationError } from './adapters/inmemory/index.js';
export type { InMemoryAdapterOptions } from './adapters/inmemory/index.js';

// Entity resolution — surface-form → entity-id translation.
export {
  EntityResolver,
  buildIdentityString,
  RESOLUTION_DEFAULTS,
  normalizeSurface,
} from './resolution/index.js';
export type { ResolverMemoryHooks } from './resolution/index.js';

// Integration layer — wires oneringai Connectors into IEmbedder/IProfileGenerator
// plus the extraction helpers that take raw LLM output → resolved entities + facts.
export {
  ConnectorEmbedder,
  ConnectorProfileGenerator,
  parseProfileResponse,
  defaultProfilePrompt,
  createMemorySystemWithConnectors,
  defaultExtractionPrompt,
  DEFAULT_EXTRACTION_PROMPT_VERSION,
  ExtractionResolver,
  SignalIngestor,
  ConnectorExtractor,
  parseExtractionResponse,
  parseExtractionWithStatus,
  PlainTextAdapter,
  EmailSignalAdapter,
  CalendarSignalAdapter,
} from './integration/index.js';
export type {
  ConnectorEmbedderConfig,
  ConnectorProfileGeneratorConfig,
  PromptContext,
  MemoryConnectorsConfig,
  MemorySystemWithConnectorsConfig,
  ExtractionPromptContext,
  PreResolvedBinding,
  ExtractionMention,
  ExtractionFactSpec,
  ExtractionOutput,
  IngestionResolvedEntity,
  IngestionError,
  IngestionResult,
  ExtractionResolverOptions,
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
  ParseExtractionResult,
  ParseStatus,
} from './integration/index.js';

// Mongo adapter — optional peer dep on `mongodb`; import path is always safe
// because no runtime imports of mongodb exist in this adapter.
export {
  MongoMemoryAdapter,
  MongoOptimisticConcurrencyError,
  RawMongoCollection,
  MeteorMongoCollection,
  ensureIndexes,
  scopeToFilter,
  mergeFilters,
  factFilterToMongo,
  orderByToSort,
} from './adapters/mongo/index.js';
export type {
  MongoMemoryAdapterOptions,
  RawMongoDriverCollection,
  RawMongoClientLike,
  MeteorCollectionLike,
  EnsureIndexesArgs,
  IMongoCollectionLike,
  MongoFilter,
  MongoFindOptions,
  MongoSort,
  MongoUpdate,
  MongoUpdateOptions,
  MongoUpdateResult,
  ObjectIdLike,
  ObjectIdCtor,
} from './adapters/mongo/index.js';
export { genericTraverse } from './GenericTraversal.js';
export { scoreFact, rankFacts } from './Ranking.js';

// Identifier helpers — deterministic canonical ids for entities lacking a
// natural external strong key (tasks, events, topics, calendar entries).
export { canonicalIdentifier, slugify } from './identifiers.js';
export type { CanonicalIdentifierOptions, SlugifyOptions } from './identifiers.js';

// Predicate library — pluggable vocabulary with a 51-predicate standard set.
export { PredicateRegistry, STANDARD_PREDICATES } from './predicates/index.js';
export type { PredicateDefinition } from './predicates/index.js';

// Access control — three-principal permission model (owner / group / world).
export {
  PermissionDeniedError,
  OwnerRequiredError,
  canAccess,
  effectivePermissions,
  assertCanAccess,
  levelGrants,
  DEFAULT_GROUP_LEVEL,
  DEFAULT_WORLD_LEVEL,
} from './AccessControl.js';
export type {
  AccessLevel,
  Permission,
  Permissions,
  AccessControlled,
} from './AccessControl.js';

// ---- Types ----
export type {
  // Ids + primitives
  EntityId,
  FactId,
  FactKind,
  Identifier,
  ScopeFields,
  ScopeFilter,

  // Core shapes
  IEntity,
  IFact,
  NewEntity,
  NewFact,
  IMemoryStore,

  // Retrieval
  EntityView,
  ContextOptions,
  ContextTier,
  RelatedTask,
  RelatedEvent,
  Neighborhood,
  TraversalOptions,
  FactFilter,
  FactOrderBy,
  FactQueryOptions,
  Page,
  UpsertEntityResult,
  EntityListFilter,
  EntitySearchOptions,
  ListOptions,
  SemanticSearchOptions,

  // Entity resolution
  EntityCandidate,
  ResolveEntityQuery,
  ResolveEntityOptions,
  UpsertBySurfaceInput,
  UpsertBySurfaceOptions,
  UpsertBySurfaceResult,
  EntityResolutionConfig,

  // Extension points
  IEmbedder,
  IProfileGenerator,
  ProfileGeneratorInput,
  IRuleEngine,
  IScopedMemoryView,

  // Events + config
  ChangeEvent,
  MemorySystemConfig,
  EmbeddingQueueConfig,
  RankingConfig,
  TaskStatesConfig,
} from './types.js';
