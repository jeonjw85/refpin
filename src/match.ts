import type { CodeAnchor, LineRange } from "./types.js";
import { findSequences } from "./text.js";
import { selectOccurrences } from "./overlap.js";

function hasEvidence(context: readonly string[]): boolean {
  return context.join("").replace(/\s/g, "").length >= 8;
}

interface Candidate {
  start: number;
  end: number;
  score: number;
  contexts: number;
  matched: number;
  bounded: boolean;
}

function boundedCandidates(
  starts: number[], ends: number[], maxLength: number,
): { candidates: Candidate[]; deletedBoundaries: number[] } {
  const candidates: Candidate[] = [];
  const deletedBoundaries: number[] = [];
  let endIndex = 0;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    while (endIndex < ends.length && ends[endIndex]! < start) endIndex++;
    const end = ends[endIndex];
    if (end === undefined) break;
    // Pair adjacent boundary occurrences, rather than spanning another copy.
    const nextStart = starts[i + 1];
    if (nextStart !== undefined && nextStart <= end) continue;
    if (end === start) deletedBoundaries.push(start);
    if (end > start && end - start <= maxLength) {
      candidates.push({ start, end, score: 0, contexts: 2, matched: 0, bounded: true });
    }
  }
  return { candidates, deletedBoundaries };
}

interface Fingerprint {
  text: string;
  bigrams: Map<string, number>;
  count: number;
}

function fingerprint(line: string): Fingerprint {
  const text = line.trim().replace(/\s+/g, " ");
  const characters = Array.from(text);
  const bigrams = new Map<string, number>();
  for (let i = 1; i < characters.length; i++) {
    const pair = characters[i - 1]! + characters[i]!;
    bigrams.set(pair, (bigrams.get(pair) ?? 0) + 1);
  }
  return { text, bigrams, count: Math.max(0, characters.length - 1) };
}

function similarity(a: Fingerprint, b: Fingerprint): number {
  if (a.text === b.text) return 1;
  if (a.count === 0 || b.count === 0) return 0;
  let common = 0;
  for (const [pair, count] of a.bigrams) common += Math.min(count, b.bigrams.get(pair) ?? 0);
  return 2 * common / (a.count + b.count);
}

interface Alignment {
  cost: number;
  /** Sorted, disjoint inclusive ranges of tied starts. */
  starts: readonly number[];
  matched: number;
}

const EPSILON = 1e-9;
const CONTEXT_THRESHOLD = 0.65;
const CONTENT_THRESHOLD = 0.85;

function mergeStarts(a: readonly number[], b: readonly number[]): readonly number[] {
  if (a === b || b.length === 0) return a;
  if (a.length === 0) return b;
  const merged: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const next = j >= b.length || (i < a.length && a[i]! <= b[j]!) ? a : b;
    const index = next === a ? i : j;
    const start = next[index]!;
    const end = next[index + 1]!;
    if (next === a) i += 2;
    else j += 2;
    if (merged.length > 0 && start <= merged[merged.length - 1]! + 1) {
      merged[merged.length - 1] = Math.max(merged[merged.length - 1]!, end);
    } else merged.push(start, end);
  }
  return merged;
}

function chooseAlignment(a: Alignment, b: Alignment): Alignment {
  if (Math.abs(a.cost - b.cost) > EPSILON) return a.cost < b.cost ? a : b;
  if (Math.abs(a.matched - b.matched) > EPSILON) return a.matched > b.matched ? a : b;
  // Span preference is not additive; defer it until the full anchor is aligned.
  return { cost: a.cost, matched: a.matched, starts: mergeStarts(a.starts, b.starts) };
}

function completedStart(
  alignment: Alignment, end: number, length: number, maxLength: number, positions?: readonly number[],
): number | undefined {
  let best: number | undefined;
  let bestDelta = Infinity;
  function consider(start: number): void {
    if (start >= end || end - start > maxLength) return;
    const delta = Math.abs(end - start - length);
    if (delta < bestDelta || (delta === bestDelta && start < best!)) {
      best = start;
      bestDelta = delta;
    }
  }
  for (let i = 0; i < alignment.starts.length; i += 2) {
    if (positions) {
      const first = alignment.starts[i]!;
      const last = alignment.starts[i + 1]!;
      const target = Math.max(end - maxLength, end - length);
      let left = first;
      let right = last + 1;
      while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (positions[middle]! < target) left = middle + 1;
        else right = middle;
      }
      consider(positions[Math.max(first, left - 1)]!);
      consider(positions[Math.min(last, left)]!);
      continue;
    }
    const first = Math.max(alignment.starts[i]!, end - maxLength);
    const last = Math.min(alignment.starts[i + 1]!, end - 1);
    if (first > last) continue;
    consider(Math.max(first, Math.min(last, end - length)));
  }
  return best;
}

function initialAlignments(length: number, start: number, enabled = true): Alignment[] {
  return Array.from({ length: length + 1 }, (_, i) => ({
    cost: enabled ? i : Infinity, starts: enabled ? [start, start] : [], matched: 0,
  }));
}

