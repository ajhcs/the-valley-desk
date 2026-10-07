# Bounded HTTP 402 diagnostics

Read-only October 7 production candidate metadata identified `http: Editor model failed (402)` in all five failed candidates whose latest attempt was retained since October 6. These are latest candidate records, not a historical ledger of every request. Alert occurrences count condition evaluations, not incidents or failed requests. The matching ingest run succeeded; failed enrichment keeps its candidate in review.

OpenRouter documents credit-limit 402 errors from account/request credits, per-key credit limits and the in-flight spending budget. Existing production errors do not retain the response metadata or Retry-After header, so those subtypes and account balance remain unknown. Do not claim that the account has zero credits, that the API key is invalid, or that parsing caused these observed failures.

This local-only candidate retains just documented literal metadata for HTTP 402: `limit_source` allowlisted to openrouter_credits/openrouter_key_limit/openrouter_in_flight_budget; `reason` allowlisted to in_flight_budget_exhausted/weight_exceeds_budget; and a numeric Retry-After from 1 through 86400 seconds. Missing, unknown, malformed or oversized metadata stays unqualified. Reads accept JSON only, at most 8192 bytes and 200ms, and cancel/release the stream. Raw provider prose, prompts, remedy hints and credentials are never copied to the diagnostic or persisted error message. Diagnostic errors cannot change the HTTP failure outcome.

The unchanged existing persistence path saves the bounded failure string with any validated fields. HTTP failure remains an operational enrichment failure. This does not resolve the live 402, change model selection or token budgets, add retry requests, reset cooldowns, change credit/key limits, suppress warnings, qualify affiliation, activate collection or authorize publication. It does not rewrite prior errors or retroactively identify their subtype.

WHYY's existing incident resolved October 7 at 07:47:14.675 UTC after two qualifying observations. At the 10:46 UTC metadata read, its primary success was 10:32:19.653 UTC, fallback success was null and state was healthy with 20 items. The resolved incident retains its historical failure detail; that is not its current source state. Complete corpus coverage remains unqualified.

The approved diagnostic capture table still has zero live rows. Separate provider history and the completed retention receipts remain unchanged.

Primary documentation checked October 7: https://openrouter.ai/docs/api_reference/limits and https://openrouter.ai/docs/api_reference/errors-and-debugging.
