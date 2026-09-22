# Maphue

A browser-only world map coloring tool built for Wikimedia Toolforge. Click or search for
countries, choose among blank world maps from Wikimedia Commons, create a custom palette and
legend, import country lists from CSV, and export publication-ready files.

The application has no build step, no runtime dependencies, and sends no map data to a server.

## Features

- Click countries to cycle through 2–8 custom colors
- Choose verified interactive SVGs from the Commons world-map category
- Switch between world country maps and continent-focused maps
- Switch between curated Europe and Africa maps while retaining ISO color assignments
- Read each map's short Commons description and open its source page
- Search by English name, ISO 3166-1 alpha-2, or alpha-3 code
- Import pasted text or CSV data with automatic country-column detection
- Assign multiple legend categories in one CSV import with a color-coded map preview and validation
- Recognize Kosovo by name, `XK`, or the common `XKX` code
- Edit colors and legend labels with live map updates
- Place the export legend in nine positions with a custom background color and transparency
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
- Application code is licensed under the MIT License; see [LICENSE](LICENSE).

Each source map retains its own boundaries and visibility. Coloring a recognized country applies
to SVG elements carrying that country's ISO-2 class. Only maps verified to expose selectable ISO
country groups are listed; new Commons category files must pass that compatibility check before
being added to the verified allowlist.
