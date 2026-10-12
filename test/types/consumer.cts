import refpin = require("refpin");

const anchor: refpin.CodeAnchor = refpin.createAnchor("hello", {
  file: "a.ts", startLine: 1, endLine: 1,
});
const result: refpin.AnchorResult = refpin.checkAnchor(anchor, "hello");

if (result.status === "changed") {
  const text: string = result.diff.text;
  text.toUpperCase();
} else if (result.status === "ambiguous") {
  result.candidates.map((range: refpin.LineRange) => range.startLine);
} else if (result.status === "missing") {
  // @ts-expect-error A missing result does not have a diff.
  result.diff;
} else {
  const start: number = result.startLine;
  start.toFixed();
}
