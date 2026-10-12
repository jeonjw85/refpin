import assert from "node:assert/strict";
import test from "node:test";
import { checkAnchor, createAnchor } from "../dist/esm/index.js";

const options = { file: "src/auth.ts", startLine: 1, endLine: 1 };

test("stores the selected lines, UTF-8 fingerprint, and bounded context", () => {
  const anchor = createAnchor("before\nhello\nafter\n", {
    ...options, startLine: 2, endLine: 2,
  });
  assert.deepEqual(anchor, {
    version: 1,
    file: "src/auth.ts",
    startLine: 2,
    endLine: 2,
    content: "hello",
    hash: "fnv1a64:a430d84680aabd0b",
    context: { before: ["before"], after: ["after"] },
  });
});

test("captures three context lines by default and supports disabling context", () => {
  const source = "a\nb\nc\nd\nselected\ne\nf\ng\nh";
  const range = { ...options, startLine: 5, endLine: 5 };
  assert.deepEqual(createAnchor(source, range).context, {
    before: ["b", "c", "d"], after: ["e", "f", "g"],
  });
  assert.deepEqual(createAnchor(source, { ...range, contextLines: 0 }).context, {
    before: [], after: [],
  });
});

for (const [name, source, expected] of [
  ["unchanged", "hello\n", { status: "unchanged", startLine: 1, endLine: 1 }],
  ["moved", "// added\nhello\n", { status: "moved", startLine: 2, endLine: 2 }],
  ["empty file", "", { status: "missing" }],
  ["unrelated file", "\u4E16\u754C\u{1F98A}", { status: "missing" }],
  ["duplicate", "hello\nhello", {
    status: "ambiguous", candidates: [{ startLine: 1, endLine: 1 }, { startLine: 2, endLine: 2 }],
  }],
]) {
  test(`classifies ${name}`, () => {
    assert.deepEqual(checkAnchor(createAnchor("hello", options), source), expected);
  });
}

test("tracks a multi-line range upwards after preceding lines are removed", () => {
  const anchor = createAnchor("preamble\none\ntwo\n", {
    ...options, startLine: 2, endLine: 3,
  });
  assert.deepEqual(checkAnchor(anchor, "one\ntwo"), { status: "moved", startLine: 1, endLine: 2 });
});

test("counts overlapping exact matches", () => {
  const anchor = createAnchor("a\na", { ...options, endLine: 2 });
  assert.deepEqual(checkAnchor(anchor, "a\na\na"), {
    status: "ambiguous", candidates: [{ startLine: 1, endLine: 2 }, { startLine: 2, endLine: 3 }],
  });
});

test("does not mistake a substring of a line for an exact match", () => {
  const anchor = createAnchor("needle", options);
  const result = checkAnchor(anchor, "prefix needle suffix");
  assert.notEqual(result.status, "unchanged");
  assert.notEqual(result.status, "moved");
});

for (const newline of ["\n", "\r\n", "\r"]) {
  test(`normalizes ${JSON.stringify(newline)} without losing Unicode`, () => {
    const anchor = createAnchor(["\uC778\uC99D\u{1F510}", "return true;", ""].join(newline), {
      ...options, endLine: 2,
    });
    assert.equal(anchor.content, "\uC778\uC99D\u{1F510}\nreturn true;");
    assert.deepEqual(checkAnchor(anchor, "\uC778\uC99D\u{1F510}\nreturn true;"), {
      status: "unchanged", startLine: 1, endLine: 2,
    });
  });
}

test("retains intentional blank lines but does not count a final newline twice", () => {
  const anchor = createAnchor("a\n\n", { ...options, startLine: 2, endLine: 2 });
  assert.equal(anchor.content, "");
  assert.deepEqual(checkAnchor(anchor, "a\n\n"), { status: "unchanged", startLine: 2, endLine: 2 });
  assert.deepEqual(checkAnchor(anchor, "\n"), { status: "moved", startLine: 1, endLine: 1 });
  assert.throws(() => createAnchor("a\n", { ...options, endLine: 2 }), RangeError);
  assert.throws(() => createAnchor("", options), RangeError);
});

test("preserves a selected trailing blank line through JSON storage", () => {
  const anchor = createAnchor("a\n\n", { ...options, endLine: 2 });
  assert.equal(anchor.content, "a\n");
  assert.deepEqual(checkAnchor(JSON.parse(JSON.stringify(anchor)), "a\n\n"), {
    status: "unchanged", startLine: 1, endLine: 2,
  });
});

