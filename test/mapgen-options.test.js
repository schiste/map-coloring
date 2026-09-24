// The map settings form, built from Map Generator's recorded description
// of its render options (test/fixtures/mapgen/render-options.json).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DOMParser } from "linkedom";
import {
  applyThemeColors,
  FALLBACK_DESCRIPTION,
  FIXED_SPEC,
  filterSpec,
  formModel,
  isVisible,
  parseValue,
  readForm,
  renderForm,
  specFromValues,
  updateVisibility,
  validDescription,
  valuesFromSpec,
} from "../js/mapgen-options.js";

const json = (name) => JSON.parse(readFileSync(new URL(`./fixtures/mapgen/${name}`, import.meta.url), "utf8"));
const description = json("render-options.json");
const themes = json("themes.json");
const bboxPresets = json("bbox-presets.json");
const model = () => formModel(description, { themes, bboxPresets });

function form(m, values, extra = {}) {
  const doc = new DOMParser().parseFromString("<!doctype html><html><body><div id='f'></div></body></html>", "text/html");
  const container = doc.getElementById("f");
  renderForm(container, m, values, extra);
  return container;
}

/** Selects an option of a <select> (linkedom has no value setter). */
function choose(select, value) {
  for (const option of select.querySelectorAll("option")) {
    if (option.getAttribute("value") === value) option.setAttribute("selected", "");
    else option.removeAttribute("selected");
  }
}

test("the description is valid and covers every setting Maphue shows", () => {
  assert.ok(validDescription(description));
  assert.equal(validDescription({ options: [{ name: 1 }] }), null);
  assert.equal(validDescription(null), null);
  const m = model();
  const names = m.options.map((o) => o.name);
  for (const name of ["title", "show-title", "caption", "width", "height", "theme", "labels", "context-labels", "capitals", "languages", "projection", "bbox", "frame", "worldview"]) {
    assert.ok(names.includes(name), name);
  }
  // Maphue exports for Commons: those options are fixed, not shown.
  assert.ok(!names.includes("target") && !names.includes("css-vars"));
  // Colours are a group of their own, in the API's order.
  assert.deepEqual(m.groups.map((g) => g.id), ["map", "labels", "frame", "borders", "colors", "credit", "output"]);
  assert.ok(m.colorSlots.some((s) => s.slot === "water"));
});

test("choices come from the dataset and the catalogs", () => {
  // The host's points of view, named after their country.
  const worldview = model().options.find((o) => o.name === "worldview");
  assert.ok(worldview.choices.some((c) => c.value === "IND" && /India/.test(c.label)), JSON.stringify(worldview.choices.slice(0, 3)));
  // A host that lists none shows no point-of-view field.
  const none = { ...description, options: description.options.map((o) => (o.name === "worldview" ? { ...o, choices: [] } : o)) };
  assert.equal(formModel(none, { themes }).options.find((o) => o.name === "worldview"), undefined);
  const theme = model().options.find((o) => o.name === "theme");
  assert.deepEqual(theme.choices.map((c) => c.value).sort(), Object.keys(themes).sort());
  const bbox = model().options.find((o) => o.name === "bbox");
  assert.ok(bbox.presets.includes("europe"));
});

test("conditions show settings only when they apply", () => {
  const m = model();
  const option = (name) => m.options.find((o) => o.name === name);
  assert.equal(isVisible(option("parallels"), { projection: "auto" }), false);
  assert.equal(isVisible(option("parallels"), { projection: "albers" }), true);
  assert.equal(isVisible(option("show-title"), { title: "" }), false);
  assert.equal(isVisible(option("show-title"), { title: "Benelux" }), true);
  assert.equal(isVisible(option("label-size"), { labels: false, "context-labels": false, capitals: "none" }), false);
  assert.equal(isVisible(option("label-size"), { labels: false, capitals: "all" }), true);
});

test("values are typed and checked against the limits", () => {
  const m = model();
  const option = (name) => m.options.find((o) => o.name === name);
  assert.deepEqual(parseValue(option("width"), "1200"), { value: 1200 });
  assert.match(parseValue(option("width"), "99999").error, /Width: at most 4000/);
  assert.match(parseValue(option("width"), "12.5").error, /whole number/);
  assert.match(parseValue(option("border-width"), "0").error, /more than 0/);
  assert.deepEqual(parseValue(option("languages"), "fr; zh-Hant, "), { value: ["fr", "zh-Hant"] });
  assert.deepEqual(parseValue(option("parallels"), "30, 60"), { value: [30, 60] });
  assert.match(parseValue(option("projection"), "mercator").error, /listed values/);
  assert.deepEqual(parseValue(option("bbox"), "europe"), { value: "europe" });
  assert.deepEqual(parseValue(option("bbox"), "-10 35 30 60"), { value: "-10,35,30,60" });
  assert.match(parseValue(option("bbox"), "1,2,3").error, /four numbers/);
  assert.deepEqual(parseValue(option("title"), "  "), { value: undefined });
});

