import { z } from 'zod';
import { DiscoveryCollectionLead } from './collection-contract';
import { DirectoryIdSchema, DirectoryHashSchema, DirectoryTextSchema, DirectoryUrlSchema, DirectoryDaySchema } from '../../content/discovery-directory';

// Private staging: this literal never grants publication or triggers a fetch.
const FrontierSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('collection-lead'), provider: DirectoryTextSchema.max(100), sourceId: DirectoryIdSchema, scopeId: DirectoryIdSchema, pageReceiptId: DirectoryIdSchema, requestSha256: DirectoryHashSchema, representationSha256: DirectoryHashSchema, leadIndex: z.number().int().min(0).max(99), lead: DiscoveryCollectionLead }).strict(),
  z.object({ kind: z.literal('manual-lead'), sourceUrl: DirectoryUrlSchema, observedDate: DirectoryDaySchema, observationSha256: DirectoryHashSchema }).strict(),
]);
export const DirectoryPrivateFrontierSchema = z.object({
  schemaVersion: z.literal('discovery-directory-private-frontier-v1'), id: DirectoryIdSchema, revision: z.number().int().safe().positive(), source: FrontierSource,
  disposition: z.enum(['pending', 'needs-evidence', 'duplicate', 'ineligible', 'ready-for-reviewed-projection']),
  duplicateOf: DirectoryIdSchema.nullable(), reason: DirectoryTextSchema.max(400).nullable(), publicationAuthorized: z.literal(false),
}).strict().superRefine((value, ctx) => {
  if (['needs-evidence', 'duplicate', 'ineligible'].includes(value.disposition) && value.reason === null) ctx.addIssue({ code: 'custom', message: 'disposition reason required' });
  if ((value.disposition === 'duplicate') !== (value.duplicateOf !== null) || value.duplicateOf === value.id) ctx.addIssue({ code: 'custom', message: 'invalid duplicate reference' });
});
export type DirectoryPrivateFrontier = z.infer<typeof DirectoryPrivateFrontierSchema>;
