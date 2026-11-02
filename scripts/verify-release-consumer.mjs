// A real tarball installation: no repository node_modules, overrides or lockfile.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConsumerAudit } from './release/audit-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = await mkdtemp(path.join(tmpdir(), 'oneringai-release-'));
const consumer = path.join(work, 'consumer');
const cache = process.env.npm_config_cache || path.join(tmpdir(), 'oneringai-v2-npm-cache');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const reportIndex = process.argv.indexOf('--report');
const reportFile = reportIndex < 0 ? null : path.resolve(process.argv[reportIndex + 1]);
const report = { status: 'running', node: process.version, startedAt: new Date().toISOString(), work };
async function command(program, args, cwd, allowAuditFindings = false, env = {}) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Timed out: ${program} ${args[0]}`)); }, 240_000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  if (result.code !== 0 && !(allowAuditFindings && result.code === 1)) throw new Error(`${program} ${args[0]} failed (${result.code}): ${result.stderr.slice(-6000)}\n${result.stdout.slice(-6000)}`);
  return result.stdout;
}
try {
  await mkdir(consumer);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const [pack] = JSON.parse(await command(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', work, '--cache', cache], root));
  report.package = `${pkg.name}@${pkg.version}`; report.integrity = pack.integrity; report.files = pack.files.length;
  if (pack.files.some(file => /(^|\/)(\.env($|\.)|\.npmrc$|credentials?\.json$)/i.test(file.path))) throw new Error('Sensitive configuration in tarball');
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'oneringai-release-probe', private: true, type: 'module', version: '1.0.0' }));
  // Exercise ordinary install scripts and optional dependencies as a user would.
  await command(npm, ['install', path.join(work, pack.filename), '--omit=dev', '--no-audit', '--no-fund', '--cache', cache], consumer);
  for (const file of ['README.md', 'USER_GUIDE.md', 'AGENTS.md', 'API_REFERENCE.md', 'docs/VERSION_2_GUIDE.md', 'docs/RELEASE_READINESS_V2.md', 'docs/DEPENDENCY_SECURITY.md', 'docs/evaluations/V2_RELEASE_VALIDATION_2026_11_02.json']) {
    const [source, installed] = await Promise.all([readFile(path.join(root, file)), readFile(path.join(consumer, 'node_modules/oneringai', file))]);
    if (!source.equals(installed)) throw new Error(`Packed documentation differs from source: ${file}`);
  }
  report.documentationMatchesSource = true;
  await copyFile(path.join(root, 'scripts/release/consumer-probe.mjs'), path.join(consumer, 'probe.mjs'));
  await copyFile(path.join(root, 'scripts/release/pdf-fixture.mjs'), path.join(consumer, 'pdf-fixture.mjs'));
  const output = await command(process.env.ONERINGAI_CONSUMER_NODE || process.execPath, ['probe.mjs'], consumer, false, {
    ONERINGAI_EXPECTED_VERSION: pkg.version, ONERINGAI_PPTX_FIXTURE: path.join(root, 'docs/architecture.pptx'),
  });
  report.probe = JSON.parse(output.trim().split('\n').at(-1));
  // Compile existing public-consumer contracts against the installed declarations,
  // with no source aliases. Only the compiler comes from maintainer tooling;
  // ambient declarations must resolve entirely within the consumer install.
  const fixtures = path.join(root, 'tests/fixtures/agentic-baseline');
  const compatibility = path.join(consumer, 'compatibility'); await mkdir(compatibility);
  for (const file of await readdir(fixtures)) if (file.endsWith('.ts')) {
    await copyFile(path.join(fixtures, file), path.join(compatibility, file));
    await copyFile(path.join(fixtures, file), path.join(compatibility, file.replace(/\.ts$/, '.cts')));
  }
  const entries = Object.keys(pkg.exports).map(key => key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`);
  const writeEntries = async selected => {
    const imports = selected.map((entry, index) => `import * as entry${index} from '${entry}'; void entry${index};`).join('\n');
    await writeFile(path.join(compatibility, 'entries.mts'), imports); await writeFile(path.join(compatibility, 'entries.cts'), imports);
  };
  // The two local SDK adapters deliberately expose their optional SDK's types.
  // First prove the core needs neither peer, then check the supported opt-in install.
  await writeEntries(entries.filter(entry => !['oneringai/agent-runtime/codex', 'oneringai/agent-runtime/claude'].includes(entry)));
  await writeFile(path.join(compatibility, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      noEmit: true, skipLibCheck: false, esModuleInterop: true, types: ['node'], typeRoots: [path.join(consumer, 'node_modules/@types')] },
    include: ['*.ts', '*.mts', '*.cts'],
  }));
  await command(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(compatibility, 'tsconfig.json')], consumer);
  report.coreConsumerTypes = 'ESM and CJS; public compatibility fixtures and nine entries; no optional SDKs; skipLibCheck=false';
  const audit = JSON.parse(await command(npm, ['audit', '--omit=dev', '--json', '--cache', cache], consumer, true));
  await writeFile(path.join(work, 'audit.json'), JSON.stringify(audit, null, 2) + '\n');
  report.audit = await checkConsumerAudit(audit, consumer);
  const peers = ['@openai/codex-sdk', '@anthropic-ai/claude-agent-sdk'];
  await command(npm, ['install', '--no-save', '--omit=dev', '--no-audit', '--no-fund', '--cache', cache,
    ...peers.map(name => `${name}@${pkg.peerDependencies[name]}`)], consumer);
  report.optionalSdkVersions = {};
  for (const peer of peers) report.optionalSdkVersions[peer] = JSON.parse(await readFile(path.join(consumer, 'node_modules', peer, 'package.json'), 'utf8')).version;
  await writeEntries(entries);
  await command(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(compatibility, 'tsconfig.json')], consumer);
  report.optionalConsumerTypes = 'ESM and CJS; all eleven entries with declared optional SDK peers installed; skipLibCheck=false';
  const optionalOutput = await command(process.env.ONERINGAI_CONSUMER_NODE || process.execPath, ['probe.mjs'], consumer, false, {
    ONERINGAI_EXPECTED_VERSION: pkg.version, ONERINGAI_PPTX_FIXTURE: path.join(root, 'docs/architecture.pptx'), ONERINGAI_PROBE_OPTIONAL_SDKS: '1',
  });
  report.optionalSdkProbe = JSON.parse(optionalOutput.trim().split('\n').at(-1));
  const peerAudit = JSON.parse(await command(npm, ['audit', '--omit=dev', '--json', '--cache', cache], consumer, true));
  await writeFile(path.join(work, 'optional-sdk-audit.json'), JSON.stringify(peerAudit, null, 2) + '\n');
  report.optionalSdkAudit = await checkConsumerAudit(peerAudit, consumer);
  report.status = 'pass';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  if (reportFile) await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!process.argv.includes('--keep-temp')) await rm(work, { recursive: true, force: true });
}
