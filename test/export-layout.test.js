import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAnchoredPosition,
  readableTextColor,
} from "../js/export-layout.js";

test("positions annotations at all nine viewBox anchors", () => {
  const viewBox = [-30, 60, 1000, 500];
  const size = [200, 100];
  const expected = {
    "top-left": { x: -10, y: 80 },
    "top-center": { x: 370, y: 80 },
    "top-right": { x: 750, y: 80 },
    "center-left": { x: -10, y: 260 },
    center: { x: 370, y: 260 },
    "center-right": { x: 750, y: 260 },
    "bottom-left": { x: -10, y: 440 },
    "bottom-center": { x: 370, y: 440 },
    "bottom-right": { x: 750, y: 440 },
  };

  for (const [position, coordinates] of Object.entries(expected)) {
    assert.deepEqual(
      calculateAnchoredPosition(position, viewBox, ...size, { margin: 20 }),
      coordinates,
    );
  }
});

test("reserves title space at the matching edge", () => {
  const position = calculateAnchoredPosition("top-center", [0, 0, 1000, 500], 200, 100, {
    margin: 20,
    topInset: 48,
  });

  assert.deepEqual(position, { x: 400, y: 68 });
});

test("chooses readable dark or light legend text", () => {
  assert.equal(readableTextColor("#fffefa"), "#18211d");
  assert.equal(readableTextColor("#172033"), "#ffffff");
  assert.equal(readableTextColor("invalid"), "#18211d");
});
