import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_SCHEMA_VERSION as v,
  DISCOVERY_PROVIDERS,
  DEPENDENCY_KINDS,
  DependencyVector,
  DiscoveryDate,
  makeDiscoveryDate,
  discoveryDateContained,
  DiscoveryReviewDecision,
  ArtifactRightsAssessment,
  CanonicalDiscoveryQuery,
  DiscoverySnapshot,
  checkDiscoveryContinuation,
  DiscoveryPublicRevision,
  type ReviewTarget,
  DISCOVERY_LIMITS,
} from "../src/content/discovery-schema";
import {
  DiscoverySourceRequest,
  DiscoverySourceObservation,
  DiscoverySourcePage,
  DiscoverySourceCapture,
  DiscoverySourceFailure,
  DISCOVERY_SOURCE_FAILURES,
  assertDiscoveryEnvelopeBytes,
} from "../src/ingest/discovery/source-contract";
const ref = { id: "ref", revision: 1 };
const entries = DEPENDENCY_KINDS.map((kind, i) => ({
  kind,
  id: `id-${i}`,
  revision: 1,
  role: kind === "projection-generation" ? "commit-guard" : "validity",
}));
const vector = {
  entries,
  required: entries.map(({ kind, id }) => ({ kind, id })),
};
const q = {
  schemaVersion: v,
  entity: "works",
  text: "health data",
  terms: ["data", "health"],
  facets: {
    counties: ["PA:Bucks"],
    topics: [],
    providers: [],
    kinds: [],
    creators: [],
    organizations: [],
  },
  regionalMode: "regional-at-creation",
  dateFilter: null,
  sort: "relevance",
  pageSize: 25,
  aliasPolicy: ref,
};
const snapshot = {
  schemaVersion: v,
  id: "snapshot",
  query: q,
  generation: 1,
  invalidationEpoch: 1,
  recoveryIncarnation: "restore-1",
  asOf: "2024-01-01T00:00:00Z",
  expiresAt: "2024-01-01T00:10:00Z",
  rows: [{ kind: "work", subjectId: "work-1", rowId: "row-1", revision: 1 }],
  dependencies: vector,
};
const cursor = {
  schemaVersion: v,
  tokenId: "token",
  snapshotId: "snapshot",
  query: q,
  recoveryIncarnation: "restore-1",
  afterRowId: "row-1",
};
const current = {
  query: q,
  invalidationEpoch: 1,
  recoveryIncarnation: "restore-1",
  now: "2024-01-01T00:01:00Z",
};
const request = (provider: string) => ({
  schemaVersion: v,
  operationId: "op",
  runId: "run",
  sourceId: "source",
  provider,
  installation: "install",
  scopeId: "scope",
  enrollment: ref,
  configuration: ref,
  permission: ref,
  parser: ref,
  endpointConstructor: "endpoint",
  parameters: {},
  checkpoint: null,
  budgetReservation: ref,
  leaseFence: ref,
  purpose: "collection",
  qualification: ref,
});
const obs = (provider: string, kind: string) => ({
  schemaVersion: v,
  id: "observation",
  identity: { provider, installation: "install", nativeId: "native", kind },
  subject: { kind, id: "subject" },
  representationSha256: "a".repeat(64),
  provenanceOriginId: "origin",
  sourceUrl: "https://source.example/item",
  observedAt: "2024-01-01T00:00:00Z",
  sourceDate: makeDiscoveryDate("year", "2024"),
  parser: ref,
  evidence: [ref],
});
test("Gregorian calendar bounds, precision and UTC instant filtering", () => {
  assert.deepEqual(makeDiscoveryDate("month", "2024-02"), {
    precision: "month",
    value: "2024-02",
    calendar: "proleptic-gregorian",
    lowerDate: "2024-02-01",
    upperDate: "2024-03-01",
  });
  for (const [precision, value] of [
    ["day", "2023-02-29"],
    ["day", "1900-02-29"],
    ["day", "2024-04-31"],
    ["year", "0000"],
    ["day", "9999-01-01"],
    ["instant", "2024-01-01T00:00:00"],
    ["instant", "2024-02-30T00:00:00Z"],
    ["instant", "2024-01-01T00:00:00.0001Z"],
    ["instant", "2024-01-01T00:00:00+25:00"],
  ] as const)
    assert.throws(() => makeDiscoveryDate(precision, value));
  const yearOne = makeDiscoveryDate("instant", "0001-01-01T00:00:00Z");
  assert.equal(yearOne.precision, "instant");
  if (yearOne.precision !== "instant") throw new Error("expected instant");
  assert.equal(yearOne.lowerEpochMs, -62135596800000);
  assert.equal(
    discoveryDateContained(
      makeDiscoveryDate("instant", "2024-01-01T01:00:00+01:00"),
      "2024-01-01",
      "2024-01-02",
    ),
    true,
  );
  assert.equal(
    discoveryDateContained(
      makeDiscoveryDate("year", "2024"),
      "2024-02-01",
      "2025-01-01",
    ),
    false,
  );
  assert.equal(
    discoveryDateContained(
      makeDiscoveryDate("unknown", "2024-01-01T01:00:00"),
      "2024-01-01",
      "2025-01-01",
    ),
    false,
  );
  assert.equal(
    DiscoveryDate.safeParse({
      ...makeDiscoveryDate("year", "2024"),
      upperDate: "2024-12-31",
    }).success,
    false,
  );
  assert.throws(() =>
    discoveryDateContained(
      makeDiscoveryDate("day", "2024-01-01"),
      "2024-02-30",
      "2025-01-01",
    ),
  );
});
test("dependency vector requires exact unique keys and valid roles, not mere equal counts", () => {
  assert.equal(DependencyVector.safeParse(vector).success, true);
  assert.equal(
    DependencyVector.safeParse({
      ...vector,
      required: vector.required.slice(1),
    }).success,
    false,
  );
  assert.equal(
    DependencyVector.safeParse({
      ...vector,
      entries: [...entries.slice(1), entries[1]],
    }).success,
    false,
  );
  assert.equal(
    DependencyVector.safeParse({
      ...vector,
      entries: entries.map((e) => ({ ...e, role: "validity" })),
    }).success,
    false,
  );
  assert.equal(
    DependencyVector.safeParse({
      ...vector,
      required: vector.required.map((e, i) => (i ? e : { ...e, id: "other" })),
    }).success,
    false,
  );
});
test("review authority and artifact rights are typed and strict", () => {
  const d = {
    schemaVersion: v,
    id: "decision",
    revision: 1,
    target: {
      kind: "creator",
      subject: { kind: "person", id: "person" },
      revision: 1,
    },
    decision: "accepted",
    authority: {
      kind: "authenticated-reviewer",
      principalId: "reviewer",
      authenticationContextId: "ctx",
    },
    reason: "review",
    policy: ref,
    evidence: [ref],
    expectedDependencies: vector,
    operationId: "op",
    decidedAt: "2024-01-01T00:00:00Z",
  };
  assert.equal(DiscoveryReviewDecision.safeParse(d).success, true);
  assert.equal(
    DiscoveryReviewDecision.safeParse({
      ...d,
      target: { ...d.target, subject: { kind: "account", id: "person" } },
    }).success,
    false,
  );
  assert.equal(
    DiscoveryReviewDecision.safeParse({
      ...d,
      authority: { kind: "model", id: "x" },
    }).success,
    false,
  );
  assert.equal(
    DiscoveryReviewDecision.safeParse({
      ...d,
      authority: { ...d.authority, extra: true },
    }).success,
    false,
  );
  const rights = {
    schemaVersion: v,
    id: "rights",
    revision: 1,
    artifactId: "paper",
    artifactVersion: "v1",
    material: "figures",
    classification: "unknown",
    permissions: {
      fetch: "allow",
      retain: "unknown",
      transform: "unknown",
      display: "unknown",
      reuse: "unknown",
    },
    evidence: [],
    policy: ref,
    assessedAt: "2024-01-01T00:00:00Z",
  };
  assert.equal(ArtifactRightsAssessment.safeParse(rights).success, true);
  for (const material of [
    "metadata",
    "code",
    "text",
    "figures",
    "data",
    "weights",
    "forum-content",
  ])
    assert.equal(
      ArtifactRightsAssessment.safeParse({ ...rights, material }).success,
      true,
    );
  assert.equal(
    ArtifactRightsAssessment.safeParse({
      ...rights,
      classification: "permitted",
    }).success,
    false,
  );
  assert.equal(
    ArtifactRightsAssessment.safeParse({
      ...rights,
      permissions: { ...rights.permissions, reuse: undefined },
    }).success,
    false,
  );
  assert.equal(
    ArtifactRightsAssessment.safeParse({ ...rights, artifactVersion: "" })
      .success,
    false,
  );
});
test("canonical queries reject punctuation, drift, duplicate facets and unsupported combinations", () => {
  assert.equal(CanonicalDiscoveryQuery.safeParse(q).success, true);
  for (const patch of [
    { text: "!!!", terms: [] },
    { text: "Health data" },
    { terms: ["health", "data"] },
    { facets: { ...q.facets, counties: ["PA:Bucks", "PA:Bucks"] } },
    { entity: "people" },
    { pageSize: 101 },
    { extra: true },
  ])
    assert.equal(
      CanonicalDiscoveryQuery.safeParse({ ...q, ...patch }).success,
      false,
    );
});
test("snapshot uniqueness and continuation mismatch, invalidation, restore and exact expiry", () => {
  assert.equal(DiscoverySnapshot.safeParse(snapshot).success, true);
  assert.equal(
    DiscoverySnapshot.safeParse({
      ...snapshot,
      rows: [...snapshot.rows, { ...snapshot.rows[0], rowId: "row-2" }],
    }).success,
    false,
  );
  assert.equal(
    DiscoverySnapshot.safeParse({
      ...snapshot,
      rows: [{ ...snapshot.rows[0], kind: "person" }],
    }).success,
    false,
  );
  assert.equal(
    checkDiscoveryContinuation(snapshot, cursor, current).status,
    200,
  );
  assert.equal(
    checkDiscoveryContinuation(
      snapshot,
      { ...cursor, afterRowId: "missing" },
      current,
    ).status,
    400,
  );
  assert.equal(
    checkDiscoveryContinuation(snapshot, cursor, {
      ...current,
      query: { ...q, text: "", terms: [] },
    }).status,
    400,
  );
  assert.equal(
    checkDiscoveryContinuation(snapshot, cursor, {
      ...current,
      recoveryIncarnation: "restore-2",
    }).status,
    410,
  );
  assert.equal(
    checkDiscoveryContinuation(snapshot, cursor, {
      ...current,
      invalidationEpoch: 2,
    }).status,
    410,
  );
  assert.deepEqual(
    checkDiscoveryContinuation(snapshot, cursor, {
      ...current,
      now: snapshot.expiresAt,
    }),
    { status: 410, kind: "discovery-snapshot-expired", restart: true },
  );
  const pub = {
    schemaVersion: v,
    row: snapshot.rows[0],
    generation: 2,
    dependencies: vector,
    decision: ref,
    publishedAt: snapshot.asOf,
    expiresAt: snapshot.expiresAt,
  };
  assert.equal(DiscoveryPublicRevision.safeParse(pub).success, true);
  const expiredEntries = entries.map((e, i) =>
    i === 0 ? { ...e, expiresAt: "2024-01-01T00:05:00Z" } : e,
  );
  assert.equal(
    DiscoveryPublicRevision.safeParse({
      ...pub,
      dependencies: { ...vector, entries: expiredEntries },
    }).success,
    false,
  );
  const guardEntries = entries.map((e) =>
    e.kind === "projection-generation"
      ? { ...e, expiresAt: "2024-01-01T00:05:00Z" }
      : e,
  );
  assert.equal(
    DiscoveryPublicRevision.safeParse({
      ...pub,
      dependencies: { ...vector, entries: guardEntries },
    }).success,
    true,
  );
});
test("six synthetic provider routes admit independent artifact and creator observations", () => {
  // Synthetic identifiers and references only; they establish no real identities or authorship.
  const cases = [
    {
      name: "github repository",
      provider: "github",
      observations: [
        {
          ...obs("github", "artifact"),
          identity: {
            ...obs("github", "artifact").identity,
            nativeId: "1234567",
          },
          sourceVersion: "commit-abc",
        },
      ],
    },
    {
      name: "pubmed paper without repository",
      provider: "pubmed",
      observations: [
        {
          ...obs("pubmed", "artifact"),
          identity: {
            ...obs("pubmed", "artifact").identity,
            nativeId: "34567890",
          },
        },
      ],
    },
    {
      name: "crossref organization-authored artifact without person join",
      provider: "crossref",
      observations: [
        {
          ...obs("crossref", "artifact"),
          identity: {
            ...obs("crossref", "artifact").identity,
            nativeId: "10.9999/example",
          },
          evidence: [{ id: "organization-authorship-evidence", revision: 1 }],
        },
      ],
    },
    {
      name: "arxiv base and version",
      provider: "arxiv",
      observations: [
        {
          ...obs("arxiv", "artifact"),
          identity: {
            ...obs("arxiv", "artifact").identity,
            nativeId: "2401.01234",
          },
          sourceVersion: "v2",
        },
      ],
    },
    {
      name: "forum work and separate account",
      provider: "forum",
      observations: [
        {
          ...obs("forum", "artifact"),
          id: "forum-work",
          identity: {
            ...obs("forum", "artifact").identity,
            nativeId: "post-1",
          },
          evidence: [{ id: "local-creator-role-evidence", revision: 1 }],
        },
        {
          ...obs("forum", "account"),
          id: "forum-account",
          identity: {
            ...obs("forum", "account").identity,
            nativeId: "account-1",
          },
          subject: { kind: "account", id: "separate-account" },
        },
      ],
    },
    {
      name: "institutional independent person without work",
      provider: "institutional",
      observations: [
        {
          ...obs("institutional", "person"),
          identity: {
            ...obs("institutional", "person").identity,
            nativeId: "professional-1",
          },
        },
      ],
    },
  ];
  assert.deepEqual(
    cases.map((c) => c.provider),
    [...DISCOVERY_PROVIDERS],
  );
  for (const item of cases) {
    const req = request(item.provider);
    for (const observation of item.observations)
      assert.equal(
        DiscoverySourceObservation.safeParse(observation).success,
        true,
        item.name,
      );
    assert.equal(
      DiscoverySourceRequest.safeParse(req).success,
      true,
      item.name,
    );
    assert.equal(
      DiscoverySourcePage.safeParse({
        schemaVersion: v,
        request: req,
        pageReceipt: ref,
        observations: item.observations,
        outcome: "healthy",
        completeness: "complete",
        nextCheckpoint: null,
        committed: true,
      }).success,
      true,
      item.name,
    );
  }
  assert.equal(
    DiscoverySourceObservation.safeParse({
      ...obs("arxiv", "artifact"),
      sourceVersion: "",
    }).success,
    false,
  );
  assert.equal(
    DiscoverySourceObservation.safeParse({
      ...obs("arxiv", "artifact"),
      sourceVersion: "x".repeat(201),
    }).success,
    false,
  );
  const { qualification, ...base } = request("forum");
  const sample = {
    ...base,
    purpose: "qualification-sample",
    samplingAuthorization: ref,
  };
  assert.equal(DiscoverySourceRequest.safeParse(sample).success, true);
  assert.equal(
    DiscoverySourceRequest.safeParse({ ...sample, qualification: ref }).success,
    false,
  );
  assert.equal(
    DiscoverySourceObservation.safeParse({
      ...obs("forum", "account"),
      subject: { kind: "person", id: "subject" },
    }).success,
    false,
  );
  const page = {
    schemaVersion: v,
    request: request("forum"),
    pageReceipt: ref,
    observations: [obs("forum", "account")],
    outcome: "healthy",
    completeness: "complete",
    nextCheckpoint: null,
    committed: true,
  };
  assert.equal(
    DiscoverySourcePage.safeParse({
      ...page,
      observations: [obs("github", "account")],
    }).success,
    false,
  );
  assert.equal(
    DiscoverySourcePage.safeParse({ ...page, outcome: "healthy-empty" })
      .success,
    false,
  );
  assert.equal(
    DiscoverySourcePage.safeParse({
      ...page,
      outcome: "partial",
      completeness: "provider-limited",
    }).success,
    false,
  );
  assert.equal(
    DiscoverySourcePage.safeParse({
      ...page,
      outcome: "partial",
      completeness: "provider-limited",
      limitationReceipt: ref,
    }).success,
    true,
  );
  assert.equal(
    DiscoverySourcePage.safeParse({
      ...page,
      outcome: "partial",
      completeness: "partial",
      nextCheckpoint: "next",
      committed: false,
    }).success,
    false,
  );
  for (const outcome of DISCOVERY_SOURCE_FAILURES)
    assert.equal(
      DiscoverySourceFailure.safeParse({
        schemaVersion: v,
        operationId: "op",
        sourceId: "s",
        outcome,
        retryAfter: null,
        checkpointUnchanged: true,
        code: "error",
      }).success,
      true,
    );
  assert.equal(
    DiscoverySourceFailure.safeParse({
      schemaVersion: v,
      operationId: "op",
      sourceId: "s",
      outcome: "healthy-empty",
      retryAfter: null,
      checkpointUnchanged: true,
      code: "error",
    }).success,
    false,
  );
  assert.throws(() =>
    assertDiscoveryEnvelopeBytes({ text: "é".repeat(140000) }),
  );
});

