/**
 * Pre-built tools for agents
 *
 * Import and use with your agents:
 *
 * ```typescript
 * import { tools } from '@everworker/oneringai';
 *
 * const agent = Agent.create({
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   tools: [
 *     // Filesystem tools
 *     tools.readFile,
 *     tools.writeFile,
 *     tools.editFile,
 *     tools.glob,
 *     tools.grep,
 *     tools.listDirectory,
 *     // Shell tools
 *     tools.bash,
 *     // Web tools
 *     tools.webFetch,
 *   ]
 * });
 * ```
 */

// ============================================================================
// Filesystem Tools
// ============================================================================

export {
  // Tools
  readFile,
  writeFile,
  editFile,
  glob,
  grep,
  listDirectory,
  // Factory functions
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createGlobTool,
  createGrepTool,
  createListDirectoryTool,
  // Types and utilities
  DEFAULT_FILESYSTEM_CONFIG,
  validatePath,
  isExcludedExtension,
  expandTilde,
} from './filesystem/index.js';

export type {
  FilesystemToolConfig,
  ReadFileResult,
  WriteFileResult,
  EditFileResult,
  GlobResult,
  GrepResult,
  GrepMatch,
} from './filesystem/index.js';

// ============================================================================
// Memory Tools (require a live MemorySystem — created via factory)
// ============================================================================

export {
  createMemoryTools,
  createMemoryReadTools,
  createMemoryWriteTools,
  createRecallTool,
  createGraphTool,
  createSearchTool,
  createFindEntityTool,
  createListFactsTool,
  createRememberTool,
  createLinkTool,
  createForgetTool,
  createRestoreTool,
  createUpsertEntityTool,
  createSubjectResolver,
  SUBJECT_TOKEN_ME,
  SUBJECT_TOKEN_THIS_AGENT,
  visibilityToPermissions,
  resolveScope,
} from './memory/index.js';
export type {
  CreateMemoryToolsArgs,
  MemoryToolDeps,
  SubjectRef,
  Visibility,
  ResolveResult,
  MemoryToolError,
} from './memory/index.js';

// ============================================================================
// Shell Tools
// ============================================================================

export {
  // Tools
  bash,
  devServer,
  // Factory functions
  createBashTool,
  createDevServerTool,
  // Utilities
  getBackgroundOutput,
  killBackgroundProcess,
  // Config
  DEFAULT_SHELL_CONFIG,
  isBlockedCommand,
} from './shell/index.js';

export type {
  ShellToolConfig,
  BashResult,
} from './shell/index.js';

// ============================================================================
// JSON Tools
// ============================================================================

export { jsonManipulator } from './json/jsonManipulator.js';

// ============================================================================
// Web Tools
// ============================================================================

export { webFetch, createWebSearchTool, createWebScrapeTool } from './web/index.js';

// Re-export search result type from capabilities (canonical location)
export type { SearchResult } from './web/index.js';

// ============================================================================
// Code Execution Tools
// ============================================================================

export { executeJavaScript, createExecuteJavaScriptTool, executeInVM } from './code/index.js';

// ============================================================================
// Connector Tools (Vendor-Dependent Tools Framework)
// ============================================================================

export {
  ConnectorTools,
  type ServiceToolFactory,
  type GenericAPICallArgs,
  type GenericAPICallResult,
} from './connector/index.js';

// ============================================================================
// Multimedia Tools (Auto-registered with ConnectorTools for AI vendors)
// ============================================================================

// Canonical exports
export {
  setMediaStorage,
  getMediaStorage,
  createImageGenerationTool,
  createVideoTools,
  createTextToSpeechTool,
  createSpeechToTextTool,
} from './multimedia/index.js';

// Deprecated aliases (backward compat - remove in next major version)
export {
  FileMediaOutputHandler,
  setMediaOutputHandler,
  getMediaOutputHandler,
} from './multimedia/index.js';

export type {
  IMediaOutputHandler,
  MediaOutputMetadata,
  MediaOutputResult,
} from './multimedia/index.js';

// ============================================================================
// GitHub Tools (Auto-registered with ConnectorTools for GitHub service)
// ============================================================================

export {
  // Tool factories
  createSearchFilesTool,
  createSearchCodeTool,
  createGitHubReadFileTool,
  createGetPRTool,
  createPRFilesTool,
  createPRCommentsTool,
  createCreatePRTool,
  createListBranchesTool,
  // Utilities
  parseRepository,
  resolveRepository,
} from './github/index.js';

