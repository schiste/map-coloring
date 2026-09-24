// The map settings form, built from Map Generator's description of its
// render options (`GET /api/v1/render-options`): every setting the API
// accepts, with its widget, default, choices, limits and conditions, so new
// options appear here without a Maphue change. Labels and help are set as
// text, never HTML; unknown widgets and fields are tolerated.

/** Settings Maphue fixes: exports are for Wikimedia Commons. */
export const FIXED_SPEC = { target: "commons" };
/** Maphue's own defaults where they differ from the API's. */
export const MAPHUE_DEFAULTS = { labels: true, width: 1600 };
/** Options Maphue controls itself, left out of the form. */
const HIDDEN_OPTIONS = new Set(["target", "css-vars"]);

/**
 * Used when the API doesn't describe its options (older versions): the
 * settings Maphue offered before, in the same shape.
 */
export const FALLBACK_DESCRIPTION = {
  version: 1,
  groups: [
    { id: "map", label: "Map", order: 10 },
    { id: "labels", label: "Labels and places", order: 20 },
    { id: "frame", label: "Frame and projection", order: 30 },
    { id: "borders", label: "Borders", order: 40 },
  ],
  options: [
    { name: "theme", key: "theme", inRenderSpec: true, type: "string", label: "Map style", description: "Colours of the base map.", widget: "select", default: "wikimedia", choicesSource: "/api/v1/themes", group: "map", order: 70, advanced: false },
    { name: "labels", key: "labels", inRenderSpec: true, type: "boolean", label: "Region names", description: "Label the mapped regions.", widget: "checkbox", default: false, group: "labels", order: 10, advanced: false },
    { name: "languages", key: "languages", inRenderSpec: true, type: "list", label: "Label languages", description: "Also label in these languages (BCP 47 tags).", widget: "tokens", group: "labels", order: 40, advanced: false },
    { name: "bbox", key: "bbox", inRenderSpec: true, type: "string", label: "Box", description: "west,south,east,north in degrees, or a preset name.", widget: "bbox", choicesSource: "/api/v1/bbox-presets", group: "frame", order: 20, advanced: false },
    { name: "worldview", key: "worldview", inRenderSpec: false, type: "string", label: "Point of view", description: "A Natural Earth point of view on disputed borders.", widget: "select", choicesSource: "/api/v1/datasets", group: "borders", order: 10, advanced: false },
  ],
  colorSlots: [],
  themesSource: "/api/v1/themes",
  excluded: [],
};

/** A description that looks usable, else null. */
export function validDescription(payload) {
  return payload && Array.isArray(payload.options) && payload.options.every((o) => o && typeof o.name === "string" && typeof o.key === "string")
    ? payload
    : null;
}

/**
 * The form's options, grouped and ordered, with their choices resolved:
 * themes from the theme catalog, box presets from the preset catalog.
 * Points of view are the host's (hidden when it lists none).
 */
export function formModel(description, { themes = null, bboxPresets = null } = {}) {
  const groups = [...(description.groups || [])].sort((a, b) => a.order - b.order);
  const colorSlots = description.colorSlots || [];
  const options = description.options
    .filter((o) => !HIDDEN_OPTIONS.has(o.name))
    .map((o) => ({ ...o, choices: resolveChoices(o, { themes }), presets: o.widget === "bbox" && bboxPresets ? Object.keys(bboxPresets) : [] }))
    .filter((o) => !(o.name === "worldview" && !o.choices.length));
  const byGroup = groups
    .map((group) => {
      const groupOptions = options.filter((o) => o.group === group.id).sort((a, b) => a.order - b.order);
      return { ...group, options: groupOptions, advancedCount: groupOptions.filter((o) => o.advanced).length };
    })
    .filter((group) => group.options.length || (group.id === "colors" && colorSlots.length));
  if (colorSlots.length && !byGroup.some((group) => group.id === "colors")) {
    byGroup.push({ id: "colors", label: "Colours", order: Infinity, options: [], advancedCount: 0 });
  }
  // Options in groups the description doesn't list still show, last.
  const listed = new Set(groups.map((g) => g.id));
  const rest = options.filter((o) => !listed.has(o.group));
  if (rest.length) byGroup.push({ id: "other", label: "Other", order: Infinity, options: rest, advancedCount: rest.filter((o) => o.advanced).length });
  return { groups: byGroup, options, colorSlots };
}

