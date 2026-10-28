/**
 * Connector Tools Framework
 *
 * This module provides the infrastructure for vendor-dependent tools.
 * Tools are thin wrappers around Connector.fetch() for specific operations.
 *
 * Usage:
 * ```typescript
 * import { ConnectorTools } from '@everworker/oneringai';
 *
 * // Get all tools (generic + service-specific if registered)
 * const tools = ConnectorTools.for('slack');
 *
 * // Register custom service tools
 * ConnectorTools.registerService('my-service', (connector) => [
 *   createMyCustomTool(connector),
 * ]);
 * ```
 */

export {
  ConnectorTools,
  resolveConnectorContext,
  type ServiceToolFactory,
  type ServiceToolFactoryOptions,
  type GenericAPICallArgs,
  type GenericAPICallResult,
  type ConnectorToolsOptions,
} from './ConnectorTools.js';

export type { EnhancedConnectorOptions, EnhancedConnectorAttempt } from './enhancedProfiles.js';
export type { ConnectorAcceptedResource } from './enhancedInvocation.js';
export type { PagePosition, ConnectorPage } from './pages/types.js';
