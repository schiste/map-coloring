// Exports of generated maps: the legend placed automatically in Map
// Generator's empty areas (never over land or insets), and the base map's
// credit and licence kept in the file. test/rsvg/check.sh renders the same
// export in librsvg and Chromium.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DOMParser } from "linkedom";
import { buildExportSvg, getSvgViewBox, legendPlacement, planAnnotations, sanitizeSvg } from "../js/svg-export.js";
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_PALETTE } from "../js/state.js";
import { mountedFrance } from "./helpers.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/mapgen/${name}`, import.meta.url), "utf8");
const json = (name) => JSON.parse(fixture(name));
const palette = DEFAULT_PALETTE.slice(0, 3).map((item) => ({ ...item }));

/** Rings of the mapped regions (absolute M/L/Z path data, in canvas pixels). */
function landRings(svg) {
  const rings = [];
  for (const path of svg.querySelectorAll("path.mg-land")) {
    for (const part of path.getAttribute("d").split(/(?=M)/)) {
      const numbers = part.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const ring = [];
      for (let i = 0; i + 1 < numbers.length; i += 2) ring.push([numbers[i], numbers[i + 1]]);
      if (ring.length > 2) rings.push(ring);
    }
  }
  return rings;
}

function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("Auto finds room for the legend on France at Maphue's size (1600 px)", () => {
  const metadata = json("france.json");
  const placement = legendPlacement({
    palette,
    exportOptions: { ...DEFAULT_EXPORT_OPTIONS },
    viewBox: [0, 0, metadata.width, metadata.height],
    isGenerated: true,
    dataset: "ne-admin1",
    metadata,
  });
  assert.ok(placement.slot, "no empty area took the legend");
  assert.ok(placement.scale >= 0.6, `readable: scale ${placement.scale}`);
});

test("Auto places the legend in an empty area: no land, no inset (France with overseas insets)", () => {
  // With a title too: the legend is placed first, the title takes what's left.
  const { svg, ctx } = mountedFrance();
  const { legend: placement, titleSlot } = planAnnotations(ctx);
  if (titleSlot) assert.ok(!overlaps(titleSlot, placement), "title and legend share an area");
  // The export draws the legend where the plan says.
  const exported = new DOMParser().parseFromString(buildExportSvg(svg, ctx, (node) => node.toString()), "image/svg+xml");
  assert.equal(
    exported.querySelector("#maphue-legend").getAttribute("transform"),
    `translate(${placement.x} ${placement.y}) scale(${placement.scale})`,
  );
  assert.ok(placement.slot, "a slot fits the legend");
  const box = { x: placement.x, y: placement.y, width: placement.width, height: placement.height };
  // Exactly in the slot Map Generator reported.
  assert.ok(box.x >= placement.slot.x && box.y >= placement.slot.y);
  assert.ok(box.x + box.width <= placement.slot.x + placement.slot.width + 1e-9);
  assert.ok(box.y + box.height <= placement.slot.y + placement.slot.height + 1e-9);
  const insets = [...svg.querySelectorAll("rect.mg-inset-frame")].map((r) =>
    Object.fromEntries(["x", "y", "width", "height"].map((k) => [k, Number(r.getAttribute(k))])),
  );
  assert.ok(insets.length >= 3, "France has overseas insets");
  for (const inset of insets) assert.ok(!overlaps(box, inset), `legend over the inset at ${inset.x},${inset.y}`);
  const rings = landRings(svg);
  for (let x = box.x; x <= box.x + box.width; x += 2) {
    for (let y = box.y; y <= box.y + box.height; y += 2) {
      assert.ok(!rings.some((ring) => inside([x, y], ring)), `legend over land at ${x},${y}`);
    }
  }
});

