import { AIError } from '../domain/errors/AIErrors.js';

abstract class AgentRuntimeError extends AIError {
  protected constructor(name: string, message: string, code: string, statusCode?: number, cause?: Error) {
    super(message, code, statusCode, cause);
    this.name = name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AgentDriverNotFoundError extends AgentRuntimeError {
  constructor(driverId: string) {
    super('AgentDriverNotFoundError', `Agent runtime driver '${driverId}' is not registered`, 'AGENT_DRIVER_NOT_FOUND', 404);
  }
}

export class AgentDriverConfigurationError extends AgentRuntimeError {
  constructor(message: string, cause?: Error) {
    super('AgentDriverConfigurationError', message, 'AGENT_DRIVER_CONFIGURATION', 400, cause);
  }
}

export class AgentCapabilityUnsupportedError extends AgentRuntimeError {
  constructor(capability: string, reason?: string) {
    super(
      'AgentCapabilityUnsupportedError',
      `Agent capability '${capability}' is unsupported${reason ? `: ${reason}` : ''}`,
      'AGENT_CAPABILITY_UNSUPPORTED',
      400,
    );
  }
}

export class AgentPolicyUnsupportedError extends AgentRuntimeError {
  constructor(message: string) {
    super('AgentPolicyUnsupportedError', message, 'AGENT_POLICY_UNSUPPORTED', 400);
  }
}

export class AgentWorkspaceError extends AgentRuntimeError {
  constructor(message: string, cause?: Error) {
    super('AgentWorkspaceError', message, 'AGENT_WORKSPACE_ERROR', 400, cause);
  }
}

export class AgentBusyError extends AgentRuntimeError {
  constructor(message: string = 'Agent session already has an active run') {
    super('AgentBusyError', message, 'AGENT_BUSY', 409);
  }
}

export class AgentEventHistoryExpiredError extends AgentRuntimeError {
  constructor(runId: string) {
    super('AgentEventHistoryExpiredError', `Event history for run '${runId}' has expired`, 'AGENT_EVENT_HISTORY_EXPIRED', 410);
  }
}

export class AgentEventSubscriberOverflowError extends AgentRuntimeError {
  constructor(runId: string) {
    super(
      'AgentEventSubscriberOverflowError',
      `Agent event subscriber buffer overflow for run '${runId}'`,
      'AGENT_EVENT_SUBSCRIBER_OVERFLOW',
      409,
    );
  }
}

export class AgentRunTimeoutError extends AgentRuntimeError {
  constructor(timeoutMs: number) {
    super('AgentRunTimeoutError', `Agent run exceeded its ${timeoutMs}ms wall-time limit`, 'AGENT_RUN_TIMEOUT', 408);
  }
}

export class AgentNativeExecutionError extends AgentRuntimeError {
  constructor(driverId: string, message: string, cause?: Error) {
    super('AgentNativeExecutionError', `${driverId}: ${message}`, 'AGENT_NATIVE_EXECUTION', 502, cause);
  }
}

export class AgentRuntimeDependencyError extends AgentRuntimeError {
  constructor(dependency: string, message?: string, cause?: Error) {
    super(
      'AgentRuntimeDependencyError',
      message ?? `Optional agent runtime dependency '${dependency}' is required`,
      'AGENT_RUNTIME_DEPENDENCY',
      500,
      cause,
    );
  }
}

export class AgentStructuredOutputError extends AgentRuntimeError {
  constructor(message: string, cause?: Error) {
    super('AgentStructuredOutputError', message, 'AGENT_STRUCTURED_OUTPUT', 422, cause);
  }
}

/** Observation/admission uncertainty carries a locator; it is never a terminal native result. */
export class AgentSessionRecoveryError extends AgentRuntimeError {
  constructor(message: string, readonly reference: import('./types.js').RuntimeSessionReference, readonly runId?: string) {
    super('AgentSessionRecoveryError', message, 'AGENT_SESSION_RECOVERY_REQUIRED', 409);
  }
}
