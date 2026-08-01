export const MAP_CATEGORY =
  "Category:SVG blank maps of the world with small regions drawn as circles";

export const PREFERRED_MAP_TITLE = "File:BlankMap-World-Microstates.svg";

export const VERIFIED_INTERACTIVE_WORLD_MAP_TITLES = Object.freeze([
  PREFERRED_MAP_TITLE,
  "File:Blank Detailed Map with AUKUSCA subdivisions.svg",
  "File:Blank Map with US subdivisions and microstates.svg",
  "File:Blank world map (Miller cylindrical projection).svg",
  "File:BlankMap-World-Microstates-Unrecognised.svg",
  "File:BlankMap-World-Sovereign Nations.svg",
  "File:BlankMap-World-with-Circles.svg",
  "File:World map configurable.svg",
]);

const VERIFIED_INTERACTIVE_WORLD_MAP_TITLE_SET = new Set(
  VERIFIED_INTERACTIVE_WORLD_MAP_TITLES,
);

export const CONTINENT_MAPS = [
  {
    title: "File:Blank map of Europe (without disputed regions).svg",
    region: "Europe",
  },
  {
    title: "File:BlankMap-Africa.svg",
    region: "Africa",
  },
];

export const FALLBACK_MAP = {
  title: "File:BlankMap-World.svg",
  name: "BlankMap-World (bundled fallback)",
  description:
    "The original detailed Robinson projection bundled with Maphue for offline and API fallback use.",
  url: "assets/blank-map-world.svg",
  thumbnailUrl: "",
  commonsUrl: "https://commons.wikimedia.org/wiki/File:BlankMap-World.svg",
  categoryMap: false,
  scope: "world",
  fallback: true,
};

const API_ENDPOINT = "https://commons.wikimedia.org/w/api.php";

export async function fetchMapCatalog(fetcher = fetch) {
  const maps = [];
  let continuation = "";

  do {
    const url = new URL(API_ENDPOINT);
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      generator: "categorymembers",
      gcmtitle: MAP_CATEGORY,
      gcmtype: "file",
      gcmnamespace: "6",
      gcmlimit: "max",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "500",
      ...(continuation ? { gcmcontinue: continuation } : {}),
    });

    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Commons map catalog request failed: ${response.status}`);
    const data = await response.json();

    for (const page of data.query?.pages || []) {
      const map = mapFromApiPage(page);
      if (map && VERIFIED_INTERACTIVE_WORLD_MAP_TITLE_SET.has(map.title)) maps.push(map);
    }
    continuation = data.continue?.gcmcontinue || "";
  } while (continuation);

  return maps.sort((a, b) => {
    if (a.title === PREFERRED_MAP_TITLE) return -1;
    if (b.title === PREFERRED_MAP_TITLE) return 1;
    return a.name.localeCompare(b.name, "en");
  });
}

export async function fetchContinentCatalog(fetcher = fetch) {
  const url = new URL(API_ENDPOINT);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    titles: CONTINENT_MAPS.map((map) => map.title).join("|"),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "500",
  });

  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Commons continent catalog request failed: ${response.status}`);
  const data = await response.json();
  const pagesByTitle = new Map(
    (data.query?.pages || []).map((page) => [page.title, page]),
  );

  return CONTINENT_MAPS.flatMap((definition) => {
    const page = pagesByTitle.get(definition.title);
    const map = mapFromApiPage(page, {
      categoryMap: false,
      scope: "continent",
      region: definition.region,
    });
    return map ? [map] : [];
  });
}

export function mapFromApiPage(page, options = {}) {
  const imageInfo = page?.imageinfo?.[0];
  if (!page?.title?.endsWith(".svg") || !imageInfo?.url) return null;

  const rawDescription = imageInfo.extmetadata?.ImageDescription?.value || "";
  const description =
    shortenDescription(htmlToPlainText(rawDescription), 240) ||
    `SVG blank world map from Wikimedia Commons: ${displayMapName(page.title)}.`;

  return {
    title: page.title,
    name: displayMapName(page.title),
    description,
    url: imageInfo.url,
    thumbnailUrl: imageInfo.thumburl || "",
    commonsUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(
      page.title.replaceAll(" ", "_"),
    )}`,
    categoryMap: options.categoryMap ?? true,
    scope: options.scope || "world",
    region: options.region || "",
    fallback: false,
  };
}

export function htmlToPlainText(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|dd|dt|h[1-6])>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function displayMapName(title) {
  return title.replace(/^File:/, "").replace(/\.svg$/i, "").replaceAll("_", " ");
}

function shortenDescription(value, limit) {
  if (value.length <= limit) return value;
  const shortened = value.slice(0, limit - 1);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, Math.max(lastSpace, limit * 0.75)).trim()}…`;
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] === "#") {
      const hexadecimal = key[1]?.toLowerCase() === "x";
      const number = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    }
    return named[key.toLowerCase()] ?? entity;
  });
}