test("Auto places the legend on the world map, and keeps slot coordinates under a title band", () => {
  const metadata = json("world.json");
  const ctx = {
    palette,
    exportOptions: { ...DEFAULT_EXPORT_OPTIONS },
    viewBox: [0, 0, metadata.width, metadata.height],
    isGenerated: true,
    dataset: "ne-admin0",
    metadata,
  };
  const placement = legendPlacement(ctx);
  assert.ok(placement.slot, "a slot fits the legend");
  // The world map's empty areas are strips above and below it: a legend in a row.
  assert.equal(placement.layout.kind, "row");
  assert.ok(placement.scale >= 0.8, `readable: scale ${placement.scale}`);
  assert.ok(placement.x >= placement.slot.x && placement.y >= placement.slot.y);
  assert.ok(placement.x + placement.width <= placement.slot.x + placement.slot.width + 1e-9);
  assert.ok(placement.y + placement.height <= placement.slot.y + placement.slot.height + 1e-9);
  // A map drawn with a title band starts its viewBox at y = -40; slots are
  // still in the map's own coordinates.
  const banded = legendPlacement({ ...ctx, viewBox: [0, -40, metadata.width, metadata.height + 40] });
  assert.deepEqual([banded.x, banded.y], [placement.x, placement.y]);
  // Without a fitting slot, the chosen corner.
  const fixed = legendPlacement({ ...ctx, exportOptions: { ...ctx.exportOptions, legendPosition: "top-right" } });
  assert.equal(fixed.slot, null);
});

test("exports keep the base map's credit and licence", () => {
  const { svg, ctx } = mountedFrance();
  const text = buildExportSvg(svg, ctx, (node) => node.toString());
  const exported = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
  const { credit, licence } = ctx.metadata;
  assert.ok(credit && licence);
  assert.ok(exported.querySelector("desc#maphue-attribution").textContent.includes(`Credit: ${credit}`));
  assert.ok(exported.querySelector("desc#maphue-attribution").textContent.includes(`Licence: ${licence}`));
  const line = [...exported.querySelectorAll("#maphue-attribution-line tspan")].map((t) => t.textContent).join(" ");
  assert.ok(line.includes(credit) && line.includes(licence), line);
  // The map's URL is absolute: the file travels (Commons) without the API.
  assert.match(exported.querySelector("desc#maphue-attribution").textContent, /Canonical map URL: https:\/\/map-generator\.toolforge\.org\/api\/v1\/maps\/ne-admin1\/FRA\.json/);
  // The credit sits in a band added under the map.
  const [, , width, height] = ctx.viewBox;
  const [, , , exportedHeight] = getSvgViewBox(exported);
  assert.ok(exportedHeight > height);
  assert.equal(exported.getAttribute("width"), String(Math.round(width)));
  // Legend, title and colours are in, the map's own credit and contract stay.
  assert.ok(exported.querySelector("#maphue-legend"));
  assert.equal(exported.querySelector("#maphue-title").textContent, "Three categories");
  assert.ok(exported.querySelector("style#maphue-colors").textContent.includes('[data-code="FR-75"]'));
  assert.equal(exported.getAttribute("data-mapgen-contract"), "1");
  assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
});

test("Commons-map exports are unchanged: no credit band", () => {
  const { svg, ctx } = mountedFrance();
  const text = buildExportSvg(svg, { ...ctx, isGenerated: false, metadata: null }, (node) => node.toString());
  assert.ok(!text.includes("maphue-attribution"));
  assert.ok(text.includes('font-family="Georgia, serif"'));
});

test("loading sanitises scripts, handlers and outside references", () => {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
      <script>alert(1)</script><style>@import url(https://x.test/a.css); path{fill:red}</style>
      <path fill="url(https://x.test/p)" style="fill:url(#ok)"/><use xlink:href="https://x.test/s.svg#a"/><use href="#local"/>
    </svg>`,
    "image/svg+xml",
  );
  const svg = doc.documentElement;
  sanitizeSvg(svg);
  const text = svg.toString();
  assert.ok(!/script|onload|x\.test|@import/.test(text), text);
  assert.ok(text.includes('href="#local"'));
  assert.ok(text.includes("url(#ok)"));
});
