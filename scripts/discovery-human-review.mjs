#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DiscoveryId } from "../src/content/discovery-schema.ts";
import { prepareDiscoveryHumanReview, dispatchDiscoveryHumanReview, checkDiscoveryHumanReturn,
  prepareDiscoveryHumanAdjudication } from "../src/ingest/discovery-human-review.ts";
import { createDiscoverySignedReceiptStore } from "../src/ingest/discovery-reference-signatures.ts";
import { createDiscoveryReferenceReceiptVerifier } from "../src/ingest/discovery-reference-receipts.ts";
import { parseDiscoveryIntakeJson, readBounded, privateOutput, writeDiscoveryPrivateOutput } from "./discovery-reference-intake.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const decode = bytes => parseDiscoveryIntakeJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
const validPath = path => typeof path === "string" && isAbsolute(path) && resolve(path) === path;
/** Explicit local files only. No discovery, environment credentials, enrollment, signing or network. */
export async function runDiscoveryHumanReview(argv) {
  try {
    const [operation, ...args] = argv;
    const trustNames = ["--manifest", "--bundle", "--trust-policy", "--expected-policy-sha256"];
    const names = operation === "prepare" ? ["--request", "--output"] : operation === "dispatch" ? [...trustNames, "--request", "--output"] :
      ["check-return", "verify-return"].includes(operation) ? [...trustNames, "--packet", "--return", "--output"] :
      operation === "adjudication-handoff" ? [...trustNames, "--first-packet", "--second-packet", "--first-return", "--second-return", "--output"] : [];
    if (!names.length || args.length !== names.length * 2) throw new Error("arguments");
    const options = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!names.includes(args[i]) || options.has(args[i])) throw new Error("arguments");
      options.set(args[i], args[i + 1]);
    }
    const paths = names.filter(x => x !== "--expected-policy-sha256").map(x => options.get(x));
    if (paths.some(x => !validPath(x)) || new Set(paths).size !== paths.length) throw new Error("paths");
    const output = options.get("--output"); await privateOutput(output);
    const inodes = new Set();
    const read = async (path, limit = 16000000) => {
      if (!validPath(path)) throw new Error("path");
      const result = await readBounded(path, limit);
      if (inodes.has(result.inode)) throw new Error("input-alias");
      inodes.add(result.inode); return result.data;
    };
    let report;
    if (operation === "prepare") report = prepareDiscoveryHumanReview(decode(await read(options.get("--request"))));
    else {
      if (!/^[a-f0-9]{64}$/.test(options.get("--expected-policy-sha256"))) throw new Error("policy-pin");
      const policyBytes = await read(options.get("--trust-policy"), 262144);
      if (hash(policyBytes) !== options.get("--expected-policy-sha256")) throw new Error("policy-pin");
      const manifest = decode(await read(options.get("--manifest")));
      const verify = createDiscoveryReferenceReceiptVerifier(await createDiscoverySignedReceiptStore(decode(policyBytes), decode(await read(options.get("--bundle")))));
      if (operation === "dispatch") {
        const request = z.object({ caseId: DiscoveryId, reviewerId: DiscoveryId,
          originals: z.array(z.object({ sourceId: DiscoveryId, path: z.string().max(4000) }).strict()).min(1).max(128) }).strict().parse(decode(await read(options.get("--request"))));
        const originals = []; let originalBytes = 0;
        for (const original of request.originals) {
          const bytes = await read(original.path, 1000000); originalBytes += bytes.length;
          if (originalBytes > 9000000) throw new Error("original-total");
          originals.push({ sourceId: original.sourceId, bytesBase64: bytes.toString("base64") });
        }
        report = await dispatchDiscoveryHumanReview(manifest, request.caseId, request.reviewerId, originals, verify);
      } else if (operation === "adjudication-handoff") {
        const packets = [decode(await read(options.get("--first-packet"))), decode(await read(options.get("--second-packet")))];
        const returnBytes = [await read(options.get("--first-return"), 65536), await read(options.get("--second-return"), 65536)];
        const returns = returnBytes.map(decode);
        report = { ...await prepareDiscoveryHumanAdjudication(manifest, packets, returns, verify),
          originalReturnFiles: returnBytes.map(bytes => ({ sha256: hash(bytes), bytesBase64: bytes.toString("base64") })) };
      } else {
        const packet = decode(await read(options.get("--packet"))), returnBytes = await read(options.get("--return"), 65536);
        report = { ...await checkDiscoveryHumanReturn(manifest, packet, decode(returnBytes), verify, operation === "verify-return"),
          originalReturnFileSha256: hash(returnBytes), originalReturnFileBase64: returnBytes.toString("base64") };
      }
    }
    await writeDiscoveryPrivateOutput(output, Buffer.from(JSON.stringify(report, null, 2) + "\n"));
    process.stdout.write(operation === "prepare" ? "blocked\n" : "private_proposal_written\n");
    return operation === "prepare" ? 2 : 0;
  } catch { process.stderr.write("invalid_offline_human_review\n"); return 3; }
}
const invoked = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => null) : null;
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = await runDiscoveryHumanReview(process.argv.slice(2));
