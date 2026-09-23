// Maphue on Map Generator maps, with recorded API responses
// (test/fixtures/mapgen, refreshed by record.sh): the SVG contract,
// colouring countries, subdivisions and data units, matching imported
// codes, and boundary-year crosswalks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DOMParser } from "linkedom";
import { parseDelimitedText } from "../js/csv.js";
import {
  assertSupportedMapgenSvg,
  buildGeneratedFeatureIndex,
  countFeaturesWithoutData,
  crosswalkAppliesTo,
  crosswalkHints,
  crosswalkId,
  generatedColorRules,
  getMapgenContractVersion,
  recodeWithCrosswalk,
  resolveGeneratedFeature,
} from "../js/map-generator.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/mapgen/${name}`, import.meta.url), "utf8");
const json = (name) => JSON.parse(fixture(name));
const parseSvg = (text) => new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
const palette = [
  { color: "#e85d3f", label: "One" },
  { color: "#2e6e65", label: "Two" },
  { color: "#e3b23c", label: "Three" },
];

/** Which paths each colour rule of `rules` fills (the rule's colour by path id). */
function paintedBy(svg, rules) {
  const fills = new Map();
  for (const rule of rules.split("\n").filter(Boolean)) {
    const [, selector, color] = /^(.*) \{ fill: (#[0-9a-f]{6}); \}$/i.exec(rule);
    for (const path of svg.querySelectorAll(selector)) fills.set(path.getAttribute("data-code"), color);
  }
  return fills;
}

// Countries resolve by ISO-2 code, as Maphue's country list does.
const countryCode = (value) => (/^[a-z]{2}$/i.test(String(value || "")) ? String(value).toUpperCase() : null);

test("reads the SVG contract version of generated maps", () => {
  const svg = fixture("contract-fixture.svg");
  assert.equal(getMapgenContractVersion(svg), 1);
  assert.equal(assertSupportedMapgenSvg(svg), 1);
  assert.throws(() => assertSupportedMapgenSvg(svg.replace('data-mapgen-contract="1"', 'data-mapgen-contract="2"')), /contract 2 is not supported/);
  assert.throws(() => assertSupportedMapgenSvg("<svg></svg>"), /no Maphue-compatible SVG contract/);
});

test("colours the contract fixture's regions by data-code", () => {
  const svg = parseSvg(fixture("contract-fixture.svg"));
  const rules = generatedColorRules({ "region:XA-01": 0, "region:XA-02": 2, "region:ZZ-99": 1 }, palette);
  assert.deepEqual(Object.fromEntries(paintedBy(svg, rules)), { "XA-01": "#e85d3f", "XA-02": "#e3b23c" });
});

test("colours a French départements map: countries, then units, then single regions", () => {
  const svg = parseSvg(fixture("france-800.svg"));
  assert.equal(assertSupportedMapgenSvg(fixture("france-800.svg")), 1);
  const index = buildGeneratedFeatureIndex(json("france-features.json"), countryCode);
  const paris = resolveGeneratedFeature("Paris", "", index);
  assert.equal(paris.status, "matched");
  assert.equal(paris.record.assignmentKey, "region:FR-75");
  // The whole country, with one département on top: the later, more specific rule wins.
  const rules = generatedColorRules({ "region:FR-75": 1, "country:fr": 0 }, palette);
  assert.ok(rules.indexOf("country:fr") === -1 && rules.indexOf('[class~="fr"]') < rules.indexOf('[data-code="FR-75"]'));
  const fills = paintedBy(svg, rules);
  const regions = [...svg.querySelectorAll("path.mg-land[data-code]")].map((p) => p.getAttribute("data-code"));
  assert.equal(fills.size, new Set(regions).size, "every département is coloured");
  assert.equal(fills.get("FR-75"), "#2e6e65");
  assert.equal(fills.get("FR-13"), "#e85d3f");
});

test("matches names within their parent, and flags ambiguous ones", () => {
  const index = buildGeneratedFeatureIndex(json("us-counties-features.json"), countryCode);
  const fairfields = resolveGeneratedFeature("Fairfield", "", index);
  assert.equal(fairfields.status, "ambiguous");
  assert.ok(fairfields.records.length >= 3);
  const connecticut = resolveGeneratedFeature("Fairfield", "Connecticut", index);
  assert.equal(connecticut.status, "matched");
  assert.equal(connecticut.record.code, "US-09001");
  assert.equal(resolveGeneratedFeature("us-09001", "", index).record.assignmentKey, "region:US-09001");
  assert.equal(resolveGeneratedFeature("Nowhere County", "", index).status, "missing");
  // French names match without accents or case.
  const france = buildGeneratedFeatureIndex(json("france-features.json"), countryCode);
  assert.equal(resolveGeneratedFeature("ile-de-france", "", france).status, "missing");
  assert.equal(resolveGeneratedFeature("seine-saint-denis", "ÎLE-DE-FRANCE", france).record.code, "FR-93");
});

/** The Alaska and Connecticut examples: data on newer codes than the map. */
function importOn(codes) {
  const features = json("us-counties-features.json");
  const index = buildGeneratedFeatureIndex(features, countryCode);
  const resolveTarget = (code) => {
    const result = resolveGeneratedFeature(`US-${code}`, "", index);
    return result.status === "matched" ? { status: "matched", assignmentKey: result.record.assignmentKey } : result;
  };
  const crosswalks = json("crosswalks.json")
    .filter((c) => crosswalkAppliesTo(c, "us-counties"))
    .map((c) => ({ id: crosswalkId(c), title: c.title, rows: parseDelimitedText(fixture(`${crosswalkId(c)}.csv`)) }));
  const records = codes.map(([rawCode, categoryIndex], i) => ({ rawCode, categoryIndex, recordNumber: i + 2 }));
  const hints = crosswalkHints(records.map((r) => r.rawCode), "", crosswalks);
  const recode = (hint) =>
    recodeWithCrosswalk({
      crosswalkId: hint.crosswalk,
      rows: crosswalks.find((c) => c.id === hint.crosswalk).rows,
      direction: hint.direction,
      codePrefix: "",
      records,
      assignments: new Map(),
      resolveTarget,
    });
  return { index, hints, recode };
}

test("Alaska: 2020 codes on a map with Valdez-Cordova are explained and recoded", () => {
  const { index, hints, recode } = importOn([["02063", 0], ["02066", 0]]);
  assert.equal(hints.length, 1);
  assert.equal(hints[0].crosswalk, "us-counties-2010-2020");
  assert.equal(hints[0].direction, "new-data");
  assert.match(hints[0].message, /2 codes are from a newer boundary set \(US counties, 2010 to 2020 codes\); this map uses older boundaries/);
  const result = recode(hints[0]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual([...result.assignments], [["region:US-02261", 0]]);
  assert.equal(countFeaturesWithoutData(index.records, result.assignments.keys()), index.records.length - 1);
  // Chugach and Copper River in different categories: Valdez-Cordova can't be both.
  const split = importOn([["02063", 0], ["02066", 1]]);
  const conflict = split.recode(split.hints[0]);
  assert.equal(conflict.failures.length, 1);
  assert.match(conflict.failures[0], /US-02261 receives conflicting categories through us-counties-2010-2020/);
  assert.deepEqual([...conflict.failedRows], [3]);
});

test("Connecticut: 2022 planning regions on a map of counties are explained and recoded", () => {
  const { hints, recode } = importOn([["09110", 0], ["09120", 1]]);
  assert.equal(hints.length, 1);
  assert.equal(hints[0].crosswalk, "us-counties-2020-2022");
  assert.equal(hints[0].direction, "new-data");
  assert.deepEqual(hints[0].codes.sort(), ["09110", "09120"]);
  const result = recode(hints[0]);
  assert.deepEqual(result.failures, []);
  // Capitol (09110) lies in Hartford (09003) and Tolland (09013) counties;
  // Greater Bridgeport (09120) in Fairfield (09001).
  assert.deepEqual(Object.fromEntries(result.assignments), {
    "region:US-09003": 0,
    "region:US-09013": 0,
    "region:US-09001": 1,
  });
  assert.equal(result.recoded, 3);
  // Western Connecticut (09190) also lies in Fairfield: a conflict to review.
  const overlapping = importOn([["09120", 1], ["09190", 0]]);
  const conflict = overlapping.recode(overlapping.hints[0]);
  assert.ok(conflict.failures.some((f) => /US-09001 receives conflicting categories/.test(f)), conflict.failures.join("\n"));
});

test("crosswalks name the datasets they are for", () => {
  const listed = json("crosswalks.json");
  assert.ok(listed.length >= 2);
  for (const c of listed) {
    assert.ok(crosswalkId(c));
    assert.ok(crosswalkAppliesTo(c, "us-counties"));
    assert.equal(crosswalkAppliesTo(c, "ne-admin1"), false);
  }
  assert.equal(crosswalkId({ table: "/api/v1/crosswalks/abc.csv" }), "abc");
  assert.ok(crosswalkAppliesTo({ id: "any" }, "ne-admin1"), "a crosswalk naming no dataset is for any");
});
