import { makeDiscoveryDate } from '../src/content/discovery-schema';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import {
  createDiscoveryEvidenceStore,
  canonicalDiscoveryEvidenceJson,
} from '../src/ingest/discovery-evidence-store';
import {
  createDiscoverySourceRegistry,
  sourceConfigurationDigest,
  requestScopeDigest,
} from '../src/ingest/discovery/source-registry';
import { discoveryEndpointTemplateDigest } from '../src/ingest/discovery/endpoint';
import {
  DiscoveryRuntimeSource,
  type DiscoveryEndpointTemplate,
} from '../src/ingest/discovery/runtime-contract';
import { DiscoverySourcePage } from '../src/ingest/discovery/source-contract';
import {
  DISCOVERY_COLLECTION_VERSION,
  type DiscoveryCollectionParser,
  type DiscoveryCollectionLead,
  type DiscoveryPreparedCollectionPage,
} from '../src/ingest/discovery/collection-contract';
import { createDiscoveryCollectionStore } from '../src/ingest/discovery/collection-store';
import { createDiscoveryCollector } from '../src/ingest/discovery/collector';
import type {
  D1DatabaseLike,
  D1StatementLike,
} from '../src/ingest/persistence';

const BASE = '2030-01-01T00:00:00.000Z',
  EXPIRY = '2090-01-01T00:00:00.000Z';
const ref = (id: string, revision = 1) => ({ id, revision });
const bytes = (text: string) => new TextEncoder().encode(text);
const sha = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const at = (instant: string, ms: number) =>
  new Date(Date.parse(instant) + ms).toISOString();
let serial = 0;
const context = (label: string) => ({
  operationId: `test:${label}:${++serial}`,
  capabilityToken: 'synthetic-collection-capability',
});
const evidenceContext = (
  label: string,
  expectedRevision: number | null = null,
) => ({ ...context(label), expectedRevision });
const authority = async (_token: string, request: any) => ({
  receiptId: 'synthetic:receipt',
  principalId: 'synthetic:reviewer',
  authenticationContextId: 'synthetic:auth',
  minimalAuditRetention: 'allow' as const,
  expiresAt: EXPIRY,
  ...request,
});
const lead = (
  nativeId = 'native-one',
  displayName = 'Synthetic independent creator',
  extra: Partial<DiscoveryCollectionLead> = {},
): DiscoveryCollectionLead => ({
  nativeId,
  kind: 'person',
  displayName,
  relatedAccounts: [],
  unresolvedPeople: [],
  publicationAuthorized: false,
  sourceStage: 'profile',
  sourceDates: [],
  ...extra,
});
const pageBody = (
  options: {
    leads?: ReturnType<typeof lead>[];
    terminal?: boolean;
    nextCheckpoint?: string | null;
    rejectedCount?: number;
    truncated?: boolean;
    providerLimited?: boolean;
  } = {},
) =>
  JSON.stringify({
    leads: options.leads ?? [lead()],
    terminal: options.terminal ?? true,
    nextCheckpoint: options.nextCheckpoint ?? null,
    rejectedCount: options.rejectedCount ?? 0,
    truncated: options.truncated ?? false,
    providerLimited: options.providerLimited ?? false,
  });
const parser: DiscoveryCollectionParser = async (input) => {
  const body = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(input.bytes),
  );
  return {
    schemaVersion: DISCOVERY_COLLECTION_VERSION,
    representationFormat: 'json',
    requestSha256: input.requestSha256,
    representationSha256: input.representationSha256,
    parser: input.parser,
    leads: body.leads,
    terminal: body.terminal,
    nextCheckpoint: body.nextCheckpoint,
    rejectedCount: body.rejectedCount,
    truncated: body.truncated,
    providerLimited: body.providerLimited,
  };
};

