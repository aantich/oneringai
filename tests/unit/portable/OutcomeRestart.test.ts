import { it, expect } from 'vitest';
import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
const execute = promisify(execFile);
it('recovers C7 file evidence across two real processes, reauthorizes and leaves workflow uncertainty explicit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oneringai-c8-restart-'));
  try {
    const run = async (mode: string) => { const { stdout } = await execute(process.execPath, ['tests/fixtures/composition-evaluation/restart.mjs', mode, directory], { cwd: process.cwd(), timeout: 30_000 }); return JSON.parse(stdout.trim().split('\n').at(-1)!); };
    expect(await run('produce')).toMatchObject({ effects: 1, operations: 2 });
    expect(await run('recover')).toMatchObject({ effects: 1, exactSource: true, reauthorization: true, sourceSettlement: 'succeeded', proxySettlement: 'failed', workflow: 'unknown', replayed: 0 });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 65_000);
