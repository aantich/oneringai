// Record the installed files esbuild actually consumed, then seal final tsup
// artifacts. Consumer dependency resolution cannot replace an embedded copy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = path => path.replaceAll('\\', '/');
const within = (base, path) => { const name = portable(relative(base, path)); assert.ok(name && !name.startsWith('../') && !name.startsWith('/'), 'Build input escaped its root'); return name; };

export function bundledDependenciesPlugin(target) {
  return { name: 'bundled-dependency-provenance', setup(builder) {
    builder.initialOptions.metafile = true;
    builder.onEnd(result => {
      if (result.errors.length) return;
      const packages = new Map();
      for (const input of Object.keys(result.metafile.inputs)) {
        if (!portable(input).includes('node_modules/')) continue;
        const file = resolve(root, input);
        let directory = dirname(file), manifest;
        while (directory !== dirname(directory)) {
          const candidate = join(directory, 'package.json');
          if (existsSync(candidate)) {
            const value = JSON.parse(readFileSync(candidate, 'utf8'));
            if (value.name && value.version) { manifest = value; break; }
          }
          directory = dirname(directory);
        }
        assert.ok(manifest, `No package identity for ${input}`);
        const key = within(root, directory);
        const entry = packages.get(key) ?? { directory: key, name: manifest.name, version: manifest.version, inputs: {} };
        for (const source of [file, join(directory, 'package.json')]) entry.inputs[within(root, source)] = digest(readFileSync(source));
        packages.set(key, entry);
      }
      const dist = resolve(root, builder.initialOptions.outdir);
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, `.bundle-inputs.${target}.${builder.initialOptions.format}.json`), JSON.stringify({ bundle: `${target}:${builder.initialOptions.format}`, packages: [...packages.values()] }));
    });
  } };
}

async function artifacts(directory, prefix = '') {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) entries.push(...await artifacts(join(directory, item.name), name + '/'));
    else if (/\.(js|cjs)$/.test(name)) entries.push(name);
  }
  return entries.sort();
}
export function checkBundledVersions(packages) {
  const sdk = packages.filter(entry => entry.name === '@modelcontextprotocol/sdk');
  assert.ok(sdk.length, 'Missing bundled MCP SDK identity');
  const floors = new Map([['@modelcontextprotocol/sdk', [1, 32, 0]], ['fast-uri', [3, 1, 9]], ['hono', [4, 13, 11]], ['@hono/node-server', [2, 1, 3]]]);
  for (const entry of packages) {
    const floor = floors.get(entry.name); if (!floor) continue;
    const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(entry.version);
    assert.ok(version && Number(version[1]) === floor[0]
      && (Number(version[2]) > floor[1] || Number(version[2]) === floor[1] && Number(version[3]) >= floor[2]),
    `Rebuild with patched ${entry.name} >=${floor.join('.')} in the same major; found ${entry.version}`);
  }
}
export async function sealBuild(directory) {
  const packages = new Map();
  const captures = (await readdir(directory)).filter(name => name.startsWith('.bundle-inputs.'));
  // tsup converts its ESM graph to CJS after esbuild. Each of the four
  // configurations has one input graph; seal both final output formats below.
  assert.deepEqual(captures.map(name => name.split('.')[2]).sort(), ['browser', 'node', 'realtime', 'types'], 'Missing esbuild configuration provenance');
  for (const name of captures) {
    const capture = JSON.parse(await readFile(join(directory, name), 'utf8'));
    for (const entry of capture.packages) {
      const prior = packages.get(entry.directory);
      if (prior) {
        assert.equal(prior.version, entry.version, 'Dependency changed during build');
        for (const [file, hash] of Object.entries(entry.inputs)) {
          if (prior.inputs[file]) assert.equal(prior.inputs[file], hash, 'Dependency changed during build');
          prior.inputs[file] = hash;
        }
        prior.bundles.push(capture.bundle);
      } else packages.set(entry.directory, { ...entry, bundles: [capture.bundle] });
    }
  }
  const record = { version: 1, packages: [...packages.values()].sort((a, b) => a.directory.localeCompare(b.directory)), artifacts: {} };
  for (const entry of record.packages) {
    entry.inputs = Object.fromEntries(Object.entries(entry.inputs).sort(([a], [b]) => a.localeCompare(b)));
    entry.bundles.sort();
  }
  checkBundledVersions(record.packages);
  for (const name of await artifacts(directory)) record.artifacts[name] = digest(await readFile(join(directory, name)));
  await writeFile(join(directory, 'bundle-provenance.json'), JSON.stringify(record, null, 2) + '\n');
  await verifyBuild(directory, root);
  await Promise.all(captures.map(name => rm(join(directory, name))));
}
export async function verifyBuild(directory, sourceRoot) {
  const record = JSON.parse(await readFile(join(directory, 'bundle-provenance.json'), 'utf8'));
  assert.equal(record.version, 1, 'Unknown bundle provenance version');
  checkBundledVersions(record.packages);
  assert.deepEqual(await artifacts(directory), Object.keys(record.artifacts).sort(), 'Artifact set changed after build');
  for (const [name, hash] of Object.entries(record.artifacts)) assert.equal(digest(await readFile(join(directory, name))), hash, `Artifact changed: ${name}`);
  if (sourceRoot) for (const entry of record.packages) for (const [name, hash] of Object.entries(entry.inputs)) {
    assert.equal(digest(await readFile(join(sourceRoot, name))), hash, `Bundled input changed; rebuild: ${name}`);
  }
  return record;
}
export function checkBundledAudit(record, audit) {
  assert.ok(audit.metadata?.vulnerabilities && !audit.error, 'Bundled dependency audit unavailable');
  const entries = Object.values(audit.vulnerabilities ?? {});
  assert.equal(entries.length, audit.metadata.vulnerabilities.total, 'Incomplete bundled dependency audit');
  for (const entry of entries) assert.ok(Array.isArray(entry.nodes) && entry.nodes.length
    && entry.nodes.every(node => typeof node === 'string') && Array.isArray(entry.via) && entry.via.length,
  'Incomplete bundled dependency advisory');
  const embedded = new Set(record.packages.map(entry => entry.directory));
  const findings = entries.filter(entry => entry.nodes.some(node => embedded.has(portable(node))))
    .flatMap(entry => entry.via.filter(via => typeof via === 'object').map(via => ({ name: entry.name, advisory: via.url })));
  assert.deepEqual(findings, [], 'Unreviewed advisory in embedded dependency code');
  return { embeddedPackages: record.packages.length, directAdvisories: findings.length, scope: 'exact embedded packages; installed external dependencies audited separately in clean consumer' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv[2], '--seal');
  await sealBuild(join(root, 'dist'));
  console.log('Sealed bundled dependency provenance and final JavaScript artifacts');
}
