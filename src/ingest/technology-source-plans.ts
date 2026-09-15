import { githubRepositoryKey, sha256 } from "../content/watch-schema";
import { buildTechnologyDossierDraft, type TechnologyDossierInput } from "./technology-dossiers";
import { deliveryEasternDay } from "../content/watch-delivery";

export const technologyRegionalSources = {
  chop: { url: "https://www.chop.edu/philadelphia-campus/driving-directions",
    quote: "3401 Civic Center Blvd., Philadelphia, PA 19104" },
  "penn-medicine": { url: "https://www.upenn.edu/about/contact", quote: "Philadelphia, PA 19104" },
} as const;

export const technologySourcePlans = [
  { numericId: "1308325438", fullName: "Stephonomon/orca-cds", branch: "main", readme: "README.md", license: "LICENSE.md",
    readmeSha256: "328b988a64f25777e17718f73f97371a040b821992cc59d693ee8cbd6d79fb6e",
    licenseSha256: "5470b7d5b1aed9de70596043a23b00c4340f7e039c21bb8f6e38546c8c74049c",
    slug: "chop-orca", title: "ORCA-CDS", entityId: "chop", entityName: "Children's Hospital of Philadelphia",
    relationshipType: "created-by", quote: "It was developed and evaluated at Children's Hospital of Philadelphia (CHOP)",
    purpose: "Offline-capable viewer for Epic order sets during EHR and network downtime.",
    steps: ["Adjust the SQL extract.", "Run and schedule the pipeline.", "Configure and deploy the app."],
    limitations: ["Cannot place orders or provide live decision support.", "Research software; clinical use requires separate authorization under the license."],
    classification: "restricted-source", conditions: ["Academic/nonprofit internal non-commercial research and education only.", "Commercial use and transfer require separate permission.", "Clinical use is not granted by the public research license."],
  },
  { numericId: "128938343", fullName: "CBICA/CaPTk", branch: "master", readme: "Readme.md", license: "LICENSE",
    readmeSha256: "2416c23316704d10b8fbab4692972ebea52111dd971b8e9652a7c1da001c54b6",
    licenseSha256: "d083663de73485c6b0b8a014a2cd530d25f89ad4e54d0a3414c2e8d6ab931ba4",
    slug: "penn-captk", title: "Cancer Imaging Phenomics Toolkit", entityId: "penn-medicine", entityName: "University of Pennsylvania",
    relationshipType: "maintained-by", quote: "at the University of Pennsylvania.",
    purpose: "Cancer-image analysis and predictive modeling, with brain, breast and lung imaging applications.",
    steps: ["Consult the linked application and functionality guides."],
    limitations: ["Research use only; not reviewed or approved for clinical use by the FDA or other federal/state agencies."],
    classification: "unknown", conditions: ["Custom CBICA terms and multiple dependency licenses.", "PHI Estimator is separately non-commercial; do not label the whole distribution OSI open source."],
  },
  { numericId: "358689512", fullName: "d3b-center/OpenPedCan-analysis", branch: "dev", readme: "README.md", license: "LICENSE.md",
    readmeSha256: "6ed648555824c90de79d5898103be855f300534c405dd326144e6104da493663",
    licenseSha256: "8067620f3ea6c48329c77af92ecc9992af92691fd9323d904dca67848df14ea4",
    slug: "chop-openpedcan", title: "Open Pediatric Cancer analysis", entityId: "chop", entityName: "Children's Hospital of Philadelphia",
    relationshipType: "research-affiliation", quote: "Children’s Hospital of Philadelphia Division of Neurosurgery",
    purpose: "Harmonizes pediatric cancer data and performs downstream cancer analyses.",
    steps: ["Review the data-format documentation, data-release notes, and analysis documentation."],
    limitations: ["Citations must identify the data release used."],
    classification: "unknown", conditions: ["Repository license contains CC0 and BSD 3-Clause sections; confirm scope for the specific artifact.", "Data and weights licensing is not inferred from code licensing."],
  },
] as const;