test("checks a frozen JSON-restored anchor without modifying it", () => {
  const anchor = JSON.parse(JSON.stringify(createAnchor("hello", options)));
  Object.freeze(anchor.context.before);
  Object.freeze(anchor.context.after);
  Object.freeze(anchor.context);
  Object.freeze(anchor);
  assert.deepEqual(checkAnchor(anchor, "added\nhello"), { status: "moved", startLine: 2, endLine: 2 });
  assert.equal(anchor.startLine, 1);
});

test("rejects invalid source, options, and file identifiers", () => {
  for (const source of [null, 12, {}, undefined]) {
    assert.throws(() => createAnchor(source, options), TypeError);
  }
  for (const value of [undefined, null, [], "options"]) {
    assert.throws(() => createAnchor("hello", value), TypeError);
  }
  for (const file of [null, 12, "", " \t "]) {
    assert.throws(() => createAnchor("hello", { ...options, file }), TypeError);
  }
});

test("rejects invalid range and context counts", () => {
  for (const change of [
    { startLine: 0 }, { startLine: -1 }, { startLine: 1.5 }, { startLine: NaN },
    { startLine: "1" }, { endLine: Infinity }, { endLine: 0 }, { endLine: 2 },
    { startLine: 2, endLine: 1 }, { contextLines: -1 }, { contextLines: 0.5 },
  ]) {
    assert.throws(() => createAnchor("hello", { ...options, ...change }), RangeError);
  }
});

test("rejects malformed, unsupported, or damaged stored anchors", () => {
  const anchor = createAnchor("hello", options);
  for (const value of [
    null, [], {}, { ...anchor, version: 2 }, { ...anchor, hash: "broken" },
    { ...anchor, content: "edited" }, { ...anchor, content: 4 },
    { ...anchor, context: { before: ["impossible"], after: [] } },
    { ...anchor, context: { before: [], after: ["embedded\nnewline"] } },
    { ...anchor, context: { before: [], after: [123] } },
  ]) {
    assert.throws(() => checkAnchor(value, "hello"), TypeError);
  }
  assert.throws(() => checkAnchor({ ...anchor, endLine: 2 }, "hello"), RangeError);
});

test("validates updated source and diff options even for an exact match", () => {
  const anchor = createAnchor("hello", options);
  assert.throws(() => checkAnchor(anchor, null), TypeError);
  for (const value of [null, [], "options"]) {
    assert.throws(() => checkAnchor(anchor, "hello", value), TypeError);
  }
  for (const maxDiffLines of [0, -1, 0.5, NaN, "20"]) {
    assert.throws(() => checkAnchor(anchor, "hello", { maxDiffLines }), RangeError);
  }
});

const boundedSource = "const before = true;\noldCall();\nconst after = true;";
const boundedOptions = { ...options, startLine: 2, endLine: 2, contextLines: 1 };
const sessionSource = [
  "// auth boundary before", "const SESSION_TTL = 3600;", "",
  "export function validateSession(session) {",
  "  if (!session) return false;",
  "  return session.expiresAt > Date.now();", "}", "",
  "export const authEnabled = true;", "// auth boundary after",
].join("\n");
const sessionOptions = { ...options, startLine: 4, endLine: 7 };

test("finds a replacement between preserved context and returns its diff", () => {
  const anchor = createAnchor(boundedSource, boundedOptions);
  assert.deepEqual(checkAnchor(anchor, boundedSource.replace("oldCall();", "newCall();")), {
    status: "changed", startLine: 2, endLine: 2,
    diff: { text: "@@ -2,1 +2,1 @@\n-oldCall();\n+newCall();", truncated: false },
  });
});

test("reports current coordinates for a moved and fully replaced block", () => {
  const anchor = createAnchor(boundedSource, boundedOptions);
  const updated = "// new header\n// another header\n" + boundedSource.replace("oldCall();", "\u5B8C\u5168\u306B\u65B0\u3057\u3044\u51E6\u7406();");
  const result = checkAnchor(anchor, updated);
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 4);
  assert.equal(result.endLine, 4);
  assert.match(result.diff.text, /@@ -2,1 \+4,1 @@/);
});

test("returns missing when the entire block between its contexts is removed", () => {
  const anchor = createAnchor(boundedSource, boundedOptions);
  assert.deepEqual(checkAnchor(anchor, boundedSource.replace("oldCall();\n", "")), { status: "missing" });
});

