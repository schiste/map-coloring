import { getNextColorIndex } from "./cycle.js";
import {
  calculateAnchoredPosition,
  LEGEND_POSITIONS,
  readableTextColor,
} from "./export-layout.js";
import {
  CONTINENT_MAPS,
  FALLBACK_MAP,
  fetchContinentCatalog,
  fetchMapCatalog,
  PREFERRED_MAP_TITLE,
} from "./maps.js";
import { createPdfFromJpeg } from "./pdf.js";

const STORAGE_KEY = "maphue-state-v1";
const THEME_STORAGE_KEY = "maphue-theme";
const DEFAULT_PALETTE = [
  { color: "#E85D3F", label: "Category one" },
  { color: "#2E6E65", label: "Category two" },
  { color: "#E3B23C", label: "Category three" },
  { color: "#4169A8", label: "Category four" },
  { color: "#8C5E9E", label: "Category five" },
  { color: "#D78735", label: "Category six" },
  { color: "#3D8B52", label: "Category seven" },
  { color: "#B6495A", label: "Category eight" },
];
const DEFAULT_EXPORT_OPTIONS = {
  legendEnabled: true,
  legendPosition: "bottom-left",
  legendBackground: "#fffefa",
  legendOpacity: 1,
  title: "",
  titlePosition: "top",
};
const CSS_REFERENCE_ATTRIBUTES = new Set([
  "clip-path",
  "color-profile",
  "cursor",
  "fill",
  "filter",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "shape-inside",
  "shape-subtract",
  "stroke",
  "style",
]);

const DISPLAY_NAME_OVERRIDES = {
  BO: "Bolivia",
  BN: "Brunei",
  CD: "Democratic Republic of the Congo",
  CG: "Republic of the Congo",
  CZ: "Czechia",
  GB: "United Kingdom",
  IR: "Iran",
  KP: "North Korea",
  KR: "South Korea",
  LA: "Laos",
  MD: "Moldova",
  PS: "Palestine",
  RU: "Russia",
  SY: "Syria",
  TW: "Taiwan",
  TZ: "Tanzania",
  US: "United States",
  VE: "Venezuela",
  VN: "Vietnam",
};

const NAME_ALIASES = {
  "bolivia plurinational state of": "BO",
  "brunei darussalam": "BN",
  "cabo verde": "CV",
  "cape verde": "CV",
  "côte d'ivoire": "CI",
  "cote d'ivoire": "CI",
  "democratic republic of congo": "CD",
  "democratic republic of the congo": "CD",
  "dr congo": "CD",
  "iran islamic republic of": "IR",
  "ivory coast": "CI",
  "korea democratic people's republic of": "KP",
  "korea republic of": "KR",
  "lao people's democratic republic": "LA",
  "macedonia": "MK",
  "micronesia federated states of": "FM",
  "moldova republic of": "MD",
  "palestine state of": "PS",
  "republic of kosovo": "XK",
  "kosovo": "XK",
  "republic of congo": "CG",
  "republic of the congo": "CG",
  "russian federation": "RU",
  "south korea": "KR",
  "syrian arab republic": "SY",
  "taiwan province of china": "TW",
  "tanzania united republic of": "TZ",
  "the netherlands": "NL",
  "turkey": "TR",
  "united kingdom of great britain and northern ireland": "GB",
  "united states of america": "US",
  "venezuela bolivarian republic of": "VE",
  "viet nam": "VN",
};
const COUNTRY_HEADER_NAMES = new Set([
  "alpha2",
  "alpha 2",
  "alpha3",
  "alpha 3",
  "code",
  "countries",
  "country",
  "country alpha2",
  "country alpha 2",
  "country alpha3",
  "country alpha 3",
  "country code",
  "country id",
  "country iso2",
  "country iso3",
  "country name",
  "iso",
  "iso alpha2",
  "iso alpha 2",
  "iso alpha3",
  "iso alpha 3",
  "iso code",
  "iso2",
  "iso3",
  "iso 3166 1 alpha 2",
  "iso 3166 1 alpha 3",
  "name",
]);
const CATEGORY_HEADER_NAMES = new Set([
  "category",
  "class",
  "classification",
  "color",
  "color category",
  "colour",
  "colour category",
  "group",
  "legend",
]);

const state = {
  mapScope: "world",
  mapTitle: PREFERRED_MAP_TITLE,
  mapSelections: {
    world: PREFERRED_MAP_TITLE,
    continent: CONTINENT_MAPS[0].title,
  },
  palette: DEFAULT_PALETTE.slice(0, 3).map((item) => ({ ...item })),
  assignments: {},
  exportOptions: { ...DEFAULT_EXPORT_OPTIONS },
};

let sourceCountries = [];
let countries = [];
let allCountryByCode = new Map();
let countryByCode = new Map();
let lookupToCode = new Map();
let mapCatalog = [FALLBACK_MAP];
let activeMap = FALLBACK_MAP;
let currentMapViewBox = [0, 0, 2754, 1398];
let currentMapDimensions = { width: 2754, height: 1398 };
let mapSwitchRequestId = 0;
let mapShadowRoot;
let svgElement;
let toastTimer;
let importPreview = null;

const elements = {
  appShell: document.querySelector("#app-shell"),
  appPicker: document.querySelector("#app-picker"),
  appPickerButton: document.querySelector("#app-picker-button"),
  appPickerMenu: document.querySelector("#app-picker-menu"),
  themeLight: document.querySelector("#theme-light"),
  themeDark: document.querySelector("#theme-dark"),
  assignedCount: document.querySelector("#assigned-count"),
  saveStatus: document.querySelector("#save-status"),
  mapScopeNote: document.querySelector("#map-scope-note"),
  mapScopeButtons: [...document.querySelectorAll("[data-map-scope]")],
  mapSelect: document.querySelector("#map-select"),
  mapSelectLabel: document.querySelector("#map-select-label"),
  mapCount: document.querySelector("#map-count"),
  mapThumbnail: document.querySelector("#map-thumbnail"),
  mapThumbnailPlaceholder: document.querySelector("#map-thumbnail-placeholder"),
  mapDescription: document.querySelector("#map-description"),
  mapCompatibility: document.querySelector("#map-compatibility"),
  mapSourceLink: document.querySelector("#map-source-link"),
  activeMapName: document.querySelector("#active-map-name"),
  mapDimensions: document.querySelector("#map-dimensions"),
  mapFrame: document.querySelector("#map-frame"),
  mapContainer: document.querySelector("#map-container"),
  mapLoading: document.querySelector("#map-loading"),
  mapTooltip: document.querySelector("#map-tooltip"),
  selectionSummary: document.querySelector("#selection-summary"),
  countryTotal: document.querySelector("#country-total"),
  countrySearch: document.querySelector("#country-search"),
  countryList: document.querySelector("#country-list"),
  countryEmpty: document.querySelector("#country-empty"),
  paletteSize: document.querySelector("#palette-size"),
  paletteList: document.querySelector("#palette-list"),
  importText: document.querySelector("#import-text"),
  importColor: document.querySelector("#import-color"),
  importColorHelp: document.querySelector("#import-color-help"),
  importColumn: document.querySelector("#import-column"),
  importCategoryColumn: document.querySelector("#import-category-column"),
  csvFile: document.querySelector("#csv-file"),
  chooseFileButton: document.querySelector("#choose-file-button"),
  previewImportButton: document.querySelector("#preview-import-button"),
  applyImportButton: document.querySelector("#apply-import-button"),
  cancelImportPreviewButton: document.querySelector("#cancel-import-preview-button"),
  importReport: document.querySelector("#import-report"),
  legendEnabled: document.querySelector("#legend-enabled"),
  legendOptions: document.querySelector("#legend-options"),
  legendPosition: document.querySelector("#legend-position"),
  legendBackground: document.querySelector("#legend-background"),
  legendOpacity: document.querySelector("#legend-opacity"),
  legendOpacityValue: document.querySelector("#legend-opacity-value"),
  exportTitle: document.querySelector("#export-title"),
  titlePosition: document.querySelector("#title-position"),
  resetButton: document.querySelector("#reset-button"),
  resetDialog: document.querySelector("#reset-dialog"),
  confirmResetButton: document.querySelector("#confirm-reset-button"),
  exportButton: document.querySelector("#export-button"),
  exportPngButton: document.querySelector("#export-png-button"),
  exportPdfButton: document.querySelector("#export-pdf-button"),
  downloadCsvButton: document.querySelector("#download-csv-button"),
  toast: document.querySelector("#toast"),
};

