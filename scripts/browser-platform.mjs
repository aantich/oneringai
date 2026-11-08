import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const selections = new Map([
  ...['primitives', 'environment', 'logFile', 'storageDefaults', 'connectorAuth', 'hostProvider', 'schemaCompiler'].map(name => [`src/infrastructure/runtime/${name}.ts`, `src/infrastructure/runtime/${name}.browser.ts`]),
  ['src/core/model-execution/invocationBinding.ts', 'src/core/model-execution/invocationBinding.browser.ts'],
  ['src/core/catalogHost.ts', 'src/core/catalogHost.browser.ts'],
  ['src/infrastructure/storage/InMemoryEvidenceStorage.ts', 'src/infrastructure/storage/InMemoryEvidenceStorage.browser.ts'],
  ['src/tools/registry.generated.ts', 'src/tools/registry.browser.generated.ts'],
].map(([source, target]) => [resolve(root, source), resolve(root, target)]));

export const browserSelections = selections;
/** Private library build wiring; applications never supply source aliases. */
export function browserPlatformPlugin() {
  return { name: 'oneringai-browser-platform', setup(builder) {
    builder.onResolve({ filter: /^util\/$/ }, () => ({ path: resolve(root, 'src/infrastructure/runtime/comparisonTypes.browser.ts') }));
    builder.onResolve({ filter: /^(?:\.\.?\/|\/)/ }, args => {
      const path = resolve(args.resolveDir || dirname(args.importer), args.path).replace(/\.js$/, '.ts');
      const selected = selections.get(path);
      return selected ? { path: selected } : undefined;
    });
  } };
}