function resolveChoices(option, { themes }) {
  if (option.name === "theme" && themes && typeof themes === "object" && !Array.isArray(themes)) {
    const labels = new Map((option.choices || []).map((c) => [c.value, c.label]));
    return Object.keys(themes).map((name) => ({ value: name, label: labels.get(name) || name }));
  }
  return Array.isArray(option.choices) ? option.choices : [];
}

/** The value an option starts at in Maphue. */
export function initialValue(option) {
  if (Object.hasOwn(MAPHUE_DEFAULTS, option.key)) return MAPHUE_DEFAULTS[option.key];
  return option.default;
}

/** Whether an option applies, given the current values (by option name). */
export function isVisible(option, valuesByName) {
  return option.visibleWhen ? evaluate(option.visibleWhen, valuesByName) : true;
}

function evaluate(condition, values) {
  if (Array.isArray(condition.anyOf)) return condition.anyOf.some((c) => evaluate(c, values));
  const value = values[condition.option];
  if (Object.hasOwn(condition, "equals")) return value === condition.equals;
  if (Array.isArray(condition.in)) return condition.in.includes(value);
  if (condition.notEmpty) return value !== undefined && value !== null && String(value).trim() !== "";
  return true;
}

/**
 * A raw form value (string, or boolean for checkboxes) as the option's
 * type, checked against its choices and limits: { value } or { error }.
 * An empty value is { value: undefined }: the option isn't sent.
 */
export function parseValue(option, raw) {
  if (option.type === "boolean") return { value: Boolean(raw) };
  const text = String(raw ?? "").trim();
  if (!text) return { value: undefined };
  if (option.maxLength && text.length > option.maxLength) {
    return { error: `${option.label}: at most ${option.maxLength} characters.` };
  }
  if (option.type === "integer" || option.type === "number") {
    const n = Number(text);
    if (!Number.isFinite(n) || (option.type === "integer" && !Number.isInteger(n))) {
      return { error: `${option.label}: enter a ${option.type === "integer" ? "whole number" : "number"}.` };
    }
    const range = limitsError(option, n);
    return range ? { error: range } : { value: n };
  }
  if (option.type === "list") {
    const items = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    return { value: items.length ? items : undefined };
  }
  if (option.type === "pair") {
    const parts = text.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return { error: `${option.label}: enter two numbers.` };
    const range = parts.map((n) => limitsError(option, n)).find(Boolean);
    return range ? { error: range } : { value: parts };
  }
  if (option.choices?.length && !option.choices.some((c) => c.value === text)) {
    return { error: `${option.label}: choose one of the listed values.` };
  }
  if (option.widget === "bbox") return parseBbox(option, text);
  return { value: text };
}

function limitsError(option, n) {
  if (option.minimum !== undefined && n < option.minimum) return `${option.label}: at least ${option.minimum}.`;
  if (option.exclusiveMinimum !== undefined && n <= option.exclusiveMinimum) return `${option.label}: more than ${option.exclusiveMinimum}.`;
  if (option.maximum !== undefined && n > option.maximum) return `${option.label}: at most ${option.maximum}.`;
  return null;
}

function parseBbox(option, text) {
  if ((option.presets || []).includes(text)) return { value: text };
  const parts = text.split(/[\s,;]+/).filter(Boolean).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    return { error: `${option.label}: a preset name, or four numbers: west, south, east, north.` };
  }
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || south >= north) {
    return { error: `${option.label}: longitudes −180 to 180 and latitudes −90 to 90, south below north.` };
  }
  return { value: parts.join(",") };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The render spec for the form's values ({ [option.name]: raw }) and colour
 * choices ({ [slot key]: "#rrggbb" }): options that apply and differ from
 * the API's default, Maphue's fixed settings, and the colours set. Returns
 * { spec, errors }.
 */
