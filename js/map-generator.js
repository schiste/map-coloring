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
