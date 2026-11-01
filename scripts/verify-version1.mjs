import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

if (name !== '@everworker/oneringai' || !/^1\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Legacy maintenance releases require @everworker/oneringai with a 1.x version.');
  process.exit(1);
}

let branch;
try {
  branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
} catch {
  console.error('Legacy releases require an attached version1 checkout; detached HEAD is not allowed.');
  process.exit(1);
}

if (branch !== 'version1') {
  console.error(`Legacy releases must run from version1, not ${branch}.`);
  process.exit(1);
}

console.log(`Verified ${name}@${version} on version1.`);
