import assert from "node:assert/strict";
import test from "node:test";
import { RegionalInventory, PublicAffiliation, permittedPublicUrl, verifyRegionalEvidence, verifyPublicAffiliation,
  resolveInstitutionalAuthor, verifyInstitutionalRepository } from "../src/ingest/regional-contracts";
import type { RegionalEvidence, RegionalInstitution } from "../src/ingest/regional-contracts";
import { readFile } from "node:fs/promises";

const observedAt = "2026-10-02T03:00:00Z";
const institution: RegionalInstitution = { id: "inst-fixture", name: "Fixture Institute", kind: "research-institute",
  existingInstitutionId: null, officialHosts: ["fixture.edu"], regionalScope: "core", evidenceIds: ["ev-fixture"], owner: "test owner" };
async function citation(body: string, url = "https://fixture.edu/person/alex", representation: RegionalEvidence["representation"] = "normalized-text") {
  const representationSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  const evidence: RegionalEvidence = { id: "ev-fixture", url, observedAt, sourcePublishedAt: null,
    representationSha256, quote: body, representation };
  return { evidence, retained: { url, observedAt, body } };
}
const affiliation = () => PublicAffiliation.parse({ id: "aff-alex", personId: "person-alex", fullName: "Alex Lee",
  institutionId: institution.id, profileUrl: "https://fixture.edu/person/alex", role: "Research Director", evidenceId: "ev-fixture",
  validFrom: null, validUntil: null, observedAt, expiresAt: "2026-10-09T03:00:00Z" });

async function profileQualification(row = affiliation()) {
  const profile = await citation(JSON.stringify({ "@context": "https://schema.org", "@type": "ProfilePage", url: row.profileUrl,
    mainEntity: { "@type": "Person", name: row.fullName, url: row.profileUrl } }), row.profileUrl, "json");
  profile.evidence.id = "ev-profile";
  return { profile };
}

