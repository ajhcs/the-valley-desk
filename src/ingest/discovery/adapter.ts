import { z } from 'zod';
import {
  DISCOVERY_PROVIDERS,
  type DiscoverySubject,
} from '../../content/discovery-schema';
import type { DiscoverySourceRequest } from './source-contract';
import { DiscoveryRuntimeError } from './runtime-contract';
import { DiscoverySourceRequest as RequestSchema } from './source-contract';
import { canonicalDiscoveryEvidenceJson as canonical } from '../discovery-evidence-store';

const label = z.string().min(1).max(512);
const github = z
  .object({
    repositoryId: z.number().int().positive().safe(),
    title: label,
    commitVersion: label,
    accountId: label,
  })
  .strict();
const pubmed = z
  .object({ pmid: label, title: label, authorLabels: z.array(label).max(30) })
  .strict();
const crossref = z
  .object({
    doi: label,
    title: label,
    institutionalAuthor: label,
    unresolvedPeople: z.array(label).max(30),
  })
  .strict();
const arxiv = z
  .object({
    baseId: label,
    title: label,
    version: z.number().int().positive().max(1000),
  })
  .strict();
const forum = z
  .object({ threadId: label, title: label, accountId: label })
  .strict();
const institutional = z
  .object({
    creatorId: label,
    creatorKind: z.enum(['person', 'organization']),
    displayName: label,
  })
  .strict();
const rowSchemas = { github, pubmed, crossref, arxiv, forum, institutional };
export type DiscoverySyntheticProvider = (typeof DISCOVERY_PROVIDERS)[number];
export type DiscoveryAdapterLead = {
  nativeId: string;
  kind: DiscoverySubject['kind'];
  displayName: string;
  sourceVersion?: string;
  relatedAccounts: string[];
  unresolvedPeople: string[];
  publicationAuthorized: false;
  institutionalAuthor?: string;
};
export type DiscoveryAdapterResult = {
  leads: DiscoveryAdapterLead[];
  rejectedCount: number;
  terminal: boolean;
  truncated: boolean;
  health: 'healthy' | 'healthy-empty' | 'partial';
  completeness: 'complete' | 'partial';
  nextCheckpoint: string | null;
  provenanceReferences: { id: string; revision: number }[];
};
export type DiscoveryRetainedAdapterInput = {
  id: string;
  revision: number;
  bytes: Uint8Array;
  representationSha256: string;
};
export interface DiscoverySyntheticAdapter {
  readonly provider: DiscoverySyntheticProvider;
  readonly synthetic: true;
  plan(
    scope: { sourceId: string; parameters: Record<string, string> },
    checkpoint: string | null,
    budget: { remainingItems: number },
  ): {
    sourceId: string;
    parameters: Record<string, string>;
    checkpoint: string | null;
  };
  parse(
    retained: DiscoveryRetainedAdapterInput,
    request: DiscoverySourceRequest,
    budget?: { remainingItems: number },
  ): Promise<DiscoveryAdapterResult>;
  nextPage(receiptId: string): Promise<string | null>;
}
export type DiscoveryTrustedAdapterRepresentation =
  DiscoveryRetainedAdapterInput & {
    request: DiscoverySourceRequest;
    remainingItems: number;
  };
export type DiscoveryTrustedAdapterReceipt = {
  receiptId: string;
  request: DiscoverySourceRequest;
  result: DiscoveryAdapterResult;
};
export type DiscoveryAdapterResolvers = {
  resolveRepresentation: (ref: {
    id: string;
    revision: number;
  }) => Promise<DiscoveryTrustedAdapterRepresentation | null>;
  resolveReceipt: (
    receiptId: string,
  ) => Promise<DiscoveryTrustedAdapterReceipt | null>;
};

