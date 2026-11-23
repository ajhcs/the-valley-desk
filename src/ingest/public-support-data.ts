import supportJson from "../content/support.json";

export const supportPath = "/support";

export type SupporterKind = "person" | "institution";
/** founder: one gift, listed for good. year: listed for twelve months from the gift. in-kind: a collaborating organization. */
export type SupportTier = "founder" | "year" | "in-kind";
export type Supporter = {
  /** The name shown, exactly as the giver asked: theirs, their institution's, or the person the gift honors. */
  name: string;
  kind?: SupporterKind;
  tier: SupportTier;
  /** Date of the gift (YYYY-MM-DD). A 12-month listing ends a year after it. */
  since: string;
  /** Optional HTTPS link for the name. */
  url?: string;
  /** For a gift in someone else's name: who gave it, if they want to be shown. */
  givenBy?: string;
};
type Offer = "personYear" | "personFounder" | "institutionYear" | "institutionFounder";
export type SupportData = {
  checkout: Record<Offer, string | null>;
  prices: Record<Offer, number>;
  inKindEmail: string;
  supporters: Supporter[];
  unnamed: number;
};

export const supportData = supportJson as SupportData;

/** Only hosted HTTPS pages: checkout never touches this site, and names never link anywhere unsafe. */
export function httpsUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
export const checkoutUrl = httpsUrl;

/** The page, the footer band, the footer link and the sitemap entry exist only once a checkout link is set. */
export function supportOpen(data: SupportData = supportData) {
  return Object.values(data.checkout).some((link) => Boolean(httpsUrl(link)));
}

/** Founders and in-kind partners stay listed; a 12-month gift is listed until its anniversary. */
export function isListed(s: Supporter, now: Date) {
  if (!s.name.trim()) return false;
  if (s.tier !== "year") return true;
  const since = new Date(`${s.since}T00:00:00Z`);
  if (!Number.isFinite(since.valueOf())) return false;
  const until = new Date(since);
  until.setUTCFullYear(until.getUTCFullYear() + 1);
  return now < until;
}

const sortKey = (s: Supporter) => {
  const name = s.name.trim();
  return s.kind === "institution" ? name.replace(/^the\s+/i, "") : name.split(/\s+/).reverse().join(" ");
};

/** People by surname and institutions by name, sorted together, grouped by tier. */
export function listedSupporters(data: SupportData = supportData, now = new Date()) {
  const listed = data.supporters.filter((s) => isListed(s, now))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b), "en-US", { sensitivity: "base" }));
  return {
    founders: listed.filter((s) => s.tier === "founder"),
    supporters: listed.filter((s) => s.tier === "year"),
    partners: listed.filter((s) => s.tier === "in-kind"),
  };
}