init().catch((error) => {
  console.error(error);
  elements.mapLoading.innerHTML =
    "<strong>Map could not be loaded.</strong><span>Refresh the page to try again.</span>";
  elements.mapLoading.classList.add("has-error");
});

async function init() {
  restoreTheme();
  restoreState();
  bindStaticEvents();

  const [commonsMaps, continentMaps, countryResponse] = await Promise.all([
    fetchMapCatalog().catch((error) => {
      console.warn("The Commons catalog is unavailable; using the bundled map.", error);
      return [];
    }),
    fetchContinentCatalog().catch((error) => {
      console.warn("The Commons continent maps are unavailable.", error);
      return [];
    }),
    fetch("data/countries.source.json").then(checkResponse).then((response) => response.json()),
  ]);

  sourceCountries = countryResponse;
  mapCatalog = [...commonsMaps, ...continentMaps, FALLBACK_MAP];
  if (!mapsForScope(state.mapScope).length) state.mapScope = "world";
  const scopedMaps = mapsForScope(state.mapScope);
  activeMap =
    scopedMaps.find((map) => map.title === state.mapSelections[state.mapScope]) ||
    scopedMaps.find((map) => map.title === state.mapTitle) ||
    scopedMaps[0];
  state.mapTitle = activeMap.title;
  state.mapSelections[state.mapScope] = activeMap.title;

  let svgText;
  try {
    svgText = await fetchMapSvg(activeMap);
  } catch (error) {
    if (activeMap.title === FALLBACK_MAP.title) throw error;
    console.warn(`Could not load ${activeMap.title}; using the bundled map.`, error);
    activeMap = FALLBACK_MAP;
    state.mapScope = "world";
    state.mapTitle = FALLBACK_MAP.title;
    state.mapSelections.world = FALLBACK_MAP.title;
    svgText = await fetchMapSvg(FALLBACK_MAP);
  }
  mountSvg(svgText);
  buildCountryIndex();
  decorateMap();
  renderAll();
  persistState();

  elements.mapLoading.hidden = true;
  requestAnimationFrame(() => elements.mapContainer.classList.add("is-ready"));
}

function checkResponse(response) {
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response;
}

function fetchMapSvg(map) {
  return fetch(map.url).then(checkResponse).then((response) => response.text());
}

async function handleMapSelection() {
  const nextMap = mapCatalog.find((map) => map.title === elements.mapSelect.value);
  if (!nextMap || nextMap.title === activeMap.title) return;
  invalidateImportPreview();
  await switchToMap(nextMap);
}

async function handleMapScopeSelection(event) {
  const button = event.target.closest("[data-map-scope]");
  const nextScope = button?.dataset.mapScope;
  if (!nextScope || nextScope === state.mapScope) return;

  const scopedMaps = mapsForScope(nextScope);
  if (!scopedMaps.length) {
    showToast("Those continent maps could not be loaded from Commons.");
    return;
  }

  invalidateImportPreview();
  const previousScope = state.mapScope;
  state.mapScope = nextScope;
  const nextMap =
    scopedMaps.find((map) => map.title === state.mapSelections[nextScope]) || scopedMaps[0];
  renderMapPicker();
  await switchToMap(nextMap, { previousScope, scope: nextScope });
}

function mapsForScope(scope) {
  return mapCatalog.filter((map) => map.scope === scope);
}

async function switchToMap(nextMap, options = {}) {
  const requestId = ++mapSwitchRequestId;
  const previousMap = activeMap;
  const previousScope = options.previousScope || state.mapScope;
  const requestedScope = options.scope || state.mapScope;
  elements.mapSelect.disabled = true;
  elements.mapScopeButtons.forEach((button) => {
    button.disabled = true;
  });
  elements.mapLoading.hidden = false;
  elements.mapLoading.classList.remove("has-error");
  const loadingTitle = document.createElement("strong");
  loadingTitle.textContent = "Loading map…";
  const loadingDetail = document.createElement("span");
  loadingDetail.textContent = nextMap.name;
  elements.mapLoading.replaceChildren(loadingTitle, loadingDetail);
  elements.mapContainer.classList.remove("is-ready");
  hideTooltip();

  try {
    const svgText = await fetchMapSvg(nextMap);
    if (requestId !== mapSwitchRequestId) return;
    activeMap = nextMap;
    state.mapScope = requestedScope;
    state.mapTitle = nextMap.title;
    state.mapSelections[requestedScope] = nextMap.title;
    mountSvg(svgText);
    buildCountryIndex();
    decorateMap();
    renderAll();
    persistState();
    showToast(`${nextMap.name} selected`);
  } catch (error) {
    if (requestId !== mapSwitchRequestId) return;
    console.error(error);
    activeMap = previousMap;
    state.mapScope = previousScope;
    state.mapTitle = previousMap.title;
    renderMapPicker();
    showToast("That map could not be loaded. Your previous map is unchanged.");
  } finally {
    if (requestId === mapSwitchRequestId) {
      elements.mapLoading.hidden = true;
      elements.mapScopeButtons.forEach((button) => {
        button.disabled = false;
      });
      elements.mapSelect.disabled = mapsForScope(state.mapScope).length < 2;
      requestAnimationFrame(() => elements.mapContainer.classList.add("is-ready"));
    }
  }
}

