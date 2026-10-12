import type { ToolFunction } from '../../src/index.js';
import { canonicalJSON } from './reporter.js';
import type { ReplayCall, ReplayFrame } from './replay-provider.js';

export const FIXTURE_IDS = ['chat', 'large-observation', 'research', 'external-workflow'] as const;
export type FixtureId = typeof FIXTURE_IDS[number];
export type FixtureSplit = 'development' | 'held-out';

export interface BaselineFixture {
  id: FixtureId;
  split: FixtureSplit;
  prompt: string;
  resumePrompt?: string;
  frames: ReplayFrame[];
  tools: ToolFunction[];
  evidence: Map<string, unknown>;
  onAccepted?: () => void;
  advanceExternalJob?: () => void;
  evaluate: (text: string) => boolean;
}

/** Each invocation owns its tools, evidence and mock external job state. */
export function createFixture(id: FixtureId, split: FixtureSplit = 'development'): BaselineFixture {
  const suffix = split === 'development' ? 'DEV' : 'HOLDOUT';
  const evidence = new Map<string, unknown>();
  let externalJobReady = false;
  const fixture: BaselineFixture = { id, split, prompt: '', frames: [], tools: [], evidence, evaluate: () => false };
  const call = (name: string, args: Record<string, unknown>, number: number): ReplayCall => ({ id: `call-${number}`, name, args });
  const tool = (name: string, requiredArg: string, expectedArgs: Record<string, unknown>, result: unknown): void => {
    fixture.tools.push({
      definition: { type: 'function', function: {
        name, description: `Baseline fixture: ${name}. Use exactly the requested identifier.`,
        parameters: { type: 'object', properties: { [requiredArg]: { type: 'string' } }, required: [requiredArg], additionalProperties: false },
      } },
      execute: async args => {
        if (canonicalJSON(args) !== canonicalJSON(expectedArgs)) throw new Error('Fixture has no branch for these arguments');
        if (name === 'submit_job' && evidence.has(name)) throw new Error('Fixture has no branch for duplicate submission');
        if (name === 'check_job' && (!evidence.has('submit_job') || !externalJobReady)) throw new Error('Fixture has no branch before host resumes the job');
        evidence.set(name, structuredClone(result));
        if (name === 'submit_job') fixture.onAccepted?.();
        return structuredClone(result);
      },
    });
  };
  const jsonMatches = (text: string, expected: unknown): boolean => {
    // A single enclosing Markdown fence is presentation, not missing evidence.
    // Prose outside that fence and any different JSON structure still fail.
    const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
    try { return canonicalJSON(JSON.parse(fenced?.[1] ?? text)) === canonicalJSON(expected); } catch { return false; }
  };
  if (id === 'chat') {
    fixture.prompt = `Return exactly BASELINE_CHAT_${suffix} and nothing else.`;
    fixture.frames = [{ prompt: fixture.prompt, text: `BASELINE_CHAT_${suffix}` }];
    fixture.evaluate = text => text.trim() === `BASELINE_CHAT_${suffix}`;
  } else if (id === 'large-observation') {
    const sourceId = `large-${suffix.toLowerCase()}`;
    const answer = `EVIDENCE_${suffix}`;
    const result = { sourceId, text: `${'Irrelevant fixture paragraph. '.repeat(1200)}\nANSWER: ${answer}` };
    const request = call('read_document', { sourceId }, 1);
    const expected = { answer, sourceId };
    fixture.prompt = `Call read_document with sourceId "${sourceId}". Find the ANSWER in its text. Return only JSON with answer and sourceId.`;
    tool('read_document', 'sourceId', request.args, result);
    fixture.frames = [{ prompt: fixture.prompt, calls: [request] }, { evidence: [{ ...request, result }], text: JSON.stringify(expected) }];
    fixture.evaluate = text => canonicalJSON(evidence.get('read_document')) === canonicalJSON(result) && jsonMatches(text, expected);
  } else if (id === 'research') {
    const a = { sourceId: `source-a-${suffix}`, choice: 'alpha', score: 7 };
    const b = { sourceId: `source-b-${suffix}`, choice: 'beta', score: 3 };
    const first = call('read_source_a', { sourceId: a.sourceId }, 1);
    const second = call('read_source_b', { sourceId: b.sourceId }, 2);
    const expected = { choice: 'alpha', sources: [a.sourceId, b.sourceId] };
    fixture.prompt = `Read source ${a.sourceId} using read_source_a and source ${b.sourceId} using read_source_b. Choose the higher score. Return only JSON shaped as {"choice":"<chosen choice>","sources":["<A identifier>","<B identifier>"]}, citing both identifiers. No Markdown or commentary.`;
    tool(first.name, 'sourceId', first.args, a);
    tool(second.name, 'sourceId', second.args, b);
    fixture.frames = [
      { prompt: fixture.prompt, calls: [first] },
      { evidence: [{ ...first, result: a }], calls: [second] },
      { evidence: [{ ...first, result: a }, { ...second, result: b }], text: JSON.stringify(expected) },
    ];
    fixture.evaluate = text => evidence.has(first.name) && evidence.has(second.name) && jsonMatches(text, expected);
  } else {
    const jobId = `job-${suffix.toLowerCase()}`;
    const accepted = { jobId, status: 'accepted' };
    const completed = { jobId, status: 'completed', receipt: `receipt-${suffix}` };
    const submit = call('submit_job', { jobId }, 1);
    const check = call('check_job', { jobId }, 2);
    fixture.prompt = `Submit job "${jobId}" using submit_job exactly once. An accepted job is pending, not completed.`;
    fixture.resumePrompt = `Resume the existing job "${jobId}". Do not submit again. Call check_job and return only JSON with jobId, status and receipt from its result.`;
    fixture.advanceExternalJob = () => { externalJobReady = true; };
    tool(submit.name, 'jobId', submit.args, accepted);
    tool(check.name, 'jobId', check.args, completed);
    fixture.frames = [
      { prompt: fixture.prompt, calls: [submit] },
      { prompt: fixture.resumePrompt, evidence: [{ ...submit, result: accepted }], calls: [check] },
      { evidence: [{ ...check, result: completed }], text: JSON.stringify(completed) },
    ];
    fixture.evaluate = text => evidence.has(submit.name) && evidence.has(check.name) && jsonMatches(text, completed);
  }
  return fixture;
}
