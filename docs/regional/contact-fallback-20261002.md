# Final bounded contact display fallback

This successor preserves original integration `6f52b2b5c7393018b870cf51554fe9af30532051` and first correction `2af52f844e8a7a5424812e4942604f64ee0a1581` unchanged. Focused retest found the remaining T2-equivalent comment-separated mailbox form, such as `jane(comment)@fixture.edu`, was still exposed by the known-format mask.

The shared display helper now withholds an entire field whenever a literal @ remains after known-format masking. This conservative fallback also withholds ordinary text containing an unsupported @ form; privacy takes precedence over retaining that field. It is explicitly a display decision, not an RFC mailbox parser or a classification of all possible personal information. Retained source-byte evidence remains unchanged.

Publication institution/geography flags now use the retained redacted affiliation text. If a field is withheld, it has no supporting institutional/geographical literal and contributes no regional match. The disclosure stays in review with the missing-affiliation hold. Reported current employment, unique-person identity, organization ownership and publication authority remain unconfirmed. Known-format masking retains unaffected affiliation context, including the eight existing regression cases.

Five comment-separated/unknown syntax cases exercise the full projection/detail-tool path. BOM/no-BOM wire hashing corrections remain unchanged. Author validation: 207 regional tests, app/node typechecks, build, retained 12/12 span replay and real SDK/native browser journey pass. Desktop/mobile light/dark screenshots remain pixel-identical to the current frontend. No source/model calls or production actions occur.

Final focused independent retest is required for the exact frozen successor before transport acceptance. Core acceptance and the existing deployment-specific release decisions remain separate. No production Worker route, browser entry, source activation, credential, root dependency or PA component is changed.
