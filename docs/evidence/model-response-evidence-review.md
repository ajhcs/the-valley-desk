# Model response and evidence delivery: bounded local review

Baseline: deployed `f802b24cb0a1d037608a697ee6d33f84e4687d86`, schema 0027.
No production mutation, model invocation, credential access, or deployment is
part of this implementation. Earlier capacity acceptance and legislative-material
idempotency remain closed; committee validation is preserved.

## Findings and changes

| Record / stage | Established finding | Local change | Still requires production evidence |
| --- | --- | --- | --- |
| HB1925 technical failure | Prior D1 reason is malformed JSON; original response, finish reason and request ID were discarded. Cause unknown. | Bounded outer/content JSON shape, byte count/hash, parser category/offset, finish reason, output usage/limit, format, safe correlation ID, and actual times. | Natural recurrence with diagnostics, then reproduction before selecting a behavioral fix. Synthetic malformed tests are not the original response. |
| SB1113 response contract | Old parser silently defaulted missing fields to review/0/0/empty reasons. | Required enum, numeric ranges/types, nonempty bounded reasons and evidence array validated before normalization; unknown fields/wrappers rejected. Prompt v4 matches contract. | A complete real response or explicit contract failure; no inferred editorial decision. |
| HB1993 evidence delivery | Retained 23:03 readback has 639 characters of detail, below 8000 cap. Official synopsis is absent. Captured page has it in `div#shortTitle-wrapper`, skipped by generic block extraction. | Extract designated synopsis before page chrome; retain inline-expanded wording, deliver through candidate, persistence and exact serialized model request. Empty PA model evidence yields explicit hold, preserving original model recommendation. | Natural attempt using corrected evidence; any editorial disposition must be independently persisted downstream. |
| Processing stages | Discovery-review, technical failure, relevance recommendation and editorial milestone are distinct. | Per-attempt UUID, actual start/end, detail identity and relevance-input hash; post-persistence structured event, reasons hash, model decision and admission flag. No invented editorial fingerprint/milestone. | Correlate retained logs with latest D1 reasons and downstream current-fingerprint audit. |

HB1993 synopsis: “An Act providing for the use of artificial intelligence in
mental health therapy and for enforcement.” This is the official page's synopsis,
not extracted PDF provisions. The PDF URL remains verified provenance only.
No full bill PDF text was delivered by the old collector. The omission, rather
than truncation, is reproduced by the captured markup and retained detail.
The old request was not separately logged; its evidence payload is reconstructible
from the retained row and unchanged input construction, not a wire capture.

Restricted prior evidence:
`/mnt/d/tmp/plumbob/tvd-release-f802b24-E2OXNF/cycle-result.json`,
natural run `bfcc32c4-a6f9-48db-be5b-7ef4d5df70af`, captured 2026-09-06T23:03:00.622Z.
Mandatory checksum-bound official pages are under `test/fixtures/pa-legislation/`.

## Safety and limitations

- No raw model content, prompts, reasoning, native parser messages or evidence
  strings are logged. Shape diagnostics are numeric/fixed categories and SHA-256.
  Provider correlation IDs allow only bounded generation IDs/UUIDs; unsupported
  identifiers are omitted, never guessed. Usage is bounded numeric data.
- Shared completion responses are limited to 256 KiB before parsing. Oversize
  is an explicit byte-limit failure, not assumed token truncation. Diagnostic
  records stay under 4 KiB; sink exceptions cannot change outcomes.
- `length` is a diagnostic signal, not sufficient proof of the cause. Existing
  fence/balanced-object parsing is unchanged; no repair, token increase, provider
  fallback or publication-gate relaxation was selected.
- D1 schema 0027 retains current relevance reasons/evidence, not historical
  pre-admission attempt timestamps. Correlated Worker logs supply those times.
  Capture logs and D1 promptly into restricted release evidence; logging is
  retention-limited and not a new permanent audit table. A missing persisted
  event cannot prove an attempt did not happen.
- A model rejection is never a downstream editorial disposition. PA responses
  without literal evidence spans remain review holds, with original decision
  in the attempt log. Full text may still be required by downstream evidence
  gates; a synopsis does not establish all statutory provisions.
- No PDF fetching/extraction service, database migration, scheduling change,
  ops-auth qualification, remaining detail-failure repair, or production release
  is included. Deployment requires new explicit authorization.

## Regressions and release evidence

`editor-model-resilience.test.ts`: synthetic truncated/content/outer JSON,
finish reason and usage, redaction and bounded correlation, fenced/trailing
prose compatibility, oversized response and failed diagnostic sink.
`official-source-discovery.test.ts`: empty/wrapped/incomplete/invalid contracts,
captured synopsis through the serialized request, inline expansion and missing
field. `cloudflare-ops.test.ts`: migrated-0027 persistence, three distinct stage
outcomes, actual attempt/deferred times, reasons, unchanged versions, no
publication or fabricated milestones. Existing positive committee and capacity
tests remain mandatory; capacity model stubs now include literal action evidence.

The final off-repository receipt must bind HEAD/tree, fresh official-byte replay,
focused tests and the declared release gate. Do not treat this local review as
acceptance of production model outcomes.
