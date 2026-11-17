import { DiscoveryForumEditInput, DiscoveryMutationContext } from '../../content/discovery-evidence';
import {canonicalDiscoveryEvidenceJson} from '../discovery-evidence-store';
import type { createDiscoveryEvidenceStore } from '../discovery-evidence-store';
/** Private removal-only consumer. Trusted store wiring supplies exact retained
 * native bindings and independent request-bound invalidation authority.
 * No admission, retention erasure, source acquisition or public projection. */
export function createDiscoveryForumCurrentnessConsumer(store: ReturnType<typeof createDiscoveryEvidenceStore>) {
  return { async consumeEdit(context: DiscoveryMutationContext, input: DiscoveryForumEditInput) {
    const ctx = DiscoveryMutationContext.parse(JSON.parse(canonicalDiscoveryEvidenceJson(context))), value = DiscoveryForumEditInput.parse(JSON.parse(canonicalDiscoveryEvidenceJson(input)));
    return store.invalidateSourceSupport(ctx, value);
  } };
}
