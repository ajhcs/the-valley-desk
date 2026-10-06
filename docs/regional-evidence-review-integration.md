# Protected regional evidence review diagnostic

This integration adds an authenticated, metadata-only GET/HEAD diagnostic at
`/api/automation/status/regional-review`, also available through the existing
Access-protected `/ops/api/automation/status/regional-review` prefix. The
existing bearer-token and verified Access identity gates remain unchanged. The
endpoint is private, no-store, read-only and explicitly `review-only`.

It integrates accepted coverage successor b5464894b38a73e8da3a93137890182c0f64fd2c
(five additive files) onto exact released PR26 merge
e089406e2dea16a2e908536cccadca9300e6859b. The alert repair remains unchanged.

`asOf` is the server projection instant, never a source observation. Source
last-check/success times and scheduler receipts are kept separate. Only bounded
metadata columns from source_health and registered leadership scheduler state
are read; no raw errors, markup, inbox content, profiles, credentials or article
bodies are read. Missing receipts remain unknown. Invalid or more than1000
receipts return503 with a stable unavailable code, without provider error text.

Counts describe the fixed16 monitor set, source registry attribution and unique
collection identities. Princeton and Doylestown remain attribution gaps. A
healthy parent-source receipt cannot qualify subsidiary coverage, employment,
repository ownership or a complete roster. Relationships retain their
review-only research basis; observation times/capture hashes remain null when
not retained. News existence and qualified institutional coverage remain unknown.
The diagnostic preserves the existing48-hour daily read-projection budget,
26-hour daily operational clock and exclusive seven-day affiliation limit.

The package test command now includes the four regional suites and integration
suite, preserving all existing alert tests. Local SQLite acceptance covers auth
rejection before reads, trusted Access prefix mapping, HEAD/POST behavior,
read-only bounded SQL, no outbound collection, unknown evidence, fresh parent
health without subsidiary qualification, separate clocks and fail-closed input.

No active registry, collector, schedule, migration, affiliation, retention,
publication gate, public feed or frontend is changed. No model/provider calls
are added. This local candidate is not published or deployed. Exact integrated
checks and independent review are required before any publishing behavior.

PR27 live metadata qualification exposed the existing source-health identity `x`.
The narrow successor permits one-character lowercase runtime health identities,
while inventory, evidence and relationship identities retain their original rules.
No identity is renamed or mapped to an institution. The unregistered receipt stays
visible and grants no regional freshness, attribution or employment qualification.
State, calendar, length, character and receipt bounds remain validated. Regression
coverage reproduces the original failure and verifies the corrected unknown-source
projection plus invalid states, dates and identities. Production remained on the
prior reviewed PR26 Worker while this successor was prepared and reviewed.
