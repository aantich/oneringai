# v1 to the unscoped OneRingAI v2 package

The v2 package name is **`oneringai`**. Install it with `npm i oneringai` after
publication. The repository remains [aantich/oneringai](https://github.com/aantich/oneringai).
The maintainer is Anton Antic, `anton.antich@gmail.com`.

## Current availability

This branch prepares `oneringai@2.0.0-beta.1`; it has not been published. The
registry check on 2026-11-01 returned E404 for `oneringai`, while the signed-in
npm account and existing v1 maintainer are `aantich`. E404 confirms no visible
published package at the time of the check; it does not reserve the name or
guarantee a future publication will be accepted.

Published v1 remains `@everworker/oneringai@1.2.1`. It is not renamed, removed,
silently redirected or deprecated before a verified replacement is installable.
Historical changelogs, evaluation evidence and v1 upgrade recipes keep the old
identity. Current source, examples and public API documentation use `oneringai`.

## Consumer migration

After a v2 prerelease is published, opt in explicitly:

```bash
npm uninstall @everworker/oneringai
npm install oneringai@next
```

After stable v2 is published:

```bash
npm uninstall @everworker/oneringai
npm install oneringai
```

Replace the package prefix in imports and dynamic imports, including subpaths:

```typescript
// v1
import { Agent, Connector } from '@everworker/oneringai';
import { AgentRuntime } from '@everworker/oneringai/agent-runtime';

// v2
import { Agent, Connector } from 'oneringai';
import { AgentRuntime } from 'oneringai/agent-runtime';
```

All existing public export subpaths remain, including `/agents`, `/types`,
`/shared`, `/images`, `/realtime-browser`, `/agent-runtime` and its driver entries.
Named connectors, driver IDs, agent methods, default settings, tool contracts,
runtime events and saved session formats are unchanged by this package rename.
Existing native checkpoint verification, owner scope and provider support limits
still apply. Package renaming does not grant authority to restore a session.

Update application dependencies, peer dependencies, bundler rules and TypeScript
aliases. Avoid loading both packages into the same application: separate installed
copies can create distinct registries and runtime class identities. Update plugins
and dependent packages together, then test their public integration. npm cannot
automatically move consumers between names. Optional npm aliases do not rewrite
transitive dependencies and are not the default migration path.

## AMOS and Hosea

Both application source trees are now MIT licensed under Anton Antic; see
[Licensing](../LICENSING.md). Their local package names are `oneringai-amos` and
`oneringai-hosea`. They are marked `private` to prevent accidental independent
npm publication; this flag does not restrict their MIT source license. AMOS's
`amos` executable name stays unchanged. No desktop installer is published here.

Hosea's UI source is included locally under MIT, with the source commit recorded
in [its provenance](../apps/hosea/src/ui/README.md). Commercial-license acceptance
is no longer required. The existing license IPC methods remain compatible and
do not write acceptance of the previous commercial agreement.

## Maintainer release and legacy notice

1. Commit the reviewed namespace/license changes and generated documentation in
   this repository. No history rewrite or new repository is needed. The user's
   explicit request authorizes this package-identity change; it is not a broad
   authorization for other breaking changes or live-provider tests.
2. Run build, types, lint, unit tests, public consumer compatibility, examples and
   AMOS checks. Test the packed package in a clean consumer, with ESM/CJS imports
   and all subpaths, without relying on the old package name.
3. Follow the existing clean-worktree/tag check in `prepublishOnly`: the package
   version's `v...` tag must point to HEAD. Do not bypass it or use a v1 patch
   release to ship this v2 branch.
4. Publish the reviewed prerelease using `npm publish --access public --tag next`.
   Verify `npm view oneringai@next name version maintainers dist.integrity` and an
   actual clean install. A first publication, tag, push or release is a separate
   action; none is claimed by this source change.
5. Publish stable v2 under `latest` only after its release gates pass. Verify
   `npm i oneringai` resolves to that release before notifying all v1 consumers.
6. Announce the migration in the existing project channels and, from the actual
   v1 source, publish a documentation-only v1 patch if needed. Preserve working
   v1 APIs and all existing versions.
7. Once stable v2 is installable, the authorized maintainer can apply this notice:

   ```bash
   npm deprecate '@everworker/oneringai@<2' 'OneRingAI v2 is now published as oneringai. Install with npm i oneringai. Migration: https://github.com/aantich/oneringai/blob/version2/docs/PACKAGE_MIGRATION.md'
   ```

   Deprecation displays a notice during installation; it does not upgrade users,
   remove releases or notify every existing installation. Do not apply it while
   the replacement is unpublished or unavailable. Keep support commitments
   explicit rather than inventing a v1 end-of-support date.

Live LLM/native provider testing remains paused. Updating license and package
metadata does not establish desktop runtime/platform compatibility or a release.

## Verification on this branch — 2026-11-01

- All 9,325 unit tests pass in 424 files. Library build, lint, types, public
  consumer compatibility, examples types, AMOS types/build and Stage 00 offline
  baseline pass. Generated public/internal API references use `oneringai`.
- All nine runtime/AMOS examples pass from source and the extracted 477-file
  tarball. Built AMOS inspection, native-command rejection, detach/resume and
  queued/in-flight cancellation checks pass under the new name.
- A separate clean production install of that tarball passes all 11 public
  entry points in ESM and CJS, root/runtime Connector identity and all three
  canonical MIT texts, with no installed `@everworker/oneringai` dependency.
- Both application licenses match the root MIT text and current personal
  contact. The parent app scope explicitly excludes AMOS and Hosea.
- The migrated Hosea UI passes its isolated typecheck and the full app builds.
  The complete desktop typecheck still reports 24 pre-existing integration
  diagnostics outside the migrated UI. Runtime/Electron upgrades and native
  desktop testing remain separate revival work; they are not reported as passing.
- Publication, registry ownership changes, legacy deprecation, Git commits,
  tags and pushes have not been performed.
