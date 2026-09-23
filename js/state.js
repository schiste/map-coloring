// Saved work (browser storage), read back defensively: anything malformed
// or from an older version is dropped or migrated (country keys such as
// "FR" become "country:fr").
import { LEGEND_POSITIONS, readableTextColor } from "./export-layout.js";
import { normalizeAssignmentKey } from "./map-generator.js";

export const DEFAULT_PALETTE = [
  { color: "#E85D3F", label: "Category one" },
  { color: "#2E6E65", label: "Category two" },
  { color: "#E3B23C", label: "Category three" },
  { color: "#4169A8", label: "Category four" },
  { color: "#8C5E9E", label: "Category five" },
  { color: "#D78735", label: "Category six" },
  { color: "#3D8B52", label: "Category seven" },
  { color: "#B6495A", label: "Category eight" },
];

export const DEFAULT_EXPORT_OPTIONS = {
  legendEnabled: true,
  legendPosition: "auto",
  legendBackground: "#fffefa",
  legendTextColor: "#18211d",
  legendOpacity: 1,
  title: "",
  titlePosition: "auto",
};

export function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value));
}

/**
 * Map settings of a saved generated map, any the API offers (checked
 * against its description when the form loads): well-formed names with
 * short text, finite numbers, booleans or short lists, and colours.
 */
function savedSettings(spec) {
  const out = {};
  for (const [key, value] of Object.entries(spec).slice(0, 80)) {
    if (!/^[a-z][a-zA-Z]{0,39}$/.test(key)) continue;
    if (key === "colors") {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const colors = Object.entries(value)
          .filter(([slot, color]) => /^[a-z][a-zA-Z]{0,39}$/.test(slot) && validHex(color))
          .slice(0, 20);
        if (colors.length) out.colors = Object.fromEntries(colors);
      }
    } else if (typeof value === "string") out[key] = value.slice(0, 1000);
    else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key] = value;
    else if (Array.isArray(value)) {
      const items = value.filter((v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v))).slice(0, 12);
      if (items.length) out[key] = items.map((v) => (typeof v === "string" ? v.slice(0, 40) : v));
    }
  }
  return out;
}

/**
 * The saved state in `text`, as the parts of the app state to restore
 * (`current` gives the values of what isn't saved). Returns null when the
 * text isn't a saved state at all, {} when nothing in it is usable.
 */
export function parseSavedState(text, current = {}) {
  const out = {
    mapScope: current.mapScope,
    mapTitle: current.mapTitle,
    mapSelections: { ...(current.mapSelections || {}) },
  };
  try {
    const saved = JSON.parse(text);
    if (
      !saved ||
      !Array.isArray(saved.palette) ||
      !saved.assignments ||
      typeof saved.assignments !== "object"
    ) {
      return {};
    }

    out.palette = saved.palette
      .slice(0, 8)
      .map((item, index) => ({
        color: validHex(item.color) ? item.color : DEFAULT_PALETTE[index].color,
        label: String(item.label || DEFAULT_PALETTE[index].label).slice(0, 80),
      }));
    if (out.palette.length < 2) {
      out.palette = DEFAULT_PALETTE.slice(0, 3).map((item) => ({ ...item }));
    }
    out.assignments = Object.fromEntries(
      Object.entries(saved.assignments)
        .map(([key, index]) => [normalizeAssignmentKey(key), index])
        .filter(([key, index]) => key && Number.isInteger(index) && index >= 0 && index < out.palette.length),
    );
    if (saved.generatedMap && typeof saved.generatedMap === "object") {
      const dataset = String(saved.generatedMap.dataset || "");
      const savedRegions = Array.isArray(saved.generatedMap.regions)
        ? saved.generatedMap.regions
            .map((item) => ({
              code: String(typeof item === "string" ? item : item?.code || "").trim(),
              name: String(typeof item === "string" ? item : item?.name || item?.code || "").slice(0, 120),
            }))
            .filter((item) => /^[a-z0-9._:-]{1,40}$/i.test(item.code))
            .slice(0, 300)
        : [];
      const region = String(saved.generatedMap.region || savedRegions.map((item) => item.code).join(",")).trim();
      if (/^[a-z0-9-]{1,80}$/i.test(dataset) && /^[a-z0-9 _.,:-]{1,4000}$/i.test(region)) {
        const savedSpec = saved.generatedMap.spec && typeof saved.generatedMap.spec === "object"
          ? saved.generatedMap.spec
          : {};
        out.generatedMap = {
          dataset,
          datasetName: String(saved.generatedMap.datasetName || dataset).slice(0, 100),
          region,
          regionName: String(saved.generatedMap.regionName || savedRegions.map((item) => item.name).join(", ") || region).slice(0, 120),
          regions: savedRegions,
          spec: {
            ...savedSettings(savedSpec),
            target: "commons",
            width: Number.isFinite(savedSpec.width) ? Math.min(4000, Math.max(300, savedSpec.width)) : 1600,
            labels: typeof savedSpec.labels === "boolean" ? savedSpec.labels : true,
          },
          url: typeof saved.generatedMap.url === "string" ? saved.generatedMap.url.slice(0, 1000) : "",
        };
      }
    }
    if (typeof saved.mapTitle === "string" && /^File:.*\.svg$/i.test(saved.mapTitle)) {
      out.mapTitle = saved.mapTitle;
    }
    if (saved.mapScope === "continent" || saved.mapScope === "world" ||
        (saved.mapScope === "generated" && out.generatedMap)) {
      out.mapScope = saved.mapScope;
    }
    if (saved.mapSelections && typeof saved.mapSelections === "object") {
      for (const scope of ["world", "continent"]) {
        const title = saved.mapSelections[scope];
        if (typeof title === "string" && /^File:.*\.svg$/i.test(title)) {
          out.mapSelections[scope] = title;
        }
      }
    } else if (out.mapScope === "world") {
      out.mapSelections.world = out.mapTitle;
    }
    const savedExportOptions = saved.exportOptions || {};
    const savedLegendBackground = validHex(savedExportOptions.legendBackground)
      ? savedExportOptions.legendBackground
      : DEFAULT_EXPORT_OPTIONS.legendBackground;
    out.exportOptions = {
      legendEnabled:
        typeof savedExportOptions.legendEnabled === "boolean"
          ? savedExportOptions.legendEnabled
          : DEFAULT_EXPORT_OPTIONS.legendEnabled,
      legendPosition: LEGEND_POSITIONS.includes(savedExportOptions.legendPosition)
        ? savedExportOptions.legendPosition
        : DEFAULT_EXPORT_OPTIONS.legendPosition,
      legendBackground: savedLegendBackground,
      legendTextColor: validHex(savedExportOptions.legendTextColor)
        ? savedExportOptions.legendTextColor
        : readableTextColor(savedLegendBackground),
      legendOpacity: Number.isFinite(savedExportOptions.legendOpacity)
        ? Math.min(1, Math.max(0, savedExportOptions.legendOpacity))
        : DEFAULT_EXPORT_OPTIONS.legendOpacity,
      title: String(savedExportOptions.title || "").slice(0, 120),
      titlePosition: ["auto", "top", "bottom"].includes(savedExportOptions.titlePosition)
        ? savedExportOptions.titlePosition
        : DEFAULT_EXPORT_OPTIONS.titlePosition,
    };
  } catch {
    return null;
  }
  return out;
}
