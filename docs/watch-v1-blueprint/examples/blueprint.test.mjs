import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");
const map = JSON.parse(read("implementation-map.json"));
const markdown = readdirSync(root).filter((file) => file.endsWith(".md"));
const idsFrom = (text, expression) => [...text.matchAll(expression)].map((match) => match[1]);

test("all 12 requirements map to existing work packages and acceptance tests", () => {
  const requirements = idsFrom(read("README.md"), /^\| (R\d{2}) \|/gm);
  const tasks = idsFrom(read("05-delivery-and-validation.md"), /^### (W\d{2}):/gm);
  const tests = idsFrom(read("05-delivery-and-validation.md"), /^\| (T\d{2}) \|/gm);
  assert.equal(requirements.length, 12);
  assert.equal(tasks.length, 14);
  assert.equal(tests.length, 34);
  assert.deepEqual(map.requirements.map((row) => row.id).sort(), requirements.sort());
  assert.deepEqual(map.workPackages.map((row) => row.id).sort(), tasks.sort());
  for (const requirement of map.requirements) {
    assert.ok(requirement.packages.length > 0 && requirement.tests.length > 0);
    for (const id of requirement.packages) assert.ok(tasks.includes(id), `Unknown work package ${id}`);
    for (const id of requirement.tests) assert.ok(tests.includes(id), `Unknown test ${id}`);
  }
  assert.deepEqual([...new Set(map.requirements.flatMap((row) => row.tests))].sort(), tests.sort());
});

test("work dependencies are valid and acyclic, including UI acceptance dependencies", () => {
  const tasks = new Map(map.workPackages.map((row) => [row.id, row]));
  const visiting = new Set();
  const done = new Set();
  function visit(id) {
    assert.ok(tasks.has(id), `Unknown dependency ${id}`);
    assert.equal(visiting.has(id), false, `Dependency cycle at ${id}`);
    if (done.has(id)) return;
    visiting.add(id);
    const row = tasks.get(id);
    for (const dependency of [...row.readyAfter, ...row.acceptAfter]) visit(dependency);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of tasks.keys()) visit(id);
  assert.equal(done.size, 14);
});

test("planning map does not claim staffing, completed implementation, or production authorization", () => {
  assert.equal(map.productionAuthorized, false);
  assert.ok(map.workPackages.every((row) => row.ownerRole && row.assignedPerson === null
    && row.status === "not-started" && row.receipt === null));
});

test("repository-relative Markdown links in the controlled blueprint format resolve", () => {
  let count = 0;
  for (const filename of markdown) {
    // This checks this package's simple link syntax, not arbitrary Markdown grammar.
    const text = read(filename).replace(/```[\s\S]*?```/g, "");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim();
      if (/^(https?:|#)/.test(target)) continue;
      target = target.replace(/^<|>$/g, "").split("#")[0];
      // Host-specific scratch evidence is recorded in the receipt, not a portable dependency.
      if (path.isAbsolute(target)) continue;
      assert.ok(existsSync(path.resolve(root, decodeURIComponent(target))), `${filename}: missing ${target}`);
      count += 1;
    }
  }
  assert.ok(count >= 15);
});

test("JSON example blocks parse and Markdown code fences are balanced", () => {
  let examples = 0;
  for (const filename of markdown) {
    const text = read(filename);
    assert.equal((text.match(/^```/gm) || []).length % 2, 0, `${filename}: unbalanced fences`);
    for (const match of text.matchAll(/^```json\n([\s\S]*?)^```/gm)) {
      assert.doesNotThrow(() => JSON.parse(match[1]), `${filename}: invalid JSON example`);
      examples += 1;
    }
  }
  assert.ok(examples >= 5);
});

test("new blueprint files use ASCII and have no trailing whitespace", () => {
  const inspect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(full);
      else {
        const value = readFileSync(full, "utf8");
        assert.equal(/[^\x00-\x7f]/.test(value), false, `Non-ASCII in ${full}`);
        assert.equal(/[\t ]+$/m.test(value), false, `Trailing whitespace in ${full}`);
      }
    }
  };
  inspect(root);
});
