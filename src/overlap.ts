/** Select distinct occurrences from nonempty, nonnegative half-open ranges in priority order. */
export function selectOccurrences<T extends { start: number; end: number }>(
  candidates: readonly T[], distinct?: (a: T, b: T) => boolean,
): T[] {
  if (candidates.length === 0) return [];

  // Compress starts so index memory depends on candidate count, not file length.
  const starts = [...new Set(candidates.map((candidate) => candidate.start))].sort((a, b) => a - b);
  let size = 1;
  while (size < starts.length) size *= 2;
  const maxEnds = new Float64Array(size * 2);
  const leaves = new Map(starts.map((start, index) => [start, size + index]));
  const accepted = new Array<T | undefined>(starts.length);

  function hasDuplicate(candidate: T, node = 1, left = 0, right = size): boolean {
    const { start, end } = candidate;
    if (maxEnds[node]! <= start || left >= starts.length || starts[left]! >= end) return false;
    if (right - left === 1) {
      const otherStart = starts[left]!;
      const otherEnd = maxEnds[node]!;
      const overlap = Math.min(end, otherEnd) - Math.max(start, otherStart);
      return overlap >= Math.min(end - start, otherEnd - otherStart) / 2 &&
        (start === otherStart || !distinct?.(candidate, accepted[left]!));
    }
    const middle = Math.floor((left + right) / 2);
    return hasDuplicate(candidate, node * 2, left, middle) ||
      hasDuplicate(candidate, node * 2 + 1, middle, right);
  }

  const occurrences: T[] = [];
  for (const candidate of candidates) {
    if (hasDuplicate(candidate)) continue;
    occurrences.push(candidate);

    // Only accepted intervals may suppress later candidates. Same-start intervals
    // always duplicate the shorter interval, so each leaf needs only one end.
    let node = leaves.get(candidate.start)!;
    accepted[node - size] = candidate;
    maxEnds[node] = candidate.end;
    while (node > 1) {
      node = Math.floor(node / 2);
      maxEnds[node] = Math.max(maxEnds[node * 2]!, maxEnds[node * 2 + 1]!);
    }
  }
  return occurrences;
}
