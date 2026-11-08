import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { verifyBuild, checkBundledAudit } from './bundle-provenance.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const record = await verifyBuild(join(root, 'dist'), root);
let output;
try { output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--omit=dev', '--json'], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 }); }
catch (error) { if (error.status !== 1) throw error; output = error.stdout; }
console.log(JSON.stringify(checkBundledAudit(record, JSON.parse(output)), null, 2));
