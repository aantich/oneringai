import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './verify-version1.mjs';

const packageJsonUrl = new URL('../package.json', import.meta.url);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));
const expectedTag = `v${version}`;

function git(...args) {
  return execFileSync('git', args, {
    cwd: packageRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

let taggedCommit;

try {
  taggedCommit = git('rev-parse', `${expectedTag}^{commit}`);
} catch {
  console.error(
    `Release tag ${expectedTag} is missing. Run an npm release script before publishing.`,
  );
  process.exit(1);
}

const headCommit = git('rev-parse', 'HEAD');

if (taggedCommit !== headCommit) {
  console.error(
    `Release tag ${expectedTag} points to ${taggedCommit}, but HEAD is ${headCommit}.`,
  );
  process.exit(1);
}

const worktreeStatus = git('status', '--porcelain');

if (worktreeStatus) {
  console.error('Refusing to publish from a dirty worktree:');
  console.error(worktreeStatus);
  process.exit(1);
}

console.log(`Verified ${expectedTag} at ${headCommit}.`);