function leads(
  provider: DiscoverySyntheticProvider,
  raw: unknown[],
): DiscoveryAdapterLead[] {
  return raw.map((value) => {
    const base = {
      relatedAccounts: [] as string[],
      unresolvedPeople: [] as string[],
      publicationAuthorized: false as const,
    };
    switch (provider) {
      case 'github': {
        const v = github.parse(value);
        return {
          ...base,
          nativeId: String(v.repositoryId),
          kind: 'artifact',
          displayName: v.title,
          sourceVersion: v.commitVersion,
          relatedAccounts: [v.accountId],
        };
      }
      case 'pubmed': {
        const v = pubmed.parse(value);
        return {
          ...base,
          nativeId: v.pmid,
          kind: 'artifact',
          displayName: v.title,
          unresolvedPeople: v.authorLabels,
        };
      }
      case 'crossref': {
        const v = crossref.parse(value);
        return {
          ...base,
          nativeId: v.doi,
          kind: 'artifact',
          displayName: v.title,
          institutionalAuthor: v.institutionalAuthor,
          unresolvedPeople: v.unresolvedPeople,
        };
      }
      case 'arxiv': {
        const v = arxiv.parse(value);
        return {
          ...base,
          nativeId: v.baseId,
          kind: 'artifact',
          displayName: v.title,
          sourceVersion: `v${v.version}`,
        };
      }
      case 'forum': {
        const v = forum.parse(value);
        return {
          ...base,
          nativeId: v.threadId,
          kind: 'artifact',
          displayName: v.title,
          relatedAccounts: [v.accountId],
        };
      }
      case 'institutional': {
        const v = institutional.parse(value);
        return {
          ...base,
          nativeId: v.creatorId,
          kind: v.creatorKind,
          displayName: v.displayName,
        };
      }
    }
  });
}
export function parseSyntheticDiscoveryResponse(
  provider: DiscoverySyntheticProvider,
  body: unknown,
): {
  leads: DiscoveryAdapterLead[];
  nextCheckpoint: string | null;
  terminal: boolean;
} {
  const schema = z
    .object({
      provider: z.literal(provider),
      records: z.array(rowSchemas[provider]).max(100),
      nextCheckpoint: z.string().min(1).max(512).nullable(),
      terminal: z.boolean(),
    })
    .strict();
  const parsed = schema.parse(body);
  if (parsed.terminal !== (parsed.nextCheckpoint === null))
    throw new DiscoveryRuntimeError(
      'parser-failed',
      'discovery-adapter-terminal-mismatch',
    );
  return {
    leads: leads(provider, parsed.records),
    nextCheckpoint: parsed.nextCheckpoint,
    terminal: parsed.terminal,
  };
}
async function digest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
function registration(
  provider: DiscoverySyntheticProvider,
  resolvers: DiscoveryAdapterResolvers,
): DiscoverySyntheticAdapter {
  return {
    provider,
    synthetic: true,
    plan(scope, checkpoint, budget) {
      if (
        !Number.isSafeInteger(budget.remainingItems) ||
        budget.remainingItems < 1
      )
        throw new DiscoveryRuntimeError(
          'budget-exhausted',
          'discovery-adapter-item-budget',
        );
      return {
        sourceId: scope.sourceId,
        parameters: { ...scope.parameters },
        checkpoint,
      };
    },
    async parse(retained, request, budget) {
      const supplied = { ...retained, bytes: new Uint8Array(retained.bytes) };
      const binding = RequestSchema.parse(JSON.parse(canonical(request)));
      const remaining = budget?.remainingItems;
      if (binding.provider !== provider || supplied.bytes.byteLength > 48000)
        throw new DiscoveryRuntimeError(
          'parser-failed',
          'discovery-adapter-binding',
        );
      try {
        const resolved = await resolvers.resolveRepresentation({
          id: supplied.id,
          revision: supplied.revision,
        });
        if (!resolved) throw new Error('unretained');
        const trusted = {
          ...resolved,
          bytes: new Uint8Array(resolved.bytes),
          request: RequestSchema.parse(JSON.parse(canonical(resolved.request))),
        };
        const bodySha = await digest(trusted.bytes);
        if (
          trusted.id !== supplied.id ||
          trusted.revision !== supplied.revision ||
          bodySha !== trusted.representationSha256 ||
          bodySha !== supplied.representationSha256 ||
          (await digest(supplied.bytes)) !== bodySha ||
          canonical(binding) !== canonical(trusted.request)
        )
          throw new Error('binding');
        if (
          !Number.isSafeInteger(trusted.remainingItems) ||
          trusted.remainingItems < 0 ||
          (remaining !== undefined &&
            (!Number.isSafeInteger(remaining) || remaining < 0))
        )
          throw new Error('budget');
        const cap = Math.min(
          trusted.remainingItems,
          remaining ?? trusted.remainingItems,
        );
        const parsed = parseSyntheticDiscoveryResponse(
          provider,
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(trusted.bytes),
          ),
        );
        const rejectedCount = Math.max(0, parsed.leads.length - cap),
          truncated = rejectedCount > 0;
        return {
          ...parsed,
          leads: parsed.leads.slice(0, cap),
          rejectedCount,
          truncated,
          terminal: parsed.terminal && !truncated,
          health:
            parsed.terminal && !truncated
              ? parsed.leads.length
                ? 'healthy'
                : 'healthy-empty'
              : 'partial',
          completeness: parsed.terminal && !truncated ? 'complete' : 'partial',
          provenanceReferences: [
            { id: trusted.id, revision: trusted.revision },
          ],
        };
      } catch {
        throw new DiscoveryRuntimeError(
          'parser-failed',
          'discovery-adapter-invalid-representation',
        );
      }
    },
    async nextPage(receiptId) {
      if (typeof receiptId !== 'string' || !receiptId)
        throw new DiscoveryRuntimeError(
          'unavailable',
          'discovery-adapter-uncommitted-page',
        );
      const receipt = await resolvers.resolveReceipt(receiptId);
      if (
        !receipt ||
        receipt.receiptId !== receiptId ||
        receipt.request.provider !== provider ||
        receipt.result.truncated ||
        receipt.result.rejectedCount
      )
        throw new DiscoveryRuntimeError(
          'unavailable',
          'discovery-adapter-uncommitted-page',
        );
      return receipt.result.nextCheckpoint;
    },
  };
}
export function createSyntheticDiscoveryAdapters(
  resolvers: DiscoveryAdapterResolvers,
): Readonly<Record<DiscoverySyntheticProvider, DiscoverySyntheticAdapter>> {
  return {
    github: registration('github', resolvers),
    pubmed: registration('pubmed', resolvers),
    crossref: registration('crossref', resolvers),
    arxiv: registration('arxiv', resolvers),
    forum: registration('forum', resolvers),
    institutional: registration('institutional', resolvers),
  };
}
export const SYNTHETIC_DISCOVERY_ADAPTERS = createSyntheticDiscoveryAdapters({
  resolveRepresentation: async () => null,
  resolveReceipt: async () => null,
});
