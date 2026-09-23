export const MAPGEN_API_ROOT = "https://map-generator.toolforge.org/api/v1";
export const SUPPORTED_MAPGEN_CONTRACTS = new Set([1]);

export function collectionFrom(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

export function getMapgenContractVersion(svgText) {
  const root = /^\s*(?:<\?xml[^>]*>\s*)?<svg\b([^>]*)>/i.exec(String(svgText || ""));
  if (!root) return null;
  const match = /\bdata-mapgen-contract\s*=\s*(["'])(\d+)\1/i.exec(root[1]);
  return match ? Number(match[2]) : null;
}

export function assertSupportedMapgenSvg(svgText) {
  const version = getMapgenContractVersion(svgText);
  if (!SUPPORTED_MAPGEN_CONTRACTS.has(version)) {
    throw new Error(
      version === null
        ? "This generated map has no Maphue-compatible SVG contract."
        : `Generated map contract ${version} is not supported by this version of Maphue.`,
    );
  }
  return version;
}

export function normalizeAssignmentKey(value) {
  const raw = String(value || "").trim();
  const legacyCountry = /^([A-Z]{2})$/i.exec(raw);
  if (legacyCountry) return `country:${legacyCountry[1].toLowerCase()}`;
  const country = /^country:([a-z]{2})$/i.exec(raw);
  if (country) return `country:${country[1].toLowerCase()}`;
  const other = /^(region|unit):([A-Z0-9][A-Z0-9._:-]*)$/i.exec(raw);
  if (other) return `${other[1].toLowerCase()}:${other[2].toUpperCase()}`;
  return null;
}

export function buildGeneratedFeatureIndex(features, resolveCountryCode = () => null) {
  const records = [];
  const byCode = new Map();
  const byName = new Map();
  const byUnit = new Map();
  const addLookup = (index, value, record) => {
    const key = normalizeMapLookup(value);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    if (!index.get(key).includes(record)) index.get(key).push(record);
  };

  for (const feature of Array.isArray(features) ? features : []) {
    if (!feature || typeof feature.code !== "string" || !feature.code.trim()) continue;
    const code = feature.code.trim();
    const countryCode = resolveCountryCode(feature.country);
    const isSubdivision = Boolean(feature.parent) || code.includes("-") || /\d/.test(code);
    const assignmentKey = countryCode && !isSubdivision
      ? `country:${countryCode.toLowerCase()}`
      : `region:${code.toUpperCase()}`;
    const record = {
      ...feature,
      code,
      name: String(feature.name || code),
      parentName: String(feature.parentName || ""),
      countryCode: countryCode ? countryCode.toUpperCase() : null,
      assignmentKey,
    };
    records.push(record);
    addLookup(byCode, code, record);
    addLookup(byName, record.name, record);
    if (feature.names && typeof feature.names === "object") {
      Object.values(feature.names).forEach((name) => addLookup(byName, name, record));
    }
    for (const unit of Array.isArray(feature.units) ? feature.units : []) {
      addLookup(byUnit, unit, record);
    }
  }

  return { records, byCode, byName, byUnit };
}

export function resolveGeneratedFeature(value, parentValue, index) {
  const normalized = normalizeMapLookup(value);
  if (!normalized) return { status: "missing", records: [] };
  let matches = [
    ...(index.byCode.get(normalized) || []),
    ...(index.byName.get(normalized) || []),
  ];
  matches = [...new Set(matches)];
  if (parentValue) {
    const parent = normalizeMapLookup(parentValue);
    matches = matches.filter((record) =>
      [record.parent, record.parentName].some((value) => normalizeMapLookup(value) === parent),
    );
  }
  if (matches.length === 1) return { status: "matched", record: matches[0], records: matches };
  if (matches.length > 1) return { status: "ambiguous", records: matches };

  const units = index.byUnit.get(normalized) || [];
  if (units.length) return { status: "unit", records: [...new Set(units)], code: String(value).trim() };
  return { status: "missing", records: [] };
}

export function normalizeMapLookup(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeCrosswalkCode(value, prefix = "") {
  const code = String(value || "").trim().toUpperCase();
  const normalizedPrefix = String(prefix || "").trim().toUpperCase();
  return normalizedPrefix && code.startsWith(normalizedPrefix)
    ? code.slice(normalizedPrefix.length)
    : code;
}

export function selectAutoLegendSlot(metadata, itemWidth, itemHeight, options = {}) {
  const slots = Array.isArray(metadata?.legendSlots) ? metadata.legendSlots : [];
  const excluded = options.excludeSlots || [];
  const candidates = slots
    .map((slot) => ({ slot, bounds: slotBounds(slot) }))
    .filter(({ bounds }) => bounds && bounds.width >= itemWidth && bounds.height >= itemHeight)
    .filter(({ bounds }) => !excluded.some((item) => sameSlot(bounds, item)));
  candidates.sort((a, b) => {
    const shareA = Number(a.slot.landShare ?? a.slot.land_share ?? 0);
    const shareB = Number(b.slot.landShare ?? b.slot.land_share ?? 0);
    return shareA - shareB;
  });
  return candidates[0]?.bounds || null;
}

export function slotBounds(slot) {
  const value = slot?.bounds || slot?.rect || slot?.box || slot;
  if (Array.isArray(value) && value.length >= 4) {
    const [x, y, width, height] = value.map(Number);
    return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
      ? { x, y, width, height, landShare: Number(slot.landShare ?? 0) }
      : null;
  }
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x ?? value.minX ?? value.left);
  const y = Number(value.y ?? value.minY ?? value.top);
  const width = Number(value.width ?? value.w ?? (Number.isFinite(Number(value.maxX)) ? Number(value.maxX) - x : NaN));
  const height = Number(value.height ?? value.h ?? (Number.isFinite(Number(value.maxY)) ? Number(value.maxY) - y : NaN));
  return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
    ? { x, y, width, height, landShare: Number(slot.landShare ?? slot.land_share ?? 0) }
    : null;
}

function sameSlot(a, b) {
  return a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * CSS rules colouring a generated map, by assignment key: countries first,
 * then data units, then single regions, so the most specific one wins.
 */
export function generatedColorRules(assignments, palette) {
  const entries = Object.entries(assignments)
    .map(([key, index]) => [normalizeAssignmentKey(key), index])
    .filter(([key, index]) => key && Number.isInteger(index) && palette[index])
    .sort(([a], [b]) => assignmentRulePriority(a) - assignmentRulePriority(b));
  const rules = [];
  for (const [key, index] of entries) {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator);
    const code = escapeCssString(key.slice(separator + 1));
    const color = palette[index].color;
    if (kind === "country") rules.push(`path.mg-land[class~="${code}"] { fill: ${color}; }`);
    else if (kind === "unit") rules.push(`path.mg-land[data-unit~="${code}"] { fill: ${color}; }`);
    else rules.push(`path.mg-land[data-code="${code}"] { fill: ${color}; }`);
  }
  return rules.join("\n");
}

function assignmentRulePriority(key) {
  if (key.startsWith("country:")) return 0;
  if (key.startsWith("unit:")) return 1;
  return 2;
}

function escapeCssString(value) {
  return String(value).replace(/[\\"]/g, "\\$&");
}

/** A hosted crosswalk's id (from its metadata, or its table URL). */
export function crosswalkId(crosswalk) {
  return crosswalk?.id || /crosswalks\/([^/.]+)\.csv/.exec(crosswalk?.table || "")?.[1] || null;
}

/** Whether a crosswalk is for a dataset (one that names none is for any). */
export function crosswalkAppliesTo(crosswalk, dataset) {
  const appliesTo = [crosswalk?.dataset, ...(Array.isArray(crosswalk?.datasets) ? crosswalk.datasets : [])].filter(Boolean);
  return !appliesTo.length || appliesTo.includes(dataset);
}

/** Source and target columns of a crosswalk table, from normalised headers. */
export function findCrosswalkCodeColumns(headers) {
  const fromNames = new Set([
    "from", "from code", "from id", "old", "old code", "old id", "old geoid", "old fips",
    "source", "source code", "source id", "source geoid", "source fips", "origin", "origin code",
  ]);
  const toNames = new Set([
    "to", "to code", "to id", "new", "new code", "new id", "new geoid", "new fips",
    "target", "target code", "target id", "target geoid", "target fips", "destination", "destination code",
  ]);
  const fromColumn = headers.findIndex((header) => fromNames.has(header));
  const toColumn = headers.findIndex((header) => toNames.has(header));
  return fromColumn >= 0 && toColumn >= 0 && fromColumn !== toColumn
    ? { fromColumn, toColumn }
    : null;
}

/**
 * Why codes may be missing from the map: for each crosswalk ({ id, title,
 * rows } with rows as parsed CSV, header first), the codes only on its old
 * side (data older than the map) or only on its new side (data newer).
 * Codes are compared locally; nothing is sent anywhere.
 */
export function crosswalkHints(codes, codePrefix, crosswalks) {
  const normalizedCodes = new Set(codes.map((code) => normalizeCrosswalkCode(code, codePrefix)));
  const hints = [];
  for (const { id, title, rows } of crosswalks) {
    if (!rows || rows.length < 2) continue;
    const columns = findCrosswalkCodeColumns(rows[0].map(normalizeMapLookup));
    if (!columns) continue;
    const { fromColumn, toColumn } = columns;
    const fromCodes = new Set(rows.slice(1).map((row) => normalizeCrosswalkCode(row[fromColumn])).filter(Boolean));
    const toCodes = new Set(rows.slice(1).map((row) => normalizeCrosswalkCode(row[toColumn])).filter(Boolean));
    const oldCodes = [...normalizedCodes].filter((code) => fromCodes.has(code) && !toCodes.has(code));
    const newCodes = [...normalizedCodes].filter((code) => toCodes.has(code) && !fromCodes.has(code));
    const name = title || id;
    if (oldCodes.length) {
      hints.push({
        crosswalk: id,
        direction: "old-data",
        codes: oldCodes,
        message: `${oldCodes.length} code${oldCodes.length === 1 ? " is" : "s are"} from an older boundary set (${name}). Recode through this crosswalk or review the split regions.`,
      });
    }
    if (newCodes.length) {
      hints.push({
        crosswalk: id,
        direction: "new-data",
        codes: newCodes,
        message: `${newCodes.length} code${newCodes.length === 1 ? " is" : "s are"} from a newer boundary set (${name}); this map uses older boundaries. Recode through this crosswalk to use them.`,
      });
    }
  }
  return hints;
}

/**
 * Recodes unmatched import records through a crosswalk, in the direction of
 * its hint ("old-data": old to new codes; "new-data": new to old). A record
 * whose codes lead to regions that already have another category is a
 * conflict, left for the user. Returns the new assignments, the failures
 * (messages), the record numbers that failed, and how many regions were
 * recoded.
 */
export function recodeWithCrosswalk({ crosswalkId: id, rows, direction, codePrefix, records, assignments, resolveTarget, label = (key) => key }) {
  const columns = findCrosswalkCodeColumns(rows[0].map(normalizeMapLookup));
  if (!columns) throw new Error("The crosswalk table has no recognized source and target code columns.");
  const { fromColumn, toColumn } = columns;
  const oldData = direction === "old-data";
  const sourceColumn = oldData ? fromColumn : toColumn;
  const targetColumn = oldData ? toColumn : fromColumn;
  const translations = new Map();
  for (const row of rows.slice(1)) {
    const source = normalizeCrosswalkCode(row[sourceColumn], codePrefix);
    const target = row[targetColumn]?.trim();
    if (!source || !target) continue;
    if (!translations.has(source)) translations.set(source, new Set());
    translations.get(source).add(target);
  }

  const next = new Map(assignments);
  const failures = [];
  const failedRows = new Set();
  const recoded = new Set();
  for (const record of records) {
    const source = normalizeCrosswalkCode(record.rawCode, codePrefix);
    const targets = [...(translations.get(source) || [])];
    if (!targets.length) {
      failures.push(`Record ${record.recordNumber}: no crosswalk rule for “${record.rawCode}”.`);
      failedRows.add(record.recordNumber);
      continue;
    }
    const targetKeys = [];
    for (const target of targets) {
      const resolved = resolveTarget(target);
      if (resolved.status === "matched") targetKeys.push(resolved.assignmentKey);
    }
    if (!targetKeys.length) {
      failures.push(`Record ${record.recordNumber}: crosswalk targets for “${record.rawCode}” are not on this map.`);
      failedRows.add(record.recordNumber);
      continue;
    }
    const conflicts = targetKeys.filter((key) => next.has(key) && next.get(key) !== record.categoryIndex);
    if (conflicts.length) {
      for (const key of conflicts) failures.push(`${label(key)} receives conflicting categories through ${id}.`);
      failedRows.add(record.recordNumber);
      continue;
    }
    for (const key of targetKeys) {
      next.set(key, record.categoryIndex);
      recoded.add(key);
    }
  }
  return { assignments: next, failures, failedRows, recoded: recoded.size };
}

/** How many map regions an import leaves without data. */
export function countFeaturesWithoutData(records, assignmentKeys) {
  const keys = new Set(assignmentKeys);
  return records.filter((feature) =>
    !keys.has(feature.assignmentKey) &&
    !(feature.countryCode && keys.has(`country:${feature.countryCode.toLowerCase()}`)) &&
    !(Array.isArray(feature.units) && feature.units.some((unit) => keys.has(`unit:${String(unit).toUpperCase()}`))),
  ).length;
}
