import { DiscoveryId } from '../src/content/discovery-schema';
import assert from 'node:assert/strict';
import test from 'node:test';
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
import {
  constructDiscoveryEndpoint,
  validateDiscoveryEndpoint,
  discoveryEndpointTemplateDigest,
} from '../src/ingest/discovery/endpoint';
import {
  SYNTHETIC_DISCOVERY_ADAPTERS,
  createSyntheticDiscoveryAdapters,
  type DiscoveryTrustedAdapterReceipt,
} from '../src/ingest/discovery/adapter';
import {
  DiscoveryRuntimeSource,
  DiscoveryRuntimeError,
  type DiscoveryIssuedPlan,
  type DiscoveryAcquisition,
  type DiscoveryCredentialResolver,
  type DiscoveryContinuationReceipt,
  type DiscoveryEndpointTemplate,
} from '../src/ingest/discovery/runtime-contract';
import type {
  D1DatabaseLike,
  D1StatementLike,
} from '../src/ingest/persistence';

const BASE = '2030-01-01T00:00:00.000Z';
const EXPIRY = '2090-01-01T00:00:00.000Z';
const ref = (id: string, revision = 1) => ({ id, revision });
const bytes = (text: string) => new TextEncoder().encode(text);
const sha = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const at = (instant: string, ms: number) =>
  new Date(Date.parse(instant) + ms).toISOString();
let serial = 0;
const registryContext = (label: string) => ({
  operationId: `test:${label}:${++serial}`,
  capabilityToken: 'synthetic-registry-capability',
});
const evidenceContext = (
  label: string,
  expectedRevision: number | null = null,
) => ({
  operationId: `test:${label}:${++serial}`,
  expectedRevision,
  capabilityToken: 'synthetic-evidence-capability',
});
const registryAuthority = async (_token: string, request: any) => ({
  receiptId: 'synthetic:registry-receipt',
  principalId: 'synthetic:reviewer',
  authenticationContextId: 'synthetic:auth',
  minimalAuditRetention: 'allow' as const,
  expiresAt: EXPIRY,
  ...request,
});
const evidenceAuthority = async (_token: string, request: any) => ({
  receiptId: 'synthetic:evidence-receipt',
  principalId: 'synthetic:reviewer',
  authenticationContextId: 'synthetic:auth',
  minimalAuditRetention: 'allow' as const,
  expiresAt: EXPIRY,
  ...request,
});
const syntheticRows = {
  github: {
    repositoryId: 1001,
    title: 'Synthetic repository',
    commitVersion: 'commit-abc',
    accountId: 'account-42',
  },
  pubmed: {
    pmid: '123456',
    title: 'Synthetic paper without repository',
    authorLabels: ['Unresolved Author'],
  },
  crossref: {
    doi: '10.5555/synthetic',
    title: 'Synthetic institution-authored paper',
    institutionalAuthor: 'Synthetic Institute',
    unresolvedPeople: ['Unresolved Person'],
  },
  arxiv: { baseId: '2601.00001', title: 'Synthetic preprint', version: 3 },
  forum: {
    threadId: 'thread-11',
    title: 'Synthetic discussion',
    accountId: 'opaque-account-7',
  },
  institutional: {
    creatorId: 'independent-1',
    creatorKind: 'person' as const,
    displayName: 'Independent synthetic creator',
  },
};
type Provider = keyof typeof syntheticRows;
const body = (provider: Provider, nextCheckpoint: string | null = null) =>
  JSON.stringify({
    provider,
    records: [syntheticRows[provider]],
    nextCheckpoint,
    terminal: nextCheckpoint === null,
  });

