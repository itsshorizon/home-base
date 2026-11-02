# Phase 4b: Bigger map, clearly marked creeks and streams, "Find water"

Read `CLAUDE.md` and `tasks/phase-4-map.md` first. The map from Phase 4 is live (v0.4.3) and works offline. Austin's feedback:

> Need to expand map to Ashland and Mechanicsville, needs to clearly mark creeks and streams on the map. Water sources are key.

Today, creeks are faint dark-blue lines in the dark basemap, so they're nearly invisible. Ashland sits at the very edge of the map and can't be panned past.

## 1. Bigger area
- **New bbox: `-77.85,37.30,-77.05,37.92`** (W, S, E, N). It covers all of Ashland (37.76 N, −77.48) and Mechanicsville (37.61 N, −77.37) with room around them, plus more of Hanover, Goochland, Chesterfield and Charles City.
- Re-extract `data/map/henrico.pmtiles` with the same tooling as Phase 4 (pmtiles CLI in the scratchpad), from a recent Protomaps daily build, at `--maxzoom=15`.
  - It **must stay under 95 MB**. If it doesn't, try maxzoom 14 and report the sizes.
  - Update `data/map/README.md` and `meta.json` (`pmtiles.bytes`, `buildDate`, `bbox`, `maxzoom`). The download check in `js/mapcache.js` relies on `meta.pmtiles.bytes`, so it must be exact.
- Keep the filename `henrico.pmtiles`.
- `maxBounds` = the new bbox plus a small pad.
- **Start view:** fit Henrico plus Ashland and Mechanicsville, i.e. the bbox of the Henrico boundary extended to include both towns.
- **Map update for phones that already downloaded the old file:** if the cached file's size differs from `meta.pmtiles.bytes`, keep showing the old map and show a banner: "Map update available (NN MB) — bigger area and creeks. Download on Wi-Fi." The button reuses the download flow and replaces the cached file **only after** the new one is fully verified, so a failed update never leaves them with no map. Put the logic in `js/mapcache.js` (`getMapStatus()` gains `outdated: boolean`), and test it with a fake cache entry.

## 2. Creeks, streams, rivers and lakes as their own bright overlay
Update `scripts/fetch-osm.js` (same Overpass etiquette, new bbox), then re-run it.
- **`data/map/waterways.geojson`** (new):
  - ways with `waterway=river|stream|canal`, plus `waterway=drain|ditch` **only if named**
  - properties: `name` (or null), `kind` (`river|stream|canal|ditch`), `intermittent` (true when OSM `intermittent=yes` or `seasonal=yes`), `osm_id`
  - Merge connected segments that share a name into longer lines where practical.
  - Simplify with Douglas-Peucker at about 4 m, and round coordinates to 5 decimals.
  - **Size target: under 4 MB.** If it's over, drop unnamed `stream` segments shorter than 150 m first, and report what you dropped.
- **`data/map/waterbodies.geojson`** (new): `natural=water` / `water=lake|pond|reservoir` / `landuse=reservoir` polygons of at least about 0.25 acre, simplified, with `name`, `kind` (`lake|pond|reservoir`) and an area estimate. Multipolygon relations must work, including the larger reservoirs.
- Keep the existing `water.geojson` points (springs, taps, ramps, piers, lake centroids, river access). Regenerate them for the new bbox.
- Add the new files to `meta.json` counts and to sw.js PRECACHE, outside the GUIDES markers.

**Styling** (MapLibre layers added above the basemap, below roads and routes):
- **Lakes and ponds:** fill `#38bdf8` at about 35% opacity, with a 1.5 px `#7dd3fc` outline. Visible from z9.
- **Rivers:** `#38bdf8` line, width interpolated about 2.5 px at z9 to 7 px at z15.
- **Streams and canals:** `#7dd3fc` line, width about 1.5 px at z10 to 4 px at z15. They must be **clearly visible against the dark basemap from z11**.
- **Intermittent** streams: dashed (`line-dasharray [2,1.5]`), since they may be dry.
- **Labels:** waterway names along the line (`symbol-placement: line`) in `#bae6fd` with a dark halo, from z12 for streams and z10 for rivers. Lake names at their centroid from z12. Use the vendored glyphs; check that no new glyph ranges are needed.
- **Taps:** water points stay as they are, on top. Make them more prominent: about a 7 px radius, with springs and taps in a brighter fill than ramps and access points.

