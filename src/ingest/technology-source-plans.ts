import { githubRepositoryKey, sha256 } from "../content/watch-schema";
import { buildTechnologyDossierDraft, type TechnologyDossierInput } from "./technology-dossiers";

export const technologySourcePlans = [
  { numericId: "1308325438", fullName: "Stephonomon/orca-cds", branch: "main", readme: "README.md", license: "LICENSE.md",
    readmeSha256: "328b988a64f25777e17718f73f97371a040b821992cc59d693ee8cbd6d79fb6e",
    licenseSha256: "5470b7d5b1aed9de70596043a23b00c4340f7e039c21bb8f6e38546c8c74049c",
    slug: "chop-orca", title: "ORCA-CDS", entityId: "chop", entityName: "Children's Hospital of Philadelphia",
    relationshipType: "created-by", quote: "It was developed and evaluated at Children's Hospital of Philadelphia (CHOP)",
    purpose: "Offline, read-only access to Epic order-set reference content during downtime.",
    users: ["Clinical informatics teams", "Downtime preparedness teams"],
    inputs: ["Institution-specific order-set extract"], steps: ["Adapt the documented warehouse extract.", "Transform CSV into hierarchical JSON.", "Deploy the static viewer and refresh its reference content."],
    outputs: ["Searchable offline order-set reference"],
    prerequisites: ["Node.js", "Python", "Institution-specific warehouse access"],
    limitations: ["Cannot place orders or provide live decision support.", "Research software; clinical use requires separate authorization under the license."],
    classification: "restricted-source", conditions: ["Academic/nonprofit internal non-commercial research and education only.", "Commercial use and transfer require separate permission.", "Clinical use is not granted by the public research license."],
  },
  { numericId: "128938343", fullName: "CBICA/CaPTk", branch: "master", readme: "Readme.md", license: "LICENSE",
    readmeSha256: "2416c23316704d10b8fbab4692972ebea52111dd971b8e9652a7c1da001c54b6",
    licenseSha256: "d083663de73485c6b0b8a014a2cd530d25f89ad4e54d0a3414c2e8d6ab931ba4",
    slug: "penn-captk", title: "Cancer Imaging Phenomics Toolkit", entityId: "penn-medicine", entityName: "University of Pennsylvania",
    relationshipType: "maintained-by", quote: "at the University of Pennsylvania.",
    purpose: "Cancer-image analysis and predictive modeling, with brain, breast and lung imaging applications.",
    users: ["Medical imaging researchers"],
    inputs: ["Radiographic cancer images"], steps: ["Choose a documented application and its required image inputs.", "Follow the matching application guide for image analysis."],
    outputs: ["Quantitative imaging features and analysis outputs"],
    prerequisites: ["Platform-compatible CaPTk distribution", "Application-specific imaging inputs"],
    limitations: ["Research use; not FDA-approved for clinical use.", "Individual components have different license terms."],
    classification: "unknown", conditions: ["Custom CBICA terms and multiple dependency licenses.", "PHI Estimator is separately non-commercial; do not label the whole distribution OSI open source."],
  },
  { numericId: "358689512", fullName: "d3b-center/OpenPedCan-analysis", branch: "dev", readme: "README.md", license: "LICENSE.md",
    readmeSha256: "6ed648555824c90de79d5898103be855f300534c405dd326144e6104da493663",
    licenseSha256: "8067620f3ea6c48329c77af92ecc9992af92691fd9323d904dca67848df14ea4",
    slug: "chop-openpedcan", title: "Open Pediatric Cancer analysis", entityId: "chop", entityName: "Children's Hospital of Philadelphia",
    relationshipType: "research-affiliation", quote: "Children’s Hospital of Philadelphia Division of Neurosurgery",
    purpose: "Reproducible analysis of harmonized pediatric cancer data, with versioned outputs for downstream research.",
    users: ["Cancer genomics researchers", "Bioinformatics analysts"],
    inputs: ["Versioned OpenPedCan research data"], steps: ["Review data formats and the release notes.", "Use the documented project container for a selected analysis module."],
    outputs: ["Research analyses and versioned result tables"],
    prerequisites: ["Docker", "Module-specific research data"],
    limitations: ["Code releases and data releases have separate version histories.", "Repository license does not automatically establish rights to every upstream dataset."],
    classification: "unknown", conditions: ["Repository license contains CC0 and BSD 3-Clause sections; confirm scope for the specific artifact.", "Data and weights licensing is not inferred from code licensing."],
  },
] as const;

