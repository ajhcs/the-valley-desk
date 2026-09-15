import { policyBaselinePlan } from "../src/ingest/policy-baseline.ts";

if (process.argv.slice(2).some((argument) => argument !== "--dry-run")) {
  throw new Error("This command is intentionally dry-run only; use the reviewed D1 application function from an explicitly authorized operational task.");
}

process.stdout.write(`${JSON.stringify(policyBaselinePlan(), null, 2)}\n`);