export type TechnologyCapture = { url: string; checkedAt: string; body: string };
export async function prepareTechnologySourceDraft(plan: typeof technologySourcePlans[number],
  capture: { repository: TechnologyCapture; commit: TechnologyCapture; readme: TechnologyCapture;
    license: TechnologyCapture; releases: TechnologyCapture; regional?: TechnologyCapture }) {
  const repository = JSON.parse(capture.repository.body);
  const commit = JSON.parse(capture.commit.body);
  if (String(repository.id) !== plan.numericId || repository.full_name !== plan.fullName || repository.private !== false ||
      !/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error("technology-repository-identity-conflict");
  const expectedBase = "https://raw.githubusercontent.com/" + plan.fullName + "/" + commit.sha + "/";
  if (capture.repository.url !== "https://api.github.com/repos/" + plan.fullName ||
      capture.commit.url !== "https://api.github.com/repos/" + plan.fullName + "/commits/" + plan.branch ||
      capture.readme.url !== expectedBase + plan.readme || capture.license.url !== expectedBase + plan.license ||
      capture.releases.url !== "https://api.github.com/repos/" + plan.fullName + "/releases?per_page=10") {
    throw new Error("technology-capture-source-conflict");
  }
  if (!capture.readme.body.includes(plan.quote)) throw new Error("technology-local-evidence-changed");
  if (await sha256(capture.readme.body) !== plan.readmeSha256 || await sha256(capture.license.body) !== plan.licenseSha256) {
    throw new Error("technology-reviewed-source-changed");
  }
  const subjectId = await githubRepositoryKey(plan.numericId), artifactId = subjectId + ":repository";
  // SQL head ordering and object insertion order cannot change dossier identity.
  const entries = Object.entries({ repository: capture.repository, commit: capture.commit,
    readme: capture.readme, license: capture.license, releases: capture.releases,
    ...(capture.regional ? { regional: capture.regional } : {}) });
  const checkedAt = entries.map(([, item]) => item.checkedAt).sort().at(-1)!;
  if (capture.regional && (capture.regional.url !== technologyRegionalSources[plan.entityId].url ||
      !capture.regional.body.includes(technologyRegionalSources[plan.entityId].quote)))
    throw new Error("technology-regional-source-conflict");
  const evidence = await Promise.all(entries.map(async ([id, item]) => ({
    id: "tech-" + plan.numericId + "-" + id, url: item.url, checkedAt: item.checkedAt,
    representationSha256: await sha256(item.body),
    quote: id === "readme" ? plan.quote : id === "license" ? item.body.slice(0, 200) : item.body.slice(0, Math.min(200, item.body.length)),
    retainedText: id === "readme" ? plan.quote : item.body.slice(0, 200),
  })));
  // A successful empty releases response is retained but cannot supply a fact span.
  const usableEvidence = evidence.filter(item => item.quote.length >= 3);
  const readmeIds = ["tech-" + plan.numericId + "-readme"];
  const cite = async (name: string, source: TechnologyCapture, quote: string) => {
    if (!source.body.includes(quote) || quote.length < 3 || quote.length > 2000)
      throw new Error("technology-field-evidence-changed:" + name);
    const id = "tech-" + plan.numericId + "-field-" + name;
    usableEvidence.push({ id, url: source.url, checkedAt: source.checkedAt,
      representationSha256: await sha256(source.body), quote, retainedText: quote });
    return id;
  };
  const paragraph = (source: TechnologyCapture, starts: string) => {
    const start = source.body.indexOf(starts);
    if (start < 0) throw new Error("technology-field-evidence-changed:" + starts);
    const end = source.body.indexOf("\n\n", start);
    return source.body.slice(start, end < 0 ? undefined : end);
  };
  const jsonField = (source: TechnologyCapture, key: string, value: unknown) => {
    const literal = JSON.stringify(value);
    const pattern = new RegExp(JSON.stringify(key) + "\\s*:\\s*" + literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=\\s*[,}\\]])");
    const match = pattern.exec(source.body);
    if (!match) throw new Error("technology-field-evidence-changed:" + key);
    return match[0];
  };
  const titleIds = [await cite("title", capture.readme, capture.readme.body.split("\n").find(line => line.startsWith("# "))!)];
  const repositoryIds = await Promise.all([
    ["repository-name", jsonField(capture.repository, "full_name", repository.full_name)],
    ["repository-id", jsonField(capture.repository, "id", repository.id)],
    ["repository-public", jsonField(capture.repository, "private", false)],
  ].map(([name, quote]) => cite(name!, capture.repository, quote!)));
  repositoryIds.push(await cite("repository-version", capture.commit, jsonField(capture.commit, "sha", commit.sha)));
  const purposeStart = plan.slug === "chop-orca" ? "ORCA-CDS is a resilient" : plan.slug === "penn-captk"
    ? "CaPTk is a software platform" : "The Open Pediatric Cancer (OpenPedCan) project is an open analysis effort";
  const purposeIds = [await cite("purpose", capture.readme, paragraph(capture.readme, purposeStart))];
  const workflowStart = plan.slug === "chop-orca" ? "Order sets are specific to each institution"
    : plan.slug === "penn-captk" ? "For a full list of applications and functionalities" : "1. Learn about the fundamental data";
  const workflowIds = [await cite("workflow", capture.readme, paragraph(capture.readme, workflowStart))];
  const limitationStart = plan.slug === "chop-orca" ? "ORCA-CDS is **not** a live connection"
    : plan.slug === "penn-captk" ? "- The software has been designed for research purposes only"
    : "To cite this work, please note the data release used";
  const limitationIds = [await cite("limitations", capture.readme, paragraph(capture.readme, limitationStart))];
  const licenseIds = [await cite("license-terms", capture.license, plan.slug === "chop-orca"
    ? paragraph(capture.license, "1.6. The software is provided")
    : plan.slug === "penn-captk" ? capture.license.body.slice(0, Math.min(2000, capture.license.body.length))
    : paragraph(capture.license, "# BSD 3-Clause License"))];
  if (plan.slug === "chop-orca") licenseIds.push(await cite("license-use", capture.license,
    paragraph(capture.license, "Permission is hereby granted")), await cite("license-transfer", capture.license,
    paragraph(capture.license, "1.2. The software may not")));
  if (plan.slug === "chop-openpedcan") licenseIds.push(await cite("license-cc0", capture.license,
    paragraph(capture.license, "To the extent possible under law")));
  const proposed = (value: unknown, evidenceIds: string[]) => ({ value, evidenceIds });
  const input: TechnologyDossierInput = {
    schemaVersion: "technology-dossier-input-1", repository: { numericId: plan.numericId, fullName: plan.fullName, commitSha: commit.sha },
    slug: plan.slug, title: plan.title, resourceType: "software", discoveredAt: checkedAt, evidence: usableEvidence,
    metadataEvidence: { title: titleIds, resourceType: purposeIds, repository: repositoryIds },
    purpose: proposed(plan.purpose, purposeIds), intendedUsers: null,
    workflow: proposed({ inputs: [], steps: [...plan.steps], outputs: [] }, workflowIds),
    setup: null,
    limitations: proposed([...plan.limitations], [...limitationIds, ...licenseIds]),
    relationship: { evidenceIds: readmeIds, value: { id: subjectId + ":local", resourceId: subjectId, artifactId,
      entityId: plan.entityId, entityName: plan.entityName, type: plan.relationshipType, temporalStatus: "historical",
      validFrom: null, validTo: null, checkedAt, validThrough: null } },
    licenses: (["code"] as const).map(scope => ({ evidenceIds: licenseIds, value: {
      artifactId, artifactVersion: commit.sha, scope, classification: scope === "code" ? plan.classification : "unknown",
      spdxId: null, licenseSha256: scope === "code" ? evidence.find(item => item.id.endsWith("-license"))!.representationSha256 : null,
      sourceUrl: scope === "code" ? capture.license.url : null, conditions: scope === "code" ? [...plan.conditions] : ["Scope not independently qualified."] } })),
    developments: [],
    aliasProposal: plan.slug === "chop-orca" ? { existingId: "epic-orca-chop",
      existingUrl: "https://thevalleydesk.org/news/chop-orca-cds", status: "review-required",
      reason: "Preserve the existing product identity and news permalink. Epic is the supporting EHR platform, not the creator or rights holder of ORCA." } : null,
  };
  if (capture.regional) {
    const regionalId = await cite("regional-location", capture.regional, technologyRegionalSources[plan.entityId].quote);
    const day = deliveryEasternDay(checkedAt);
    // This is a freshness window for observed evidence, never a creation or relocation date.
    const oldestCheck = entries.map(([, item]) => item.checkedAt).sort()[0]!;
    const validThrough = new Date(Date.parse(oldestCheck) + 30 * 86400000).toISOString();
    input.relationship.value = { ...input.relationship.value, temporalStatus: "observed", validThrough };
    input.relationship.evidenceIds = [...readmeIds, regionalId];
    input.regionalEligibility = { evidenceIds: [regionalId], value: {
      relationshipId: input.relationship.value.id, entityId: plan.entityId, geography: "delaware-valley",
      temporalStatus: "observed", asOfDay: day, validFrom: day,
      validTo: deliveryEasternDay(validThrough) } };
  }
  const releases = JSON.parse(capture.releases.body);
  if (!Array.isArray(releases) || releases.length > 10) throw new Error("technology-release-cap");
  for (const release of releases) {
    if (!Number.isSafeInteger(release.id) || release.id <= 0 || typeof release.tag_name !== "string" ||
        typeof release.draft !== "boolean" || typeof release.prerelease !== "boolean") throw new Error("technology-release-shape");
    const nativeId = String(release.id);
    const releaseUrl = "https://github.com/" + plan.fullName + "/releases/tag/" + encodeURIComponent(release.tag_name);
    if (release.html_url !== releaseUrl) throw new Error("technology-release-repository-conflict");
    const releaseEvidenceId = "tech-" + plan.numericId + "-release-" + nativeId;
    const retainedText = jsonField(capture.releases, "published_at", release.published_at ?? null);
    if (!capture.releases.body.includes(retainedText)) throw new Error("technology-nonliteral-release-evidence");
    input.evidence.push({ id: releaseEvidenceId, url: capture.releases.url, checkedAt: capture.releases.checkedAt,
      representationSha256: await sha256(capture.releases.body), quote: retainedText, retainedText });
    const releaseEvidenceIds = [releaseEvidenceId];
    for (const key of ["id", "tag_name", "html_url", "draft", "prerelease"])
      releaseEvidenceIds.push(await cite("release-" + nativeId + "-" + key, capture.releases,
        jsonField(capture.releases, key, release[key])));
    const date = typeof release.published_at === "string" ? new Date(release.published_at) : null;
    input.developments.push({ nativeId, type: "software-release", title: release.name || release.tag_name,
      artifact: { id: subjectId + ":release:" + nativeId, resourceId: subjectId, artifactType: "release",
        host: "github.com", nativeId, version: release.tag_name, url: releaseUrl, availability: release.draft ? "unknown" : "public" },
      sourceOccurredAt: !release.draft && date && Number.isFinite(date.getTime())
        ? { precision: "instant", value: date.toISOString(), evidenceIds: [releaseEvidenceId] }
        : { precision: "unknown", reason: "No authoritative public release timestamp." },
      evidenceIds: releaseEvidenceIds, prerelease: release.prerelease, draft: release.draft });
  }
  return buildTechnologyDossierDraft(input);
}
