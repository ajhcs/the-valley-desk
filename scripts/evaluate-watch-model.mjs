import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  EVALUATION_MODELS, EvaluationConfiguration, EvaluationCorpus, REQUIRED_DESK_COUNTS,
  evaluationHash, replayEvaluationPair, validateEvaluationCorpus,
} from "../src/ingest/watch-model-evaluation.ts";
import { evidenceHash } from "../src/ingest/policy-pdf.ts";

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function readBoundedText(path, limit) {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error("input-size-or-type-invalid");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
      if (length > limit) throw new Error("input-size-or-type-invalid");
    }
    return buffer.subarray(0, length).toString("utf8");
  } finally { closeSync(fd); }
}

async function main() {
  const { values } = parseArgs({ strict: true, allowPositionals: false, options: {
    help: { type: "boolean" }, mode: { type: "string" }, stage: { type: "string" },
    corpus: { type: "string" }, configuration: { type: "string" },
    case: { type: "string" }, recordings: { type: "string" },
  } });
  if (values.mode === "live") {
    // Intentionally before file access or provider credentials. Live spending,
    // durable reservations, and account qualification are not implemented here.
    print({ status: "blocked", code: "live-execution-not-qualified", networkRequests: 0, publicationEnabled: false });
    process.exitCode = 2;
    return;
  }
  if (values.help || Object.keys(values).length === 0) {
    print({
      status: "offline-preparation-only", models: EVALUATION_MODELS,
      corpusRequirement: { distinctCases: 100, desks: REQUIRED_DESK_COUNTS, calibration: 20, holdout: 80 },
      commands: [
        "node --import tsx/esm scripts/evaluate-watch-model.mjs --mode validate --stage calibration --corpus FILE --configuration FILE",
        "node --import tsx/esm scripts/evaluate-watch-model.mjs --mode replay --stage calibration --corpus FILE --configuration FILE --case ID --recordings FILE",
      ],
      liveExecutionEnabled: false, publicationEnabled: false, networkRequests: 0,
    });
    return;
  }
  const mode = values.mode ?? "validate";
  if (mode !== "validate" && mode !== "replay") throw new Error("unsupported-mode");
  if (values.stage !== "calibration" && values.stage !== "holdout") throw new Error("explicit-stage-required");
  if (!values.corpus || !values.configuration) throw new Error("corpus-and-configuration-required");
  if (mode === "validate" && (values.case || values.recordings)) throw new Error("replay-options-require-replay-mode");
  const corpusText = readBoundedText(values.corpus, 8_000_000);
  const configurationText = readBoundedText(values.configuration, 64_000);
  const corpus = EvaluationCorpus.parse(JSON.parse(corpusText));
  const configuration = EvaluationConfiguration.parse(JSON.parse(configurationText));
  const implementationHashes = {};
  for (const path of ["editor-model.ts", "verification.ts", "editor.ts", "watch-model-evaluation.ts"]) {
    implementationHashes[path] = await evidenceHash(readBoundedText(new URL(`../src/ingest/${path}`, import.meta.url), 200_000));
  }
  const receipt = {
    corpusFileSha256: await evidenceHash(corpusText), configurationFileSha256: await evidenceHash(configurationText),
    implementationHashes, implementationSha256: await evaluationHash(implementationHashes), nodeVersion: process.versions.node,
    networkRequests: 0, credentialSource: "none", publicationEnabled: false,
  };
  if (mode === "validate") {
    const readiness = await validateEvaluationCorpus(corpus, configuration, values.stage);
    print({ ...receipt, readiness });
    if (!readiness.qualificationRequirementsMet) process.exitCode = 2;
    return;
  }
  if (!values.case || !values.recordings) throw new Error("replay-case-and-recordings-required");
  const matches = corpus.cases.filter((row) => row.caseId === values.case);
  if (matches.length !== 1) throw new Error("replay-case-must-be-unique");
  const recordingsText = readBoundedText(values.recordings, 5_000_000);
  const recordings = JSON.parse(recordingsText);
  const result = await replayEvaluationPair(matches[0], configuration, recordings, values.stage);
  print({ ...receipt, recordingsFileSha256: await evidenceHash(recordingsText), result });
  if (result.replayIssues.length) process.exitCode = 2;
}

main().catch(() => {
  // Do not echo arbitrary input, source content, reviewer notes, or native errors.
  print({ status: "blocked", code: "invalid-offline-evaluation-input", networkRequests: 0, publicationEnabled: false });
  process.exitCode = 2;
});
