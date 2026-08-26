import { z } from "zod";
import type { ContentItem } from "../content/schema";
import registryDoc from "../../fixtures/product-watch.json";

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
