# OneRingAI v2 release readiness

Beta.2 — 2026-11-08: `oneringai@2.0.0-beta.2` includes the shared browser/Node
Agent API, browser schema compatibility corrections, AMOS EOF recovery and
embedded dependency hardening. The [beta.2 record](evaluations/BETA2_RELEASE_VALIDATION_2026_11_08.json)
separates candidate validation from verified publication. The user explicitly
authorized fixing, committing on main, pushing and publishing beta.2.

Unreleased beta follow-up — 2026-11-08: release validation now checks embedded
dependency provenance and advisories as well as the installed consumer graph.
Patched MCP HTTP redirect behavior is tested through the tarball's public ESM/CJS
adapter. See [dependency security](DEPENDENCY_SECURITY.md#unreleased-beta-corrections--2026-11-08)
and [browser delivery](designs/AGENT_BROWSER_NODE_DELIVERY.md) for the fixes and
current validation record. Version/tag selection and publication remain separate
from these source corrections; the following beta.1 publication record is historical.

Review date: **2026-11-02**. Prepared package: **`oneringai@2.0.0-beta.1`**.

**Subsequent publication — 2026-11-02:** the beta is now
[published on npm](https://www.npmjs.com/package/oneringai) under `aantich`, from
`v2.0.0-beta.1` / `318c84b`. Both `latest` and `next` select it. Registry integrity
matches the validated artifact; a fresh registry install passes all eleven public
entries in ESM/CJS and all nine document formats. The machine record's
[`publicationOutcome`](evaluations/V2_RELEASE_VALIDATION_2026_11_02.json) retains
the post-publication verification. The following review describes the earlier
candidate checks; preview/live/platform boundaries remain unchanged.

This record concerns the library candidate and application source checks. It does
not represent an npm publication, a merge, or a signed desktop installer release.

**Decision: the prepared v2 beta candidate is ready for the publication handoff.**
`npm run release:check` passed end to end, with the default and optional-SDK consumer
installs. No known implementation blocker remains in the reviewed scope. The two
source-reviewed non-applicable dependency advisories remain explicit; external
harnesses and experimental policies keep their preview labels. At validation
time, the tree was uncommitted and no merge, release tag or publication had been
performed. The subsequent source handoff committed and merged v2 into `main` at
`9c18dfa` and pushed it to GitHub on **2026-11-02**. This does not announce an npm
release. The later [API app security assessment](DEPENDENCY_SECURITY.md#api-application-development-tooling--2026-11-02)
records its development-tooling correction and separately exposed model-seeding
test failure; the earlier application checks below concern AMOS and Hosea.

## Corrections delivered

**R1 — routine prompts and data bridges: fixed.** All default/generated system,
task, dependency and fold instructions use `store_set` / `store_get`, the actual
`whiteboard` / `notes` stores, flat arguments and exact notes keys. Nested
map/fold/until instructions reach reused agents through task prompts while their
system instructions and single tool manager remain intact. Exact-key reads retain
precedence; routine findings-tier spill keys resolve and reserved tiered data is
cleaned/restored without removing unrelated host notes. Existing custom prompt
signatures, reflection opt-in, execution results and fold task-output precedence
remain. Five end-to-end request/store/control-flow regressions and the
[offline store/map/fold example](../examples/routine-store-bridge.ts) cover these
paths. The guide and AMOS cookbook describe current behavior.

**R2 — published dependency graph: corrected and source-triaged.** The actual
consumer graph uses officeparser **8.0.0**, patched PDF.js **6.2.108**, direct glob
**14.0.3+**, and unpdf **1.9.1+**. No repository override is treated as a consumer
fix. The clean production audit has **no high or critical entries**. Its **10
moderate package entries** propagate from two advisories; the installed legacy
minimatch implementations lack the affected preprocessing, and ExcelJS uses only
unaffected UUID v4 calls. These findings remain visible and have a narrow,
source-checking release gate. See [the complete dependency assessment](DEPENDENCY_SECURITY.md),
including the exact versions, upstream advisories and limits of the disposition.
This is not a zero-finding audit or an exemption for another application's UUID use.

**Additional issues found by clean-consumer checks: fixed.**

- PDF image extraction used the wrong unpdf API and treated raw pixels as encoded
  files. It now extracts selected pages, emits valid PNG for RGB/grayscale/alpha,
  reuses one private PDF proxy and releases its loading task on success/failure.
  Real image-bearing PDFs and failure/lifecycle tests cover buffer reuse, page
  selection, disabled extraction and partial failure. The loading-task lifecycle
  works with the consumer's current PDF.js API.
- Public provider declarations required WebSocket types available only in the
  development tree. `@types/ws` is now a production dependency; strict ESM/CJS
  checks resolve declarations entirely from the installed consumer graph. Nine
  core entries work without SDK peers; the two local adapter subpaths retain their
  SDK-specific public types and are checked with the documented optional peers installed.
- The lost-continuation fixture depended on a 500 ms deadline that could expire
  during a healthy first turn. Synthetic idle streams now close explicitly and
  exhaust reconnection deterministically. Original no-resubmission and terminal
  ambiguity assertions remain, with an additional no-cancellation assertion.
- AMOS's Node engine declaration now matches the library's supported floor.

## Documentation and release gates

The entire previous README (3,717 lines) and User Guide (19,914 lines) were reviewed
section by section; the [coverage inventory](evaluations/V2_DOCUMENTATION_SECTION_COVERAGE.json)
retains the original chapter disposition. The README is a concise v2 entry point
with inherited connectors/memory strengths and prominent AMOS navigation. The
User Guide routes to specialist guides and preserves legacy migration anchors.
Incorrect examples, lifecycle/permission/reflection claims and generated source
links were corrected. Internal links are relative; only the README's two npm
version-navigation links target the required `version1` and current `main` pages.

Repeatable checks:

```bash
npm run release:check
npm --prefix apps/amos run typecheck
npm --prefix apps/amos run build
npm --prefix apps/hosea run typecheck
npm --prefix apps/hosea run test:design
npm --prefix apps/hosea run build
```

`release:check` builds, checks types/lint, runs the complete unit suite, typechecks
examples and public compatibility fixtures, runs 27 explicit offline examples,
regenerates public/internal API docs, checks documentation, then packs/installs
and verifies a real consumer. It makes registry requests, not LLM calls.
`prepublishOnly` runs this gate and then requires the exact release tag at HEAD
and a clean worktree. Release preparation never bypasses tag verification.

The [consumer gate](../scripts/verify-release-consumer.mjs) uses ordinary install
scripts and optional dependencies. It probes all 11 public entries through ESM
and CJS, shared Connector identity, licenses/docs, nine representative document formats including
PNG image pixels, strict installed-package declarations and production audits
for both the core and explicitly selected optional-SDK installs.
Use `npm run release:consumer -- --report /tmp/consumer.json --keep-temp` to retain
the result, audit and installed tree. The npm name is not reserved by a local pack.

## Final validation

The [machine-readable record](evaluations/V2_RELEASE_VALIDATION_2026_11_02.json)
records the current checks; prior stage counts remain historical. No new billable
provider calls were made.

| Check | Result |
| --- | --- |
| Complete `npm run release:check` | Pass, including its real consumer install/audit steps |
| Build / source types / lint | Pass; 33 export files and shared ESM/CJS Connector identity |
| Complete unit suite | **9,374 passed / 427 files**, four workers, no retries |
| Examples | Types pass; **27 offline demonstrations** pass, including all five runtime adapters, AMOS, routines, connectors and native compaction |
| Public consumer contracts | Built-package fixtures pass; installed core and optional-SDK declarations compile in ESM/CJS with `skipLibCheck: false` |
| Generated references | **1,825 public / 3,619 internal** items; current defaults and relative source links |
| Documentation | **154 Markdown files**, **512 TypeScript blocks**, **10 complete semantic examples**; paths, anchors, public imports, command names and branch-link rules pass |
| Real tarball installs | All **11 entries**, both module formats, shared identity, documentation/licenses and absence of legacy package verified |
| Documents | **Nine representative formats**, both module formats; CSV, XLSX, DOCX, PPTX, ODT, ODP, ODS, RTF, PDF; selected-page PNG pixels verified |
| Node support probe | **22.13.0 and 24.20.0**; imports, public document reading and SDK module loading pass |
| Optional SDK install/type smoke | Codex **0.149.1**, Claude Agent SDK **0.3.316**; no model query invoked |
| Production audits | Default and optional-SDK graphs: **0 critical / 0 high / 10 moderate package entries**, representing the two documented non-applicable advisories |
| AMOS | Types/build pass; five-adapter offline controller scenarios pass |
| Hosea source | Types, renderer/Electron-main builds and **6 design/storage tests** pass; signing/installers remain separate |


## Support boundaries retained

- New external harnesses remain preview/experimental until their specific live,
  account-entitlement, file-transfer and platform gates are satisfied. The
  [November 1 bounded live record](evaluations/LIVE_VALIDATION_2026_11_01.md)
  covers only its stated Codex subscription and small OpenAI direct-model sample.
  This hardening pass makes no new live provider calls or general subscription
  authentication claim. Offline wire tests do not establish live availability.
- Permission user rules precede parent delegation/policy chains; `autoApproveAll`
  checks its blocklist and bypasses the remaining checks. Parent policy is not a
  mandatory tenant boundary. Existing precedence remains unchanged.
- Some legacy lifecycle hook slots remain assignable without managed-loop
  callers; use the documented execution hooks/events. `beforeCompaction` is wired.
- Saved sessions, evidence, user IDs, cursors, task budgets and continuation
  references do not replace trusted host authorization or create durable workflow
  authority. Deferred roadmap stages remain deferred.
- Hosea source/build readiness is separate from installer signing, update hosting
  and cross-platform desktop release validation.

## Publication handoff

After final candidate checks pass, review/commit the intended tree and select the
publication revision. This checkout still prepares **a beta**, not stable `2.0.0`.
Keep v1 maintenance on `version1` and v2 development on `main`. Choose the release
version, tag and publish only with separate authorization. The tag/clean-tree gate remains
an intentional final release step. Recheck npm account access and the unscoped name
at publication time, then verify a real registry install. Only after v2 is
installable should the [legacy migration/deprecation notice](PACKAGE_MIGRATION.md)
be applied. No automatic update crosses the package-name change.

Earlier failures and checks remain historical in the
[documentation validation record](evaluations/V2_DOCUMENTATION_VALIDATION_2026_11_02.json).
The current [Version 2 Guide](VERSION_2_GUIDE.md) owns adoption/handoff information;
[README](../README.md) and [User Guide](../USER_GUIDE.md) remain integration entry points.