export function specFromValues(model, raw, colors = {}) {
  const parsed = {};
  const errors = [];
  for (const option of model.options) {
    const result = parseValue(option, raw[option.name]);
    if (result.error) errors.push(result.error);
    else parsed[option.name] = result.value;
  }
  const spec = { ...FIXED_SPEC };
  for (const option of model.options) {
    const value = parsed[option.name];
    if (value === undefined || !isVisible(option, parsed)) continue;
    if (option.default !== undefined && same(value, option.default)) continue;
    spec[option.key] = value;
  }
  const colorEntries = Object.entries(colors).filter(([, c]) => /^#[0-9a-f]{6}$/i.test(c));
  if (colorEntries.length) spec.colors = Object.fromEntries(colorEntries);
  return { spec, errors };
}

/** Form values for a saved spec (missing settings take Maphue's initial values). */
export function valuesFromSpec(model, spec = {}) {
  const values = {};
  for (const option of model.options) {
    const v = Object.hasOwn(spec, option.key) ? spec[option.key] : initialValue(option);
    values[option.name] = option.type === "boolean"
      ? Boolean(v)
      : Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : String(v);
  }
  return values;
}

/**
 * Keeps the settings of a saved spec that the description knows and that
 * are valid for it (as the form would read them), and its colours.
 */
export function filterSpec(description, spec = {}) {
  const slots = new Set((description.colorSlots || []).map((s) => s.key));
  const out = {};
  for (const option of description.options) {
    if (!Object.hasOwn(spec, option.key)) continue;
    const value = spec[option.key];
    const raw = option.type === "boolean" ? value === true : Array.isArray(value) ? value.join(", ") : value;
    // Points of view and box presets are checked by the API (their lists
    // depend on the dataset and aren't loaded yet).
    const presets = option.widget === "bbox" && /^[a-z][a-z-]{0,40}$/.test(String(value)) ? [String(value)] : [];
    const result = parseValue({ ...option, choices: option.name === "worldview" ? [] : option.choices, presets }, raw);
    if (!result.error && result.value !== undefined) out[option.key] = option.widget === "bbox" ? String(value) : result.value;
  }
  if (spec.colors && typeof spec.colors === "object") {
    const colors = Object.fromEntries(Object.entries(spec.colors).filter(([k, c]) => slots.has(k) && /^#[0-9a-f]{6}$/i.test(c)));
    if (Object.keys(colors).length) out.colors = colors;
  }
  return { ...out, ...FIXED_SPEC };
}

// ---------------------------------------------------------------- DOM

/**
 * Builds the form into `container`: one expandable section per Map Generator
 * group. All settings stay together, including advanced options and colours.
 * Controls carry `data-option` (option name) or `data-color-slot` (slot key).
 */
export function renderForm(container, model, values, { themeColors = {}, colors = {}, idPrefix = "mapgen-option" } = {}) {
  const doc = container.ownerDocument;
  const el = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "text") node.textContent = v;
      else if (k === "className") node.className = v;
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  };
  const control = (option) => {
    const id = `${idPrefix}-${option.name}`;
    const value = values[option.name];
    const help = el("small", { className: "field-help", id: `${id}-help`, text: option.description || "" });
    if (option.widget === "checkbox" || option.type === "boolean") {
      const input = el("input", { type: "checkbox", id, "data-option": option.name, "aria-describedby": help.id });
      input.checked = Boolean(value);
      return el("label", { className: "check-field mapgen-option", for: id, "data-option-field": option.name }, input,
        el("span", { className: "mapgen-check-copy" }, el("span", { text: option.label }), help));
    }
    let control;
    let list = null;
    let labelFor = id;
    if (option.widget === "tokens") {
      const values = splitTokens(value);
      const chips = el("div", { className: "mapgen-token-list", "data-token-list": option.name, role: "list", "aria-label": `${option.label} selected` });
      for (const token of values) {
        const chip = el("span", { className: "mapgen-token-chip", role: "listitem" }, el("span", { text: token }));
        chip.append(el("button", { type: "button", "data-remove-mapgen-token": option.name, "data-token-value": token, "aria-label": `Remove ${token}` }, el("span", { "aria-hidden": "true", text: "×" })));
        chips.append(chip);
      }
      const entry = el("input", { type: "text", id, "data-token-entry": option.name, "aria-describedby": help.id, autocomplete: "off", placeholder: "Type a value and press Enter" });
      if (option.suggestions?.length) {
        list = el("datalist", { id: `${id}-list` });
        for (const hint of option.suggestions) list.append(el("option", { value: String(hint.value), label: hint.label || String(hint.value) }));
        entry.setAttribute("list", list.id);
      }
      const stored = el("input", { type: "hidden", "data-option": option.name });
      stored.value = values.join(", ");
      control = el("div", { className: "mapgen-token-control", "data-token-control": option.name }, chips, entry, stored);
    } else if (option.widget === "bbox" && option.presets.length) {
      const isPreset = option.presets.includes(String(value ?? ""));
      const chosen = isPreset ? String(value) : "__custom__";
      const choice = (optionValue, text) => {
        // The `selected` attribute rather than select.value: the same in
        // browsers and in the tests' DOM.
        const item = el("option", { value: optionValue, text });
        if (optionValue === chosen) item.setAttribute("selected", "");
        return item;
      };
      const select = el("select", { id, "data-bbox-preset": option.name, "aria-describedby": help.id },
        choice("__custom__", "Custom coordinates"));
      for (const preset of option.presets) {
        select.append(choice(preset, preset.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())));
      }
      const custom = el("input", { type: "text", id: `${id}-coordinates`, "data-bbox-custom": option.name, "aria-describedby": help.id, autocomplete: "off", spellcheck: "false", placeholder: "west, south, east, north" });
      custom.value = isPreset ? "" : String(value ?? "");
      custom.hidden = isPreset;
      control = el("div", { className: "mapgen-bbox-control" }, select, custom);
    } else if (option.widget === "pair") {
      const pairValues = String(value ?? "").split(/[\s,;]+/).filter(Boolean);
      const pair = el("div", { className: "mapgen-pair-control", "data-pair-option": option.name });
      for (let index = 0; index < 2; index += 1) {
        const input = el("input", {
          type: "number",
          id: index === 0 ? id : `${id}-second`,
          "data-pair-value": String(index),
          "aria-describedby": help.id,
          "aria-label": `${option.label}: ${index === 0 ? "first" : "second"} value`,
          placeholder: index === 0 ? "First value" : "Second value",
          step: option.step === undefined ? "any" : String(option.step),
        });
        if (option.minimum !== undefined) input.setAttribute("min", String(option.minimum));
        if (option.maximum !== undefined) input.setAttribute("max", String(option.maximum));
        input.value = pairValues[index] || "";
        pair.append(input);
      }
      control = pair;
    } else if (option.choices.length) {
      control = el("select", { id, "data-option": option.name, "aria-describedby": help.id });
      const selected = value === "" && option.default !== undefined ? String(option.default) : String(value ?? "");
      if (option.default === undefined) control.append(el("option", { value: "", text: "Default" }));
      for (const choice of option.choices) {
        const item = el("option", { value: String(choice.value), text: choice.label || String(choice.value) });
        if (String(choice.value) === selected) item.setAttribute("selected", "");
        control.append(item);
      }
    } else if (option.widget === "textarea") {
      control = el("textarea", { id, rows: "2", "data-option": option.name, "aria-describedby": help.id });
      control.value = String(value ?? "");
    } else {
      const numeric = option.type === "integer" || option.type === "number";
      control = el("input", {
        id,
        type: numeric ? "number" : "text",
        "data-option": option.name,
        "aria-describedby": help.id,
        autocomplete: "off",
        spellcheck: "false",
      });
      if (numeric) {
        for (const [attr, key] of [["min", "minimum"], ["max", "maximum"], ["step", "step"]]) {
          if (option[key] !== undefined) control.setAttribute(attr, String(option[key]));
        }
        if (option.step === undefined) control.setAttribute("step", "any");
      }
      if (option.maxLength) control.setAttribute("maxlength", String(option.maxLength));
      const hints = option.widget === "bbox" ? option.presets.map((p) => ({ value: p, label: p })) : option.suggestions || [];
      if (hints.length) {
        list = el("datalist", { id: `${id}-list` });
        for (const h of hints) list.append(el("option", { value: String(h.value), label: h.label || String(h.value) }));
        control.setAttribute("list", list.id);
      }
      if (option.widget === "bbox") control.setAttribute("placeholder", "west, south, east, north");
      else if (option.default !== undefined && numeric) control.setAttribute("placeholder", String(option.default));
      control.value = String(value ?? "");
    }
    const field = el("div", { className: "field mapgen-option", "data-option-field": option.name }, el("label", { for: labelFor, text: option.label }), control);
    if (list) field.append(list);
    field.append(help);
    return field;
  };
  const parts = [];
  for (const group of model.groups) {
    const groupId = `${idPrefix}-group-${group.id}`;
    const count = group.id === "colors" ? model.colorSlots.length + group.options.length : group.options.length;
    const advancedCount = group.advancedCount || 0;
    const meta = group.id === "colors"
      ? `${count} colour controls`
      : `${count} settings${advancedCount ? ` · ${advancedCount} advanced` : ""}`;
    const legend = el("legend", { className: "mapgen-group-legend", id: `${groupId}-legend` },
      el("span", { className: "mapgen-group-name", text: group.label }),
      el("span", { className: "mapgen-group-meta", text: meta }));
    const fields = el("div", { className: "mapgen-group-fields", "aria-labelledby": `${groupId}-legend` });
    if (group.id === "colors" && model.colorSlots.length) {
      const grid = el("div", { className: "mapgen-color-grid" });
      for (const slot of model.colorSlots) {
        const id = `${idPrefix}-color-${slot.slot}`;
        const input = el("input", { type: "color", id, "data-color-slot": slot.key, title: slot.description || slot.label });
        input.value = colors[slot.key] || themeColors[slot.slot] || slot.default;
        if (colors[slot.key]) input.dataset.changed = "true";
        grid.append(el("label", { className: "mapgen-color", for: id }, input, el("span", { text: slot.label })));
      }
      fields.append(grid);
      fields.append(...group.options.map(control));
    } else {
      fields.append(...group.options.map(control));
    }
    const section = el("fieldset", { className: "mapgen-option-group", "data-option-group": group.id }, legend, fields);
    parts.push(section);
  }
  container.replaceChildren(...parts);
  updateVisibility(container, model);
}

