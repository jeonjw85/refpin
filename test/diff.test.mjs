import assert from "node:assert/strict";
import test from "node:test";
import { createDiff } from "../dist/esm/diff.js";

test("shows a replacement with original and updated file coordinates", () => {
  assert.deepEqual(createDiff(["old"], ["new"], 40, 52, 20), {
    text: "@@ -40,1 +52,1 @@\n-old\n+new", truncated: false,
  });
});

test("shows inserted lines with unchanged surrounding context", () => {
  assert.deepEqual(createDiff(["a", "b"], ["a", "inserted", "b"], 10, 20, 20), {
    text: "@@ -10,2 +20,3 @@\n a\n+inserted\n b", truncated: false,
  });
});

test("shows deleted lines without losing the remaining context", () => {
  assert.deepEqual(createDiff(["a", "removed", "b"], ["a", "b"], 10, 20, 20), {
    text: "@@ -10,3 +20,2 @@\n a\n-removed\n b", truncated: false,
  });
});

test("uses zero-length unified coordinates for a pure insertion or deletion", () => {
  assert.equal(createDiff([], ["new"], 1, 1, 20).text, "@@ -0,0 +1,1 @@\n+new");
  assert.equal(createDiff(["old"], [], 1, 1, 20).text, "@@ -1,1 +0,0 @@\n-old");
});

test("splits distant edits into compact hunks with accurate line numbers", () => {
  const before = ["old1", "a", "b", "c", "d", "e", "f", "old2"];
  const after = ["new1", "a", "b", "c", "d", "e", "f", "new2"];
  assert.deepEqual(createDiff(before, after, 10, 20, 20), {
    text: "@@ -10,3 +20,3 @@\n-old1\n+new1\n a\n b\n@@ -15,3 +25,3 @@\n e\n f\n-old2\n+new2",
    truncated: false,
  });
});

test("keeps Unicode and indentation verbatim in a preview", () => {
  assert.equal(createDiff(["  \uC778\uC99D\u{1F510}"], ["\t\uC778\uC99D\u{2705}"], 1, 1, 20).text,
    "@@ -1,1 +1,1 @@\n-  \uC778\uC99D\u{1F510}\n+\t\uC778\uC99D\u{2705}");
});

test("counts headers in the preview limit and reports truncation", () => {
  assert.deepEqual(createDiff(["old"], ["new"], 40, 52, 1), {
    text: "@@ -40,1 +52,1 @@", truncated: true,
  });
  const before = Array.from({ length: 25 }, (_, i) => `old ${i}`);
  const after = Array.from({ length: 25 }, (_, i) => `new ${i}`);
  const result = createDiff(before, after, 1, 1, 20);
  assert.equal(result.text.split("\n").length, 20);
  assert.equal(result.truncated, true);
  assert.equal(createDiff(["old"], ["new"], 1, 1, 3).truncated, false);
});

test("represents large replacements accurately with bounded LCS work", () => {
  const before = Array.from({ length: 501 }, (_, i) => `old ${i}`);
  const after = Array.from({ length: 501 }, (_, i) => `new ${i}`);
  const result = createDiff(before, after, 1, 1, 2000);
  const lines = result.text.split("\n");
  assert.equal(lines[0], "@@ -1,501 +1,501 @@");
  assert.equal(lines[1], "-old 0");
  assert.equal(lines[501], "-old 500");
  assert.equal(lines[502], "+new 0");
  assert.equal(lines[1002], "+new 500");
  assert.equal(result.truncated, false);
});
