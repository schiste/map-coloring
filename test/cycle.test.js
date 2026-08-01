import test from "node:test";
import assert from "node:assert/strict";

import { getNextColorIndex } from "../js/cycle.js";

test("cycles through every color before returning to uncolored", () => {
  const paletteLength = 3;
  const sequence = [];
  let current = null;

  for (let step = 0; step <= paletteLength; step += 1) {
    current = getNextColorIndex(current, paletteLength);
    sequence.push(current);
  }

  assert.deepEqual(sequence, [0, 1, 2, null]);
});

test("rejects invalid palette lengths and current indexes", () => {
  assert.throws(() => getNextColorIndex(null, 1), RangeError);
  assert.throws(() => getNextColorIndex(3, 3), RangeError);
});
