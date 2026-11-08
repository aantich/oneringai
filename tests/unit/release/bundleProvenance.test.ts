import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBundledVersions, checkBundledAudit, verifyBuild } from '../../../scripts/release/bundle-provenance.mjs';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const sdk = (version = '1.32.0') => ({ name: '@modelcontextprotocol/sdk', version, directory: 'node_modules/@modelcontextprotocol/sdk', inputs: {} });
it('rejects old, missing, incompatible and prerelease SDK identities', () => {
  for (const entries of [[], [sdk('1.30.0')], [sdk('1.31.9')], [sdk('2.0.0')], [sdk('1.32.0-rc.1')]]) expect(() => checkBundledVersions(entries)).toThrow();
  expect(() => checkBundledVersions([sdk('1.32.0')])).not.toThrow();
  expect(() => checkBundledVersions([sdk('1.33.1')])).not.toThrow();
  expect(() => checkBundledVersions([sdk(), { name: 'fast-uri', version: '3.1.8' }])).toThrow();
  expect(() => checkBundledVersions([sdk(), { name: 'hono', version: '4.13.10' }])).toThrow();
  expect(() => checkBundledVersions([sdk(), { name: '@hono/node-server', version: '2.1.2' }])).toThrow();
});
it('audits actual embedded package paths, including moderate advisories and nested copies', () => {
  const record = { packages: [sdk()] };
  const audit = { metadata: { vulnerabilities: { total: 1 } }, vulnerabilities: {
    sdk: { name: '@modelcontextprotocol/sdk', nodes: [sdk().directory], via: [{ url: 'https://example.invalid/redirect' }] },
  } };
  expect(() => checkBundledAudit(record, audit)).toThrow('Unreviewed advisory');
  audit.vulnerabilities.sdk.nodes = ['node_modules/another/node_modules/@modelcontextprotocol/sdk'];
  expect(checkBundledAudit(record, audit).directAdvisories).toBe(0);
  record.packages[0].directory = audit.vulnerabilities.sdk.nodes[0]!;
  expect(() => checkBundledAudit(record, audit)).toThrow();
  expect(() => checkBundledAudit(record, { error: {} })).toThrow('unavailable');
  expect(() => checkBundledAudit(record, { metadata: audit.metadata })).toThrow('Incomplete bundled dependency audit');
  expect(() => checkBundledAudit(record, { ...audit, vulnerabilities: { sdk: { nodes: [], via: [] } } })).toThrow('Incomplete bundled dependency advisory');
});
it('rejects altered/added artifacts and dependency changes after a build', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bundle-provenance-')); directories.push(directory);
  const dist = join(directory, 'dist'); await mkdir(dist);
  const source = 'original', hash = createHash('sha256').update(source).digest('hex');
  const entry = sdk(); (entry.inputs as Record<string, string>)['input.js'] = hash;
  await writeFile(join(directory, 'input.js'), source); await writeFile(join(dist, 'index.js'), source);
  await writeFile(join(dist, 'bundle-provenance.json'), JSON.stringify({ version: 1, packages: [entry], artifacts: { 'index.js': hash } }));
  expect((await verifyBuild(dist, directory)).version).toBe(1);
  await writeFile(join(dist, 'extra.js'), source); await expect(verifyBuild(dist)).rejects.toThrow('Artifact set changed'); await rm(join(dist, 'extra.js'));
  await writeFile(join(dist, 'index.js'), 'changed'); await expect(verifyBuild(dist)).rejects.toThrow('Artifact changed');
  await writeFile(join(dist, 'index.js'), source); await writeFile(join(directory, 'input.js'), 'changed');
  await expect(verifyBuild(dist, directory)).rejects.toThrow('Bundled input changed');
  expect((await readFile(join(dist, 'index.js'), 'utf8'))).toBe(source);
});
