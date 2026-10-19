import assert from "node:assert/strict";
import test from "node:test";
import { selectOccurrences } from "../dist/esm/overlap.js";

test("retains disjoint intervals and touching half-open boundaries", () => {
  const ranges = [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 10, end: 12 }];
  assert.deepEqual(selectOccurrences(ranges), ranges);
});

test("suppresses half-overlap but does not index a rejected candidate", () => {
  const first = { start: 0, end: 10 };
  const rejected = { start: 8, end: 12 };
  const survivor = { start: 9, end: 13 };
  assert.deepEqual(selectOccurrences([first, rejected, survivor]), [first, survivor]);
});

test("uses the exact half-length threshold for odd-length intervals", () => {
  const first = { start: 0, end: 10 };
  const oneLineOverlap = { start: 9, end: 12 };
  const twoLineOverlap = { start: 8, end: 11 };
  assert.deepEqual(selectOccurrences([first, oneLineOverlap, twoLineOverlap]), [first, oneLineOverlap]);
});

test("preserves priority for containment in either direction", () => {
  const small = { start: 3, end: 5 };
  const large = { start: 0, end: 10 };
  assert.deepEqual(selectOccurrences([small, large]), [small]);
  assert.deepEqual(selectOccurrences([large, small]), [large]);
});

test("preserves priority order and original objects without mutating input", () => {
  const first = Object.freeze({ start: 20, end: 26, score: 0.99 });
  const second = Object.freeze({ start: 0, end: 6, score: 0.95 });
  const third = Object.freeze({ start: 22, end: 24, score: 0.9 });
  const input = Object.freeze([first, second, third]);
  const result = selectOccurrences(input);
  assert.deepEqual(result, [first, second]);
  assert.equal(result[0], first);
  assert.equal(result[1], second);
});

test("keeps only the highest-ranked interval at a shared start", () => {
  assert.deepEqual(selectOccurrences([
    { start: 5, end: 10 }, { start: 5, end: 6 }, { start: 5, end: 30 }, { start: 5, end: 10 },
  ]), [{ start: 5, end: 10 }]);
});

test("searches across occupied ranges while retaining intervals in gaps", () => {
  const kept = [
    { start: 0, end: 2 }, { start: 10, end: 12 },
    { start: 20, end: 22 }, { start: 30, end: 32 },
  ];
  const gap = { start: 5, end: 8 };
  assert.deepEqual(selectOccurrences([...kept, { start: 3, end: 29 }, gap]), [...kept, gap]);
});

test("supports sparse coordinates without allocating by file length", () => {
  const ranges = [{ start: 0, end: 1 }, { start: 1_000_000_000, end: 1_000_000_001 }];
  assert.deepEqual(selectOccurrences(ranges), ranges);
  assert.deepEqual(selectOccurrences([]), []);
});

test("retains independently supported overlaps without duplicating a shared start", () => {
  const first = { start: 0, end: 2, complete: true };
  const sameStart = { start: 0, end: 3, complete: true };
  const second = { start: 1, end: 3, complete: true };
  const fragment = { start: 1, end: 2, complete: false };
  assert.deepEqual(selectOccurrences([first, sameStart, second, fragment],
    (a, b) => a.complete && b.complete), [first, second]);
});

// Independent brute-force oracle for the greedy half-overlap contract.
function referenceSelection(ranges, distinct) {
  const kept = [];
  for (const range of ranges) {
    const duplicate = kept.some((other) => {
      const intersection = Math.min(range.end, other.end) - Math.max(range.start, other.start);
      return intersection >= Math.min(range.end - range.start, other.end - other.start) / 2 &&
        (range.start === other.start || !distinct?.(range, other));
    });
    if (!duplicate) kept.push(range);
  }
  return kept;
}

test("matches brute-force selection across deterministic interval arrangements", () => {
  let seed = 0x5eed;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let sample = 0; sample < 300; sample++) {
    const ranges = Array.from({ length: 20 + random() % 60 }, (_, id) => {
      const start = random() % 200;
      return { start, end: start + 1 + random() % 50, id };
    });
    assert.deepEqual(selectOccurrences(ranges), referenceSelection(ranges), `sample ${sample}`);
    const distinct = (a, b) => a.id % 3 !== b.id % 3;
    assert.deepEqual(selectOccurrences(ranges, distinct), referenceSelection(ranges, distinct),
      `independent overlaps in sample ${sample}`);
  }
});
