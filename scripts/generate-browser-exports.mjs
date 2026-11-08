// Project the existing public root onto compatible modules. No implementations
// or public symbol definitions are duplicated. Node exports remain unchanged.
import ts from 'typescript';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options), checker = program.getTypeChecker();
// These canonical barrels already promise a portable surface. Preserve every
// export (including type-only contracts), and reuse their declarations at root.
const portableBarrels = new Set(['src/shared/index.ts', 'src/types/index.ts']);
const portableDeclarations = new Set();
for (const path of portableBarrels) {
  const module = checker.getSymbolAtLocation(program.getSourceFile(resolve(root, path)));
  for (const exported of checker.getExportsOfModule(module)) {
    portableDeclarations.add(exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported);
  }
}
function compatible(path) {
  if (/^src\/core\/(context-nextgen|model-execution|agent-loop|tool-execution|execution|orchestrator|routines|evidence)\//.test(path)) return true;
  if (/^src\/core\/permissions\//.test(path)) return !path.endsWith('/PathRestrictionPolicy.ts');
  if (/^src\/core\/(Agent|BaseAgent|Connector|ScopedConnectorRegistry|StorageRegistry|ToolCatalogRegistry|ToolManager|AgentRegistry|Vendor|createProvider|TemplateEngine|SuspendSignal|StructuredOutput|ErrorHandler|presets|capabilityInspection|routineRunner|routineControlFlow|routineKeys|createRoutineTool|createExecutionRecorder|createOutcomeTool)\.ts$/.test(path)) return true;
  if (path === 'src/access/principals.ts') return true;
  if (/^src\/domain\/entities\/(Content|Message|Response|StreamEvent|StreamState|Tool|Model|Memory|Routine|Task|Connector|Services)\.ts$/.test(path)) return true;
  if (/^src\/domain\/(errors|types)\//.test(path)) return !/(Image|Video|TTS|STT|Audio)/.test(path);
  if (/^src\/domain\/interfaces\//.test(path)) return !/(Image|Video|TTS|STT|Audio|Embedding|WebSocket|Document)/.test(path);
  if (/^src\/memory\//.test(path)) return !/adapters\/mongo|integration\/(ConnectorEmbedder|createMemorySystemWithConnectors)/.test(path);
  if (/^src\/portable\//.test(path)) return true;
  if (/^src\/capabilities\/agents\//.test(path)) return true;
  if (/^src\/infrastructure\/(observability|resilience)\//.test(path)) return true;
  if (/^src\/infrastructure\/storage\/(InMemoryStorage|InMemoryHistoryStorage|EvidenceStorageBase)\.ts$/.test(path)) return true;
  if (/^src\/infrastructure\/storage\/InMemoryEvidenceStorage/.test(path)) return true;
  if (/^src\/tools\/(json|routines|memory|connector|github|slack)\//.test(path)) return true;
  if (/^src\/tools\/(ToolRegistry|registry.generated)\.ts$/.test(path)) return true;
  if (/^src\/connectors\/vendors\//.test(path)) return true;
  if (/^src\/connectors\/oauth\/(types|domain\/ITokenStorage)\.ts$/.test(path)) return true;
  return false;
}
async function project(modulePath, name, isRoot = false) {
  const source = program.getSourceFile(resolve(root, modulePath));
  const module = checker.getSymbolAtLocation(source), groups = new Map(), inventory = [];
  for (const exported of checker.getExportsOfModule(module)) {
    const name = exported.getName();
    if (name === 'tools') continue;
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const declaration = symbol.declarations?.[0];
    if (!declaration) continue;
    let path = relative(root, declaration.getSourceFile().fileName).replace(/\\/g, '/');
    const portable = portableBarrels.has(modulePath) || portableDeclarations.has(symbol) || compatible(path);
    if (!portable || name === 'FileEvidenceStorageOptions') continue;
    const original = symbol.getName();
    const explicitType = exported.declarations?.some(declaration => ts.isExportSpecifier(declaration)
      && (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly));
    const typeOnly = explicitType || !(symbol.flags & ts.SymbolFlags.Value);
    if (path === 'src/infrastructure/storage/InMemoryEvidenceStorage.ts') path = 'src/infrastructure/storage/InMemoryEvidenceStorage.browser.ts';
    if (path === 'src/tools/registry.generated.ts') path = 'src/tools/registry.browser.generated.ts';
    const key = path + ':' + typeOnly;
    const group = groups.get(key) ?? { path, typeOnly, symbols: [] };
    group.symbols.push(original === name ? name : `${original} as ${name}`); groups.set(key, group);
    inventory.push({ name, typeOnly, source: path });
  }
  const initialization = [];
  for (const category of ['github', 'slack']) if ([...groups.values()].some(group => !group.typeOnly && group.path.startsWith(`src/tools/${category}/`))) initialization.push(`import '../tools/${category}/index.js';`);
  if ([...groups.values()].some(group => !group.typeOnly && group.path.startsWith('src/connectors/vendors/'))) initialization.push("import '../connectors/vendors/index.js';");
  const output = ['// Generated by scripts/generate-browser-exports.mjs. Do not edit.',
    '// Compatible public exports only; all implementation code is shared.',
    ...initialization,
    ...[...groups.values()].map(group => `export ${group.typeOnly ? 'type ' : ''}{ ${group.symbols.sort().join(', ')} } from '${relative(resolve(root, 'src/browser'), resolve(root, group.path)).replace(/\\/g, '/').replace(/\.ts$/, '.js')}';`),
    ...(isRoot ? ["export * as tools from './tools.js';"] : []),
  ];
  await writeFile(resolve(root, `src/browser/${name}.generated.ts`), output.join('\n') + '\n');
  await writeFile(resolve(root, `src/browser/${isRoot ? '' : name + '.'}exports.generated.json`), JSON.stringify(inventory.sort((a, b) => a.name.localeCompare(b.name)), null, 2) + '\n');
  console.log(`Generated ${inventory.length} compatible public names for ${name}`);
}
await project('src/index.ts', 'index', true);
await project('src/shared/index.ts', 'shared');
await project('src/types/index.ts', 'types');
await project('src/capabilities/agents/index.ts', 'agents');
