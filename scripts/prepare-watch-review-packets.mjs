import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { parseArgs } from "node:util";
import { prepareWatchReviewPacket, renderWatchReviewPacketMarkdown, REVIEW_PACKET_LIMITS } from "../src/ingest/watch-review-packets.ts";
import { evidenceHash } from "../src/ingest/policy-pdf.ts";

const print = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
function readBounded(path, limit) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > limit) throw new Error("invalid-local-input");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > limit) throw new Error("invalid-local-input");
    const data = buffer.subarray(0, length);
    return { data, text: new TextDecoder("utf-8", { fatal: true }).decode(data) };
  } finally { closeSync(descriptor); }
}
async function main() {
  const { values } = parseArgs({ strict: true, allowPositionals: false, options: {
    help: { type: "boolean" }, mode: { type: "string" }, stage: { type: "string" }, format: { type: "string" },
    corpus: { type: "string" }, configuration: { type: "string" },
    "pin-corpus": { type: "string" }, "pin-configuration": { type: "string" }, "pin-split": { type: "string" },
  } });
  if (values.mode === "live") {
    print({ status: "blocked", code: "offline-packets-only", networkRequests: 0, approvalsIssued: 0 }); process.exitCode = 2; return;
  }
  if (values.help || !Object.keys(values).length) {
    print({ status: "draft-packet-preparation-only", modes: ["prepare"], formats: ["json", "markdown"],
      command: "node --import tsx/esm scripts/prepare-watch-review-packets.mjs --stage calibration --corpus FILE --configuration FILE --format json",
      networkRequests: 0, credentialSource: "none", approvalsIssued: 0, publicationEnabled: false }); return;
  }
  if ((values.mode && values.mode !== "prepare") || !["calibration", "holdout"].includes(values.stage) ||
      (values.format && !["json", "markdown"].includes(values.format)) || !values.corpus || !values.configuration) throw new Error("invalid-options");
  const corpus = readBounded(values.corpus, REVIEW_PACKET_LIMITS.corpusBytes);
  const configuration = readBounded(values.configuration, REVIEW_PACKET_LIMITS.configurationBytes);
  const result = await prepareWatchReviewPacket(JSON.parse(corpus.text), JSON.parse(configuration.text), { stage: values.stage,
    expectedCorpusSha256: values["pin-corpus"], expectedConfigurationSha256: values["pin-configuration"], expectedSplitSha256: values["pin-split"] });
  const inputFiles = { corpusFileSha256: await evidenceHash(corpus.data), configurationFileSha256: await evidenceHash(configuration.data) };
  const output = values.format === "markdown"
    ? `Input file SHA-256 receipts:\n\n\`\`\`json\n${JSON.stringify(inputFiles, null, 2)}\n\`\`\`\n\n${renderWatchReviewPacketMarkdown(result)}`
    : `${JSON.stringify({ inputFiles, ...result }, null, 2)}\n`;
  if (Buffer.byteLength(output) > REVIEW_PACKET_LIMITS.outputBytes) throw new Error("review-packet-size-invalid");
  process.stdout.write(output);
  if (result.gapReport.gaps.length) process.exitCode = 2;
}
main().catch(() => {
  print({ status: "blocked", code: "invalid-offline-review-packet-input", networkRequests: 0, credentialSource: "none", approvalsIssued: 0, publicationEnabled: false });
  process.exitCode = 2;
});
