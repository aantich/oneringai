/** Local documentation checks. No network or provider calls. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0'))]
  .filter(file => file.endsWith('.md') && existsSync(path.join(root, file)));
const failures = [];
const documents = new Map();
const slug = value => value.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
function document(file) {
  if (documents.has(file)) return documents.get(file);
  const source = readFileSync(path.join(root, file), 'utf8');
  let fence;
  const lines = source.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1][0]; else if (fence === marker[1][0]) fence = undefined; return ''; }
    return fence ? '' : line;
  });
  const anchors = new Set(); const counts = new Map();
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/);
    if (heading) {
      const base = slug(heading[1]); let id = base; let suffix = counts.get(base) ?? 0;
      while (anchors.has(id)) id = `${base}-${++suffix}`;
      counts.set(base, suffix); anchors.add(id);
    }
    for (const match of line.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1]);
  }
  const result = { source, lines, anchors }; documents.set(file, result); return result;
}
function checkLink(file, line, raw) {
  let target = raw.trim().replace(/^<|>$/g, '');
  if (!target || target.startsWith('//')) return;
  if (/^https?:\/\/(?:github\.com\/(?:aantich|Integrail|everworker)\/oneringai\/(?:blob|tree)\/|raw\.githubusercontent\.com\/(?:aantich|Integrail|everworker)\/oneringai\/)/i.test(target)) {
    const npmException = file === 'README.md' && /^https:\/\/github\.com\/aantich\/oneringai\/blob\/(?:main|version1)\/README\.md$/.test(target);
    if (!npmException) failures.push(`${file}:${line}: internal repository link must be relative: ${target}`);
    return;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return;
  const [pathname, fragment] = target.split('#', 2);
  let decoded;
  try { decoded = decodeURIComponent(pathname.split('?')[0]); } catch { failures.push(`${file}:${line}: invalid URL escape: ${target}`); return; }
  const absolute = path.resolve(root, path.dirname(file), decoded || path.basename(file));
  const resolved = path.relative(root, absolute);
  if (resolved.startsWith('..') || !existsSync(absolute)) { failures.push(`${file}:${line}: missing relative target: ${target}`); return; }
  if (fragment && resolved.endsWith('.md') && statSync(absolute).isFile()) {
    let id; try { id = decodeURIComponent(fragment); } catch { id = fragment; }
    if (!document(resolved).anchors.has(id)) failures.push(`${file}:${line}: missing anchor: ${target}`);
  }
}
for (const file of files) {
  const doc = document(file);
  for (const [index, line] of doc.lines.entries()) {
    // Inline/reference Markdown links, images, and HTML navigation; fenced examples are excluded.
    for (const match of line.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/g)) checkLink(file, index + 1, match[1]);
    for (const match of line.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/g)) checkLink(file, index + 1, match[1]);
    for (const match of line.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) checkLink(file, index + 1, match[1]);
  }
}
// Documented checkout commands must exist; this never executes them.
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const file of ['README.md', 'USER_GUIDE.md', 'examples/README.md']) {
  for (const match of document(file).source.matchAll(/npm run ([\w:-]+)/g)) {
    if (!(match[1] in manifest.scripts)) failures.push(`${file}: unknown npm script ${match[1]}`);
  }
}
// Parse every current README/guide TS block and verify all named package imports.
// Selected complete examples are additionally typechecked against built public declarations.
const packageFile = path.join(root, 'dist/index.d.ts');
if (!existsSync(packageFile)) failures.push('Build first: dist/index.d.ts is required for public-import validation.');
else {
  const options = { strict: true, verbatimModuleSyntax: true, skipLibCheck: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ['node'] };
  const declarationProgram = ts.createProgram([packageFile], options);
  const checker = declarationProgram.getTypeChecker();
  const sourceFile = declarationProgram.getSourceFile(packageFile);
  const publicNames = new Set(checker.getExportsOfModule(checker.getSymbolAtLocation(sourceFile)).map(symbol => symbol.name));
  const complete = new Map(); let blocks = 0;
  for (const file of ['README.md', 'USER_GUIDE.md']) {
    for (const match of document(file).source.matchAll(/^```(?:typescript|ts)\s*\n([\s\S]*?)^```/gm)) {
      const line = document(file).source.slice(0, match.index).split('\n').length;
      const content = match[1]; blocks++;
      const parsed = ts.createSourceFile('snippet.ts', content, ts.ScriptTarget.Latest, true);
      for (const diagnostic of parsed.parseDiagnostics) failures.push(`${file}:${line}: invalid TypeScript: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
      for (const statement of parsed.statements) {
        if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === 'oneringai' && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
          for (const element of statement.importClause.namedBindings.elements) {
            const name = (element.propertyName ?? element.name).text;
            if (!publicNames.has(name)) failures.push(`${file}:${line}: oneringai does not export ${name}`);
          }
        }
      }
      if (file === 'README.md' || content.includes('// Documentation check: complete example')) {
        complete.set(path.join(root, `documentation-snippet-${complete.size}.mts`), content + '\nexport {};\n');
      }
    }
  }
  const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) => complete.has(file) ? ts.createSourceFile(file, complete.get(file), languageVersion, true) : original(file, languageVersion, onError, shouldCreate);
  const program = ts.createProgram([...complete.keys()], options, host);
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) failures.push(ts.formatDiagnostic(diagnostic, { getCurrentDirectory: () => root, getCanonicalFileName: value => value, getNewLine: () => '\n' }).trim());
  console.log(`Checked ${blocks} TypeScript blocks and ${complete.size} complete examples against the built public API.`);
}
if (failures.length) {
  console.error(failures.join('\n')); console.error(`${failures.length} documentation failure(s).`); process.exitCode = 1;
} else console.log(`Checked relative paths, Markdown anchors, and branch-link policy in ${files.length} Markdown files.`);
