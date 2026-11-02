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
