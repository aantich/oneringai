import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkConsumerAudit } from '../../../scripts/release/audit-policy.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const summary = (total = 0, high = 0) => ({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: total - high, high, critical: 0, total } }, vulnerabilities: {} });
describe('release consumer audit gate', () => {
  it('accepts a complete clean audit and rejects unavailable audit data', async () => {
    expect((await checkConsumerAudit(summary(), '/unused')).counts.total).toBe(0);
    await expect(checkConsumerAudit({ error: { message: 'registry unavailable' } }, '/unused')).rejects.toThrow();
  });
  it('rejects high findings even when npm omits their detailed entries', async () => {
    await expect(checkConsumerAudit(summary(1, 1), '/unused')).rejects.toThrow('High-severity');
  });
  it('rejects a new moderate advisory rather than allowing its severity', async () => {
    const audit = { ...summary(1), vulnerabilities: { dependency: { name: 'dependency', severity: 'moderate', isDirect: false, nodes: ['node_modules/dependency'], via: [{ url: 'https://example.invalid/new-advisory' }] } } };
    await expect(checkConsumerAudit(audit, '/unused')).rejects.toThrow('Unreviewed');
    audit.vulnerabilities.dependency.name = 'uuid';
    await expect(checkConsumerAudit(audit, '/unused')).rejects.toThrow('Unreviewed advisory:');
  });
  it('checks installed source and refuses a changed implementation under a reviewed version', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'audit-policy-')); directories.push(directory);
    const node = path.join(directory, 'node_modules/minimatch'); await mkdir(node, { recursive: true });
    await writeFile(path.join(node, 'package.json'), JSON.stringify({ name: 'minimatch', version: '3.1.5' }));
    await writeFile(path.join(node, 'index.js'), 'module.exports = function match() {};');
    const audit = { ...summary(1), vulnerabilities: { minimatch: { name: 'minimatch', severity: 'moderate', isDirect: false, nodes: ['node_modules/minimatch'], via: [{ url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249' }] } } };
    expect((await checkConsumerAudit(audit, directory)).checked).toEqual(['minimatch@3.1.5']);
    await writeFile(path.join(node, 'index.js'), 'function firstPhasePreProcess() {}');
    await expect(checkConsumerAudit(audit, directory)).rejects.toThrow('Affected minimatch');
    await writeFile(path.join(node, 'package.json'), JSON.stringify({ name: 'minimatch', version: '10.2.6' }));
    await expect(checkConsumerAudit(audit, directory)).rejects.toThrow('Review minimatch@10.2.6');
  });
  it('rejects incomplete dependency paths for a previously reviewed advisory', async () => {
    const audit = { ...summary(1), vulnerabilities: { uuid: { name: 'uuid', severity: 'moderate', isDirect: false, nodes: [], via: [{ url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq' }] } } };
    await expect(checkConsumerAudit(audit, '/unused')).rejects.toThrow('Incomplete audit dependency paths');
  });
});