test("tracks internal insertions and extends the current end line", () => {
  const anchor = createAnchor(sessionSource, sessionOptions);
  const result = checkAnchor(anchor, sessionSource.replace("  return session", "  audit(session);\n  return session"));
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 4);
  assert.equal(result.endLine, 8);
  assert.match(result.diff.text, /\+  audit\(session\);/);
});

test("tracks internal deletions and shrinks the current end line", () => {
  const anchor = createAnchor(sessionSource, sessionOptions);
  const result = checkAnchor(anchor, sessionSource.replace("  if (!session) return false;\n", ""));
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 4);
  assert.equal(result.endLine, 6);
  assert.match(result.diff.text, /-  if \(!session\) return false;/);
});

test("returns both separately context-bounded replacements", () => {
  const anchor = createAnchor(boundedSource, boundedOptions);
  const changed = boundedSource.replace("oldCall();", "newCall();");
  assert.deepEqual(checkAnchor(anchor, changed + "\n// copy\n" + changed), {
    status: "ambiguous", candidates: [{ startLine: 2, endLine: 2 }, { startLine: 6, endLine: 6 }],
  });
});

test("does not use braces alone as evidence for an unrelated replacement", () => {
  const anchor = createAnchor("{\nrareOriginal();\n}", boundedOptions);
  assert.deepEqual(checkAnchor(anchor, "{\n\u5B8C\u5168\u306B\u5225\u306E\u51E6\u7406\n}"), { status: "missing" });
});

test("ignores surrounding changes when the referenced content stays in place", () => {
  const anchor = createAnchor(boundedSource, boundedOptions);
  assert.deepEqual(checkAnchor(anchor, "different before\noldCall();\ndifferent after"), {
    status: "unchanged", startLine: 2, endLine: 2,
  });
});

test("prefers one exact occurrence over additional modified occurrences", () => {
  const anchor = createAnchor(boundedSource, boundedOptions);
  assert.deepEqual(checkAnchor(anchor, boundedSource + "\n" + boundedSource.replace("oldCall", "newCall")), {
    status: "unchanged", startLine: 2, endLine: 2,
  });
});

test("applies the caller's diff preview limit to changed results", () => {
  const anchor = createAnchor(boundedSource, boundedOptions);
  const result = checkAnchor(anchor, boundedSource.replace("oldCall", "newCall"), { maxDiffLines: 1 });
  assert.equal(result.status, "changed");
  assert.deepEqual(result.diff, { text: "@@ -2,1 +2,1 @@", truncated: true });
});

const standaloneFunction = [
  "function validateSession(session) {",
  "  if (!session) return false;",
  "  return session.expiresAt > Date.now();", "}",
].join("\n");
const standaloneOptions = { ...options, endLine: 4, contextLines: 0 };

test("locates moved and edited content without saved surrounding context", () => {
  const anchor = createAnchor(standaloneFunction, standaloneOptions);
  const result = checkAnchor(anchor, "// moved\n" + standaloneFunction.replace(" > ", " >= "));
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 2);
  assert.equal(result.endLine, 5);
  assert.match(result.diff.text, /\+  return session.expiresAt >= Date.now\(\);/);
});

test("retains separate edited occurrences even when their similarity differs", () => {
  const anchor = createAnchor(standaloneFunction, standaloneOptions);
  const updated = standaloneFunction.replace(" > ", " >= ") + "\n// divider\n" +
    standaloneFunction.replace("Date.now()", "currentTimestamp()");
  assert.deepEqual(checkAnchor(anchor, updated), {
    status: "ambiguous", candidates: [{ startLine: 1, endLine: 4 }, { startLine: 6, endLine: 9 }],
  });
});

test("uses surviving leading context to locate a block with an inserted line", () => {
  const anchor = createAnchor(sessionSource, sessionOptions);
  const updated = sessionSource.replace("  return session", "  audit(session);\n  return session")
    .replace("export const authEnabled = true;", "// changed configuration");
  const result = checkAnchor(anchor, updated);
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 4);
  assert.equal(result.endLine, 8);
});

test("uses surviving trailing context to locate a block with a deleted line", () => {
  const anchor = createAnchor(sessionSource, sessionOptions);
  const updated = sessionSource.replace("  if (!session) return false;\n", "")
    .replace("const SESSION_TTL = 3600;", "// changed configuration");
  const result = checkAnchor(anchor, updated);
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 4);
  assert.equal(result.endLine, 6);
});

test("detects indentation changes instead of normalizing them away", () => {
  const anchor = createAnchor(standaloneFunction, standaloneOptions);
  const result = checkAnchor(anchor, standaloneFunction.replace(/^/gm, "  "));
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 1);
  assert.equal(result.endLine, 4);
  assert.match(result.diff.text, /\+  function validateSession/);
});