export type {
  GitHubRepository,
  GitHubSearchFilesResult,
  GitHubSearchCodeResult,
  GitHubReadFileResult,
  GitHubGetPRResult,
  GitHubPRFilesResult,
  GitHubPRCommentsResult,
  GitHubPRCommentEntry,
  GitHubCreatePRResult,
  GitHubListBranchesResult,
  GitHubBranchEntry,
} from './github/index.js';

// ============================================================================
// Microsoft Graph Tools (Auto-registered with ConnectorTools for Microsoft service)
// ============================================================================

export {
  // Tool factories
  createDraftEmailTool,
  createSendEmailTool,
  createMeetingTool,
  createEditMeetingTool,
  createGetMeetingTranscriptTool,
  createFindMeetingSlotsTool,
  // Files (OneDrive / SharePoint)
  createMicrosoftReadFileTool,
  createMicrosoftListFilesTool,
  createMicrosoftSearchFilesTool,
  createListMeetingsTool,
  createGetMeetingTool,
  // Utilities
  isAppPermissionAuth,
  getUserPathPrefix,
  microsoftFetch,
  formatRecipients,
  formatAttendees,
  normalizeEmails,
  isTeamsMeetingUrl,
  resolveMeetingId,
  encodeSharingUrl,
  isWebUrl,
  isMicrosoftFileUrl,
  getDrivePrefix,
  resolveFileEndpoints,
  formatFileSize,
} from './microsoft/index.js';

export type {
  MicrosoftDraftEmailResult,
  MicrosoftSendEmailResult,
  MicrosoftCreateMeetingResult,
  MicrosoftEditMeetingResult,
  MicrosoftGetTranscriptResult,
  MicrosoftListMeetingsResult,
  MicrosoftGetMeetingResult,
  MeetingListEntry,
  MicrosoftFindSlotsResult,
  MeetingSlotSuggestion,
  MicrosoftReadFileResult,
  MicrosoftListFilesResult,
  MicrosoftSearchFilesResult,
  GraphDriveItem,
} from './microsoft/index.js';

// ============================================================================
// Multi-Connector Calendar Tools
// ============================================================================

export {
  createUnifiedFindMeetingSlotsTool,
  createGoogleCalendarSlotsProvider,
  createMicrosoftCalendarSlotsProvider,
} from './calendar/index.js';

export type {
  IMultiConnectorProvider,
  ICalendarSlotsProvider,
  BusyInterval,
  GetBusyIntervalsArgs,
  GetBusyIntervalsResult,
  FindSlotsResult,
  UnifiedFindSlotsResult,
  UnifiedFindMeetingSlotsOptions,
} from './calendar/index.js';

// ============================================================================
// Google API Tools (Auto-registered with ConnectorTools for Google service)
// ============================================================================

export {
  // Tool factories
  createGoogleDraftEmailTool,
  createGoogleSendEmailTool,
  createGoogleMeetingTool,
  createGoogleEditMeetingTool,
  createGoogleGetMeetingTranscriptTool,
  createGoogleFindMeetingSlotsTool,
  createGoogleListMeetingsTool,
  createGoogleGetMeetingTool,
  // Files (Google Drive)
  createGoogleReadFileTool,
  createGoogleListFilesTool,
  createGoogleSearchFilesTool,
  // Utilities
  isServiceAccountAuth,
  getGoogleUserId,
  googleFetch,
  buildMimeMessage,
  encodeBase64Url,
  isGoogleNativeFormat,
  GOOGLE_NATIVE_MIME_TYPES,
} from './google/index.js';

export type {
  GoogleDraftEmailResult,
  GoogleSendEmailResult,
  GoogleCreateMeetingResult,
  GoogleEditMeetingResult,
  GoogleGetTranscriptResult,
  GoogleListMeetingsResult,
  GoogleGetMeetingResult,
  GoogleMeetingListEntry,
  GoogleFindSlotsResult,
  GoogleReadFileResult,
  GoogleListFilesResult,
  GoogleSearchFilesResult,
  GoogleReadFileConfig,
  GoogleDriveFile,
} from './google/index.js';

// ============================================================================
// Slack Tools (Auto-registered with ConnectorTools for Slack service)
// ============================================================================

export {
  // Tool factories
  createListChannelsTool,
  createGetMessagesTool,
  createPostMessageTool,
  createGetThreadTool,
  createGetMentionsTool,
  createSearchMessagesTool,
  createAddReactionTool,
  createGetUsersTool,
  createGetChannelInfoTool,
  createSetChannelTopicTool,
  // Utilities
  slackFetch,
  toSlackTimestamp,
  fromSlackTimestamp,
  getAuthenticatedUserId,
  formatMessage as formatSlackMessage,
  slackPaginate,
} from './slack/index.js';

