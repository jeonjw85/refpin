import { createAnchor, checkAnchor } from "refpin";
import type { AnchorResult, CodeAnchor, CreateAnchorOptions, CheckAnchorOptions, LineRange } from "refpin";

const range: LineRange = { startLine: 1, endLine: 1 };
const options: CreateAnchorOptions = { file: "a.ts", ...range, contextLines: 3 };
const anchor: CodeAnchor = createAnchor("hello", options);
const checks: CheckAnchorOptions = { maxDiffLines: 20 };

function consume(result: AnchorResult): number {
  switch (result.status) {
    case "unchanged":
    case "moved":
      return result.startLine + result.endLine;
    case "changed":
      return result.diff.text.length + Number(result.diff.truncated);
    case "ambiguous":
      return result.candidates[0]?.startLine ?? 0;
    case "missing":
      // @ts-expect-error A missing result does not invent a location.
      result.startLine;
      return 0;
  }
}

consume(checkAnchor(anchor, "hello", checks));
// @ts-expect-error Source must be a string.
createAnchor(123, options);
