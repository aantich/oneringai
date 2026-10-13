/**
 * Tool Execution Plugin System
 *
 * Provides a pluggable architecture for extending tool execution with
 * custom behavior like logging, analytics, permission prompts, UI updates, etc.
 *
 * @module tool-execution
 *
 * @example
 * ```typescript
 * import {
 *   ToolExecutionPipeline,
 *   LoggingPlugin,
 *   type IToolExecutionPlugin,
 *   type PluginExecutionContext,
 * } from '@everworker/oneringai';
 *
 * // Access via ToolManager
 * const agent = Agent.create({ connector: 'openai', model: 'gpt-4' });
 * agent.tools.executionPipeline.use(new LoggingPlugin());
 *
 * // Or create a standalone pipeline
 * const pipeline = new ToolExecutionPipeline();
 * pipeline.use(new LoggingPlugin());
 * pipeline.use(myCustomPlugin);
 * ```
 */

// Types
export type {
  PluginExecutionContext,
  BeforeExecuteResult,
  IToolExecutionPlugin,
  IToolExecutionPipeline,
  ToolExecutionPipelineOptions,
  PipelineExecutionOptions,
} from './types.js';

// Pipeline
export { ToolExecutionPipeline } from './ToolExecutionPipeline.js';

// Built-in plugins
export { LoggingPlugin, type LoggingPluginOptions } from './plugins/LoggingPlugin.js';
export {
  ResultNormalizerPlugin,
  type ResultNormalizerPluginOptions,
  type NormalizedErrorResult,
} from './plugins/ResultNormalizerPlugin.js';

export type { ToolExecutionOutcome, ToolExecutionOptions, ToolExecutionReport } from './outcomes.js';
