// Cross-platform launch with ordered builds, no renderer-server race, and no shell.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preview = process.argv.includes('--preview');
const dev = process.argv.includes('--dev');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Start hosea through npm run design or npm run dev.');
const env = { ...process.env };
// Electron's CLI cannot run under the host's ELECTRON_RUN_AS_NODE setting.
delete env.ELECTRON_RUN_AS_NODE;
if (preview) {
  env.HOSEA_DATA_DIR = resolve(root, '.preview-data');
  env.HOSEA_DESIGN_PREVIEW = '1';
  delete env.HOSEA_ENABLE_BACKEND;
}
function run(command, args, extra = {}) {
  return spawn(command, args, { cwd: root, env, stdio: 'inherit', ...extra });
}
function completion(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Process ended: ${signal || code}`)));
  });
}
await completion(run(process.execPath, [npmCli, 'run', dev ? 'build:main' : 'build']));
let server;
let desktop;
const stop = () => { desktop?.kill(); void server?.close(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  if (dev) {
    const { createServer } = await import('vite');
    server = await createServer({ configFile: resolve(root, 'vite.config.ts') });
    await server.listen();
    server.printUrls();
  }
  const require = createRequire(import.meta.url);
  desktop = run(require('electron'), ['.', ...(dev ? ['--dev'] : [])]);
  await completion(desktop);
} finally { desktop?.kill(); await server?.close(); }