// These assignments are intentionally invalid at compile time as well as runtime.
const invalidCreator: ReviewTarget = {
  kind: "creator",
  // @ts-expect-error account is not a creator subject
  subject: { kind: "account", id: "account" },
  revision: 1,
};
const invalidWork: ReviewTarget = {
  kind: "work",
  // @ts-expect-error person is not a work subject
  subject: { kind: "person", id: "person" },
  revision: 1,
};
void invalidCreator;
void invalidWork;

test("all dependency roles are enforced and evidence bounds reject duplicates and overflow", () => {
  for (let i = 0; i < entries.length; i++) {
    const changed = entries.map((entry, index) =>
      index === i
        ? {
            ...entry,
            role: entry.role === "validity" ? "commit-guard" : "validity",
          }
        : entry,
    );
    assert.equal(
      DependencyVector.safeParse({ ...vector, entries: changed }).success,
      false,
    );
  }
  const many = Array.from(
    { length: DISCOVERY_LIMITS.maxDependencies + 1 },
    (_, i) => ({
      kind: "claim",
      id: `claim-${i}`,
      revision: 1,
      role: "validity",
    }),
  );
  assert.equal(
    DependencyVector.safeParse({
      entries: many,
      required: many.map(({ kind, id }) => ({ kind, id })),
    }).success,
    false,
  );
  const rights = {
    schemaVersion: v,
    id: "rights",
    revision: 1,
    artifactId: "a",
    artifactVersion: "v1",
    material: "text",
    classification: "unknown",
    permissions: {
      fetch: "unknown",
      retain: "unknown",
      transform: "unknown",
      display: "unknown",
      reuse: "unknown",
    },
    evidence: [ref, ref],
    policy: ref,
    assessedAt: "2024-01-01T00:00:00Z",
  };
  assert.equal(ArtifactRightsAssessment.safeParse(rights).success, false);
  const evidence = Array.from(
    { length: DISCOVERY_LIMITS.maxEvidenceRefs + 1 },
    (_, i) => ({ id: `e-${i}`, revision: 1 }),
  );
  assert.equal(
    ArtifactRightsAssessment.safeParse({ ...rights, evidence }).success,
    false,
  );
});

