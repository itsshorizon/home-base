# Phase 4: Offline Henrico map

Read `CLAUDE.md` first. The app is at v0.3.1.

**Goal.** A detailed map of Henrico County and its edges that works with **no signal**, and shows:
- the phone's GPS position
- **water sources** (with how to treat each one)
- emergency services
- major routes out of the area
- nuclear plant rings
- the household's own pins

**Parallel work.** Another agent is adding diagrams to the guides at the same time. To avoid edit collisions:
- **Do not edit** `css/app.css`, `js/guides.js`, `scripts/guides-index.js`, or anything in `data/guides/`.
- Put all map CSS in **`css/map.css`** and load it from the map view (add a `<link>` once, on first open).
- You may edit `js/app.js` (routes), `sw.js` (PRECACHE, **outside** the `// GUIDES:START/END` markers), `js/views/placeholder.js`, `js/views/more.js` and `js/views/settings.js`.
- **Do not bump the version.** The lead does that.

## 1. Basemap: Protomaps vector tiles
- **pmtiles CLI.** There's no Homebrew or Go here. Download the macOS arm64 `pmtiles` binary from the official `protomaps/go-pmtiles` GitHub releases into the scratchpad, at a pinned version.
- **Bounding box:** Henrico plus a buffer covering Richmond city, eastern Goochland, southern Hanover, northern Chesterfield and western Charles City: **`-77.80,37.33,-77.10,37.82`** (W, S, E, N).
- **Extract it:**
  ```bash
  pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles data/map/henrico.pmtiles --bbox=-77.80,37.33,-77.10,37.82 --maxzoom=15
  ```
  Pick a recent daily build that exists; list them at https://build.protomaps.com/.
  - The file **must be under 95 MB**, because GitHub's hard limit is 100 MB. If it's bigger, drop to `--maxzoom=14` and report the size.
  - Record the build date, CLI version and size in `data/map/README.md`.
- **Style.**
  - Generate a static `data/map/style.json` at build time with `@protomaps/basemaps` (pinned version, via `npx` or a temp `npm i` **in the scratchpad**, never as a dependency of the app). Use the **dark** flavor and English labels.
  - The source is `{"type":"vector","url":"pmtiles://henrico"}`. The app rewrites this at runtime.
  - Use attribution "© OpenStreetMap contributors · Protomaps", and keep it visible on the map.
- **Glyphs and sprites, vendored for offline use**, from `protomaps/basemaps-assets` (pinned commit or tag):
  - only the font stacks the style uses, and only ranges `0-255` and `256-511` (Latin), as `vendor/map/fonts/{fontstack}/{range}.pbf`
  - the dark sprite (`.json`, `.png`, `@2x`) in `vendor/map/sprites/`
  - Set `glyphs` and `sprite` in style.json to these relative paths.
  - If a label needs a range you didn't vendor, MapLibre fails quietly. Check the console during verification.
- **Libraries in `vendor/`, pinned and loaded only by the map view:**
  - `maplibre-gl@4.7.1` (js + css)
  - `pmtiles@3.2.1` (the UMD build exposing `pmtiles.Protocol` / `pmtiles.PMTiles` / `pmtiles.FileSource`)
  - Download from jsdelivr.

## 2. Getting the map onto the phone
The `.pmtiles` file is **not** in PRECACHE; it's too big to block the service worker install.
- **Map tab, not downloaded yet:** show a card: "Download the offline map (NN MB) — do this on Wi-Fi." The button:
  - fetches `data/map/henrico.pmtiles` with a progress bar (stream the body and count bytes)
  - stores it in a **separate cache, `hb-map-v1`**. Edit `sw.js` activate so it **never deletes caches starting with `hb-map-`**, and leave `hb-map-*` requests out of the fetch handler. The map code reads the cache directly.
  - calls `navigator.storage.persist()`
  - Handle a full disk (`QuotaExceededError`) and a lost connection with clear messages and a Retry.
