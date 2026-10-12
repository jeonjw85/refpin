import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import * as esm from "refpin";

const commonjs = createRequire(import.meta.url)("refpin");
const source = "const before = true;\noldCall();\nconst after = true;";

for (const [format, api] of [["ESM", esm], ["CommonJS", commonjs]]) {
  test(`${format} package exports implement all five outcomes`, () => {
    const anchor = api.createAnchor(source, { file: "a.ts", startLine: 2, endLine: 2 });
    assert.deepEqual(api.checkAnchor(anchor, source), { status: "unchanged", startLine: 2, endLine: 2 });
    assert.deepEqual(api.checkAnchor(anchor, "// header\n" + source), { status: "moved", startLine: 3, endLine: 3 });
    assert.deepEqual(api.checkAnchor(anchor, source.replace("oldCall", "newCall")), {
      status: "changed", startLine: 2, endLine: 2,
      diff: { text: "@@ -2,1 +2,1 @@\n-oldCall();\n+newCall();", truncated: false },
    });
    assert.deepEqual(api.checkAnchor(anchor, ""), { status: "missing" });
    assert.deepEqual(api.checkAnchor(anchor, source + "\n" + source), {
      status: "ambiguous", candidates: [{ startLine: 2, endLine: 2 }, { startLine: 5, endLine: 5 }],
    });
  });
}

test("anchors can be passed between ESM and CommonJS through JSON", () => {
  const anchor = esm.createAnchor(source, { file: "a.ts", startLine: 2, endLine: 2 });
  assert.deepEqual(commonjs.checkAnchor(JSON.parse(JSON.stringify(anchor)), "// header\n" + source), {
    status: "moved", startLine: 3, endLine: 3,
  });
});
