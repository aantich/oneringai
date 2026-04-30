/**
 * Human-in-the-loop interaction tools.
 *
 * These tools let an agent pause and ask the user a question over an
 * arbitrary delivery channel. Built on `SuspendSignal` + `ICorrelationStorage`.
 *
 * The library provides the tool factory and the delivery contract; the app
 * implements the channel and the inbound (resume) listener.
 */

export { createRequestUserInputTool } from './requestUserInput.js';
export type {
  CreateRequestUserInputToolOptions,
  RequestUserInputToolDisplayResult,
} from './requestUserInput.js';
export type {
  IUserInteractionDelivery,
  UserInteractionRequest,
  UserInteractionDeliveryContext,
  UserInteractionDeliveryResult,
} from './types.js';
