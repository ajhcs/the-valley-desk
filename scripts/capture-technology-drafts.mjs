import { mkdir, writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { prepareTechnologySourceDraft, technologySourcePlans } from "../src/ingest/technology-source-plans.ts";

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== "--capture" || args[1] !== "--out" || !isAbsolute(args[2])) {
  throw new Error("Explicit public-source access required: node --import tsx scripts/capture-technology-drafts.mjs --capture --out /absolute/mounted/output");
}
const directory = resolve(args[2]);
await mkdir(directory, { recursive: true });
async function capture(url) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "TheValleyDesk-public-source-qualification", Accept: "application/json,text/plain" } });
  if (!response.ok) throw new Error("Source capture HTTP " + response.status + ": " + url);
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 1000000) { await reader.cancel(); throw new Error("Source representation exceeds cap"); }
    chunks.push(value);
  }
  return { url, checkedAt: new Date().toISOString(), body: Buffer.concat(chunks).toString("utf8") };
}
const receipts = [];
for (const plan of technologySourcePlans) {
  const api = "https://api.github.com/repos/" + plan.fullName;
  const repository = await capture(api);
  const commit = await capture(api + "/commits/" + plan.branch);
  const commitSha = JSON.parse(commit.body).sha;
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error("Invalid repository commit");
  const raw = "https://raw.githubusercontent.com/" + plan.fullName + "/" + commitSha + "/";
  const snapshots = { repository, commit, readme: await capture(raw + plan.readme),
    license: await capture(raw + plan.license), releases: await capture(api + "/releases?per_page=10") };
  const draft = await prepareTechnologySourceDraft(plan, snapshots);
  // Captures are review inputs only. This command has no D1 binding or publication writer.
  await writeFile(resolve(directory, plan.slug + ".captures.json"), JSON.stringify(snapshots, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await writeFile(resolve(directory, plan.slug + ".draft.json"), JSON.stringify(draft.input, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  receipts.push({ subjectId: draft.subjectId, slug: plan.slug, inputSha256: draft.inputSha256,
    artifacts: draft.artifacts.length, developments: draft.developments.length, publicationAuthorized: false });
}
await writeFile(resolve(directory, "receipt.json"), JSON.stringify(receipts, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ directory, drafts: receipts.length, publicationAuthorized: false }));
