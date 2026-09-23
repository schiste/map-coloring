import { getNextColorIndex } from "./cycle.js";
import {
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
import { parseDelimitedText } from "./csv.js";
import {
  applyThemeColors,
  FALLBACK_DESCRIPTION,
  filterSpec,
  formModel,
  readForm,
  renderForm,
  specFromValues,
  updateVisibility,
  validDescription,
  valuesFromSpec,
} from "./mapgen-options.js";
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_PALETTE, parseSavedState, validHex } from "./state.js";
import {
  addMapAnnotations,
  buildExportSvg,
  getExportAttributionLayout,
  getSvgViewBox,
  removeMapAnnotations,
  sanitizeSvg,
} from "./svg-export.js";
import {
  assertSupportedMapgenSvg,
  buildGeneratedFeatureIndex,
  collectionFrom,
  countFeaturesWithoutData,
  crosswalkAppliesTo,
  crosswalkHints,
  crosswalkId,
  generatedColorRules,
  normalizeAssignmentKey,
  normalizeCrosswalkCode,
  normalizeMapLookup,
  normalizeMapLookup as normalizeLookup,
  recodeWithCrosswalk,
  resolveGeneratedFeature,
  slotBounds,
} from "./map-generator.js";

const STORAGE_KEY = "maphue-state-v1";
const THEME_STORAGE_KEY = "maphue-theme";
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
const REGION_CODE_HEADER_NAMES = new Set([
  "code",
  "iso 3166 2",
  "iso 3166 2 code",
  "fips",
  "geoid",
  "region code",
  "state code",
  "county code",
  "department code",
  "département code",
]);
const PARENT_HEADER_NAMES = new Set([
  "parent",
  "parent name",
  "state",
  "state name",
  "province",
  "province name",
  "region",
  "region name",
  "country",
  "country name",
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
  generatedMap: null,
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
let mapgenSwitchRequestId = 0;
let mapgenRegionRequestId = 0;
let mapgenClientPromise = null;
let mapgenClient = null;
let mapgenDatasets = [];
let mapgenRegions = [];
let selectedMapgenRegions = new Set();
/** Map Generator's description of its settings, the form built from it, and catalogs its choices use. */
let mapgenDescription = FALLBACK_DESCRIPTION;
let mapgenModel = null;
let mapgenThemes = {};
let mapgenBboxPresets = {};
let activeGeneratedFeatures = [];
let generatedFeatureIndex = { records: [], byCode: new Map(), byName: new Map(), byUnit: new Map() };
let activeMapMetadata = null;
let crosswalkRowsById = new Map();
let generationError = "";
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
  mapChoiceSummary: document.querySelector("#map-choice-summary"),
  generatedMapOptions: document.querySelector("#generated-map-options"),
  mapgenDataset: document.querySelector("#mapgen-dataset"),
  mapgenRegionSearch: document.querySelector("#mapgen-region-search"),
  mapgenRegionList: document.querySelector("#mapgen-region-list"),
  mapgenSelectedRegions: document.querySelector("#mapgen-selected-regions"),
  mapgenSelectionCount: document.querySelector("#mapgen-selection-count"),
  mapgenRegionEmpty: document.querySelector("#mapgen-region-empty"),
  mapgenOptions: document.querySelector("#mapgen-options"),
  mapgenCreateButton: document.querySelector("#mapgen-create-button"),
  mapgenStatus: document.querySelector("#mapgen-status"),
  shareAlikeNote: document.querySelector("#share-alike-note"),
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
  countriesHeading: document.querySelector("#countries-heading"),
  regionHelp: document.querySelector("#region-help"),
  regionSearchLabel: document.querySelector("#region-search-label"),
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
  recodeImportButton: document.querySelector("#recode-import-button"),
  cancelImportPreviewButton: document.querySelector("#cancel-import-preview-button"),
  importReport: document.querySelector("#import-report"),
  legendEnabled: document.querySelector("#legend-enabled"),
  legendOptions: document.querySelector("#legend-options"),
  legendPosition: document.querySelector("#legend-position-controls"),
  legendBackground: document.querySelector("#legend-background"),
  legendTextColor: document.querySelector("#legend-text-color"),
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
  let svgText;
  if (state.mapScope === "generated" && state.generatedMap) {
    try {
      const bundle = await fetchGeneratedMap(state.generatedMap);
      activeMap = bundle.map;
      activeMapMetadata = bundle.metadata;
      activeGeneratedFeatures = bundle.features;
      svgText = bundle.svgText;
    } catch (error) {
      console.warn("The saved generated map could not be restored.", error);
      generationError = `Saved generated map unavailable: ${error.message}`;
      activeMap = FALLBACK_MAP;
      activeMapMetadata = null;
      activeGeneratedFeatures = [];
      svgText = await fetchMapSvg(FALLBACK_MAP);
    }
  } else {
    if (state.mapScope === "generated") state.mapScope = "world";
    const scopedMaps = mapsForScope(state.mapScope);
    activeMap =
      scopedMaps.find((map) => map.title === state.mapSelections[state.mapScope]) ||
      scopedMaps.find((map) => map.title === state.mapTitle) ||
      scopedMaps[0] || FALLBACK_MAP;
    state.mapTitle = activeMap.title;
    if (state.mapScope === "world" || state.mapScope === "continent") {
      state.mapSelections[state.mapScope] = activeMap.title;
    }
    try {
      svgText = await fetchMapSvg(activeMap);
    } catch (error) {
      if (activeMap.title === FALLBACK_MAP.title) throw error;
      console.warn(`Could not load ${activeMap.title}; using the bundled map.`, error);
      activeMap = FALLBACK_MAP;
      activeMapMetadata = null;
      activeGeneratedFeatures = [];
      state.mapScope = "world";
      state.mapTitle = FALLBACK_MAP.title;
      state.mapSelections.world = FALLBACK_MAP.title;
      svgText = await fetchMapSvg(FALLBACK_MAP);
    }
  }

  mountSvg(svgText);
  buildCountryIndex();
  decorateMap();
  renderAll();
  persistState();
  loadMapgenCatalog().catch((error) => {
    console.warn("Map Generator options could not be loaded.", error);
    setGeneratedStatus(`Map Generator is unavailable. Commons maps still work. ${error.message}`, true);
  });

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

async function getMapgenClient() {
  if (!mapgenClientPromise) {
    mapgenClientPromise = import("https://map-generator.toolforge.org/api/v1/client.js")
      .then(({ MapgenClient }) => {
        const boundedFetch = async (url, init = {}) => {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 45_000);
          try {
            return await fetch(url, { ...init, signal: controller.signal });
          } catch (error) {
            if (controller.signal.aborted) throw new Error("Map Generator timed out. Try again or keep using Commons maps.");
            throw error;
          } finally {
            window.clearTimeout(timeout);
          }
        };
        mapgenClient = new MapgenClient(undefined, { fetch: boundedFetch });
        return mapgenClient;
      })
      .catch((error) => {
        mapgenClientPromise = null;
        throw new Error(`Map Generator client could not load: ${error.message}`);
      });
  }
  return mapgenClientPromise;
}

function mapgenRegionCodes(regions, fallback = "") {
  const values = Array.isArray(regions) && regions.length
    ? regions
    : String(fallback || "").split(",");
  return [...new Set(values
    .map((region) => typeof region === "string" ? region : region?.code)
    .map((code) => String(code || "").trim())
    .filter(Boolean))];
}

async function fetchGeneratedFeatures(api, dataset, regionCodes, languages) {
  const features = [];
  const batchSize = 8;
  for (let index = 0; index < regionCodes.length; index += batchSize) {
    const batch = regionCodes.slice(index, index + batchSize);
    const payloads = await Promise.all(batch.map((code) => api.features(dataset, code, languages)));
    features.push(...payloads.flatMap((payload) => collectionFrom(payload, "features")));
  }
  return features;
}

async function fetchGeneratedMap(config) {
  const api = await getMapgenClient();
  const spec = { target: "commons", width: 1600, ...(config.spec || {}) };
  const regionCodes = mapgenRegionCodes(config.regions, config.region);
  if (!regionCodes.length) throw new Error("Choose at least one area to create a map.");
  const region = regionCodes.join(",");
  const selectedRegions = Array.isArray(config.regions) ? config.regions : [];
  const languages = Array.isArray(spec.languages) ? spec.languages : [];
  const [svgText, metadataPayload, features] = await Promise.all([
    api.map(config.dataset, region, spec),
    api.metadata(config.dataset, region, spec),
    fetchGeneratedFeatures(api, config.dataset, regionCodes, languages),
  ]);
  const metadata = metadataPayload?.metadata || metadataPayload || {};
  assertSupportedMapgenSvg(svgText);
  if (!features.length) throw new Error("This map has no colorable regions.");
  const regionName = config.regionName ||
    selectedRegions.map((item) => typeof item === "string" ? item : item?.name || item?.code).filter(Boolean).join(", ") ||
    region;
  const datasetName = config.datasetName || config.dataset;
  const canonicalUrl = metadata.url || api.mapUrl(config.dataset, region, spec);
  const map = {
    title: "mapgen:" + config.dataset + ":" + region,
    name: regionName + " · " + datasetName,
    description: [
      metadata.credit,
      metadata.licence && "Licence: " + metadata.licence,
      metadata.boundaryYear && "Boundaries: " + metadata.boundaryYear,
    ].filter(Boolean).join(" · ") || "Generated blank map from Map Generator.",
    url: canonicalUrl,
    thumbnailUrl: "",
    commonsUrl: canonicalUrl,
    categoryMap: false,
    scope: "generated",
    fallback: false,
    isGenerated: true,
    dataset: config.dataset,
    region,
    spec,
    metadata,
    features,
  };
  return { map, svgText, metadata, features };
}


async function loadMapgenCatalog() {
  const api = await getMapgenClient();
  // Settings, themes and presets are optional: without them the form falls
  // back to the settings Maphue always offered.
  const optional = (request) => request.catch((error) => {
    console.warn("Map Generator catalog unavailable:", error);
    return null;
  });
  const [datasetPayload, themePayload, optionsPayload, presetsPayload] = await Promise.all([
    api.datasets(),
    optional(api.themes()),
    optional(typeof api.renderOptions === "function" ? api.renderOptions() : Promise.resolve(null)),
    optional(api.fetch(`${api.base}/bbox-presets`).then((response) => (response.ok ? response.json() : null))),
  ]);
  mapgenDatasets = collectionFrom(datasetPayload, "datasets");
  mapgenThemes = themePayload && typeof themePayload === "object" && !Array.isArray(themePayload) ? themePayload : {};
  mapgenBboxPresets = presetsPayload && typeof presetsPayload === "object" ? presetsPayload : {};
  mapgenDescription = validDescription(optionsPayload) || FALLBACK_DESCRIPTION;
  if (state.generatedMap) {
    state.generatedMap = { ...state.generatedMap, spec: filterSpec(mapgenDescription, state.generatedMap.spec) };
  }
  renderMapgenCatalog();
  if (state.generatedMap && state.mapScope === "generated") {
    elements.mapgenDataset.value = state.generatedMap.dataset;
    const preferredRegions = state.generatedMap.regions?.length
      ? state.generatedMap.regions
      : state.generatedMap.region;
    await loadMapgenRegions(state.generatedMap.dataset, preferredRegions);
    applyGeneratedConfigToForm(state.generatedMap);
  } else if (elements.mapgenDataset.value) {
    await loadMapgenRegions(elements.mapgenDataset.value);
  }
}


function applyGeneratedConfigToForm(config) {
  const dataset = mapgenDatasets.find((item) => item.id === config.dataset);
  renderMapgenOptions(dataset, config.spec || {});
}

function renderMapgenCatalog() {
  const currentDataset = mapgenDatasets.find((dataset) => dataset.id === elements.mapgenDataset.value);
  const savedDataset = mapgenDatasets.find((dataset) => dataset.id === state.generatedMap?.dataset);
  const defaultDataset = mapgenDatasets.find((dataset) => dataset.id === "ne-admin0") ||
    mapgenDatasets.find((dataset) => dataset.world) ||
    mapgenDatasets[0];
  const selectedDataset = currentDataset || savedDataset || defaultDataset;
  elements.mapgenDataset.replaceChildren(...mapgenDatasets.map((dataset) => {
    const option = document.createElement("option");
    option.value = dataset.id;
    option.textContent = (dataset.title || dataset.id) + " · " + (dataset.level || "map");
    return option;
  }));
  elements.mapgenDataset.disabled = mapgenDatasets.length === 0;
  if (selectedDataset) elements.mapgenDataset.value = selectedDataset.id;

  renderMapgenOptionsForDataset(selectedDataset);
}

async function loadMapgenRegions(datasetId, preferredRegions) {
  const requestId = ++mapgenRegionRequestId;
  mapgenRegions = [];
  selectedMapgenRegions = new Set();
  elements.mapgenRegionSearch.disabled = true;
  elements.mapgenRegionSearch.value = "";
  elements.mapgenRegionList.replaceChildren();
  elements.mapgenRegionEmpty.hidden = true;
  elements.mapgenRegionList.setAttribute("aria-busy", "true");
  syncMapgenRegionSelection();
  const api = await getMapgenClient();
  const regions = collectionFrom(await api.regions(datasetId), "regions");
  if (requestId !== mapgenRegionRequestId || elements.mapgenDataset.value !== datasetId) return;
  mapgenRegions = regions;
  const dataset = mapgenDatasets.find((item) => item.id === datasetId);
  const defaults = preferredRegions === undefined
    ? (dataset?.world ? ["world"] : [])
    : mapgenRegionCodes(preferredRegions);
  selectedMapgenRegions = new Set(defaults.filter((code) =>
    mapgenRegions.some((region) => region.code === code),
  ));
  elements.mapgenRegionSearch.disabled = regions.length === 0;
  elements.mapgenRegionList.removeAttribute("aria-busy");
  renderMapgenRegionChoices();
  renderMapgenOptionsForDataset(dataset);
}

function renderMapgenRegionChoices() {
  const query = normalizeMapLookup(elements.mapgenRegionSearch.value);
  const visibleRegions = [...mapgenRegions]
    .sort((a, b) => {
      const aWorld = String(a.code).toLowerCase() === "world";
      const bWorld = String(b.code).toLowerCase() === "world";
      return Number(bWorld) - Number(aWorld) || String(a.name || a.code).localeCompare(String(b.name || b.code));
    })
    .filter((region) => !query || normalizeMapLookup((region.name || "") + " " + (region.code || "")).includes(query));
  elements.mapgenRegionList.replaceChildren(...visibleRegions.map((region) => {
    const label = document.createElement("label");
    label.className = "mapgen-region-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.regionCode = region.code;
    checkbox.checked = selectedMapgenRegions.has(region.code);
    const text = document.createElement("span");
    const name = document.createElement("span");
    name.textContent = region.name || region.code;
    const code = document.createElement("small");
    code.textContent = region.code;
    text.append(name, code);
    label.append(checkbox, text);
    return label;
  }));
  elements.mapgenRegionEmpty.hidden = visibleRegions.length > 0;
  syncMapgenRegionSelection();
}

function syncMapgenRegionSelection() {
  const selected = mapgenRegions.filter((region) => selectedMapgenRegions.has(region.code));
  elements.mapgenSelectionCount.textContent = selected.length + " selected";
  elements.mapgenSelectedRegions.replaceChildren(...selected.map((region) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "mapgen-selected-region-chip";
    chip.dataset.removeMapgenRegion = region.code;
    chip.setAttribute("aria-label", "Remove " + (region.name || region.code));
    const name = document.createElement("span");
    name.textContent = region.name || region.code;
    const remove = document.createElement("span");
    remove.setAttribute("aria-hidden", "true");
    remove.textContent = "×";
    chip.append(name, remove);
    return chip;
  }));
  elements.mapgenRegionList.querySelectorAll("input[data-region-code]").forEach((checkbox) => {
    checkbox.checked = selectedMapgenRegions.has(checkbox.dataset.regionCode);
  });
  const busy = elements.mapgenCreateButton.getAttribute("aria-busy") === "true";
  elements.mapgenCreateButton.disabled = mapgenRegions.length === 0 || selected.length === 0 || busy;
}