- **Reading the map:** get the cached `Response` → `blob()` → `new pmtiles.PMTiles(new pmtiles.FileSource(new File([blob], 'henrico.pmtiles')))`, register it with `protocol.add(...)`, then create the map.
- **Online fallback:** if the file isn't downloaded but the phone is online, use `pmtiles://` with the network URL (range requests from GitHub Pages) and show a banner "Not saved for offline yet."
- **Offline and not downloaded:** "Map isn't downloaded. Connect to download it."
- **Settings:** a "Map" row showing downloaded size and date, plus Re-download and Delete buttons.

## 3. Overlay data: `scripts/fetch-osm.js` (Node 24, built-in fetch, run on the Mac)
- Query the Overpass API at `https://overpass-api.de/api/interpreter`. Send a polite `User-Agent: HomeBase/0.4 (household prep app)`, wait between queries, and use the bbox above.
- Convert the results to GeoJSON. Use points for nodes, and centroids for ways and relations where a point is needed. Write minified files to `data/map/`:
  - **`water.geojson`:**
    - `natural=spring`, `amenity=drinking_water`, `amenity=water_point`, `man_made=water_tap`
    - named `natural=water` lakes and ponds as centroid points with an area estimate
    - `leisure=slipway` (boat ramps) and `leisure=fishing` / `man_made=pier` (river access points)
    - one access point per named river or creek (James, Chickahominy, Tuckahoe, Deep Run, Four Mile, Upham Brook and others), using its slipway/pier points or else a point on the waterway near a road crossing; keep it simple and say what you did
  - **`services.geojson`:** `amenity=hospital|clinic|pharmacy|fire_station|police`, `shop=supermarket|hardware|doityourself`, `amenity=fuel`
  - **`routes.geojson`:** way geometry for `highway=motorway|trunk|primary` with `ref` in I 64, I 95, I 295, I 195, US 60, US 250, US 33, US 360, US 1, VA 5. Merge into one line per ref where practical, and simplify to keep it under 1 MB.
  - **`boundary.geojson`:** Henrico County's admin boundary (relation, `admin_level=6`, name "Henrico County"), simplified.
- Every feature keeps `name`, `osm_id`, a normalized `kind` (e.g. `spring`, `tap`, `lake`, `river_access`, `boat_ramp`, `hospital`, `pharmacy`…) and useful tags (`access`, `operator`, `opening_hours`, `phone`, `addr:*`).
- **`data/map/rings.geojson`:** 10-mile and 50-mile circles (64-point polygons) around North Anna and Surry. Take the coordinates from `data/local.json` `nuclearPlants` and cite its sources in properties.
- **Shelters:** the two in `local.json` have no coordinates. **Do not geocode them from memory.** List them in the map's info panel as text only.
- Write `data/map/meta.json`: `{ fetchedAt, bbox, counts: { water: n, ... }, sources: [...] }`.
- The script is re-runnable. `package.json` gets `"map:data": "node scripts/fetch-osm.js"`.

## 4. Water-source treatment info (`js/mapinfo.js`, PURE, Node-importable)
`waterAdvice(kind)` returns `{ label, safety: 'treat'|'tap'|'avoid', text, guide }`. Base it **only on the existing guides** `water-source-choice`, `water-filters`, `water-boil` and `water-bleach`: read them and reuse their wording and numbers. Don't invent new facts. For example:
- **spring / river_access / lake / boat_ramp:** "Not safe to drink untreated. Filter, then boil or use bleach. Filters and bleach don't remove fuel or chemical runoff, so skip water with a sheen or chemical smell." → guide `water-source-choice`.
- **tap / drinking_water:** "Public tap. Safe only while the water system is working and no boil advisory is in effect. Otherwise treat it." → `hazard-boil-advisory`.
- **The James River in and below Richmond:** if a feature is on the James east of longitude −77.45, add "Downstream of Richmond's combined sewer overflows after heavy rain — treat carefully and prefer other sources." Back this with a source: CSO facts must come from `data/local.json` or a source you open (Richmond DPU or James River Association). If you can't verify it, leave it out.

Unit-test `waterAdvice` and the distance/bearing helper (see §5) in `tests/mapinfo.test.js`.

