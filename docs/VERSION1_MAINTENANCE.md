# OneRingAI v1 maintenance releases

`version1` was created from `main` at
`6b0654200abee38b81b7850a2953fd985b017980` (published release 1.2.1) on
2026-11-01. It maintains the existing **`@everworker/oneringai`** npm package
during the migration period. Its package name, 1.x version, public exports and
runtime behavior remain unchanged by this branch setup.

## Source and package relationship

- Legacy package: `@everworker/oneringai`; maintenance source: `version1`.
- Future v2 package: unscoped `oneringai`; the user plans a later `version2` to
  `main` merge and separate release. This setup performs neither action.
- npm publishes immutable versioned snapshots, not live Git branches. A commit or
  push here does not publish a package or change installed consumers.
- Future v1 package metadata points its repository/homepage at `version1`.
  Metadata already published in 1.2.1 remains unchanged until a new maintenance
  release is explicitly published. No version bump or deprecation is part of setup.

## Maintenance workflow

1. Start fixes from `version1`, preferably on a short feature branch. Keep supported
   v1 APIs/defaults and application behavior intact. Do not merge the v2 development
   branch to obtain a maintenance fix; port the smallest compatible correction.
2. Run the relevant regression checks and review the change, then integrate it into
   `version1`. Resolve generated documentation changes before the release.
3. Use an attached `version1` checkout when cutting a release:

   ```bash
   git switch version1
   git pull --ff-only origin version1
   npm install
   npm run release:verify-branch
   npm run release:test
   npm run build
   npm run typecheck
   npm run lint
   npm run test:unit
   npm run examples:check
   ```

   The repository currently ignores dependency lockfiles; do not assume `npm ci`
   is available. Installation's existing prepare hook builds the library.
4. Commit reviewed changes and verify a clean working tree. When a maintenance
   release is explicitly requested, run `npm run release:patch`. The existing
   version lifecycle builds, updates generated files, commits, tags and pushes;
   it is not a preview command. Use a minor release only for an intentionally
   approved compatible 1.x addition. New major releases are blocked on this branch.
5. Check `npm run release:verify-tag`, then use the existing authenticated manual
   publication process: `npm publish --access public`. Its prepublish hook first
   verifies the maintenance branch/identity and runs the release-guard tests, then
   rebuilds, typechecks, runs units, generates docs and verifies tag/clean-tree state.
   npm may require interactive 2FA. No new CI publisher/token is introduced here.
6. Verify the published package's version, integrity, source and clean-consumer
   installation. Keep release notes and migration/support commitments accurate.

## Release boundaries

The guard requires all of the following before publication:

- package name exactly `@everworker/oneringai`;
- a 1.x version;
- an attached branch named exactly `version1`;
- release tag `v<package-version>` pointing at HEAD;
- no tracked or untracked changes.

Branch/identity checks also run before the version lifecycle and before generation
after a version change. They reject `main`, `version2`, detached/tag-only checkouts,
the unscoped package and 2.x versions. Scripts locate their own repository, so a
different caller working directory cannot select a different Git checkout.

These are repository-side safeguards, not an npm account policy that forbids an
authorized maintainer from deliberately bypassing lifecycle scripts. There is no
automatic publishing workflow, new npm package, new release, changed dist-tag,
deprecation notice or `version2` merge in this setup. Existing v1 remains supported
for the migration period; no end date is invented.