/**
 * Builds the settings form for a dataset from Map Generator's description,
 * with `spec`'s values (default: what the form holds now, so switching
 * datasets keeps the settings).
 */
function renderMapgenOptions(dataset, spec = null) {
  const previous = mapgenModel && !spec ? readForm(elements.mapgenOptions) : null;
  mapgenModel = formModel(mapgenDescription, { themes: mapgenThemes, bboxPresets: mapgenBboxPresets });
  const values = valuesFromSpec(mapgenModel, spec || {});
  if (previous) {
    for (const option of mapgenModel.options) {
      if (Object.hasOwn(previous.raw, option.name)) values[option.name] = previous.raw[option.name];
    }
  }
  const theme = String((previous?.raw.theme ?? spec?.theme) || "wikimedia");
  renderForm(elements.mapgenOptions, mapgenModel, values, {
    themeColors: mapgenThemes[theme] || {},
    colors: previous ? previous.colors : spec?.colors || {},
  });
}

function renderMapgenOptionsForDataset(dataset) {
  renderMapgenOptions(dataset);
  const provenance = dataset?.licencePerRegion
    ? "Each map has its own licence."
    : [dataset?.licence, dataset?.boundaryYear && `boundaries ${dataset.boundaryYear}`]
        .filter(Boolean).join(" · ");
  if (activeMap?.isGenerated && activeMap.dataset === dataset?.id) {
    const metadata = activeMapMetadata || {};
    setGeneratedStatus(
      [metadata.boundaryYear && `Boundary year ${metadata.boundaryYear}`,
        metadata.licence && `Licence: ${metadata.licence}`].filter(Boolean).join(" · ") ||
        `${activeGeneratedFeatures.length} map regions ready.`,
    );
  } else {
    setGeneratedStatus(provenance || "");
  }
}

