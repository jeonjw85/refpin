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
