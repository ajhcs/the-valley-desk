# House Clerk Roster Preparation

Review-only follow-on, not production activation or a source qualification.

## Official Contract

The [House XML data catalog](https://xml.house.gov/resources/SelectedList-LegisBranchData.htm)
links the Clerk's MemberData XML and its
[official data dictionary](https://clerk.house.gov/member_info/MemberData_UserGuide.pdf).
The dictionary describes current membership, stable BioGuide IDs, state/district
codes and the `publish-date` update label. District `00` denotes an at-large seat.
The catalog's HTTP link was read through the corresponding public HTTPS endpoint:
`https://clerk.house.gov/xml/lists/MemberData.xml`.

The documented endpoint returned HTTP 200 without authentication. No alternate
host, proxy, CAPTCHA interaction or access-policy bypass was used.

## Actual Capture

Command (existing mounted scratch directory required):

```sh
node --import tsx/esm scripts/capture-house-roster.mjs /mnt/d/tmp/plumbob/tvd-house-roster-20260915
```

Files: `house.xml` and `observation.json`. The request's observation instant was
2026-09-15T14:48:55.686Z. Full XML: 556,936 UTF-8 bytes; SHA-256
`07aec65948e99fd80b5e7c31722f1208d9f5e0717ba00f4b02122f4724cb0c18`.
Source publication label: September 2, 2026. Congress: 119.

Regional members parsed: Pennsylvania 17, New Jersey 12, Delaware 1.
This is one observed snapshot, not evidence of historical terms or ongoing
collection reliability. The committed XML fixture contains exactly three literal
member elements from this capture, surrounded by a reduced XML wrapper; it is
an excerpt, never a complete roster or production seed. Its member bytes were
checked against the retained full source.

## Integration And Limits

- `parseHouseRoster` validates bounded XML, rejects DTD/entities, duplicate seats
  and identities, and checks state/district consistency. Only PA/NJ/DE members
  become normalized records. Parsed source member objects remain in the evidence.
- `prepareHouseRosterCaptures` creates separate federal House jurisdiction drafts.
  Delaware district 00 is an at-large office. The allowlist grants this exact
  endpoint only the `us-house` body, not Senate or state legislature authority.
- Election/oath fields are retained but not converted into service dates. Draft
  memberships have null start/end dates and observation precision. Committee
  assignments and omitted/vacant entries create no accepted roles or vacancies.
- The XML provides no member profile URL. Draft profile links remain null; the
  existing official House representative lookup remains available.
- Full XML exceeds the existing 500,000-byte `representative_roster_observations`
  database limit. This slice retains it intact in mounted scratch and does not
  truncate it, rewrite migrations, or claim durable production ingestion. A
  separately reviewed bounded raw-storage integration is required before scheduled
  collection. Normalized regional drafts fit the existing staging contracts.
- Source review/qualification, a second independent capture, durable retention,
  scheduled collection and authenticated named editorial decisions remain open.
  This code creates no approval, publication or deployment.

## Verification

46 representative tests pass, including actual three-member excerpt staging,
district/identity conflicts, entity/size rejection, fixed endpoint and HTTP 403
stop behavior. Build/typecheck passes with the existing bundle-size warning;
secret scan and diff check pass.

An additional offline full-capture SQLite replay staged 17/12/1 members as
52/37/4 proposed facts, with zero representative decisions. The three literal
fixture elements match the retained full capture exactly.
