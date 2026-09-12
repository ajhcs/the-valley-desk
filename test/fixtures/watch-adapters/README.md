# Synthetic Watch Adapter Fixtures

These fixtures contain invented identifiers, records, and prose. No fixture is
a live source sample, real qualification receipt, local relationship, license
review, or permission to publish. `source.example` is a reserved example host;
the `synthetic-lab` GitHub strings are never requested by these tests.

The test constructs XML and JSON in memory so variants differ only in the
specific field under test. Snapshot and payload hashes are computed by the
same exported hashing contract used for real records. Timestamps are explicit
test inputs; no wall-clock fallback is used.

`acknowledgments` produces synthetic receipts solely to exercise the pure
contract. A collector or HTTP client must not supply such objects as production
authority: production callers must resolve successful durable writes themselves.
