import { z } from 'zod';
import {
  DISCOVERY_SCHEMA_VERSION,
  DiscoveryId,
  Revision,
  RevisionRef,
  DiscoveryInstant,
  DiscoverySubject,
  DecisionAuthority,
} from './discovery-schema';

export const DISCOVERY_EVIDENCE_KINDS = [
  'enrollment',
  'configuration',
  'permission',
  'parser',
  'normalizer',
  'policy',
  'rights',
  'origin',
  'issued-request',
  'representation',
  'observation',
  'evidence',
  'claim',
  'decision',
  'private-note',
  'refresh-failure',
  'revocation',
] as const;
export const DiscoveryEvidenceKind = z.enum(DISCOVERY_EVIDENCE_KINDS);
export type DiscoveryEvidenceKind = z.infer<typeof DiscoveryEvidenceKind>;
export const DiscoveryEvidenceDependency = RevisionRef.extend({
  kind: DiscoveryEvidenceKind,
}).strict();
export type DiscoveryEvidenceDependency = z.infer<
  typeof DiscoveryEvidenceDependency
>;
const refs = z
  .array(DiscoveryEvidenceDependency)
  .max(512)
  .refine(
    (a) => new Set(a.map((r) => `${r.kind}:${r.id}`)).size === a.length,
    'duplicate reference',
  );
const endpoint = z
  .string()
  .url()
  .max(2048)
  .refine((s) => {
    const url = new URL(s);
    return (
      url.protocol === 'https:' && !url.username && !url.password && !url.hash
    );
  });
const base = {
  schemaVersion: z
    .literal(DISCOVERY_SCHEMA_VERSION)
    .default(DISCOVERY_SCHEMA_VERSION),
  id: DiscoveryId,
  revision: Revision,
};
export const DiscoveryArtifactMaterialScope = z
  .object({
    kind: z.literal('artifact'),
    artifactId: DiscoveryId,
    artifactVersion: z.string().min(1).max(200),
    material: z.enum([
      'metadata',
      'code',
      'text',
      'figures',
      'data',
      'weights',
      'forum-content',
    ]),
  })
  .strict();
export const DiscoverySourceResponseMaterialScope = z
  .object({
    kind: z.literal('source-response'),
    sourceId: DiscoveryId,
    installation: DiscoveryId,
    scopeId: DiscoveryId,
    enrollment: RevisionRef,
    configuration: RevisionRef,
    endpointConstructor: DiscoveryId,
    endpointTemplateSha256: z.string().regex(/^[a-f0-9]{64}$/),
    requestScopeSha256: z.string().regex(/^[a-f0-9]{64}$/),
    material: z.enum(['metadata', 'text', 'forum-content']),
  })
  .strict();
export const DiscoveryMaterialScope = z.discriminatedUnion('kind', [
  DiscoveryArtifactMaterialScope,
  DiscoverySourceResponseMaterialScope,
]);
export type DiscoveryMaterialScope = z.infer<typeof DiscoveryMaterialScope>;
export const DiscoveryIssuedSourceRequest = z
  .object({
    ...base,
    requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    materialScope: DiscoverySourceResponseMaterialScope,
    actualEndpoint: endpoint,
    originMemberId: DiscoveryId,
    permission: RevisionRef,
    rights: RevisionRef,
    expiresAt: DiscoveryInstant,
  })
  .strict();
export type DiscoveryIssuedSourceRequest = z.infer<
  typeof DiscoveryIssuedSourceRequest
>;
export type DiscoveryVerifiedIssuedSourceRequest = Omit<
  DiscoveryIssuedSourceRequest,
  'id' | 'revision' | 'schemaVersion'
