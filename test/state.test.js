import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_EXPORT_OPTIONS, parseSavedState } from "../js/state.js";

const current = { mapScope: "world", mapTitle: "File:World.svg", mapSelections: { world: "File:World.svg", continent: "File:Europe.svg" } };

test("old saved states load: country codes become country keys", () => {
  const saved = parseSavedState(JSON.stringify({
    palette: [{ color: "#112233", label: "A" }, { color: "not a colour", label: "" }],
    assignments: { FR: 0, de: 1, "country:IT": 0, "region:fr-75": 1, "unit:nyc": 0, "bogus key": 0, ES: 7 },
    mapTitle: "File:BlankMap-World.svg",
  }), current);
  assert.deepEqual(saved.assignments, {
    "country:fr": 0,
    "country:de": 1,
    "country:it": 0,
    "region:FR-75": 1,
    "unit:NYC": 0,
  });
  assert.equal(saved.palette[0].color, "#112233");
  assert.equal(saved.palette[1].color, "#2E6E65", "an invalid colour falls back to the default");
  assert.equal(saved.palette[1].label, "Category two");
  assert.equal(saved.mapTitle, "File:BlankMap-World.svg");
  assert.equal(saved.mapSelections.world, "File:BlankMap-World.svg");
  assert.deepEqual(saved.exportOptions, { ...DEFAULT_EXPORT_OPTIONS });
});

test("a generated map is restored with its settings, within limits", () => {
  const saved = parseSavedState(JSON.stringify({
    palette: [{ color: "#112233" }, { color: "#445566" }],
    assignments: { "region:US-09001": 1 },
    mapScope: "generated",
    generatedMap: {
      dataset: "us-counties",
      regions: [{ code: "USA", name: "United States" }, { code: "bad code!" }],
      spec: { width: 99999, labels: false, theme: "dark", bbox: "-80,40,-70,45", languages: ["fr", 3] },
    },
  }), current);
  assert.equal(saved.mapScope, "generated");
  assert.equal(saved.generatedMap.region, "USA");
  assert.deepEqual(saved.generatedMap.regions, [{ code: "USA", name: "United States" }]);
  assert.equal(saved.generatedMap.spec.width, 4000);
  assert.equal(saved.generatedMap.spec.labels, false);
  assert.equal(saved.generatedMap.spec.theme, "dark");
  // Any well-formed setting is kept; the form checks values against Map
  // Generator's description when it loads (mapgen-options.test.js).
  assert.deepEqual(saved.generatedMap.spec.languages, ["fr", 3]);
  // An unusable generated map doesn't leave the app on the generated scope.
  const broken = parseSavedState(JSON.stringify({
    palette: [{ color: "#112233" }, { color: "#445566" }],
    assignments: {},
    mapScope: "generated",
    generatedMap: { dataset: "../etc", region: "FRA" },
  }), current);
  assert.equal(broken.generatedMap, undefined);
  assert.equal(broken.mapScope, "world");
});

test("malformed saved states are dropped", () => {
  assert.equal(parseSavedState("{not json", current), null);
  assert.deepEqual(parseSavedState(JSON.stringify({ palette: "x", assignments: {} }), current), {});
  const tiny = parseSavedState(JSON.stringify({ palette: [{ color: "#000000" }], assignments: { FR: 2 } }), current);
  assert.equal(tiny.palette.length, 3, "fewer than two colours: the default palette");
  assert.deepEqual(tiny.assignments, { "country:fr": 2 });
});