**Layers sheet:** split "Water sources" into three toggles, all on by default and saved in `mapLayers`:
- **Water points** (taps, springs, access)
- **Creeks & rivers**
- **Lakes & ponds**

Add a small legend to the Layers sheet: solid = flowing year-round, dashed = may be dry, filled = lake or pond, dot colors.

## 3. Tapping a creek or lake
Make the waterway and lake layers tappable, with a slightly generous hit area, using a wider invisible line layer for hit testing.

The sheet shows:
- name (or "Unnamed stream"), kind, and "⚠ Seasonal — may be dry" when intermittent
- the `waterAdvice()` text and badge for that kind (stream, river, lake, pond). Extend `waterAdvice` in `js/mapinfo.js` with these kinds, using the **existing guide wording only**, and add tests.
- **"Closest point to you: 0.6 mi SW"**: the nearest point on the line, or polygon boundary, to the GPS fix. Put a pure helper `nearestPointOnLine(coords, lat, lon)` in `mapinfo.js` and test it.
- **"Nearest access point":** the closest `water.geojson` access point, ramp or pier on a waterway with the same name, if one exists, with a button to fly there.
- "Save as pin", and "How to treat" linking to the `water-source-choice` guide.

## 4. 💧 "Find water" button
Add a new map control, the most prominent one: blue, at the top of the control stack. It opens a bottom sheet:
- Origin is the GPS position. If there's no fix, use the map center and say "From map center (no GPS fix)".
- **Filter chips:** All · Taps & springs · Creeks & rivers · Lakes & ponds.
- **The nearest 15 results**, merging:
  - water points
  - the closest point on each named waterway (one row per name), plus unnamed streams within 1 mile
  - lakes and ponds (closest boundary point)
- Each row shows an icon, name, kind, distance and bearing ("0.4 mi NE"), and "may be dry" for intermittent waterways. Taps and springs get a "safest" tag, using the advice tiers from `waterAdvice`. **Don't invent safety claims.**
- Tapping a row flies there and opens its sheet.
- It must be fast: pre-index the features once, with a simple distance scan. Fine for about 10k features. Put the ranking logic in a pure function `rankWaterSources(features, lat, lon, filter, limit)` in `mapinfo.js`, with tests.

## 5. Done means
- `node --test` is green, with the new tests in `tests/mapinfo.test.js` (and mapcache logic if it's testable).
- **Browser pane at 375 px**, using the `home-base` config in `/Users/austin/Code/.claude/launch.json` (port 8790):
  - Download the new map. Stop the server and reload: it renders offline.
  - **Zoom to Ashland and to Mechanicsville** and take screenshots: streets and labels present, creeks clearly visible.
  - **Zoom to Deep Run Park / Tuckahoe Creek at z13–14** and take a screenshot: creeks and names are clearly visible and blue, and intermittent ones are dashed.
  - Tap a creek: the sheet works, with closest point and nearest access.
  - **Find water:** with GPS mocked near Glen Allen (37.665, −77.505), it lists sources sorted by distance, the filters work, and tapping a row flies there.
  - **Map update banner:** put a fake smaller file in `hb-map-v1` under the map URL. The "Map update available" banner shows, the old map still renders, and after updating the new size is cached.
  - No console errors (especially glyphs) and no horizontal overflow.
- **Note on testing:** the python dev server's HTTP cache can serve stale JS/CSS. Use `fetch(url, {cache:'reload'})` on changed files, or clear SW and caches, before trusting a screenshot.
- **Bump the version to 0.5.0** in all three places. Run `npm run guides` only if guide files changed; they shouldn't.
- **Clean up:** delete the test IndexedDB, all caches and the SW; stop the server; reset the viewport.
- **No git.**

## Report
- the new pmtiles size and maxzoom
- feature counts (waterways by kind, how many intermittent, water bodies)
- the sizes of the new geojson files
- the screenshots you checked, with a description of each
- deviations