function restoreState() {
  const storedState = readStoredValue(STORAGE_KEY);
  if (storedState === null) return;

  try {
    const saved = JSON.parse(storedState);
    if (
      !saved ||
      !Array.isArray(saved.palette) ||
      !saved.assignments ||
      typeof saved.assignments !== "object"
    ) {
      return;
    }

    state.palette = saved.palette
      .slice(0, 8)
      .map((item, index) => ({
        color: validHex(item.color) ? item.color : DEFAULT_PALETTE[index].color,
        label: String(item.label || DEFAULT_PALETTE[index].label).slice(0, 80),
      }));
    if (state.palette.length < 2) {
      state.palette = DEFAULT_PALETTE.slice(0, 3).map((item) => ({ ...item }));
    }
    state.assignments = Object.fromEntries(
      Object.entries(saved.assignments).filter(
        ([code, index]) => /^[A-Z]{2}$/.test(code) && Number.isInteger(index),
      ),
    );
    if (typeof saved.mapTitle === "string" && /^File:.*\.svg$/i.test(saved.mapTitle)) {
      state.mapTitle = saved.mapTitle;
    }
    if (saved.mapScope === "continent" || saved.mapScope === "world") {
      state.mapScope = saved.mapScope;
    }
    if (saved.mapSelections && typeof saved.mapSelections === "object") {
      for (const scope of ["world", "continent"]) {
        const title = saved.mapSelections[scope];
        if (typeof title === "string" && /^File:.*\.svg$/i.test(title)) {
          state.mapSelections[scope] = title;
        }
      }
    } else if (state.mapScope === "world") {
      state.mapSelections.world = state.mapTitle;
    }
    const savedExportOptions = saved.exportOptions || {};
    state.exportOptions = {
      legendEnabled:
        typeof savedExportOptions.legendEnabled === "boolean"
          ? savedExportOptions.legendEnabled
          : DEFAULT_EXPORT_OPTIONS.legendEnabled,
      legendPosition: LEGEND_POSITIONS.includes(savedExportOptions.legendPosition)
        ? savedExportOptions.legendPosition
        : DEFAULT_EXPORT_OPTIONS.legendPosition,
      legendBackground: validHex(savedExportOptions.legendBackground)
        ? savedExportOptions.legendBackground
        : DEFAULT_EXPORT_OPTIONS.legendBackground,
      legendOpacity: Number.isFinite(savedExportOptions.legendOpacity)
        ? Math.min(1, Math.max(0, savedExportOptions.legendOpacity))
        : DEFAULT_EXPORT_OPTIONS.legendOpacity,
      title: String(savedExportOptions.title || "").slice(0, 120),
      titlePosition:
        savedExportOptions.titlePosition === "bottom"
          ? "bottom"
          : DEFAULT_EXPORT_OPTIONS.titlePosition,
    };
  } catch {
    removeStoredValue(STORAGE_KEY);
  }
}

function mountSvg(svgText) {
  const documentNode = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const parserError = documentNode.querySelector("parsererror");
  if (parserError || documentNode.documentElement.localName !== "svg") {
    throw new Error("The selected map SVG is invalid.");
  }

  svgElement = documentNode.documentElement;
  sanitizeSvg(svgElement);
  const viewBox = getSvgViewBox(svgElement);
  currentMapViewBox = viewBox;
  currentMapDimensions = { width: viewBox[2], height: viewBox[3] };
  svgElement.removeAttribute("width");
  svgElement.removeAttribute("height");
  svgElement.setAttribute("viewBox", viewBox.join(" "));
  svgElement.setAttribute("aria-hidden", "true");
  svgElement.setAttribute("focusable", "false");
  elements.mapFrame.style.aspectRatio = `${viewBox[2]} / ${viewBox[3]}`;
  elements.mapFrame.style.setProperty("--map-aspect", String(viewBox[2] / viewBox[3]));
  mapShadowRoot ||= elements.mapContainer.attachShadow({ mode: "open" });
  const mapStyles = document.createElement("style");
  mapStyles.textContent = `
    svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: calc(100dvh - 270px);
      overflow: visible;
      filter: drop-shadow(0 14px 28px rgb(2 6 23 / 20%));
    }
    svg [data-country-code] {
      cursor: pointer;
      transition: fill 180ms ease, filter 160ms ease;
    }
    svg [data-country-code]:hover,
    svg [data-country-code].is-highlighted {
      filter: brightness(0.9) saturate(1.12) drop-shadow(0 0 3px rgb(2 6 23 / 55%));
    }
    svg [data-country-code].is-located {
      animation: locate-country 900ms ease both;
    }
    @keyframes locate-country {
      0%, 100% { filter: none; }
      35% { filter: brightness(1.15) saturate(1.5) drop-shadow(0 0 10px var(--accent)); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
      }
    }
  `;
  mapShadowRoot.replaceChildren(svgElement, mapStyles);
}

function sanitizeSvg(svg) {
  svg
    .querySelectorAll("script, foreignObject, animate, animateTransform, animateMotion, set")
    .forEach((element) => element.remove());
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if (name === "src" || name === "xml:base") element.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href") && value && !value.startsWith("#")) {
        element.removeAttribute(attribute.name);
      }
      if (CSS_REFERENCE_ATTRIBUTES.has(name)) {
        const sanitized = sanitizeCssReferences(value);
        if (sanitized) element.setAttribute(attribute.name, sanitized);
        else element.removeAttribute(attribute.name);
      }
    }
  }
  svg.querySelectorAll("style").forEach((style) => {
    const sanitized = sanitizeCssReferences(style.textContent || "");
    if (sanitized) style.textContent = sanitized;
    else style.remove();
  });
}

