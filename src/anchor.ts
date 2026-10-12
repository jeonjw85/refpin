import type { AnchorResult, CheckAnchorOptions, CodeAnchor, CreateAnchorOptions } from "./types.js";
import { contentHash, findSequences, sourceLines } from "./text.js";

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
}

function assertFile(file: unknown): asserts file is string {
  assertString(file, "file");
  if (file.trim().length === 0) throw new TypeError("file must not be empty");
}

function assertInteger(value: unknown, name: string, minimum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
  }
}

function assertRange(startLine: number, endLine: number): void {
  assertInteger(startLine, "startLine", 1);
  assertInteger(endLine, "endLine", startLine);
}

function assertContext(lines: unknown): asserts lines is string[] {
  if (!Array.isArray(lines)) throw new TypeError("context must contain line arrays");
  for (const line of lines) {
    if (typeof line !== "string" || /[\r\n]/.test(line)) {
      throw new TypeError("context entries must be strings without line endings");
    }
  }
}

function validateAnchor(anchor: CodeAnchor): void {
  assertObject(anchor, "anchor");
  if (anchor.version !== 1) throw new TypeError("unsupported anchor version");
  assertFile(anchor.file);
  assertRange(anchor.startLine, anchor.endLine);
  assertString(anchor.content, "anchor.content");
  if (anchor.content.includes("\r")) throw new TypeError("anchor.content must use LF line endings");
  if (anchor.content.split("\n").length !== anchor.endLine - anchor.startLine + 1) {
    throw new RangeError("anchor range does not match its content line count");
  }
  if (anchor.hash !== contentHash(anchor.content)) throw new TypeError("anchor content hash mismatch");
  assertObject(anchor.context, "anchor.context");
  assertContext(anchor.context.before);
  assertContext(anchor.context.after);
  if (anchor.context.before.length >= anchor.startLine) {
    throw new TypeError("anchor has more preceding context than its original position permits");
  }
}

/** Capture a 1-based inclusive range in a JSON-serializable reference. */
export function createAnchor(source: string, options: CreateAnchorOptions): CodeAnchor {
  assertString(source, "source");
  assertObject(options, "options");
  assertFile(options.file);
  assertRange(options.startLine, options.endLine);
  const contextLines = options.contextLines === undefined ? 3 : options.contextLines;
  assertInteger(contextLines, "contextLines", 0);
  const lines = sourceLines(source);
  if (options.endLine > lines.length) throw new RangeError("endLine exceeds source line count");
  const content = lines.slice(options.startLine - 1, options.endLine).join("\n");
  return {
    version: 1,
    file: options.file,
    startLine: options.startLine,
    endLine: options.endLine,
    content,
    hash: contentHash(content),
    context: {
      before: lines.slice(Math.max(0, options.startLine - 1 - contextLines), options.startLine - 1),
      after: lines.slice(options.endLine, options.endLine + contextLines),
    },
  };
}

/** Locate a stored reference in the supplied file contents without mutating it. */
export function checkAnchor(
  anchor: CodeAnchor, updatedSource: string, options: CheckAnchorOptions = {},
): AnchorResult {
  validateAnchor(anchor);
  assertString(updatedSource, "updatedSource");
  assertObject(options, "options");
  const maxDiffLines = options.maxDiffLines === undefined ? 20 : options.maxDiffLines;
  assertInteger(maxDiffLines, "maxDiffLines", 1);
  const lines = sourceLines(updatedSource);
  const selected = anchor.content.split("\n");
  const candidates = findSequences(lines, selected).map((start) => ({
    startLine: start + 1, endLine: start + selected.length,
  }));
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  if (candidates.length === 1) {
    const range = candidates[0]!;
    return { status: range.startLine === anchor.startLine ? "unchanged" : "moved", ...range };
  }
  return { status: "missing" };
}
