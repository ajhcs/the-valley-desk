# Dependency remediation qualification

This change addresses the online npm audit against the `d7081f8` lockfile. It
records a locally qualified dependency change; discovery package acceptance and deployment remain separate. An online audit is
a point-in-time advisory result; a clean result does not establish runtime safety.

## Selected graph

The direct dependencies are pinned to `zod` 4.6.7, `fast-xml-parser` 5.12.0,
`vite` 8.2.4 and `wrangler` 4.153.0. Wrangler selects Miniflare
5.20261023.0-beta, which selects Undici 7.30.1. The resolved router graph has
`@tanstack/react-router` 1.170.32, `@tanstack/router-core` 1.171.27,
`seroval-plugins` 1.6.3 and `seroval` 1.8.1. No Seroval override is added.
The selected Zod, XML, Vite and Undici versions are at or above the relevant
patched versions in the [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[XML parser](https://github.com/advisories/GHSA-474x-hrwr-fgx4),
[Vite](https://github.com/advisories/GHSA-587h-7wmj-h5pm) and
[Undici](https://github.com/advisories/GHSA-xjj6-f33q-929c) advisories;
Seroval 1.8.1 is beyond the affected range in the
[Seroval advisory](https://github.com/advisories/GHSA-f86p-h4j2-7qgj).

Zod uses the genuine v4 parser. Merely installing a v4 package while importing
its v3 compatibility parser could clear a package-version audit without supplying
the intended collection bounds behavior. The migration must preserve existing
contract semantics, including UTC date precision and URL acceptance without
rewriting values, record key/value validation, defaults and strict-object
behavior, and native receipt normalization and signature bindings. The local
compatibility helpers use v4 validation; the security regression checks bounded
collection handling, strict native cases and pre-migration fictional signed
receipts. The legacy Watch comparison retains a Zod 3-derived reference fixture.
These checks are evidence of the exercised contracts, not proof that every input
or downstream behavior is equivalent.

Two deliberate validation changes remain: integer fields reject values outside
the safe-integer range, and unknown-valued properties require an explicit value.
Consumer probes confirm that valid government identifiers and an explicitly
absent technology purpose (`null`) still parse, while imprecise identifiers and
missing evidence values fail. The [independent review](reviews/dependency-remediation-astra.md)
records these checks and the preserved original signature bindings.

## Independent local probes

Terra exercised the installed graph with Node 22 using synthetic data. The ESM
probe loaded a memory router and route parameters, round-tripped an object and
Map through Seroval, and imported the stream plugin. XML 5.12.0 preserved the
tested ordered namespace, attributes and entity content, rejected malformed XML,
and handled a bounded unterminated stop-node input. The probe and log are kept
in the private `.discovery-work/dependency-remediation/terra` evidence directory.
They are targeted compatibility observations, not production or full-suite
qualification.

An isolated experiment forcing only Seroval 1.6.11 allowed npm to select
`seroval-plugins` 1.8.0, whose peer requires Seroval `^1.8.0`. Router and plugin
imports failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` for `seroval/shared`.
An older 1.6.3 plugin and Seroval 1.6.11 passed the same limited probe, but
the naturally resolved 1.8.1/1.6.3 pair avoids a transitive override. Retain the
failed experiment as evidence; an override that appears minimal can produce an
incompatible graph.

## Qualification state

The local clean `npm ci` completed, and the subsequent online npm audit reported
zero advisories for that resolved graph. These are local observations for the
then-current inputs; a fresh complete qualification must bind its exact input
snapshot. System Python's initial PDF bootstrap failed because `ensurepip` was
unavailable. The project virtual environment was recreated using the existing
workspace CPython 3.12.14, and hash-locked pip bootstrap then succeeded; this
did not install a host Python package baseline.

Local qualification passed on 615 stable runtime inputs: the complete npm test chain executed 939 application, 146 Watch and 316 discovery tests, with zero failures, skips or cancellations. Seven PDF regressions, build, isolated local smoke, online audit (zero reported vulnerabilities) and secret scan passed. [The receipt](receipts/dependency-remediation.json) binds exact inputs and logs. Exact-head CI is tracked separately on the PR. Existing discovery work-package statuses, human-review gates and deployment hold remain unchanged.

Zod 4 intentionally rejects unsafe integer identities/counts/indices and missing required unknown-value fields. UTC minute/second strings, existing offset syntax, and raw URL outputs retain the independently captured v3 behavior. These are bounded compatibility results, not whole-program equivalence or source truth. The upstream collection fix applies to leading size-constrained schemas; existing transport byte/node/depth caps remain necessary.
