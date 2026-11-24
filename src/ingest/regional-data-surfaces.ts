import { regionalDataPath, type RegionalData } from "./regional-data-contract";

/** Append only after the public regional-data availability gate has passed. */
export function regionalDataLlms(origin: string): string {
  return `\n- [Regional data](${origin}/discover/datasets?kind=regional-data): public data resources with geographic coverage, access, formats and usage guidance. Search and new listings accept kind=regional-data. JSON: ${origin}/api/directory/regional-data and ${origin}/api/directory/regional-data/{percent-encoded ID}. Resource pages: /discover/regional-data/{percent-encoded ID}.\n`;
}

/** Structured data mirrors the public record, including its source and use guidance. */
export function regionalDataSchema(d: RegionalData & { papers?: { id: string; title: string }[] }, origin: string) {
  const extra = (name: string, value: unknown) => ({ "@type": "PropertyValue", name, value });
  return {
    "@type": "Dataset", "@id": origin + regionalDataPath(d.id) + "#dataset",
    identifier: d.id, name: d.title, description: d.summary,
    url: origin + regionalDataPath(d.id), sameAs: d.url,
    publisher: { "@type": "Organization", name: d.publisher },
    includedInDataCatalog: { "@type": "DataCatalog", name: d.portal },
    keywords: [d.topic], spatialCoverage: d.counties.map((name) => ({ "@type": "Place", name })),
    ...(d.time_span ? { temporalCoverage: d.time_span } : {}),
    ...(d.license ? { license: d.license } : {}),
    ...(d.access === "open" ? { isAccessibleForFree: true } : { conditionsOfAccess: d.access }),
    dateCreated: d.added,
    ...(d.api ? { distribution: [{ "@type": "DataDownload", contentUrl: d.api.url, encodingFormat: d.api.type }] } : {}),
    ...(d.papers?.length ? { citation: d.papers.map((p) => origin + "/discover/publication/" + encodeURIComponent(p.id)) } : {}),
    additionalProperty: [extra("formats", d.formats), extra("granularity", d.granularity), extra("update cadence", d.update_cadence), extra("source checked", d.checked), extra("how to use", d.how_to_use.step), extra("guidance URL", d.how_to_use.url), extra("caveats", d.how_to_use.caveats), extra("citation guidance", d.how_to_use.citation)].filter((p) => p.value !== null),
  };
}