export type {
  SlackChannel,
  SlackMessage,
  SlackMentionMessage,
  SlackUser,
  SlackListChannelsResult,
  SlackGetMessagesResult,
  SlackPostMessageResult,
  SlackGetThreadResult,
  SlackGetMentionsResult,
  SlackSearchMessagesResult,
  SlackAddReactionResult,
  SlackGetUsersResult,
  SlackGetChannelInfoResult,
  SlackSetChannelTopicResult,
} from './slack/index.js';

// ============================================================================
// Zoom Tools (Auto-registered with ConnectorTools for Zoom service)
// ============================================================================

export {
  // Tool factories
  createCreateMeetingTool as createZoomCreateMeetingTool,
  createUpdateMeetingTool as createZoomUpdateMeetingTool,
  createGetTranscriptTool as createZoomGetTranscriptTool,
  // Utilities
  zoomFetch,
  parseMeetingId,
  parseVTT,
} from './zoom/index.js';

export type {
  ZoomCreateMeetingResult,
  ZoomUpdateMeetingResult,
  ZoomGetTranscriptResult,
  TranscriptEntry,
} from './zoom/index.js';

export { ZoomAPIError } from './zoom/index.js';

// ============================================================================
// Twilio Connector Tools (auto-registered with ConnectorTools for Twilio service)
// ============================================================================

export {
  createSendSMSTool,
  createSendWhatsAppTool,
  createListMessagesTool,
  createGetMessageTool,
  twilioFetch,
  normalizePhoneNumber,
  toWhatsAppNumber,
  getAccountSid,
  formatMessage as formatTwilioMessage,
} from './twilio/index.js';

export type {
  TwilioMessage,
  TwilioSendResult,
  TwilioListMessagesResult,
  TwilioGetMessageResult,
} from './twilio/index.js';

export { TwilioAPIError, TwilioConfigError } from './twilio/index.js';

// ============================================================================
// Telegram Connector Tools (auto-registered with ConnectorTools for Telegram service)
// ============================================================================

export {
  createSendMessageTool as createTelegramSendMessageTool,
  createSendPhotoTool as createTelegramSendPhotoTool,
  createGetUpdatesTool as createTelegramGetUpdatesTool,
  createGetMeTool as createTelegramGetMeTool,
  createGetChatTool as createTelegramGetChatTool,
  createSetWebhookTool as createTelegramSetWebhookTool,
  telegramFetch,
  getBotToken,
} from './telegram/index.js';

export type {
  TelegramUser,
  TelegramChat,
  TelegramMessage,
  TelegramPhotoSize,
  TelegramUpdate,
  TelegramSendResult,
  TelegramGetMeResult,
  TelegramGetChatResult,
  TelegramGetUpdatesResult,
  TelegramSetWebhookResult,
} from './telegram/index.js';

export { TelegramAPIError, TelegramConfigError } from './telegram/index.js';

// ============================================================================
// Desktop Automation Tools
// ============================================================================

export {
  // Tools
  desktopScreenshot,
  desktopMouseMove,
  desktopMouseClick,
  desktopMouseDrag,
  desktopMouseScroll,
  desktopGetCursor,
  desktopKeyboardType,
  desktopKeyboardKey,
  desktopGetScreenSize,
  desktopWindowList,
  desktopWindowFocus,
  desktopTools,
  // Factory functions
  createDesktopScreenshotTool,
  createDesktopMouseMoveTool,
  createDesktopMouseClickTool,
  createDesktopMouseDragTool,
  createDesktopMouseScrollTool,
  createDesktopGetCursorTool,
  createDesktopKeyboardTypeTool,
  createDesktopKeyboardKeyTool,
  createDesktopGetScreenSizeTool,
  createDesktopWindowListTool,
  createDesktopWindowFocusTool,
  // Driver
  NutTreeDriver,
  parseKeyCombo,
  getDesktopDriver,
  resetDefaultDriver,
  // Config
  DEFAULT_DESKTOP_CONFIG,
  DESKTOP_TOOL_NAMES,
  applyHumanDelay,
} from './desktop/index.js';

