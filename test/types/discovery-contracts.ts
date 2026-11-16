import type {
  DecisionAuthority,
  ReviewTarget,
} from "../../src/content/discovery-schema";
import type { DiscoverySourceRequest } from "../../src/ingest/discovery/source-contract";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// These assertions must fail compilation if runtime refinements leave a wider
// inferred type available to internal callers that already hold typed values.
export type CreatorKindsAreExact = Expect<Equal<
  Extract<ReviewTarget, { kind: "creator" }>["subject"]["kind"],
  "person" | "organization"
>>;
export type WorkKindsAreExact = Expect<Equal<
  Extract<ReviewTarget, { kind: "work" }>["subject"]["kind"],
  "project" | "artifact"
>>;
export type ModelsCannotBeDecisionAuthorities = Expect<Equal<
  Extract<DecisionAuthority, { kind: "model" }>, never
>>;

type SampleRequest = Extract<DiscoverySourceRequest, { purpose: "qualification-sample" }>;
type CollectionRequest = Extract<DiscoverySourceRequest, { purpose: "collection" }>;
export type SampleDoesNotRequireItsOwnResult = Expect<Equal<
  "qualification" extends keyof SampleRequest ? true : false, false
>>;
export type CollectionRequiresQualification = Expect<Equal<
  CollectionRequest["qualification"]["revision"], number
>>;

// WP04 additions: inferred types must enforce the catalog's endpoint contracts.
import type { DiscoveryEntity, DiscoveryRelation } from '../../src/content/discovery-catalog';

type CatalogAccount = Extract<DiscoveryEntity, { kind: 'account' }>;
export type CatalogAccountIdentityIsAccount = Expect<Equal<CatalogAccount['identity']['kind'], 'account'>>;
export type OwnershipFromKinds = Expect<Equal<
  Extract<DiscoveryRelation, { kind: 'account-ownership' }>['from']['kind'],
  'person' | 'organization'
>>;
export type OwnershipToKind = Expect<Equal<
  Extract<DiscoveryRelation, { kind: 'account-ownership' }>['to']['kind'], 'account'
>>;
export type AffiliationFromKind = Expect<Equal<
  Extract<DiscoveryRelation, { kind: 'affiliation' }>['from']['kind'], 'person'
>>;
export type AffiliationToKind = Expect<Equal<
  Extract<DiscoveryRelation, { kind: 'affiliation' }>['to']['kind'], 'organization'
>>;
export type AttributionFromKinds = Expect<Equal<
  Extract<DiscoveryRelation, { kind: 'attribution' }>['from']['kind'],
  'person' | 'organization' | 'account'
>>;
export type AttributionToKinds = Expect<Equal<
  Extract<DiscoveryRelation, { kind: 'attribution' }>['to']['kind'], 'artifact' | 'project'
>>;
export type MembershipFromKind = Expect<Equal<
  Extract<DiscoveryRelation, { kind: 'project-membership' }>['from']['kind'], 'artifact'
>>;
export type MembershipToKind = Expect<Equal<
  Extract<DiscoveryRelation, { kind: 'project-membership' }>['to']['kind'], 'project'
>>;

type CanAssignEndpointPair<R, From, To> = R extends { from: infer F; to: infer T }
  ? From extends F ? To extends T ? true : false : false : false;
type PersonEndpoint = { id: string; revision: number; kind: 'person' };
type OrganizationEndpoint = { id: string; revision: number; kind: 'organization' };
type RepositoryEndpoint = { id: string; revision: number; kind: 'artifact'; artifactKind: 'repository' };
type PublicationEndpoint = { id: string; revision: number; kind: 'artifact'; artifactKind: 'publication' };
export type OwnershipCannotPointToPerson = Expect<Equal<
  true extends CanAssignEndpointPair<Extract<DiscoveryRelation, { kind: 'account-ownership' }>, PersonEndpoint, PersonEndpoint> ? true : false,
  false
>>;
export type EquivalenceCannotCrossSubjectKinds = Expect<Equal<
  true extends CanAssignEndpointPair<Extract<DiscoveryRelation, { kind: 'equivalence' }>, PersonEndpoint, OrganizationEndpoint> ? true : false,
  false
>>;
export type EquivalenceCannotCrossArtifactSubtypes = Expect<Equal<
  true extends CanAssignEndpointPair<Extract<DiscoveryRelation, { kind: 'equivalence' }>, RepositoryEndpoint, PublicationEndpoint> ? true : false,
  false
>>;
export type ArtifactVersionsCannotCrossArtifactSubtypes = Expect<Equal<
  true extends CanAssignEndpointPair<Extract<DiscoveryRelation, { kind: 'artifact-version' }>, RepositoryEndpoint, PublicationEndpoint> ? true : false,
  false
>>;


// Compile-only use of the removal-only consumer: context defaults stay optional;
// callers cannot supply editorial actions or string native post identities.
export function discoverySourceSupportInputContract(
  consumer: ReturnType<typeof import('../../src/ingest/discovery/forum-currentness').createDiscoveryForumCurrentnessConsumer>,
) {
  const context = { operationId: 'fixture:edit', expectedRevision: null, capabilityToken: 'fixture-only' };
  const input = { id: 'fixture:source-change', revision: 1, priorReceiptId: 'fixture:prior', currentReceiptId: 'fixture:current', postId: 42, policy: { id: 'fixture:policy', revision: 1 } };
  void consumer.consumeEdit(context, input);
  // @ts-expect-error Native post identity must be a number.
  void consumer.consumeEdit(context, { ...input, postId: '42' });
  // @ts-expect-error Editorial decision actions are not operation input.
  void consumer.consumeEdit(context, { ...input, action: 'decision' });
}