test("query character limit counts codepoints, and parsed property order is immaterial", () => {
  const astral = "𐐨".repeat(DISCOVERY_LIMITS.maxQueryCharacters);
  assert.equal(astral.length, 2 * DISCOVERY_LIMITS.maxQueryCharacters);
  assert.equal(
    CanonicalDiscoveryQuery.safeParse({ ...q, text: astral, terms: [astral] })
      .success,
    true,
  );
  assert.equal(
    CanonicalDiscoveryQuery.safeParse({
      ...q,
      text: astral + "𐐨",
      terms: [astral + "𐐨"],
    }).success,
    false,
  );
  const reorderedQuery = {
    aliasPolicy: ref,
    pageSize: 25,
    sort: "relevance",
    dateFilter: null,
    regionalMode: "regional-at-creation",
    facets: {
      organizations: [],
      creators: [],
      kinds: [],
      providers: [],
      topics: [],
      counties: ["PA:Bucks"],
    },
    terms: ["data", "health"],
    text: "health data",
    entity: "works",
    schemaVersion: v,
  };
  assert.equal(
    checkDiscoveryContinuation(
      snapshot,
      { ...cursor, query: reorderedQuery },
      { ...current, query: reorderedQuery },
    ).status,
    200,
  );
  const reorderedDate = {
    upperDate: "2025-01-01",
    lowerDate: "2024-01-01",
    calendar: "proleptic-gregorian",
    value: "2024",
    precision: "year",
  };
  assert.equal(DiscoveryDate.safeParse(reorderedDate).success, true);
  assert.equal(
    checkDiscoveryContinuation(snapshot, cursor, {
      ...current,
      now: "2023-12-31T23:59:59Z",
    }).status,
    400,
  );
});