function advanceAlignments(
  previous: Alignment[], scores: number[], first: Alignment, margin: number,
): Alignment[] {
  const current = [first];
  for (let i = 1; i <= scores.length; i++) {
    const score = scores[i - 1]!;
    const diagonal = previous[i - 1]!;
    const substitution = { cost: diagonal.cost + 1 - score - margin, starts: diagonal.starts, matched: diagonal.matched + score };
    const insertion = { ...previous[i]!, cost: previous[i]!.cost + 1 - margin };
    const deletion = { ...current[i - 1]!, cost: current[i - 1]!.cost + 1 };
    current.push(chooseAlignment(chooseAlignment(substitution, insertion), deletion));
  }
  return current;
}

function similarCandidates(
  selected: readonly string[], lines: readonly string[],
  starts: Set<number>, ends: Set<number>, maxLength: number, blockedLines: Set<number>,
): Candidate[] {
  const original = selected.map(fingerprint);
  const length = original.length;
  // Leading-context starts may be sparse in line coordinates. Compress their
  // ordinals instead, so adjacent allowed starts still form a single range.
  const supportedStarts = [...starts].sort((a, b) => a - b);
  const ordinals = new Map(supportedStarts.map((start, index) => [start, index]));
  function search(margin: number, context: "none" | "before" | "after") {
    return {
      margin, context,
      positions: context === "before" ? supportedStarts : undefined,
      previous: initialAlignments(length, 0, context !== "before" || starts.has(0)),
    };
  }
  // cost <= margin * max(length, span) is equivalent to either
  // cost <= margin * length or cost - margin * span <= 0.
  // Retain both objectives; minimum raw cost alone can discard a qualifying span.
  const searches = [search(0, "none")];
  if (starts.size > 0) searches.push(search(0, "before"));
  searches.push(search(1 - CONTENT_THRESHOLD, "none"));
  if (starts.size > 0) searches.push(search(1 - CONTEXT_THRESHOLD, "before"));
  if (ends.size > 0) searches.push(search(1 - CONTEXT_THRESHOLD, "after"));
  const candidates: Candidate[] = [];
  for (let j = 0; j < lines.length; j++) {
    const end = j + 1;
    // Empty context pairs prove deletion here; do not align against their delimiters.
    if (blockedLines.has(j)) {
      for (const item of searches) {
        const start = item.positions ? ordinals.get(end) : end;
        item.previous = initialAlignments(length, start ?? 0, start !== undefined);
      }
      continue;
    }
    const line = fingerprint(lines[j]!);
    const scores = original.map((item) => similarity(item, line));
    let rawAccepted = false;
    for (const item of searches) {
      const position = item.positions ? ordinals.get(end) : end;
      const first = position !== undefined ? { cost: 0, starts: [position, position], matched: 0 }
        : { ...item.previous[0]!, cost: item.previous[0]!.cost + 1 - item.margin };
      item.previous = advanceAlignments(item.previous, scores, first, item.margin);
      // Keep the existing boundary preference when raw-cost matching already qualifies.
      if (item.margin > 0 && rawAccepted) continue;
      if (item.context === "after" && !ends.has(end)) continue;
      const alignment = item.previous[length]!;
      const start = completedStart(alignment, end, length, maxLength, item.positions);
      if (start === undefined) continue;
      const span = end - start;
      const cost = alignment.cost + item.margin * span;
      const score = Math.max(0, 1 - cost / Math.max(length, span));
      const contexts = Number(starts.has(start)) + Number(ends.has(end));
      if (score + EPSILON >= (contexts > 0 ? CONTEXT_THRESHOLD : CONTENT_THRESHOLD)) {
        if (item.margin === 0) rawAccepted = true;
        candidates.push({
          start, end, score, contexts, matched: alignment.matched, bounded: false,
        });
      }
    }
  }
  return candidates;
}

export function findChangedRanges(anchor: CodeAnchor, lines: readonly string[]): LineRange[] {
  const { before, after } = anchor.context;
  const starts = hasEvidence(before)
    ? findSequences(lines, before).map((start) => start + before.length) : [];
  const ends = hasEvidence(after) ? findSequences(lines, after) : [];
  const selected = anchor.content.split("\n");
  const length = selected.length;
  const maxLength = Math.max(length * 2, length + 3);
  const bounded = boundedCandidates(starts, ends, maxLength);
  const blockedLines = new Set<number>();
  for (const boundary of bounded.deletedBoundaries) {
    for (let i = boundary - before.length; i < boundary + after.length; i++) blockedLines.add(i);
  }
  const candidates = bounded.candidates.concat(
    similarCandidates(selected, lines, new Set(starts), new Set(ends), maxLength, blockedLines));
  candidates.sort((a, b) => Number(b.bounded) - Number(a.bounded) || b.score - a.score ||
    b.contexts - a.contexts || b.matched - a.matched ||
    Math.abs(a.end - a.start - length) - Math.abs(b.end - b.start - length) || a.start - b.start);

  function complete(candidate: Candidate): boolean {
    return !candidate.bounded && candidate.end - candidate.start === length &&
      Math.abs(candidate.matched - candidate.score * length) <= EPSILON;
  }
  // Equally supported gap-free full alignments at different starts are distinct,
  // even when their ranges overlap. Weaker boundary variants still consolidate.
  const occurrences = selectOccurrences(candidates, (a, b) =>
    Math.abs(a.score - b.score) <= EPSILON && complete(a) && complete(b));
  return occurrences.sort((a, b) => a.start - b.start || a.end - b.end)
    .map(({ start, end }) => ({ startLine: start + 1, endLine: end }));
}
