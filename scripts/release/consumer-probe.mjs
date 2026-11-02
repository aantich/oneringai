import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imagePdfFixture } from './pdf-fixture.mjs';
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('Consumer probe must remain offline'); };
const sdkModules = [];
const require=createRequire(import.meta.url);
const packageRoot=path.join(path.dirname(fileURLToPath(import.meta.url)),'node_modules/oneringai');
const pkg=JSON.parse(await readFile(path.join(packageRoot,'package.json'),'utf8'));
assert.equal(pkg.name,'oneringai');assert.equal(pkg.version, process.env.ONERINGAI_EXPECTED_VERSION);
const entries=Object.keys(pkg.exports).map(key=>key==='.'?'oneringai':`oneringai/${key.slice(2)}`);
for(const entry of entries){assert.ok(await import(entry));assert.ok(require(entry));}
for(const load of [entry=>import(entry),async entry=>require(entry)]){
 const root=await load('oneringai'),runtime=await load('oneringai/agent-runtime');
 for(const name of ['Agent','Connector','ModelTask','FileEvidenceStorage','ContextCompactionStrategy','createAgentPreset','createRoutineRunner','createOrchestratorWithFactory','createOutcomeTool'])assert.ok(root[name],name);
 root.Connector.create({name:'offline-consumer',vendor:root.Vendor.OpenAI,auth:{type:'api_key',apiKey:'offline-only'}});
 const instance=new runtime.AgentRuntime({backend:new runtime.LocalExecutionBackend({drivers:[new runtime.OneRingAIDriver({trustAgentPolicy:true})]})});
 try{await instance.createAgent({id:'consumer',instructions:'offline'}).inspect({execution:{driver:'oneringai.agent',connector:'offline-consumer',model:'gpt-4.1'},context:{},policy:{filesystem:'denied',commands:'denied',sandboxNetwork:'denied',providerWebSearch:'denied',approvals:'deny'}});}finally{await instance.destroy();root.Connector.remove('offline-consumer');}
}
for(const file of ['README.md','USER_GUIDE.md','AGENTS.md','CLAUDE.md','API_REFERENCE.md','MCP_INTEGRATION.md','docs/MIGRATION_V1_HISTORY.md','docs/RELEASE_READINESS_V2.md','apps/amos/README.md','apps/amos/docs/AGENT_RUNTIME.md','apps/hosea/README.md','apps/hosea/docs/DESIGN_SYSTEM.md','apps/hosea/docs/BACKEND_INTEGRATION.md'])await access(path.join(packageRoot,file));
const license=(await readFile(path.join(packageRoot,'LICENSE'),'utf8')).trim();for(const app of ['amos','hosea'])assert.equal((await readFile(path.join(packageRoot,`apps/${app}/LICENSE`),'utf8')).trim(),license);
assert.throws(()=>require.resolve('@everworker/oneringai'));
await documentProbe((await import('oneringai')).DocumentReader);
await documentProbe(require('oneringai').DocumentReader);
if (process.env.ONERINGAI_PROBE_OPTIONAL_SDKS === '1') {
  const { Codex } = await import('@openai/codex-sdk');
  assert.equal(typeof new Codex({ apiKey: 'offline-only' }).startThread, 'function');
  assert.equal(typeof (await import('@anthropic-ai/claude-agent-sdk')).query, 'function');
  sdkModules.push('@openai/codex-sdk', '@anthropic-ai/claude-agent-sdk');
}
assert.equal(networkAttempts, 0, 'Unexpected network access from offline consumer probe');
console.log(JSON.stringify({node:process.version,sdkModules,documents:['csv','xlsx','docx','pptx','odt','odp','ods','rtf','pdf'],status:'pass',entries:entries.length,formats:['esm','cjs'],documentsBothFormats:true,publicSymbols:true,connectorIdentity:true,documentation:true,MITLicenses:true,legacyPackageAbsent:true,providerCalls:0}));

async function documentProbe(DocumentReader) {
 const dependencyRequire = createRequire(path.join(packageRoot, 'package.json'));
 const reader = DocumentReader.create();
 const read = async (buffer, filename, expected, options = {}) => {
  const result = await reader.read({ type: 'buffer', buffer, filename }, options);
  const text = result.pieces.filter(piece => piece.type === 'text').map(piece => piece.content).join('\n');
  assert.ok(text.includes(expected), `${filename}: missing expected text`);
  return text;
 };
 await read(Buffer.from('Name,Value\nrelease,42\n'), 'release.csv', 'release');
 const ExcelJS = dependencyRequire('exceljs');
 const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Release');
 sheet.addRow(['Name', 'Value']); sheet.addRow(['release', 42]);
 sheet.getCell('C1').value = 'Calculated'; sheet.getCell('C2').value = { formula: 'B2*2', result: 84 };
 const xlsx = Buffer.from(await book.xlsx.writeBuffer());
 assert.ok((await read(xlsx, 'release.xlsx', 'release', { pages: ['Release'] })).includes('84'));
 assert.ok((await read(xlsx, 'formulas.xlsx', 'release', { formatOptions: { excel: { includeFormulas: true } } })).includes('B2*2'));
 const officeRequire = createRequire(dependencyRequire.resolve('officeparser'));
 const { zipSync, strToU8 } = officeRequire('fflate');
 const docx = Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>release-docx</w:t></w:r></w:p></w:body></w:document>'),
 }));
 await read(docx, 'release.docx', 'release-docx');
 const namespaces = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
 for (const [extension, family, body] of [
   ['odt', 'text', '<office:text><text:p>release-odt</text:p></office:text>'],
   ['odp', 'presentation', '<office:presentation><draw:page draw:name="Release"><draw:frame><draw:text-box><text:p>release-odp</text:p></draw:text-box></draw:frame></draw:page></office:presentation>'],
   ['ods', 'spreadsheet', '<office:spreadsheet><table:table table:name="Release"><table:table-row><table:table-cell office:value-type="string"><text:p>release-ods</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>'],
 ]) {
   const mime = `application/vnd.oasis.opendocument.${family}`;
   const buffer = Buffer.from(zipSync({
     mimetype: [strToU8(mime), { level: 0 }],
     'content.xml': strToU8(`<office:document-content ${namespaces} office:version="1.2"><office:body>${body}</office:body></office:document-content>`),
     'META-INF/manifest.xml': strToU8(`<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`),
   }));
   await read(buffer, `release.${extension}`, `release-${extension}`);
 }
 await read(Buffer.from('{\\rtf1\\ansi release-rtf\\par}'), 'release.rtf', 'release-rtf');
 const pptx = await readFile(process.env.ONERINGAI_PPTX_FIXTURE);
 const slides = await reader.read({ type: 'buffer', buffer: pptx, filename: 'architecture.pptx' });
 assert.ok(slides.pieces.some(piece => piece.type === 'text' && piece.content.trim().length > 20));
 const result = await reader.read({ type: 'buffer', buffer: imagePdfFixture(), filename: 'images.pdf' }, {
   pages: [2], imageFilter: { minWidth: 1, minHeight: 1, minSizeBytes: 0 },
 });
 const images = result.pieces.filter(piece => piece.type === 'image');
 assert.equal(images.length, 1); assert.equal(images[0].metadata.section, 'Page 2');
 const { PNG } = dependencyRequire('pngjs');
 const png = PNG.sync.read(Buffer.from(images[0].base64, 'base64'));
 assert.deepEqual([...png.data.subarray(0, 4)], [80, 80, 80, 255]);
 assert.ok(result.pieces.some(piece => piece.type === 'text' && piece.content.includes('release-pdf-2')));
}
