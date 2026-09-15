import { HOUSE_ROSTER_URL } from "./house-representative-collection";
import { SENATE_ROSTER_URL, persistHouseRosterObservation, persistSenateRosterObservation } from "./representative-collection";
import { prepareHouseRosterCaptures, prepareSenateRosterCaptures, stageRepresentativeRosterCapture } from "./representative-roster-drafts";
import type { D1DatabaseLike } from "./persistence";
import { WatchId, canonicalJson } from "../content/watch-schema";

/** Retain complete official bytes before staging review drafts. Source enrollment
 * and authenticated acceptance remain separate; intake never advances public heads. */
export async function stageFederalRosterXml(db: D1DatabaseLike, input: {
  sourceId: string; sourceUrl: string; xml: string; observedAt: string;
}, now = new Date()) {
  WatchId.parse(input.sourceId);
  if (![HOUSE_ROSTER_URL, SENATE_ROSTER_URL].includes(input.sourceUrl)) throw Error("representative-endpoint-unsupported");
  const house = input.sourceUrl === HOUSE_ROSTER_URL;
  const retained = await (house ? persistHouseRosterObservation : persistSenateRosterObservation)(db, input.xml, input.observedAt);
  const captures = await (house ? prepareHouseRosterCaptures : prepareSenateRosterCaptures)(input.xml, input.sourceId, input.observedAt);
  const drafts = [];
  for (const capture of captures) {
    const scopeKey = canonicalJson({ jurisdiction: "federal", jurisdictionId: capture.jurisdictionId, bodyId: capture.bodyId });
    const head = await db.prepare("SELECT revision FROM representative_heads WHERE scope_key=?").bind(scopeKey).first<{ revision: number }>();
    drafts.push(await stageRepresentativeRosterCapture(db, capture, head?.revision ?? 0, now));
  }
  return { observationId: retained.id, drafts };
}
