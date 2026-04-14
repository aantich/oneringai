# Releasing @everworker/oneringai

This document describes how to release new versions of the package to npm.

## Prerequisites

1. **npm account** with access to the `@everworker` organization
2. **npm token** configured (stored in `~/.npmrc`):
   ```bash
   npm config set //registry.npmjs.org/:_authToken=YOUR_TOKEN
   ```
3. **Clean git state** - no uncommitted changes

## Release Process

### 1. Update CHANGELOG.md

Before releasing, document changes in `CHANGELOG.md`:

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature description

### Changed
- Modified behavior description

### Fixed
- Bug fix description

### Removed
- Removed feature description
```

### 2. Choose Version Type

Follow [Semantic Versioning](https://semver.org/):

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Bug fixes, patches | `patch` | 0.1.0 → 0.1.1 |
| New features (backward compatible) | `minor` | 0.1.0 → 0.2.0 |
| Breaking changes | `major` | 0.1.0 → 1.0.0 |

### 3. Run Release Script

```bash
# Patch release (bug fixes)
npm run release:patch

# Minor release (new features)
npm run release:minor

# Major release (breaking changes)
npm run release:major
```

This will:
- Run build and typecheck
- Bump version in `package.json`
- Create git commit with message "Release vX.Y.Z"
- Create git tag `vX.Y.Z`
- Push commit and tag to GitHub

### 4. Publish to npm

```bash
npm publish
```

This runs `prepublishOnly` which:
- Builds the package (`npm run build`)
- Runs typecheck (`npm run typecheck`)
- Runs unit tests (`npm run test:unit`)

Then publishes to npm registry.

### 5. Verify

```bash
# Check npm
npm view @everworker/oneringai

# Check install works
npm install @everworker/oneringai
```

## Quick Reference

```bash
# Full release flow (example: patch)
# 1. Edit CHANGELOG.md
# 2. Run:
npm run release:patch
npm publish

# Verify
npm view @everworker/oneringai version
```

## Package Info

| Field | Value |
|-------|-------|
| **Package** | `@everworker/oneringai` |
| **npm** | https://www.npmjs.com/package/@everworker/oneringai |
| **GitHub** | https://github.com/aantich/oneringai |
| **Registry** | https://registry.npmjs.org/ |

## Troubleshooting

### "Two-factor authentication required"

Use a granular access token with "Bypass 2FA for automation" enabled:
1. Go to https://www.npmjs.com/settings/USERNAME/tokens
2. Generate new token with automation bypass
3. Configure: `npm config set //registry.npmjs.org/:_authToken=TOKEN`

### "Scope not found"

The `@everworker` organization must exist on npm. Create at https://www.npmjs.com/org/create

### Forgot to update CHANGELOG

You can amend after the fact:
```bash
# Edit CHANGELOG.md
git add CHANGELOG.md
git commit --amend --no-edit
git push --force origin main
```

## Files Published

The `files` field in `package.json` controls what's published:
- `dist/` - Built JavaScript and TypeScript declarations
- `README.md` - Package documentation (shown on npm)
- `LICENSE` - MIT license

Run `npm pack --dry-run` to preview what will be included.