> & {
  issuedRequest: RevisionRef;
  operationId: string;
  targetId: string;
  action: 'issue-request' | 'origin' | 'capture';
  mutationRequestSha256: string;
};
export type DiscoveryIssuedSourceRequestResolver = (
  opaqueToken: string,
  request: {
    operationId: string;
    targetId: string;
    action: 'issue-request' | 'origin' | 'capture';
    mutationRequestSha256: string;
  },
) => Promise<DiscoveryVerifiedIssuedSourceRequest | null>;
export const DiscoveryEvidenceControl = z
  .object({
    ...base,
    kind: z.enum([
      'enrollment',
      'configuration',
      'permission',
      'parser',
      'normalizer',
      'policy',
      'rights',
    ]),
    // Control material is private, removable content, never minimal audit metadata.
    value: DiscoveryId,
    expiresAt: DiscoveryInstant.optional(),
    permission: z
      .object({
        enrollment: RevisionRef,
        configuration: RevisionRef,
        materialScope: DiscoveryMaterialScope,
        fetch: z.boolean(),
        retain: z.boolean(),
        transform: z.boolean(),
      })
      .strict()
      .optional(),
    rights: z
      .object({
        materialScope: DiscoveryMaterialScope,
        retain: z.boolean(),
        transform: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.kind === 'permission') !== (v.permission !== undefined))
      c.addIssue({
        code: 'custom',
        message: 'permission controls require scoped permission only',
      });
    if (
      v.permission?.materialScope.kind === 'source-response' &&
      (JSON.stringify(v.permission.enrollment) !==
        JSON.stringify(v.permission.materialScope.enrollment) ||
        JSON.stringify(v.permission.configuration) !==
          JSON.stringify(v.permission.materialScope.configuration))
    )
      c.addIssue({
        code: 'custom',
        message: 'source permission control binding mismatch',
      });
    if ((v.kind === 'rights') !== (v.rights !== undefined))
      c.addIssue({
        code: 'custom',
        message: 'rights controls require rights only',
      });
  });
export type DiscoveryEvidenceControl = z.infer<typeof DiscoveryEvidenceControl>;
const originBase = z.object({
  ...base,
  retentionRights: z.array(RevisionRef).min(1).max(128),
  members: z.array(DiscoveryId).max(128),
  memberEndpoints: z.record(DiscoveryId, endpoint),
  retired: z.boolean().default(false),
  policy: RevisionRef,
  reason: z.string().min(1).max(2000),
});
export const DiscoveryOrigin = z
  .union([
    originBase
      .extend({
        status: z
          .literal('reviewed-original-work')
          .default('reviewed-original-work'),
        originalWorkId: DiscoveryId,
      })
      .strict(),
    originBase
      .extend({
        status: z.literal('provisional-source-response'),
        originalWorkId: z.null(),
        materialScope: DiscoverySourceResponseMaterialScope,
        issuedRequest: RevisionRef,
        requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  ])
  .superRefine((v, c) => {
    if (new Set(v.members).size !== v.members.length)
      c.addIssue({ code: 'custom', message: 'duplicate member' });
    if (
      (v.retired && v.members.length !== 0) ||
      (!v.retired && v.members.length === 0) ||
      Object.keys(v.memberEndpoints).length !== v.members.length ||
      v.members.some((m) => !Object.hasOwn(v.memberEndpoints, m))
    )
      c.addIssue({
        code: 'custom',
        message: 'invalid active/retired origin membership',
      });
    if (v.status === 'provisional-source-response' && v.members.length !== 1)
      c.addIssue({
        code: 'custom',
        message: 'provisional origin binds one issued response',
      });
  });
export type DiscoveryOrigin = z.infer<typeof DiscoveryOrigin>;
export const DiscoveryRepresentationInput = z
  .object({
    ...base,
    enrollment: RevisionRef,
    configuration: RevisionRef,
    permission: RevisionRef,
    rights: RevisionRef,
    origin: RevisionRef,
    originMemberId: DiscoveryId,
    parser: RevisionRef,
    normalizer: RevisionRef,
    materialScope: DiscoveryMaterialScope,
    issuedRequest: RevisionRef.optional(),
    requestSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    actualEndpoint: endpoint,
    capturedAt: DiscoveryInstant,
    byteKind: z.enum(['captured-body-bytes', 'utf8-reencoded-text']),
    format: z.enum(['text', 'json']),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.materialScope.kind === 'source-response') {
      if (!v.issuedRequest || !v.requestSha256)
        c.addIssue({
          code: 'custom',
          message: 'source response needs issued request binding',
        });
      if (
        JSON.stringify(v.enrollment) !==
          JSON.stringify(v.materialScope.enrollment) ||
        JSON.stringify(v.configuration) !==
          JSON.stringify(v.materialScope.configuration)
      )
        c.addIssue({
          code: 'custom',
          message: 'source capture control binding mismatch',
        });
    } else if (v.issuedRequest !== undefined || v.requestSha256 !== undefined)
      c.addIssue({
        code: 'custom',
        message: 'artifact cannot borrow issued response binding',
      });
  });
export type DiscoveryRepresentationInput = z.infer<
  typeof DiscoveryRepresentationInput
>;
export const DiscoveryEvidenceInput = z
  .object({
    ...base,
    representation: RevisionRef,
    selector: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('text-span'),
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
          quote: z.string().min(1).max(16000),
        })
        .strict(),
      z
        .object({
          kind: z.literal('json-pointer'),
          pointer: z.string().max(2048),
          value: z
            .unknown()
            .refine((v) => v !== undefined, 'JSON value required'),
        })
        .strict(),
    ]),
  })
  .strict();
