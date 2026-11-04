import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const integrity = JSON.parse(readFileSync(resolve(root, "integrity.json"), "utf8"));
const ignored = new Set(["node_modules", "build", "out", ".env", "render-props.json", "inputs.json", "audit-task.json", "audit.json", "applied-audit.json", "error_history.json"]);
const walk = (dir = "") => readdirSync(resolve(root, dir)).flatMap((name) => {
  if (!dir && ignored.has(name)) return [];
  const path = dir ? `${dir}/${name}` : name;
  const stat = lstatSync(resolve(root, path));
  assert(!stat.isSymbolicLink(), `Symlink not allowed: ${path}`);
  return stat.isDirectory() ? walk(path) : [path];
});
const actual = walk().filter((path) => path !== "integrity.json").sort();
assert.deepEqual(actual, Object.keys(integrity.files).sort(), "Archive membership differs from the frozen package");
for (const path of actual) {
  const bytes = readFileSync(resolve(root, path));
  assert.equal(bytes.length, integrity.files[path].bytes, `Size mismatch: ${path}`);
  assert.equal(sha(bytes), integrity.files[path].sha256, `Hash mismatch: ${path}`);
}
console.log(`Verified ${actual.length} frozen files. Run this before preparing or modifying an instance.`);
