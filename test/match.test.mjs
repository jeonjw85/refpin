import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

for (const [name, count, context] of [
  ["a large unrelated rewrite", 1000, false],
  ["a rewrite with sparse repeated leading context", 1600, true],
]) test(`bounds synchronous work for ${name}`, () => {
  const entry = new URL("../dist/esm/index.js", import.meta.url).href;
  // A child can be interrupted even while matching blocks its event loop.
  // Leave ample headroom for CI; this guards against cubic tie copying.
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { createAnchor, checkAnchor } from ${JSON.stringify(entry)};
    const lines = Array(${count}).fill("original();");
    const source = (${context} ? ["BEFORE_BOUNDARY", ...lines] : lines).join("\\n");
    const updated = Array.from({ length: ${count} }, (_, i) =>
      ${context} && i % 2 === 0 ? "BEFORE_BOUNDARY" : "完全に別の処理").join("\\n");
    const anchor = createAnchor(source, {
      file: "a.ts", startLine: ${context ? 2 : 1}, endLine: ${count + (context ? 1 : 0)},
      contextLines: ${context ? 1 : 0},
    });
    console.log(JSON.stringify(checkAnchor(anchor, updated)));
  `], { encoding: "utf8", timeout: 5000 });
  assert.deepEqual(JSON.parse(output), { status: "missing" });
});
