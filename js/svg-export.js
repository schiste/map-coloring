// Map SVGs in and out: sanitising what is loaded, and building the exported
// file (legend, title, data credit). Everything the export needs comes in a
// context object, so it runs the same in the page and in tests.
import { calculateAnchoredPosition, readableTextColor } from "./export-layout.js";
import { MAPGEN_API_ROOT, selectAutoLegendSlot, slotBounds } from "./map-generator.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export const CSS_REFERENCE_ATTRIBUTES = new Set([
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

/** Removes scripts, event handlers and external references from a map SVG. */
export function sanitizeSvg(svg) {
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

export function sanitizeCssReferences(cssText) {
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

export function getSvgViewBox(svg) {
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

/**
 * The export context:
 * - palette: [{ color, label }]
 * - exportOptions: legend and title settings
 * - viewBox: [minX, minY, width, height] of the map
 * - isGenerated, dataset, metadata: a Map Generator map and its metadata
 */

/** The exported SVG text of a mounted (sanitised, coloured) map. */
export function buildExportSvg(svgElement, ctx, serialize = (node) => new XMLSerializer().serializeToString(node)) {
  const [, , width, height] = ctx.viewBox;
  const clone = svgElement.cloneNode(true);
  clone.removeAttribute("aria-hidden");
  clone.removeAttribute("focusable");
  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));
  clone.querySelectorAll("[data-assignment-key]").forEach((shape) => {
    ["data-assignment-key", "data-country-code", "data-region-code", "data-region-name", "data-parent-name", "data-region-units"]
      .forEach((attribute) => shape.removeAttribute(attribute));
    shape.classList.remove("is-highlighted", "is-located");
  });
  clone.querySelectorAll(".is-highlighted, .is-located").forEach((shape) =>
    shape.classList.remove("is-highlighted", "is-located"),
  );

  removeMapAnnotations(clone);
  addMapAnnotations(clone, ctx);
  if (ctx.isGenerated) addExportAttribution(clone, ctx);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(clone)}`;
}

/**
 * Where the legend and title go. The legend is placed first, as it matters
 * more; the title then takes an empty area the legend left, or its usual
 * place at the top or bottom.
 */
export function planAnnotations(ctx) {
  const legend = ctx.exportOptions.legendEnabled ? legendPlacement(ctx) : null;
  const titleSlot = getAutoTitleSlot(ctx, legend?.slot ? [legend.slot] : []);
  return { legend, titleSlot };
}

/** Legend and title, as in the export (also drawn on the live map). */
export function addMapAnnotations(svg, ctx) {
  const { legend, titleSlot } = planAnnotations(ctx);
  if (legend) addLegendToSvg(svg, ctx, legend);
  if (ctx.exportOptions.title.trim()) addTitleToSvg(svg, ctx, titleSlot);
}

export function removeMapAnnotations(svg) {
  svg
    .querySelectorAll("#maphue-legend, #maphue-title")
    .forEach((annotation) => annotation.remove());
}

const LEGEND_TITLE = "Legend";
/** Smallest scale an automatically placed legend may take (20 px text → 7 px). */
const MIN_AUTO_SCALE = 0.35;

function itemLabel(item, index) {
  return item.label || `Category ${index + 1}`;
}

/**
 * The legend's layout before scaling: a column (title, then one row per
 * category) or a single row (title, then the categories side by side), for
 * wide, short spaces such as the strips above and below a world map.
 */
export function legendLayout(palette, kind = "column") {
  if (kind === "row") {
    let x = 28 + LEGEND_TITLE.length * 25 * 0.62 + 28;
    const items = palette.map((item, index) => {
      const at = { x, swatchY: 18, textY: 40 };
      x += 28 + 12 + itemLabel(item, index).length * 20 * 0.56 + 28;
      return at;
    });
    return { kind, width: Math.ceil(x), height: 64, titleY: 42, items };
  }
  const width = Math.max(
    570,
    Math.ceil(72 + Math.max(0, ...palette.map((item, index) => itemLabel(item, index).length * 20 * 0.56)) + 28),
  );
  return {
    kind,
    width,
    height: 92 + palette.length * 54,
    titleY: 42,
    items: palette.map((_, index) => ({ x: 28, swatchY: 76 + index * 54, textY: 98 + index * 54 })),
  };
}

/** Size of the column legend before scaling. */
export function legendSize(palette) {
  const { width, height } = legendLayout(palette, "column");
  return { width, height };
}

/**
 * Where the legend goes, how it is laid out and scaled. "auto" on a
 * generated map uses the empty areas Map Generator reports: the layout and
 * area that allow the largest legend, aligned to the area's side. Only when
 * none allows a readable legend does it fall back to a corner.
 */
export function legendPlacement(ctx) {
  const column = legendLayout(ctx.palette, "column");
  const [, , width, height] = ctx.viewBox;
  const scale = Math.min(
    1,
    Math.max(
      0.5,
      Math.min((width * 0.32) / column.width, (height * 0.3) / column.height),
    ),
  );
  if (ctx.isGenerated && ctx.exportOptions.legendPosition === "auto") {
    const best = bestLegendSlot(ctx, scale);
    if (best) return best;
  }
  const titleMetrics = getExportTitleMetrics(ctx);
  const position = calculateAnchoredPosition(
    ctx.exportOptions.legendPosition === "auto" ? "bottom-left" : ctx.exportOptions.legendPosition,
    ctx.viewBox,
    column.width * scale,
    column.height * scale,
    {
      topInset:
        titleMetrics && ctx.exportOptions.titlePosition === "top"
          ? titleMetrics.fontSize * 1.45
          : 0,
      bottomInset:
        titleMetrics && ctx.exportOptions.titlePosition === "bottom"
          ? titleMetrics.fontSize * 1.45
          : 0,
    },
  );
  return { ...position, scale, width: column.width * scale, height: column.height * scale, slot: null, layout: column };
}

function bestLegendSlot(ctx, maxScale) {
  const slots = (Array.isArray(ctx.metadata?.legendSlots) ? ctx.metadata.legendSlots : [])
    .map((slot) => ({ slot, bounds: slotBounds(slot) }))
    .filter(({ bounds }) => bounds);
  let best = null;
  for (const layout of [legendLayout(ctx.palette, "column"), legendLayout(ctx.palette, "row")]) {
    for (const { slot, bounds } of slots) {
      const scale = Math.min(maxScale, bounds.width / layout.width, bounds.height / layout.height);
      const landShare = Number(slot.landShare ?? 0);
      if (scale < MIN_AUTO_SCALE) continue;
      if (!best || scale > best.scale + 1e-9 || (Math.abs(scale - best.scale) <= 1e-9 && landShare < best.landShare)) {
        best = { layout, slot, bounds, scale, landShare };
      }
    }
  }
  if (!best) return null;
  const { layout, bounds, scale } = best;
  const [w, h] = [layout.width * scale, layout.height * scale];
  // Slots are in the map's own coordinates, which a title band above the
  // map (viewBox from y = -40) doesn't shift.
  const position = String(best.slot.position || "");
  const x = position.endsWith("right")
    ? bounds.x + bounds.width - w
    : position.endsWith("center") || position === "center" ? bounds.x + (bounds.width - w) / 2 : bounds.x;
  const y = position.startsWith("bottom")
    ? bounds.y + bounds.height - h
    : position.startsWith("middle") || position === "center" ? bounds.y + (bounds.height - h) / 2 : bounds.y;
  return { x, y, scale, width: w, height: h, slot: bounds, layout };
}

function addLegendToSvg(svg, ctx, placement) {
  const doc = svg.ownerDocument;
  const { layout } = placement;
  const textColor = ctx.exportOptions.legendTextColor;
  const borderColor = readableTextColor(ctx.exportOptions.legendBackground);
  const legend = doc.createElementNS(SVG_NS, "g");
  legend.setAttribute("id", "maphue-legend");
  legend.setAttribute("transform", `translate(${placement.x} ${placement.y}) scale(${placement.scale})`);
  legend.setAttribute("pointer-events", "none");

  const backdrop = doc.createElementNS(SVG_NS, "rect");
  backdrop.setAttribute("width", String(layout.width));
  backdrop.setAttribute("height", String(layout.height));
  backdrop.setAttribute("rx", "12");
  backdrop.setAttribute("fill", ctx.exportOptions.legendBackground);
  backdrop.setAttribute("fill-opacity", String(ctx.exportOptions.legendOpacity));
  backdrop.setAttribute("stroke", borderColor);
  backdrop.setAttribute("stroke-opacity", String(ctx.exportOptions.legendOpacity));
  backdrop.setAttribute("stroke-width", "2");
  legend.append(backdrop);

  const legendTitle = doc.createElementNS(SVG_NS, "text");
  legendTitle.setAttribute("x", "28");
  legendTitle.setAttribute("y", String(layout.titleY));
  legendTitle.setAttribute("font-family", ctx.isGenerated ? "sans-serif" : "Georgia, serif");
  legendTitle.setAttribute("font-size", "25");
  legendTitle.setAttribute("font-weight", "700");
  legendTitle.setAttribute("fill", textColor);
  legendTitle.textContent = LEGEND_TITLE;
  legend.append(legendTitle);

  ctx.palette.forEach((item, index) => {
    const at = layout.items[index];
    const swatch = doc.createElementNS(SVG_NS, "rect");
    swatch.setAttribute("x", String(at.x));
    swatch.setAttribute("y", String(at.swatchY));
    swatch.setAttribute("width", "28");
    swatch.setAttribute("height", "28");
    swatch.setAttribute("rx", "4");
    swatch.setAttribute("fill", item.color);
    legend.append(swatch);

    const text = doc.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(at.x + 44));
    text.setAttribute("y", String(at.textY));
    text.setAttribute("font-family", "sans-serif");
    text.setAttribute("font-size", "20");
    text.setAttribute("fill", textColor);
    text.textContent = itemLabel(item, index);
    legend.append(text);
  });
  svg.append(legend);
}

export function getExportTitleMetrics(ctx) {
  const text = ctx.exportOptions.title.trim();
  if (!text) return null;

  const [, , width, height] = ctx.viewBox;
  const preferredSize = Math.min(68, Math.max(28, width * 0.032, height * 0.04));
  const fittedSize = (width * 0.88) / Math.max(1, text.length * 0.56);
  return {
    text,
    fontSize: Math.max(16, Math.min(preferredSize, fittedSize)),
  };
}

function addTitleToSvg(svg, ctx, autoSlot = null) {
  const metrics = getExportTitleMetrics(ctx);
  if (!metrics) return;

  const [minX, minY, width, height] = ctx.viewBox;
  const margin = Math.min(width, height) * 0.025;
  const autoTitle = ctx.isGenerated && ctx.exportOptions.titlePosition === "auto" && autoSlot;
  const top = ctx.exportOptions.titlePosition !== "bottom";
  const title = svg.ownerDocument.createElementNS(SVG_NS, "text");
  title.setAttribute("id", "maphue-title");
  title.setAttribute("pointer-events", "none");
  // Slots are in the map's own coordinates (as the SVG draws it).
  title.setAttribute("x", String(autoTitle ? autoSlot.x + autoSlot.width / 2 : minX + width / 2));
  title.setAttribute("y", String(autoTitle
    ? autoSlot.y + (autoSlot.height + metrics.fontSize * 0.7) / 2
    : top ? minY + margin + metrics.fontSize : minY + height - margin));
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("font-family", ctx.isGenerated ? "sans-serif" : "Georgia, serif");
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

export function getAutoTitleSlot(ctx, excludeSlots = []) {
  const metrics = getExportTitleMetrics(ctx);
  if (!ctx.isGenerated || !metrics || ctx.exportOptions.titlePosition !== "auto") return null;
  const width = Math.min(ctx.viewBox[2] * 0.88, metrics.text.length * metrics.fontSize * 0.56);
  return selectAutoLegendSlot(ctx.metadata, Math.max(metrics.fontSize * 3, width), metrics.fontSize * 1.5, { excludeSlots });
}

/** The credit lines under a generated map, and the <desc> text. */
export function getExportAttributionLayout(ctx) {
  const metadata = ctx.metadata || {};
  const width = ctx.viewBox[2];
  const lines = [];
  if (metadata.credit) lines.push(`Data credit: ${metadata.credit}`);
  else lines.push(`Map data: ${ctx.dataset}`);
  const licence = [metadata.licence, metadata.shareAlike ? "share-alike terms apply" : ""]
    .filter(Boolean).join(" · ");
  if (licence) lines.push(`Licence: ${licence}`);
  if (metadata.boundaryYear) lines.push(`Boundary year: ${metadata.boundaryYear}`);
  const fontSize = Math.min(18, Math.max(10, width * 0.011));
  const maximumCharacters = Math.max(24, Math.floor(width / (fontSize * 0.58)));
  const wrapped = lines.flatMap((line) => wrapAttributionLine(line, maximumCharacters));
  const visibleLines = wrapped.slice(0, 3);
  if (wrapped.length > 3) visibleLines[2] = `${visibleLines[2].slice(0, Math.max(1, maximumCharacters - 1))}…`;
  const lineHeight = fontSize * 1.35;
  return {
    lines: visibleLines,
    fontSize,
    lineHeight,
    extraHeight: Math.ceil(16 + visibleLines.length * lineHeight),
    description: [
      metadata.credit && `Credit: ${metadata.credit}`,
      metadata.licence && `Licence: ${metadata.licence}`,
      metadata.licenceUrl && `Licence URL: ${metadata.licenceUrl}`,
      metadata.shareAlike && "Share-alike conditions apply to derived maps.",
      metadata.boundaryYear && `Boundary year: ${metadata.boundaryYear}`,
      metadata.url && `Canonical map URL: ${new URL(metadata.url, MAPGEN_API_ROOT).href}`,
    ].filter(Boolean).join(". "),
  };
}

export function wrapAttributionLine(value, maximumCharacters) {
  const words = String(value).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maximumCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function addExportAttribution(svg, ctx) {
  const doc = svg.ownerDocument;
  const layout = getExportAttributionLayout(ctx);
  const description = doc.createElementNS(SVG_NS, "desc");
  description.setAttribute("id", "maphue-attribution");
  description.textContent = layout.description || `Map data from ${ctx.dataset}.`;
  svg.append(description);

  const [minX, minY, width, height] = ctx.viewBox;
  const extraHeight = layout.extraHeight;
  svg.setAttribute("viewBox", [minX, minY, width, height + extraHeight].join(" "));
  svg.setAttribute("width", String(Math.round(width)));
  svg.setAttribute("height", String(Math.round(height + extraHeight)));
  const backdrop = doc.createElementNS(SVG_NS, "rect");
  backdrop.setAttribute("id", "maphue-attribution-background");
  backdrop.setAttribute("x", String(minX));
  backdrop.setAttribute("y", String(minY + height));
  backdrop.setAttribute("width", String(width));
  backdrop.setAttribute("height", String(extraHeight));
  backdrop.setAttribute("fill", "#fffefa");
  svg.append(backdrop);

  const text = doc.createElementNS(SVG_NS, "text");
  text.setAttribute("id", "maphue-attribution-line");
  text.setAttribute("x", String(minX + Math.min(width, height) * 0.025));
  text.setAttribute("y", String(minY + height + 9 + layout.fontSize));
  text.setAttribute("font-family", "sans-serif");
  text.setAttribute("font-size", String(layout.fontSize));
  text.setAttribute("fill", "#18211d");
  layout.lines.forEach((line, index) => {
    const span = doc.createElementNS(SVG_NS, "tspan");
    span.setAttribute("x", String(minX + Math.min(width, height) * 0.025));
    if (index) span.setAttribute("dy", String(layout.lineHeight));
    span.textContent = line;
    text.append(span);
  });
  svg.append(text);
}