export type TechnologyCapture = { url: string; checkedAt: string; body: string };
export async function prepareTechnologySourceDraft(plan: typeof technologySourcePlans[number],
  capture: { repository: TechnologyCapture; commit: TechnologyCapture; readme: TechnologyCapture;
    license: TechnologyCapture; releases: TechnologyCapture }) {
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
  const entries = Object.entries(capture);
  const checkedAt = entries.map(([, item]) => item.checkedAt).sort().at(-1)!;
  const evidence = await Promise.all(entries.map(async ([id, item]) => ({
    id: "tech-" + plan.numericId + "-" + id, url: item.url, checkedAt: item.checkedAt,
    representationSha256: await sha256(item.body),
    quote: id === "readme" ? plan.quote : id === "license" ? item.body.slice(0, 200) : item.body.slice(0, Math.min(200, item.body.length)),
    retainedText: id === "readme" ? plan.quote : item.body.slice(0, 200),
  })));
  // A successful empty releases response is retained but cannot supply a fact span.
  const usableEvidence = evidence.filter(item => item.quote.length >= 3);
  const readmeIds = ["tech-" + plan.numericId + "-readme"], licenseIds = ["tech-" + plan.numericId + "-license"];
  const proposed = (value: unknown) => ({ value, evidenceIds: readmeIds });
  const input: TechnologyDossierInput = {
    schemaVersion: "technology-dossier-input-1", repository: { numericId: plan.numericId, fullName: plan.fullName, commitSha: commit.sha },
    slug: plan.slug, title: plan.title, resourceType: "software", discoveredAt: checkedAt, evidence: usableEvidence,
    purpose: proposed(plan.purpose), intendedUsers: proposed([...plan.users]),
    workflow: proposed({ inputs: [...plan.inputs], steps: [...plan.steps], outputs: [...plan.outputs] }),
    setup: proposed({ verification: "maintainer-documented", version: commit.sha, prerequisites: [...plan.prerequisites],
      guideUrl: "https://github.com/" + plan.fullName + "/blob/" + commit.sha + "/" + plan.readme }),
    limitations: proposed([...plan.limitations]),
    relationship: { evidenceIds: readmeIds, value: { id: subjectId + ":local", resourceId: subjectId, artifactId,
      entityId: plan.entityId, entityName: plan.entityName, type: plan.relationshipType, temporalStatus: "historical",
      validFrom: null, validTo: null, checkedAt, validThrough: null } },
    licenses: (["code", "data", "weights"] as const).map(scope => ({ evidenceIds: licenseIds, value: {
      artifactId, artifactVersion: commit.sha, scope, classification: scope === "code" ? plan.classification : "unknown",
      spdxId: null, licenseSha256: scope === "code" ? evidence.find(item => item.id.endsWith("-license"))!.representationSha256 : null,
      sourceUrl: scope === "code" ? capture.license.url : null, conditions: scope === "code" ? [...plan.conditions] : ["Scope not independently qualified."] } })),
    developments: [],
    aliasProposal: plan.slug === "chop-orca" ? { existingId: "epic-orca-chop",
      existingUrl: "https://thevalleydesk.org/news/chop-orca-cds", status: "review-required",
      reason: "Preserve the existing product identity and news permalink. Epic is the supporting EHR platform, not the creator or rights holder of ORCA." } : null,
  };
  const releases = JSON.parse(capture.releases.body);
  if (!Array.isArray(releases) || releases.length > 10) throw new Error("technology-release-cap");
  for (const release of releases) {
    if (!Number.isSafeInteger(release.id) || release.id <= 0 || typeof release.tag_name !== "string" ||
        typeof release.draft !== "boolean" || typeof release.prerelease !== "boolean") throw new Error("technology-release-shape");
    const nativeId = String(release.id);
    const releaseUrl = "https://github.com/" + plan.fullName + "/releases/tag/" + encodeURIComponent(release.tag_name);
    if (release.html_url !== releaseUrl) throw new Error("technology-release-repository-conflict");
    const releaseEvidenceId = "tech-" + plan.numericId + "-release-" + nativeId;
    const retainedText = JSON.stringify(release.published_at ?? release.tag_name);
    if (!capture.releases.body.includes(retainedText)) throw new Error("technology-nonliteral-release-evidence");
    input.evidence.push({ id: releaseEvidenceId, url: capture.releases.url, checkedAt: capture.releases.checkedAt,
      representationSha256: await sha256(capture.releases.body), quote: retainedText, retainedText });
    const date = typeof release.published_at === "string" ? new Date(release.published_at) : null;
    input.developments.push({ nativeId, type: "software-release", title: release.name || release.tag_name,
      artifact: { id: subjectId + ":release:" + nativeId, resourceId: subjectId, artifactType: "release",
        host: "github.com", nativeId, version: release.tag_name, url: releaseUrl, availability: release.draft ? "unknown" : "public" },
      sourceOccurredAt: !release.draft && date && Number.isFinite(date.getTime())
        ? { precision: "instant", value: date.toISOString(), evidenceIds: [releaseEvidenceId] }
        : { precision: "unknown", reason: "No authoritative public release timestamp." },
      evidenceIds: [releaseEvidenceId], prerelease: release.prerelease, draft: release.draft });
  }
  return buildTechnologyDossierDraft(input);
}