function setGeneratedStatus(message, isError = false) {
  if (!elements.mapgenStatus) return;
  elements.mapgenStatus.textContent = message;
  elements.mapgenStatus.classList.toggle("is-error", isError);
  elements.mapgenStatus.hidden = !message;
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
  if (!nextScope) return;
  invalidateImportPreview();

  if (nextScope === "generated") {
    state.mapScope = "generated";
    renderMapPicker();
    if (state.generatedMap && !activeMap.isGenerated) {
      await switchToGeneratedMap(state.generatedMap, { restore: true });
    }
    if (!mapgenDatasets.length) {
      loadMapgenCatalog().catch((error) => {
        console.warn("Map Generator is unavailable.", error);
        generationError = error.message;
        setGeneratedStatus(`Map Generator is unavailable. Commons maps still work. ${error.message}`, true);
      });
    }
    return;
  }

  if (nextScope === state.mapScope) return;
  const scopedMaps = mapsForScope(nextScope);
  if (!scopedMaps.length) {
    showToast("Those maps could not be loaded from Commons.");
    return;
  }

  const previousScope = state.mapScope;
  const nextMap =
    scopedMaps.find((map) => map.title === state.mapSelections[nextScope]) || scopedMaps[0];
  renderMapPicker();
  await switchToMap(nextMap, { previousScope, scope: nextScope });
}

function mapsForScope(scope) {
  if (scope === "generated") return activeMap?.isGenerated ? [activeMap] : [];
  return mapCatalog.filter((map) => map.scope === scope);
}

async function handleGeneratedMapCreate() {
  const dataset = mapgenDatasets.find((item) => item.id === elements.mapgenDataset.value);
  const selectedRegions = mapgenRegions.filter((item) => selectedMapgenRegions.has(item.code));
  if (!dataset || !selectedRegions.length) {
    setGeneratedStatus("Choose a boundary dataset and at least one area first.", true);
    return;
  }

  const { raw, colors } = readForm(elements.mapgenOptions);
  const { spec, errors } = specFromValues(mapgenModel, raw, colors);
  if (errors.length) {
    setGeneratedStatus(errors.join(" "), true);
    return;
  }

  const config = {
    dataset: dataset.id,
    datasetName: dataset.title || dataset.id,
    region: selectedRegions.map((region) => region.code).join(","),
    regionName: selectedRegions.map((region) => region.name || region.code).join(", "),
    regions: selectedRegions.map((region) => ({ code: region.code, name: region.name || region.code })),
    spec,
  };
  await switchToGeneratedMap(config);
}

async function switchToGeneratedMap(config, { restore = false } = {}) {
  const requestId = ++mapgenSwitchRequestId;
  mapSwitchRequestId += 1;
  elements.mapScopeButtons.forEach((button) => {
    button.disabled = false;
  });
  elements.mapgenCreateButton.disabled = true;
  elements.mapgenCreateButton.setAttribute("aria-busy", "true");
  elements.mapLoading.hidden = false;
  elements.mapLoading.classList.remove("has-error");
  const loadingTitle = document.createElement("strong");
  loadingTitle.textContent = restore ? "Restoring generated map…" : "Creating blank map…";
  const loadingDetail = document.createElement("span");
  loadingDetail.textContent = `${config.regionName || config.region} · ${config.datasetName || config.dataset}`;
  elements.mapLoading.replaceChildren(loadingTitle, loadingDetail);
  elements.mapContainer.classList.remove("is-ready");

  try {
    const bundle = await fetchGeneratedMap(config);
    if (requestId !== mapgenSwitchRequestId) return;
    activeMap = bundle.map;
    activeMapMetadata = bundle.metadata;
    activeGeneratedFeatures = bundle.features;
    generationError = "";
    state.mapScope = "generated";
    const selectedRegions = Array.isArray(config.regions) && config.regions.length
      ? config.regions
      : mapgenRegionCodes(null, config.region).map((code) => ({ code, name: code }));
    state.generatedMap = {
      dataset: config.dataset,
      datasetName: config.datasetName || config.dataset,
      region: config.region || selectedRegions.map((item) => item.code).join(","),
      regionName: config.regionName || selectedRegions.map((item) => item.name || item.code).join(", "),
      regions: selectedRegions.map((item) => ({
        code: String(typeof item === "string" ? item : item.code),
        name: String(typeof item === "string" ? item : item.name || item.code),
      })),
      spec: bundle.map.spec,
      url: bundle.metadata.url || bundle.map.url,
    };
    state.mapTitle = activeMap.title;
    mountSvg(bundle.svgText);
    buildCountryIndex();
    decorateMap();
    renderAll();
    persistState();
    setGeneratedStatus(
      [bundle.metadata.boundaryYear && `Boundary year ${bundle.metadata.boundaryYear}`,
        bundle.metadata.licence && `Licence: ${bundle.metadata.licence}`].filter(Boolean).join(" · ") ||
        `${bundle.features.length} map regions ready.`,
    );
    if (!restore) showToast(`${activeMap.name} created`);
  } catch (error) {
    if (requestId !== mapgenSwitchRequestId) return;
    console.error(error);
    generationError = error.message;
    setGeneratedStatus(`Map could not be created. ${error.message}`, true);
    showToast("Map Generator could not create that map. Your current map is unchanged.");
  } finally {
    if (requestId === mapgenSwitchRequestId) {
      elements.mapLoading.hidden = true;
      elements.mapgenCreateButton.removeAttribute("aria-busy");
      syncMapgenRegionSelection();
      requestAnimationFrame(() => elements.mapContainer.classList.add("is-ready"));
    }
  }
}

async function switchToMap(nextMap, options = {}) {
  const requestId = ++mapSwitchRequestId;
  mapgenSwitchRequestId += 1;
  elements.mapgenCreateButton.removeAttribute("aria-busy");
  syncMapgenRegionSelection();
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
    activeMapMetadata = null;
    activeGeneratedFeatures = [];
    generationError = "";
    state.mapScope = requestedScope;
    state.mapTitle = nextMap.title;
    if (requestedScope === "world" || requestedScope === "continent") {
      state.mapSelections[requestedScope] = nextMap.title;
    }
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
      elements.mapSelect.disabled = state.mapScope === "generated" || mapsForScope(state.mapScope).length < 2;
      requestAnimationFrame(() => elements.mapContainer.classList.add("is-ready"));
    }
  }
}

