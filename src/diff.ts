interface Edit {
  kind: " " | "-" | "+";
  text: string;
}

function middleEdits(before: readonly string[], after: readonly string[]): Edit[] {
  // A coarse replacement remains truthful when a minimal diff is too expensive.
  if (before.length === 0 || after.length === 0 || before.length * after.length > 250_000) {
    return before.map((text): Edit => ({ kind: "-", text }))
      .concat(after.map((text): Edit => ({ kind: "+", text })));
  }
  const width = after.length + 1;
  const lcs = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lcs[i * width + j] = before[i] === after[j]
        ? 1 + lcs[(i + 1) * width + j + 1]!
        : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      edits.push({ kind: " ", text: before[i++]! });
      j++;
    } else if (i < before.length && (j === after.length ||
      lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) {
      edits.push({ kind: "-", text: before[i++]! });
    } else {
      edits.push({ kind: "+", text: after[j++]! });
    }
  }
  return edits;
}

function lineEdits(before: readonly string[], after: readonly string[]): Edit[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  return before.slice(0, prefix).map((text): Edit => ({ kind: " ", text }))
    .concat(middleEdits(before.slice(prefix, before.length - suffix), after.slice(prefix, after.length - suffix)))
    .concat(before.slice(before.length - suffix).map((text): Edit => ({ kind: " ", text })));
}

export function createDiff(
  before: readonly string[], after: readonly string[],
  oldStart: number, newStart: number, maxLines: number,
): { text: string; truncated: boolean } {
  const edits = lineEdits(before, after);
  const hunks: { start: number; end: number }[] = [];
  const oldPositions = [oldStart];
  const newPositions = [newStart];
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    oldPositions.push(oldPositions[i]! + (edit.kind === "+" ? 0 : 1));
    newPositions.push(newPositions[i]! + (edit.kind === "-" ? 0 : 1));
    if (edit.kind === " ") continue;
    const start = Math.max(0, i - 2);
    const end = Math.min(edits.length, i + 3);
    const previous = hunks[hunks.length - 1];
    if (previous && start <= previous.end) previous.end = end;
    else hunks.push({ start, end });
  }

  const output: string[] = [];
  for (const hunk of hunks) {
    const oldCount = oldPositions[hunk.end]! - oldPositions[hunk.start]!;
    const newCount = newPositions[hunk.end]! - newPositions[hunk.start]!;
    const oldLine = oldPositions[hunk.start]! - (oldCount === 0 ? 1 : 0);
    const newLine = newPositions[hunk.start]! - (newCount === 0 ? 1 : 0);
    if (output.length === maxLines) return { text: output.join("\n"), truncated: true };
    output.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`);
    for (let i = hunk.start; i < hunk.end; i++) {
      if (output.length === maxLines) return { text: output.join("\n"), truncated: true };
      output.push(edits[i]!.kind + edits[i]!.text);
    }
  }
  return { text: output.join("\n"), truncated: false };
}
