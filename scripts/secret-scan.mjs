#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SKIP = /\.(webp|png|jpg|jpeg|gif|svg|woff2?|lock)$/i;
const ALLOW_PATH = /(\.dev\.vars\.example|docs\/OPERATIONS\.md|README\.md|MVP_RECOVERY\.md|test\/.*\.test\.ts)$/;
const PATTERNS = [
  { name: "openrouter-key", re: /\bsk-or-[a-zA-Z0-9-_]{16,}\b/ },
  { name: "github-pat", re: /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/ },
  { name: "github-token", re: /\bghp_[a-zA-Z0-9]{20,}\b/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "cloudflare-token", re: /\bCF_API_TOKEN\s*=\s*['\"]?[A-Za-z0-9_-]{20,}/ },
  { name: "live-openrouter-env", re: /\bOPENROUTER_API_KEY\s*=\s*(?!optional-openrouter-key\b)['\"]?[A-Za-z0-9_-]{16,}/ },
  { name: "live-review-token", re: /\bREVIEW_API_TOKEN\s*=\s*(?!replace-with-a-long-random-token\b)['\"]?[A-Za-z0-9_-]{16,}/ },
  { name: "live-social-ingest-token", re: /\bSOCIAL_INGEST_TOKEN\s*=\s*(?!replace-with-a-different-long-random-token\b)['\"]?[A-Za-z0-9_-]{16,}/ },
];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => !SKIP.test(file));

const hits = [];
for (const file of files) {
  if (ALLOW_PATH.test(file) && /example|docs|README|MVP_RECOVERY/.test(file)) continue;
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) hits.push(`${file}: ${name}`);
  }
}

if (hits.length) {
  console.error("secret-scan failed:\n" + hits.join("\n"));
  process.exit(1);
}

console.log(`secret-scan passed (${files.length} tracked and untracked files)`);
