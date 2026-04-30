/**
 * Types for human-in-the-loop interaction tools.
 *
 * These tools let an agent pause itself and ask the user a question via an
 * arbitrary delivery channel (Slack, email, in-app notification, webhook, ...).
 * The library defines the shape of the request and the delivery contract; the
 * **app** implements the channel-specific delivery + the inbound listener that
 * resumes the agent when the user replies.
 *
 * The full pause/resume cycle is built on `SuspendSignal` + `ICorrelationStorage`
 * already provided by the library. See `createRequestUserInputTool` for how the
 * pieces fit together.
 */

/**
 * What the agent (LLM) supplies when it decides to ask the user a question.
 *
 * The LLM authors `prompt` (and optionally `context`/`schema`/`metadata`); the
 * tool then forwards the request to the app-supplied delivery channel.
 */
export interface UserInteractionRequest {
  /** The question or message to deliver to the user. Required. */
  prompt: string;

  /**
   * Optional human-readable context shown alongside the prompt
   * (e.g., why we're asking, what triggered this). Channels can render
   * this as a header / preamble / subject.
   */
  context?: string;

  /**
   * Optional JSON Schema describing the expected reply shape. Channels that
   * render forms (in-app notifications, web webhooks) can use this to build
   * structured input. Free-text channels (Slack, email) typically ignore it.
   *
   * Treated as opaque by the library — pass-through to the delivery + metadata.
   */
  schema?: Record<string, unknown>;

  /**
   * App-specific extras the LLM (or the surrounding agent code) wants to
   * forward to the delivery channel — e.g., recipient hint, priority,
   * channel preference. Treated as opaque.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Per-call context the tool passes to the delivery so it can target the
 * right user / agent / session and embed identifiers in the outbound
 * message for later correlation.
 */
export interface UserInteractionDeliveryContext {
  /** Agent ID of the requesting agent. */
  agentId?: string;

  /** Session ID of the suspending session. */
  sessionId?: string;

  /** End-user ID the agent is acting on behalf of. */
  userId?: string;

  /**
   * Tool call ID of the `request_user_input` invocation. Useful for channels
   * that want to render a deterministic request marker.
   */
  toolCallId?: string;
}

/**
 * Result the app's delivery returns after successfully delivering the prompt.
 */
export interface UserInteractionDeliveryResult {
  /**
   * Stable identifier the app can reproduce when the user's reply arrives.
   *
   * Used as the `correlationId` for the resulting `SuspendSignal` and stored
   * in `ICorrelationStorage` so the inbound handler can resolve it back to
   * the suspended `(agentId, sessionId)`.
   *
   * Examples:
   *  - `"slack-thread:C0123/1700000000.123456"`
   *  - `"email:<message-id@example.com>"`
   *  - `"inapp:6c7e..."`
   *
   * Format is entirely app-owned. Must be unique per outstanding request.
   */
  correlationId: string;

  /**
   * Channel name for logs and tool-result display (e.g., `"slack"`, `"email"`,
   * `"inapp"`). Free-form.
   */
  channel: string;

  /**
   * Human-readable description of what was delivered. Returned to the LLM as
   * the tool's visible result (e.g., `"Slack DM sent to @alice — waiting for reply"`).
   * Falls back to a generic message when omitted.
   */
  description?: string;

  /**
   * Optional metadata to forward through `SuspendSignal.metadata` →
   * `SessionRef.metadata`. Use this for anything the inbound listener needs
   * to look up the underlying delivery (e.g., Slack thread ts, email
   * Message-ID, in-app notification id).
   */
  metadata?: Record<string, unknown>;
}

/**
 * App-implemented delivery contract.
 *
 * Implementations are responsible for:
 *  1. Delivering the prompt over their channel.
 *  2. Embedding (or otherwise persisting) `correlationId` so an inbound reply
 *     can be tied back to the suspended session.
 *  3. Wiring the inbound listener that, on reply, resolves the correlation
 *     via `ICorrelationStorage`, calls `Agent.hydrate(...)`, and runs
 *     `agent.run(reply)` to continue execution.
 *
 * The library never invokes step 3 — that's the app's responsibility.
 */
export interface IUserInteractionDelivery {
  /**
   * Channel identifier — used for logging only; the actual channel name
   * surfaced in tool results comes from `UserInteractionDeliveryResult.channel`.
   * Optional: implementations may omit this if they expose a single channel.
   */
  readonly id?: string;

  /**
   * Deliver the prompt and return a correlation handle.
   *
   * Errors thrown here propagate out of the tool call — the agent will treat
   * the call as failed (no suspension). Apps should throw with descriptive
   * messages; the library logs them with full context.
   */
  send(
    request: UserInteractionRequest,
    ctx: UserInteractionDeliveryContext,
  ): Promise<UserInteractionDeliveryResult>;
}
