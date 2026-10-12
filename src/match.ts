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
  starts: number[];
  matched: number;
}

const EPSILON = 1e-9;

function chooseAlignment(a: Alignment, b: Alignment): Alignment {
  if (Math.abs(a.cost - b.cost) > EPSILON) return a.cost < b.cost ? a : b;
  if (Math.abs(a.matched - b.matched) > EPSILON) return a.matched > b.matched ? a : b;
  // Span preference is not additive; defer it until the full anchor is aligned.
  return { cost: a.cost, matched: a.matched, starts: [...new Set([...a.starts, ...b.starts])] };
}

function completedStart(alignment: Alignment, end: number, length: number, maxLength: number): number | undefined {
  let best: number | undefined;
  for (const start of alignment.starts) {
    if (start === end || end - start > maxLength) continue;
    const delta = Math.abs(end - start - length);
    const bestDelta = best === undefined ? Infinity : Math.abs(end - best - length);
    if (delta < bestDelta || (delta === bestDelta && start < best!)) best = start;
  }
  return best;
}

function initialAlignments(length: number, start: number, enabled = true): Alignment[] {
  return Array.from({ length: length + 1 }, (_, i) => ({
    cost: enabled ? i : Infinity, starts: enabled ? [start] : [], matched: 0,
  }));
}

function advanceAlignments(previous: Alignment[], scores: number[], first: Alignment): Alignment[] {
  const current = [first];
  for (let i = 1; i <= scores.length; i++) {
    const score = scores[i - 1]!;
    const diagonal = previous[i - 1]!;
    const substitution = { cost: diagonal.cost + 1 - score, starts: diagonal.starts, matched: diagonal.matched + score };
    const insertion = { ...previous[i]!, cost: previous[i]!.cost + 1 };
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
  let previous = initialAlignments(length, 0);
  // Keep leading-context paths separate so a free-start path cannot discard them.
  let supported = starts.size > 0 ? initialAlignments(length, 0, starts.has(0)) : undefined;
  const candidates: Candidate[] = [];
  for (let j = 0; j < lines.length; j++) {
    const end = j + 1;
    // Empty context pairs prove deletion here; do not align against their delimiters.
    if (blockedLines.has(j)) {
      previous = initialAlignments(length, end);
      if (supported) supported = initialAlignments(length, end, starts.has(end));
      continue;
    }
    const line = fingerprint(lines[j]!);
    const scores = original.map((item) => similarity(item, line));
    previous = advanceAlignments(previous, scores, { cost: 0, starts: [end], matched: 0 });
    if (supported) {
      const first = starts.has(end) ? { cost: 0, starts: [end], matched: 0 }
        : { ...supported[0]!, cost: supported[0]!.cost + 1 };
      supported = advanceAlignments(supported, scores, first);
    }
    for (const alignment of [previous[length], supported?.[length]]) {
      if (!alignment) continue;
      const start = completedStart(alignment, end, length, maxLength);
      if (start === undefined) continue;
      const span = end - start;
      const score = Math.max(0, 1 - alignment.cost / Math.max(length, span));
      const contexts = Number(starts.has(start)) + Number(ends.has(end));
      if (score + EPSILON >= (contexts > 0 ? 0.65 : 0.85)) {
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

  const occurrences = selectOccurrences(candidates);
  return occurrences.sort((a, b) => a.start - b.start || a.end - b.end)
    .map(({ start, end }) => ({ startLine: start + 1, endLine: end }));
}
