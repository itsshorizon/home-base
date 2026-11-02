# Offline map data

Everything the Map tab needs. Nothing here is fetched at run time except the one-time map download.

| File | What it is | How it is made |
|---|---|---|
| `henrico.pmtiles` | Vector basemap (roads, water, buildings, labels), 49,292,020 bytes (47.0 MiB), zoom 0 to 15 | `pmtiles extract` from the Protomaps daily build (see below) |
| `style.json` | Map style (dark flavor, English labels) | `@protomaps/basemaps` 5.7.2, see below |
| `water.geojson`, `waterways.geojson`, `waterbodies.geojson`, `services.geojson`, `routes.geojson`, `boundary.geojson`, `rings.geojson`, `meta.json` | Overlays and a record of when they were fetched | `npm run map:data` (`scripts/fetch-osm.js`, OpenStreetMap through the Overpass API) |

`henrico.pmtiles` is **not** in the service worker's precache (too big). The Map tab or Settings downloads it on request into its own cache, `hb-map-v1`.
GitHub's hard limit is 100 MB per file; keep it under 95 MB.

## The basemap
- Source: Protomaps daily build **2026-11-01** (`https://build.protomaps.com/20261101.pmtiles`). OSM data as of 2026-11-01.
- Tool: `pmtiles` CLI **v1.31.2** (go-pmtiles, macOS arm64), kept outside the repo.
- Command:
  ```
  pmtiles extract https://build.protomaps.com/20261101.pmtiles data/map/henrico.pmtiles --bbox=-77.85,37.30,-77.05,37.92 --maxzoom=15
  ```
  Bounding box (W,S,E,N): Henrico plus all of Ashland and Mechanicsville, more of Hanover, Goochland, Chesterfield and Charles City, and Richmond city. 7,324 tiles. (Phase 4 used `-77.80,37.33,-77.10,37.82`, 43,555,441 bytes. Phones that saved that file see a "Map update available" banner.)
- `meta.json` `pmtiles.bytes` must stay the exact size of the unzipped file: the download check compares against it, because GitHub Pages gzips the file in transit.
- Attribution: © OpenStreetMap contributors · Protomaps (ODbL).

## Creeks, rivers and lakes (Phase 4b)
The Protomaps basemap already draws water, but dark blue on dark grey, so creeks nearly vanish. Two extra overlays are drawn bright on top:
- `waterways.geojson`: lines for `waterway=river|stream|canal` (and named `drain|ditch`) from OpenStreetMap. Segments with the same name, kind and seasonal flag are merged, simplified (Douglas-Peucker, about 4 m) and rounded to 5 decimals. `intermittent` is true for OSM `intermittent=yes` or `seasonal=yes` (and `seasonal=wet_season|summer`); those are drawn dashed because they may be dry. Unnamed drains and ditches are left out.
- `waterbodies.geojson`: polygons for `natural=water`, `water=lake|pond|reservoir` and `landuse=reservoir` of about 0.25 acre or more, with `kind`, `areaAcres` and a centroid `c`. Multipolygon relations (holes included) are supported. Rivers, canals, stormwater basins and similar are not included.
- The Overpass queries for these two are split into 5 x 5 tiles, because one big query over Richmond kept returning HTTP 502. Rerun with `npm run map:data` (takes 30 to 60 minutes when Overpass is busy; set `HB_OSM_CACHE=/some/folder` to resume).

## The style
Made with `@protomaps/basemaps@5.7.2` (installed in a scratch folder, not in this repo):
```js
import { layers, namedFlavor } from '@protomaps/basemaps';
layers('protomaps', namedFlavor('dark'), { lang: 'en' })
```
Wrapped in a style with source `pmtiles://henrico` (the app swaps in the real file at run time), glyphs `vendor/map/fonts/{fontstack}/{range}.pbf`, sprite `vendor/map/sprites/dark`.

## Vendored files (`vendor/map/`)
- `maplibre-gl-4.7.1.js` / `.css` and `pmtiles-3.2.1.js`: from jsDelivr (npm `maplibre-gl@4.7.1`, `pmtiles@3.2.1`).
- `sprites/dark*`: `sprites/v4/` from github.com/protomaps/basemaps-assets at commit `028c18f713baecad011301ff7a69acc39bcc2ae7`.
- `fonts/Noto Sans {Regular,Medium,Italic}/{0-255,256-511,8192-8447}.pbf`: same repo and commit. Only the Latin ranges plus general punctuation (curly apostrophes, dashes; used in some place names and in the ring labels), because the style uses only these three font stacks. A label with a character outside them would silently not draw.

## Overlay notes
- Fetched with Overpass (a polite User-Agent and a pause between queries). See `meta.json` for the date, counts and notes.
- River and creek access points are **inferred** (a point on the named waterway where a road bridge crosses it, or its midpoint). They are not surveyed access points.
- Shelters have no coordinates in `data/local.json`, so they are listed as text only.