// Actual D1, no production-shaped config, secret files, remote binding or native
// provider calls. Closed fixture egress is the only acquisition dependency.
test(
  'WP06 independent source registry and transport acceptance',
  { timeout: 240_000 },
  async (t) => {
    const proxy = await getPlatformProxy<{ DISCOVERY_TEST_DB: D1DatabaseLike }>(
      {
        configPath: fileURLToPath(
          new URL('./fixtures/discovery-d1/wrangler.jsonc', import.meta.url),
        ),
        envFiles: [],
        persist: false,
        remoteBindings: false,
      },
    );
    t.after(() => proxy.dispose());
    const db = proxy.env.DISCOVERY_TEST_DB;
    const migrations = new URL('../migrations/', import.meta.url);
    const names = readdirSync(migrations)
      .filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < '0044')
      .sort();
    assert.equal(names.length, 43, 'all migrations 0001–0043 must be tested');
    for (const name of names)
      await db.batch(
        unstable_splitSqlQuery(
          readFileSync(new URL(name, migrations), 'utf8'),
        ).map((sql) => db.prepare(sql)),
      );
    let current = BASE;
    const now = () => current;
    await db
      .prepare(
        'CREATE TABLE discovery_fixture_receipts(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)))',
      )
      .run();
    const resolveContinuation = async (
      id: string,
    ): Promise<DiscoveryContinuationReceipt | null> => {
      const row = await db
        .prepare(
          'SELECT payload_json FROM discovery_fixture_receipts WHERE id=?',
        )
        .bind(id)
        .first<{ payload_json: string }>();
      return row ? (JSON.parse(row.payload_json).continuation ?? null) : null;
    };
    const registry = createDiscoverySourceRegistry(db, {
      resolveCapability: registryAuthority,
      now,
      resolveContinuation,
    });
    const evidence = createDiscoveryEvidenceStore(db, {
      resolveCapability: evidenceAuthority,
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
    const cases: Record<string, unknown> = {};
    const inputPaths = [
      'test/discovery-transport.test.ts',
      'test/fixtures/discovery-d1/wrangler.jsonc',
      'src/content/discovery-evidence.ts',
      'src/ingest/discovery-evidence-store.ts',
      'src/ingest/discovery/runtime-contract.ts',
      'src/ingest/discovery/source-registry.ts',
      'src/ingest/discovery/endpoint.ts',
      'src/ingest/discovery/transport.ts',
      'src/ingest/discovery/adapter.ts',
      'src/ingest/discovery/source-contract.ts',
      'migrations/0042_discovery_evidence.sql',
      'migrations/0043_discovery_registry.sql',
      'package-lock.json',
    ];
    const inputHashes = () =>
      Object.fromEntries(
        inputPaths.map((path) => [
          path,
          sha(readFileSync(new URL(`../${path}`, import.meta.url))),
        ]),
      );
    const inputsBefore = inputHashes();
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
    const reportDir = new URL(
      `../.discovery-work/wp06-tests-sol/runs/${runId}/`,
      import.meta.url,
    );
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      new URL('inputs-before.json', reportDir),
      JSON.stringify(inputsBefore, null, 2) + '\n',
    );
    t.after(() => {
      const inputsAfter = inputHashes();
      writeFileSync(
        new URL('inputs-after.json', reportDir),
        JSON.stringify(inputsAfter, null, 2) + '\n',
      );
      writeFileSync(
        new URL('local-d1-results.json', reportDir),
        JSON.stringify(
          {
            runtime: process.version,
            synthetic: true,
            database: 'isolated-local-D1',
            migrations: names,
            inputsBefore,
            inputsAfter,
            inputsUnchanged:
              JSON.stringify(inputsBefore) === JSON.stringify(inputsAfter),
            tapIsAuthoritative: true,
            cases,
          },
          null,
          2,
        ) + '\n',
      );
    });

    const credentials: DiscoveryCredentialResolver = async (
      _reference,
      context,
    ) => ({
      origin: context.origin,
      headers: { Authorization: 'Bearer synthetic-credential-canary' },
      expiresAt: EXPIRY,
    });
    async function setup(
      tag: string,
      options: {
        provider?: Provider;
        requiresAuth?: boolean;
        active?: boolean;
        maxRequests?: number;
        maxRetainedBytes?: number;
        maxResponseBytes?: number;
        maxWallTimeMs?: number;
        rightsExpiry?: string;
        maxItems?: number;
      } = {},
    ) {
      const provider = options.provider ?? 'github';
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
        origin: `https://${tag}.${provider}.synthetic.invalid`,
        path: '/search',
        fixed: {},
        parameters: {
          q: { kind: 'text', maxLength: 200 },
          page: { kind: 'integer', min: 1, max: 3 },
        },
        required: ['q'],
        pageParameter: 'page',
      };
      const scope = {
        kind: 'source-response' as const,
        sourceId: `source:${tag}`,
        installation: `installation:${tag}`,
        scopeId: `scope:${tag}`,
        enrollment: ref(ids.enrollment),
        configuration: ref(ids.configuration),
        endpointConstructor: template.id,
        endpointTemplateSha256: await discoveryEndpointTemplateDigest(template),
        requestScopeSha256: await requestScopeDigest({
          scopeId: `scope:${tag}`,
          parameters: { q: 'synthetic' },
          windowStart: '2020-01-01T00:00:00Z',
          windowEnd: EXPIRY,
        }),
        material: 'metadata' as const,
      };
      await evidence.appendControl(evidenceContext(`seed:${ids.permission}`), {
        id: ids.permission,
        revision: 1,
        kind: 'permission',
        value: 'allow',
        permission: {
          enrollment: ref(ids.enrollment),
          configuration: ref(ids.configuration),
          materialScope: scope,
          fetch: true,
          retain: true,
          transform: true,
        },
      });
      await evidence.appendControl(evidenceContext(`seed:${ids.rights}`), {
        id: ids.rights,
        revision: 1,
        kind: 'rights',
        value: 'allow',
        ...(options.rightsExpiry ? { expiresAt: options.rightsExpiry } : {}),
        rights: { materialScope: scope, retain: true, transform: true },
      });
      const source = DiscoveryRuntimeSource.parse({
        id: scope.sourceId,
        revision: 1,
        provider,
        installation: scope.installation,
        scopeId: scope.scopeId,
        enrollment: scope.enrollment,
        configuration: scope.configuration,
        parser: ref(ids.parser),
        normalizer: ref(ids.normalizer),
        permission: ref(ids.permission),
        rights: ref(ids.rights),
        materialScope: scope,
        endpointTemplate: template,
        requiresAuth: options.requiresAuth ?? false,
        ...(options.requiresAuth ? { credentialRef: `credential:${tag}` } : {}),
        engineeringOwnerId: 'synthetic:engineering',
        editorialOwnerId: 'synthetic:editorial',
        maintenanceOwnerId: 'synthetic:maintenance',
        credentialOwnerId: 'synthetic:credential-owner',
        accessDecision: ref(ids.access),
        displayRights: ref(ids.display),
        costs: {
          qualificationHours: 2,
          maintenanceHoursPerMonth: 1,
          accessChargeBasis: 'synthetic fixture; actual provider cost unknown',
        },
        budget: {
          id: `budget:${tag}`,
          windowStart: '2020-01-01T00:00:00Z',
          windowEnd: EXPIRY,
          maxRequests: options.maxRequests ?? 30,
          maxRetainedBytes: options.maxRetainedBytes ?? 100000,
          maxPages: 30,
          maxItems: options.maxItems ?? 1000,
          maxResponseBytes: options.maxResponseBytes ?? 4096,
          maxWallTimeMs: options.maxWallTimeMs ?? 30000,
        },
        expiresAt: EXPIRY,
      });
      await registry.enroll(registryContext(`enroll:${tag}`), source);
      const grant = {
        id: `sample:${tag}`,
        sourceId: source.id,
        sourceRevision: 1,
        maxRequests: Math.min(30, source.budget.maxRequests),
        expiresAt: EXPIRY,
      };
      await registry.authorizeSampling(registryContext(`sample:${tag}`), grant);
      const lease = await registry.acquireLease(
        registryContext(`lease:${tag}`),
        {
          id: `lease:${tag}`,
          sourceId: source.id,
          owner: 'synthetic:runner',
          expectedFence: 0,
          expiresAt: EXPIRY,
        },
      );
      const qualificationId = `qualification:${tag}`;
      const issuedTokens = new Map<string, string>();
      const issue = async (
        label: string,
        overrides: Record<string, unknown> = {},
      ) => {
        const input = {
          id: `plan:${tag}:${label}`,
          sourceId: source.id,
          sourceRevision: 1,
          runId: `run:${tag}`,
          purpose: 'qualification-sample',
          samplingGrantId: grant.id,
          parameters: { q: 'synthetic', page: '1' },
          checkpoint: null,
          lease: { id: lease.id, owner: lease.owner, fence: lease.fence },
          deadlineAt: at(current, source.budget.maxWallTimeMs),
          ...overrides,
        };
        for (const key of Object.keys(input))
          if ((input as any)[key] === undefined) delete (input as any)[key];
        const issued = await registry.issue(
          registryContext(`issue:${tag}:${label}`),
          input as any,
        );
        if (issued.requestBindingToken)
          issuedTokens.set(issued.id, issued.requestBindingToken);
        return issued;
      };
      const prepare = async (
        acquisition: DiscoveryAcquisition,
        label: string,
        store = registry.createEvidenceStore({
          resolveCapability: evidenceAuthority,
          now,
        }),
      ) => {
        const plan = acquisition.plan;
        const issued = {
          id: plan.id,
          revision: 1,
          requestSha256: plan.requestSha256,
          materialScope: plan.source.materialScope,
          actualEndpoint: acquisition.endpoint,
          originMemberId: plan.originMemberId,
          permission: plan.source.permission,
          rights: plan.source.rights,
          expiresAt: plan.retainedThrough,
          requestBindingToken:
            issuedTokens.get(plan.id) ?? plan.requestBindingToken,
        };
        await store.appendIssuedSourceRequest(
          evidenceContext(`issued:${label}`),
          issued,
        );
        const origin = {
          id: `origin:${label}`,
          revision: 1,
          status: 'provisional-source-response' as const,
          originalWorkId: null,
          materialScope: plan.source.materialScope,
          issuedRequest: ref(plan.id),
          requestSha256: plan.requestSha256,
          members: [issued.originMemberId],
          memberEndpoints: { [issued.originMemberId]: acquisition.endpoint },
          retentionRights: [plan.source.rights],
          policy: ref(ids.policy),
          reason: 'Synthetic source-response intake',
          requestBindingToken:
            issuedTokens.get(plan.id) ?? plan.requestBindingToken,
        };
        await store.appendOrigin(evidenceContext(`origin:${label}`), origin);
        const context = evidenceContext(`capture:${label}`);
        const representation = {
          id: `representation:${label}`,
          revision: 1,
          enrollment: plan.source.enrollment,
          configuration: plan.source.configuration,
          permission: plan.source.permission,
          rights: plan.source.rights,
          origin: ref(origin.id),
          originMemberId: issued.originMemberId,
          parser: plan.source.parser,
          normalizer: plan.source.normalizer,
          materialScope: plan.source.materialScope,
          issuedRequest: ref(plan.id),
          requestSha256: plan.requestSha256,
          actualEndpoint: acquisition.endpoint,
          capturedAt: current,
          byteKind: 'captured-body-bytes' as const,
          format: 'json' as const,
          bytes: acquisition.bytes,
          requestBindingToken:
            issuedTokens.get(plan.id) ?? plan.requestBindingToken,
        };
        return { context, representation };
      };
      const retain = async (
        acquisition: DiscoveryAcquisition,
        label: string,
        store = registry.createEvidenceStore({
          resolveCapability: evidenceAuthority,
          now,
        }),
      ) => {
        const prepared = await prepare(acquisition, label, store);
        const ack = await store.appendRepresentation(
          prepared.context,
          prepared.representation,
        );
        return { ...prepared, ack };
      };
      let sample: Awaited<ReturnType<typeof retain>> | undefined;
      if (options.active !== false) {
        const plan = await issue('qualification');
        const transport = registry.createTransport({
          credentialResolver: credentials,
          clock: () => Date.parse(current),
          egress: {
            send: async () => new Response(body(provider), { status: 200 }),
          },
        });
        const result = await transport.acquire(plan.id);
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error(JSON.stringify(result));
        const retained = await retain(result.acquisition, `sample:${tag}`);
        sample = retained;
        await registry.qualify(registryContext(`qualify:${tag}`), {
          id: qualificationId,
          sourceId: source.id,
          sourceRevision: 1,
          installation: source.installation,
          configurationSha256: await sourceConfigurationDigest(source),
          parser: source.parser,
          permission: source.permission,
          rights: source.rights,
          accessDecision: source.accessDecision,
          displayRights: source.displayRights,
          engineeringOwnerId: source.engineeringOwnerId,
          editorialOwnerId: source.editorialOwnerId,
          reviewedAt: current,
          expiresAt: options.rightsExpiry ?? EXPIRY,
          samples: [
            {
              endpoint: plan.endpoint,
              representation: ref(retained.representation.id),
              representationSha256: sha(result.acquisition.bytes),
            },
          ],
        });
        await registry.activate(registryContext(`activate:${tag}`), {
          sourceId: source.id,
          sourceRevision: 1,
          qualificationId,
        });
      }
      const collect = (
        label: string,
        overrides: Record<string, unknown> = {},
      ) =>
        issue(label, {
          purpose: 'collection',
          samplingGrantId: undefined,
          qualificationId,
          ...overrides,
        });
      return {
        source,
        ids,
        scope,
        template,
        lease,
        grant,
        qualificationId,
        issue,
        collect,
        retain,
        prepare,
        sample,
      };
    }

    async function persistFixtureReceipt(
      plan: DiscoveryIssuedPlan,
      retained: Awaited<
        ReturnType<Awaited<ReturnType<typeof setup>>['retain']>
      >,
      result?: unknown,
    ) {
      const decoded = JSON.parse(
        new TextDecoder().decode(retained.representation.bytes),
      );
      const next = decoded.nextCheckpoint as string | null;
      const id = `fixture-receipt:${retained.representation.id}`;
      const continuation =
        next === null
          ? null
          : {
              parentReceiptId: id,
              parentCaptureOperationId: retained.context.operationId,
              parentPlanId: plan.id,
              representation: ref(retained.representation.id),
              representationSha256: sha(retained.representation.bytes),
              sourceId: plan.source.id,
              installation: plan.source.installation,
              scopeId: plan.source.scopeId,
              sourceRevision: plan.source.revision,
              querySha256: plan.source.materialScope.requestScopeSha256,
              nextCheckpoint: next,
              tokenSha256: sha(next),
              expiresAt: EXPIRY,
            };
      await db
        .prepare('INSERT INTO discovery_fixture_receipts VALUES(?,?)')
        .bind(
          id,
          JSON.stringify({
            continuation,
            adapter: result
              ? {
                  receiptId: id,
                  request: plan.request,
                  result,
                  representation: ref(retained.representation.id),
                }
              : null,
          }),
        )
        .run();
      return {
        id,
        continuation: continuation
          ? {
              parentReceiptId: id,
              sourceId: continuation.sourceId,
              installation: continuation.installation,
              scopeId: continuation.scopeId,
              sourceRevision: continuation.sourceRevision,
              querySha256: continuation.querySha256,
              tokenSha256: continuation.tokenSha256,
              expiresAt: continuation.expiresAt,
            }
          : undefined,
      };
    }

    await t.test(
      'AC01: changed parser/configuration and exact rights expiry prevent activation and dispatch',
      async () => {
        const outcomes: unknown[] = [];
        for (const kind of ['parser', 'configuration'] as const) {
          const f = await setup(`ac01-${kind}`);
          const before = await registry.readBudget(f.source.budget.id);
          await evidence.appendControl(evidenceContext(`change:${kind}`, 1), {
            id: f.ids[kind],
            revision: 2,
            kind,
            value: kind === 'parser' ? 'text-or-json-v2' : 'synthetic-v2',
          });
          await assert.rejects(
            registry.activate(registryContext(`reject:${kind}`), {
              sourceId: f.source.id,
              sourceRevision: 1,
              qualificationId: f.qualificationId,
            }),
            (error) => {
              outcomes.push({ kind, error: String(error) });
              return error instanceof DiscoveryRuntimeError;
            },
          );
          await assert.rejects(f.collect(`stale-${kind}`));
          assert.deepEqual(
            await registry.readBudget(f.source.budget.id),
            before,
          );
        }
        const expiry = at(current, 1000),
          f = await setup('ac01-expiry', { rightsExpiry: expiry });
        const before = await registry.readBudget(f.source.budget.id);
        current = expiry;
        await assert.rejects(
          registry.activate(registryContext('reject:expiry'), {
            sourceId: f.source.id,
            sourceRevision: 1,
            qualificationId: f.qualificationId,
          }),
        );
        await assert.rejects(f.collect('expired'));
        assert.deepEqual(await registry.readBudget(f.source.budget.id), before);
        cases.AC01 = { outcomes, exactExpiry: expiry, additionalRequests: 0 };
      },
    );

    await t.test(
      'AC02: missing credentials/egress and dependency errors send no secret or unauthorized request',
      async () => {
        const f = await setup('ac02-credentials', { requiresAuth: true });
        let calls = 0;
        const egress = {
          send: async () => {
            calls++;
            return new Response(body('github'));
          },
        };
        const forbidden = 'dependency-error-private-canary-92847';
        const throws = () => {
          throw new DiscoveryRuntimeError(
            'upstream-failed',
            forbidden,
            forbidden,
          );
        };
        const getter = Object.defineProperty(
          { origin: f.template.origin, expiresAt: EXPIRY },
          'headers',
          { enumerable: true, get: throws },
        );
        const resolvers = [
          undefined,
          async () => null,
          async () => ({
            origin: 'https://wrong.synthetic.invalid',
            headers: { Authorization: 'private' },
            expiresAt: EXPIRY,
          }),
          async () => ({
            origin: f.template.origin,
            headers: { Authorization: 'private' },
            expiresAt: current,
          }),
          async () => throws(),
          async () => getter,
        ] as (DiscoveryCredentialResolver | undefined)[];
        const gaps: unknown[] = [];
        for (let i = 0; i < resolvers.length; i++) {
          const plan = await f.collect(`missing-${i}`),
            before = await registry.readBudget(f.source.budget.id);
          const result = await registry
            .createTransport({
              credentialResolver: resolvers[i],
              egress,
              clock: () => Date.parse(current),
            })
            .acquire(plan.id);
          assert.equal(result.ok, false);
          if (result.ok) throw new Error('unexpected credential success');
          assert.ok(
            ['misconfigured', 'auth-failed'].includes(result.failure.outcome),
          );
          assert.equal(result.failure.checkpointUnchanged, true);
          assert.equal(JSON.stringify(result).includes(forbidden), false);
          assert.equal(calls, 0);
          assert.deepEqual(
            await registry.readBudget(f.source.budget.id),
            before,
          );
          gaps.push(result.failure);
        }
        const plan = await f.collect('missing-egress');
        const noEgress = await registry
          .createTransport({
            credentialResolver: credentials,
            clock: () => Date.parse(current),
          })
          .acquire(plan.id);
        assert.equal(noEgress.ok, false);
        if (!noEgress.ok) {
          assert.equal(noEgress.failure.outcome, 'unavailable');
          assert.equal(noEgress.failure.sourceId, f.source.id);
          assert.equal(noEgress.failure.operationId, plan.request.operationId);
        }
        assert.equal(calls, 0);
        assert.equal(JSON.stringify(await dump()).includes(forbidden), false);
        cases.AC02 = { gaps, egressCalls: calls, missingEgress: noEgress };
      },
    );

    await t.test(
      'AC03: actual retained parent authorizes a second page; extra parameters and forged continuation do not fetch',
      async () => {
        const f = await setup('ac03-pages');
        const calls: string[] = [];
        const transport = registry.createTransport({
          clock: () => Date.parse(current),
          egress: {
            send: async (url) => {
              calls.push(url);
              return new Response(
                body('github', calls.length === 1 ? '2' : null),
              );
            },
          },
        });
        const first = await f.collect('page-one'),
          one = await transport.acquire(first.id);
        assert.equal(one.ok, true);
        if (!one.ok) throw new Error(JSON.stringify(one));
        const retained = await f.retain(one.acquisition, 'ac03-page-one');
        const fixtureReceipt = await persistFixtureReceipt(first, retained);
        const continuation = fixtureReceipt.continuation!;
        const unprovisioned = createDiscoverySourceRegistry(db, {
          resolveCapability: registryAuthority,
          now,
        });
        await assert.rejects(
          unprovisioned.issue(
            registryContext('missing:continuation-resolver'),
            {
              id: 'plan:missing-receipt-resolver',
              sourceId: f.source.id,
              sourceRevision: 1,
              runId: 'run:missing',
              purpose: 'collection',
              qualificationId: f.qualificationId,
              parameters: { q: 'synthetic', page: '2' },
              checkpoint: '2',
              continuation,
              lease: {
                id: f.lease.id,
                owner: f.lease.owner,
                fence: f.lease.fence,
              },
              deadlineAt: at(current, 30000),
            },
          ),
        );
        const second = await f.collect('page-two', {
          parameters: { q: 'synthetic', page: '2' },
          checkpoint: '2',
          continuation,
        });
        assert.equal(
          second.endpoint,
          `${f.template.origin}/search?page=2&q=synthetic`,
        );
        const two = await transport.acquire(second.id);
        assert.equal(two.ok, true);
        if (!two.ok) throw new Error(JSON.stringify(two));
        await f.retain(two.acquisition, 'ac03-page-two');
        const sent = calls.length;
        for (const [label, overrides] of [
          [
            'extra',
            {
              parameters: { q: 'synthetic', page: '2', arbitrary: 'exfil' },
              checkpoint: '2',
              continuation,
            },
          ],
          [
            'parent',
            {
              parameters: { q: 'synthetic', page: '2' },
              checkpoint: '2',
              continuation: {
                ...continuation,
                parentReceiptId: 'fabricated:receipt',
              },
            },
          ],
          [
            'query',
            {
              parameters: { q: 'different', page: '2' },
              checkpoint: '2',
              continuation,
            },
          ],
          [
            'url-token',
            {
              parameters: { q: 'synthetic', page: 'https://private.invalid/' },
              checkpoint: 'https://private.invalid/',
              continuation,
            },
          ],
        ] as const)
          await assert.rejects(f.collect(`bad-${label}`, overrides));
        await assert.rejects(
          constructDiscoveryEndpoint(f.template, [
            ['q', 'synthetic'],
            ['q', 'other'],
          ]),
        );
        await assert.rejects(
          validateDiscoveryEndpoint(
            f.template,
            `${second.endpoint}&q=other`,
            continuation,
            current,
          ),
        );
        assert.equal(calls.length, sent);
        assert.equal(sent, 2);
        cases.AC03 = {
          calls,
          firstReceipt: fixtureReceipt.id,
          unknownParameterAndBindingDenied: true,
        };
      },
    );

    await t.test(
      'endpoint grammar preserves valid Unicode and refuses lossy surrogate values',
      async () => {
        const template: DiscoveryEndpointTemplate = {
          id: 'endpoint:unicode',
          origin: 'https://unicode.synthetic.invalid',
          path: '/search',
          fixed: {},
          parameters: {
            q: { kind: 'text', maxLength: 20 },
            token: { kind: 'token', maxLength: 20 },
            mode: { kind: 'enum', values: ['valid'] },
          },
          required: ['q'],
        };
        const ok = await constructDiscoveryEndpoint(template, [
          ['q', 'paired 😀'],
        ]);
        assert.ok(ok.includes('%F0%9F%98%80'));
        for (const invalid of ['\ud800', '\udc00'].map(
          (s) => JSON.parse(`"${s}"`) as string,
        )) {
          await assert.rejects(
            constructDiscoveryEndpoint(template, [['q', invalid]]),
          );
          await assert.rejects(
            constructDiscoveryEndpoint(template, [
              ['q', 'valid'],
              ['token', invalid],
            ]),
          );
          await assert.rejects(
            constructDiscoveryEndpoint(
              { ...template, fixed: { fixed: invalid } },
              [['q', 'valid']],
            ),
          );
          await assert.rejects(
            constructDiscoveryEndpoint(
              {
                ...template,
                parameters: {
                  q: { kind: 'text', maxLength: 20 },
                  mode: { kind: 'enum', values: [invalid] },
                },
              },
              [
                ['q', 'valid'],
                ['mode', invalid],
              ],
            ),
          );
        }
        cases.unicode = {
          validPairPreserved: true,
          unpairedValuesDenied: true,
        };
      },
    );

    await t.test(
      'AC04: cross-origin/private redirects stop before another request or credential leak',
      async () => {
        const f = await setup('ac04-redirects', { requiresAuth: true });
        const outcomes: unknown[] = [];
        for (const [i, target] of [
          'https://other.synthetic.invalid/search',
          'https://127.0.0.1/search',
          'https://10.0.0.1/search',
          'https://localhost/search',
          'https://[::1]/search',
        ].entries()) {
          const plan = await f.collect(`redirect-${i}`),
            calls: { url: string; headers: Record<string, string> }[] = [];
          const result = await registry
            .createTransport({
              credentialResolver: credentials,
              clock: () => Date.parse(current),
              egress: {
                send: async (url, init) => {
                  calls.push({ url, headers: { ...init.headers } });
                  return new Response(null, {
                    status: 302,
                    headers: { location: target },
                  });
                },
              },
            })
            .acquire(plan.id);
          assert.equal(result.ok, false);
          assert.equal(calls.length, 1, JSON.stringify({ target, result }));
          assert.equal(calls[0].url, plan.endpoint);
          assert.equal(
            calls.some((c) => c.url === target),
            false,
          );
          outcomes.push({
            target,
            calls: calls.map((c) => ({
              url: c.url,
              credentialPresent: Boolean(c.headers.Authorization),
            })),
            result,
          });
          current = at(current, 86400001);
        }
        assert.equal(
          JSON.stringify(await dump()).includes('synthetic-credential-canary'),
          false,
        );
        cases.AC04 = outcomes;
      },
    );

    await t.test(
      'AC05: actual D1 races last request and byte allowance without partial debit',
      async () => {
        const races: unknown[] = [];
        for (const [tag, limits] of [
          [
            'requests',
            { maxRequests: 1, maxRetainedBytes: 1000, maxResponseBytes: 100 },
          ],
          [
            'bytes',
            { maxRequests: 3, maxRetainedBytes: 100, maxResponseBytes: 80 },
          ],
        ] as const) {
          const f = await setup(`ac05-${tag}`, { active: false, ...limits });
          const first = await f.issue('race-a'),
            second = await f.issue('race-b');
          const other = createDiscoverySourceRegistry(db, {
            resolveCapability: registryAuthority,
            now,
            resolveContinuation,
          });
          let sends = 0;
          const egress = {
            send: async () => {
              sends++;
              return new Response('{}');
            },
          };
          const results = await Promise.all([
            registry
              .createTransport({ egress, clock: () => Date.parse(current) })
              .acquire(first.id),
            other
              .createTransport({ egress, clock: () => Date.parse(current) })
              .acquire(second.id),
          ]);
          assert.equal(
            results.filter((r) => r.ok).length,
            1,
            JSON.stringify(results),
          );
          assert.equal(sends, 1);
          const rejected = results.find((r) => !r.ok);
          assert.ok(rejected && !rejected.ok);
          if (rejected && !rejected.ok)
            assert.equal(rejected.failure.outcome, 'budget-exhausted');
          const budget = await registry.readBudget(f.source.budget.id);
          assert.equal(budget.requests, 1);
          assert.equal(budget.reservedBytes, limits.maxResponseBytes);
          assert.ok(
            budget.reservedBytes + budget.retainedBytes <=
              limits.maxRetainedBytes,
          );
          assert.deepEqual(await other.readBudget(f.source.budget.id), budget);
          races.push({
            tag,
            budget,
            sends,
            outcomes: results.map((r) =>
              r.ok ? 'received' : r.failure.outcome,
            ),
          });
        }
        cases.AC05 = races;
      },
    );

    await t.test(
      'durable backoff survives recreation and replay never obtains free fetch',
      async () => {
        const f = await setup('backoff');
        let calls = 0;
        const first = await f.collect('rate-limit');
        const failed = await registry
          .createTransport({
            clock: () => Date.parse(current),
            egress: {
              send: async () => {
                calls++;
                return new Response(null, {
                  status: 429,
                  headers: { 'retry-after': '120' },
                });
              },
            },
          })
          .acquire(first.id);
        assert.equal(failed.ok, false);
        if (failed.ok) throw new Error('expected429');
        assert.equal(failed.failure.outcome, 'rate-limited');
        assert.equal(failed.failure.retryAfter, at(current, 120000));
        const recreated = createDiscoverySourceRegistry(db, {
            resolveCapability: registryAuthority,
            now,
            resolveContinuation,
          }),
          next = await f.collect('before-backoff');
        const transport = recreated.createTransport({
          clock: () => Date.parse(current),
          egress: {
            send: async () => {
              calls++;
              return new Response(body('github'));
            },
          },
        });
        const blocked = await transport.acquire(next.id);
        assert.equal(blocked.ok, false);
        if (!blocked.ok) assert.equal(blocked.failure.outcome, 'rate-limited');
        assert.equal(calls, 1);
        current = at(current, 120000);
        const retry = await f.collect('charged-retry');
        const result = await transport.acquire(retry.id);
        assert.equal(result.ok, true);
        assert.equal(calls, 2);
        const before = await recreated.readBudget(f.source.budget.id);
        assert.equal(before.requests, 3); // qualification,429,retry
        const replay = await transport.acquire(retry.id);
        assert.equal(calls, 2);
        assert.deepEqual(
          await recreated.readBudget(f.source.budget.id),
          before,
        );
        cases.backoff = {
          first: failed,
          blocked,
          replay,
          retryCalls: calls,
          budget: before,
        };
      },
    );

    await t.test(
      'deadline, oversize and dependency failures remain charged and redacted',
      async () => {
        const f = await setup('body');
        const observations: unknown[] = [];
        const forbidden = 'body-error-private-canary-58391';
        for (const scenario of [
          'egress-throw',
          'reader-throw',
          'oversize',
          'deadline',
        ] as const) {
          const deadlineAt = at(current, 30_000);
          const plan = await f.collect(scenario, { deadlineAt });
          let transportNow = Date.parse(current);
          let bodyRead = false;
          let cancelled = false,
            aborted = false,
            calls = 0;
          const result = await registry
            .createTransport({
              clock: () => transportNow,
              egress: {
                send: async (_url, init) => {
                  calls++;
                  // Spend the deadline budget only after real D1 admission. The
                  // body stays pending so the transport's timer must cancel it.
                  if (scenario === 'deadline')
                    transportNow = Date.parse(deadlineAt) - 50;
                  init.signal.addEventListener('abort', () => {
                    aborted = true;
                  });
                  if (scenario === 'egress-throw')
                    throw new DiscoveryRuntimeError(
                      'upstream-failed',
                      forbidden,
                      forbidden,
                    );
                  const stream = new ReadableStream<Uint8Array>(
                    {
                      pull(controller) {
                        bodyRead = true;
                        if (scenario === 'reader-throw')
                          throw new DiscoveryRuntimeError(
                            'upstream-failed',
                            forbidden,
                            forbidden,
                          );
                        if (scenario === 'oversize') {
                          controller.enqueue(
                            new Uint8Array(
                              f.source.budget.maxResponseBytes + 1,
                            ),
                          );
                        }
                      },
                      cancel() {
                        cancelled = true;
                      },
                    },
                    { highWaterMark: 0 },
                  );
                  return new Response(stream, { status: 200 });
                },
              },
            })
            .acquire(plan.id);
          assert.equal(result.ok, false);
          assert.equal(calls, 1, JSON.stringify({ scenario, result }));
          assert.equal(JSON.stringify(result).includes(forbidden), false);
          if (scenario === 'deadline') {
            assert.equal(bodyRead, true);
            if (!result.ok) assert.equal(result.failure.outcome, 'timed-out');
            assert.equal(aborted, true);
            assert.equal(cancelled, true);
          }
          if (scenario === 'oversize') assert.equal(cancelled, true);
          observations.push({ scenario, result, cancelled, aborted });
          current = at(current, 86400001);
        }
        assert.equal(JSON.stringify(await dump()).includes(forbidden), false);
        const budget = await registry.readBudget(f.source.budget.id);
        assert.equal(budget.requests, 5); // sample + 4 charged failures
        cases.streamFailures = { observations, budget };
      },
    );

    await t.test(
      'stream chunks are copied before a producer reuses a delivered buffer',
      async () => {
        const f = await setup('buffer-copy');
        const plan = await f.collect('buffer');
        const shared = bytes('first');
        let index = 0;
        const stream = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              if (index++ === 0) {
                controller.enqueue(shared);
                return;
              }
              await new Promise((r) => setTimeout(r, 5));
              shared.fill('x'.charCodeAt(0));
              controller.enqueue(bytes('second'));
              controller.close();
            },
          },
          { highWaterMark: 0 },
        );
        const result = await registry
          .createTransport({
            clock: () => Date.parse(current),
            egress: { send: async () => new Response(stream) },
          })
          .acquire(plan.id);
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error(JSON.stringify(result));
        assert.equal(
          new TextDecoder().decode(result.acquisition.bytes),
          'firstsecond',
        );
        const row = await db
          .prepare(
            'SELECT body_sha256 FROM discovery_source_attempts WHERE id=?',
          )
          .bind(result.acquisition.attemptId)
          .first<{ body_sha256: string }>();
        assert.equal(row?.body_sha256, sha('firstsecond'));
        cases.bufferCopy = { bodySha256: row?.body_sha256 };
      },
    );

    await t.test(
      'AC06: six distinct trusted synthetic channels parse two pages without publication authority',
      async () => {
        const receipts: Record<string, unknown> = {};
        const adapters = createSyntheticDiscoveryAdapters({
          resolveRepresentation: registry.resolveRetainedRepresentation,
          resolveReceipt: async (id) => {
            const row = await db
              .prepare(
                'SELECT payload_json FROM discovery_fixture_receipts WHERE id=?',
              )
              .bind(id)
              .first<{ payload_json: string }>();
            if (!row) return null;
            const payload = JSON.parse(row.payload_json);
            if (!payload.adapter) return null;
            const trusted = await registry.resolveRetainedRepresentation(
              payload.adapter.representation,
            );
            if (!trusted) return null;
            const { representation: _reference, ...receipt } = payload.adapter;
            void _reference;
            return receipt as DiscoveryTrustedAdapterReceipt;
          },
        });
        for (const provider of Object.keys(syntheticRows) as Provider[]) {
          const f = await setup(`adapter-${provider}`, {
            provider,
            requiresAuth: true,
          });
          const adapter = adapters[provider];
          assert.equal(adapter.synthetic, true);
          assert.equal(adapter.provider, provider);
          assert.deepEqual(
            adapter.plan(
              { sourceId: f.source.id, parameters: { q: 'synthetic' } },
              null,
              { remainingItems: 2 },
            ),
            {
              sourceId: f.source.id,
              parameters: { q: 'synthetic' },
              checkpoint: null,
            },
          );
          assert.throws(() =>
            adapter.plan({ sourceId: f.source.id, parameters: {} }, null, {
              remainingItems: 0,
            }),
          );
          let sends = 0;
          const transport = registry.createTransport({
            credentialResolver: credentials,
            clock: () => Date.parse(current),
            egress: {
              send: async () =>
                new Response(body(provider, ++sends === 1 ? '2' : null)),
            },
          });
          const first = await f.collect('one'),
            a = await transport.acquire(first.id);
          assert.equal(a.ok, true);
          if (!a.ok) throw new Error(JSON.stringify(a));
          const retained = await f.retain(
            a.acquisition,
            `adapter:${provider}:one`,
          );
          const input = {
            id: retained.representation.id,
            revision: 1,
            bytes: a.acquisition.bytes,
            representationSha256: sha(a.acquisition.bytes),
          };
          const parsed = await adapter.parse(input, first.request);
          assert.equal(parsed.leads.length, 1);
          assert.equal(parsed.health, 'partial');
          assert.equal(parsed.completeness, 'partial');
          assert.equal(parsed.nextCheckpoint, '2');
          assert.equal(parsed.leads[0].publicationAuthorized, false);
          assert.deepEqual(parsed.provenanceReferences, [ref(input.id)]);
          const lead = parsed.leads[0];
          if (provider === 'github') {
            assert.equal(lead.kind, 'artifact');
            assert.equal(lead.nativeId, '1001');
            assert.equal(lead.sourceVersion, 'commit-abc');
            assert.deepEqual(lead.relatedAccounts, ['account-42']);
          }
          if (provider === 'pubmed') {
            assert.equal(lead.kind, 'artifact');
            assert.equal(lead.nativeId, '123456');
            assert.deepEqual(lead.unresolvedPeople, ['Unresolved Author']);
            assert.equal(Object.hasOwn(lead, 'repository'), false);
          }
          if (provider === 'crossref') {
            assert.equal(lead.institutionalAuthor, 'Synthetic Institute');
            assert.deepEqual(lead.unresolvedPeople, ['Unresolved Person']);
          }
          if (provider === 'arxiv') {
            assert.equal(lead.nativeId, '2601.00001');
            assert.equal(lead.sourceVersion, 'v3');
          }
          if (provider === 'forum') {
            assert.equal(lead.kind, 'artifact');
            assert.deepEqual(lead.relatedAccounts, ['opaque-account-7']);
            assert.equal(Object.hasOwn(lead, 'personId'), false);
          }
          if (provider === 'institutional') {
            assert.equal(lead.kind, 'person');
            assert.equal(lead.nativeId, 'independent-1');
            assert.equal(Object.hasOwn(lead, 'artifactId'), false);
            assert.equal(Object.hasOwn(lead, 'repositoryId'), false);
          }
          await assert.rejects(
            adapter.parse(
              { ...input, representationSha256: '0'.repeat(64) },
              first.request,
            ),
          );
          await assert.rejects(
            adapter.parse(input, {
              ...first.request,
              sourceId: 'source:unrelated',
            }),
          );
          await assert.rejects(
            adapter.parse({ ...input, bytes: bytes('corrupt') }, first.request),
          );
          await assert.rejects(
            SYNTHETIC_DISCOVERY_ADAPTERS[provider].parse(input, first.request),
          );
          await assert.rejects(
            adapter.nextPage('fabricated:uncommitted-receipt'),
          );
          const fixture = await persistFixtureReceipt(first, retained, parsed);
          assert.equal(await adapter.nextPage(fixture.id), '2');
          const second = await f.collect('two', {
            parameters: { q: 'synthetic', page: '2' },
            checkpoint: '2',
            continuation: fixture.continuation,
          });
          const b = await transport.acquire(second.id);
          assert.equal(b.ok, true);
          if (!b.ok) throw new Error(JSON.stringify(b));
          const r2 = await f.retain(b.acquisition, `adapter:${provider}:two`);
          const final = await adapter.parse(
            {
              id: r2.representation.id,
              revision: 1,
              bytes: b.acquisition.bytes,
              representationSha256: sha(b.acquisition.bytes),
            },
            second.request,
          );
          assert.equal(final.health, 'healthy');
          assert.equal(final.completeness, 'complete');
          assert.equal(final.terminal, true);
          assert.equal(final.nextCheckpoint, null);
          const finalReceipt = await persistFixtureReceipt(second, r2, final);
          assert.equal(await adapter.nextPage(finalReceipt.id), null);
          assert.equal(sends, 2);
          receipts[provider] = {
            first: parsed,
            second: final,
            firstReceipt: fixture.id,
            secondReceipt: finalReceipt.id,
            transportCalls: sends,
          };
        }
        cases.AC06 = receipts;
      },
    );

    await t.test(
      'actual one-item reservation caps parsed multi-record output with explicit truncation',
      async () => {
        const f = await setup('item-cap', { active: false, maxItems: 1 });
        const plan = await f.issue('two-records');
        const payload = JSON.stringify({
          provider: 'github',
          records: [
            syntheticRows.github,
            { ...syntheticRows.github, repositoryId: 1002 },
          ],
          nextCheckpoint: null,
          terminal: true,
        });
        const acquired = await registry
          .createTransport({
            clock: () => Date.parse(current),
            egress: { send: async () => new Response(payload) },
          })
          .acquire(plan.id);
        assert.equal(acquired.ok, true);
        if (!acquired.ok) throw new Error(JSON.stringify(acquired));
        const retained = await f.retain(acquired.acquisition, 'item-cap');
        const trusted = await registry.resolveRetainedRepresentation(
          ref(retained.representation.id),
        );
        assert.equal(trusted?.remainingItems, 1);
        const adapters = createSyntheticDiscoveryAdapters({
          resolveRepresentation: registry.resolveRetainedRepresentation,
          resolveReceipt: async () => null,
        });
        const result = await adapters.github.parse(
          {
            id: retained.representation.id,
            revision: 1,
            bytes: acquired.acquisition.bytes,
            representationSha256: sha(acquired.acquisition.bytes),
          },
          plan.request,
          { remainingItems: 100 },
        );
        assert.equal(result.leads.length, 1);
        assert.equal(result.rejectedCount, 1);
        assert.equal(result.truncated, true);
        assert.equal(result.terminal, false);
        assert.equal(result.health, 'partial');
        assert.equal(result.completeness, 'partial');
        assert.equal((await registry.readBudget(f.source.budget.id)).items, 1);
        cases.itemCap = { result, reservedItems: trusted?.remainingItems };
      },
    );

    await t.test(
      'dispatch deadlines block new capture without expiring still-permitted retained evidence',
      async () => {
        const f = await setup('historical-deadline');
        assert.ok(f.sample);
        const previous = await evidence.readRevision(
          'representation',
          f.sample!.representation.id,
          1,
        );
        assert.equal(previous?.usable, true);
        const plan = await f.collect('stale-capture'),
          acquired = await registry
            .createTransport({
              clock: () => Date.parse(current),
              egress: { send: async () => new Response(body('github')) },
            })
            .acquire(plan.id);
        assert.equal(acquired.ok, true);
        if (!acquired.ok) throw new Error(JSON.stringify(acquired));
        const prepared = await f.prepare(
          acquired.acquisition,
          'historical-stale',
        );
        current = at(current, 31000);
        await assert.rejects(
          registry
            .createEvidenceStore({ resolveCapability: evidenceAuthority })
            .appendRepresentation(prepared.context, prepared.representation),
        );
        assert.deepEqual(
          await evidence.readRevision(
            'representation',
            f.sample!.representation.id,
            1,
          ),
          previous,
        );
        assert.equal(
          await evidence.readRevision(
            'representation',
            prepared.representation.id,
            1,
          ),
          null,
        );
        const after = await f.collect('post-deadline-new-plan');
        assert.ok(after.id);
        assert.equal('reserveAttempt' in registry, false);
        assert.equal('finishAttempt' in registry, false);
        cases.retentionLifetime = {
          sampleStillUsable: true,
          newStaleCaptureRejected: true,
          newPlanAfterDeadline: true,
          dispatchCompletionPrivate: true,
        };
      },
    );

    await t.test(
      'stale lease/control and final statement failure roll back capture plus settlement in actual D1',
      async () => {
        const reports: unknown[] = [];
        for (const mode of [
          'lease',
          'control',
          'missing-budget',
          'final-statement',
        ] as const) {
          const f = await setup(`retention-${mode}`);
          const plan = await f.collect('race');
          const acquired = await registry
            .createTransport({
              clock: () => Date.parse(current),
              egress: { send: async () => new Response(body('github')) },
            })
            .acquire(plan.id);
          assert.equal(acquired.ok, true);
          if (!acquired.ok) throw new Error(JSON.stringify(acquired));
          const prepared = await f.prepare(
            acquired.acquisition,
            `retention-${mode}`,
          );
          const wrapped = new WeakMap<
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
            wrapped.set(value, { actual, query });
            return value;
          };
          let injected = false;
          let baseline: Record<string, unknown> | undefined;
          const failingDb: D1DatabaseLike = {
            prepare: (query) => wrap(db.prepare(query), query),
            batch: async (statements) => {
              const relevant = statements.some((statement) =>
                wrapped
                  .get(statement)
                  ?.query.includes('INSERT INTO discovery_evidence_guards'),
              );
              const actual = statements.map(
                (statement) => wrapped.get(statement)?.actual ?? statement,
              );
              if (relevant && !injected) {
                injected = true;
                if (mode === 'lease')
                  await registry.acquireLease(
                    registryContext('advance:lease'),
                    {
                      id: f.lease.id,
                      sourceId: f.source.id,
                      owner: f.lease.owner,
                      expectedFence: f.lease.fence,
                      expiresAt: EXPIRY,
                    },
                  );
                if (mode === 'control')
                  await evidence.appendControl(
                    evidenceContext('advance:configuration', 1),
                    {
                      id: f.ids.configuration,
                      revision: 2,
                      kind: 'configuration',
                      value: 'replacement-configuration',
                    },
                  );
                if (mode === 'missing-budget')
                  await db
                    .prepare('DELETE FROM discovery_source_budgets WHERE id=?')
                    .bind(f.source.budget.id)
                    .run();
                baseline = await dump();
                actual.unshift(
                  db.prepare(
                    "INSERT INTO discovery_catalog_evidence_refs VALUES('retention:would-leak',1)",
                  ),
                );
                if (mode === 'final-statement')
                  actual.push(
                    db.prepare(
                      "INSERT INTO discovery_catalog_evidence_refs VALUES('retention:forced-failure',0)",
                    ),
                  );
              }
              return db.batch(actual);
            },
          };
          const raced = createDiscoverySourceRegistry(failingDb, {
            resolveCapability: registryAuthority,
            now,
            resolveContinuation,
          }).createEvidenceStore({ resolveCapability: evidenceAuthority });
          await assert.rejects(
            raced.appendRepresentation(
              prepared.context,
              prepared.representation,
            ),
          );
          assert.equal(injected, true);
          assert.deepEqual(
            await dump(),
            baseline,
            `${mode} leaked a partial mutation`,
          );
          assert.equal(
            await evidence.readRevision(
              'representation',
              prepared.representation.id,
              1,
            ),
            null,
          );
          assert.equal(
            await db
              .prepare(
                "SELECT * FROM discovery_catalog_evidence_refs WHERE id='retention:would-leak'",
              )
              .first(),
            null,
          );
          reports.push({
            mode,
            prefixAndEvidenceAndSettlementRolledBack: true,
          });
        }
        cases.retentionAtomicity = reports;
      },
    );

    await t.test(
      'input mutation across capability await cannot change approved target or content',
      async () => {
        const f = await setup('capability-mutation', { active: false });
        let enter!: () => void, release!: () => void;
        const entered = new Promise<void>((r) => {
            enter = r;
          }),
          gate = new Promise<void>((r) => {
            release = r;
          });
        const guarded = createDiscoverySourceRegistry(db, {
          now,
          resolveContinuation,
          resolveCapability: async (token, request) => {
            enter();
            await gate;
            return registryAuthority(token, request);
          },
        });
        const input = {
          ...f.source,
          revision: 2,
          engineeringOwnerId: 'synthetic:approved-owner',
        };
        const context = registryContext('approved-mutation');
        const approvedOperation = context.operationId;
        const pending = guarded.enroll(context, input);
        await entered;
        input.id = 'source:unauthorized-target';
        input.engineeringOwnerId = 'synthetic:unauthorized-owner';
        context.operationId = 'operation:unauthorized';
        release();
        const result = await pending;
        assert.equal(result.id, f.source.id);
        assert.equal(result.operationId, approvedOperation);
        const row = await db
          .prepare(
            'SELECT payload_json FROM discovery_source_revisions WHERE source_id=? AND revision=2',
          )
          .bind(f.source.id)
          .first<{ payload_json: string }>();
        assert.ok(row);
        assert.equal(
          JSON.parse(row.payload_json).engineeringOwnerId,
          'synthetic:approved-owner',
        );
        assert.equal(
          await db
            .prepare(
              "SELECT * FROM discovery_source_heads WHERE source_id='source:unauthorized-target'",
            )
            .first(),
          null,
        );
        cases.inputMutation = {
          approvedTarget: f.source.id,
          approvedOperation,
          unauthorizedTargetAbsent: true,
        };
      },
    );

    await t.test(
      'old material scope removal preserves newer source revision with another scope',
      async () => {
        const a = await setup('scope-revision');
        const config = 'configuration:scope-revision-b',
          rights = 'rights:scope-revision-b',
          permission = 'permission:scope-revision-b';
        await evidence.appendControl(evidenceContext('scope-b:configuration'), {
          id: config,
          revision: 1,
          kind: 'configuration',
          value: 'scope-b-v1',
        });
        const scope = {
          ...a.scope,
          scopeId: 'scope:revision-b',
          configuration: ref(config),
          requestScopeSha256: await requestScopeDigest({
            scopeId: 'scope:revision-b',
            parameters: { q: 'scope-b' },
            windowStart: a.source.budget.windowStart,
            windowEnd: a.source.budget.windowEnd,
          }),
        };
        await evidence.appendControl(evidenceContext('scope-b:rights'), {
          id: rights,
          revision: 1,
          kind: 'rights',
          value: 'allow',
          rights: { materialScope: scope, retain: true, transform: true },
        });
        await evidence.appendControl(evidenceContext('scope-b:permission'), {
          id: permission,
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
        });
        const source = DiscoveryRuntimeSource.parse({
          ...a.source,
          revision: 2,
          scopeId: scope.scopeId,
          configuration: scope.configuration,
          permission: ref(permission),
          rights: ref(rights),
          materialScope: scope,
        });
        await registry.enroll(registryContext('scope-b:enroll'), source);
        const sampleId = 'sample:scope-revision-b',
          qualificationId = 'qualification:scope-revision-b';
        await registry.authorizeSampling(registryContext('scope-b:sample'), {
          id: sampleId,
          sourceId: source.id,
          sourceRevision: 2,
          maxRequests: 10,
          expiresAt: EXPIRY,
        });
        const lease = await registry.acquireLease(
          registryContext('scope-b:lease'),
          {
            id: a.lease.id,
            sourceId: source.id,
            owner: a.lease.owner,
            expectedFence: a.lease.fence,
            expiresAt: EXPIRY,
          },
        );
        const samplePlan = await registry.issue(
          registryContext('scope-b:issue'),
          {
            id: 'plan:scope-revision-b:sample',
            sourceId: source.id,
            sourceRevision: 2,
            runId: 'run:scope-revision-b',
            purpose: 'qualification-sample',
            samplingGrantId: sampleId,
            parameters: { q: 'scope-b', page: '1' },
            checkpoint: null,
            lease: { id: lease.id, owner: lease.owner, fence: lease.fence },
            deadlineAt: at(current, 30000),
          },
        );
        const sample = await registry
          .createTransport({
            clock: () => Date.parse(current),
            egress: { send: async () => new Response(body('github')) },
          })
          .acquire(samplePlan.id);
        assert.equal(sample.ok, true);
        if (!sample.ok) throw new Error(JSON.stringify(sample));
        const retained = await a.retain(
          { ...sample.acquisition, plan: samplePlan },
          'scope-revision-b:sample',
        );
        await registry.qualify(registryContext('scope-b:qualify'), {
          id: qualificationId,
          sourceId: source.id,
          sourceRevision: 2,
          installation: source.installation,
          configurationSha256: await sourceConfigurationDigest(source),
          parser: source.parser,
          permission: source.permission,
          rights: source.rights,
          accessDecision: source.accessDecision,
          displayRights: source.displayRights,
          engineeringOwnerId: source.engineeringOwnerId,
          editorialOwnerId: source.editorialOwnerId,
          reviewedAt: current,
          expiresAt: EXPIRY,
          samples: [
            {
              endpoint: samplePlan.endpoint,
              representation: ref(retained.representation.id),
              representationSha256: sha(sample.acquisition.bytes),
            },
          ],
        });
        await registry.activate(registryContext('scope-b:activate'), {
          sourceId: source.id,
          sourceRevision: 2,
          qualificationId,
        });
        const plan = await registry.issue(registryContext('scope-b:collect'), {
          id: 'plan:scope-revision-b:collection',
          sourceId: source.id,
          sourceRevision: 2,
          runId: 'run:scope-revision-b',
          purpose: 'collection',
          qualificationId,
          parameters: { q: 'scope-b', page: '1' },
          checkpoint: null,
          lease: { id: lease.id, owner: lease.owner, fence: lease.fence },
          deadlineAt: at(current, 30000),
        });
        const before = await evidence.readRevision(
          'representation',
          retained.representation.id,
          1,
        );
        assert.equal(before?.usable, true);
        await evidence.revokeRetention(evidenceContext('revoke:scope-a'), {
          id: 'revoke:scope-revision-a',
          revision: 1,
          rights: a.source.rights,
          policy: ref(a.ids.policy),
          reason: 'Synthetic old-scope revocation',
        });
        assert.deepEqual(
          await evidence.readRevision(
            'representation',
            retained.representation.id,
            1,
          ),
          before,
        );
        assert.equal((await registry.resolvePlan(plan.id)).source.revision, 2);
        const head = await db
          .prepare(
            'SELECT revision,active,qualification_id FROM discovery_source_heads WHERE source_id=?',
          )
          .bind(source.id)
          .first<{
            revision: number;
            active: number;
            qualification_id: string;
          }>();
        assert.deepEqual(head, {
          revision: 2,
          active: 1,
          qualification_id: qualificationId,
        });
        let sends = 0;
        const result = await registry
          .createTransport({
            clock: () => Date.parse(current),
            egress: {
              send: async () => {
                sends++;
                return new Response(body('github'));
              },
            },
          })
          .acquire(plan.id);
        assert.equal(result.ok, true);
        assert.equal(sends, 1);
        cases.scopeRemoval = {
          oldScopeRemoved: true,
          newRevision: 2,
          newScopeRemainsActive: true,
          newScopeSends: sends,
        };
      },
    );

    await t.test(
      'opaque request binding token is returned once and absent from every durable table',
      async () => {
        const f = await setup('token-audit', { active: false });
        const input = {
          id: 'plan:token-audit',
          sourceId: f.source.id,
          sourceRevision: 1,
          runId: 'run:token-audit',
          purpose: 'qualification-sample' as const,
          samplingGrantId: f.grant.id,
          parameters: { q: 'synthetic', page: '1' },
          checkpoint: null,
          lease: { id: f.lease.id, owner: f.lease.owner, fence: f.lease.fence },
          deadlineAt: at(current, 30000),
        };
        const context = registryContext('token-audit');
        const issued = await registry.issue(context, input);
        assert.ok(issued.requestBindingToken);
        assert.equal(
          JSON.stringify(await dump()).includes(issued.requestBindingToken),
          false,
        );
        const replay = await registry.issue(context, input);
        assert.equal(replay.id, issued.id);
        assert.equal(replay.requestBindingToken, undefined);
        assert.equal(
          (await registry.resolvePlan(issued.id)).requestBindingToken,
          undefined,
        );
        const acquisition = await registry
          .createTransport({
            clock: () => Date.parse(current),
            egress: { send: async () => new Response(body('github')) },
          })
          .acquire(issued.id);
        assert.equal(acquisition.ok, true);
        if (!acquisition.ok) throw new Error(JSON.stringify(acquisition));
        await f.retain(
          { ...acquisition.acquisition, plan: issued },
          'token-audit',
        );
        assert.equal(
          JSON.stringify(await dump()).includes(issued.requestBindingToken),
          false,
        );
        cases.tokenAudit = { returnedOnce: true, durableRawTokenAbsent: true };
      },
    );

    await t.test(
      'frozen wall clock cannot extend invocation across slow real registry lookup',
      async () => {
        const f = await setup('lazy-deadline', {
          active: false,
          maxWallTimeMs: 20,
        });
        const plan = await f.issue('late-lookup');
        let sends = 0;
        const mapping = new WeakMap<object, D1StatementLike>();
        const wrap = (
          actual: D1StatementLike,
          query: string,
        ): D1StatementLike => {
          const value: D1StatementLike = {
            bind: (...values) => wrap(actual.bind(...values), query),
            first: async <T>() => {
              const row = await actual.first<T>();
              if (
                query.includes(
                  'SELECT payload_json FROM discovery_source_plans',
                )
              )
                await new Promise((r) => setTimeout(r, 60));
              return row;
            },
            all: <T>() => actual.all<T>(),
            run: () => actual.run(),
          };
          mapping.set(value, actual);
          return value;
        };
        const slowDb: D1DatabaseLike = {
          prepare: (query) => wrap(db.prepare(query), query),
          batch: (statements) =>
            db.batch(statements.map((s) => mapping.get(s) ?? s)),
        };
        const slow = createDiscoverySourceRegistry(slowDb, {
          resolveCapability: registryAuthority,
          now,
          resolveContinuation,
        });
        const before = await registry.readBudget(f.source.budget.id);
        const result = await slow
          .createTransport({
            clock: () => Date.parse(current),
            egress: {
              send: async () => {
                sends++;
                return new Response('{}');
              },
            },
          })
          .acquire(plan.id);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.failure.outcome, 'timed-out');
        assert.equal(sends, 0);
        assert.deepEqual(await registry.readBudget(f.source.budget.id), before);
        cases.lazyDeadline = { sends, result, clockFrozenAt: current };
      },
    );

    await t.test(
      'caller plan mutation and credential mutation across reservation cannot redirect or replace headers',
      async () => {
        const f = await setup('detached-bindings', { requiresAuth: true });
        const plan = await f.collect('detached');
        const exposed = await registry.resolvePlan(plan.id);
        exposed.endpoint = 'https://10.0.0.1/exfil';
        exposed.source.endpointTemplate.origin = 'https://10.0.0.1';
        const binding = {
          origin: f.template.origin,
          headers: { Authorization: 'Bearer original-synthetic-binding' },
          expiresAt: EXPIRY,
        };
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
        let mutated = false;
        const changed: D1DatabaseLike = {
          prepare: (query) => wrap(db.prepare(query), query),
          batch: (statements) => {
            if (
              statements.some((s) =>
                mapping
                  .get(s)
                  ?.query.includes('INSERT INTO discovery_source_attempts'),
              )
            ) {
              binding.headers.Authorization =
                'Bearer changed-synthetic-binding';
              mutated = true;
            }
            return db.batch(statements.map((s) => mapping.get(s)?.actual ?? s));
          },
        };
        const local = createDiscoverySourceRegistry(changed, {
          resolveCapability: registryAuthority,
          now,
          resolveContinuation,
        });
        let sent: string | undefined;
        const result = await local
          .createTransport({
            credentialResolver: async () => binding,
            clock: () => Date.parse(current),
            egress: {
              send: async (url, init) => {
                sent = url;
                assert.equal(
                  init.headers.Authorization,
                  'Bearer original-synthetic-binding',
                );
                return new Response(body('github'));
              },
            },
          })
          .acquire(plan.id);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(mutated, true);
        assert.equal(sent, plan.endpoint);
        cases.detachedBindings = {
          originalEndpoint: sent,
          credentialSnapshotPreserved: true,
        };
      },
    );

    await t.test(
      'failure attribution survives missing readiness, expiry, disablement and scope removal',
      async () => {
        const outcomes: unknown[] = [];
        for (const mode of [
          'missing-egress',
          'missing-budget',
          'expired',
          'disabled',
          'revoked',
        ] as const) {
          const f = await setup(`identity-${mode}`);
          const plan = await f.collect('known-plan');
          let sends = 0;
          if (mode === 'missing-budget')
            await db
              .prepare('DELETE FROM discovery_source_budgets WHERE id=?')
              .bind(f.source.budget.id)
              .run();
          if (mode === 'expired') current = at(current, 31000);
          if (mode === 'disabled') {
            const head = await db
              .prepare(
                'SELECT generation FROM discovery_source_heads WHERE source_id=?',
              )
              .bind(f.source.id)
              .first<{ generation: number }>();
            assert.ok(head);
            await registry.deactivate(registryContext('identity:disable'), {
              sourceId: f.source.id,
              expectedGeneration: head.generation,
              reasonCode: 'synthetic-disabled',
            });
          }
          if (mode === 'revoked') {
            await evidence.revokeRetention(evidenceContext('identity:revoke'), {
              id: 'revoke:failure-attribution',
              revision: 1,
              rights: f.source.rights,
              policy: ref(f.ids.policy),
              reason: 'Synthetic scope withdrawal',
            });
            assert.equal(
              await db
                .prepare('SELECT id FROM discovery_source_plans WHERE id=?')
                .bind(plan.id)
                .first(),
              null,
              'the erased plan cannot supply current identity payload',
            );
            const fresh = await setup('identity-rebinding', { active: false });
            await assert.rejects(
              fresh.issue('reused-plan-identity', { id: plan.id }),
            );
            assert.equal(
              await db
                .prepare('SELECT id FROM discovery_source_plans WHERE id=?')
                .bind(plan.id)
                .first(),
              null,
              'identity reuse must not recreate the erased plan',
            );
          }
          const options = {
            clock: () => Date.parse(current),
            ...(mode === 'missing-egress'
              ? {}
              : {
                  egress: {
                    send: async () => {
                      sends++;
                      return new Response(body('github'));
                    },
                  },
                }),
          };
          const result = await registry
            .createTransport(options)
            .acquire(plan.id);
          assert.equal(result.ok, false);
          if (result.ok) throw new Error('unexpected readiness success');
          assert.equal(result.failure.sourceId, f.source.id);
          assert.equal(result.failure.operationId, plan.request.operationId);
          assert.notEqual(result.failure.sourceId, plan.id);
          assert.equal(sends, 0);
          outcomes.push({
            mode,
            sourceId: result.failure.sourceId,
            operationId: result.failure.operationId,
            outcome: result.failure.outcome,
          });
        }
        const unknown = await registry
          .createTransport({
            clock: () => Date.parse(current),
            egress: {
              send: async () => {
                throw new Error('unknown plan must not fetch');
              },
            },
          })
          .acquire('plan:truly-unknown');
        assert.equal(unknown.ok, false);
        if (unknown.ok) throw new Error('unexpected unknown plan success');
        assert.equal(unknown.failure.sourceId, 'source:unresolved');
        assert.equal(unknown.failure.operationId, 'operation:unresolved');

        const reservedFixture = await setup('identity-reserved', {
          active: false,
        });
        const reservedSource = {
          ...reservedFixture.source,
          id: 'source:unresolved',
          materialScope: {
            ...reservedFixture.scope,
            sourceId: 'source:unresolved',
          },
        };
        assert.equal(
          DiscoveryId.safeParse('source:unresolved').success,
          true,
          'the shared ID schema is not globally changed',
        );
        assert.equal(
          DiscoveryRuntimeSource.safeParse(reservedSource).success,
          false,
          'a real source cannot use the unresolved sentinel',
        );
        const beforeReserved = await dump();
        await assert.rejects(
          registry.enroll(registryContext('reserved-source'), reservedSource),
        );
        assert.deepEqual(await dump(), beforeReserved);
        await assert.rejects(
          registry.enroll(
            {
              operationId: 'operation:unresolved',
              capabilityToken: 'synthetic-registry-capability',
            },
            { ...reservedFixture.source, revision: 2 },
          ),
        );
        assert.deepEqual(await dump(), beforeReserved);
        cases.failureAttribution = {
          known: outcomes,
          unknown: unknown.failure,
        };
      },
    );

    await t.test(
      'credential lifetime cannot be extended by a backward clock during slow reservation',
      async () => {
        const f = await setup('credential-lifetime', { requiresAuth: true });
        const plan = await f.collect('slow-reservation');
        let wall = Date.parse(current),
          sends = 0,
          delayed = false;
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
        const slowDb: D1DatabaseLike = {
          prepare: (query) => wrap(db.prepare(query), query),
          batch: async (statements) => {
            const results = await db.batch(
              statements.map((s) => mapping.get(s)?.actual ?? s),
            );
            if (
              statements.some((s) =>
                mapping
                  .get(s)
                  ?.query.includes('INSERT INTO discovery_source_attempts'),
              )
            ) {
              await new Promise((r) => setTimeout(r, 60));
              wall -= 60000;
              delayed = true;
            }
            return results;
          },
        };
        const local = createDiscoverySourceRegistry(slowDb, {
          resolveCapability: registryAuthority,
          now,
          resolveContinuation,
        });
        const result = await local
          .createTransport({
            clock: () => wall,
            credentialResolver: async () => ({
              origin: f.template.origin,
              headers: { Authorization: 'Bearer bounded-synthetic-credential' },
              expiresAt: at(current, 20),
            }),
            egress: {
              send: async () => {
                sends++;
                return new Response(body('github'));
              },
            },
          })
          .acquire(plan.id);
        assert.equal(delayed, true);
        assert.equal(result.ok, false);
        assert.equal(sends, 0);
        assert.equal(
          (await registry.readBudget(f.source.budget.id)).requests,
          2,
        );
        cases.credentialLifetime = {
          zeroSendsAfterLifetime: true,
          chargedAttemptPreserved: true,
          wallClockMovedBackwards: true,
          result,
        };
      },
    );

    assert.deepEqual(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
      [],
    );
    assert.deepEqual(
      inputHashes(),
      inputsBefore,
      'implementation/test inputs changed during this run',
    );
  },
);
