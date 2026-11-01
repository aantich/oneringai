/** Compile against the built public package; no runtime or native work is executed. */
import type { AgentRuntime, RuntimeSessionOptions, RuntimeSessionReference, RuntimeFileUpload, RuntimeArtifactDownload, AgentRunStatus, DriverSession, AgentDriver, RuntimeInspectionDetails } from 'oneringai/agent-runtime';
import type { CodexSdkDriverOptions } from 'oneringai/agent-runtime/codex';
import type { ClaudeAgentSdkDriverOptions } from 'oneringai/agent-runtime/claude';
import type { OpenAIManagedDriverOptions } from 'oneringai/agent-runtime/openai-managed';
import type { ClaudeManagedDriverOptions } from 'oneringai/agent-runtime/claude-managed';

export async function publicContract(runtime: AgentRuntime, options: RuntimeSessionOptions, reference: RuntimeSessionReference, upload: RuntimeFileUpload, download: RuntimeArtifactDownload) {
  const agent = runtime.createAgent({ id: 'logical', instructions: 'Keep the native loop.', tools: ['probe'] });
  const report = await agent.inspect(options);
  const details: RuntimeInspectionDetails | undefined = report.inspection;
  const session = await agent.openSession(options);
  const run = await session.run('work', { requestId: 'host-owned' });
  const output = await run.result;
  const original = await session.getRun(run.id);
  await session.uploadFile(upload); await session.downloadArtifact(download);
  await session.detach(); await runtime.resumeSession(reference, { context: options.context });
  await runtime.deleteSession(reference, { context: options.context });
  return { details, original, output };
}
export const oldStatuses: AgentRunStatus[] = ['completed', 'failed', 'cancelled', 'incomplete'];
// @ts-expect-error Active state belongs to inspectState, not a new terminal union member.
export const forbiddenStatus: AgentRunStatus = 'running';
export const optionalHooks: Pick<DriverSession, 'run' | 'destroy' | 'isDestroyed' | 'cancelActiveRun'> = null!;
export const unchangedDriver: Pick<AgentDriver, 'id' | 'inspect' | 'openSession'> = null!;
export const localOptions: [CodexSdkDriverOptions, ClaudeAgentSdkDriverOptions] = [{}, {}];
export const managedOptions: [OpenAIManagedDriverOptions, ClaudeManagedDriverOptions] = [{}, {}];
