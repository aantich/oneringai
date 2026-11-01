/**
 * oneringai — memory layer.
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
  DEFAULT_EXTRACTABLE_ENTITY_TYPES,
  ExtractionResolver,
  SignalIngestor,
  ConnectorExtractor,
  parseExtractionResponse,
  parseExtractionWithStatus,
  parseReconciliationOpsWithStatus,
  parseSignalReconciliationOpsWithStatus,
  PlainTextAdapter,
  EmailSignalAdapter,
  CalendarSignalAdapter,
  // v5+ restraint posture
  EAGERNESS_PRESETS,
  buildEagernessProfile,
  getEagernessPreset,
  resolveEagerness,
  StaticAnchorRegistry,
  emitRestraintEvent,
  applyRestrainedExtractionContract,
  SkepticPass,
  defaultSkepticPrompt,
  parseSkepticOutput,
  // Pillar 2 — entity-anchored cross-source reconciliation
  entityReconciliationPrompt,
  ENTITY_RECONCILIATION_PROMPT_VERSION,
  // Signal-anchored reconciliation — the SECOND pass (facts + tasks)
  signalReconciliationPrompt,
  SIGNAL_RECONCILIATION_PROMPT_VERSION,
} from './integration/index.js';
export type {
  ConnectorEmbedderConfig,
  OversizeEmbeddingInput,
  OversizeEmbeddingReducer,
  ConnectorProfileGeneratorConfig,
  PromptContext,
  MemoryConnectorsConfig,
  MemorySystemWithConnectorsConfig,
  ExtractionPromptContext,
  PreResolvedBinding,
  SignalThreadMessage,
  ExtractionMention,
  ExtractionFactSpec,
  ExtractionOutput,
  IngestionResolvedEntity,
  IngestionError,
  IngestionResult,
  ExtractionResolverOptions,
  ReconciliationOp,
  OperationOutcome,
  TaskReconciliationOp,
  SignalReconciliationOp,
  SignalReconciliationOutcome,
  AIResolutionProvenance,
  EntityReconciliationPromptContext,
  SignalReconciliationPromptContext,
  NewFactSummary,
  NewTaskSummary,
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
  ParseReconciliationOpsResult,
  ParseSignalReconciliationOpsResult,
  ParseStatus,
  // v5+ restraint posture types
  EagernessLevel,
  EagernessPreset,
  EagernessProfile,
  EagernessStage,
  SkepticPassMode,
  Anchor,
  AnchorRegistry,
  RestraintEvent,
  RestraintEventKind,
  RestraintEventListener,
  RestraintModelInfo,
  RestraintStage,
  RestrainedExtractionInput,
  RestrainedExtractionOptions,
  RestrainedExtractionResult,
  SkepticPassConfig,
  SkepticPromptContext,
  SkepticReviewContext,
  SkepticReviewItem,
  SkepticReviewResult,
} from './integration/index.js';

// Mongo adapter — optional peer dep on `mongodb`; import path is always safe
// because no runtime imports of mongodb exist in this adapter.
export {
  MongoMemoryAdapter,
  MongoOptimisticConcurrencyError,
  RawMongoCollection,
  MeteorMongoCollection,
  ensureIndexes,
  ensureNormalizedNameUniqueIndex,
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
export {
  canonicalIdentifier,
  slugify,
  CASE_INSENSITIVE_IDENTIFIER_KINDS,
  normalizeIdentifierValue,
  identifierValuesEqual,
} from './identifiers.js';
export type { CanonicalIdentifierOptions, SlugifyOptions } from './identifiers.js';
export { recaseIdentifierValues } from './identifierMigration.js';
export type {
  RecaseIdentifierOptions,
  RecaseIdentifierResult,
  IdentifierRecoveryFn,
} from './identifierMigration.js';

// Metadata diff helper — used by callers detecting external changes
// (e.g. calendar API event metadata updates) to emit predicate facts.
export { diffEntityMetadata } from './metadataDiff.js';
export type { MetadataChange } from './metadataDiff.js';

// Deduplication tooling — generic primitives for finding, scoring, and
// surveying duplicate clusters. Type-agnostic by design. See `dedup.ts`
// header for the full scorer rule set.
export {
  scoreEntityPair,
  findDuplicateCandidates,
  findDuplicateClusters,
  findIdentifierClusters,
  sweepDuplicates,
  DEFAULT_WEIGHTS,
} from './dedup.js';
export type {
  DedupDecision,
  SignalBreakdown,
  SignalWeights,
  ScoreThresholds,
  FindCandidatesOptions,
  FindClustersOptions,
  DuplicateCluster,
  FindIdentifierClustersOptions,
  IdentifierCluster,
  SweepOptions,
} from './dedup.js';

// Date coercion helpers — apply at write boundaries where date-shaped values
// arrive as ISO strings (LLM extraction, REST sync) but must land in MongoDB
// as `Date` for `$gte/$lt` range queries to work. Library write paths apply
// these automatically; exported here for app code that bridges payloads
// (signal adapters, REST handlers) into typed domain fields.
export {
  toDate,
  looksLikeIsoDate,
  maybeCoerceToDate,
  coerceMetadataDates,
  coerceFactTemporalFields,
} from './dateCoercion.js';

// Predicate library — pluggable vocabulary with a 44-predicate standard set.
export { PredicateRegistry, STANDARD_PREDICATES } from './predicates/index.js';
export type { PredicateDefinition, PredicateLifecycle } from './predicates/index.js';

// Content embedding composers — per-type strategies that produce the text
// fed into IEntity.contentEmbedding / IFact.embedding. Hosts can override
// defaults via MemorySystemConfig.entityContentComposers / factContentComposer.
export {
  CachedComposeContext,
  taskContentComposer,
  eventContentComposer,
  personContentComposer,
  organizationContentComposer,
  topicContentComposer,
  projectContentComposer,
  documentContentComposer,
  clusterContentComposer,
  defaultFactContentComposer,
  DEFAULT_ENTITY_COMPOSERS,
} from './composers/index.js';
export type {
  EntityContentComposer,
  FactContentComposer,
  ComposeContext,
} from './composers/index.js';

// Documents — entities with type='document' carrying long-form content.
// Pure convention over IEntity/IFact; CRUD lives on MemorySystem as
// create/update/get/attach/detach/list/searchDocument(s).
export {
  DOCUMENT_TYPE,
  HAS_DOCUMENT_PREDICATE,
  DOCUMENT_SLUG_KIND,
  DOCUMENT_SLUG_PREFIX,
  DEFAULT_EMBED_SOURCE_CHAR_LIMIT,
  documentSlugIdentifier,
} from './documents/index.js';
export type {
  Document,
  CreateDocumentInput,
  UpdateDocumentInput,
  ListDocumentsFilter,
  SearchDocumentsInput,
  DocumentSearchHit,
  DetachDocumentResult,
  SuggestedDocumentRole,
  DocumentFormat,
} from './documents/index.js';

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
  VisibilityContext,
  VisibilityPolicy,
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
  RelatedItemHit,
  RelatedItemsResult,
  Neighborhood,
  TraversalOptions,
  FactFilter,
  FactOrderBy,
  FactQueryOptions,
  Page,
  UpsertEntityResult,
  EntityEmbeddingField,
  EntityListFilter,
  EntityOrderBy,
  EntitySearchOptions,
  EntitySemanticSearchFilter,
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
