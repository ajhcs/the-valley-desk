import { z } from 'zod';
import {
  DISCOVERY_SCHEMA_VERSION,
  DISCOVERY_COUNTY_KEYS,
  DiscoveryId,
  Revision,
  RevisionRef,
  ProviderIdentity,
  DiscoverySubject,
  DiscoveryDate,
  DiscoveryInstant,
} from './discovery-schema';

const label = z.string().trim().min(1).max(500);
const base = {
  schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
  id: DiscoveryId,
  revision: Revision,
  displayName: label,
};
const artifact = { ...base, kind: z.literal('artifact'), sourceDate: DiscoveryDate };
const accountIdentity = ProviderIdentity.extend({ kind: z.literal('account') }).strict();

export const DiscoveryArtifact = z.discriminatedUnion('artifactKind', [
  z.object({ ...artifact, artifactKind: z.literal('repository') }).strict(),
  z.object({ ...artifact, artifactKind: z.literal('publication') }).strict(),
  z.object({ ...artifact, artifactKind: z.literal('discussion') }).strict(),
]);
export type DiscoveryArtifact = z.infer<typeof DiscoveryArtifact>;

export const DiscoveryEntity = z.union([
  z.object({ ...base, kind: z.literal('person') }).strict(),
  z.object({ ...base, kind: z.literal('organization') }).strict(),
  z.object({ ...base, kind: z.literal('account'), identity: accountIdentity }).strict(),
  z.object({ ...base, kind: z.literal('project') }).strict(),
  DiscoveryArtifact,
]);
export type DiscoveryEntity = z.infer<typeof DiscoveryEntity>;

const endpoint = { id: DiscoveryId, revision: Revision };
const personEndpoint = z.object({ ...endpoint, kind: z.literal('person') }).strict();
const organizationEndpoint = z.object({ ...endpoint, kind: z.literal('organization') }).strict();
const accountEndpoint = z.object({ ...endpoint, kind: z.literal('account') }).strict();
const projectEndpoint = z.object({ ...endpoint, kind: z.literal('project') }).strict();
function artifactEndpoint<K extends DiscoveryArtifact['artifactKind']>(artifactKind: K) {
  return z.object({
    ...endpoint,
    kind: z.literal('artifact'),
    artifactKind: z.literal(artifactKind),
  }).strict();
}
const repositoryEndpoint = artifactEndpoint('repository');
const publicationEndpoint = artifactEndpoint('publication');
const discussionEndpoint = artifactEndpoint('discussion');
const anyArtifactEndpoint = z.discriminatedUnion('artifactKind', [
  repositoryEndpoint,
  publicationEndpoint,
  discussionEndpoint,
]);
export const DiscoveryEndpoint = z.union([
  personEndpoint,
  organizationEndpoint,
  accountEndpoint,
  projectEndpoint,
  anyArtifactEndpoint,
]);
export type DiscoveryEndpoint = z.infer<typeof DiscoveryEndpoint>;

