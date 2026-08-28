import { z } from "zod";
import type { ContentItem } from "../content/schema";
import registryDoc from "../../fixtures/product-watch.json";
import { coveragePack } from "./coverage-pack";

const ProductUse = z.object({
  id: z.string(),
  vendor: z.string(),
  product: z.string(),
  aliases: z.array(z.string()).min(1),
  orgIds: z.array(z.string()).min(1),
  evidenceUrl: z.string().url(),
  evidenceType: z.enum(["official-newsroom", "official-product-page", "repository", "peer-reviewed"]),
  lastVerifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confidence: z.number().min(0).max(1),
});

const ProductWatchRegistry = z.object({
  asOf: z.string(),
  notes: z.array(z.string()),
  products: z.array(ProductUse),
});

export type ProductUse = z.infer<typeof ProductUse>;
export const productWatchRegistry = ProductWatchRegistry.parse(registryDoc);

export type OfficialProductSourceLike = {
  category: string;
  productIds?: readonly string[];
  institutionId?: string;
};

export type OfficialProductCandidateLike = OfficialProductSourceLike & {
  title: string;
  body?: string;
  dek?: string;
  detailText?: string;
};

function normalized(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function itemText(item: ContentItem) {
  return normalized([item.title, item.dek, item.body, ...item.topics].join(" "));
}

function hasAlias(haystack: string, alias: string) {
  const needle = normalized(alias);
  return needle.length > 0 && (` ${haystack} `).includes(` ${needle} `);
}

function institutionOrgIds(institutionId?: string) {
  if (!institutionId) return [] as string[];
  const institution = coveragePack.institutions.find((row) => row.id === institutionId);
  return institution?.covered ? institution.orgIds : [];
}

function coveredOrgIds() {
  return new Set(
    coveragePack.institutions
      .filter((institution) => institution.covered)
      .flatMap((institution) => institution.orgIds),
  );
}

export function productUsesById(productIds: readonly string[] | undefined) {
  const ids = new Set(productIds ?? []);
  return productWatchRegistry.products.filter((product) => ids.has(product.id));
}

/**
 * Product sources are configured against already verified local-use rows. A
 * source may be a vendor-wide channel, so the institution relationship is
 * carried by each ProductUse rather than inferred from the vendor hostname.
 */
export function verifiedProductUsesForOfficialSource(source: OfficialProductSourceLike) {
  if (source.category !== "product") return [] as ProductUse[];
  const configured = productUsesById(source.productIds);
  const covered = coveredOrgIds();
  const orgIds = new Set(institutionOrgIds(source.institutionId));
  return configured.filter((product) => (
    product.orgIds.some((orgId) => covered.has(orgId))
    && (!source.institutionId || product.orgIds.some((orgId) => orgIds.has(orgId)))
  ));
}

/** Match an official candidate's text to a known product and (when present) a known institution. */
export function matchingProductUsesInText(
  text: string,
  options: { productIds?: readonly string[]; orgIds?: readonly string[] } = {},
) {
  const haystack = normalized(text);
  const allowedProducts = options.productIds ? productUsesById(options.productIds) : productWatchRegistry.products;
  const itemOrgs = new Set(options.orgIds ?? []);
  return allowedProducts.filter((product) => {
    if (!product.aliases.some((alias) => hasAlias(haystack, alias))) return false;
    return itemOrgs.size === 0 || product.orgIds.some((orgId) => itemOrgs.has(orgId));
  });
}

/**
 * Specialized source relationship gate. Product/vendor candidates need a
 * configured ProductUse. Procurement candidates additionally need an exact
 * covered institution and a product named by the discovered listing; a
 * generic supplier or RFP page cannot pass merely because it is first-party.
 */
export function verifiedProductRelationshipForOfficialCandidate(candidate: OfficialProductCandidateLike) {
  if (candidate.category === "product") {
    return verifiedProductUsesForOfficialSource(candidate);
  }
  if (candidate.category !== "procurement" || !candidate.institutionId) {
    return [] as ProductUse[];
  }
  return matchingProductUsesInText(
    [candidate.title, candidate.dek ?? "", candidate.body ?? "", candidate.detailText ?? ""].join("\n"),
    {
      productIds: candidate.productIds,
      orgIds: institutionOrgIds(candidate.institutionId),
    },
  );
}

/** Product mentions admitted to review only when the registry proves local use. */
export function matchingProductUses(item: ContentItem): ProductUse[] {
  const haystack = itemText(item);
  const itemOrgs = new Set(item.orgs);
  return productWatchRegistry.products.filter((row) => {
    const productMentioned = row.aliases.some((alias) => hasAlias(haystack, alias));
    if (!productMentioned) return false;
    return row.orgIds.some((orgId) => itemOrgs.has(orgId));
  });
}

export function isProductWatchCandidate(item: ContentItem) {
  return matchingProductUses(item).length > 0;
}
