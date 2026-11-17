# GL05 extension independent Sol review

PASS for the bounded private six-intake extension, after closure of the findings below. This does not accept public admission, provider source qualification, source enrollment, geographic coverage completion, clinical validity, release or deployment.

## Findings and closures

Initial uniform validation trusted self-declared metadata policies, permitted missing metadata fields and arbitrary coverage objects, and did not check reported dates or Boolean string shapes. The integration now pins each of the six manifest hashes, enforces independent per-batch/file policy and required-field maps, restricts coverage structures and reconciles their counts. Independent adverse probes reject body/profile/contact policy additions, missing fields, impossible calendar dates and hour 24, malformed Boolean/scalar values, negative counts, credential-bearing URLs, invented native IDs, duplicate identities and unmanifested source references.

Root review required secondary URLs to remain discoverable when the primary URL is a paper or source page. The implementation now retains separately source-referenced URL occurrences from metadata, without promoting them to catalog repositories or asserting aliases. Each occurrence retains its original record pointer, metadata key and match index.

Independent comparison then found a real source-semantic loss: PCOM people-screening prose was clipped at 1,000 characters, dropping 233 safe URL occurrences (192 distinct URLs, including a GitHub URL and meaningful Citeseer, ScienceOpen and PLOS identifier queries). Deterministic replay alone did not reveal the omission. The producer retained bounded prose while adding safe citation URL metadata extracted before clipping and an explicit truncation flag. After repair, comparison against all six original selected CSV projections found 4,806 safe URL occurrences and none missing from retained source metadata. All 233 previously missing occurrences are also present in the composed source-scoped URL observations. All 5,129 retained metadata URL occurrences project without loss.

## Independent source and preservation evidence

All six source replays pass. Independently recomputed original receipt hashes match SJU seven files, PCOM 62, Widener two, Scranton seven, Lehigh 15 and Rowan 21. Widener/Scranton authored factual note pointers were checked against the actual report lines; Lehigh/Rowan CSV pointers have no multiline row drift. Sanitized assertions contain no contact-email pattern. Source scripts, source HTTP requests and peer research task messages were not used.

All 3,261 new source records equal the source arrays exactly: SJU 254; PCOM 853; Widener 21; Scranton 104; Lehigh 1,442; Rowan 587. The prior 9,275 observations remain an exact ordered copy; the Cooper graph remains 637 nodes and 820 edges. A pinned reference preserves the prior 4,472 source records. Comparison of all 1,322 captured prior tracked files found unchanged bytes at review freeze. Every newly normalized observation has null native ID; the 231 reported native IDs remain inherited from the earlier snapshot. All records and observations remain private and publication unauthorized.

In-memory corruption probes independently verified that altered manifest bytes fail their pinned hash before parsing and altered sanitized output bytes fail their byte/SHA-256 receipt before parsing. The original files were not modified by those probes.

## Scope, units and validation

The final index contains 420 account URL keys, 4,877 catalog candidate repository keys and 7,199 distinct repository-shaped URL leads (6,077 excluding Drexel broad-check-only observations). There are 17,665 observations: the inherited 9,275, 3,261 new source records and 5,129 secondary URL occurrences. These are review units, not counts of unique people, eligible health work, institutional ownership or completed coverage.

The generated report retains account-only URLs and source contexts, zero/empty/failed/negative outcomes and reported redirects without identity consolidation. PCOM Georgia, SJU Lancaster and Rowan Zhu/Tulane/partner connections retain their qualifications. Scranton and Lehigh remain neighboring context outside the nine-county DVRPC primary region. Institution names do not assign a county, present role, project worksite or code ownership.

The four focused extension tests, 13 source QA tests and final generated freshness check passed. No full application, Watch, PDF, whole npm or long Discovery suite was run for this review. No remaining blocker was identified within this private metadata-intake scope.

## Reviewed artifact hashes

