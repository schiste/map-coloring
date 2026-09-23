# Maphue

A browser-based map coloring studio built for Wikimedia Toolforge. Choose a verified Wikimedia
Commons map or create a new blank map from Map Generator, color countries or subdivisions,
import CSV data, and export publication-ready files.

The application has no build step or bundled runtime dependencies. Coloring assignments and
imported CSV contents stay in the browser. Creating a generated map sends only the selected
dataset, area, and rendering options to the public Map Generator API; public crosswalk tables are
downloaded and compared locally.

## Features

- Click countries to cycle through 2–8 custom colors
- Choose verified interactive SVGs from the Commons world-map category
- Create a blank map from one or more areas in public Map Generator datasets, including world maps, countries, first-level subdivisions, and US counties
- Every setting Map Generator offers (title, caption, size, labels and languages, capitals, neighbour names, projection, frame, point of view, borders, base map colours…), in a form built from its [render options](https://github.com/schiste/map-generator/blob/main/docs/api.md#render-options), so new settings appear without a Maphue update
- Switch between world country maps and continent-focused maps
- Switch between curated Europe and Africa maps while retaining ISO color assignments
- Read each map's short Commons description and open its source page
- Search by country or region name, code, or parent area
- Color a country across its subdivisions or assign a subdivision/data unit directly
- Import pasted text or CSV data with automatic country, region, parent, and category-column detection
- Check boundary-year mismatches against public crosswalks without sending imported codes
- Assign multiple legend categories in one CSV import with a color-coded map preview and validation
- Recognize Kosovo by name, `XK`, or the common `XKX` code
- Edit colors and legend labels with live map updates
- Place the export legend automatically in Map Generator's reported open areas, or choose a position with land-overlap hints
- Keep generated-map credit and licence information in SVG, PNG, and PDF exports; see share-alike terms before exporting
- Add an optional centered title above or below the map
- Save work automatically in browser storage
- Export the colored map as SVG, PNG, or PDF with an embedded legend
- Export assignments as CSV
- Responsive and keyboard-accessible controls

## Run locally

The SVG, country data, and live Commons catalog are loaded with `fetch`, so open the project
through a local web server:

```sh
python3 -m http.server 8080
```

Then visit <http://localhost:8080>.

## Tests

```sh
npm ci && npm test      # unit tests (Node 22)
test/rsvg/check.sh      # an exported map in librsvg and Chromium (needs Docker)
```

The Map Generator tests run on recorded API responses in `test/fixtures/mapgen/`: the SVG
contract fixture, France and world map metadata, French and US county features, and the US
county crosswalks (Alaska's Valdez-Cordova split, Connecticut's 2022 planning regions).
`test/fixtures/mapgen/record.sh` records them again. `test/rsvg/check.sh` renders an exported
coloured map (legend, title, data credit) with librsvg, the renderer Wikimedia Commons uses,
and with Chromium, and compares both with `test/rsvg/france-export.png`; `--update` rewrites
the reference. CI runs both on every push.

## Deploy to Wikimedia Toolforge

The repository includes a dry-run-first deployment workflow for the existing `maphue` tool.

```sh
npm run deploy:toolforge:dry-run
npm run deploy:toolforge:restart
```

The deployment publishes only browser assets to `/data/project/maphue/public_html`, installs the
webservice template, and starts or restarts the service. The production URL is
<https://maphue.toolforge.org/>.

## Data and licensing

- `assets/blank-map-world.svg` is
  [BlankMap-World.svg](https://commons.wikimedia.org/wiki/File:BlankMap-World.svg) from Wikimedia
  Commons, released into the public domain.
- The selectable map catalog and its descriptions are read from
  [SVG blank maps of the world with small regions drawn as circles](https://commons.wikimedia.org/wiki/Category:SVG_blank_maps_of_the_world_with_small_regions_drawn_as_circles).
- The initial continent maps are
  [Blank map of Europe (without disputed regions).svg](https://commons.wikimedia.org/wiki/File:Blank_map_of_Europe_(without_disputed_regions).svg)
  under CC BY-SA 4.0 and
  [BlankMap-Africa.svg](https://commons.wikimedia.org/wiki/File:BlankMap-Africa.svg) in the public
  domain.
- `data/countries.source.json` comes from
  [ISO-3166-Countries-with-Regional-Codes](https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes)
  and is licensed under CC BY-SA 4.0.
- Generated maps come from the public [Map Generator API](https://map-generator.toolforge.org/api/v1/),
  which provides dataset credit, licence, share-alike status, boundary year, SVG contract version,
  and map geometry. See the [API documentation](https://github.com/schiste/map-generator/blob/main/docs/api.md)
  for dataset sources and terms.
- When a CSV contains unmatched region codes, Maphue may download public crosswalk tables from
  Map Generator and compare them in the browser. CSV rows, names, categories, and assignments are
  not sent to that service.
- Application code is licensed under the MIT License; see [LICENSE](LICENSE).

Each source map retains its own boundaries and visibility. Commons maps remain restricted to the
verified interactive allowlist. Generated maps are accepted only when their SVG declares a
Maphue-supported Map Generator contract version. Maphue stores the selected generated map's
canonical URL and rendering choices in browser storage; it does not store a copy of the SVG.
