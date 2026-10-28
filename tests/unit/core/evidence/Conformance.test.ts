import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { InMemoryEvidenceStorage, FileEvidenceStorage } from '@/index.js';
import { runEvidenceConformance } from '../../../conformance/evidence.js';
describe('reusable evidence adapter conformance', () => {
  it('verifies the declared process-local profile without promising another-instance recovery', async () => {
    const report = await runEvidenceConformance({ name: 'memory/process', durability: 'process', create: async (scope, limits) => new InMemoryEvidenceStorage({ scope, ...limits }) });
    expect(report.assertions).toBeGreaterThan(100); expect(report.processReopen).toBe(false);
  });
  it.each([false, true])('verifies current file profile, fsync=%s', async fsync => {
    const directory = await mkdtemp(join(tmpdir(), 'oneringai-conformance-'));
    try { const report = await runEvidenceConformance({ name: fsync ? 'file/fsync' : 'file/restart', durability: fsync ? 'fsync' : 'restart',
      create: async (scope, limits) => new FileEvidenceStorage({ directory, scope, durability: fsync ? 'fsync' : 'restart', ...limits }), reopen: async scope => new FileEvidenceStorage({ directory, scope, durability: fsync ? 'fsync' : 'restart' }) });
      expect(report.assertions).toBeGreaterThan(100); expect(report.processReopen).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
