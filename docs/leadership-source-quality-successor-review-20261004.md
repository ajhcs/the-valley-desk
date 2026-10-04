# Leadership attribution successor

Successor to frozen candidate `9745beb1ab6fc6f6ec00acebfce9c16fd97eb960`, which remains unchanged. Approved regional base is `139e53ee0d39695111d9d42785d220e079f5490c`. This work excludes the separate inert Ops diagnostic patch and PA branches/PR18.

Independent review requested changes for two reproduced attribution defects. This successor fixes both locally on BuilderBob with network-free regressions.

## Person heading boundary

Exact reviewer probe:

```html
<main><h2>Alex Example</h2><h2>Jordan Example, CEO</h2><p>Chief Information Officer</p></main>
```

The earlier candidate gave Alex and Jordan the following paragraph's CIO title. The successor cuts every person's heading region before the next heading, regardless of title words. An exact name/role heading such as `Jordan Example, CEO` supplies Jordan's own CEO role; its following paragraph cannot overwrite that role or leak to Alex. A subordinate role-only heading can provide its literal title, with no following paragraph included. Ambiguous role-bearing headings are excluded as person names. The reviewer probe now returns only Jordan/CEO; no Alex evidence or current-role observation is created.

## Institution linkage for article claims

Exact reviewer article body:

```text
Cooper Norcross Health welcomed Remote Health chief medical information officer Alex Example.
```

The earlier candidate's broad sentence filter retained Alex as a Cooper article claim. Every successor article grammar requires a direct institution relationship: institution/role/name, a bounded institution appointment/contract action, named person/role/of-at-for/institution, role/person/of-at-for/institution, or a quote attribution with role/of-at-for/institution. A mention elsewhere in a sentence is insufficient. The reviewer probe now yields no extracted claims or role events.

Article headings and generic Person metadata are no longer admitted as target-institution claims without explicit scoped article text. This intentionally excludes unsupported associations rather than preserving misleading historical evidence. Existing structured/article tests now check exclusion of unscoped metadata; publication-date tests retain their purpose using explicit institution-bound claim text. Ordinary nonarticle roster extraction and existing explicit institution-specific roster contracts remain covered by their control tests. A semantic article body is an evidence container when main is absent, under the same scoped grammar.

## Captured primary-source replay

Same retained decoded bytes, no new public fetch:

| Capture | Successor extraction | Claims | Current-role events | New last-success timestamp |
| --- | --- | --- | --- | --- |
| Cooper September28 release | partial | 1 | 0 | none |
| Rutgers September15 release | partial | 1 | 0 | none |
| Penn CEO profile challenge | challenge | 0 | 0 | none |

Publication dates remain verbatim `2026-09-28T20:39:34+00:00` and `2026-09-15T11:03:19-0400`, with `currentAffiliationVerified: false`. The original Cooper alias, empty-challenge classification, digest condition-evaluation wording and retry safeguards are retained unchanged. The article releases do not establish current institutional rosters or recover any of the six missing sources.

## Validation and scope

51 focused leadership/health/source-quality tests pass, including the exact reviewer probes and controls for all supported attribution grammars. All873 repository tests pass (727 main +146 watch), alongside the TypeScript/Vite build, required secret scan and git diff check. Build retains the existing bundle-size advisory. Full evidence is included in the immutable handoff manifest. Independent successor retest is separately recorded; owner-run checks are not labelled independent.

All code, fixture replay and tests run on BuilderBob. Lenovo carries SSH/SCP only. No D1 query/replay/mutation, source registration/activation, blocked URL retry, institution outreach, live Ops diagnostic, PA changes or deployment occurs during this repair. Existing authorization for reviewed regional code merge/deploy persists; exact successor review is the next gate. Ops disclosure and D1 uncertainty remain separate holds. Source cadence and the concrete six-source backlog are unchanged.