function sanitizeCssReferences(cssText) {
  const normalized = decodeCssEscapes(String(cssText))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(normalized)) return "";

  return normalized.replace(
    /\burl\s*\(\s*(?:(['"])(.*?)\1|([^)]*))\s*\)/gi,
    (match, quote, quotedValue, bareValue) => {
      const reference = String(quotedValue ?? bareValue ?? "").trim();
      return /^#[A-Za-z_][\w:.-]*$/.test(reference) ? match : "none";
    },
  );
}

function decodeCssEscapes(value) {
  return value.replace(/\\([\da-f]{1,6})\s?|\\([\s\S])/gi, (_match, hex, character) => {
    if (!hex) return character || "";
    const codePoint = Number.parseInt(hex, 16);
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "\uFFFD";
  });
}

function getSvgViewBox(svg) {
  const parsedViewBox = (svg.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parsedViewBox.length === 4 && parsedViewBox.every(Number.isFinite)) return parsedViewBox;

  const width = parseSvgLength(svg.getAttribute("width")) || 2754;
  const height = parseSvgLength(svg.getAttribute("height")) || 1398;
  return [0, 0, width, height];
}

function parseSvgLength(value) {
  const parsed = Number.parseFloat(String(value || "").replace(/px$/i, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildCountryIndex() {
  const normalizedCountries = sourceCountries.map((country) => {
    const alpha2 = country["alpha-2"];
    return {
      alpha2,
      alpha3: country["alpha-3"],
      name: DISPLAY_NAME_OVERRIDES[alpha2] || country.name,
      sourceName: country.name,
    };
  });
  if (!normalizedCountries.some((country) => country.alpha2 === "XK")) {
    normalizedCountries.push({ alpha2: "XK", alpha3: "XKX", name: "Kosovo", sourceName: "Kosovo" });
  }
  normalizedCountries.sort((a, b) => a.name.localeCompare(b.name, "en"));

  allCountryByCode = new Map(normalizedCountries.map((country) => [country.alpha2, country]));
  countries = normalizedCountries
    .filter((country) => findCountryShapes(country.alpha2).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  countryByCode = new Map(countries.map((country) => [country.alpha2, country]));
  lookupToCode = new Map();

  for (const country of normalizedCountries) {
    for (const value of [country.alpha2, country.alpha3, country.name, country.sourceName]) {
      lookupToCode.set(normalizeLookup(value), country.alpha2);
    }
  }
  for (const [alias, code] of Object.entries(NAME_ALIASES)) {
    if (allCountryByCode.has(code)) lookupToCode.set(normalizeLookup(alias), code);
  }

  state.assignments = Object.fromEntries(
    Object.entries(state.assignments).filter(
      ([code, index]) => allCountryByCode.has(code) && index >= 0 && index < state.palette.length,
    ),
  );
}

function decorateMap() {
  for (const country of countries) {
    for (const shape of findCountryShapes(country.alpha2)) {
      shape.dataset.countryCode = country.alpha2;
    }
  }

  svgElement.addEventListener("click", handleMapClick);
  svgElement.addEventListener("pointermove", handleMapPointerMove);
  svgElement.addEventListener("pointerleave", hideTooltip);
}

function bindStaticEvents() {
  elements.appPickerButton.addEventListener("click", toggleAppPicker);
  elements.themeLight.addEventListener("click", () => setTheme("light"));
  elements.themeDark.addEventListener("click", () => setTheme("dark"));
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeyDown);
  elements.mapScopeButtons.forEach((button) =>
    button.addEventListener("click", handleMapScopeSelection),
  );
  elements.mapSelect.addEventListener("change", handleMapSelection);
  elements.countrySearch.addEventListener("input", renderCountryList);
  elements.paletteSize.addEventListener("change", handlePaletteSizeChange);
  elements.paletteList.addEventListener("input", handlePaletteInput);
  elements.countryList.addEventListener("click", handleCountryListClick);
  elements.countryList.addEventListener("pointerover", handleCountryListHover);
  elements.countryList.addEventListener("pointerout", clearCountryHighlights);
  elements.chooseFileButton.addEventListener("click", () => elements.csvFile.click());
  elements.csvFile.addEventListener("change", handleFileChoice);
  elements.importText.addEventListener("input", updateImportColumns);
  elements.importColumn.addEventListener("change", () => {
    invalidateImportPreview();
    updateImportCategoryFields();
  });
  elements.importCategoryColumn.addEventListener("change", () => {
    invalidateImportPreview();
    updateImportCategoryFields();
  });
  elements.importColor.addEventListener("change", invalidateImportPreview);
  elements.previewImportButton.addEventListener("click", previewImport);
  elements.applyImportButton.addEventListener("click", applyImport);
  elements.cancelImportPreviewButton.addEventListener("click", cancelImportPreview);
  elements.legendEnabled.addEventListener("change", handleExportOptionsInput);
  elements.legendPosition.addEventListener("change", handleExportOptionsInput);
  elements.legendBackground.addEventListener("input", handleExportOptionsInput);
  elements.legendOpacity.addEventListener("input", handleExportOptionsInput);
  elements.exportTitle.addEventListener("input", handleExportOptionsInput);
  elements.titlePosition.addEventListener("change", handleExportOptionsInput);
  elements.resetButton.addEventListener("click", () => {
    invalidateImportPreview();
    elements.resetDialog.showModal();
  });
  elements.confirmResetButton.addEventListener("click", resetMap);
  elements.exportButton.addEventListener("click", exportSvg);
  elements.exportPngButton.addEventListener("click", exportPng);
  elements.exportPdfButton.addEventListener("click", exportPdf);
  elements.downloadCsvButton.addEventListener("click", exportAssignmentsCsv);
}

function restoreTheme() {
  const savedTheme = readStoredValue(THEME_STORAGE_KEY);
  const preferredTheme =
    savedTheme === "dark" || savedTheme === "light"
      ? savedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  setTheme(preferredTheme, { persist: false });
}

function setTheme(theme, options = {}) {
  const dark = theme === "dark";
  elements.appShell.classList.toggle("theme-light", !dark);
  elements.themeLight.classList.toggle("active", !dark);
  elements.themeDark.classList.toggle("active", dark);
  elements.themeLight.setAttribute("aria-pressed", String(!dark));
  elements.themeDark.setAttribute("aria-pressed", String(dark));
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (options.persist !== false) {
    writeStoredValue(THEME_STORAGE_KEY, dark ? "dark" : "light");
  }
}

function toggleAppPicker() {
  const open = elements.appPickerMenu.classList.toggle("is-hidden") === false;
  elements.appPickerButton.setAttribute("aria-expanded", String(open));
}

function closeAppPicker() {
  elements.appPickerMenu.classList.add("is-hidden");
  elements.appPickerButton.setAttribute("aria-expanded", "false");
}

function handleDocumentPointerDown(event) {
  if (!elements.appPicker.contains(event.target)) closeAppPicker();
}

function handleDocumentKeyDown(event) {
  if (event.key !== "Escape") return;
  closeAppPicker();
  elements.appPickerButton.focus();
}

function handleMapClick(event) {
  const code = event.target.closest("[data-country-code]")?.dataset.countryCode;
  if (!code) return;

  if (event.shiftKey) {
    setCountryColor(code, null);
    showToast(`${countryByCode.get(code).name} cleared`);
    return;
  }

  const current = Number.isInteger(state.assignments[code]) ? state.assignments[code] : null;
  const next = getNextColorIndex(current, state.palette.length);
  setCountryColor(code, next);
}

function handleMapPointerMove(event) {
  const code = event.target.closest("[data-country-code]")?.dataset.countryCode;
  if (!code) {
    hideTooltip();
    return;
  }

  const country = countryByCode.get(code);
  const index = importPreview?.mapPreview
    ? importPreview.assignments.get(code) ?? state.assignments[code]
    : state.assignments[code];
  const legend = Number.isInteger(index) ? ` · ${state.palette[index].label}` : "";
  elements.mapTooltip.textContent = `${country.name} · ${country.alpha2}${legend}`;
  elements.mapTooltip.style.left = `${event.clientX}px`;
  elements.mapTooltip.style.top = `${event.clientY}px`;
  elements.mapTooltip.hidden = false;
}

function hideTooltip() {
  elements.mapTooltip.hidden = true;
}

function setCountryColor(code, index, options = {}) {
  invalidateImportPreview();
  if (index === null) {
    delete state.assignments[code];
  } else {
    state.assignments[code] = index;
  }
  paintCountry(code);
  renderStatus();
  renderCountryList();
  persistState();
  if (options.locate) locateCountry(code);
}

function paintCountry(code) {
  const index = state.assignments[code];
  const color = Number.isInteger(index) ? state.palette[index]?.color : null;
  for (const shape of findCountryShapes(code)) {
    if (color) {
      shape.style.setProperty("fill", color, "important");
    } else {
      shape.style.removeProperty("fill");
    }
  }
}

function findCountryShapes(code) {
  if (!svgElement) return [];
  const lowerCode = code.toLowerCase();
  return [
    ...svgElement.querySelectorAll(
      `[class~="${lowerCode}"], [id="${lowerCode}"], [id="${code.toUpperCase()}"]`,
    ),
  ];
}

function locateCountry(code) {
  const shapes = findCountryShapes(code);
  shapes.forEach((shape) => {
    shape.classList.remove("is-located");
    requestAnimationFrame(() => shape.classList.add("is-located"));
  });
  window.setTimeout(
    () => shapes.forEach((shape) => shape.classList.remove("is-located")),
    950,
  );
}

function handleCountryListClick(event) {
  const button = event.target.closest("[data-code]");
  if (!button) return;
  const code = button.dataset.code;
  const current = Number.isInteger(state.assignments[code]) ? state.assignments[code] : null;
  setCountryColor(code, getNextColorIndex(current, state.palette.length), { locate: true });
}

function handleCountryListHover(event) {
  const code = event.target.closest("[data-code]")?.dataset.code;
  if (!code) return;
  clearCountryHighlights();
  findCountryShapes(code).forEach((shape) => shape.classList.add("is-highlighted"));
}

function clearCountryHighlights() {
  svgElement
    ?.querySelectorAll(".is-highlighted")
    .forEach((shape) => shape.classList.remove("is-highlighted"));
}

function renderAll() {
  renderMapPicker();
  elements.paletteSize.value = String(state.palette.length);
  renderPalette();
  renderImportColors();
  renderExportOptions();
  renderCountryList();
  renderMap();
  renderMapAnnotations();
  renderStatus();
}

function renderExportOptions() {
  const options = state.exportOptions;
  elements.legendEnabled.checked = options.legendEnabled;
  elements.legendOptions.disabled = !options.legendEnabled;
  const selectedPosition = elements.legendPosition.querySelector(
    `input[value="${options.legendPosition}"]`,
  );
  if (selectedPosition) selectedPosition.checked = true;
  elements.legendBackground.value = options.legendBackground;
  const transparency = Math.round((1 - options.legendOpacity) * 100);
  elements.legendOpacity.value = String(transparency);
  elements.legendOpacityValue.textContent = `${transparency}%`;
  elements.exportTitle.value = options.title;
  elements.titlePosition.value = options.titlePosition;
}

function handleExportOptionsInput(event) {
  const { exportOptions } = state;
  if (event.target === elements.legendEnabled) {
    exportOptions.legendEnabled = elements.legendEnabled.checked;
    elements.legendOptions.disabled = !exportOptions.legendEnabled;
  } else if (event.target.matches('input[name="legend-position"]')) {
    exportOptions.legendPosition = event.target.value;
  } else if (event.target === elements.legendBackground) {
    exportOptions.legendBackground = elements.legendBackground.value;
  } else if (event.target === elements.legendOpacity) {
    exportOptions.legendOpacity = 1 - Number(elements.legendOpacity.value) / 100;
    elements.legendOpacityValue.textContent = `${elements.legendOpacity.value}%`;
  } else if (event.target === elements.exportTitle) {
    exportOptions.title = elements.exportTitle.value.slice(0, 120);
  } else if (event.target === elements.titlePosition) {
    exportOptions.titlePosition = elements.titlePosition.value;
  }
  renderMapAnnotations();
  persistState();
}

function renderMapAnnotations() {
  if (!svgElement) return;
  removeMapAnnotations(svgElement);
  if (state.exportOptions.legendEnabled) addLegendToSvg(svgElement);
  if (state.exportOptions.title.trim()) addTitleToSvg(svgElement);
}

function removeMapAnnotations(svg) {
  svg
    .querySelectorAll("#maphue-legend, #maphue-title")
    .forEach((annotation) => annotation.remove());
}

function renderMapPicker() {
  const scopedMaps = mapsForScope(state.mapScope);
  elements.mapScopeButtons.forEach((button) => {
    const active = button.dataset.mapScope === state.mapScope;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.mapScopeNote.textContent =
    state.mapScope === "world"
      ? "Choose a world map divided into countries."
      : "Choose a continent-focused country map.";
  elements.mapSelectLabel.textContent =
    state.mapScope === "world" ? "World base map" : "Continent map";
  elements.mapSelect.replaceChildren(
    ...scopedMaps.map((map) => {
      const option = document.createElement("option");
      option.value = map.title;
      option.textContent = map.fallback
        ? `${map.name} · offline`
        : map.region
          ? `${map.region} — ${map.name}`
          : map.name;
      return option;
    }),
  );
  elements.mapSelect.value = activeMap.title;
  elements.mapSelect.disabled = scopedMaps.length < 2;

  const visibleMapCount =
    state.mapScope === "world"
      ? scopedMaps.filter((map) => map.categoryMap).length
      : scopedMaps.length;
  elements.mapCount.textContent = `${visibleMapCount} ${
    visibleMapCount === 1 ? "map" : "maps"
  }`;
  elements.mapDescription.textContent = activeMap.description;
  const interactiveCountryCount = countries.length;
  elements.mapCompatibility.classList.toggle("is-limited", interactiveCountryCount === 0);
  elements.mapCompatibility.textContent = interactiveCountryCount
    ? `${interactiveCountryCount} ISO country groups are colorable in this SVG.`
    : "This source SVG has no ISO country groups, so it is view/export only.";
  elements.mapSourceLink.href = activeMap.commonsUrl;
  elements.mapSourceLink.textContent = !activeMap.fallback
    ? "View file and full description"
    : "View source file";
  elements.activeMapName.textContent = activeMap.name;
  elements.mapDimensions.textContent = `${Math.round(currentMapDimensions.width)} × ${Math.round(
    currentMapDimensions.height,
  )} SVG`;

  const hasThumbnail = Boolean(activeMap.thumbnailUrl);
  elements.mapThumbnail.hidden = !hasThumbnail;
  elements.mapThumbnailPlaceholder.hidden = hasThumbnail;
  elements.mapThumbnail.alt = hasThumbnail ? `Preview of ${activeMap.name}` : "";
  elements.mapThumbnail.src = hasThumbnail ? activeMap.thumbnailUrl : "";
  elements.mapThumbnail.onerror = () => {
    elements.mapThumbnail.hidden = true;
    elements.mapThumbnailPlaceholder.hidden = false;
  };
}

function renderMap() {
  for (const country of countries) paintCountry(country.alpha2);
}

function renderCountryList() {
  const focusedCode = elements.countryList.contains(document.activeElement)
    ? document.activeElement.dataset.code
    : null;
  const query = normalizeLookup(elements.countrySearch.value);
  const matches = countries
    .filter((country) => {
      if (!query) return true;
      return [country.name, country.sourceName, country.alpha2, country.alpha3].some((value) =>
        normalizeLookup(value).includes(query),
      );
    })
    .slice(0, query ? 80 : 60);

  elements.countryList.replaceChildren(
    ...matches.map((country) => {
      const index = state.assignments[country.alpha2];
      const button = document.createElement("button");
      button.className = "country-option";
      button.type = "button";
      button.dataset.code = country.alpha2;
      const assigned = Number.isInteger(index);
      const label = assigned
        ? state.palette[index]?.label || `Category ${index + 1}`
        : "uncolored";
      button.setAttribute("aria-pressed", String(assigned));
      button.setAttribute(
        "aria-label",
        `${country.name}, ${label}. Activate to ${assigned ? "change" : "assign"} color.`,
      );
      button.innerHTML = `
        <span class="country-swatch" aria-hidden="true"></span>
        <span class="country-option-name"></span>
        <span class="country-option-code">${country.alpha2} · ${country.alpha3}</span>
      `;
      button.querySelector(".country-option-name").textContent = country.name;
      const swatch = button.querySelector(".country-swatch");
      if (Number.isInteger(index) && state.palette[index]) {
        swatch.style.background = state.palette[index].color;
        swatch.style.borderColor = state.palette[index].color;
      }
      return button;
    }),
  );

  if (focusedCode) {
    elements.countryList.querySelector(`[data-code="${focusedCode}"]`)?.focus({ preventScroll: true });
  }

  elements.countryEmpty.hidden = matches.length > 0;
  elements.countryTotal.textContent = `${countries.length} available`;
}

function renderPalette() {
  elements.paletteList.replaceChildren(
    ...state.palette.map((item, index) => {
      const row = document.createElement("label");
      row.className = "palette-row";
      row.innerHTML = `
        <span class="palette-index">${String(index + 1).padStart(2, "0")}</span>
        <input
          class="color-picker"
          type="color"
          value="${item.color}"
          data-palette-index="${index}"
          data-field="color"
          aria-label="Color ${index + 1}"
        >
        <input
          class="legend-input"
          type="text"
          maxlength="80"
          value=""
          data-palette-index="${index}"
          data-field="label"
          aria-label="Legend label ${index + 1}"
        >
      `;
      row.querySelector(".legend-input").value = item.label;
      return row;
    }),
  );
}

function renderImportColors() {
  const selected = Number(elements.importColor.value) || 0;
  elements.importColor.replaceChildren(
    ...state.palette.map((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${index + 1}. ${item.label}`;
      return option;
    }),
  );
  elements.importColor.value = String(Math.min(selected, state.palette.length - 1));
}

function renderStatus() {
  const assigned = Object.keys(state.assignments).length;
  elements.assignedCount.textContent = `${assigned} ${assigned === 1 ? "country" : "countries"}`;
  elements.selectionSummary.textContent = assigned
    ? `${assigned} ${assigned === 1 ? "country is" : "countries are"} colored across ${
        new Set(Object.values(state.assignments)).size
      } ${new Set(Object.values(state.assignments)).size === 1 ? "category" : "categories"}.`
    : "No countries colored yet.";
}

function handlePaletteSizeChange() {
  invalidateImportPreview();
  const nextSize = Number(elements.paletteSize.value);
  const previousSize = state.palette.length;
  if (nextSize > previousSize) {
    for (let index = previousSize; index < nextSize; index += 1) {
      state.palette.push({ ...DEFAULT_PALETTE[index] });
    }
  } else {
    state.palette = state.palette.slice(0, nextSize);
    for (const [code, index] of Object.entries(state.assignments)) {
      if (index >= nextSize) state.assignments[code] = nextSize - 1;
    }
  }
  renderAll();
  persistState();
}

function handlePaletteInput(event) {
  const input = event.target.closest("[data-palette-index]");
  if (!input) return;
  const index = Number(input.dataset.paletteIndex);
  const field = input.dataset.field;
  state.palette[index][field] = input.value;
  invalidateImportPreview();

  if (field === "color") {
    for (const [code, assignedIndex] of Object.entries(state.assignments)) {
      if (assignedIndex === index) paintCountry(code);
    }
  } else {
    renderImportColors();
  }
  renderMapAnnotations();
  persistState();
}

async function handleFileChoice() {
  const [file] = elements.csvFile.files;
  if (!file) return;
  if (file.size > 2_000_000) {
    showToast("Please choose a CSV smaller than 2 MB.");
    elements.csvFile.value = "";
    return;
  }
  elements.importText.value = await file.text();
  updateImportColumns();
  showToast(`${file.name} loaded`);
}

function updateImportColumns() {
  invalidateImportPreview();
  const rows = parseDelimitedText(elements.importText.value);
  const maxColumns = Math.max(1, ...rows.slice(0, 20).map((row) => row.length));
  const currentCountryColumn = elements.importColumn.value;
  const currentCategoryColumn = elements.importCategoryColumn.value;
  const countryOptions = [{ value: "auto", label: "Detect automatically" }];
  const categoryOptions = [
    { value: "auto", label: "Detect from header" },
    { value: "none", label: "Use one category" },
  ];

  for (let index = 0; index < maxColumns; index += 1) {
    const header = rows[0]?.[index]?.trim();
    const label = header ? `Column ${index + 1}: ${header.slice(0, 24)}` : `Column ${index + 1}`;
    countryOptions.push({
      value: String(index),
      label,
    });
    categoryOptions.push({ value: String(index), label });
  }

  elements.importColumn.replaceChildren(
    ...countryOptions.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
  elements.importColumn.value = countryOptions.some((option) => option.value === currentCountryColumn)
    ? currentCountryColumn
    : "auto";
  elements.importCategoryColumn.replaceChildren(
    ...categoryOptions.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
  elements.importCategoryColumn.value = categoryOptions.some(
    (option) => option.value === currentCategoryColumn,
  )
    ? currentCategoryColumn
    : "auto";
  updateImportCategoryFields();
}

function updateImportCategoryFields() {
  const rows = parseDelimitedText(elements.importText.value);
  const hasCategoryColumn = getImportCategoryColumn(rows) !== null;
  elements.importColor.disabled = hasCategoryColumn;
  elements.importColorHelp.textContent = hasCategoryColumn
    ? "A category column is selected above. Choose “Use one category” to enable this selector."
    : "Used for every row when no category column is selected.";
}

function getImportCategoryColumn(rows) {
  const selection = elements.importCategoryColumn.value;
  if (selection === "none") return null;
  if (selection === "auto") return detectCategoryColumn(rows);
  const column = Number(selection);
  return Number.isInteger(column) && column >= 0 ? column : null;
}

function invalidateImportPreview() {
  if (importPreview?.mapPreview) {
    for (const code of importPreview.assignments.keys()) paintCountry(code);
  }
  importPreview = null;
  elements.applyImportButton.disabled = true;
  elements.cancelImportPreviewButton.hidden = true;
  elements.importReport.hidden = true;
  elements.importReport.replaceChildren();
}

function cancelImportPreview() {
  invalidateImportPreview();
  showToast("CSV preview canceled");
}

function previewImport() {
  invalidateImportPreview();
  const rows = parseDelimitedText(elements.importText.value);
  if (!rows.length) {
    importPreview = { assignments: new Map(), issues: ["Paste country data or choose a CSV first."], duplicates: 0 };
    renderImportPreview(importPreview);
    return;
  }

  const categoryColumn = getImportCategoryColumn(rows);
  const requestedColumn =
    elements.importColumn.value === "auto"
      ? detectCountryColumn(rows, categoryColumn)
      : Number(elements.importColumn.value);
  const targetIndex = Number(elements.importColor.value);
  const assignments = new Map();
  const issues = [];
  const conflicts = new Set();
  let duplicates = 0;
  const headerRow = looksLikeHeader(rows[0]?.[requestedColumn]) ||
    (categoryColumn !== null && looksLikeCategoryHeader(rows[0]?.[categoryColumn]));
  const firstDataRow = headerRow ? 1 : 0;

  if (categoryColumn !== null && categoryColumn === requestedColumn) {
    issues.push("Choose different columns for country and category.");
  }

  for (let rowIndex = firstDataRow; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const recordNumber = rowIndex + 1;
    const rawCountry = row[requestedColumn]?.trim();
    const rawCategory = categoryColumn === null ? "" : row[categoryColumn]?.trim();
    if (!rawCountry && !rawCategory) continue;
    if (!rawCountry) {
      issues.push(`Record ${recordNumber} has a category but no country.`);
      continue;
    }

    const code = resolveCountry(rawCountry);
    if (!code) {
      issues.push(`Record ${recordNumber}: country “${rawCountry}” was not recognized.`);
      continue;
    }

    let categoryIndex = targetIndex;
    if (categoryColumn !== null) {
      if (!rawCategory) {
        issues.push(`Record ${recordNumber}: category is empty for ${rawCountry}.`);
        continue;
      }
      const categoryMatch = resolveCategory(rawCategory);
      if (categoryMatch.error) {
        issues.push(`Record ${recordNumber}: ${categoryMatch.error} (“${rawCategory}”).`);
        continue;
      }
      categoryIndex = categoryMatch.index;
    }

    if (!state.palette[categoryIndex]) {
      issues.push(`Record ${recordNumber}: the selected category is unavailable.`);
      continue;
    }
    if (assignments.has(code)) {
      if (assignments.get(code) !== categoryIndex) {
        if (!conflicts.has(code)) {
          const countryName = allCountryByCode.get(code)?.name || rawCountry;
          issues.push(`${countryName} is assigned to more than one category.`);
          conflicts.add(code);
        }
      } else {
        duplicates += 1;
      }
      continue;
    }
    assignments.set(code, categoryIndex);
  }

  if (!rows.slice(firstDataRow).some((row) => row[requestedColumn]?.trim())) {
    issues.push("No country rows were found in the selected column.");
  }
  importPreview = { assignments, issues, duplicates };
  renderImportPreview(importPreview);
}

function resolveCategory(value) {
  const normalized = normalizeLookup(value);
  const labelMatches = state.palette
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => normalizeLookup(item.label) === normalized);
  const matches = labelMatches.length
    ? labelMatches
    : state.palette
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.color.toLowerCase() === value.trim().toLowerCase());

  if (!matches.length) return { error: "No legend label matches", index: null };
  if (matches.length > 1) return { error: "More than one legend category matches", index: null };
  return { error: null, index: matches[0].index };
}

function renderImportPreview(preview, { applied = false } = {}) {
  const report = elements.importReport;
  report.replaceChildren();
  const status = document.createElement("strong");
  const categoryGroups = new Map();

  for (const [code, index] of preview.assignments) {
    if (!categoryGroups.has(index)) categoryGroups.set(index, []);
    categoryGroups.get(index).push(allCountryByCode.get(code)?.name || code);
  }

  const countryCount = preview.assignments.size;
  const categoryCount = categoryGroups.size;
  status.textContent = applied
    ? `${countryCount} ${countryCount === 1 ? "country" : "countries"} assigned across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}.`
    : preview.issues.length
      ? `Preview blocked · ${preview.issues.length} ${preview.issues.length === 1 ? "issue" : "issues"} to fix.`
      : `${countryCount} ${countryCount === 1 ? "country" : "countries"} ready across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}.`;
  report.append(status);

  if (categoryGroups.size) {
    const list = document.createElement("ul");
    list.className = "import-category-breakdown";
    for (const [index, names] of categoryGroups) {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "import-category-swatch";
      swatch.style.backgroundColor = state.palette[index].color;
      swatch.setAttribute("aria-hidden", "true");
      const description = document.createElement("span");
      const sample = names.slice(0, 3).join(", ");
      const remainder = names.length - Math.min(names.length, 3);
      description.textContent = `${state.palette[index].label}: ${names.length} · ${sample}${
        remainder ? `, and ${remainder} more` : ""
      }`;
      item.append(swatch, description);
      list.append(item);
    }
    report.append(list);
  }

  if (preview.duplicates) {
    const duplicates = document.createElement("p");
    duplicates.textContent = `${preview.duplicates} repeated row${preview.duplicates === 1 ? "" : "s"} with the same assignment will be merged.`;
    report.append(duplicates);
  }

  if (preview.issues.length) {
    const issueList = document.createElement("ul");
    issueList.className = "import-issues";
    for (const issue of preview.issues.slice(0, 8)) {
      const item = document.createElement("li");
      item.textContent = issue;
      issueList.append(item);
    }
    if (preview.issues.length > 8) {
      const item = document.createElement("li");
      item.textContent = `And ${preview.issues.length - 8} more issues.`;
      issueList.append(item);
    }
    report.append(issueList);
  }

  report.hidden = false;
  elements.applyImportButton.disabled =
    applied || preview.issues.length > 0 || preview.assignments.size === 0;
  elements.cancelImportPreviewButton.hidden =
    applied || preview.issues.length > 0 || preview.assignments.size === 0;

  if (!applied && !preview.issues.length && preview.assignments.size) {
    preview.mapPreview = true;
    for (const [code, index] of preview.assignments) {
      for (const shape of findCountryShapes(code)) {
        shape.style.setProperty("fill", state.palette[index].color, "important");
      }
    }
  }
}

function applyImport() {
  if (!importPreview || importPreview.issues.length || !importPreview.assignments.size) {
    showToast("Preview a valid CSV before applying it.");
    return;
  }

  for (const [code, categoryIndex] of importPreview.assignments) {
    state.assignments[code] = categoryIndex;
    paintCountry(code);
  }
  const appliedPreview = importPreview;
  importPreview = null;
  renderStatus();
  renderCountryList();
  persistState();
  renderImportPreview(appliedPreview, { applied: true });
  showToast(`${appliedPreview.assignments.size} countries assigned`);
}

function parseDelimitedText(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  if (!source.trim()) return [];

  const delimiter = chooseDelimiter(source);
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && delimiter && character === delimiter) {
      row.push(value.trim());
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      row.push(value.trim());
      if (row.some((cell) => cell)) rows.push(row);
      row = [];
      value = "";
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      value += character;
    }
  }

  row.push(value.trim());
  if (row.some((cell) => cell)) rows.push(row);
  return rows;
}

function chooseDelimiter(text) {
  const counts = new Map([",", ";", "\t"].map((delimiter) => [delimiter, 0]));
  let quoted = false;
  let records = 0;

  for (let index = 0; index < text.length && records < 20; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (counts.has(character)) counts.set(character, counts.get(character) + 1);
      if (character === "\n" || character === "\r") {
        records += 1;
        if (character === "\r" && text[index + 1] === "\n") index += 1;
      }
    }
  }

  const candidates = [...counts].map(([delimiter, count]) => ({ delimiter, count }));
  const winner = candidates.sort((a, b) => b.count - a.count)[0];
  return winner.count ? winner.delimiter : null;
}

function detectCountryColumn(rows, excludedColumn = null) {
  const maxColumns = Math.max(...rows.slice(0, 30).map((row) => row.length));
  let best = { index: 0, score: -1 };
  for (let index = 0; index < maxColumns; index += 1) {
    if (index === excludedColumn) continue;
    const score = rows
      .slice(0, 30)
      .reduce((total, row) => total + (resolveCountry(row[index] || "") ? 1 : 0), 0);
    if (score > best.score) best = { index, score };
  }
  return best.index;
}

function detectCategoryColumn(rows) {
  const index =
    rows[0]?.findIndex((header) => CATEGORY_HEADER_NAMES.has(normalizeLookup(header))) ?? -1;
  return index < 0 ? null : index;
}

function resolveCountry(value) {
  return lookupToCode.get(normalizeLookup(value)) || null;
}

function normalizeLookup(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function looksLikeHeader(value) {
  return COUNTRY_HEADER_NAMES.has(normalizeLookup(value));
}

function looksLikeCategoryHeader(value) {
  return CATEGORY_HEADER_NAMES.has(normalizeLookup(value));
}

function persistState() {
  const saved = writeStoredValue(STORAGE_KEY, JSON.stringify(state));
  elements.saveStatus.textContent = saved ? "Saved locally" : "Storage unavailable · not saved";
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStoredValue(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be disabled; the app can still start with its default state.
  }
}

function resetMap() {
  state.palette = DEFAULT_PALETTE.slice(0, 3).map((item) => ({ ...item }));
  state.assignments = {};
  state.exportOptions = { ...DEFAULT_EXPORT_OPTIONS };
  renderAll();
  persistState();
  showToast("Map reset");
}

function exportSvg() {
  if (hasPendingMapPreview()) return;
  downloadBlob(createExportSvg(), "maphue-world-map.svg", "image/svg+xml;charset=utf-8");
  showToast("SVG exported");
}

async function exportPng() {
  if (hasPendingMapPreview()) return;
  await runRasterExport(elements.exportPngButton, async () => {
    const canvas = await renderExportCanvas();
    const png = await canvasToBlob(canvas, "image/png");
    downloadBlob(png, "maphue-world-map.png", "image/png");
    showToast(`PNG exported at ${canvas.width} × ${canvas.height}`);
  });
}

async function exportPdf() {
  if (hasPendingMapPreview()) return;
  await runRasterExport(elements.exportPdfButton, async () => {
    const canvas = await renderExportCanvas();
    const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.94);
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const pdfBytes = createPdfFromJpeg(jpegBytes, canvas.width, canvas.height);
    downloadBlob(pdfBytes, "maphue-world-map.pdf", "application/pdf");
    showToast("PDF exported");
  });
}

function hasPendingMapPreview() {
  if (!importPreview?.mapPreview) return false;
  showToast("Apply or cancel the CSV preview before exporting.");
  return true;
}

function createExportSvg() {
  const clone = svgElement.cloneNode(true);
  clone.removeAttribute("aria-hidden");
  clone.removeAttribute("focusable");
  clone.setAttribute("width", String(Math.round(currentMapDimensions.width)));
  clone.setAttribute("height", String(Math.round(currentMapDimensions.height)));
  clone.querySelectorAll("[data-country-code]").forEach((shape) => {
    delete shape.dataset.countryCode;
    shape.classList.remove("is-highlighted", "is-located");
  });

  removeMapAnnotations(clone);
  if (state.exportOptions.legendEnabled) addLegendToSvg(clone);
  if (state.exportOptions.title.trim()) addTitleToSvg(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

async function renderExportCanvas() {
  const svgBlob = new Blob([createExportSvg()], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    image.src = svgUrl;
    await image.decode();

    const canvas = document.createElement("canvas");
    const rasterDimensions = getRasterExportDimensions();
    canvas.width = rasterDimensions.width;
    canvas.height = rasterDimensions.height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function getRasterExportDimensions() {
  const maximumDimension = 4096;
  const scale = Math.min(
    1,
    maximumDimension / Math.max(currentMapDimensions.width, currentMapDimensions.height),
  );
  return {
    width: Math.max(1, Math.round(currentMapDimensions.width * scale)),
    height: Math.max(1, Math.round(currentMapDimensions.height * scale)),
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(`The browser could not create a ${type} export.`));
        }
      },
      type,
      quality,
    );
  });
}

async function runRasterExport(button, action) {
  const exportButtons = [elements.exportPngButton, elements.exportPdfButton];
  exportButtons.forEach((item) => {
    item.disabled = true;
  });
  button.setAttribute("aria-busy", "true");

  try {
    await action();
  } catch (error) {
    console.error(error);
    showToast("Export failed. Please try again.");
  } finally {
    button.removeAttribute("aria-busy");
    exportButtons.forEach((item) => {
      item.disabled = false;
    });
  }
}

function addLegendToSvg(svg) {
  const namespace = "http://www.w3.org/2000/svg";
  const legendWidth = 570;
  const legendHeight = 92 + state.palette.length * 54;
  const { width, height } = currentMapDimensions;
  const scale = Math.min(
    1,
    Math.max(
      0.5,
      Math.min((width * 0.32) / legendWidth, (height * 0.3) / legendHeight),
    ),
  );
  const titleMetrics = getExportTitleMetrics();
  const position = calculateAnchoredPosition(
    state.exportOptions.legendPosition,
    currentMapViewBox,
    legendWidth * scale,
    legendHeight * scale,
    {
      topInset:
        titleMetrics && state.exportOptions.titlePosition === "top"
          ? titleMetrics.fontSize * 1.45
          : 0,
      bottomInset:
        titleMetrics && state.exportOptions.titlePosition === "bottom"
          ? titleMetrics.fontSize * 1.45
          : 0,
    },
  );
  const textColor = readableTextColor(state.exportOptions.legendBackground);
  const legend = document.createElementNS(namespace, "g");
  legend.setAttribute("id", "maphue-legend");
  legend.setAttribute("transform", `translate(${position.x} ${position.y}) scale(${scale})`);
  legend.setAttribute("pointer-events", "none");

  const backdrop = document.createElementNS(namespace, "rect");
  backdrop.setAttribute("width", String(legendWidth));
  backdrop.setAttribute("height", String(legendHeight));
  backdrop.setAttribute("rx", "12");
  backdrop.setAttribute("fill", state.exportOptions.legendBackground);
  backdrop.setAttribute("fill-opacity", String(state.exportOptions.legendOpacity));
  backdrop.setAttribute("stroke", textColor);
  backdrop.setAttribute("stroke-opacity", String(state.exportOptions.legendOpacity));
  backdrop.setAttribute("stroke-width", "2");
  legend.append(backdrop);

  const legendTitle = document.createElementNS(namespace, "text");
  legendTitle.setAttribute("x", "28");
  legendTitle.setAttribute("y", "42");
  legendTitle.setAttribute("font-family", "Georgia, serif");
  legendTitle.setAttribute("font-size", "25");
  legendTitle.setAttribute("font-weight", "700");
  legendTitle.setAttribute("fill", textColor);
  legendTitle.textContent = "Legend";
  legend.append(legendTitle);

  state.palette.forEach((item, index) => {
    const y = 76 + index * 54;
    const swatch = document.createElementNS(namespace, "rect");
    swatch.setAttribute("x", "28");
    swatch.setAttribute("y", String(y));
    swatch.setAttribute("width", "28");
    swatch.setAttribute("height", "28");
    swatch.setAttribute("rx", "4");
    swatch.setAttribute("fill", item.color);
    legend.append(swatch);

    const text = document.createElementNS(namespace, "text");
    text.setAttribute("x", "72");
    text.setAttribute("y", String(y + 22));
    text.setAttribute("font-family", "Arial, sans-serif");
    text.setAttribute("font-size", "20");
    text.setAttribute("fill", textColor);
    text.textContent = item.label || `Category ${index + 1}`;
    legend.append(text);
  });
  svg.append(legend);
}

function getExportTitleMetrics() {
  const text = state.exportOptions.title.trim();
  if (!text) return null;

  const { width, height } = currentMapDimensions;
  const preferredSize = Math.min(68, Math.max(28, width * 0.032, height * 0.04));
  const fittedSize = (width * 0.88) / Math.max(1, text.length * 0.56);
  return {
    text,
    fontSize: Math.max(16, Math.min(preferredSize, fittedSize)),
  };
}

function addTitleToSvg(svg) {
  const namespace = "http://www.w3.org/2000/svg";
  const metrics = getExportTitleMetrics();
  if (!metrics) return;

  const [minX, minY, width, height] = currentMapViewBox;
  const margin = Math.min(width, height) * 0.025;
  const top = state.exportOptions.titlePosition === "top";
  const title = document.createElementNS(namespace, "text");
  title.setAttribute("id", "maphue-title");
  title.setAttribute("pointer-events", "none");
  title.setAttribute("x", String(minX + width / 2));
  title.setAttribute("y", String(top ? minY + margin + metrics.fontSize : minY + height - margin));
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("font-family", "Georgia, serif");
  title.setAttribute("font-size", String(metrics.fontSize));
  title.setAttribute("font-weight", "700");
  title.setAttribute("fill", "#18211d");
  title.setAttribute("stroke", "#ffffff");
  title.setAttribute("stroke-opacity", "0.9");
  title.setAttribute("stroke-width", String(Math.max(2, metrics.fontSize * 0.09)));
  title.setAttribute("paint-order", "stroke fill");
  title.textContent = metrics.text;
  svg.append(title);
}

function exportAssignmentsCsv() {
  if (hasPendingMapPreview()) return;
  const rows = [["country", "iso2", "iso3", "legend", "color"]];
  const assignments = Object.entries(state.assignments).filter(([code, index]) => {
    return allCountryByCode.has(code) && state.palette[index];
  });
  assignments.sort(([a], [b]) =>
    allCountryByCode.get(a).name.localeCompare(allCountryByCode.get(b).name, "en"),
  );
  for (const [code, index] of assignments) {
    const country = allCountryByCode.get(code);
    const palette = state.palette[index];
    rows.push([country.name, country.alpha2, country.alpha3, palette.label, palette.color]);
  }
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  downloadBlob(csv, "maphue-assignments.csv", "text/csv;charset=utf-8");
  showToast("Assignments CSV downloaded");
}

function escapeCsv(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2_600);
}

function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value));
}