test("the spec holds what differs from the API's defaults, and Maphue's fixed settings", () => {
  const m = model();
  const values = valuesFromSpec(m, {});
  // Maphue's own defaults: labels, 1600 px.
  assert.equal(values.labels, true);
  assert.equal(values.width, "1600");
  const { spec, errors } = specFromValues(m, { ...values, projection: "albers", parallels: "30, 60", capitals: "countries", title: "", "show-title": true }, { water: "#112233" });
  assert.deepEqual(errors, []);
  assert.deepEqual(spec, {
    ...FIXED_SPEC,
    width: 1600,
    labels: true,
    capitals: "countries",
    projection: "albers",
    parallels: [30, 60],
    colors: { water: "#112233" },
  }, "show-title without a title doesn't apply; defaults aren't sent");
  const bad = specFromValues(m, { ...values, width: "-5", "border-width": "abc" });
  assert.equal(bad.errors.length, 2);
  // Round trip.
  const again = valuesFromSpec(m, spec);
  assert.equal(again.projection, "albers");
  assert.equal(again.parallels, "30, 60");
  assert.deepEqual(specFromValues(m, again, { water: "#112233" }).spec, spec);
});

test("saved specs keep only what the description accepts", () => {
  const spec = filterSpec(description, {
    labels: true,
    width: 1600,
    languages: ["fr", 3],
    projection: "mercator",
    bbox: "europe",
    worldview: "IND",
    unknownSetting: 1,
    colors: { water: "#112233", nowhere: "#000000", land: "red" },
    target: "web",
  });
  assert.deepEqual(spec, {
    labels: true,
    width: 1600,
    languages: ["fr", "3"],
    bbox: "europe",
    worldview: "IND",
    colors: { water: "#112233" },
    target: "commons",
  });
});

test("the form renders every widget and reads back what it shows", () => {
  const m = model();
  const values = valuesFromSpec(m, { projection: "albers", parallels: [30, 60], title: "Benelux", showTitle: true });
  const container = form(m, values, { themeColors: themes.wikimedia, colors: { land: "#abcdef" } });
  // Every setting has a control: most read through data-option, the box
  // through its preset menu, the parallels through their pair of fields.
  for (const option of m.options) {
    const control = `[data-option="${option.name}"], [data-bbox-preset="${option.name}"], [data-pair-option="${option.name}"]`;
    assert.ok(container.querySelector(control), `${option.name} has a control`);
  }
  assert.equal(container.querySelector('[data-option="projection"]').tagName, "SELECT");
  assert.equal(container.querySelector('[data-option="labels"]').type, "checkbox");
  assert.equal(container.querySelector('[data-option="width"]').getAttribute("max"), "4000");
  assert.equal(container.querySelector('[data-option="caption"]').tagName, "TEXTAREA");
  // The box: a preset menu, or custom coordinates.
  const presets = container.querySelector('[data-bbox-preset="bbox"]');
  assert.equal(presets.tagName, "SELECT");
  assert.ok([...presets.querySelectorAll("option")].some((o) => o.getAttribute("value") === "europe"));
  assert.equal(presets.querySelector("option[selected]").getAttribute("value"), "__custom__");
  // Labels and help are text, not markup.
  assert.equal(container.querySelector('[data-option-field="projection"] > label').textContent, "Projection");
  // Advanced settings are in the form too.
  assert.ok(container.querySelector('[data-option="precision"]'));
  // Conditions: parallels shown for Albers, label size shown with labels.
  assert.equal(container.querySelector('[data-option-field="parallels"]').hidden, false);
  choose(container.querySelector('[data-option="projection"]'), "laea");
  updateVisibility(container, m);
  assert.equal(container.querySelector('[data-option-field="parallels"]').hidden, true);
  // A preset chosen reads back as its name.
  choose(presets, "europe");
  assert.equal(readForm(container).raw.bbox, "europe");
  // Colours: the theme's, one changed.
  const { raw, colors } = readForm(container);
  assert.deepEqual(colors, { land: "#abcdef" });
  assert.equal(container.querySelector('[data-color-slot="water"]').value, themes.wikimedia.water);
  applyThemeColors(container, m, themes.dark);
  assert.equal(container.querySelector('[data-color-slot="water"]').value, themes.dark.water);
  assert.equal(container.querySelector('[data-color-slot="land"]').value, "#abcdef", "changed colours stay");
  const { spec, errors } = specFromValues(m, raw, colors);
  assert.deepEqual(errors, []);
  assert.equal(spec.projection, "laea");
  assert.equal(spec.parallels, undefined, "parallels don't apply to laea");
  assert.equal(spec.bbox, "europe");
  assert.deepEqual(spec.colors, { land: "#abcdef" });
});

test("without the API's description, the settings Maphue always offered", () => {
  const m = formModel(FALLBACK_DESCRIPTION, { themes, bboxPresets });
  assert.deepEqual(m.options.map((o) => o.name).sort(), ["bbox", "labels", "languages", "theme"]);
  const { spec } = specFromValues(m, valuesFromSpec(m, {}));
  assert.deepEqual(spec, { ...FIXED_SPEC, labels: true });
});