/** The form's raw values ({ name: string | boolean }) and changed colours. */
export function readForm(container) {
  const raw = {};
  for (const input of container.querySelectorAll("[data-option]")) {
    raw[input.dataset.option] = input.type === "checkbox" ? input.checked : input.value;
  }
  for (const select of container.querySelectorAll("[data-bbox-preset]")) {
    const custom = [...container.querySelectorAll("[data-bbox-custom]")].find((input) => input.dataset.bboxCustom === select.dataset.bboxPreset);
    raw[select.dataset.bboxPreset] = select.value === "__custom__" ? custom?.value || "" : select.value;
  }
  for (const pair of container.querySelectorAll("[data-pair-option]")) {
    const values = [...pair.querySelectorAll("[data-pair-value]")].map((input) => input.value.trim());
    raw[pair.dataset.pairOption] = values.every((value) => !value) ? "" : values.join(",");
  }
  const colors = {};
  for (const input of container.querySelectorAll("input[data-color-slot]")) {
    if (input.dataset.changed === "true") colors[input.dataset.colorSlot] = input.value;
  }
  return { raw, colors };
}

function splitTokens(value) {
  return [...new Set(String(value ?? "").split(/[,;\n]/).map((token) => token.trim()).filter(Boolean))];
}

/** Shows only the options that apply to the current values. */
export function updateVisibility(container, model) {
  const { raw } = readForm(container);
  const parsed = {};
  for (const option of model.options) {
    const result = parseValue(option, raw[option.name]);
    parsed[option.name] = result.error ? raw[option.name] : result.value;
  }
  for (const option of model.options) {
    const field = container.querySelector(`[data-option-field="${option.name}"]`);
    if (field) field.hidden = !isVisible(option, parsed);
  }
}

/** Resets the colour inputs a user didn't change to a theme's colours. */
export function applyThemeColors(container, model, themeColors = {}) {
  for (const input of container.querySelectorAll("input[data-color-slot]")) {
    if (input.dataset.changed === "true") continue;
    const slot = model.colorSlots.find((s) => s.key === input.dataset.colorSlot);
    if (slot) input.value = themeColors[slot.slot] || slot.default;
  }
}