const refs = z.array(RevisionRef).min(1).max(128).refine(
  values => new Set(values.map(r => `${r.id}\0${r.revision}`)).size === values.length,
);
const relationBase = {
  schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
  id: DiscoveryId,
  revision: Revision,
  evidence: refs,
  decision: RevisionRef,
  status: z.enum(['active', 'retracted']),
  sourceDate: DiscoveryDate,
};
function equivalence<E extends z.ZodTypeAny>(pairEndpoint: E) {
  return z.object({
    ...relationBase,
    kind: z.literal('equivalence'),
    from: pairEndpoint,
    to: pairEndpoint,
  }).strict();
}
function artifactVersion<E extends z.ZodTypeAny>(pairEndpoint: E) {
  return z.object({
    ...relationBase,
    kind: z.literal('artifact-version'),
    from: pairEndpoint,
    to: pairEndpoint,
    version: z.string().min(1).max(200),
  }).strict();
}
export const DiscoveryRelation = z.union([
  z.object({
    ...relationBase,
    kind: z.literal('attribution'),
    from: z.union([personEndpoint, organizationEndpoint, accountEndpoint]),
    to: z.union([anyArtifactEndpoint, projectEndpoint]),
    role: z.enum(['author', 'developer', 'evaluator', 'explainer', 'contributor']),
  }).strict(),
  z.object({
    ...relationBase,
    kind: z.literal('account-ownership'),
    from: z.union([personEndpoint, organizationEndpoint]),
    to: accountEndpoint,
  }).strict(),
  z.object({
    ...relationBase,
    kind: z.literal('affiliation'),
    from: personEndpoint,
    to: organizationEndpoint,
    basis: z.enum(['professional', 'residence', 'membership']),
    county: z.string().min(1).max(100).nullable(),
    // Supported presence-assertion interval, never an invented employment end.
    // A bounded currentness assessment must retain its policy/evidence basis.
    validFrom: DiscoveryInstant.nullable(),
    validUntil: DiscoveryInstant.nullable(),
    checkedAt: DiscoveryInstant,
    expiresAt: DiscoveryInstant,
  }).strict(),
  z.object({
    ...relationBase,
    kind: z.literal('project-membership'),
    from: anyArtifactEndpoint,
    to: projectEndpoint,
  }).strict(),
  artifactVersion(repositoryEndpoint),
  artifactVersion(publicationEndpoint),
  artifactVersion(discussionEndpoint),
  equivalence(personEndpoint),
  equivalence(organizationEndpoint),
  equivalence(accountEndpoint),
  equivalence(projectEndpoint),
  equivalence(repositoryEndpoint),
  equivalence(publicationEndpoint),
  equivalence(discussionEndpoint),
]).superRefine((relation, ctx) => {
  if (relation.from.id === relation.to.id) {
    ctx.addIssue({ code: 'custom', message: 'discovery-invalid-endpoints' });
  }
  if (relation.kind !== 'affiliation') return;
  const expiredAtCheck = Date.parse(relation.expiresAt) <= Date.parse(relation.checkedAt);
  const reversedInterval = relation.validFrom !== null && relation.validUntil !== null
    && Date.parse(relation.validFrom) >= Date.parse(relation.validUntil);
  if (expiredAtCheck || reversedInterval) {
    ctx.addIssue({ code: 'custom', message: 'discovery-invalid-affiliation-interval' });
  }
});
export type DiscoveryRelation = z.infer<typeof DiscoveryRelation>;

// A relation record is proposed evidence until its separately authenticated decision is accepted.
// This helper never admits a person, and an employment relation is not required for independent creators.
export function discoveryAffiliationIsCurrentLocal(input: unknown, now: string): boolean {
  const relation = DiscoveryRelation.parse(input);
  DiscoveryInstant.parse(now);
  if (relation.kind !== 'affiliation' || relation.status !== 'active'
    || relation.basis !== 'professional' || relation.county === null
    || !(DISCOVERY_COUNTY_KEYS as readonly string[]).includes(relation.county)
    || relation.validFrom === null || relation.validUntil === null) {
    return false;
  }
  const n = Date.parse(now);
  return Date.parse(relation.validFrom) <= n && n < Date.parse(relation.validUntil)
    && Date.parse(relation.checkedAt) <= n && n < Date.parse(relation.expiresAt);
}

export const DiscoveryObservation = z.object({
  schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
  id: DiscoveryId,
  revision: Revision,
  identity: ProviderIdentity,
  observedAt: DiscoveryInstant,
  sourceDate: DiscoveryDate,
  representationSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DiscoveryObservation = z.infer<typeof DiscoveryObservation>;

export const DiscoveryAlias = z.object({
  schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
  id: DiscoveryId,
  subject: DiscoverySubject,
  value: z.string().min(1).max(512),
  observedAt: DiscoveryInstant,
  evidence: refs,
}).strict();
export type DiscoveryAlias = z.infer<typeof DiscoveryAlias>;
