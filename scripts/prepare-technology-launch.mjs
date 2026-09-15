import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { prepareTechnologySourceDraft, technologySourcePlans } from "../src/ingest/technology-source-plans.ts";
const [captureDirectory, regionDirectory, outputDirectory] = process.argv.slice(2);
if (![captureDirectory, regionDirectory, outputDirectory].every(value => value && isAbsolute(value)))
  throw Error("Pass absolute existing captures, regional captures, and output directories");
await mkdir(outputDirectory, { recursive: true });
for (const plan of technologySourcePlans) {
  const captures = JSON.parse(await readFile(resolve(captureDirectory, plan.slug + ".captures.json"), "utf8"));
  captures.regional = JSON.parse(await readFile(resolve(regionDirectory, plan.entityId + ".2.capture.json"), "utf8"));
  const draft = await prepareTechnologySourceDraft(plan, captures);
  await writeFile(resolve(outputDirectory, plan.slug + ".captures.json"), JSON.stringify(captures, null, 2), { flag: "wx" });
  await writeFile(resolve(outputDirectory, plan.slug + ".draft.json"), JSON.stringify(draft.input, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ subjectId: draft.subjectId, slug: plan.slug, inputSha256: draft.inputSha256,
    evidence: draft.input.evidence.length, observed: draft.input.relationship.value.temporalStatus,
    validThrough: draft.input.relationship.value.validThrough, publicationAuthorized: false }));
}
