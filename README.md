# refpin

English | [Korean](README.ko.md)

A JavaScript / TypeScript library for storing source ranges as JSON anchors and checking their location and contents against an updated file.

Use it in agent memory, code review tools, documentation references, or saved code search results.

- Synchronous `createAnchor()` and `checkAnchor()` APIs
- `unchanged`, `moved`, `changed`, `missing`, and `ambiguous` results
- Current line ranges and short line-based diffs
- Node.js 22+, modern browsers, ESM, CommonJS, and TypeScript
- No runtime dependencies

## Getting started

```sh
npm install refpin
```

```js
import { createAnchor, checkAnchor } from "refpin";

const source = [
  "function validateSession(session) {",
  "  if (!session) return false;",
  "  return session.expiresAt > Date.now();",
  "}",
].join("\n");

const anchor = createAnchor(source, {
  file: "src/auth.ts",
  startLine: 1,
  endLine: 4,
});

checkAnchor(anchor, source);
// { status: "unchanged", startLine: 1, endLine: 4 }

checkAnchor(anchor, "// new header\n" + source);
// { status: "moved", startLine: 2, endLine: 5 }

const result = checkAnchor(anchor, source.replace(" > ", " >= "));
if (result.status === "changed") {
  console.log(result.startLine, result.endLine);
  console.log(result.diff.text);
  console.log(result.diff.truncated); // Whether the preview was truncated.
}
```

The same API is available through CommonJS:

```js
const { createAnchor, checkAnchor } = require("refpin");
```

Browser bundlers can use the same package import. Without a bundler, serve the entire `dist/esm/` directory and import `index.js`. The runtime must support ES2022 and `TextEncoder`.

```js
import { createAnchor, checkAnchor } from "/vendor/refpin/esm/index.js";
```

## Storing anchors

An anchor is a plain object containing a format version, file identifier, original line range, selected content, hash, and surrounding context.

```js
const saved = JSON.stringify(anchor);
const restored = JSON.parse(saved);
const latest = checkAnchor(restored, updatedSource);
```

`file` is identifying metadata. The caller supplies the updated source for that file and chooses where to store anchors. Checking an anchor does not modify it.

## API

### `createAnchor(source, options)`

| Option | Description | Default |
|---|---|---|
| `file` | Nonempty file identifier | Required |
| `startLine` | First selected line, starting at 1 | Required |
| `endLine` | Last selected line, inclusive | Required |
| `contextLines` | Context lines to store on each side, at least 0 | `3` |

The selected content is hashed with UTF-8 FNV-1a 64-bit and stored with the `fnv1a64:` prefix. Exact matches compare actual lines, rather than relying on the hash alone.

### `checkAnchor(anchor, updatedSource, options?)`

`options.maxDiffLines` limits the diff preview, including hunk headers. It defaults to `20` and must be an integer of at least 1.

| Status | Meaning | Additional fields |
|---|---|---|
| `unchanged` | One exact match at the original line range | `startLine`, `endLine` |
| `moved` | One exact match at a different line range | `startLine`, `endLine` |
| `changed` | One modified candidate identified by context or content | `startLine`, `endLine`, `diff` |
| `missing` | No candidate with sufficient evidence | None |
| `ambiguous` | Candidates at multiple distinct occurrences | `candidates: { startLine, endLine }[]` |

`diff` has the shape `{ text: string, truncated: boolean }`. It includes up to two context lines around changes, with `-` for removals and `+` for additions. When `truncated` is true, the text is a display preview, not an applicable patch.

```ts
import type { CodeAnchor, AnchorResult, LineRange } from "refpin";
```

Narrow `AnchorResult` by its `status` field. A `missing` result has no line range.

## Matching rules

1. Exact matching comes first. The entire updated file is searched for identical consecutive lines. Multiple matches return `ambiguous`, even when one remains at the original location.
2. Context matching identifies replacements between sufficiently informative surrounding lines. Context with fewer than eight non-whitespace characters is not used as evidence.
3. Similarity matching runs when no exact match exists. It accounts for inserted and deleted lines and compares line contents using bigram similarity. Candidates need a score of at least 0.65 with surviving context, or 0.85 without it.
4. Distance from the original line number does not select a winner. Overlapping boundary variants of one occurrence are consolidated; separate occurrences remain separate candidates.

`missing` means the reference could not be located with sufficient evidence. It can indicate deletion, a substantial rewrite, lost context, or a large change in length. Modified candidates are limited to `max(originalLineCount * 2, originalLineCount + 3)` lines. Similarity does not establish semantic or symbol identity.

The first version searches within the supplied file. Cross-file moves and symbol-based tracking are outside its scope.

### Lines and whitespace

- LF, CRLF, and lone CR line endings are treated equally.
- A final newline alone is not a change. `a\n` is one line; `a\n\n` is two.
- Spaces and indentation are preserved. Changes to either can produce `changed`.
- An empty source has zero lines. `\n` represents one empty line.
- Changes only to surrounding context leave the result `unchanged` when selected content and position remain the same.

### Errors

- `TypeError`: invalid source, options, anchor structure, unsupported format version, or a content hash mismatch.
- `RangeError`: invalid line ranges or numeric options.

## Development

```sh
npm ci                 # Install the locked development dependencies.
npm test               # Build ESM/CJS and run tests.
npm run typecheck      # Check library types.
npm pack --dry-run     # Inspect package contents.
```

To use an unpublished checkout, run `npm ci` and `npm run build` in that checkout, then run `npm install /absolute/path/to/refpin` in the consuming project.

## License

[MIT](LICENSE)
