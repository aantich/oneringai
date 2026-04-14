# Releasing Everworker Desktop

This document describes how to release new versions of the Everworker Desktop desktop application.

## Prerequisites

1. **Node.js 18+** installed
2. **Clean git state** - no uncommitted changes
3. For distribution builds:
   - **macOS**: Xcode Command Line Tools
   - **Windows**: Visual Studio Build Tools
   - **Linux**: Required build packages

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
# From apps/hosea directory

# Patch release (bug fixes)
npm run release:patch

# Minor release (new features)
npm run release:minor

# Major release (breaking changes)
npm run release:major
```

This will:
- Build the application
- Run typecheck
- Bump version in `package.json`
- Create git commit with message "hosea: Release vX.Y.Z"
- Create git tag `hosea-vX.Y.Z`
- Push commit and tag to GitHub

### 4. Build and Publish to GitHub Releases

Build all platform installers and publish directly to GitHub:

```bash
# Set GitHub token (fine-grained token with Contents read/write permission)
export GH_TOKEN=your_github_token

# Build all platforms and publish to GitHub Releases
npx electron-builder --mac --win --linux --publish always
```

This will:
- Build installers for all platforms
- Create a draft GitHub Release
- Upload all installer files
- Upload `latest*.yml` files for auto-updater

**Output files:**
| Platform | File | Typical Size |
|----------|------|--------------|
| macOS (Apple Silicon) | `Everworker Desktop-X.Y.Z-arm64.dmg` | ~180MB |
| Windows | `Everworker Desktop Setup X.Y.Z.exe` | ~150MB |
| Linux | `Everworker Desktop-X.Y.Z-arm64.AppImage` | ~200MB |

### 5. Finalize GitHub Release

After electron-builder uploads the files:

1. Go to https://github.com/aantich/oneringai/releases
2. Find the draft release (will be named by version number)
3. Edit the release:
   - **Tag**: Change to `hosea-vX.Y.Z`
   - **Title**: "Everworker Desktop vX.Y.Z"
   - **Description**: Add changelog entries and download instructions
4. Uncheck "Set as a pre-release" if this is a stable release
5. Click "Publish release"

**Or use the API** (automated):
```bash
# Get release ID and publish
RELEASE_ID=$(curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/aantich/oneringai/releases" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

curl -X PATCH \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/aantich/oneringai/releases/$RELEASE_ID" \
  -d '{"tag_name": "hosea-vX.Y.Z", "name": "Everworker Desktop vX.Y.Z", "draft": false}'
```

## Quick Reference

```bash
# Full release flow (example: patch)
cd apps/hosea

# 1. Edit CHANGELOG.md
# 2. Bump version and push tag:
npm run release:patch

# 3. Build and publish to GitHub:
export GH_TOKEN=your_github_token
npx electron-builder --mac --win --linux --publish always

# 4. Finalize the release on GitHub (set tag, title, publish)
```

## GitHub Token Setup

You need a **fine-grained personal access token** with:
- **Repository access**: `aantich/oneringai`
- **Permissions**: Contents (Read and write)

To create one:
1. Go to https://github.com/settings/tokens?type=beta
2. Click "Generate new token"
3. Select repository: `aantich/oneringai`
4. Under "Permissions" → "Repository permissions" → "Contents": Read and write
5. Generate and save the token securely

## Development vs Production

| Aspect | Development | Production |
|--------|-------------|------------|
| Core library | `file:../..` (local) | `file:../..` (local) |
| Build command | `npm run dev` | `npm run build && npm run package` |
| Output | Hot-reload dev server | `release/*.dmg/exe/AppImage` |

**Note:** Everworker Desktop always uses the local `@everworker/oneringai` library, not the npm-published version.

## App Info

| Field | Value |
|-------|-------|
| **Package** | `@everworker/hosea` |
| **App ID** | `ai.everworker.hosea` |
| **Product Name** | Everworker Desktop |
| **GitHub** | https://github.com/aantich/oneringai/tree/main/apps/hosea |

## Build Configuration

### Critical: File Exclusions

Everworker Desktop uses a local file dependency (`@everworker/oneringai: "file:../.."`). Without proper exclusions, electron-builder would include the **entire parent repository** (~9GB) including:
- The `apps/` folder (recursive nightmare - hosea inside oneringai inside hosea)
- Source files, tests, coverage reports
- Documentation and examples

The `package.json` build config includes exclusions to only bundle the necessary `dist/` folder:

```json
"files": [
  "dist/**/*",
  "package.json",
  "node_modules/**/*",
  "!node_modules/@everworker/oneringai/apps/**/*",
  "!node_modules/@everworker/oneringai/src/**/*",
  "!node_modules/@everworker/oneringai/tests/**/*",
  "!node_modules/@everworker/oneringai/coverage/**/*",
  ...
]
```

**Do not remove these exclusions!** They reduce build size from ~8GB to ~180MB.

### Expected Build Sizes

| Platform | Normal Size | Problem Size |
|----------|-------------|--------------|
| macOS DMG | 150-200MB | 8-9GB (missing exclusions) |
| Windows EXE | 140-180MB | 8-9GB |
| Linux AppImage | 180-220MB | 8-9GB |

If builds exceed 500MB, check that the exclusions are in place.

## Troubleshooting

### Build fails on macOS

Ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```

### Build fails on Windows

Install Visual Studio Build Tools with "Desktop development with C++" workload.

### electron-builder signing issues

For unsigned builds (development), this is normal. For production:
- macOS: Requires Apple Developer certificate
- Windows: Requires code signing certificate

## Tag Naming Convention

Everworker Desktop uses prefixed tags to distinguish from core library releases:

- Core library: `v0.1.0`, `v0.2.0`, etc.
- Everworker Desktop: `hosea-v0.1.0`, `hosea-v0.2.0`, etc.

## Auto-Update System

Everworker Desktop includes built-in auto-update functionality via `electron-updater`.

### How It Works

1. **On app launch** (after 5s delay): Checks GitHub Releases for new versions
2. **If update available**: Shows notification in bottom-right corner
3. **User clicks Download**: Update downloads in background with progress
4. **Download complete**: User can restart to install, or defer

### Files Involved

| Component | File |
|-----------|------|
| Main process service | `src/main/AutoUpdaterService.ts` |
| Preload bridge | `src/preload/index.ts` (updater API) |
| UI component | `src/renderer/components/UpdateNotification.tsx` |
| Config | `package.json` (build.publish section) |

### Update Manifest Files

When publishing, electron-builder creates these files that the updater checks:

- `latest-mac.yml` - macOS update info
- `latest.yml` - Windows update info
- `latest-linux-arm64.yml` - Linux update info

These YAML files contain version, download URL, and checksums.

### Testing Updates

1. Install an older version of Everworker Desktop
2. Create a new release with a higher version number
3. Launch the installed app
4. After ~5 seconds, update notification should appear

### Disabling Auto-Updates (Development)

Auto-updates are disabled when running in dev mode (`--dev` flag). The check in `AutoUpdaterService` skips initialization in development.