test("finds a Unicode line with a small edit", () => {
  const source = 'const message = "\uB85C\uADF8\uC778 \uC138\uC158 \uAC80\uC99D \uC644\uB8CC \u{2705}";';
  const anchor = createAnchor(source, { ...options, contextLines: 0 });
  const result = checkAnchor(anchor, source.replace("\u{2705}", "\u{1F510}"));
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 1);
  assert.equal(result.endLine, 1);
  assert.match(result.diff.text, /\+const message = "\uB85C\uADF8\uC778 \uC138\uC158 \uAC80\uC99D \uC644\uB8CC \u{1F510}";/u);
});

test("does not guess from position when no plausible content survives", () => {
  const anchor = createAnchor(standaloneFunction, standaloneOptions);
  assert.deepEqual(checkAnchor(anchor, "// \u{1F332}\u{1F332}\u{1F332}\n\u5B8C\u5168\u306B\u7121\u95A2\u4FC2\n\u{1F30A}\u{1F30A}\u{1F30A}\n"), { status: "missing" });
  assert.deepEqual(checkAnchor(createAnchor("x", options), "y"), { status: "missing" });
});

test("collapses boundary variants of one long edited occurrence", () => {
  const source = Array.from({ length: 12 }, (_, i) => `  step_${i}(session);`).join("\n");
  const anchor = createAnchor(source, { ...options, endLine: 12, contextLines: 0 });
  const result = checkAnchor(anchor, "// moved\n" + source.replace("step_6", "step_six") + "\n// end");
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 2);
  assert.equal(result.endLine, 13);
});

test("does not span a large unrelated replacement between old contexts", () => {
  const anchor = createAnchor(boundedSource, boundedOptions);
  const replacement = Array.from({ length: 8 }, () => "\u5B8C\u5168\u306B\u5225\u306E\u51E6\u7406").join("\n");
  assert.deepEqual(checkAnchor(anchor, boundedSource.replace("oldCall();", replacement)), { status: "missing" });
});

test("does not attach a deleted interval to its surviving context", () => {
  const source = "const before = true;\nconst middle = true;\nconst after = true;";
  const anchor = createAnchor(source, boundedOptions);
  assert.deepEqual(checkAnchor(anchor, "const before = true;\nconst after = true;"), { status: "missing" });
});

test("keeps an independent relocated edit after deleting the original occurrence", () => {
  const source = "const before = true;\nconst middleValue = 1000;\nconst after = true;";
  const anchor = createAnchor(source, boundedOptions);
  const result = checkAnchor(anchor,
    "const before = true;\nconst after = true;\n// relocated\nconst middleValue = 1001;");
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 4);
  assert.equal(result.endLine, 4);
});

test("resolves equal-cost alignments using the completed interval length", () => {
  const anchor = createAnchor("A\nB\nC\nD\nE\nF\nAFTER_BOUNDARY", {
    ...options, endLine: 6, contextLines: 1,
  });
  const result = checkAnchor(anchor, "X\nB\nC\nZ\nD\nE\nF\nAFTER_BOUNDARY");
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 2);
  assert.equal(result.endLine, 7);
  assert.match(result.diff.text, /-A/);
  assert.doesNotMatch(result.diff.text, /\+X/);
});

test("retains a context-supported candidate when its first selected line is deleted", () => {
  const anchor = createAnchor("BEFORE_BOUNDARY\nA\nB\nC", {
    ...options, startLine: 2, endLine: 4, contextLines: 1,
  });
  const result = checkAnchor(anchor, "BEFORE_BOUNDARY\nB\nC");
  assert.equal(result.status, "changed");
  assert.equal(result.startLine, 2);
  assert.equal(result.endLine, 3);
  assert.equal(result.diff.text, "@@ -2,3 +2,2 @@\n-A\n B\n C");
});

test("retains multiple context-supported survivors after leading deletions", () => {
  const anchor = createAnchor("BEFORE_BOUNDARY\nA\nB\nC", {
    ...options, startLine: 2, endLine: 4, contextLines: 1,
  });
  assert.deepEqual(checkAnchor(anchor, "BEFORE_BOUNDARY\nB\nC\nseparator\nBEFORE_BOUNDARY\nB\nC"), {
    status: "ambiguous", candidates: [{ startLine: 2, endLine: 3 }, { startLine: 6, endLine: 7 }],
  });
});