export type {
  IDesktopDriver,
  DesktopToolConfig,
  DesktopPoint,
  DesktopScreenSize,
  DesktopScreenshot,
  DesktopWindow,
  MouseButton,
  DesktopToolName,
  DesktopScreenshotArgs,
  DesktopScreenshotResult,
  DesktopMouseMoveArgs,
  DesktopMouseMoveResult,
  DesktopMouseClickArgs,
  DesktopMouseClickResult,
  DesktopMouseDragArgs,
  DesktopMouseDragResult,
  DesktopMouseScrollArgs,
  DesktopMouseScrollResult,
  DesktopGetCursorResult,
  DesktopKeyboardTypeArgs,
  DesktopKeyboardTypeResult,
  DesktopKeyboardKeyArgs,
  DesktopKeyboardKeyResult,
  DesktopGetScreenSizeResult,
  DesktopWindowListResult,
  DesktopWindowFocusArgs,
  DesktopWindowFocusResult,
} from './desktop/index.js';

// ============================================================================
// Document Reader (used by filesystem and web tools)
// ============================================================================

export {
  DocumentReader,
  FormatDetector,
  mergeTextPieces,
} from '../capabilities/documents/index.js';

export type {
  DocumentFormat,
  DocumentFamily,
  DocumentPiece,
  DocumentTextPiece,
  DocumentImagePiece,
  DocumentResult,
  DocumentMetadata,
  DocumentSource,
  DocumentReadOptions,
  DocumentReaderConfig,
  ImageFilterOptions,
  IDocumentTransformer,
  IFormatHandler,
  FormatDetectionResult,
  DocumentToContentOptions,
} from '../capabilities/documents/index.js';

// ============================================================================
// Convenience: All Developer Tools Bundle
// ============================================================================

import { readFile } from './filesystem/index.js';
import { writeFile } from './filesystem/index.js';
import { editFile } from './filesystem/index.js';
import { glob } from './filesystem/index.js';
import { grep } from './filesystem/index.js';
import { listDirectory } from './filesystem/index.js';
import { bash } from './shell/index.js';
import { devServer } from './shell/index.js';
import { bgProcessOutput } from './shell/index.js';
import { bgProcessList } from './shell/index.js';
import { bgProcessKill } from './shell/index.js';

/**
 * A bundle of all developer tools commonly used for coding tasks.
 * Includes: readFile, writeFile, editFile, glob, grep, listDirectory,
 * bash, devServer, bgProcessOutput, bgProcessList, bgProcessKill
 *
 * @example
 * ```typescript
 * import { tools } from '@everworker/oneringai';
 *
 * const agent = Agent.create({
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   tools: tools.developerTools,
 * });
 * ```
 */
export const developerTools = [
  readFile,
  writeFile,
  editFile,
  glob,
  grep,
  listDirectory,
  bash,
  devServer,
  bgProcessOutput,
  bgProcessList,
  bgProcessKill,
];

// ============================================================================
// Tool Registry (Auto-Generated)
// ============================================================================

export {
  toolRegistry,
  getAllBuiltInTools,
  getToolRegistry,
  getToolsByCategory,
  getToolByName,
  getToolsRequiringConnector,
  getToolCategories,
  type ToolCategory,
  type ToolRegistryEntry,
} from './registry.generated.js';

// ============================================================================
// Routine Tools
// ============================================================================

export { generateRoutine, createGenerateRoutine } from './routines/index.js';

// ============================================================================
// Interaction Tools (human-in-the-loop, pause/resume via SuspendSignal)
// ============================================================================

export { createRequestUserInputTool } from './interaction/index.js';

export type {
  IUserInteractionDelivery,
  UserInteractionRequest,
  UserInteractionDeliveryContext,
  UserInteractionDeliveryResult,
  CreateRequestUserInputToolOptions,
  RequestUserInputToolDisplayResult,
} from './interaction/index.js';

// ============================================================================
// Custom Tool Generation System
// ============================================================================

export {
  // Default instances
  customToolDraft,
  customToolTest,
  customToolSave,
  customToolList,
  customToolLoad,
  customToolDelete,
  // Factory functions
  createCustomToolMetaTools,
  createCustomToolDraft,
  createCustomToolTest,
  createCustomToolSave,
  createCustomToolList,
  createCustomToolLoad,
  createCustomToolDelete,
  // Hydration
  hydrateCustomTool,
} from './custom-tools/index.js';

export type {
  CustomToolMetaToolsOptions,
  HydrateOptions,
} from './custom-tools/index.js';

// ============================================================================
// Unified Tool Registry (Built-in + Connector Tools)
// ============================================================================

export { ToolRegistry, type ConnectorToolEntry } from './ToolRegistry.js';
