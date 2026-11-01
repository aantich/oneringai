import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'oneringai-version1-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  for (const script of ['verify-version1.mjs', 'verify-release-tag.mjs']) {
    copyFileSync(new URL(`../../scripts/${script}`, import.meta.url), path.join(root, 'scripts', script));
  }
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@everworker/oneringai', version: '1.2.99', type: 'module' }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet', '--initial-branch=version1');
  git('config', 'user.name', 'Release Guard Test');
  git('config', 'user.email', 'release-guard@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'core.hooksPath', path.join(root, 'no-hooks'));
  git('add', '.');
  git('commit', '--quiet', '-m', 'Release fixture');
  git('tag', 'v1.2.99');
  return { root, git };
}

function run(root, script = 'verify-version1.mjs', cwd = root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', script)], { cwd, encoding: 'utf8' });
}

test('accepts scoped 1.x on version1 and a matching clean release tag', t => {
  const { root } = fixture(t);
  assert.equal(run(root).status, 0);
  const result = run(root, 'verify-release-tag.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified v1\.2\.99/);
});

for (const branch of ['main', 'version2']) {
  test(`rejects legacy publication from ${branch}`, t => {
    const { root, git } = fixture(t);
    git('switch', '-c', branch);
    const result = run(root, 'verify-release-tag.mjs');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must run from version1/);
  });
}

for (const identity of [
  { name: 'oneringai', version: '1.2.99' },
  { name: '@everworker/oneringai', version: '2.0.0' },
]) {
  test(`rejects ${identity.name}@${identity.version} even on version1`, t => {
    const { root } = fixture(t);
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(identity));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /require @everworker\/oneringai with a 1\.x version/);
  });
}

test('rejects detached tag checkouts', t => {
  const { root, git } = fixture(t);
  git('switch', '--detach', 'v1.2.99');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /detached HEAD is not allowed/);
});

test('rejects a missing release tag', t => {
  const { root, git } = fixture(t);
  git('tag', '-d', 'v1.2.99');
  const result = run(root, 'verify-release-tag.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release tag v1\.2\.99 is missing/);
});

test('rejects a tag that points to an earlier commit', t => {
  const { root, git } = fixture(t);
  writeFileSync(path.join(root, 'fix.txt'), 'maintenance fix');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Later fix');
  const result = run(root, 'verify-release-tag.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /but HEAD is/);
});

test('rejects an untracked or modified working tree', t => {
  const { root } = fixture(t);
  writeFileSync(path.join(root, 'unreviewed.txt'), 'unreviewed');
  const result = run(root, 'verify-release-tag.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to publish from a dirty worktree/);
});

test('checks the script repository when invoked from another working directory', t => {
  const { root } = fixture(t);
  const result = run(root, 'verify-release-tag.mjs', tmpdir());
  assert.equal(result.status, 0, result.stderr);
});

test('package lifecycle invokes branch and regression gates before publishing', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  for (const hook of ['preversion', 'prepublishOnly']) {
    assert.match(manifest.scripts[hook], /^npm run release:verify-branch && npm run release:test && /);
  }
  assert.match(manifest.scripts.version, /^npm run release:verify-branch && /);
  assert.doesNotMatch(manifest.scripts['release:major'], /npm version major/);
  assert.equal(manifest.repository.url, 'git+https://github.com/aantich/oneringai.git#version1');
});
