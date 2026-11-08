# Published dependency review

Reviewed **2026-11-02** for `oneringai@2.0.0-beta.1`. This is a dated dependency
assessment, not a guarantee about future advisories or arbitrary applications.

Run `npm run release:consumer` after building. It packs this checkout, installs
the tarball into a fresh project with ordinary install scripts and optional
dependencies, imports all public entries through ESM and CommonJS, tests document
reading and runs a production audit. It compiles nine core entry declarations
without the optional SDKs, then installs the declared Codex/Claude SDK peers and
compiles all eleven entries and audits that graph too. Adapter-specific public
types intentionally require the corresponding SDK peer; core imports do not. No repository lockfile or overrides reach
that consumer. `--report <path>` saves the result; `--keep-temp` retains the audit
and installed tree for inspection. This command uses the npm registry and makes
no model calls. `npm run release:check` also performs the local build/test/doc gates.

## Unreleased beta corrections — 2026-11-08

The Node build embeds MCP SDK code, so a clean consumer's newer installed SDK
does not replace an older embedded copy. The dependency floor is now **1.32.0**;
the qualified build uses **1.32.2**. This fixes the
[cross-origin redirect advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw).
MCP HTTP redirects remain supported within the same origin. Cross-origin redirects
are blocked; configure the intended final server URL explicitly.

The build also updates embedded `fast-uri` to **3.1.9**, `hono` to **4.13.17** and
`@hono/node-server` to **2.1.6**, with compatible patched lower bounds. These remain
within their existing major versions. Browser schema parity is requalified against
the updated URI resolver rather than assuming unchanged behavior.

`npm run build` captures actual esbuild dependency input files, package identities
and hashes, then seals final ESM/CJS artifacts in `dist/bundle-provenance.json`.
`npm run release:bundled` verifies that the artifacts and local inputs still match,
enforces known patched floors and checks direct advisory entries for the exact
embedded package paths in the maintainer production audit. An unavailable audit
or an unreviewed embedded advisory fails this gate. External dependency findings
are checked separately by the clean-consumer audit; this is not a claim that every
maintainer dependency has zero audit entries.

The corrected tarball passes clean ESM/CJS consumers on Node **22.13.1** and
**24.20.0**, including the declared optional SDKs. Each current consumer audit has
**zero high/critical entries** and **three moderate package entries** from the
previously reviewed indirect UUID advisory. Its exact installed source still
passes the existing applicability checks. The larger counts below describe the
historical November 2 install, not this corrected tarball.

The clean-consumer gate verifies the tarball's artifact hashes and provenance,
then tests the actual public MCP adapter in both ESM and CJS against two local
servers. It requires successful same-origin redirects and zero forwarded requests
on cross-origin redirects, including custom headers and request bodies. It does
not substitute a source import or the consumer's separate SDK for bundled code.

## Corrected dependency paths

- `officeparser` is pinned to **8.0.0**, whose PDF.js dependency is **6.2.108**,
  outside the affected range of [GHSA-hq66-cqwq-w95j](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j).
  Later officeparser releases raise their Node minimum beyond our supported floor;
  upgrading the pin requires another engine and parser compatibility check.
- The direct `glob` range starts at **14.0.3**, with patched minimatch 11.x.
  This removes the direct traversal/cancellation advisory and its minimatch path.
- Root overrides remain development safeguards. They do **not** remediate an
  installed dependency's graph; the consumer check is the release evidence.

## Remaining moderate audit entries, two reviewed advisories

The normal tarball install reports **10 moderate package entries**, propagating
from `minimatch` and `uuid` through ExcelJS 4.4.0 and its archive dependencies up to
`oneringai` itself. The bare-dependency investigation reported four entries because
it lacked that parent package graph. Both represent the same two underlying advisories. No patched
stable ExcelJS release was available at review. Replacing its internal archive
stack with incompatible major versions would risk spreadsheet compatibility.

| Advisory | Source assessment and release disposition |
| --- | --- |
| [minimatch globparts amplification](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) | The advisory describes `firstPhasePreProcess` / `secondPhasePreProcess` with `optimizationLevel >= 2`. Installed legacy minimatch **3.1.5 / 5.1.9** lack these implementations and this option; npm's broad `<11.0.1` range nevertheless matches them. Source-reviewed as non-applicable to these exact installed implementations. |
| [UUID output-buffer bounds](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq) | Affects `v3` / `v5` / `v6` with caller-supplied output buffers. ExcelJS's sole UUID import is `v4`, called without arguments; the affected methods/buffer interface are not used. Source-reviewed as non-applicable to OneRingAI's ExcelJS path. This does not clear another application's direct UUID calls. |

The [consumer audit gate](../scripts/release/audit-policy.mjs) checks the exact
advisory IDs, severity, indirect paths, installed versions and these source
properties. New findings, changed versions or an affected implementation fail
the gate and require a fresh assessment. Counts remain visible; the gate does
not suppress findings or report a zero-vulnerability audit. Applications with a
policy forbidding any audit entry must resolve this legacy ExcelJS graph before
adoption. Upgrade ExcelJS when a compatible patched release becomes available.

## Compatibility evidence

The consumer probe reads representative CSV, XLSX (including cached formula
results and formula display), DOCX, PPTX, ODT, ODP, ODS, RTF and PDF through public
`DocumentReader` in both ESM and CommonJS. The PDF
probe verifies real PNG pixels and selected-page behavior. Installed-package
ESM/CJS declarations and compatibility fixtures compile with `skipLibCheck: false`,
using only consumer dependencies for type resolution. It also writes
the XLSX fixture with the installed ExcelJS. Source unit tests cover formatting,
limits, filtering and parser behavior. The PPTX temp-file workaround remains in
place for bundled server compatibility. See [release readiness](RELEASE_READINESS_V2.md)
for the final commands/results and supported Node checks.

## API application development tooling — 2026-11-02

The separate, private `apps/api` manifest still selected Vitest 2.1.x after the
v2 branch promotion. GitHub alert 24 tracks
[GHSA-5xrq-8626-4rwp](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp),
which affects exposed Vitest UI/API servers and UI/browser mode on Windows.
The app's checked-in scripts use ordinary run/watch mode, with no UI, browser
mode or exposed API-server configuration. This lowers the observed exposure;
the vulnerable development dependency should still be updated.

The correction selects **Vitest 4.1.12+** and the maintained
**`@cloudflare/vitest-plugin` 1.4.12+**. Vitest 3.2.7 removes the original advisory
but retains a Tinypool version with additional critical audit findings, so it
is not the selected fix. The Cloudflare configuration uses its current plugin
API. Test setup now uses valid D1 binding options and bundles `schema.sql` as
data instead of attempting unsupported filesystem access inside a Worker.
These test-setup problems were present before the dependency update.

Validation of the updated local app graph:

- `npm --prefix apps/api run typecheck` passes.
- `npm --prefix apps/api test` executes all 30 tests: **29 pass**, with one
  existing model-seeding failure exposed by the repaired harness. Seven current
  registry entries have an unknown input or output token limit; the seeding route
  sends those nulls to the app's `NOT NULL` database columns. The security fix
  does not invent token limits or change the database schema.
- `npm --prefix apps/api audit --json` reports **0 critical, 6 high, 0 moderate,
  1 low** entries. The original advisory and critical Tinypool path are absent.
  The remaining findings concern Hono and local Wrangler/Miniflare dependencies;
  this is not a clean whole-repository audit.

This app's development graph is separate from the library's clean-tarball
production-consumer assessment above. A local dependency correction does not
close the GitHub alert until the updated manifest reaches the default branch
and GitHub rescans it.
