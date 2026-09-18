# PAgE 2027 work-in-progress draft

This directory contains an anonymized SIGPLAN two-column draft for the PAgE
2027 workshop.

## Files

- `paper.tex` — submission draft
- `references.bib` — primary-source bibliography

## Build

Use a current TeX distribution containing `acmart` and
`ACM-Reference-Format.bst`:

```bash
latexmk -pdf paper.tex
```

The repository development environment used to create this draft did not have
a TeX toolchain installed, so the PDF still needs a visual and page-count
check. The PAgE limit is eight pages excluding the bibliography.

## Before submission

1. Confirm the workshop's submission portal; as of 16 September 2026, the
   official CFP publishes the 31 October 2026 AoE deadline but no portal URL.
2. Replace the anonymous artifact statement in the abstract with a blinded
   artifact URL once one is available, or remove the artifact claim.
3. Run the planned experiments and replace proposal language with measured
   results. Keep the work-in-progress label if results remain preliminary.
4. Validate every implementation claim against the pinned source revision.
5. Verify all bibliography metadata and the final PDF's embedded fonts.
6. Remove PDF metadata and any acknowledgments or links that reveal authors.
7. Record the AI-assisted workflow accurately; the current section documents
   the initial agent-assisted repository inspection and drafting pass.

## Suggested final positioning

Submit as a **work-in-progress / experience report** centered on runtime
invariants. The strongest claim is not that the architecture makes agents safe,
but that it turns assumptions about context, memory, tools, and authorization
into explicit interfaces and testable properties.
