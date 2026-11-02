import assert from 'node:assert/strict';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Narrow source-reviewed findings, not a blanket severity exemption. Any new
// advisory, package version, affected implementation or dependency path fails.
const reviewed = new Map([
  ['https://github.com/advisories/GHSA-g3hv-75wg-m249', 'minimatch'],
  ['https://github.com/advisories/GHSA-w5hq-g745-h8pq', 'uuid'],
]);
const allowed = new Set(['oneringai', 'exceljs', 'archiver', 'archiver-utils', 'readdir-glob', 'rimraf', 'zip-stream', 'glob', 'minimatch', 'uuid']);

async function jsSources(directory) {
  const sources = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) sources.push(...await jsSources(file));
    else if (item.name.endsWith('.js')) sources.push(await readFile(file, 'utf8'));
  }
  return sources;
}

async function packageManifests(directory) {
  const manifests = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const folder = path.join(directory, item.name);
    if (item.name.startsWith('@')) { manifests.push(...await packageManifests(folder)); continue; }
    const manifest = path.join(folder, 'package.json');
    try { manifests.push({ manifest, pkg: JSON.parse(await readFile(manifest, 'utf8')) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { manifests.push(...await packageManifests(path.join(folder, 'node_modules'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return manifests;
}

export async function checkConsumerAudit(audit, consumer) {
  assert.ok(audit.metadata?.vulnerabilities, 'npm audit did not return a vulnerability summary');
  assert.ok(!audit.error, 'npm audit failed');
  assert.equal(audit.metadata.vulnerabilities.high, 0, 'High-severity consumer advisory');
  assert.equal(audit.metadata.vulnerabilities.critical, 0, 'Critical consumer advisory');
  const findings = Object.values(audit.vulnerabilities ?? {});
  assert.equal(findings.length, audit.metadata.vulnerabilities.total, 'Incomplete audit findings');
  for (const finding of findings) {
    assert.ok(allowed.has(finding.name) && finding.isDirect === (finding.name === 'oneringai') && finding.severity === 'moderate', `Unreviewed audit finding: ${finding.name}`);
    assert.ok(finding.nodes?.length > 0 && finding.via?.length > 0, 'Incomplete audit dependency paths');
    for (const via of finding.via) {
      if (typeof via === 'string') assert.ok(allowed.has(via) && audit.vulnerabilities[via], `Unreviewed advisory dependency: ${via}`);
      else assert.equal(reviewed.get(via.url), finding.name, `Unreviewed advisory: ${via.url}`);
    }
  }
  const checked = [];
  for (const name of ['minimatch', 'uuid']) {
    for (const node of audit.vulnerabilities?.[name]?.nodes ?? []) {
      const directory = await realpath(path.resolve(consumer, node));
      assert.ok(directory.startsWith(await realpath(consumer) + path.sep), 'Audit node escaped the clean consumer');
      const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      assert.equal(pkg.name, name);
      if (name === 'minimatch') {
        assert.ok(['3.1.5', '5.1.9'].includes(pkg.version), `Review minimatch@${pkg.version} before release`);
        const sources = await jsSources(directory);
        assert.ok(!sources.some(source => /firstPhasePreProcess|secondPhasePreProcess|optimizationLevel/.test(source)), 'Affected minimatch preprocessing is present');
      } else {
        assert.equal(pkg.version, '8.3.2', 'Review the changed ExcelJS UUID dependency');
        const require = createRequire(path.join(consumer, 'node_modules/oneringai/package.json'));
        const excel = path.dirname(require.resolve('exceljs/package.json'));
        const manifests = await packageManifests(path.join(consumer, 'node_modules'));
        const callers = manifests.filter(({ pkg }) => pkg.dependencies?.uuid || pkg.optionalDependencies?.uuid || pkg.peerDependencies?.uuid)
          .filter(({ manifest }) => {
            try { return path.dirname(createRequire(manifest).resolve('uuid/package.json')) === directory; }
            catch { return false; }
          });
        assert.ok(callers.length > 0, 'No reviewed caller for vulnerable UUID');
        assert.ok(callers.every(({ pkg }) => pkg.name === 'exceljs' && pkg.version === '4.4.0'), 'Unreviewed caller shares vulnerable UUID');
        const imports = (await jsSources(path.join(excel, 'lib'))).filter(source => /require\(['"]uuid['"]\)/.test(source));
        assert.equal(imports.length, 1, 'Review changed ExcelJS UUID imports');
        assert.match(imports[0], /const\s*\{v4:\s*uuidv4\}\s*=\s*require\('uuid'\)/);
        assert.ok([...imports[0].matchAll(/uuidv4\(([^)]*)\)/g)].every(match => match[1].trim() === ''), 'Review UUID output-buffer arguments');
      }
      checked.push(`${name}@${pkg.version}`);
    }
  }
  return { counts: audit.metadata.vulnerabilities, disposition: findings.length ? 'source-reviewed non-applicable advisories; see docs/DEPENDENCY_SECURITY.md' : 'no findings', checked };
}
