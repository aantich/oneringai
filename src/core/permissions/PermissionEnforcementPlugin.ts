/**
 * PermissionEnforcementPlugin - IToolExecutionPlugin that gates ALL tool execution.
 *
 * Registered on ToolManager's execution pipeline at priority 1 (runs FIRST).
 * Builds PolicyContext from pipeline context + ToolManager's tool context + registration metadata.
 * Throws ToolPermissionDeniedError on deny.
 *
 * This ensures ALL paths through ToolManager.execute() are permission-checked:
 * - Agent agentic loop
 * - Direct API usage
 * - Orchestrator workers
 */

import type { IToolExecutionPlugin, PluginExecutionContext, BeforeExecuteResult } from '../tool-execution/types.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import type { PolicyContext, ToolPermissionConfig } from './types.js';
import type { PermissionPolicyManager } from './PermissionPolicyManager.js';
import { ToolPermissionDeniedError } from '../../domain/errors/AIErrors.js';

/**
 * Minimal tool registration info needed for PolicyContext.
 */
export interface ToolRegistrationInfo {
  source?: string;
  category?: string;
  namespace?: string;
  tags?: string[];
  permission?: ToolPermissionConfig;
}

export class PermissionEnforcementPlugin implements IToolExecutionPlugin {
  readonly name = 'permission-enforcement';
  readonly priority = 1; // runs FIRST in beforeExecute

  /** Exposed for ToolManager.getPermissionManager() */
  readonly policyManager: PermissionPolicyManager;

  private readonly getToolContext: () => ToolContext | undefined;
  private readonly getToolRegistration: (name: string) => ToolRegistrationInfo | undefined;

  constructor(
    policyManager: PermissionPolicyManager,
    getToolContext: () => ToolContext | undefined,
    getToolRegistration: (name: string) => ToolRegistrationInfo | undefined,
  ) {
    this.policyManager = policyManager;
    this.getToolContext = getToolContext;
    this.getToolRegistration = getToolRegistration;
  }

  async beforeExecute(ctx: PluginExecutionContext): Promise<BeforeExecuteResult> {
    const toolCtx = this.getToolContext();
    const reg = this.getToolRegistration(ctx.toolName);

    const policyCtx: PolicyContext = {
      toolName: ctx.toolName,
      args: (ctx.mutableArgs as Record<string, unknown>) ?? {},
      userId: toolCtx?.userId,
      roles: toolCtx?.roles,
      agentId: toolCtx?.agentId,
      sessionId: toolCtx?.sessionId,
      executionId: ctx.executionId,
      // Tool registration metadata
      toolSource: reg?.source,
      toolCategory: reg?.category,
      toolNamespace: reg?.namespace,
      toolTags: reg?.tags,
      toolPermissionConfig: reg?.permission,
    };

    const result = await this.policyManager.check(policyCtx);

    if (!result.allowed) {
      throw new ToolPermissionDeniedError(ctx.toolName, result.reason, {
        policyName: result.policyName,
        approvalRequired: result.approvalRequired,
        approvalKey: result.approvalKey,
      });
    }

    return undefined; // continue execution
  }
}
