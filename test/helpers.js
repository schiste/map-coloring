// Shared by tests and test/rsvg/build-export.mjs.
import { readFileSync } from "node:fs";
import { DOMParser } from "linkedom";
import { generatedColorRules } from "../js/map-generator.js";
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_PALETTE } from "../js/state.js";
import { getSvgViewBox, sanitizeSvg } from "../js/svg-export.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/mapgen/${name}`, import.meta.url), "utf8");

/** The recorded France map as Maphue mounts it (sanitised, coloured), and its export context. */
export function mountedFrance() {
  const palette = DEFAULT_PALETTE.slice(0, 3).map((item) => ({ ...item }));
  const doc = new DOMParser().parseFromString(fixture("france-800.svg"), "image/svg+xml");
  const svg = doc.documentElement;
  sanitizeSvg(svg);
  const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
  style.setAttribute("id", "maphue-colors");
  style.textContent = generatedColorRules(
    { "region:FR-75": 1, "region:FR-13": 2, "region:FR-2A": 1, "region:FR-974": 2, "country:fr": 0 },
    palette,
  );
  svg.append(style);
  const ctx = {
    palette,
    exportOptions: { ...DEFAULT_EXPORT_OPTIONS, title: "Three categories" },
    viewBox: getSvgViewBox(svg),
    isGenerated: true,
    dataset: "ne-admin1",
    metadata: JSON.parse(fixture("france-800.json")),
  };
  return { svg, ctx };
}
