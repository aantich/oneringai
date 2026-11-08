// Offline tarball verification. Dependencies are reused, never installed/fetched.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, symlink, copyFile, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { verifyBuild } from './release/bundle-provenance.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const work = await mkdtemp(join(tmpdir(), 'oneringai-browser-package-'));
const command = (program, args, cwd = work) => execFileSync(program, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
const report = { node: [], declarations: [], portableExports: {}, boundaries: {}, dependencies: 'reused local dependencies; no clean-install claim' };
try {
  const [packed] = JSON.parse(command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work, '--cache', join(work, 'cache')], root));
  const modules = join(work, 'node_modules'), installed = join(modules, 'oneringai');
  await mkdir(installed, { recursive: true });
  command('tar', ['-xzf', join(work, packed.filename), '-C', installed, '--strip-components=1']);
  const provenance = await verifyBuild(join(installed, 'dist'));
  report.bundledDependencies = { packages: provenance.packages.length, artifacts: Object.keys(provenance.artifacts).length };
  for (const file of ['docs/BROWSER_AGENTS.md', 'README.md', 'USER_GUIDE.md', 'API_REFERENCE.md', 'docs/evaluations/BROWSER_NODE_VALIDATION_2026_11_08.json', 'docs/evaluations/BETA_READINESS_FIXES_2026_11_08.json', 'docs/evaluations/BETA2_RELEASE_VALIDATION_2026_11_08.json', 'examples/browser-node/shared.ts']) {
    if (!(await readFile(join(root,file))).equals(await readFile(join(installed,file)))) throw new Error(`Packed documentation/example differs: ${file}`);
  }
  for (const dependency of await readdir(join(root, 'node_modules'))) if (!['oneringai', '.bin'].includes(dependency)) await symlink(join(root, 'node_modules', dependency), join(modules, dependency));
  await writeFile(join(work, 'package.json'), '{"type":"module","private":true}');
  await writeFile(join(work, 'native.mjs'), `
    import * as esm from 'oneringai'; import { createRequire } from 'node:module';
    import * as esmRuntime from 'oneringai/agent-runtime';
    const require = createRequire(import.meta.url), cjs = require('oneringai');
    if (!esm.FileContextStorage || !cjs.FileContextStorage || !esm.FileEvidenceStorage) throw Error('Node default export missing');
    for (const api of [esm,cjs]) {
      class Extension extends api.InMemoryEvidenceStorage { async writeBlob(id, bytes) { if (!Buffer.isBuffer(bytes)) throw Error('Protected Buffer contract changed'); return super.writeBlob(id,bytes); } }
      const store = new Extension({scope:{ownerId:'owner',namespace:'packed'}});
      await store.put({version:1,recordedAt:1,source:{toolName:'probe',executionId:'one',effect:'read',status:'succeeded',completion:'settled',startedAt:1,durationMs:0,arguments:{},principal:{}},result:{ok:true}});
      const name = 'pack-'+Math.random(); api.Connector.create({name,vendor:api.Vendor.OpenAI,auth:{type:'none'}});
      const runtimeApi=api===esm?esmRuntime:require('oneringai/agent-runtime');
      const runtime=new runtimeApi.AgentRuntime({backend:new runtimeApi.LocalExecutionBackend({drivers:[new runtimeApi.OneRingAIDriver({trustAgentPolicy:true})]})});
      try { await runtime.createAgent({id:'identity',instructions:''}).inspect({execution:{driver:'oneringai.agent',connector:name,model:'gpt-4'},context:{},policy:{filesystem:'denied',commands:'denied',sandboxNetwork:'denied',providerWebSearch:'denied',approvals:'deny'}}); } finally {await runtime.destroy();}
      const agent = api.Agent.create({connector:name,model:'gpt-4o-mini'}); if(agent.tools!==agent.context.tools) throw Error('Tool singleton'); agent.destroy();api.Connector.remove(name);
    }
    console.log(JSON.stringify({node:process.version,esm:true,cjs:true,protectedBuffer:true}));
  `);
  const nodes = [...new Set([process.execPath, process.env.ONERINGAI_NODE22].filter(Boolean))];
  for (const node of nodes) report.node.push(JSON.parse(command(node, ['native.mjs']).trim().split('\n').at(-1)));
  const fixture = join(work, 'consumer'); await mkdir(fixture);
  for (const file of ['page.ts', 'worker.ts', 'shared.ts', 'tsconfig.page.json', 'tsconfig.worker.json']) await copyFile(join(root, 'tests/fixtures/browser-consumer', file), join(fixture, file));
  // Runtime regressions are verified by the host matrix; this isolated fixture
  // deliberately checks the shipped declaration graph only.
  const shared = await readFile(join(fixture, 'shared.ts'), 'utf8');
  await writeFile(join(fixture, 'shared.ts'), shared.replace(/^export \{ runPluginRegressions.*\n/m, ''));
  await writeFile(join(fixture, 'exports.ts'), `import * as shared from 'oneringai/shared'; import * as types from 'oneringai/types'; void shared; void types;`);
  const canonicalConfig = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  const canonicalOptions = ts.parseJsonConfigFileContent(canonicalConfig.config, ts.sys, root).options;
  const canonical = ts.createProgram(['shared', 'types'].map(name => join(root, `src/${name}/index.ts`)), canonicalOptions);
  const exportNames = (program, symbol) => program.getTypeChecker().getExportsOfModule(symbol).map(value => value.name).sort();
  await writeFile(join(fixture, 'native.ts'), `import type {IMediaStorage,TTSResponse,ImageEditOptions,VideoGenerateOptions,EmbeddingContentPart} from 'oneringai'; import {InMemoryEvidenceStorage,FileEvidenceStorage} from 'oneringai';
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    const bufferContract: Equal<Parameters<IMediaStorage['save']>[0],Buffer> = true; void bufferContract;
    const audioContract: Equal<TTSResponse['audio'],Buffer> = true; void audioContract;
    const imageContract: Equal<ImageEditOptions['image'],Buffer|string> = true; void imageContract;
    const videoContract: Equal<VideoGenerateOptions['image'],Buffer|string|undefined> = true; void videoContract;
    const embeddingContract: Equal<Extract<EmbeddingContentPart,{data:unknown}>['data'],Buffer|string> = true; void embeddingContract;
    class Extension extends InMemoryEvidenceStorage { protected override async writeBlob(id:string, bytes:Buffer):Promise<void>{await super.writeBlob(id,bytes);} protected override async readBlob(id:string):Promise<Buffer|null>{return super.readBlob(id);} } void Extension;
    class FileExtension extends FileEvidenceStorage { protected override async writeBlob(id:string, bytes:Buffer):Promise<void>{await super.writeBlob(id,bytes);} protected override async readBlob(id:string):Promise<Buffer|null>{return super.readBlob(id);} } void FileExtension;`);
  function compile(name, config) {
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, fixture);
    const program = ts.createProgram(parsed.fileNames, parsed.options), diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => work, getCanonicalFileName: value => value, getNewLine: () => '\n' }));
    if (name !== 'node' && program.getSourceFiles().some(file => /@types\/node\//.test(file.fileName))) throw new Error(`${name} declarations loaded Node ambient types`);
    if (name !== 'node') {
      const checker = program.getTypeChecker(), imports = program.getSourceFile(join(fixture, 'exports.ts'));
      for (const statement of imports.statements.filter(ts.isImportDeclaration)) {
        const subpath = statement.moduleSpecifier.text.split('/')[1];
        const actual = exportNames(program, checker.getSymbolAtLocation(statement.moduleSpecifier));
        const expected = exportNames(canonical, canonical.getTypeChecker().getSymbolAtLocation(canonical.getSourceFile(join(root, `src/${subpath}/index.ts`))));
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name} ${subpath} export parity failed`);
        report.portableExports[subpath] = { declarations: actual.length };
      }
    }
    report.declarations.push({ host: name, files: program.getSourceFiles().length, nodeAmbient: name === 'node' });
  }
  for (const name of ['page','worker']) {
    const config = JSON.parse(await readFile(join(fixture, `tsconfig.${name}.json`), 'utf8'));
    config.files.push('exports.ts'); compile(name, config);
  }
  compile('node', { compilerOptions: { strict:true,noEmit:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',types:['node'],skipLibCheck:false }, files:['native.ts'] });
  const entry = join(work, 'browser.ts');
  const runtimeNames = {};
  for (const subpath of ['shared', 'types']) runtimeNames[subpath] = JSON.parse(command(process.execPath, ['--input-type=module', '-e', `import * as api from 'oneringai/${subpath}'; console.log(JSON.stringify(Object.keys(api).sort()));`]));
  await writeFile(entry, `import * as root from 'oneringai'; import * as shared from 'oneringai/shared'; import * as types from 'oneringai/types';
    for (const [name, api] of Object.entries({shared,types})) if(JSON.stringify(Object.keys(api).sort())!==JSON.stringify(${JSON.stringify(runtimeNames)}[name])) throw Error(name+' runtime export parity');
    if(root.Vendor!==shared.Vendor||root.Vendor!==types.Vendor||root.Services!==shared.Services) throw Error('browser singleton'); globalThis.packedAgent = root.Agent;`);
  await copyFile(entry, join(work, 'browser-exports.mjs'));
  command(process.execPath, ['--conditions=browser', 'browser-exports.mjs']);
  for (const subpath of ['shared', 'types']) report.portableExports[subpath].runtime = runtimeNames[subpath].length;
  const browser = await build({ absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,metafile:true,platform:'browser',format:'esm' });
  const inputs = Object.keys(browser.metafile.inputs);
  if (!inputs.some(path=>path.endsWith('/dist/browser/index.js')) || inputs.some(path=> /\/dist\/index\.(js|cjs)$|mongodb|officeparser|pdfjs-dist|node:/.test(path))) throw new Error('Browser boundary pulled Node/server modules');
  const sources = new Set();
  const resolvedInstalled = await realpath(installed);
  for (const input of inputs.map(path => resolve(root,path)).filter(path => path.startsWith(resolvedInstalled))) {
    const map = JSON.parse(await readFile(input + '.map', 'utf8'));
    map.sources.forEach(source => sources.add(source));
  }
  if (sources.size < 100) throw new Error('Browser source-map dependency inventory missing');
  if ([...sources].some(source => /mongodb|officeparser|pdfjs-dist|FileEvidenceStorage|FileContextStorage|OAuthManager|VertexTextProvider|@openai\/codex-sdk|claude-agent-sdk/.test(source))) throw new Error('Browser source graph contains a host-only implementation');
  const server = await build({ entryPoints:[entry],bundle:true,write:false,metafile:true,platform:'node',format:'esm',packages:'external' });
  report.boundaries = { browserInputs:inputs.length, browserBytes:browser.outputFiles[0].contents.length, serverPackageImport:server.outputFiles[0].text.includes('from "oneringai"'), browserRoot:true,
    originalSources: sources.size, dependencySources: [...sources].filter(source => source.includes('node_modules/')).sort() };
  report.passed = true;
  if(process.argv[2]) await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally { await rm(work,{recursive:true,force:true}); }
