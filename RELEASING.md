# Releasing oneringai

This checklist governs the unscoped `oneringai` v2 package and its matching
[website](https://oneringai.io). Every v2 npm release, including prereleases,
requires both the documentation and main website pages to be updated and deployed.
Keep legacy v1 maintenance on `version1`; develop v2 on `main`.

Version selection, commits, pushes, npm publication and tag changes require
applicable user authorization. This checklist does not initiate a release.

## Prerequisites

- Authorized access to the unscoped npm package `oneringai`; verify with
  `npm whoami`. Store credentials through npm's supported authentication flow.
- Clean, committed library checkout with the intended release changes.
- Access to the existing website repository, `aantich/oneringaiio`, normally
  checked out beside this library at `../oneringaidotio`.
- Node.js 22.13+ or 24+ and installed development dependencies.

## Prepare and validate the package

1. Update `CHANGELOG.md`, README, User Guide, relevant recipes/examples and the
   Version 2 availability/adoption/handoff records. Keep package publication
   distinct from source availability and provider-preview boundaries.
2. Run `npm run release:check`. It builds and checks bundled dependencies,
   types, lint, units, examples, public compatibility, offline examples,
   generated public/internal API docs, documentation and installed consumers.
   Review generated changes and commit the intended release tree.
3. Complete the relevant AMOS, browser and other application gates described in
   [release readiness](docs/RELEASE_READINESS_V2.md). Offline checks do not
   establish live-provider support. Do not make billable calls without approval.
4. Select the exact authorized version. The `release:patch`, `release:minor`
   and `release:major` scripts run `npm version`; an explicit prerelease can
   use `npm version <approved-version> -m 'Release %s'`. These run lifecycle
   scripts: `preversion` builds/typechecks, `version` regenerates registries and
   the public API reference, and `postversion` pushes with `--follow-tags`.
   Running a version script therefore commits, tags and pushes.

## Publish and verify

`npm publish` runs `prepublishOnly`, which executes `release:check` and then
`release:verify-tag`. The latter requires `v<package-version>` at the exact HEAD
and a clean worktree. Do not bypass that gate. Choose the npm dist tag explicitly
for the authorized release; for example, an approved prerelease may use
`npm publish --tag next`. Moving `latest` is a separate deliberate release choice.

After publication, verify the exact version and selected tags:

```bash
npm view oneringai@<published-version> version dist.integrity
npm view oneringai dist-tags --json
```

Verify a fresh registry consumer and retain publication integrity and validation
results in the release record. Never repeat an uncertain publication without
first reconciling the registry state. Correct later documentation through normal
commits; do not rewrite an already published release tag or force-push history.

## Required v2 website handoff

Persistent user instruction (2026-11-09): **every v2 npm publication, including
prereleases, requires the corresponding website update and deployment. Both
canonical documentation and main website pages must match the published release.**

1. Finish and push any library documentation corrections. Use a clean library
   commit whose package version matches the verified npm publication. The source
   snapshot may include subsequent documentation-only corrections; record the
   snapshot separately from the release tag. Do not advertise unreleased APIs
   as part of the published version.
2. In the website checkout, refresh the recorded library snapshot and generated
   HTML. The sync script records the exact commit and version:

   ```bash
   npm run docs:sync -- ../oneringai
   npm run docs:generate
   ```

3. Review and update `src/home.html`, `src/pages/start.md`, application pages,
   navigation, installation commands, release/changelog links, feature highlights,
   preview/support boundaries and relevant metadata/social copy. Check all
   advertised capabilities against that release. Shared `{{version}}` values
   follow the pinned snapshot; authored claims still need review. A docs-only
   sync is insufficient, including when a release has no new features.
4. Run `npm run check` in the website checkout. Inspect representative desktop
   and mobile pages, both themes, contents navigation, code copying, search,
   examples and API links. Keep Analytics and the existing custom domain intact.
5. Commit and push the website changes to its existing `main` deployment line.
   Wait for the existing GitHub Actions **Build and deploy website** workflow
   and GitHub Pages deployment to succeed. No new hosting service is needed.
6. Verify the public homepage, quickstart, User Guide, Examples, API Reference
   and AMOS cookbook at `oneringai.io`. Confirm the expected version/snapshot,
   release highlights, local documentation links and generated search results.
7. Record the npm version, publication/tag revision, library documentation
   snapshot, website commit, successful deployment URL/run and verification
   results in the release handoff. **Do not mark the release handoff complete
   while the matching website is stale or deployment is unverified.** If npm
   published but deployment failed, report those outcomes separately and repair
   the website without republishing npm.

## Release references

- [Release readiness and validation](docs/RELEASE_READINESS_V2.md)
- [Version 2 availability and adoption](docs/VERSION_2_GUIDE.md)
- [Package migration](docs/PACKAGE_MIGRATION.md)
- [Changelog](CHANGELOG.md)
- [npm package](https://www.npmjs.com/package/oneringai)
- [Library source](https://github.com/aantich/oneringai)
- [Website source](https://github.com/aantich/oneringaiio)

The package's `files` allowlist owns the published contents. Use
`npm pack --dry-run` to inspect the actual inventory; do not infer it from this
checklist. Referenced API docs are generated, never hand-edited.