- `scripts/sanitize-sju-pcom-intakes.py`: `b8ad3c2ecb70800f35bbf5abf9dd782524c656f07835bbd05da4897b53c33c35`
- `scripts/sanitize-widener-scranton-intakes.py`: `d55d777edef30b0b59fe013cc7c7ec2378ee72c3367aae344d699a1534f8603d`
- `scripts/sanitize-lehigh-rowan-intakes.py`: `430545e23532b79acbc7463d531b7b6f97a87fdf7a31ecabd3081bb68d45e750`
- `src/ingest/discovery/research-network-extension.ts`: `6648da193792d7849b31598006372464f0db36286e7e3b6d6910e5ac06c62dc1`
- `scripts/build-research-network-extension.mjs`: `aaa5223c7f7c39a49e83c5e8bf031bdbef1cb4d1dcf3caffad883d5748842c83`
- `docs/discovery/go-live/evidence/GL05/regional-extension-20261117/sju/source-assertions.json`: `8f09890f70b277e6781b712ee0aba1a5bd6166f9aa1a81afbccfc01b48a74389`
- `docs/discovery/go-live/evidence/GL05/regional-extension-20261117/pcom/source-assertions.json`: `cc78e3b5c9350263edd2a95d6b9f2f46fb5498f46558b3b7ec515f96bf47567d`
- `docs/discovery/go-live/evidence/GL05/regional-extension-20261117/widener/source-assertions.json`: `27e658376e3c437a2e65d1548bd9001d83667538bc03edb1d9ef0d72727faa29`
- `docs/discovery/go-live/evidence/GL05/regional-extension-20261117/scranton/source-assertions.json`: `6b057179edae602b63699e6c3b25f419b44f874d9143f0a3b468c024f4341f85`
- `docs/discovery/go-live/evidence/GL05/regional-extension-20261117/lehigh/source-assertions.json`: `e573f614b8052b0d3fbf57e5cbe9d5cd3274cfaf75df3584e4f2ca661e383823`
- `docs/discovery/go-live/evidence/GL05/regional-extension-20261117/rowan/source-assertions.json`: `566eed67cdc354c8d79659fefe22af32288008c3dcb63f74e665db01ae960e40`

## Final validator and package integration closure

Root review found an exported-validator gap after the earlier private-scope PASS: unknown batch names could bypass the independent batch policy maps. Both exported validators now reject unsupported batch names before validating the supplied envelope. Independent probes reject an ordinary unknown name, inherited object-property names (`constructor` and `__proto__`) and a case variant; the real SJU fixture remains accepted. The focused tests now use a real pinned intake fixture for validation and retain a synthetic record only for federation behavior. Source outputs and generated counts remain unchanged.

Package wiring adds the extension build/check entry points, prepends extension freshness and appends its test file while preserving the complete prior Discovery command. The earlier 1,322-file immutability comparison applies to the pre-packaging review freeze; package and follow-through/planning edits have separate final reconciliation. No broad test suite was run during this narrow closure review.

Final reviewed extension test SHA-256: `57cd6ccd3c823a250124593d4f1bb0cf59a549dc8ae8fac0f36255b877206ac6`. The module hash above is updated to this narrow closure. Private metadata-intake acceptance remains PASS.

## Reopened production build compatibility

The root production build failed with TypeScript TS2591 because the new application-scope module imported `node:crypto` for receipt hashing. The earlier focused checks did not establish compilation in the application build. Private intake acceptance is reopened for this narrow build-compatibility repair. Receipt hashing must move to a script-only helper while application-scope code retains structural validation, without dependency or type-shim additions. Final production build closure is pending.

### Production build repair disposition

PASS after repair. The application-scope module no longer imports Node builtins; hash computation resides in `scripts/lib/research-network-extension-receipts.mjs`, imported by the builder and focused tests. No dependency, type shim or compiler configuration was added. Independent malformed-receipt and in-memory corrupt-source probes still reject before parsing, and every captured source/generated artifact hash remains unchanged.

Read back the retained successful isolated production build at `.discovery-work/wp12/extension-production-build-pass.log`: TypeScript and Vite completed, with only the reported nonfatal chunk-size warning. The producer recorded exit zero; the successful output contains no TS2591 diagnostic. The original build failure remains recorded above. The producer also reran the four focused tests and deterministic freshness check successfully. Final packaging still requires the root's release/acceptance reconciliation; this closes the code build-compatibility finding for private intake.

Reviewed helper SHA-256: `d1805538fd3b809f0158574069bf3181eae8efa2c48fdff7aa95c149d93b7190`. Successful build-log SHA-256: `e8ae3fa48710507ebb1c3dd4c8f5ef6d77688486f6228602225ff52659851dc0`. Module, builder and focused-test hashes above are updated to the repaired code. Private metadata-intake acceptance remains PASS.
