import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function runCli(input: string, mode: 'queued' | 'recover' | 'resume', extra: string[] = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'amos-cli-')); directories.push(root);
  const marker = path.join(root, 'calls.json'); const host = path.join(root, 'host.mjs');
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { exports: Record<string, { import: string }> };
  const runtimeEntry = pathToFileURL(path.resolve(manifest.exports['./agent-runtime']!.import)).href;
  await writeFile(host, `
import {writeFile} from 'node:fs/promises';
import {AgentSessionRecoveryError} from ${JSON.stringify(runtimeEntry)};
let opens=0;const calls={runs:0,deletes:0,resumes:[]};
const original={version:1,id:'session_original'};const next={version:1,id:'session_next'};
const session={id:next.id,state:'ready',isDestroyed:false,capabilities:{driverId:'fixture',capabilities:{}},reference:()=>next,inspectState:async()=>({connection:'attached',activity:'ready',unresolvedEffects:false}),cancelActiveRun:async()=>{},destroy:async()=>{},detach:async()=>{},run:async()=>{calls.runs++;throw new Error('Unexpected queued model input');}};
export function createAmosRuntimeHost(){return {definition:{id:'logical',instructions:''},options:{context:{userId:'trusted-owner'}},runtime:{createAgent:()=>({inspect:async()=>session.capabilities,openSession:async()=>{if(${JSON.stringify(mode)}==='recover'&&opens++===0)throw new AgentSessionRecoveryError('Lost native setup acknowledgement',original);if(${JSON.stringify(mode)}==='resume')throw new Error('Resume override started a new session');return session;}}),resumeSession:async(ref,options)=>{calls.resumes.push({reference:ref,context:options.context});return session;},deleteSession:async()=>{calls.deletes++;},destroy:async()=>{await writeFile(${JSON.stringify(marker)},JSON.stringify(calls));}}};}
`);
  const source = path.resolve('apps/amos/src/index.ts');
  const args = ['--import', createRequire(import.meta.url).resolve('tsx'), source, '--runtime-host', host, ...extra];
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, AMOS_DATA_DIR: root }, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`CLI timed out: ${stdout}\n${stderr}`)); }, 20000);
    child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
    child.on('error', error => { clearTimeout(timeout); reject(error); }); child.on('exit', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); }); child.stdin.end(input);
  });
  const frames = (result.stdout + '\n' + result.stderr).split('\n').flatMap(line => { try { return [JSON.parse(line) as { type: string; data?: unknown; reference?: unknown }]; } catch { return []; } });
  const calls = JSON.parse(await readFile(marker, 'utf8')) as { runs: number; deletes: number; resumes: unknown[] };
  return { ...result, frames, calls };
}

describe('runtime CLI wiring and recovery', () => {
  it.each(['ordinary queued text', '/run {"input":"queued","options":{"requestId":"queued"}}'])('stop discards queued execution: %s', async text => {
    const result = await runCli(`${text}\n/stop\n/exit\n`, 'queued');
    expect(result.code, result.stderr).toBe(0); expect(result.calls.runs).toBe(0); expect(result.stdout).toContain('Queued input cancelled before admission');
  }, 30000);
  it('keeps recoverable startup alive for reference inspection, deletion and a fresh session', async () => {
    const result = await runCli('/reference\n/delete\n/new\n/reference\n/exit\n', 'recover');
    expect(result.code, result.stderr).toBe(0); expect(result.calls).toMatchObject({ runs: 0, deletes: 1 });
    expect(result.frames.filter(frame => frame.type === 'reference').map(frame => frame.data)).toEqual([{ version: 1, id: 'session_original' }, { version: 1, id: 'session_next' }]);
    expect(result.frames.find(frame => frame.type === 'recovery-required')?.data).toMatchObject({ reference: { id: 'session_original' } });
  }, 30000);
  it('uses the explicit startup locator with the host scope and no new task', async () => {
    const reference = { version: 1, id: 'session_requested' };
    const result = await runCli('/reference\n/exit\n', 'resume', ['--runtime-resume', JSON.stringify(reference)]);
    expect(result.code, result.stderr).toBe(0); expect(result.calls.runs).toBe(0); expect(result.calls.resumes).toEqual([{ reference, context: { userId: 'trusted-owner' } }]);
  }, 30000);
});