## 5. Map view (`js/views/map.js`, `#/map`; replaces the placeholder)
- **Full-height map** between the header and the tab bar. The dark style matches the app.
- **Start view:** fit the Henrico boundary. `maxBounds` is the bbox plus a small pad.
- **Controls** (big, 44px):
  - **📍 Locate:** `watchPosition` with `enableHighAccuracy`. Shows a blue dot with an accuracy circle and centers once. GPS works without data. Handle a permission denial with a friendly message.
  - **Layers** button, opening a sheet with toggles:
    - Water sources (on)
    - Services (on)
    - Routes out (on)
    - Nuclear rings (off)
    - Henrico boundary (on)
    - My pins (on)
    - Save the toggles in settings `mapLayers`.
  - **🔍 Search:** offline search over feature names, plus pins.
  - **＋ Pin.**
- **Layer styles:**
  - water points: blue circles with a 💧 symbol layer, or a simple circle with a white stroke if the symbol is unavailable
  - services: by kind (red hospital, green pharmacy, orange fire, etc.)
  - routes: a thick amber casing under the road, with ref labels
  - rings: dashed outlines with labels like "North Anna — 50 mi"
  - boundary: a thin bright outline
  - Clustering for water and services at low zoom is a nice-to-have, only if it's simple with MapLibre's GeoJSON cluster option.
- **Tap a feature** to open a bottom sheet with:
  - name (or kind), kind label, and the useful tags (hours, phone as `tel:`, address)
  - **distance and direction from your GPS position** ("2.4 mi NE"); show "—" without a fix
  - for water: the `waterAdvice` text, a colored safety badge, and a **"How to treat"** link to the guide
  - for any feature: "Save as pin"
- **Pins** (the `pins` store already exists and is in backups):
  - `{ id, name, type: 'home'|'rally'|'water'|'cache'|'danger'|'other', lat, lon, notes, createdAt }`
  - Add a pin by long-pressing the map (500 ms; it must not trigger while panning) or with the ＋ Pin button, which drops at the GPS position or else the map center.
  - The form sheet has name, type and notes.
  - Edit and delete from the pin's sheet.
  - Pins render with an emoji per type.
- **Info panel** ("ⓘ" button): data dates from `meta.json`, attribution, the shelter list from `local.json` with its notes ("Henrico hasn't published a current shelter list; listen to local alerts"), and the disclaimer "Map data may be out of date. Water sources must always be treated. Routes out are major roads, not official evacuation routes."
- **Performance:** load the GeoJSON overlays lazily on the first map open. Keep total overlay JSON under about 3 MB. Remove map listeners and the map instance in `destroy()`.

## 6. Precaching
Add these to PRECACHE (outside the guide markers):
- maplibre js/css, pmtiles js, fonts, sprites
- `data/map/style.json`, `meta.json` and the five geojson files
- `css/map.css`, `js/views/map.js`, `js/mapinfo.js`

**Not** `henrico.pmtiles`.

## 7. Tests and verification
- `node --test` is green, with all the old tests plus mapinfo.
- **Browser pane at 375px**, using the `home-base` config in `/Users/austin/Code/.claude/launch.json` (port 8790):
  - Download the map with the button. The progress bar works, and the cache `hb-map-v1` holds the file.
  - **Stop the server and reload.** The map renders from cache: streets, labels (zoom to the street level around Glen Allen and confirm text renders, with no glyph errors in the console), water points, routes and boundary.
  - Tap a water feature: the sheet shows advice and the guide link. Tap a hospital: phone and address show if tagged.
  - Long-press adds a pin, and it persists across a reload. Panning does not create pins.
  - Layer toggles work and persist.
  - **Locate:** mock geolocation if needed (override `navigator.geolocation` in the page for the test only) at a point in Henrico. Confirm the blue dot and the distances in sheets.
  - No horizontal overflow, no console errors.
- **Clean up:** delete the test IndexedDB, unregister the SW, delete **all** caches including `hb-map-v1`, stop the server, and reset the viewport.
- **No git.**

## Report
- the pmtiles size, maxzoom and build date
- feature counts by kind
- files created and changed
- the test summary
- the verification results
- deviations
- anything you couldn't verify (for example, CSO facts)
