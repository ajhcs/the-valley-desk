# Frozen engineering baseline

This directory retains selected **authored engineering artifacts**, not harvested
source-site content, from TVD-CONCEPT-0.4. The copy makes the handoff usable without
the original author's workspace. Its native model remains the historical
authority for the encoded v0.4 semantics; the handoff proposes refinements to it.
Do not edit these baseline files when refining the target.

- [Native model](tvd-concept-v0.4/model/tvd-discovery.sysml).
- [Formal obligation scope](tvd-concept-v0.4/proof-scope.json).
- [Independent documentary scope](tvd-concept-v0.4/review-scope.json).
- [Selected native record scope](tvd-concept-v0.4/model-contract-scope.json).
- [Historical check receipt](tvd-concept-v0.4/validation/receipt.json).
- [Copied-file manifest](tvd-concept-v0.4/MANIFEST.json).

The receipt reports 32 obligation families, 74 symbolic lemmas, 320 reachable
abstract states, and 2,348 abstract transitions. Its goal validation remains
`not_run`. No proof, parser run, source collection, application check, or empirical
evaluation was rerun while preparing this handoff. Hash comparison verifies the
copied bytes, not the historical findings or real-world truth.

The complete original package is available on this host at
`/workspace/worktrees/builderbob/thevalleydesk/work/tvd-concept-v0.4/`; its complete
ZIP and checksum are siblings. This handoff deliberately does not copy its
environments, caches, screenshots, every generated proof output, or old diagrams.
They are supplementary evidence; the selected definitions and scopes needed to
plan implementation are retained here.

## Future reproduction and refinement

WP02 owns reproduction before changing the model. Copy this frozen selection to
a fresh scratch directory on verified `/workspace`, preserving its layout. Use
Python 3.10+ and an isolated environment with the exact Z3 package and wheel hash
in `requirements-proof.txt`. The historical proof drivers write output beneath
their parent directory: **do not execute them in this frozen baseline**.

`tools/verify_mathematics.py` reads the model and retained proof scope and writes
fresh SMT inputs/results. `tools/verify_controls.py` replays SMT with the same Z3
implementation and checks the finite negative controls; it is not an independent
proof-assistant kernel. The latter driver records a host-specific CSE runtime
path and expects `.venv/bin/z3`. Resolve that runtime and environment in the
scratch copy, retaining the exact driver diff. Do not replace missing tools with
an unreported substitute or install host packages as a side effect.

Use the available CSE launcher for native syntax, documentary-scope, finite
workflow and function/flow checks with the retained model, independent scopes,
`evidence/accepted-direction.md`, `evidence/design-policy.md`, and finite inputs.
Use a private parser cache. WP02 must record the exact commands, runtime/parser
versions, selected methods, outputs, and any unavailable checks. The original
receipt is evidence history, not a fresh result for the scratch copy.

Create a new target revision outside this frozen directory. Preserve original
IDs and independent obligations, record new obligations, and run the affected
checks. The engineering handoff is a delivery plan, not a competing execution
model or an automatic waiver of v0.4 obligations.