test("provisional capture preserves pagination without asserting durable acknowledgment", () => {
  const capture = {
    schemaVersion: v,
    request: request("forum"),
    observations: [obs("forum", "account")],
    outcome: "partial",
    completeness: "partial",
    proposedCheckpoint: "next-page",
  };
  assert.equal(DiscoverySourceCapture.safeParse(capture).success, true);
  assert.equal(
    DiscoverySourceCapture.safeParse({
      ...capture,
      committed: true,
      pageReceipt: ref,
    }).success,
    false,
  );
  assert.equal(DiscoverySourcePage.safeParse(capture).success, false);
  const { proposedCheckpoint, ...body } = capture;
  const acknowledgment = {
    ...body,
    pageReceipt: ref,
    nextCheckpoint: proposedCheckpoint,
    committed: true,
  };
  assert.equal(DiscoverySourcePage.safeParse(acknowledgment).success, true);
  assert.equal(
    DiscoverySourcePage.safeParse({ ...acknowledgment, committed: false })
      .success,
    false,
  );
  assert.equal(
    DiscoverySourceCapture.safeParse({
      ...capture,
      completeness: "provider-limited",
    }).success,
    false,
  );
  assert.equal(
    DiscoverySourceCapture.safeParse({
      ...capture,
      completeness: "provider-limited",
      limitationReceipt: ref,
    }).success,
    true,
  );
  assert.equal(
    DiscoverySourceCapture.safeParse({
      ...capture,
      observations: [obs("github", "account")],
    }).success,
    false,
  );
});
