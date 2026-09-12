# Synthetic Model Evaluation Fixtures

These fixtures exercise code mechanics only. No source, hospital, event, policy,
reviewer approval, pricing quote, or model completion here is real evaluation
evidence. All sources use reserved `.invalid` URLs. The helper refuses to seal
anything labeled `public-source`; hashes never supply approval.

`fixtures.ts` provides a single synthetic policy case, pending configuration,
and recorded classification/copy/verifier responses. Allocation tests generate
temporary synthetic cases in memory to exercise 100-case counting. They are not
the promised real corpus, 100 real examples, or editor-adjudicated gold labels.

`no-network.mjs` is a subprocess test guard: unexpected fetches and attempts to
read provider/review/social credentials throw. The replay runner uses only
recorded responses, supplied explicitly to the existing model wrappers.

No live provider run, blinded quality assessment, current price verification,
source reuse approval, or publication action is performed by this fixture suite.
