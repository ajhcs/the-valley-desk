# Representative Launch Workflow

This implementation adds an explicit, deterministic source-rule path. It does
not impersonate a human reviewer or turn a roster observation into term history.

## Runtime

Enroll one endpoint per source with desk `policy`, jurisdiction `federal`,
family `members`, authority `official`, transport `official-xml`,
parserId `watch-federal-roster`, parserVersion `1`, maxItems at least 30 and
maxBytes 1000000 for House or 500000 for Senate. Exact endpoints:

- https://clerk.house.gov/xml/lists/MemberData.xml
- https://www.senate.gov/general/contact_information/senators_cfm.xml

The official [House XML catalog](https://xml.house.gov/resources/SelectedList-LegisBranchData.htm)
documents the Clerk endpoint. Senate XML is its official current-contact roster.
Enroll explicit public-link hosts for the official lookup/profile URLs; membership
in a source body does not establish sponsorship or address representation.

The regular Watch collector now persists full raw pages, parses bounded regional
members, stages immutable drafts, and (only with `publishVerified:true`) invokes
the source-rule verifier. The Worker integration must bind that option to its
explicit source-rule runtime flag. The default remains review-only.

Source-rule acceptance requires an enrolled, unexpired official source and
transactional permission guards. It reparses retained XML, verifies its digest,
requires complete PA/NJ/DE delegations (House 17/12/1; Senate 2/2/2), rebuilds every
fact, and exact-compares the full stored draft. Incomplete/vacant delegations stay
in review; no vacancy is inferred. The public snapshot records
`source-rule-roster-1` and `source-rule:official-roster`, not a human identity.

The collector also fences publication against source revocation and lease loss.
Names are observed-current with null start/end dates. Historical membership,
committee roles, sponsorship and home-address matching are not invented.

## Migration

0037 copies existing observation rows into a replacement table with a 1000000-byte
raw cap (previously 500000), preserves all columns and bytes, then reinstalls the
immutable-update trigger. Payload cap remains 1000000. Runtime enforces identical
byte bounds. This accommodates the actual 556936-byte House roster without
truncation. No foreign keys point at this table. Backup and production migration
remain the integrating release operator's responsibility.

## Actual Retained Evidence

First House capture: `/mnt/d/tmp/plumbob/tvd-house-roster-20260915/house.xml`,
observed 2026-09-15T14:48:55.686Z, 556936 bytes, 30 regional members.
First Senate: `/mnt/d/tmp/plumbob/tvd-representatives-capture-20260912/senate.xml`,
observed 2026-09-12T16:30:27.198Z, 52541 bytes, 6 regional members.

Fresh public captures retained intact under
`/mnt/d/tmp/plumbob/tvd-federal-rosters-20260915-T7imhB/`:

- `house.xml` / `house.json`, 2026-09-15T15:04:18.985Z, 556936 bytes,
  SHA256 07aec65948e99fd80b5e7c31722f1208d9f5e0717ba00f4b02122f4724cb0c18.
- `senate.xml` / `senate.json`, 2026-09-15T15:04:19.520Z, 52541 bytes,
  SHA256 984865a4a6e00af68c9617ea45f52b8939f49143780c832cb68c747fa4bfef5e.

Both requests returned public XML with no authentication, redirect or bypass.
These are two observations, not proof of ongoing availability. A full offline
replay retained raw bytes, accepted via an explicit test-only source policy, and
read 30 House and 6 Senate members through public projection. No live data changed.

## Verification And Remaining Integration

Tests cover raw migration preservation/size/immutability, exact-draft tampering,
source qualification, incomplete/capped snapshots, default-off publication,
scheduled 304 replay, current revision reuse, revocation/lease races, and public
observed-date precision. Existing state/chamber UI tests cover PA/NJ/DE/federal
and unmatched regulatory/local bodies.

Integrating operator must enroll/qualify sources using real retained samples,
configure approved link scopes, apply 0037, enable the explicit runtime publication
flag, and read production directory counts after a real scheduled refresh.
State legislative rosters remain separate sources and cannot be inferred from
federal delegations.
