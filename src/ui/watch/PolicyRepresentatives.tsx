import type { PublicPolicyDossier } from "../../content/watch-schema";
import { policyRepresentativeScopes } from "../../content/representative-sources";
import { RepresentativeLookup } from "./RepresentativeLookup";

export function PolicyRepresentatives({ identity }: { identity: PublicPolicyDossier["identity"]["value"] }) {
  const scopes = policyRepresentativeScopes(identity);
  if (!scopes.length) return <section className="WatchSection"><h2>Chamber representatives</h2>
    <p>No representative association is established for this source body.</p></section>;
  return <div className="WatchSection"><RepresentativeLookup
    key={`${identity.jurisdiction}:${identity.bodyId}`} scopes={scopes} initialBodyId={identity.bodyId}
    requireScopeSelection={scopes.length > 1} heading="Chamber representatives"
    context="Membership in the originating chamber does not establish bill sponsorship or that a member represents your address." />
  </div>;
}
