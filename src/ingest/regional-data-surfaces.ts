import { counties } from "./public-directory-data";
import { regionalDataPath, type RegionalData } from "./regional-data-contract";

/** Append only after the public regional-data availability gate has passed. */
export function regionalDataLlms(origin: string, records: readonly Pick<RegionalData, "id" | "title">[] = []): string {
  const links = records.map(({ id, title }) => {
    const label = title.replace(/\s+/g, " ").replace(/[\\[\]]/g, "\\$&");
    return `- [${label}](${origin + regionalDataPath(id)})`;
  });
  const entry = `\n- [Regional data](${origin}/discover/datasets?kind=regional-data): public data resources with geographic coverage, access, formats and usage guidance. Search and new listings accept kind=regional-data. JSON: ${origin}/api/directory/regional-data and ${origin}/api/directory/regional-data/{percent-encoded ID}. Resource pages: /discover/regional-data/{percent-encoded ID}.\n`;
  return links.length ? entry + "\n## Regional datasets\n\n" + links.join("\n") + "\n" : entry;
}

/** Structured data mirrors the public record, including its source and use guidance. */
export function regionalDataSchema(d: RegionalData & { metadata_reviewed?: string; papers?: { id: string; title: string }[] }, origin: string) {
  const extra = (name: string, value: unknown) => ({ "@type": "PropertyValue", name, value });
  return {
    "@type": "Dataset", "@id": origin + regionalDataPath(d.id) + "#dataset",
    identifier: d.id, name: d.title, description: d.summary,
    url: origin + regionalDataPath(d.id), sameAs: d.url,
    publisher: { "@type": "Organization", name: d.publisher },
    includedInDataCatalog: { "@type": "DataCatalog", name: d.portal },
    keywords: [d.topic], spatialCoverage: d.counties.map((name) => ({ "@type": "Place", name, ...(counties.find((county) => county.name === name)?.state ? { address: { "@type": "PostalAddress", addressRegion: counties.find((county) => county.name === name)!.state, addressCountry: "US" } } : {}) })),
    ...(d.time_span ? { temporalCoverage: d.time_span } : {}),
    ...(d.license ? { license: d.license } : {}),
    ...(d.access === "open" ? { isAccessibleForFree: true } : { conditionsOfAccess: d.access }),
    ...(d.api ? { distribution: [{ "@type": "DataDownload", contentUrl: d.api.url, name: d.api.type }] } : {}),
    ...(d.papers?.length ? { citation: d.papers.map((p) => origin + "/discover/publication/" + encodeURIComponent(p.id)) } : {}),
    additionalProperty: [extra("directory added", d.added), extra("formats", d.formats), extra("granularity", d.granularity), extra("update cadence", d.update_cadence), extra("source availability checked", d.checked), extra("metadata reviewed", d.metadata_reviewed ?? d.checked), extra("how to use", d.how_to_use.step), extra("guidance URL", d.how_to_use.url), extra("caveats", d.how_to_use.caveats), extra("citation guidance", d.how_to_use.citation)].filter((p) => p.value !== null),
  };
}