test("shipped inventory is review-only and has unique known citations", async () => {
  const inventory = RegionalInventory.parse(JSON.parse(await readFile(new URL("../fixtures/regional-source-inventory-v1.json", import.meta.url), "utf8")));
  assert.equal(inventory.collectionAuthorized, false);
  assert.equal(inventory.publicationAuthorized, false);
  assert.ok(inventory.institutions.some(row => row.kind === "community-provider"));
  assert.ok(inventory.sources.some(row => row.channel === "research"));
});
test("public URL policy rejects credentials, IPs, local endpoints and restricted social hosts", () => {
  for (const url of ["http://fixture.edu/a", "https://user:pass@fixture.edu/a", "https://127.0.0.1/a", "https://[::1]/a",
    "https://fixture.edu:8443/a", "https://localhost/a", "https://device.internal/a", "https://www.linkedin.com/in/alex", "https://fixture.edu./a"])
    assert.equal(permittedPublicUrl(url), false, url);
  assert.equal(permittedPublicUrl("https://fixture.edu/a", ["fixture.edu"]), true);
  assert.equal(permittedPublicUrl("https://sub.fixture.edu/a", ["fixture.edu"]), false);
});
test("evidence verification rejects altered bytes, source URLs, observation times and invented quotes", async () => {
  const { evidence, retained } = await citation("Alex Lee Research Director");
  assert.equal(await verifyRegionalEvidence(evidence, retained), true);
  assert.equal(await verifyRegionalEvidence(evidence, { ...retained, body: retained.body + "." }), false);
  assert.equal(await verifyRegionalEvidence(evidence, { ...retained, url: "https://other.edu/alex" }), false);
  assert.equal(await verifyRegionalEvidence(evidence, { ...retained, observedAt: "2026-10-03T03:00:00Z" }), false);
  assert.equal(await verifyRegionalEvidence({ ...evidence, quote: "invented title" }, retained), false);
});
test("affiliation preserves unknown term dates and requires named first-party role evidence", async () => {
  const row = affiliation(), { evidence, retained } = await citation("Alex Lee Research Director");
  assert.ok(await verifyPublicAffiliation(row, institution, evidence, retained, await profileQualification(row)));
  assert.equal(row.validFrom, null);
  assert.equal(await verifyPublicAffiliation({ ...row, role: "Chief Executive" }, institution, evidence, retained), null);
  assert.equal(await verifyPublicAffiliation(row, { ...institution, officialHosts: ["other.edu"] }, evidence, retained), null);
});
async function verifiedAffiliation(row = affiliation()) {
  const { evidence, retained } = await citation("Alex Lee Research Director");
  const result = await verifyPublicAffiliation(row, institution, evidence, retained, await profileQualification(row));
  assert.ok(result);
  return result;
}
test("institutional author identity cannot be resolved from names alone", async () => {
  assert.equal(resolveInstitutionalAuthor({ name: "Alex Lee" }, [await verifiedAffiliation()], observedAt).reason, "name-only");
});
test("author matching requires exact stable profile, full name and current observation", async () => {
  const row = await verifiedAffiliation(), author = { name: row.fullName, institutionalProfileUrl: row.profileUrl };
  assert.equal(resolveInstitutionalAuthor(author, [row], observedAt).state, "matched");
  for (const date of ["2026-10-01T03:00:00Z", row.expiresAt])
    assert.equal(resolveInstitutionalAuthor(author, [row], date).state, "unresolved");
  assert.equal(resolveInstitutionalAuthor({ ...author, name: "Alex Li" }, [row], observedAt).state, "unresolved");
  assert.equal(resolveInstitutionalAuthor(author, [row, await verifiedAffiliation({ ...affiliation(), id: "aff-other", personId: "person-other" })], observedAt).reason, "ambiguous");
});
test("affiliation intervals reject impossible dates and reversed known terms", () => {
  assert.throws(() => PublicAffiliation.parse({ ...affiliation(), validFrom: "2026-02-30" }));
  assert.throws(() => PublicAffiliation.parse({ ...affiliation(), validFrom: "2026-10-02", validUntil: "2026-10-01" }));
});
async function repositoryInput(link = "https://github.com/Example/Project") {
  const { evidence, retained } = await citation(`<a href="${link}">Source code</a>`, "https://fixture.edu/project", "html");
  const repository = { id: "12345", fullName: "Example/Project", private: false, htmlUrl: "https://github.com/Example/Project" };
  return { institution, evidence, retained, repository, repositoryCapture: { url: "https://api.github.com/repos/Example/Project",
    observedAt, body: JSON.stringify({ id: 12345, full_name: repository.fullName, owner: { login: "Example" }, name: "Project", private: false, html_url: repository.htmlUrl }) } };
}
test("exact institutional repository evidence verifies numeric identity without organization ownership", async () => {
  const result = await verifyInstitutionalRepository(await repositoryInput("https://github.com/example/project"));
  assert.equal(result?.repositoryId, "12345");
  assert.equal(result?.organizationOwnershipVerified, false);
  assert.equal(result?.publicationAuthorized, false);
});
test("repository verification rejects guessed owners, path prefixes, private repos, unsafe IDs and modified evidence", async () => {
  for (const link of ["https://github.com/Example", "https://github.com/Example/Project-extra", "https://github.com/Other/Project",
    "https://github.com/Example/Project?redirect=1"])
    assert.equal(await verifyInstitutionalRepository(await repositoryInput(link)), null);
  const input = await repositoryInput();
  assert.equal(await verifyInstitutionalRepository({ ...input, repository: { ...input.repository, private: true } }), null);
  assert.equal(await verifyInstitutionalRepository({ ...input, repository: { ...input.repository, id: "54321" } }), null);
  assert.equal(await verifyInstitutionalRepository({ ...input, retained: { ...input.retained, body: "changed" } }), null);
  assert.equal(await verifyInstitutionalRepository({ ...input, repositoryCapture: { ...input.repositoryCapture,
    body: input.repositoryCapture.body.replace('"id":12345', '"id":9007199254740993') } }), null);
});

test("affiliation freshness expires after at most seven days and unverified JSON cannot resolve authors", async () => {
  assert.throws(() => PublicAffiliation.parse({ ...affiliation(), expiresAt: "2027-10-02T03:00:00Z" }));
  const row = await verifiedAffiliation();
  const copiedFromJson = JSON.parse(JSON.stringify(row));
  assert.equal(resolveInstitutionalAuthor({ name: row.fullName, institutionalProfileUrl: row.profileUrl }, [copiedFromJson], observedAt).state, "unresolved");
});

test("a broad roster quote cannot pair one person's name with another person's role", async () => {
  const { evidence, retained } = await citation("Alex Lee Visitor. Sam Lee Research Director");
  assert.equal(await verifyPublicAffiliation(affiliation(), institution, evidence, retained), null);
});
