/** A 1-based, inclusive range of source lines. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface CreateAnchorOptions extends LineRange {
  file: string;
  /** Number of surrounding lines to store on each side. Default: 3. */
  contextLines?: number;
}

export interface CheckAnchorOptions {
  /** Maximum diff preview lines, including hunk headers. Default: 20. */
  maxDiffLines?: number;
}

/** JSON-serializable reference; file is metadata, never read by the library. */
export interface CodeAnchor extends LineRange {
  version: 1;
  file: string;
  content: string;
  hash: string;
  context: { before: string[]; after: string[] };
}

export type AnchorResult =
  | ({ status: "unchanged" | "moved" } & LineRange)
  | ({ status: "changed"; diff: { text: string; truncated: boolean } } & LineRange)
  | { status: "missing" }
  | { status: "ambiguous"; candidates: LineRange[] };
