/** Normalize line endings without inventing a line after the final newline. */
export function sourceLines(source: string): string[] {
  if (source === "") return [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const encoder = new TextEncoder();

export function contentHash(content: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of encoder.encode(content)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

/** KMP search over whole lines, including overlapping occurrences. */
export function findSequences(lines: readonly string[], sequence: readonly string[]): number[] {
  if (sequence.length === 0 || sequence.length > lines.length) return [];
  const prefix = new Array<number>(sequence.length).fill(0);
  for (let i = 1, matched = 0; i < sequence.length; i++) {
    while (matched > 0 && sequence[i] !== sequence[matched]) matched = prefix[matched - 1]!;
    if (sequence[i] === sequence[matched]) matched++;
    prefix[i] = matched;
  }

  const starts: number[] = [];
  for (let i = 0, matched = 0; i < lines.length; i++) {
    while (matched > 0 && lines[i] !== sequence[matched]) matched = prefix[matched - 1]!;
    if (lines[i] === sequence[matched]) matched++;
    if (matched === sequence.length) {
      starts.push(i - matched + 1);
      matched = prefix[matched - 1]!;
    }
  }
  return starts;
}