export type DiscoveryEvidenceInput = z.infer<typeof DiscoveryEvidenceInput>;
export const DiscoveryClaimInput = z
  .object({
    ...base,
    subject: DiscoverySubject,
    subjectRevision: Revision,
    predicate: DiscoveryId,
    value: z.unknown().refine((v) => v !== undefined, 'JSON value required'),
    uncertainty: z.enum(['asserted', 'uncertain', 'disputed']),
    validFrom: DiscoveryInstant.nullable(),
    validUntil: DiscoveryInstant.nullable(),
    evidence: z
      .array(RevisionRef)
      .min(1)
      .max(128)
      .refine(
        (a) => new Set(a.map((r) => `${r.id}:${r.revision}`)).size === a.length,
        'duplicate evidence',
      ),
    policy: RevisionRef,
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.validFrom &&
      v.validUntil &&
      Date.parse(v.validFrom) >= Date.parse(v.validUntil)
    )
      c.addIssue({ code: 'custom', message: 'invalid interval' });
  });
export type DiscoveryClaimInput = z.infer<typeof DiscoveryClaimInput>;
export const DiscoveryDecisionInput = z
  .object({
    ...base,
    claim: RevisionRef,
    decision: z.enum(['accepted', 'held', 'rejected', 'withdrawn']),
    reason: z.string().min(1).max(2000),
    policy: RevisionRef,
    supersedes: RevisionRef.optional(),
    decidedAt: DiscoveryInstant,
  })
  .strict();
export type DiscoveryDecisionInput = z.infer<typeof DiscoveryDecisionInput>;
export type DiscoveryStoredDecision = DiscoveryDecisionInput & {
  authority: z.infer<typeof DecisionAuthority>;
  evidence: RevisionRef[];
};
export const DiscoveryMutationContext = z
  .object({
    schemaVersion: z
      .literal(DISCOVERY_SCHEMA_VERSION)
      .default(DISCOVERY_SCHEMA_VERSION),
    operationId: DiscoveryId,
    expectedRevision: Revision.nullable(),
    capabilityToken: z.string().min(1).max(2048),
    expectedHeads: refs.default([]),
  })
  .strict();
export type DiscoveryMutationContext = z.input<typeof DiscoveryMutationContext>;
export type DiscoveryEvidenceAck = {
  schemaVersion: typeof DISCOVERY_SCHEMA_VERSION;
  committed: true;
  operationId: string;
  kind: DiscoveryEvidenceKind;
  id: string;
  revision: number;
  contentSha256: string;
  tombstoned: boolean;
  usable: boolean;
  expired: boolean;
  quarantined: boolean;
};
export type DiscoveryStoredRevision = {
  schemaVersion: typeof DISCOVERY_SCHEMA_VERSION;
  kind: DiscoveryEvidenceKind;
  id: string;
  revision: number;
  contentSha256: string;
  invalidated: boolean;
  tombstoned: boolean;
  usable: boolean;
  expired: boolean;
  quarantined: boolean;
  content: unknown | null;
};
export type DiscoveryCapabilityAction =
  | 'issue-request'
  | 'control'
  | 'origin'
  | 'capture'
  | 'evidence'
  | 'claim'
  | 'decision'
  | 'private-note'
  | 'refresh-failure'
  | 'revoke';
// Implemented by a trusted server integration. Fixture resolvers do not authenticate
// real reviewers. Never populate this receipt from an HTTP body or model output.
export type DiscoveryVerifiedCapability = {
  receiptId: string;
  principalId: string;
  authenticationContextId: string;
  minimalAuditRetention: 'allow';
  action: DiscoveryCapabilityAction;
  targetId: string;
  operationId: string;
  requestSha256: string;
  expiresAt: string;
};
export type DiscoveryCapabilityResolver = (
  opaqueToken: string,
  request: {
    action: DiscoveryCapabilityAction;
    targetId: string;
    operationId: string;
    requestSha256: string;
  },
) => Promise<DiscoveryVerifiedCapability>;
export const DISCOVERY_NORMALIZER_VERSION = 'utf8-nfc-lf-v1';
export const DISCOVERY_PARSER_VERSION = 'text-or-json-v1';

export const DISCOVERY_EVIDENCE_READ_LIMITS = {
  maxAncestors: 512,
  maxAncestorContentBytes: 4194304,
} as const;