// Each scenario gets fresh actual local D1 so round eligibility cannot include
// another scenario's sources. No production config or native provider egress.
test(
  'WP07 independent durable collection acceptance',
  { timeout: 600_000 },
  async (t) => {
    const cases: Record<string, unknown> = {};
    const inputPaths = [
      'test/discovery-collection.test.ts',
      'test/fixtures/discovery-d1/wrangler.jsonc',
      'src/ingest/discovery/collection-contract.ts',
      'src/ingest/discovery/collection-store.ts',
      'src/ingest/discovery/collector.ts',
      'src/ingest/discovery/runtime-contract.ts',
      'src/ingest/discovery/source-registry.ts',
      'src/ingest/discovery/transport.ts',
      'src/ingest/discovery/adapter.ts',
      'src/ingest/discovery-evidence-store.ts',
      'src/content/discovery-evidence.ts',
      'src/content/discovery-schema.ts',
      'migrations/0042_discovery_evidence.sql',
      'migrations/0043_discovery_registry.sql',
      'migrations/0044_discovery_collection.sql',
      'package-lock.json',
    ];
    const hashes = () =>
      Object.fromEntries(
        inputPaths.map((path) => [
          path,
          sha(readFileSync(new URL(`../${path}`, import.meta.url))),
        ]),
      );
    const before = hashes(),
      runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
    const reportDir = new URL(
      `../.discovery-work/wp07-tests-sol/runs/${runId}/`,
      import.meta.url,
    );
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      new URL('inputs-before.json', reportDir),
      JSON.stringify(before, null, 2) + '\n',
    );
    t.after(() => {
      const after = hashes();
      writeFileSync(
        new URL('inputs-after.json', reportDir),
        JSON.stringify(after, null, 2) + '\n',
      );
      writeFileSync(
        new URL('local-d1-results.json', reportDir),
        JSON.stringify(
          {
            runtime: process.version,
            synthetic: true,
            database: 'isolated-local-D1',
            inputsBefore: before,
            inputsAfter: after,
            inputsUnchanged: JSON.stringify(before) === JSON.stringify(after),
            tapIsAuthoritative: true,
            cases,
          },
          null,
          2,
        ) + '\n',
      );
    });
    async function fixture(sub: TestContext) {
      const proxy = await getPlatformProxy<{
        DISCOVERY_TEST_DB: D1DatabaseLike;
      }>({
        configPath: fileURLToPath(
          new URL('./fixtures/discovery-d1/wrangler.jsonc', import.meta.url),
        ),
        envFiles: [],
        persist: false,
        remoteBindings: false,
      });
      sub.after(() => proxy.dispose());
      const db = proxy.env.DISCOVERY_TEST_DB,
        migrations = new URL('../migrations/', import.meta.url);
      const names = readdirSync(migrations)
        .filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < '0045')
        .sort();
      assert.equal(names.length, 44);
      for (const name of names)
        await db.batch(
          unstable_splitSqlQuery(
            readFileSync(new URL(name, migrations), 'utf8'),
          ).map((sql) => db.prepare(sql)),
        );
      let current = BASE;
      const now = () => current;
      const registry = createDiscoverySourceRegistry(db, {
        resolveCapability: authority,
        now,
      });
      const evidence = createDiscoveryEvidenceStore(db, {
        resolveCapability: authority,
        now,
      });
      const dump = async () => {
        const tables = (
          await db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'discovery_%' ORDER BY name",
            )
            .all<{ name: string }>()
        ).results!;
        const output: Record<string, unknown> = {};
        for (const { name } of tables)
          output[name] = (
            (await db.prepare(`SELECT * FROM ${name}`).all()).results ?? []
          ).sort((a, b) =>
            canonicalDiscoveryEvidenceJson(a).localeCompare(
              canonicalDiscoveryEvidenceJson(b),
            ),
          );
        return output;
      };
      async function source(
        tag: string,
        options: {
          maxRequests?: number;
          maxRetainedBytes?: number;
          maxResponseBytes?: number;
          maxItems?: number;
          maxWallTimeMs?: number;
          requiresAuth?: boolean;
        } = {},
      ) {
        const ids = {
          enrollment: `enrollment:${tag}`,
          configuration: `configuration:${tag}`,
          parser: `parser:${tag}`,
          normalizer: `normalizer:${tag}`,
          permission: `permission:${tag}`,
          rights: `rights:${tag}`,
          policy: `policy:${tag}`,
          access: `access:${tag}`,
          display: `display:${tag}`,
        };
        for (const [kind, id, value] of [
          ['enrollment', ids.enrollment, 'active'],
          ['configuration', ids.configuration, 'synthetic-v1'],
          ['parser', ids.parser, 'text-or-json-v1'],
          ['normalizer', ids.normalizer, 'utf8-nfc-lf-v1'],
          ['policy', ids.policy, 'retention-policy'],
          ['policy', ids.access, 'source-access-authorized'],
          ['policy', ids.display, 'source-display-unassessed'],
        ] as const)
          await evidence.appendControl(evidenceContext(`seed:${id}`), {
            id,
            revision: 1,
            kind,
            value,
          });
        const template: DiscoveryEndpointTemplate = {
          id: `endpoint:${tag}`,
          origin: `https://${tag}.institutional.synthetic.invalid`,
          path: '/people',
          fixed: {},
          parameters: {
            q: { kind: 'text', maxLength: 200 },
            cursor: { kind: 'token', maxLength: 512 },
          },
          required: ['q'],
          pageParameter: 'cursor',
        };
        const scope = {
          kind: 'source-response' as const,
          sourceId: `source:${tag}`,
          installation: `installation:${tag}`,
          scopeId: `scope:${tag}`,
          enrollment: ref(ids.enrollment),
          configuration: ref(ids.configuration),
          endpointConstructor: template.id,
          endpointTemplateSha256:
            await discoveryEndpointTemplateDigest(template),
          requestScopeSha256: await requestScopeDigest({
            scopeId: `scope:${tag}`,
            parameters: { q: 'synthetic' },
            windowStart: '2020-01-01T00:00:00Z',
            windowEnd: EXPIRY,
          }),
          material: 'metadata' as const,
        };
        await evidence.appendControl(
          evidenceContext(`seed:${ids.permission}`),
          {
            id: ids.permission,
            revision: 1,
            kind: 'permission',
            value: 'allow',
            permission: {
              enrollment: scope.enrollment,
              configuration: scope.configuration,
              materialScope: scope,
              fetch: true,
              retain: true,
              transform: true,
            },
          },
        );
        await evidence.appendControl(evidenceContext(`seed:${ids.rights}`), {
          id: ids.rights,
          revision: 1,
          kind: 'rights',
          value: 'allow',
          rights: { materialScope: scope, retain: true, transform: true },
        });
        const value = DiscoveryRuntimeSource.parse({
          id: scope.sourceId,
          revision: 1,
          provider: 'institutional',
          installation: scope.installation,
          scopeId: scope.scopeId,
          enrollment: scope.enrollment,
          configuration: scope.configuration,
          permission: ref(ids.permission),
          rights: ref(ids.rights),
          parser: ref(ids.parser),
          normalizer: ref(ids.normalizer),
          materialScope: scope,
          endpointTemplate: template,
          requiresAuth: options.requiresAuth ?? false,
          ...(options.requiresAuth
            ? { credentialRef: `credential:${tag}` }
            : {}),
          engineeringOwnerId: 'synthetic:engineering',
          editorialOwnerId: 'synthetic:editorial',
          maintenanceOwnerId: 'synthetic:maintenance',
          credentialOwnerId: 'synthetic:credential-owner',
          accessDecision: ref(ids.access),
          displayRights: ref(ids.display),
          costs: {
            qualificationHours: 1,
            maintenanceHoursPerMonth: 1,
            accessChargeBasis:
              'Synthetic local fixture; actual provider costs unknown',
          },
          budget: {
            id: `budget:${tag}`,
            windowStart: '2020-01-01T00:00:00Z',
            windowEnd: EXPIRY,
            maxRequests: options.maxRequests ?? 30,
            maxRetainedBytes: options.maxRetainedBytes ?? 200000,
            maxPages: 30,
            maxItems: options.maxItems ?? 1000,
            maxResponseBytes: options.maxResponseBytes ?? 4096,
            maxWallTimeMs: options.maxWallTimeMs ?? 30000,
          },
          expiresAt: EXPIRY,
        });
        await registry.enroll(context(`enroll:${tag}`), value);
        const grant = {
          id: `sample:${tag}`,
          sourceId: value.id,
          sourceRevision: 1,
          maxRequests: 1,
          expiresAt: EXPIRY,
        };
        await registry.authorizeSampling(context(`sample:${tag}`), grant);
        const lease = await registry.acquireLease(
          context(`sample-lease:${tag}`),
          {
            id: `lease:${tag}`,
            sourceId: value.id,
            owner: 'synthetic:qualification-worker',
            expectedFence: 0,
            expiresAt: at(current, 30000),
          },
        );
        const plan = await registry.issue(context(`sample-issue:${tag}`), {
          id: `plan:${tag}:sample`,
          sourceId: value.id,
          sourceRevision: 1,
          runId: `run:${tag}:sample`,
          purpose: 'qualification-sample',
          samplingGrantId: grant.id,
          parameters: { q: 'synthetic', cursor: '*' },
          checkpoint: null,
          lease: { id: lease.id, owner: lease.owner, fence: lease.fence },
          deadlineAt: at(current, options.maxWallTimeMs ?? 30000),
        });
        const acquired = await registry
          .createTransport({
            credentialResolver: async (_reference, context) => ({
              origin: context.origin,
              headers: {
                Authorization: 'Bearer synthetic-qualification-credential',
              },
              expiresAt: EXPIRY,
            }),
            clock: () => Date.parse(current),
            egress: {
              send: async () =>
                new Response(
                  JSON.stringify({
                    provider: 'institutional',
                    records: [
                      {
                        creatorId: 'sample-creator',
                        creatorKind: 'person',
                        displayName: 'Synthetic qualification sample',
                      },
                    ],
                    nextCheckpoint: null,
                    terminal: true,
                  }),
                ),
            },
          })
          .acquire(plan.id);
        assert.equal(acquired.ok, true);
        if (!acquired.ok) throw new Error(JSON.stringify(acquired));
        const store = registry.createEvidenceStore({
          resolveCapability: authority,
        });
        await store.appendIssuedSourceRequest(
          evidenceContext(`sample-issued:${tag}`),
          {
            id: plan.id,
            revision: 1,
            requestSha256: plan.requestSha256,
            materialScope: scope,
            actualEndpoint: plan.endpoint,
            originMemberId: plan.originMemberId,
            permission: value.permission,
            rights: value.rights,
            expiresAt: plan.retainedThrough,
            requestBindingToken: plan.requestBindingToken,
          },
        );
        const origin = {
          id: `origin:${tag}:sample`,
          revision: 1,
          status: 'provisional-source-response' as const,
          originalWorkId: null,
          materialScope: scope,
          issuedRequest: ref(plan.id),
          requestSha256: plan.requestSha256,
          members: [plan.originMemberId],
          memberEndpoints: { [plan.originMemberId]: plan.endpoint },
          retentionRights: [value.rights],
          policy: ref(ids.policy),
          reason: 'Synthetic qualification sample',
          requestBindingToken: plan.requestBindingToken,
        };
        await store.appendOrigin(
          evidenceContext(`sample-origin:${tag}`),
          origin,
        );
        const representation = {
          id: `representation:${tag}:sample`,
          revision: 1,
          enrollment: value.enrollment,
          configuration: value.configuration,
          permission: value.permission,
          rights: value.rights,
          origin: ref(origin.id),
          originMemberId: plan.originMemberId,
          parser: value.parser,
          normalizer: value.normalizer,
          materialScope: scope,
          issuedRequest: ref(plan.id),
          requestSha256: plan.requestSha256,
          actualEndpoint: plan.endpoint,
          capturedAt: current,
          byteKind: 'captured-body-bytes' as const,
          format: 'json' as const,
          bytes: acquired.acquisition.bytes,
          requestBindingToken: plan.requestBindingToken,
        };
        await store.appendRepresentation(
          evidenceContext(`sample-capture:${tag}`),
          representation,
        );
        const qualificationId = `qualification:${tag}`;
        await registry.qualify(context(`qualify:${tag}`), {
          id: qualificationId,
          sourceId: value.id,
          sourceRevision: 1,
          installation: value.installation,
          configurationSha256: await sourceConfigurationDigest(value),
          parser: value.parser,
          permission: value.permission,
          rights: value.rights,
          accessDecision: value.accessDecision,
          displayRights: value.displayRights,
          engineeringOwnerId: value.engineeringOwnerId,
          editorialOwnerId: value.editorialOwnerId,
          reviewedAt: current,
          expiresAt: EXPIRY,
          samples: [
            {
              endpoint: plan.endpoint,
              representation: ref(representation.id),
              representationSha256: sha(acquired.acquisition.bytes),
            },
          ],
        });
        await registry.activate(context(`activate:${tag}`), {
          sourceId: value.id,
          sourceRevision: 1,
          qualificationId,
        });
        return {
          value,
          ids,
          scope,
          lease,
          qualificationId,
          parameters: { q: 'synthetic', cursor: '*' },
        };
      }
      const makeStore = (
        selectedDb: D1DatabaseLike = db,
        selectedParser: DiscoveryCollectionParser = parser,
      ) =>
        createDiscoveryCollectionStore(selectedDb, {
          resolveCapability: authority,
          resolveRegistryCapability: authority,
          resolveEvidenceCapability: authority,
          capabilityFor: async () => 'synthetic-runtime-capability',
          parser: selectedParser,
          now,
        });
      const makeCollector = (
        store: ReturnType<typeof makeStore>,
        options: Partial<Parameters<typeof createDiscoveryCollector>[0]> = {},
      ) =>
        createDiscoveryCollector({
          store,
          capabilityFor: async () => 'synthetic-collection-capability',
          clock: () => Date.parse(current),
          maxStepMs: 30000,
          cleanupMs: 1000,
          ...options,
        });
      const makeRound = (
        store: ReturnType<typeof makeStore>,
        id: string,
        cohortId: string,
        sources: Awaited<ReturnType<typeof source>>[],
        options: { maxPagesPerChain?: number; continuationTtlMs?: number } = {},
      ) =>
        store.createRound(context(`round:${id}`), {
          id,
          cohortId,
          sources: sources.map((s) => ({
            sourceId: s.value.id,
            parameters: s.parameters,
          })),
          maxPagesPerChain: options.maxPagesPerChain ?? 10,
          continuationTtlMs: options.continuationTtlMs ?? 60000,
        });
      const stepInput = (
        roundId: string,
        owner = 'worker:main',
        label = roundId,
        leaseMs = 60000,
        processingMs = 30000,
      ) => ({
        roundId,
        owner,
        claimOperationId: context(`claim:${label}`).operationId,
        expiresAt: at(current, leaseMs),
        processingDeadlineAt: at(current, processingMs),
      });
      return {
        db,
        registry,
        evidence,
        now,
        advance: (ms: number) => {
          current = at(current, ms);
        },
        setTime: (value: string) => {
          current = value;
        },
        source,
        dump,
        makeStore,
        makeCollector,
        makeRound,
        stepInput,
      };
    }

    async function acquiredPage(
      f: Awaited<ReturnType<typeof fixture>>,
      store: ReturnType<Awaited<ReturnType<typeof fixture>>['makeStore']>,
      roundId: string,
      label: string,
      body = pageBody(),
    ) {
      const input = f.stepInput(roundId, 'worker:manual', label);
      const result = await store.claimNext(
        {
          operationId: input.claimOperationId,
          capabilityToken: 'synthetic-collection-capability',
        },
        {
          roundId,
          owner: input.owner,
          expiresAt: input.expiresAt,
          processingDeadlineAt: input.processingDeadlineAt,
        },
      );
      assert.equal(result.kind, 'claimed', JSON.stringify(result));
      if (result.kind !== 'claimed') throw new Error(JSON.stringify(result));
      const plan = await store.issueForClaim(context(`issue:${label}`), {
        claimId: result.claim.id,
        planId: `plan:${label}`,
        deadlineAt: result.claim.processingDeadlineAt,
      });
      const acquired = await store
        .createTransport({
          clock: () => Date.parse(f.now()),
          egress: { send: async () => new Response(body) },
        })
        .acquire(plan.id);
      assert.equal(acquired.ok, true);
      if (!acquired.ok) throw new Error(JSON.stringify(acquired));
      return {
        claim: result.claim,
        plan,
        acquisition: acquired.acquisition,
        input,
      };
    }
    async function enteredBeforeEnd(
      entered: Promise<void>,
      operation: Promise<unknown>,
    ) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          entered,
          operation.then((result) => {
            throw new Error(
              `operation ended before gate: ${JSON.stringify(result)}`,
            );
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('test stage gate timed out')),
              15000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    await t.test(
      'atomic private page commits raw bytes, private leads, checkpoint and slot exactly once',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('atomic');
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(store, 'round:atomic', 'cohort:atomic', [s]);
        let sends = 0;
        const collector = f.makeCollector(store, {
          transportOptions: {
            egress: {
              send: async () => {
                sends++;
                return new Response(pageBody());
              },
            },
          },
        });
        const input = f.stepInput('round:atomic');
        const result = await collector.step(input);
        assert.equal(result.kind, 'page', JSON.stringify(result));
        if (result.kind !== 'page') throw new Error(JSON.stringify(result));
        assert.equal(result.receipt.chainComplete, true);
        assert.equal(result.receipt.leadCount, 1);
        assert.equal(result.receipt.sourceId, s.value.id);
        assert.equal(
          result.receipt.schemaVersion,
          DISCOVERY_COLLECTION_VERSION,
        );
        assert.equal(
          DiscoverySourcePage.safeParse(result.receipt).success,
          false,
        );
        const row = await f.evidence.readRevision(
          'representation',
          result.receipt.representation.id,
          1,
        );
        assert.equal(row?.usable, true);
        assert.equal(
          (row?.content as any).originalBytesSha256,
          result.receipt.representationSha256,
        );
        const health = await store.readHealth(s.value.id);
        assert.equal(health?.lastGoodReceiptId, result.receipt.id);
        assert.ok(health?.lastAttemptedAt);
        assert.ok(health?.lastSuccessfulAt);
        assert.ok(health?.lastCompleteAt);
        assert.equal(health?.lastPublicRefreshAt, null);
        const round = await store.readRound('round:atomic');
        assert.equal(round.cursor, 1);
        assert.equal(round.status, 'complete');
        for (const table of [
          'discovery_catalog_entities',
          'discovery_catalog_evidence_refs',
          'discovery_catalog_decision_refs',
        ])
          assert.equal(
            (
              await f.db
                .prepare(`SELECT count(*) AS n FROM ${table}`)
                .first<{ n: number }>()
            )?.n,
            0,
          );
        assert.equal(
          (
            await f.db
              .prepare(
                "SELECT count(*) AS n FROM discovery_evidence_revisions WHERE kind IN('evidence','claim','decision')",
              )
              .first<{ n: number }>()
          )?.n,
          0,
        );
        const before = await f.dump(),
          budget = await f.registry.readBudget(s.value.budget.id);
        const replay = await f
          .makeCollector(f.makeStore(), {
            transportOptions: {
              egress: {
                send: async () => {
                  sends++;
                  throw new Error('replay must not fetch');
                },
              },
            },
          })
          .step(input);
        assert.equal(replay.kind, 'page', JSON.stringify(replay));
        if (replay.kind === 'page')
          assert.equal(replay.receipt.id, result.receipt.id);
        assert.equal(sends, 1);
        assert.deepEqual(
          await f.registry.readBudget(s.value.budget.id),
          budget,
        );
        assert.deepEqual(await f.dump(), before);
        cases.atomicPage = {
          receipt: result.receipt,
          health,
          round,
          sends,
          replayStable: true,
          noFabricatedCatalogOrEvidenceAuthority: true,
        };
      },
    );

    await t.test(
      'fixed round gives failed A then B/C slots and enrolls D only next round',
      async (sub) => {
        const f = await fixture(sub),
          a = await f.source('fair-a'),
          b = await f.source('fair-b'),
          c = await f.source('fair-c');
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(store, 'round:fair-1', 'cohort:fair', [c, a, b]);
        const sends: string[] = [];
        const collector = f.makeCollector(store, {
          transportOptions: {
            egress: {
              send: async (url) => {
                const host = new URL(url).hostname;
                sends.push(host);
                return host.startsWith('fair-a.')
                  ? new Response(null, { status: 500 })
                  : new Response(pageBody());
              },
            },
          },
        });
        const first = await collector.step(
          f.stepInput('round:fair-1', 'worker:fair', 'a'),
        );
        assert.equal(first.kind, 'failure', JSON.stringify(first));
        if (first.kind !== 'failure') throw new Error(JSON.stringify(first));
        assert.equal(first.ack.sourceId, a.value.id);
        const d = await f.source('fair-d');
        const order = [first.ack.sourceId];
        for (const label of ['b', 'c']) {
          const result = await collector.step(
            f.stepInput('round:fair-1', 'worker:fair', label),
          );
          assert.equal(result.kind, 'page', JSON.stringify(result));
          if (result.kind === 'page') order.push(result.receipt.sourceId);
        }
        assert.deepEqual(order, [a.value.id, b.value.id, c.value.id]);
        assert.equal(
          sends.some((h) => h.startsWith('fair-d.')),
          false,
        );
        assert.equal((await store.readRound('round:fair-1')).size, 3);
        f.advance(86400001);
        await f.makeRound(store, 'round:fair-2', 'cohort:fair', [d, c, b, a]);
        const secondOrder: string[] = [];
        for (let slot = 0; slot < 4; slot++) {
          const result = await collector.step(
            f.stepInput('round:fair-2', 'worker:fair', `slot-${slot}`),
          );
          assert.ok(
            'ack' in result || 'receipt' in result,
            JSON.stringify(result),
          );
          secondOrder.push(
            'receipt' in result
              ? result.receipt.sourceId
              : 'ack' in result
                ? result.ack.sourceId
                : 'unresolved',
          );
        }
        assert.deepEqual(secondOrder, [
          a.value.id,
          b.value.id,
          c.value.id,
          d.value.id,
        ]);
        assert.equal(sends.filter((h) => h.startsWith('fair-a.')).length, 2);
        assert.equal(sends.filter((h) => h.startsWith('fair-d.')).length, 1);
        assert.equal((await store.readRound('round:fair-2')).cursor, 4);
        assert.equal(
          (
            await f.db
              .prepare(
                'SELECT outcome FROM discovery_collection_health WHERE source_id=?',
              )
              .bind(b.value.id)
              .first<{ outcome: string }>()
          )?.outcome,
          'healthy',
        );
        cases.fairness = {
          order,
          secondOrder,
          sends,
          conditional:
            'finite frozen cohort plus continued dispatch gives slots, not upstream delivery',
        };
      },
    );

    await t.test(
      'empty, missing-terminal, rejected, truncated and provider-limited pages never complete inventory',
      async (sub) => {
        const reports: unknown[] = [];
        for (const [label, body] of [
          [
            'empty-nonterminal',
            pageBody({
              leads: [],
              terminal: false,
              nextCheckpoint: 'after_empty',
            }),
          ],
          [
            'missing-terminal',
            pageBody({ terminal: false, nextCheckpoint: null }),
          ],
          ['rejected', pageBody({ rejectedCount: 1 })],
          ['truncated', pageBody({ truncated: true })],
          ['provider-limited', pageBody({ providerLimited: true })],
        ] as const) {
          await sub.test(label, async (inner) => {
            const f = await fixture(inner),
              s = await f.source(`incomplete-${label}`);
            f.advance(31000);
            const store = f.makeStore();
            await f.makeRound(store, `round:${label}`, `cohort:${label}`, [s]);
            const result = await f
              .makeCollector(store, {
                transportOptions: {
                  egress: { send: async () => new Response(body) },
                },
              })
              .step(f.stepInput(`round:${label}`));
            assert.equal(result.kind, 'page', JSON.stringify(result));
            if (result.kind !== 'page') throw new Error(JSON.stringify(result));
            assert.equal(result.receipt.chainComplete, false);
            assert.equal(
              (await store.readHealth(s.value.id))?.lastCompleteAt,
              null,
            );
            assert.equal((await store.readRound(`round:${label}`)).cursor, 1);
            reports.push({ label, receipt: result.receipt });
          });
        }
        cases.incompletePages = reports;
      },
    );

    await t.test(
      'empty terminal page has a durable receipt while empty cohort claims no inventory success',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('empty-terminal');
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(
          store,
          'round:empty-terminal',
          'cohort:empty-terminal',
          [s],
        );
        const result = await f
          .makeCollector(store, {
            transportOptions: {
              egress: {
                send: async () => new Response(pageBody({ leads: [] })),
              },
            },
          })
          .step(f.stepInput('round:empty-terminal'));
        assert.equal(result.kind, 'page', JSON.stringify(result));
        if (result.kind !== 'page') throw new Error(JSON.stringify(result));
        assert.equal(result.receipt.leadCount, 0);
        assert.equal(result.receipt.chainComplete, true);
        assert.ok(await store.resolvePage(result.receipt.id));
        const before = await store.readHealth(s.value.id);
        await f.makeRound(store, 'round:no-sources', 'cohort:no-sources', []);
        const empty = await f
          .makeCollector(store)
          .step(f.stepInput('round:no-sources'));
        assert.equal(empty.kind, 'complete');
        assert.deepEqual(await store.readHealth(s.value.id), before);
        assert.equal((await store.readRound('round:no-sources')).size, 0);
        cases.emptyTerminal = {
          receipt: result.receipt,
          emptyCohortHasNoNewSourceSuccess: true,
        };
      },
    );

    await t.test(
      'contiguous pages complete; loop and expired continuation require explicit new cohort',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('chain');
        f.advance(31000);
        const store = f.makeStore();
        let page = 0;
        const collector = f.makeCollector(store, {
          transportOptions: {
            egress: {
              send: async () =>
                new Response(
                  pageBody({
                    terminal: false,
                    nextCheckpoint: ++page === 1 ? 'loop_value' : 'loop_value',
                  }),
                ),
            },
          },
        });
        await f.makeRound(store, 'round:chain-1', 'cohort:chain', [s], {
          continuationTtlMs: 60000,
        });
        const first = await collector.step(f.stepInput('round:chain-1'));
        assert.equal(first.kind, 'page', JSON.stringify(first));
        if (first.kind !== 'page') throw new Error(JSON.stringify(first));
        assert.equal(first.receipt.chainComplete, false);
        await f.makeRound(store, 'round:chain-2', 'cohort:chain', [s], {
          continuationTtlMs: 60000,
        });
        const loop = await collector.step(f.stepInput('round:chain-2'));
        assert.equal(loop.kind, 'page', JSON.stringify(loop));
        if (loop.kind !== 'page') throw new Error(JSON.stringify(loop));
        assert.equal(loop.receipt.chainComplete, false);
        assert.equal(
          (await store.readHealth(s.value.id))?.lastCompleteAt,
          null,
        );
        const e = await f.source('expiry-chain');
        f.advance(31000);
        await f.makeRound(store, 'round:expiry-1', 'cohort:expiry', [e], {
          continuationTtlMs: 10,
        });
        let sends = 0;
        const expiryCollector = f.makeCollector(store, {
          transportOptions: {
            egress: {
              send: async () => {
                sends++;
                return new Response(
                  pageBody({ terminal: false, nextCheckpoint: 'later' }),
                );
              },
            },
          },
        });
        const prior = await expiryCollector.step(f.stepInput('round:expiry-1'));
        assert.equal(prior.kind, 'page', JSON.stringify(prior));
        f.advance(11);
        await f.makeRound(store, 'round:expiry-2', 'cohort:expiry', [e], {
          continuationTtlMs: 10,
        });
        const expired = await expiryCollector.step(
          f.stepInput('round:expiry-2'),
        );
        assert.equal(expired.kind, 'skipped', JSON.stringify(expired));
        assert.equal(sends, 1);
        assert.equal(
          (await store.readHealth(e.value.id))?.lastCompleteAt,
          null,
        );
        await f.makeRound(store, 'round:expiry-new', 'cohort:expiry-new', [e], {
          continuationTtlMs: 10,
        });
        const fresh = await f
          .makeCollector(store, {
            transportOptions: {
              egress: {
                send: async () => {
                  sends++;
                  return new Response(pageBody());
                },
              },
            },
          })
          .step(f.stepInput('round:expiry-new'));
        assert.equal(fresh.kind, 'page', JSON.stringify(fresh));
        if (fresh.kind === 'page')
          assert.equal(fresh.receipt.chainComplete, true);
        assert.equal(sends, 2);
        cases.chains = {
          first: first.receipt,
          loop: loop.receipt,
          expired,
          fresh,
          newCohortRequired: true,
        };
      },
    );

    await t.test(
      'AC01: committed raw/page/checkpoint survives lost acknowledgment and factory restart',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('crash-ack');
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(store, 'round:crash', 'cohort:crash', [s]);
        const a = await acquiredPage(f, store, 'round:crash', 'crash-ack'),
          prepared = await store.preparePage(a.claim.id, a.acquisition),
          ctx = context('commit:lost-ack');
        const receipt = await store.commitPage(ctx, {
          prepared,
          requestBindingToken: a.plan.requestBindingToken,
        }); // Simulate the caller losing this acknowledgment.
        const before = await f.dump(),
          budget = await f.registry.readBudget(s.value.budget.id),
          restarted = f.makeStore();
        assert.deepEqual(await restarted.commitPage(ctx, {}), receipt);
        assert.deepEqual(
          await restarted.resolveOperation(ctx.operationId),
          receipt,
        );
        assert.deepEqual(await f.dump(), before);
        assert.deepEqual(
          await f.registry.readBudget(s.value.budget.id),
          budget,
        );
        assert.equal((await restarted.readRound('round:crash')).cursor, 1);
        assert.equal(
          (
            await f.db
              .prepare('SELECT count(*) AS n FROM discovery_collection_pages')
              .first<{ n: number }>()
          )?.n,
          1,
        );
        assert.equal(
          (
            await f.db
              .prepare('SELECT count(*) AS n FROM discovery_collection_leads')
              .first<{ n: number }>()
          )?.n,
          1,
        );
        cases.crashReplay = {
          receipt,
          durableReplayStable: true,
          budget,
          noAdditionalFetch: true,
        };
      },
    );

    await t.test(
      'opaque handles reject forgery, cloning and cross-store use; snapshots isolate parser mutations',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('handles');
        f.advance(31000);
        let parserInput: any, parserOutput: any;
        const store = f.makeStore(f.db, async (input) => {
          parserInput = input;
          parserOutput = await parser(input);
          return parserOutput;
        });
        await f.makeRound(store, 'round:handles', 'cohort:handles', [s]);
        const a = await acquiredPage(f, store, 'round:handles', 'handles');
        const altered = structuredClone(a.acquisition);
        altered.bytes[0] ^= 1;
        const beforeBad = await f.dump();
        await assert.rejects(store.preparePage(a.claim.id, altered));
        assert.deepEqual(await f.dump(), beforeBad);
        const prepared = await store.preparePage(a.claim.id, a.acquisition),
          before = await f.dump();
        for (const [label, selected, handle] of [
          ['forged', store, {}],
          ['cloned', store, structuredClone(prepared)],
          ['cross-store', f.makeStore(), prepared],
        ] as const) {
          await assert.rejects(
            selected.commitPage(context(`bad-handle:${label}`), {
              prepared: handle as DiscoveryPreparedCollectionPage,
              requestBindingToken: a.plan.requestBindingToken,
            }),
          );
          assert.deepEqual(await f.dump(), before);
        }
        const originalHash = sha(a.acquisition.bytes);
        a.acquisition.bytes.fill(120);
        parserInput.bytes.fill(121);
        parserInput.request.sourceId = 'source:altered';
        parserOutput.leads[0].displayName = 'mutation-must-not-persist';
        const receipt = await store.commitPage(context('handle:valid'), {
          prepared,
          requestBindingToken: a.plan.requestBindingToken,
        });
        assert.equal(receipt.representationSha256, originalHash);
        const rows = (
          await f.db
            .prepare('SELECT payload_json FROM discovery_collection_leads')
            .all<{ payload_json: string }>()
        ).results!;
        assert.equal(rows.length, 1);
        assert.equal(
          JSON.stringify(rows).includes('mutation-must-not-persist'),
          false,
        );
        cases.handles = {
          receipt,
          forgedCloneCrossStoreDenied: true,
          detachedSnapshots: true,
        };
      },
    );

    await t.test(
      'AC03: expired lease during parse permits no stale success and recovery advances once',
      async (sub) => {
        const f = await fixture(sub),
          a = await f.source('parse-a'),
          b = await f.source('parse-b');
        f.advance(31000);
        let enter!: () => void, release!: () => void;
        const entered = new Promise<void>((r) => {
            enter = r;
          }),
          gate = new Promise<void>((r) => {
            release = r;
          });
        sub.after(() => release());
        const store = f.makeStore(f.db, async (input) => {
          enter();
          await gate;
          return parser(input);
        });
        await f.makeRound(store, 'round:parse', 'cohort:parse', [a, b]);
        const old = f
          .makeCollector(store, {
            transportOptions: {
              egress: { send: async () => new Response(pageBody()) },
            },
          })
          .step(f.stepInput('round:parse', 'worker:old', 'parse'));
        await enteredBeforeEnd(entered, old);
        f.advance(60001);
        const recovered = await f
          .makeStore()
          .claimNext(context('recover:parse'), {
            roundId: 'round:parse',
            owner: 'worker:new',
            expiresAt: at(f.now(), 60000),
            processingDeadlineAt: at(f.now(), 30000),
          });
        assert.equal(recovered.kind, 'skipped', JSON.stringify(recovered));
        release();
        const stale = await old;
        assert.notEqual(stale.kind, 'page');
        assert.equal(
          (
            await f.db
              .prepare('SELECT count(*) AS n FROM discovery_collection_pages')
              .first<{ n: number }>()
          )?.n,
          0,
        );
        assert.equal(
          (
            await f.db
              .prepare('SELECT count(*) AS n FROM discovery_collection_leads')
              .first<{ n: number }>()
          )?.n,
          0,
        );
        assert.equal(
          (await store.readHealth(a.value.id))?.lastSuccessfulAt,
          null,
        );
        assert.equal((await store.readRound('round:parse')).cursor, 1);
        const next = await f
          .makeCollector(f.makeStore(), {
            transportOptions: {
              egress: { send: async () => new Response(pageBody()) },
            },
          })
          .step(f.stepInput('round:parse', 'worker:new', 'next'));
        assert.equal(next.kind, 'page', JSON.stringify(next));
        if (next.kind === 'page')
          assert.equal(next.receipt.sourceId, b.value.id);
        cases.parseTakeover = { recovered, stale, next, noStaleSuccess: true };
      },
    );

    await t.test(
      'takeover and stop fence an old owner before actual transport admission',
      async (sub) => {
        const reports: unknown[] = [];
        for (const mode of ['takeover', 'stop'] as const)
          await sub.test(mode, async (inner) => {
            const f = await fixture(inner),
              s = await f.source(`pre-${mode}`);
            f.advance(31000);
            const store = f.makeStore(),
              roundId = `round:pre-${mode}`;
            await f.makeRound(store, roundId, `cohort:pre-${mode}`, [s]);
            let enter!: () => void,
              release!: () => void,
              sends = 0;
            const entered = new Promise<void>((r) => {
                enter = r;
              }),
              gate = new Promise<void>((r) => {
                release = r;
              });
            inner.after(() => release());
            const real = store.createTransport({
              clock: () => Date.parse(f.now()),
              egress: {
                send: async () => {
                  sends++;
                  return new Response(pageBody());
                },
              },
            });
            const pending = f
              .makeCollector(store, {
                transport: {
                  acquire: async (id) => {
                    enter();
                    await gate;
                    return real.acquire(id);
                  },
                },
              })
              .step(f.stepInput(roundId, 'worker:old', mode));
            await enteredBeforeEnd(entered, pending);
            if (mode === 'takeover') {
              f.advance(60001);
              const recovery = await f
                .makeStore()
                .claimNext(context('recover:admission'), {
                  roundId,
                  owner: 'worker:new',
                  expiresAt: at(f.now(), 60000),
                  processingDeadlineAt: at(f.now(), 30000),
                });
              assert.equal(recovery.kind, 'skipped', JSON.stringify(recovery));
            } else
              await store.stopRound(context('stop:admission'), {
                roundId,
                reasonCode: 'operator-stop',
              });
            release();
            const result = await pending;
            assert.notEqual(result.kind, 'page');
            assert.equal(sends, 0);
            assert.equal(
              (await f.registry.readBudget(s.value.budget.id)).requests,
              1,
            );
            assert.equal(
              (
                await f.db
                  .prepare(
                    'SELECT count(*) AS n FROM discovery_collection_pages',
                  )
                  .first<{ n: number }>()
              )?.n,
              0,
            );
            reports.push({ mode, result, sends, sourceLeaseFenced: true });
          });
        cases.preAdmission = reports;
      },
    );
    await t.test(
      'AC05: uncertain dispatch and competing workers never refund or exceed cumulative budgets',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('uncertain', {
            maxRequests: 2,
            maxRetainedBytes: 10000,
          });
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(store, 'round:uncertain', 'cohort:uncertain', [s]);
        let sends = 0,
          enter!: () => void;
        const entered = new Promise<void>((r) => {
          enter = r;
        });
        const stream = new ReadableStream<Uint8Array>(
          { pull() {}, cancel() {} },
          { highWaterMark: 0 },
        );
        const pending = f
          .makeCollector(store, {
            maxStepMs: 1500,
            transportOptions: {
              egress: {
                send: async () => {
                  sends++;
                  enter();
                  return new Response(stream);
                },
              },
            },
          })
          .step(
            f.stepInput(
              'round:uncertain',
              'worker:one',
              'uncertain',
              60000,
              1000,
            ),
          );
        await enteredBeforeEnd(entered, pending);
        const competitor = await f
          .makeCollector(f.makeStore(), {
            transportOptions: {
              egress: {
                send: async () => {
                  sends++;
                  return new Response(pageBody());
                },
              },
            },
          })
          .step(f.stepInput('round:uncertain', 'worker:two', 'competitor'));
        assert.ok(
          ['busy', 'complete', 'uncertain'].includes(competitor.kind),
          JSON.stringify(competitor),
        );
        const result = await pending;
        assert.notEqual(result.kind, 'page');
        assert.equal(sends, 1);
        const budget = await f.registry.readBudget(s.value.budget.id);
        assert.equal(budget.requests, 2);
        assert.ok(budget.reservedBytes > 0);
        assert.ok(
          budget.reservedBytes + budget.retainedBytes <=
            s.value.budget.maxRetainedBytes,
        );
        f.advance(60001);
        const recreated = f.makeStore();
        const recovery = await recreated.claimNext(
          context('recover:uncertain'),
          {
            roundId: 'round:uncertain',
            owner: 'worker:new',
            expiresAt: at(f.now(), 60000),
            processingDeadlineAt: at(f.now(), 30000),
          },
        );
        assert.ok(
          ['skipped', 'complete'].includes(recovery.kind),
          JSON.stringify(recovery),
        );
        await f.makeRound(
          recreated,
          'round:uncertain-next',
          'cohort:uncertain',
          [s],
        );
        const retry = await f
          .makeCollector(recreated, {
            transportOptions: {
              egress: {
                send: async () => {
                  sends++;
                  return new Response(pageBody());
                },
              },
            },
          })
          .step(f.stepInput('round:uncertain-next', 'worker:new', 'retry'));
        assert.notEqual(retry.kind, 'page');
        assert.equal(sends, 1);
        assert.deepEqual(
          await f.registry.readBudget(s.value.budget.id),
          budget,
        );
        cases.uncertainty = {
          result,
          competitor,
          recovery,
          retry,
          budget,
          sends,
        };
      },
    );

    await t.test(
      'two actual D1 admissions race the final allowance and operation replay never gets a free fetch',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('reservation-race', {
            maxRequests: 2,
            maxRetainedBytes: 10000,
          });
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(
          store,
          'round:reservation-race',
          'cohort:reservation-race',
          [s],
        );
        const input = f.stepInput('round:reservation-race');
        const result = await store.claimNext(
          {
            operationId: input.claimOperationId,
            capabilityToken: 'synthetic-collection-capability',
          },
          {
            roundId: input.roundId,
            owner: input.owner,
            expiresAt: input.expiresAt,
            processingDeadlineAt: input.processingDeadlineAt,
          },
        );
        assert.equal(result.kind, 'claimed', JSON.stringify(result));
        if (result.kind !== 'claimed') throw new Error(JSON.stringify(result));
        const plan = await store.issueForClaim(
          context('issue:reservation-race'),
          {
            claimId: result.claim.id,
            planId: 'plan:reservation-race',
            deadlineAt: result.claim.processingDeadlineAt,
          },
        );
        let sends = 0;
        const transport = () =>
          f.makeStore().createTransport({
            clock: () => Date.parse(f.now()),
            egress: {
              send: async () => {
                sends++;
                return new Response(pageBody());
              },
            },
          });
        const races = await Promise.all([
          transport().acquire(plan.id),
          transport().acquire(plan.id),
        ]);
        assert.equal(
          races.filter((r) => r.ok).length,
          1,
          JSON.stringify(races),
        );
        assert.equal(sends, 1);
        const budget = await f.registry.readBudget(s.value.budget.id);
        assert.equal(budget.requests, 2);
        assert.ok(budget.reservedBytes > 0);
        assert.ok(
          budget.reservedBytes + budget.retainedBytes <=
            s.value.budget.maxRetainedBytes,
        );
        const replay = await transport().acquire(plan.id);
        assert.equal(replay.ok, false);
        assert.equal(sends, 1);
        assert.deepEqual(
          await f.registry.readBudget(s.value.budget.id),
          budget,
        );
        assert.equal(
          (
            await f.db
              .prepare('SELECT count(*) AS n FROM discovery_collection_pages')
              .first<{ n: number }>()
          )?.n,
          0,
        );
        cases.reservationRace = {
          races: races.map((r) =>
            r.ok
              ? { ok: true, attemptId: r.acquisition.attemptId }
              : { ok: false, failure: r.failure },
          ),
          budget,
          sends,
          replayChargedAndDenied: true,
        };
      },
    );

    await t.test(
      'AC06: disabled frozen slot records the actual source gap and preserves last-good evidence',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('disable');
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(store, 'round:disable-first', 'cohort:disable', [s]);
        let sends = 0;
        const collector = f.makeCollector(store, {
          transportOptions: {
            egress: {
              send: async () => {
                sends++;
                return new Response(
                  pageBody({ terminal: false, nextCheckpoint: 'next_disable' }),
                );
              },
            },
          },
        });
        const first = await collector.step(f.stepInput('round:disable-first'));
        assert.equal(first.kind, 'page', JSON.stringify(first));
        if (first.kind !== 'page') throw new Error(JSON.stringify(first));
        const health = await store.readHealth(s.value.id),
          lastGood = await f.evidence.readRevision(
            'representation',
            first.receipt.representation.id,
            1,
          );
        await f.makeRound(store, 'round:disable-next', 'cohort:disable', [s]);
        const head = await f.db
          .prepare(
            'SELECT generation FROM discovery_source_heads WHERE source_id=?',
          )
          .bind(s.value.id)
          .first<{ generation: number }>();
        assert.ok(head);
        await f.registry.deactivate(context('disable:during-run'), {
          sourceId: s.value.id,
          expectedGeneration: head.generation,
          reasonCode: 'operator-disabled',
        });
        const result = await collector.step(f.stepInput('round:disable-next'));
        assert.equal(result.kind, 'failure', JSON.stringify(result));
        if (result.kind === 'failure') {
          assert.equal(result.ack.sourceId, s.value.id);
          assert.equal(result.ack.outcome, 'disabled');
        }
        assert.equal(sends, 1);
        assert.deepEqual(
          await f.evidence.readRevision(
            'representation',
            first.receipt.representation.id,
            1,
          ),
          lastGood,
        );
        const after = await store.readHealth(s.value.id);
        assert.equal(after?.lastGoodReceiptId, health?.lastGoodReceiptId);
        assert.equal(after?.lastSuccessfulAt, health?.lastSuccessfulAt);
        assert.equal(after?.lastCompleteAt, null);
        assert.equal(after?.lastPublicRefreshAt, null);
        assert.equal(
          await f.db
            .prepare(
              "SELECT source_id FROM discovery_collection_health WHERE source_id='source:unresolved'",
            )
            .first(),
          null,
        );
        cases.disable = {
          receipt: first.receipt,
          result,
          healthBefore: health,
          healthAfter: after,
          lastGoodPreserved: true,
        };
      },
    );

    await t.test(
      'scope removal erases copied prose, token and checkpoint data and blocks page replay',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('remove');
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(store, 'round:remove', 'cohort:remove', [s]);
        const title = 'wp07-source-prose-canary-726491',
          token = 'wp07-private-token-624718';
        const a = await acquiredPage(
            f,
            store,
            'round:remove',
            'remove',
            pageBody({
              leads: [lead('private-native', title)],
              terminal: false,
              nextCheckpoint: token,
            }),
          ),
          handle = await store.preparePage(a.claim.id, a.acquisition),
          ctx = context('commit:remove');
        const receipt = await store.commitPage(ctx, {
          prepared: handle,
          requestBindingToken: a.plan.requestBindingToken,
        });
        assert.equal(JSON.stringify(await f.dump()).includes(title), true);
        await f.makeRound(store, 'round:remove-pending', 'cohort:remove', [s]);
        await f.evidence.revokeRetention(evidenceContext('revoke:collection'), {
          id: 'revoke:collection-remove',
          revision: 1,
          rights: s.value.rights,
          policy: ref(s.ids.policy),
          reason: 'Reviewed synthetic scope withdrawal',
        });
        const after = await f.dump(),
          flat = JSON.stringify(after);
        assert.equal(flat.includes(title), false);
        assert.equal(flat.includes(token), false);
        assert.equal(
          flat.includes(JSON.stringify(Array.from(a.acquisition.bytes))),
          false,
        );
        assert.equal(await store.resolvePage(receipt.id), null);
        await assert.rejects(f.makeStore().commitPage(ctx, {}));
        assert.deepEqual(await f.dump(), after);
        let revokedSends = 0;
        const revokedSlot = await f
          .makeCollector(store, {
            transportOptions: {
              egress: {
                send: async () => {
                  revokedSends++;
                  return new Response(pageBody());
                },
              },
            },
          })
          .step(f.stepInput('round:remove-pending'));
        assert.equal(revokedSlot.kind, 'skipped', JSON.stringify(revokedSlot));
        if (revokedSlot.kind === 'skipped')
          assert.equal(revokedSlot.ack.sourceId, s.value.id);
        assert.equal(revokedSends, 0);
        assert.equal(await store.resolvePage(receipt.id), null);
        assert.equal(
          (await store.readHealth(s.value.id))?.lastGoodReceiptId,
          null,
        );
        cases.removal = {
          receiptId: receipt.id,
          forbiddenCopiesAbsent: true,
          replayDidNotRestore: true,
        };
      },
    );

    await t.test(
      'release/tag/commit dates preserve one native repository candidate and distinct observation stages',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('stages');
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(store, 'round:stages', 'cohort:stages', [s]);
        const dates = [
          makeDiscoveryDate('year', '2021'),
          makeDiscoveryDate('month', '2022-03'),
          makeDiscoveryDate('unknown', null),
        ];
        const observations = (['release', 'tag', 'commit'] as const).map(
          (stage, index) =>
            lead('repo-42', 'Synthetic repository', {
              kind: 'artifact',
              artifactKind: 'repository',
              sourceStage: stage,
              sourceVersion: `version-${index}`,
              sourceDates: [{ field: 'published', date: dates[index] }],
            }),
        );
        const result = await f
          .makeCollector(store, {
            transportOptions: {
              egress: {
                send: async () =>
                  new Response(pageBody({ leads: observations })),
              },
            },
          })
          .step(f.stepInput('round:stages'));
        assert.equal(result.kind, 'page', JSON.stringify(result));
        if (result.kind !== 'page') throw new Error(JSON.stringify(result));
        assert.equal(result.receipt.leadCount, 3);
        const rows = (
          await f.db
            .prepare(
              'SELECT payload_json FROM discovery_collection_leads ORDER BY ordinal',
            )
            .all<{ payload_json: string }>()
        ).results!.map((r) => JSON.parse(r.payload_json));
        assert.equal(new Set(rows.map((r) => r.candidateKey)).size, 1);
        assert.ok(rows[0].candidateKey);
        assert.deepEqual(
          rows.map((r) => r.sourceDates),
          observations.map((r) => r.sourceDates),
        );
        assert.deepEqual(
          rows.map((r) => r.sourceStage),
          ['release', 'tag', 'commit'],
        );
        assert.equal(
          (
            await f.db
              .prepare('SELECT count(*) AS n FROM discovery_catalog_entities')
              .first<{ n: number }>()
          )?.n,
          0,
        );
        cases.stageDates = {
          candidateKeys: rows.map((r) => r.candidateKey),
          dates: rows.map((r) => r.sourceDates),
          noIngestionDateSubstitution: true,
        };
      },
    );

    await t.test(
      'trusted text/XML format retains exact non-JSON bytes and JSON duplicate keys remain denied',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('text-format');
        f.advance(31000);
        const raw = '<feed>\r\n<entry>Synthetic XML creator</entry>\r\n</feed>';
        const textParser: DiscoveryCollectionParser = async (input) => ({
          schemaVersion: DISCOVERY_COLLECTION_VERSION,
          representationFormat: 'text',
          requestSha256: input.requestSha256,
          representationSha256: input.representationSha256,
          parser: input.parser,
          leads: [lead('xml-one')],
          terminal: true,
          nextCheckpoint: null,
          rejectedCount: 0,
          truncated: false,
          providerLimited: false,
        });
        const store = f.makeStore(f.db, textParser);
        await f.makeRound(store, 'round:text', 'cohort:text', [s]);
        const result = await f
          .makeCollector(store, {
            transportOptions: {
              egress: { send: async () => new Response(raw) },
            },
          })
          .step(f.stepInput('round:text'));
        assert.equal(result.kind, 'page', JSON.stringify(result));
        if (result.kind !== 'page') throw new Error(JSON.stringify(result));
        const kept = await f.evidence.readRevision(
          'representation',
          result.receipt.representation.id,
          1,
        );
        assert.equal((kept?.content as any).format, 'text');
        assert.equal((kept?.content as any).originalBytesSha256, sha(raw));
        assert.deepEqual((kept?.content as any).bytes, Array.from(bytes(raw)));
        const g = await fixture(sub),
          j = await g.source('json-duplicate');
        g.advance(31000);
        const jsonStore = g.makeStore();
        await g.makeRound(jsonStore, 'round:duplicate', 'cohort:duplicate', [
          j,
        ]);
        const duplicate = pageBody().replace(
          '"terminal":true',
          '"terminal":true,"duplicate":1,"duplicate":2',
        );
        const rejected = await g
          .makeCollector(jsonStore, {
            transportOptions: {
              egress: { send: async () => new Response(duplicate) },
            },
          })
          .step(g.stepInput('round:duplicate'));
        assert.notEqual(rejected.kind, 'page');
        assert.equal(
          (
            await g.db
              .prepare('SELECT count(*) AS n FROM discovery_collection_pages')
              .first<{ n: number }>()
          )?.n,
          0,
        );
        assert.equal(
          (await jsonStore.readHealth(j.value.id))?.lastSuccessfulAt,
          null,
        );
        cases.formats = {
          textReceipt: result.receipt,
          jsonDuplicateDenied: true,
        };
      },
    );
    await t.test(
      'actual D1 rolls back raw/page/checkpoint/health and budget on stale control or final statement failure',
      async (sub) => {
        const reports: unknown[] = [];
        for (const mode of ['control', 'final'] as const)
          await sub.test(mode, async (inner) => {
            const f = await fixture(inner),
              s = await f.source(`rollback-${mode}`);
            f.advance(31000);
            const store = f.makeStore();
            const roundId = `round:rollback-${mode}`;
            await f.makeRound(store, roundId, `cohort:rollback-${mode}`, [s]);
            const a = await acquiredPage(f, store, roundId, `rollback-${mode}`);
            await f.db
              .prepare(
                'CREATE TABLE discovery_fixture_prefix(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1))',
              )
              .run();
            const mapping = new WeakMap<
              object,
              { actual: D1StatementLike; query: string }
            >();
            const wrap = (
              actual: D1StatementLike,
              query: string,
            ): D1StatementLike => {
              const value: D1StatementLike = {
                bind: (...values) => wrap(actual.bind(...values), query),
                first: <T>() => actual.first<T>(),
                all: <T>() => actual.all<T>(),
                run: () => actual.run(),
              };
              mapping.set(value, { actual, query });
              return value;
            };
            let injected = false,
              baseline: Record<string, unknown> | undefined;
            const failing: D1DatabaseLike = {
              prepare: (query) => wrap(f.db.prepare(query), query),
              batch: async (statements) => {
                const actual = statements.map(
                  (v) => mapping.get(v)?.actual ?? v,
                );
                if (
                  !injected &&
                  statements.some((v) =>
                    mapping
                      .get(v)
                      ?.query.includes(
                        'INSERT INTO discovery_collection_pages',
                      ),
                  )
                ) {
                  injected = true;
                  if (mode === 'control')
                    await f.evidence.appendControl(
                      evidenceContext('late:configuration', 1),
                      {
                        id: s.ids.configuration,
                        revision: 2,
                        kind: 'configuration',
                        value: 'replacement-configuration',
                      },
                    );
                  baseline = await f.dump();
                  actual.unshift(
                    f.db.prepare(
                      "INSERT INTO discovery_fixture_prefix VALUES('would-leak',1)",
                    ),
                  );
                  if (mode === 'final')
                    actual.push(
                      f.db.prepare(
                        "INSERT INTO discovery_fixture_prefix VALUES('force-failure',0)",
                      ),
                    );
                }
                return f.db.batch(actual);
              },
            };
            const raced = f.makeStore(failing),
              handle = await raced.preparePage(a.claim.id, a.acquisition);
            await assert.rejects(
              raced.commitPage(context(`commit:rollback-${mode}`), {
                prepared: handle,
                requestBindingToken: a.plan.requestBindingToken,
              }),
            );
            assert.equal(injected, true);
            assert.deepEqual(await f.dump(), baseline);
            assert.equal(
              (
                await f.db
                  .prepare(
                    'SELECT count(*) AS n FROM discovery_collection_pages',
                  )
                  .first<{ n: number }>()
              )?.n,
              0,
            );
            assert.equal(
              (await store.readHealth(s.value.id))?.lastSuccessfulAt,
              null,
            );
            assert.equal((await store.readRound(roundId)).cursor, 0);
            reports.push({ mode, wholeActualBatchRolledBack: true });
          });
        cases.rollback = reports;
      },
    );

    await t.test(
      'strict server token broker binds every collection action to round, operation and domain',
      async (sub) => {
        const f = await fixture(sub),
          a = await f.source('scope-a'),
          b = await f.source('scope-b'),
          c = await f.source('scope-c');
        f.advance(31000);
        const roundId = 'round:strict-caps',
          tokens = new Map<
            string,
            {
              domain: string;
              action: string;
              targetId: string;
              operationId: string;
            }
          >(),
          scopes: {
            domain: string;
            action: string;
            targetId: string;
            operationId: string;
          }[] = [];
        let tokenNo = 0;
        const mint = async (request: {
          domain: string;
          action: string;
          targetId: string;
          operationId: string;
        }) => {
          if (request.domain === 'collection')
            assert.equal(request.targetId, roundId);
          assert.ok(request.operationId);
          const token = `synthetic-scoped-token-${++tokenNo}`;
          tokens.set(token, { ...request });
          scopes.push({ ...request });
          return token;
        };
        const resolver =
          (domain: string) => async (token: string, request: any) => {
            const binding = tokens.get(token);
            assert.ok(binding, 'unknown capability token');
            assert.equal(binding.domain, domain);
            assert.equal(binding.action, request.action);
            assert.equal(binding.targetId, request.targetId);
            assert.equal(binding.operationId, request.operationId);
            return authority(token, request);
          };
        const store = createDiscoveryCollectionStore(f.db, {
          resolveCapability: resolver('collection'),
          resolveRegistryCapability: resolver('registry'),
          resolveEvidenceCapability: resolver('evidence'),
          capabilityFor: mint,
          parser,
          now: f.now,
        });
        const roundCtx = context('strict:create');
        roundCtx.capabilityToken = await mint({
          domain: 'collection',
          action: 'create-round',
          targetId: roundId,
          operationId: roundCtx.operationId,
        });
        await store.createRound(roundCtx, {
          id: roundId,
          cohortId: 'cohort:strict-caps',
          sources: [a, b, c].map((s) => ({
            sourceId: s.value.id,
            parameters: s.parameters,
          })),
          maxPagesPerChain: 10,
          continuationTtlMs: 60000,
        });
        const collector = f.makeCollector(store, {
          capabilityFor: mint,
          transportOptions: {
            egress: {
              send: async (url) =>
                new URL(url).hostname.startsWith('scope-a.')
                  ? new Response(null, { status: 500 })
                  : new Response(pageBody()),
            },
          },
        });
        const failure = await collector.step(
          f.stepInput(roundId, 'worker:strict', 'first'),
        );
        assert.equal(failure.kind, 'failure', JSON.stringify(failure));
        const page = await collector.step(
          f.stepInput(roundId, 'worker:strict', 'second'),
        );
        assert.equal(page.kind, 'page', JSON.stringify(page));
        const stopCtx = context('strict:stop');
        stopCtx.capabilityToken = await mint({
          domain: 'collection',
          action: 'stop-round',
          targetId: roundId,
          operationId: stopCtx.operationId,
        });
        await store.stopRound(stopCtx, {
          roundId,
          reasonCode: 'operator-stop',
        });
        const stopped = await collector.step(
          f.stepInput(roundId, 'worker:strict', 'after-stop'),
        );
        assert.equal(stopped.kind, 'stopped', JSON.stringify(stopped));
        const collection = scopes.filter((s) => s.domain === 'collection');
        for (const action of [
          'create-round',
          'claim-slot',
          'issue-page',
          'finish-slot',
          'commit-page',
          'stop-round',
        ])
          assert.ok(collection.some((s) => s.action === action));
        assert.ok(collection.every((s) => s.targetId === roundId));
        const stages = collection.filter((s) => s.action !== 'create-round');
        for (const op of new Set(stages.map((s) => s.operationId)))
          assert.equal(
            new Set(
              stages.filter((s) => s.operationId === op).map((s) => s.action),
            ).size,
            1,
          );
        cases.strictCapabilities = {
          collectionScopes: collection,
          domainActionTargetAndOperationChecked: true,
        };
      },
    );

    await t.test(
      'repeated abandoned A slots advance to B/C without redispatch inside that slot',
      async (sub) => {
        const f = await fixture(sub),
          a = await f.source('abandon-a'),
          b = await f.source('abandon-b'),
          c = await f.source('abandon-c');
        f.advance(31000);
        const store = f.makeStore();
        const traces: unknown[] = [];
        for (let round = 1; round <= 2; round++) {
          const roundId = `round:abandon-${round}`;
          await f.makeRound(store, roundId, 'cohort:abandon', [a, b, c]);
          const claimed = await store.claimNext(context('abandon:claim'), {
            roundId,
            owner: 'worker:abandoned',
            expiresAt: at(f.now(), 1000),
            processingDeadlineAt: at(f.now(), 500),
          });
          assert.equal(claimed.kind, 'claimed', JSON.stringify(claimed));
          f.advance(1001);
          const recovered = await f
            .makeStore()
            .claimNext(context('abandon:recover'), {
              roundId,
              owner: 'worker:recovery',
              expiresAt: at(f.now(), 60000),
              processingDeadlineAt: at(f.now(), 30000),
            });
          assert.equal(recovered.kind, 'skipped', JSON.stringify(recovered));
          assert.equal((await store.readRound(roundId)).cursor, 1);
          const results = [];
          for (const label of ['b', 'c']) {
            const result = await f
              .makeCollector(store, {
                transportOptions: {
                  egress: { send: async () => new Response(pageBody()) },
                },
              })
              .step(f.stepInput(roundId, 'worker:recovery', label));
            results.push(result);
            assert.ok(
              'receipt' in result || 'ack' in result,
              JSON.stringify(result),
            );
          }
          const ids = results.map((r) =>
            'receipt' in r
              ? r.receipt.sourceId
              : 'ack' in r
                ? r.ack.sourceId
                : 'unknown',
          );
          assert.deepEqual(ids, [b.value.id, c.value.id]);
          assert.equal(
            (await f.registry.readBudget(a.value.budget.id)).requests,
            1,
          );
          traces.push({ roundId, recovered, ids });
        }
        cases.abandonedFairness = traces;
      },
    );

    await t.test(
      'outer collector cutoff denies late actual egress under a frozen clock',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('outer-cutoff');
        f.advance(31000);
        let entered = false,
          sends = 0;
        const mapping = new WeakMap<
          object,
          { actual: D1StatementLike; query: string }
        >();
        const wrap = (
          actual: D1StatementLike,
          query: string,
        ): D1StatementLike => {
          const value: D1StatementLike = {
            bind: (...values) => wrap(actual.bind(...values), query),
            first: <T>() => actual.first<T>(),
            all: <T>() => actual.all<T>(),
            run: () => actual.run(),
          };
          mapping.set(value, { actual, query });
          return value;
        };
        const slow: D1DatabaseLike = {
          prepare: (query) => wrap(f.db.prepare(query), query),
          batch: async (statements) => {
            const result = await f.db.batch(
              statements.map((v) => mapping.get(v)?.actual ?? v),
            );
            if (
              statements.some((v) =>
                mapping
                  .get(v)
                  ?.query.includes('INSERT INTO discovery_source_attempts'),
              )
            ) {
              entered = true;
              await new Promise((r) => setTimeout(r, 1800));
            }
            return result;
          },
        };
        const store = f.makeStore(slow);
        await f.makeRound(store, 'round:cutoff', 'cohort:cutoff', [s]);
        const result = await f
          .makeCollector(store, {
            maxStepMs: 3000,
            cleanupMs: 1000,
            capabilityFor: async (request) => {
              if (request.action === 'issue-page')
                await new Promise((r) => setTimeout(r, 1800));
              return 'synthetic-collection-capability';
            },
            transportOptions: {
              egress: {
                send: async () => {
                  sends++;
                  return new Response(pageBody());
                },
              },
            },
          })
          .step(
            f.stepInput(
              'round:cutoff',
              'worker:cutoff',
              'cutoff',
              60000,
              30000,
            ),
          );
        await new Promise((r) => setTimeout(r, 2200));
        assert.equal(entered, true);
        assert.notEqual(result.kind, 'page');
        assert.equal(sends, 0);
        assert.equal(
          (await store.readHealth(s.value.id))?.lastSuccessfulAt,
          null,
        );
        cases.outerCutoff = {
          result,
          sends,
          delayedReservationEntered: entered,
          clockFrozen: true,
        };
      },
    );
    await t.test(
      'stale source-busy skip cannot overwrite a newer claim after lease expiry',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('skip-cas');
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(store, 'round:busy-owner', 'cohort:busy-owner', [s]);
        await f.makeRound(store, 'round:busy-target', 'cohort:busy-target', [
          s,
        ]);
        const first = await store.claimNext(context('busy:owner'), {
          roundId: 'round:busy-owner',
          owner: 'worker:first',
          expiresAt: at(f.now(), 1000),
          processingDeadlineAt: at(f.now(), 500),
        });
        assert.equal(first.kind, 'claimed', JSON.stringify(first));
        const mapping = new WeakMap<
          object,
          { actual: D1StatementLike; query: string }
        >();
        const wrap = (
          actual: D1StatementLike,
          query: string,
        ): D1StatementLike => {
          const value: D1StatementLike = {
            bind: (...values) => wrap(actual.bind(...values), query),
            first: <T>() => actual.first<T>(),
            all: <T>() => actual.all<T>(),
            run: () => actual.run(),
          };
          mapping.set(value, { actual, query });
          return value;
        };
        let enter!: () => void,
          release!: () => void,
          delayed = false;
        const entered = new Promise<void>((r) => {
            enter = r;
          }),
          gate = new Promise<void>((r) => {
            release = r;
          });
        sub.after(() => release());
        const paused: D1DatabaseLike = {
          prepare: (query) => wrap(f.db.prepare(query), query),
          batch: async (statements) => {
            if (
              !delayed &&
              statements.some((v) =>
                mapping
                  .get(v)
                  ?.query.includes(
                    'INSERT INTO discovery_collection_slot_outcomes',
                  ),
              )
            ) {
              delayed = true;
              enter();
              await gate;
            }
            return f.db.batch(
              statements.map((v) => mapping.get(v)?.actual ?? v),
            );
          },
        };
        const staleStore = f.makeStore(paused);
        const old = staleStore.claimNext(context('busy:stale-skip'), {
          roundId: 'round:busy-target',
          owner: 'worker:stale',
          expiresAt: at(f.now(), 60000),
          processingDeadlineAt: at(f.now(), 30000),
        });
        old.catch(() => {});
        await enteredBeforeEnd(entered, old);
        f.advance(1001);
        const winner = await store.claimNext(context('busy:winner'), {
          roundId: 'round:busy-target',
          owner: 'worker:winner',
          expiresAt: at(f.now(), 60000),
          processingDeadlineAt: at(f.now(), 30000),
        });
        assert.equal(winner.kind, 'claimed', JSON.stringify(winner));
        release();
        await assert.rejects(old);
        assert.equal((await store.readRound('round:busy-target')).cursor, 0);
        const row = await f.db
          .prepare(
            'SELECT state,claim_id FROM discovery_collection_slots WHERE round_id=?',
          )
          .bind('round:busy-target')
          .first<{ state: string; claim_id: string }>();
        assert.equal(row?.state, 'claimed');
        if (winner.kind === 'claimed')
          assert.equal(row?.claim_id, winner.claim.id);
        cases.skipCas = { delayedSkipRejected: true, winner, slot: row };
      },
    );

    await t.test(
      'synchronous late parser cannot finalize after monotonic lease expiry with a frozen clock',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('sync-parser');
        f.advance(31000);
        let parserEntered = false,
          finishes = 0;
        const store = f.makeStore(f.db, async (input) => {
          parserEntered = true;
          const end = performance.now() + 5500;
          while (performance.now() < end) {}
          return parser(input);
        });
        await f.makeRound(store, 'round:sync-parser', 'cohort:sync-parser', [
          s,
        ]);
        const counted = {
          ...store,
          finishSlot: async (...args: Parameters<typeof store.finishSlot>) => {
            finishes++;
            return store.finishSlot(...args);
          },
        };
        const result = await f
          .makeCollector(counted, {
            maxStepMs: 10000,
            transportOptions: {
              egress: { send: async () => new Response(pageBody()) },
            },
          })
          .step(
            f.stepInput('round:sync-parser', 'worker:sync', 'sync', 5000, 5000),
          );
        assert.equal(parserEntered, true);
        assert.equal(result.kind, 'uncertain', JSON.stringify(result));
        assert.equal(finishes, 0);
        assert.equal((await store.readRound('round:sync-parser')).cursor, 0);
        assert.equal(
          (await store.readHealth(s.value.id))?.lastSuccessfulAt,
          null,
        );
        cases.syncParser = {
          result,
          finishes,
          clockFrozen: true,
          parserCPUWasNotPreempted: true,
        };
      },
    );

    await t.test(
      'source wall cap governs default-long collector under frozen clock and delayed credentials',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('short-source', {
            maxWallTimeMs: 5000,
            requiresAuth: true,
          });
        f.advance(31000);
        const store = f.makeStore();
        await f.makeRound(store, 'round:short-quick', 'cohort:short-quick', [
          s,
        ]);
        let sends = 0;
        const good = async () => ({
          origin: s.value.endpointTemplate.origin,
          headers: { Authorization: 'Bearer synthetic-short-credential' },
          expiresAt: EXPIRY,
        });
        const quick = await f
          .makeCollector(store, {
            maxStepMs: 300000,
            transportOptions: {
              credentialResolver: good,
              egress: {
                send: async () => {
                  sends++;
                  return new Response(pageBody());
                },
              },
            },
          })
          .step(
            f.stepInput(
              'round:short-quick',
              'worker:short',
              'quick',
              300000,
              300000,
            ),
          );
        assert.equal(quick.kind, 'page', JSON.stringify(quick));
        const before = await store.readHealth(s.value.id);
        await f.makeRound(store, 'round:short-late', 'cohort:short-late', [s]);
        const late = await f
          .makeCollector(store, {
            maxStepMs: 300000,
            transportOptions: {
              credentialResolver: async () => {
                await new Promise((r) => setTimeout(r, 5500));
                return good();
              },
              egress: {
                send: async () => {
                  sends++;
                  return new Response(pageBody());
                },
              },
            },
          })
          .step(
            f.stepInput(
              'round:short-late',
              'worker:short',
              'late',
              300000,
              300000,
            ),
          );
        await new Promise((r) => setTimeout(r, 1000));
        assert.notEqual(late.kind, 'page');
        assert.equal(sends, 1);
        assert.equal(
          (await store.readHealth(s.value.id))?.lastSuccessfulAt,
          before?.lastSuccessfulAt,
        );
        cases.sourceCap = {
          quick,
          late,
          sends,
          sourceWallTimeMs: 5000,
          collectorCapMs: 300000,
        };
      },
    );

    await t.test(
      'only a validated contiguous second terminal page completes the inventory chain',
      async (sub) => {
        const f = await fixture(sub),
          s = await f.source('contiguous');
        f.advance(31000);
        const store = f.makeStore();
        let sends = 0;
        const collector = f.makeCollector(store, {
          transportOptions: {
            egress: {
              send: async () =>
                new Response(
                  ++sends === 1
                    ? pageBody({ terminal: false, nextCheckpoint: 'page_two' })
                    : pageBody(),
                ),
            },
          },
        });
        await f.makeRound(store, 'round:contiguous-one', 'cohort:contiguous', [
          s,
        ]);
        const first = await collector.step(f.stepInput('round:contiguous-one'));
        assert.equal(first.kind, 'page', JSON.stringify(first));
        if (first.kind !== 'page') throw new Error(JSON.stringify(first));
        assert.equal(first.receipt.chainComplete, false);
        assert.equal(first.receipt.pageOrdinal, 1);
        await f.makeRound(store, 'round:contiguous-two', 'cohort:contiguous', [
          s,
        ]);
        const second = await collector.step(
          f.stepInput('round:contiguous-two'),
        );
        assert.equal(second.kind, 'page', JSON.stringify(second));
        if (second.kind !== 'page') throw new Error(JSON.stringify(second));
        assert.equal(second.receipt.chainId, first.receipt.chainId);
        assert.equal(second.receipt.pageOrdinal, 2);
        assert.equal(second.receipt.chainComplete, true);
        assert.equal(second.receipt.nextCheckpoint, null);
        assert.equal(sends, 2);
        assert.ok((await store.readHealth(s.value.id))?.lastCompleteAt);
        cases.contiguous = {
          first: first.receipt,
          second: second.receipt,
          sends,
        };
      },
    );

    assert.deepEqual(
      hashes(),
      before,
      'implementation/test inputs changed during this run',
    );
  },
);