function restoreState() {
  const storedState = readStoredValue(STORAGE_KEY);
  if (storedState === null) return;
  const saved = parseSavedState(storedState, {
    mapScope: state.mapScope,
    mapTitle: state.mapTitle,
    mapSelections: state.mapSelections,
  });
  if (saved === null) {
    removeStoredValue(STORAGE_KEY);
    return;
  }
  Object.assign(state, saved);
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
    svg [data-assignment-key] {
      cursor: pointer;
      transition: fill 180ms ease, filter 160ms ease;
    }
    svg [data-assignment-key]:hover,
    svg [data-assignment-key].is-highlighted {
      filter: brightness(0.9) saturate(1.12) drop-shadow(0 0 3px rgb(2 6 23 / 55%));
    }
    svg [data-assignment-key].is-located {
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






function buildCountryIndex() {
  const normalizedCountries = sourceCountries.map((country) => {
    const alpha2 = String(country["alpha-2"] || "").toUpperCase();
    return {
      alpha2,
      alpha3: country["alpha-3"],
      name: DISPLAY_NAME_OVERRIDES[alpha2] || country.name,
      sourceName: country.name,
    };
  }).filter((country) => country.alpha2);
  if (!normalizedCountries.some((country) => country.alpha2 === "XK")) {
    normalizedCountries.push({ alpha2: "XK", alpha3: "XKX", name: "Kosovo", sourceName: "Kosovo" });
  }
  normalizedCountries.sort((a, b) => a.name.localeCompare(b.name, "en"));

  allCountryByCode = new Map(normalizedCountries.map((country) => [country.alpha2, country]));
  lookupToCode = new Map();
  for (const country of normalizedCountries) {
    for (const value of [country.alpha2, country.alpha3, country.name, country.sourceName]) {
      lookupToCode.set(normalizeLookup(value), country.alpha2);
    }
  }
  for (const [alias, code] of Object.entries(NAME_ALIASES)) {
    if (allCountryByCode.has(code)) lookupToCode.set(normalizeLookup(alias), code);
  }

  if (activeMap.isGenerated) {
    generatedFeatureIndex = buildGeneratedFeatureIndex(activeGeneratedFeatures, (value) =>
      lookupToCode.get(normalizeLookup(value)) || null,
    );
    countries = generatedFeatureIndex.records.map((feature) => ({
      ...feature,
      alpha2: feature.countryCode || "",
      alpha3: feature.countryCode ? allCountryByCode.get(feature.countryCode)?.alpha3 || "" : "",
      sourceName: feature.name,
    })).sort((a, b) => {
      const parent = a.parentName.localeCompare(b.parentName, "en");
      return parent || a.name.localeCompare(b.name, "en");
    });
  } else {
    generatedFeatureIndex = { records: [], byCode: new Map(), byName: new Map(), byUnit: new Map() };
    countries = normalizedCountries
      .filter((country) => findCountryShapes(country.alpha2).length > 0)
      .map((country) => ({
        ...country,
        code: country.alpha2,
        assignmentKey: `country:${country.alpha2.toLowerCase()}`,
        parentName: "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
  }
  countryByCode = new Map(
    countries.filter((country) => country.alpha2).map((country) => [country.alpha2, country]),
  );
  state.assignments = Object.fromEntries(
    Object.entries(state.assignments).filter(([key, index]) =>
      normalizeAssignmentKey(key) && Number.isInteger(index) && index >= 0 && index < state.palette.length,
    ),
  );
}

function decorateMap() {
  if (activeMap.isGenerated) {
    for (const shape of svgElement.querySelectorAll("path.mg-land[data-code]")) {
      const record = generatedFeatureIndex.byCode.get(normalizeLookup(shape.dataset.code))?.[0];
      if (!record) continue;
      shape.dataset.assignmentKey = record.assignmentKey;
      shape.dataset.regionCode = record.code;
      shape.dataset.regionName = record.name;
      if (record.countryCode) shape.dataset.countryCode = record.countryCode.toLowerCase();
      if (record.parentName) shape.dataset.parentName = record.parentName;
      if (Array.isArray(record.units)) {
        const units = record.units.map((unit) => String(unit).toUpperCase());
        shape.dataset.unit = units.join(" ");
        shape.dataset.regionUnits = units.join(" ");
      }
    }
  } else {
    for (const country of countries) {
      for (const shape of findCountryShapes(country.alpha2)) {
        shape.dataset.countryCode = country.alpha2.toLowerCase();
        shape.dataset.assignmentKey = country.assignmentKey;
        shape.dataset.regionName = country.name;
      }
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
  elements.mapgenDataset.addEventListener("change", () => {
    const datasetId = elements.mapgenDataset.value;
    renderMapgenOptionsForDataset(mapgenDatasets.find((item) => item.id === datasetId));
    loadMapgenRegions(datasetId).catch((error) => {
      if (elements.mapgenDataset.value === datasetId) {
        setGeneratedStatus(`Areas could not be loaded. ${error.message}`, true);
      }
    });
  });
  elements.mapgenRegionSearch.addEventListener("input", renderMapgenRegionChoices);
  elements.mapgenRegionList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[data-region-code]");
    if (!checkbox) return;
    const code = checkbox.dataset.regionCode;
    if (checkbox.checked) {
      if (code.toLowerCase() === "world") {
        selectedMapgenRegions.clear();
      } else {
        selectedMapgenRegions.delete("world");
      }
      selectedMapgenRegions.add(code);
    } else {
      selectedMapgenRegions.delete(code);
    }
    syncMapgenRegionSelection();
  });
  elements.mapgenSelectedRegions.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-mapgen-region]");
    if (!removeButton) return;
    selectedMapgenRegions.delete(removeButton.dataset.removeMapgenRegion);
    syncMapgenRegionSelection();
  });
  elements.mapgenOptions.addEventListener("input", (event) => {
    if (event.target.matches?.("input[data-color-slot]")) event.target.dataset.changed = "true";
    if (mapgenModel) updateVisibility(elements.mapgenOptions, mapgenModel);
  });
  elements.mapgenOptions.addEventListener("change", (event) => {
    if (!mapgenModel) return;
    if (event.target.dataset?.option === "theme") {
      applyThemeColors(elements.mapgenOptions, mapgenModel, mapgenThemes[event.target.value || "wikimedia"] || {});
    }
    updateVisibility(elements.mapgenOptions, mapgenModel);
  });
  elements.mapgenCreateButton.addEventListener("click", handleGeneratedMapCreate);
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
  elements.recodeImportButton.addEventListener("click", recodeImportWithCrosswalk);
  elements.cancelImportPreviewButton.addEventListener("click", cancelImportPreview);
  elements.legendEnabled.addEventListener("change", handleExportOptionsInput);
  elements.legendPosition.addEventListener("change", handleExportOptionsInput);
  elements.legendBackground.addEventListener("input", handleExportOptionsInput);
  elements.legendTextColor.addEventListener("input", handleExportOptionsInput);
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
  const shape = event.target.closest("[data-assignment-key]");
  const key = shape?.dataset.assignmentKey;
  if (!key) return;

  if (event.shiftKey) {
    setAssignmentColor(key, null);
    showToast(`${shape.dataset.regionName || key} cleared`);
    return;
  }

  const current = getAssignmentIndex(key);
  setAssignmentColor(key, getNextColorIndex(current, state.palette.length));
}

function handleMapPointerMove(event) {
  const shape = event.target.closest("[data-assignment-key]");
  if (!shape) {
    hideTooltip();
    return;
  }

  const key = shape.dataset.assignmentKey;
  const assignedIndex = importPreview?.mapPreview
    ? effectiveAssignmentForShape(shape, { ...state.assignments, ...Object.fromEntries(importPreview.assignments) })
    : effectiveAssignmentForShape(shape);
  const legend = Number.isInteger(assignedIndex) ? ` · ${state.palette[assignedIndex].label}` : "";
  const code = shape.dataset.regionCode || shape.dataset.countryCode?.toUpperCase() || "";
  const parent = shape.dataset.parentName ? ` · ${shape.dataset.parentName}` : "";
  elements.mapTooltip.textContent = `${shape.dataset.regionName || code}${parent}${code ? ` · ${code}` : ""}${legend}`;
  elements.mapTooltip.style.left = `${event.clientX}px`;
  elements.mapTooltip.style.top = `${event.clientY}px`;
  elements.mapTooltip.hidden = false;
}

function hideTooltip() {
  elements.mapTooltip.hidden = true;
}

function setAssignmentColor(key, index, options = {}) {
  const normalizedKey = normalizeAssignmentKey(key);
  if (!normalizedKey) return;
  invalidateImportPreview();
  if (index === null) {
    delete state.assignments[normalizedKey];
  } else {
    state.assignments[normalizedKey] = index;
  }
  renderMap();
  renderStatus();
  renderCountryList();
  persistState();
  if (options.locate) locateAssignment(normalizedKey);
}

function getAssignmentIndex(key, assignments = state.assignments) {
  const normalizedKey = normalizeAssignmentKey(key);
  return normalizedKey && Number.isInteger(assignments[normalizedKey])
    ? assignments[normalizedKey]
    : null;
}

function effectiveAssignmentForShape(shape, assignments = state.assignments) {
  const directIndex = getAssignmentIndex(shape.dataset.assignmentKey, assignments);
  if (Number.isInteger(directIndex)) return directIndex;
  for (const unit of String(shape.dataset.regionUnits || "").split(/\s+/).filter(Boolean)) {
    const unitIndex = getAssignmentIndex(`unit:${unit}`, assignments);
    if (Number.isInteger(unitIndex)) return unitIndex;
  }
  const countryCode = shape.dataset.countryCode;
  return countryCode ? getAssignmentIndex(`country:${countryCode}`, assignments) : null;
}

function paintCountry(code) {
  const key = `country:${String(code).toLowerCase()}`;
  if (activeMap.isGenerated) {
    renderMap();
    return;
  }
  const index = getAssignmentIndex(key);
  const color = Number.isInteger(index) ? state.palette[index]?.color : null;
  for (const shape of findCountryShapes(code)) {
    if (color) shape.style.setProperty("fill", color, "important");
    else shape.style.removeProperty("fill");
  }
}

function findCountryShapes(code) {
  if (!svgElement) return [];
  const lowerCode = String(code).toLowerCase();
  if (activeMap.isGenerated) {
    return [...svgElement.querySelectorAll("[data-country-code]")]
      .filter((shape) => shape.dataset.countryCode === lowerCode);
  }
  return [
    ...svgElement.querySelectorAll(
      `[class~="${lowerCode}"], [id="${lowerCode}"], [id="${String(code).toUpperCase()}"]`,
    ),
  ];
}

function findAssignmentShapes(key) {
  const normalized = normalizeAssignmentKey(key);
  if (!svgElement || !normalized) return [];
  const separator = normalized.indexOf(":");
  const kind = normalized.slice(0, separator);
  const code = normalized.slice(separator + 1);
  if (kind === "country") return findCountryShapes(code);
  if (kind === "region") {
    return [...svgElement.querySelectorAll("[data-assignment-key]")]
      .filter((shape) => shape.dataset.regionCode?.toUpperCase() === code);
  }
  return [...svgElement.querySelectorAll("[data-region-units]")]
    .filter((shape) => String(shape.dataset.regionUnits).split(/\s+/).includes(code));
}

function locateAssignment(key) {
  const shapes = findAssignmentShapes(key);
  shapes.forEach((shape) => {
    shape.classList.remove("is-located");
    requestAnimationFrame(() => shape.classList.add("is-located"));
  });
  window.setTimeout(() => shapes.forEach((shape) => shape.classList.remove("is-located")), 950);
}

function handleCountryListClick(event) {
  const button = event.target.closest("[data-assignment-key]");
  if (!button) return;
  const key = button.dataset.assignmentKey;
  const current = getAssignmentIndex(key);
  setAssignmentColor(key, getNextColorIndex(current, state.palette.length), { locate: true });
}

function handleCountryListHover(event) {
  const key = event.target.closest("[data-assignment-key]")?.dataset.assignmentKey;
  if (!key) return;
  clearCountryHighlights();
  findAssignmentShapes(key).forEach((shape) => shape.classList.add("is-highlighted"));
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
  elements.legendTextColor.value = options.legendTextColor;
  const transparency = Math.round((1 - options.legendOpacity) * 100);
  elements.legendOpacity.value = String(transparency);
  elements.legendOpacityValue.textContent = `${transparency}%`;
  elements.exportTitle.value = options.title;
  elements.titlePosition.value = options.titlePosition;
  updateLegendPositionMarkers();
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
  } else if (event.target === elements.legendTextColor) {
    exportOptions.legendTextColor = elements.legendTextColor.value;
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
  addMapAnnotations(svgElement, exportContext());
}


function renderMapPicker() {
  const generated = state.mapScope === "generated";
  const scopedMaps = mapsForScope(state.mapScope);
  elements.mapScopeButtons.forEach((button) => {
    const active = button.dataset.mapScope === state.mapScope;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.generatedMapOptions.hidden = !generated;
  elements.mapSelect.parentElement.hidden = generated;
  elements.mapChoiceSummary.hidden = generated && !activeMap.isGenerated;
  elements.mapScopeNote.textContent = generated
    ? "Choose public boundaries. The canvas switches only after the new map is ready."
    : state.mapScope === "world"
      ? "Choose a verified world map from Wikimedia Commons."
      : "Choose a continent-focused map from Wikimedia Commons.";
  elements.mapSelectLabel.textContent = state.mapScope === "continent" ? "Continent map" : "World base map";
  elements.mapSelect.replaceChildren(...scopedMaps.map((map) => {
    const option = document.createElement("option");
    option.value = map.title;
    option.textContent = map.fallback
      ? `${map.name} · offline`
      : map.region
        ? `${map.region} — ${map.name}`
        : map.name;
    return option;
  }));
  if (scopedMaps.some((map) => map.title === activeMap.title)) elements.mapSelect.value = activeMap.title;
  elements.mapSelect.disabled = generated || scopedMaps.length < 2;

  const visibleMapCount = state.mapScope === "world"
    ? scopedMaps.filter((map) => map.categoryMap).length
    : scopedMaps.length;
  elements.mapCount.textContent = generated
    ? (activeMap.isGenerated ? `${activeGeneratedFeatures.length} areas` : "Create a map")
    : `${visibleMapCount} ${visibleMapCount === 1 ? "map" : "maps"}`;
  elements.mapDescription.textContent = activeMap.description || "Generated blank map from Map Generator.";
  const generatedReady = activeMap.isGenerated;
  const interactiveCount = countries.length;
  elements.mapCompatibility.classList.toggle("is-limited", !interactiveCount);
  elements.mapCompatibility.textContent = generatedReady
    ? `Map Generator SVG contract ${svgElement.getAttribute("data-mapgen-contract")} · ${interactiveCount} colorable regions${activeMapMetadata?.boundaryYear ? ` · boundary year ${activeMapMetadata.boundaryYear}` : ""}.`
    : interactiveCount
      ? `${interactiveCount} ISO country groups are colorable in this SVG.`
      : generationError || "This source SVG has no recognized colorable groups.";
  elements.mapSourceLink.href = activeMap.commonsUrl || activeMap.url;
  elements.mapSourceLink.textContent = generatedReady
    ? "View generated SVG and provenance"
    : !activeMap.fallback
      ? "View file and full description"
      : "View source file";
  elements.mapSourceLink.target = "_blank";
  elements.mapSourceLink.rel = "noopener noreferrer";
  elements.activeMapName.textContent = activeMap.name;
  elements.mapDimensions.textContent = `${Math.round(currentMapDimensions.width)} × ${Math.round(currentMapDimensions.height)} SVG`;

  elements.shareAlikeNote.hidden = !(generatedReady && activeMapMetadata?.shareAlike);
  elements.shareAlikeNote.textContent = elements.shareAlikeNote.hidden
    ? ""
    : "Share-alike data: derived maps may need to use the same licence. The export includes the source credit and licence.";

  const hasThumbnail = Boolean(activeMap.thumbnailUrl);
  elements.mapThumbnail.hidden = !hasThumbnail;
  elements.mapThumbnailPlaceholder.hidden = hasThumbnail;
  elements.mapThumbnailPlaceholder.textContent = generatedReady ? "LIVE SVG" : "SVG";
  elements.mapThumbnail.alt = hasThumbnail ? `Preview of ${activeMap.name}` : "";
  elements.mapThumbnail.src = hasThumbnail ? activeMap.thumbnailUrl : "";
  elements.mapThumbnail.onerror = () => {
    elements.mapThumbnail.hidden = true;
    elements.mapThumbnailPlaceholder.hidden = false;
  };
  if (generationError && generated) setGeneratedStatus(generationError, true);
  updateLegendPositionMarkers();
}

function renderMap() {
  const assignments = importPreview?.mapPreview
    ? { ...state.assignments, ...Object.fromEntries(importPreview.assignments) }
    : state.assignments;
  if (activeMap.isGenerated) {
    renderGeneratedColorStyles(assignments);
    return;
  }
  for (const country of countries) {
    const index = getAssignmentIndex(country.assignmentKey, assignments);
    const color = Number.isInteger(index) ? state.palette[index]?.color : null;
    for (const shape of findCountryShapes(country.alpha2)) {
      if (color) shape.style.setProperty("fill", color, "important");
      else shape.style.removeProperty("fill");
    }
  }
}

function renderGeneratedColorStyles(assignments) {
  if (!svgElement) return;
  let style = svgElement.querySelector("#maphue-colors");
  if (!style) {
    style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.setAttribute("id", "maphue-colors");
    svgElement.append(style);
  }
  style.textContent = generatedColorRules(assignments, state.palette);
}



function renderCountryList() {
  const focusedKey = elements.countryList.contains(document.activeElement)
    ? document.activeElement.dataset.assignmentKey
    : null;
  const query = normalizeLookup(elements.countrySearch.value);
  const matches = countries.filter((country) => {
    if (!query) return true;
    return [country.name, country.sourceName, country.code, country.alpha2, country.alpha3,
      country.parentName, country.parent]
      .some((value) => normalizeLookup(value).includes(query));
  }).slice(0, query ? 100 : 120);
  const groups = new Map();
  for (const area of matches) {
    const heading = activeMap.isGenerated && area.parentName ? area.parentName : "";
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(area);
  }
  const nodes = [];
  for (const [heading, areas] of groups) {
    if (heading) {
      const groupHeading = document.createElement("div");
      groupHeading.className = "region-group-heading";
      groupHeading.textContent = heading;
      nodes.push(groupHeading);
    }
    for (const area of areas) {
      const button = document.createElement("button");
      button.className = "country-option";
      button.type = "button";
      button.dataset.assignmentKey = area.assignmentKey;
      const index = effectiveAssignmentForRecord(area);
      const assigned = Number.isInteger(index);
      const label = assigned ? state.palette[index]?.label || `Category ${index + 1}` : "uncolored";
      button.setAttribute("aria-pressed", String(assigned));
      button.setAttribute("aria-label", `${area.name}${area.parentName ? `, ${area.parentName}` : ""}, ${label}. Activate to ${assigned ? "change" : "assign"} color.`);
      button.innerHTML = `
        <span class="country-swatch" aria-hidden="true"></span>
        <span class="country-option-name"></span>
        <span class="country-option-code"></span>
      `;
      button.querySelector(".country-option-name").textContent = area.name;
      button.querySelector(".country-option-code").textContent = area.code || area.alpha2;
      const swatch = button.querySelector(".country-swatch");
      if (Number.isInteger(index) && state.palette[index]) {
        swatch.style.background = state.palette[index].color;
        swatch.style.borderColor = state.palette[index].color;
      }
      nodes.push(button);
    }
  }
  elements.countryList.replaceChildren(...nodes);
  if (focusedKey) {
    [...elements.countryList.querySelectorAll("[data-assignment-key]")]
      .find((button) => button.dataset.assignmentKey === focusedKey)?.focus({ preventScroll: true });
  }
  elements.countryEmpty.textContent = activeMap.isGenerated ? "No matching regions." : "No matching countries.";
  elements.countryEmpty.hidden = matches.length > 0;
  elements.countryTotal.textContent = `${countries.length} available`;
  const subdivisions = activeMap.isGenerated && countries.some((area) => area.assignmentKey.startsWith("region:"));
  elements.countriesHeading.textContent = subdivisions ? "2. Regions" : "2. Countries";
  elements.regionSearchLabel.textContent = subdivisions ? "Find a region or code" : "Find a country or region";
  elements.regionHelp.textContent = subdivisions
    ? "Search by name, code, or parent area. Click a region to cycle its color."
    : "Search by country name, ISO code, or region. Click an area to cycle its color.";
}

function effectiveAssignmentForRecord(record) {
  const direct = getAssignmentIndex(record.assignmentKey);
  if (Number.isInteger(direct)) return direct;
  for (const unit of Array.isArray(record.units) ? record.units : []) {
    const unitIndex = getAssignmentIndex(`unit:${unit}`);
    if (Number.isInteger(unitIndex)) return unitIndex;
  }
  return record.alpha2 ? getAssignmentIndex(`country:${record.alpha2.toLowerCase()}`) : null;
}

function updateLegendPositionMarkers() {
  const slots = Array.isArray(activeMapMetadata?.legendSlots) ? activeMapMetadata.legendSlots : [];
  const viewBox = currentMapViewBox;
  for (const label of elements.legendPosition.querySelectorAll("label")) {
    const input = label.querySelector("input");
    label.classList.remove("has-land");
    if (!input || input.value === "auto") continue;
    label.title = "";
    label.removeAttribute("aria-label");
    if (!activeMap.isGenerated || !slots.length) continue;

    let slot = slots.find((candidate) =>
      (candidate.position || candidate.name || candidate.anchor) === input.value,
    );
    if (!slot) {
      slot = slots.find((candidate) => {
        const bounds = slotBounds(candidate);
        if (!bounds) return false;
        const horizontal = bounds.x + bounds.width / 2 < viewBox[0] + viewBox[2] / 3
          ? "left"
          : bounds.x + bounds.width / 2 > viewBox[0] + (viewBox[2] * 2) / 3 ? "right" : "center";
        const vertical = bounds.y + bounds.height / 2 < viewBox[1] + viewBox[3] / 3
          ? "top"
          : bounds.y + bounds.height / 2 > viewBox[1] + (viewBox[3] * 2) / 3 ? "bottom" : "center";
        const anchor = vertical === "center" && horizontal === "center"
          ? "center"
          : `${vertical}-${horizontal}`;
        return anchor === input.value;
      });
    }
    const share = slot ? Number(slot.landShare ?? slot.land_share) : NaN;
    if (!Number.isFinite(share)) continue;
    const normalized = share > 1 ? share / 100 : share;
    const percent = Math.round(Math.max(0, Math.min(1, normalized)) * 100);
    label.title = percent
      ? `About ${percent}% of this legend area covers land.`
      : "This legend area avoids land.";
    label.setAttribute("aria-label", `${input.value.replaceAll("-", " ")}, ${percent}% covers land`);
    label.classList.toggle("has-land", percent > 5);
  }
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
  elements.assignedCount.textContent = `${assigned} ${assigned === 1 ? "area" : "areas"}`;
  elements.selectionSummary.textContent = assigned
    ? `${assigned} ${assigned === 1 ? "area is" : "areas are"} colored across ${
        new Set(Object.values(state.assignments)).size
      } ${new Set(Object.values(state.assignments)).size === 1 ? "category" : "categories"}.`
    : "No areas colored yet.";
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
    renderMap();
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
  const hadMapPreview = Boolean(importPreview?.mapPreview);
  importPreview = null;
  if (hadMapPreview) renderMap();
  elements.applyImportButton.disabled = true;
  elements.recodeImportButton.hidden = true;
  elements.cancelImportPreviewButton.hidden = true;
  elements.importReport.hidden = true;
  elements.importReport.replaceChildren();
}

function cancelImportPreview() {
  invalidateImportPreview();
  showToast("CSV preview canceled");
}

async function previewImport() {
  invalidateImportPreview();
  const rows = parseDelimitedText(elements.importText.value);
  if (!rows.length) {
    importPreview = { assignments: new Map(), issues: ["Paste region data or choose a CSV first."], duplicates: 0, unmappedRecords: [], crosswalkIssues: [] };
    renderImportPreview(importPreview);
    return;
  }

  const categoryColumn = getImportCategoryColumn(rows);
  const requestedColumn = elements.importColumn.value === "auto"
    ? detectRegionColumn(rows, categoryColumn)
    : Number(elements.importColumn.value);
  const parentColumn = detectParentColumn(rows, [requestedColumn, categoryColumn]);
  const targetIndex = Number(elements.importColor.value);
  const assignments = new Map();
  const issues = [];
  const unmappedRecords = [];
  const inputValues = [];
  const conflicts = new Set();
  let duplicates = 0;
  const headerRow = looksLikeHeader(rows[0]?.[requestedColumn]) ||
    REGION_CODE_HEADER_NAMES.has(normalizeLookup(rows[0]?.[requestedColumn])) ||
    (categoryColumn !== null && looksLikeCategoryHeader(rows[0]?.[categoryColumn]));
  const firstDataRow = headerRow ? 1 : 0;
  if (categoryColumn !== null && categoryColumn === requestedColumn) {
    issues.push("Choose different columns for region and category.");
  }

  for (let rowIndex = firstDataRow; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const recordNumber = rowIndex + 1;
    const rawValue = row[requestedColumn]?.trim();
    const rawParent = parentColumn < 0 ? "" : row[parentColumn]?.trim();
    const rawCategory = categoryColumn === null ? "" : row[categoryColumn]?.trim();
    if (!rawValue && !rawCategory) continue;
    if (!rawValue) {
      issues.push(`Record ${recordNumber} has a category but no region.`);
      continue;
    }
    inputValues.push(rawValue);

    let categoryIndex = targetIndex;
    if (categoryColumn !== null) {
      if (!rawCategory) {
        issues.push(`Record ${recordNumber}: category is empty for ${rawValue}.`);
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

    const resolved = resolveImportTarget(rawValue, rawParent);
    if (resolved.status === "ambiguous") {
      const parents = [...new Set(resolved.records.map((record) => record.parentName).filter(Boolean))];
      issues.push(`Record ${recordNumber}: “${rawValue}” matches more than one area${parents.length ? ` (${parents.join(", ")})` : ""}. Add a parent column or use a code.`);
      continue;
    }
    if (resolved.status === "missing") {
      if (activeMap.isGenerated) {
        unmappedRecords.push({ rawCode: rawValue, rawParent, categoryIndex, recordNumber });
      } else {
        issues.push(`Record ${recordNumber}: area “${rawValue}” is not on this map.`);
      }
      continue;
    }
    const keys = resolved.status === "unit"
      ? [`unit:${String(resolved.code).toUpperCase()}`]
      : [resolved.assignmentKey];
    for (const key of keys) {
      if (assignments.has(key)) {
        if (assignments.get(key) !== categoryIndex) {
          if (!conflicts.has(key)) {
            issues.push(`${resolved.name || key} is assigned to more than one category.`);
            conflicts.add(key);
          }
        } else {
          duplicates += 1;
        }
        continue;
      }
      assignments.set(key, categoryIndex);
    }
  }

  if (!rows.slice(firstDataRow).some((row) => row[requestedColumn]?.trim())) {
    issues.push("No area rows were found in the selected column.");
  }
  importPreview = {
    assignments,
    issues,
    duplicates,
    unmappedRecords,
    inputValues,
    crosswalkIssues: [],
    matchResult: null,
    matchError: "",
    codePrefix: getMatchCodePrefix(rows[0]?.[requestedColumn] || ""),
    mapPreview: false,
  };
  renderImportPreview(importPreview);
  if (activeMap.isGenerated && unmappedRecords.length) {
    await analyzeCrosswalksLocally(importPreview);
    if (importPreview) renderImportPreview(importPreview);
  }
}

function resolveImportTarget(value, parentValue = "") {
  if (activeMap.isGenerated) {
    let result = resolveGeneratedFeature(value, parentValue, generatedFeatureIndex);
    if (result.status === "missing" && activeMap.dataset === "us-counties" && /^\d{5}$/.test(String(value).trim())) {
      result = resolveGeneratedFeature(`US-${String(value).trim()}`, parentValue, generatedFeatureIndex);
    }
    if (result.status === "matched") {
      return { status: "matched", assignmentKey: result.record.assignmentKey, name: result.record.name };
    }
    if (result.status === "unit") return result;
    if (result.status === "ambiguous") return result;
    const country = resolveCountry(value);
    if (country) return { status: "matched", assignmentKey: `country:${country.toLowerCase()}`, name: allCountryByCode.get(country)?.name || country };
    return { status: "missing" };
  }
  const country = resolveCountry(value);
  if (!country) return { status: "missing" };
  return {
    status: "matched",
    assignmentKey: `country:${country.toLowerCase()}`,
    name: allCountryByCode.get(country)?.name || country,
  };
}

function getMatchCodePrefix(header) {
  const normalized = normalizeLookup(header);
  if (activeMap.dataset === "us-counties" &&
      (normalized === "fips" || normalized === "geoid" || normalized.includes("county code"))) {
    return "US-";
  }
  return "";
}

async function analyzeCrosswalksLocally(preview) {
  try {
    const api = await getMapgenClient();
    const crosswalks = collectionFrom(await api.crosswalks(), "crosswalks")
      .filter((crosswalk) => crosswalkId(crosswalk) && crosswalkAppliesTo(crosswalk, activeMap.dataset));
    const loaded = [];
    for (const crosswalk of crosswalks) {
      const id = crosswalkId(crosswalk);
      let rows = crosswalkRowsById.get(id);
      if (!rows) {
        const response = await api.fetch(`${api.base}/crosswalks/${encodeURIComponent(id)}.csv`);
        if (!response.ok) continue;
        rows = parseDelimitedText(await response.text());
        crosswalkRowsById.set(id, rows);
      }
      loaded.push({ id, title: crosswalk.title || crosswalk.name || id, rows });
    }
    const rawCodes = preview.unmappedRecords.map((record) => record.rawCode);
    const hints = crosswalkHints(rawCodes, preview.codePrefix, loaded);
    if (preview !== importPreview) return;
    preview.matchResult = {
      hints,
      mapWithoutData: countFeaturesWithoutData(generatedFeatureIndex.records, preview.assignments.keys()),
    };
  } catch (error) {
    if (preview !== importPreview) return;
    preview.matchError = error.message;
  }
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
  for (const [key, index] of preview.assignments) {
    if (!categoryGroups.has(index)) categoryGroups.set(index, []);
    categoryGroups.get(index).push(assignmentLabel(key));
  }

  const blockers = preview.issues.length + preview.unmappedRecords.length + preview.crosswalkIssues.length;
  const assignedCount = preview.assignments.size;
  const categoryCount = categoryGroups.size;
  status.textContent = applied
    ? `${assignedCount} ${assignedCount === 1 ? "area" : "areas"} assigned across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}.`
    : blockers
      ? `Preview blocked · ${blockers} ${blockers === 1 ? "issue" : "issues"} to resolve.`
      : `${assignedCount} ${assignedCount === 1 ? "area" : "areas"} ready across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}.`;
  report.append(status);

  if (activeMapMetadata?.boundaryYear) {
    const boundary = document.createElement("p");
    boundary.textContent = `Map boundary year: ${activeMapMetadata.boundaryYear}.`;
    report.append(boundary);
  }
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
      description.textContent = `${state.palette[index].label}: ${names.length} · ${sample}${remainder ? `, and ${remainder} more` : ""}`;
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
  const messages = [
    ...preview.issues,
    ...preview.unmappedRecords.slice(0, 8).map((row) => `Record ${row.recordNumber}: “${row.rawCode}” is not on this map.`),
    ...preview.crosswalkIssues,
  ];
  if (messages.length) {
    const issueList = document.createElement("ul");
    issueList.className = "import-issues";
    for (const issue of messages.slice(0, 8)) {
      const item = document.createElement("li");
      item.textContent = issue;
      issueList.append(item);
    }
    if (messages.length > 8) {
      const item = document.createElement("li");
      item.textContent = `And ${messages.length - 8} more issues.`;
      issueList.append(item);
    }
    report.append(issueList);
  }
  if (preview.recodeSummary) {
    const recode = document.createElement("p");
    recode.textContent = preview.recodeSummary;
    report.append(recode);
  }
  if (preview.matchResult) {
    const missing = Number(preview.matchResult.mapWithoutData) || 0;
    if (missing) {
      const coverage = document.createElement("p");
      coverage.textContent = `${missing} map regions have no matching data row.`;
      report.append(coverage);
    }
    for (const hint of preview.matchResult.hints || []) {
      const hintLine = document.createElement("p");
      hintLine.textContent = hint.message;
      report.append(hintLine);
    }
  } else if (preview.matchError) {
    const matchWarning = document.createElement("p");
    matchWarning.textContent = `Boundary check unavailable: ${preview.matchError}`;
    report.append(matchWarning);
  }

  report.hidden = false;
  const ready = !applied && !blockers && assignedCount > 0;
  elements.applyImportButton.disabled = !ready;
  elements.cancelImportPreviewButton.hidden = !ready;
  const recodeHint = (preview.matchResult?.hints || []).find((hint) => hint.crosswalk && hint.direction === "old-data");
  elements.recodeImportButton.hidden = applied || !recodeHint || !preview.unmappedRecords.length;
  if (recodeHint) elements.recodeImportButton.dataset.crosswalk = recodeHint.crosswalk;
  if (!applied && assignedCount) {
    preview.mapPreview = true;
    renderMap();
  } else if (applied) {
    preview.mapPreview = false;
  }
}

function assignmentLabel(key) {
  const normalized = normalizeAssignmentKey(key) || key;
  const separator = normalized.indexOf(":");
  const kind = normalized.slice(0, separator);
  const code = normalized.slice(separator + 1);
  if (kind === "country") return allCountryByCode.get(code.toUpperCase())?.name || code.toUpperCase();
  const feature = generatedFeatureIndex.records.find((record) => record.assignmentKey === normalized);
  return feature?.name || (kind === "unit" ? `Unit ${code}` : code);
}

async function recodeImportWithCrosswalk() {
  if (!importPreview) return;
  const crosswalkId = elements.recodeImportButton.dataset.crosswalk;
  const rows = crosswalkRowsById.get(crosswalkId);
  if (!crosswalkId || !rows?.length) return;
  elements.recodeImportButton.disabled = true;
  elements.recodeImportButton.setAttribute("aria-busy", "true");
  try {
    const hint = (importPreview.matchResult?.hints || []).find((item) => item.crosswalk === crosswalkId);
    const result = recodeWithCrosswalk({
      crosswalkId,
      rows,
      direction: hint?.direction,
      codePrefix: importPreview.codePrefix,
      records: importPreview.unmappedRecords,
      assignments: importPreview.assignments,
      resolveTarget: (code) => resolveImportTarget(code),
      label: assignmentLabel,
    });
    importPreview.assignments = result.assignments;
    importPreview.unmappedRecords = importPreview.unmappedRecords.filter((record) => result.failedRows.has(record.recordNumber));
    importPreview.crosswalkIssues = result.failures;
    importPreview.matchResult.mapWithoutData = countFeaturesWithoutData(generatedFeatureIndex.records, importPreview.assignments.keys());
    importPreview.recodeSummary = result.failures.length
      ? "Boundary splits or category conflicts need a manual decision."
      : `${result.recoded} map regions recoded from ${crosswalkId}.`;
  } catch (error) {
    importPreview.crosswalkIssues = [`Could not apply the crosswalk: ${error.message}`];
  } finally {
    elements.recodeImportButton.disabled = false;
    elements.recodeImportButton.removeAttribute("aria-busy");
    if (importPreview) renderImportPreview(importPreview);
  }
}

function applyImport() {
  if (!importPreview || importPreview.issues.length || importPreview.unmappedRecords.length ||
      importPreview.crosswalkIssues.length || !importPreview.assignments.size) {
    showToast("Preview a valid CSV before applying it.");
    return;
  }
  for (const [key, categoryIndex] of importPreview.assignments) {
    state.assignments[key] = categoryIndex;
  }
  const appliedPreview = importPreview;
  importPreview = null;
  renderMap();
  renderStatus();
  renderCountryList();
  persistState();
  renderImportPreview(appliedPreview, { applied: true });
  showToast(`${appliedPreview.assignments.size} areas assigned`);
}



function detectRegionColumn(rows, excludedColumn = null) {
  const maxColumns = Math.max(1, ...rows.slice(0, 30).map((row) => row.length));
  const recognizedHeader = rows[0]?.findIndex((header, index) =>
    index !== excludedColumn &&
    (COUNTRY_HEADER_NAMES.has(normalizeLookup(header)) ||
      REGION_CODE_HEADER_NAMES.has(normalizeLookup(header)) ||
      /\b(county|department|département|province|state)\b/i.test(header)),
  ) ?? -1;
  if (recognizedHeader >= 0) return recognizedHeader;

  let best = { index: 0, score: -1 };
  for (let index = 0; index < maxColumns; index += 1) {
    if (index === excludedColumn) continue;
    const score = rows.slice(0, 30).reduce((total, row) => {
      const result = resolveImportTarget(row[index] || "");
      return total + (result.status === "matched" || result.status === "unit" ? 1 : 0);
    }, 0);
    if (score > best.score) best = { index, score };
  }
  return best.index;
}

function detectParentColumn(rows, excludedColumns = []) {
  const excluded = new Set(excludedColumns.filter((value) => Number.isInteger(value)));
  return rows[0]?.findIndex((header, index) =>
    !excluded.has(index) && PARENT_HEADER_NAMES.has(normalizeLookup(header)),
  ) ?? -1;
}

function detectCategoryColumn(rows) {
  const index =
    rows[0]?.findIndex((header) => CATEGORY_HEADER_NAMES.has(normalizeLookup(header))) ?? -1;
  return index < 0 ? null : index;
}

function resolveCountry(value) {
  return lookupToCode.get(normalizeLookup(value)) || null;
}


function looksLikeHeader(value) {
  const normalized = normalizeLookup(value);
  return COUNTRY_HEADER_NAMES.has(normalized) || REGION_CODE_HEADER_NAMES.has(normalized) || PARENT_HEADER_NAMES.has(normalized);
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
  downloadBlob(createExportSvg(), exportFilename("svg"), "image/svg+xml;charset=utf-8");
  showToast("SVG exported");
}

async function exportPng() {
  if (hasPendingMapPreview()) return;
  await runRasterExport(elements.exportPngButton, async () => {
    const canvas = await renderExportCanvas();
    const png = await canvasToBlob(canvas, "image/png");
    downloadBlob(png, exportFilename("png"), "image/png");
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
    downloadBlob(pdfBytes, exportFilename("pdf"), "application/pdf");
    showToast("PDF exported");
  });
}

function hasPendingMapPreview() {
  if (!importPreview?.mapPreview) return false;
  showToast("Apply or cancel the CSV preview before exporting.");
  return true;
}


/** What the export (and the live legend and title) are drawn from. */
function exportContext() {
  return {
    palette: state.palette,
    exportOptions: state.exportOptions,
    viewBox: currentMapViewBox,
    isGenerated: Boolean(activeMap.isGenerated),
    dataset: activeMap.dataset,
    metadata: activeMapMetadata,
  };
}

function createExportSvg() {
  return buildExportSvg(svgElement, exportContext());
}

function exportFilename(extension) {
  if (!activeMap.isGenerated) return `maphue-world-map.${extension}`;
  const slug = `${activeMap.dataset}-${activeMap.region}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `maphue-${slug || "generated-map"}.${extension}`;
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
  const attribution = activeMap.isGenerated ? getExportAttributionLayout(exportContext()) : null;
  const height = currentMapDimensions.height + (attribution?.extraHeight || 0);
  const scale = Math.min(1, maximumDimension / Math.max(currentMapDimensions.width, height));
  return {
    width: Math.max(1, Math.round(currentMapDimensions.width * scale)),
    height: Math.max(1, Math.round(height * scale)),
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








function exportAssignmentsCsv() {
  if (hasPendingMapPreview()) return;
  const rows = [["area", "code", "parent", "category", "color"]];
  const assignments = Object.entries(state.assignments)
    .map(([key, index]) => [normalizeAssignmentKey(key), index])
    .filter(([key, index]) => key && state.palette[index])
    .sort(([a], [b]) => assignmentLabel(a).localeCompare(assignmentLabel(b), "en"));
  for (const [key, index] of assignments) {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator);
    const code = key.slice(separator + 1);
    const palette = state.palette[index];
    const country = kind === "country" ? allCountryByCode.get(code.toUpperCase()) : null;
    const feature = generatedFeatureIndex.records.find((record) =>
      kind === "region"
        ? record.code.toUpperCase() === code
        : kind === "unit" && Array.isArray(record.units) && record.units.some((unit) => String(unit).toUpperCase() === code),
    );
    const area = country?.name || feature?.name || assignmentLabel(key);
    const csvCode = kind === "unit" ? code : country?.alpha2 || feature?.code || code;
    const parent = feature?.parentName || "";
    rows.push([area, csvCode, parent, palette.label, palette.color]);
  }
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  downloadBlob(csv, exportFilename("csv"), "text/csv;charset=utf-8");
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

