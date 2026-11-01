/**
 * Permission Utilities
 *
 * Shared utilities for building permission configurations.
 * Extracted to avoid duplication between create and resume paths.
 */

import type {
  AgentPermissionsConfig,
  ApprovalRequestContext,
  ApprovalDecision,
} from 'oneringai';
import type { AmosConfig, ToolApprovalContext } from '../config/types.js';

/**
 * Build AgentPermissionsConfig from AMOS config
 *
 * This utility extracts the permission config building logic that was
 * duplicated in AgentRunner's initialize() method (once for resume, once for create).
 *
 * @param config - AMOS application configuration
 * @param onApprovalRequired - Optional callback for interactive approval prompts
 * @returns AgentPermissionsConfig ready for Agent
 */
export function buildPermissionsConfig(
  config: AmosConfig,
  onApprovalRequired?: (context: ToolApprovalContext) => Promise<ApprovalDecision>
): AgentPermissionsConfig {
  const { permissions } = config;

  return {
    defaultScope: permissions.defaultScope,
    defaultRiskLevel: permissions.defaultRiskLevel,
    allowlist: permissions.allowlist,
    blocklist: permissions.blocklist,
    tools: permissions.toolOverrides,
    onApprovalRequired:
      permissions.promptForApproval && onApprovalRequired
        ? async (context: ApprovalRequestContext): Promise<ApprovalDecision> => {
            return onApprovalRequired({
              toolName: context.toolName,
              args: context.args,
              riskLevel: context.riskLevel,
              reason: context.approvalMessage || context.decision.reason,
            });
          }
        : undefined,
  };
}
