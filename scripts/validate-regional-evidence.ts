import { readFile } from "node:fs/promises";
import { buildRegionalEvidenceReview } from "../src/content/regional-evidence";

// Offline only: no health, scheduler, database, credentials, fetch or activation input.
if (process.argv.length > 2) throw new Error("Usage: node --import tsx/esm scripts/validate-regional-evidence.ts");
const json = async (path: string) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [scopeInventory, inventory, coverage, official] = await Promise.all([
  json("../fixtures/regional-evidence/institution-scope-v1.json"), json("../fixtures/regional-source-inventory-v1.json"),
  json("../fixtures/coverage-pack-v1.json"), json("../fixtures/official-source-registry-v1.json"),
]);
const report = buildRegionalEvidenceReview({ scopeInventory, inventory, existingInstitutions: coverage.institutions,
  existingOfficialSources: official.sources, existingLeadershipSources: coverage.sources, asOf: "2026-10-06T19:00:00Z" });
console.log(JSON.stringify(report, null, 2));
