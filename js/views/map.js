// Offline Henrico map (#/map). MapLibre GL draws the Protomaps vector tiles from a .pmtiles file that was
// saved to this phone (see js/mapcache.js). Overlays (water, services, routes...) are small GeoJSON files.
// Everything is loaded the first time this tab opens, not at app start.
import { getAll, put, del, newId, getSettings, saveSettings } from '../db.js';
import { openSheet } from '../sheet.js';
import { esc, fmtDate, fmtNum } from '../format.js';
import {
  waterAdvice, SAFETY_LABELS, KIND_LABELS, WATER_KINDS, WATERWAY_KINDS, PIN_TYPES, pinEmoji, featureTitle, formatAddress, telHref,
  distanceFrom, searchFeatures, circleRing, nearestOnGeometry, rankWaterSources, nearestAccessPoint, formatDistance, bearingDegrees,
  compassPoint, WATER_FILTERS, WATER_ICONS,
} from '../mapinfo.js';
import { getMapStatus, loadMapBlob, downloadMap, mapUrl, MapDownloadError } from '../mapcache.js';

const VENDOR = 'vendor/map/';
const MAPLIBRE_JS = `${VENDOR}maplibre-gl-4.7.1.js`;
const MAPLIBRE_CSS = `${VENDOR}maplibre-gl-4.7.1.css`;
const PMTILES_JS = `${VENDOR}pmtiles-3.2.1.js`;
const DISCLAIMER = 'Map data may be out of date. Water sources must always be treated. Routes out are major roads, not official evacuation routes.';

const LAYER_DEFS = [
  { id: 'waterpts', label: 'Water points', color: '#67e8f9', on: true, layers: ['water-circle', 'water-label'] },
  { id: 'waterways', label: 'Creeks & rivers', color: '#38bdf8', on: true, layers: ['ww-river', 'ww-stream', 'ww-dry', 'ww-hit', 'ww-label', 'ww-label-river'] },
  { id: 'waterbodies', label: 'Lakes & ponds', color: '#38bdf8', on: true, layers: ['wb-fill', 'wb-line', 'wb-label'] },
  { id: 'services', label: 'Services', color: '#ef4444', on: true, layers: ['services-major', 'services-minor', 'services-label'] },
  { id: 'routes', label: 'Routes out', color: '#f5a524', on: true, layers: ['routes-casing', 'routes-line', 'routes-label'] },
  { id: 'rings', label: 'Nuclear rings', color: '#f472b6', on: false, layers: ['rings-line', 'rings-label'] },
  { id: 'boundary', label: 'Henrico boundary', color: '#e8efe9', on: true, layers: ['boundary-line'] },
  { id: 'pins', label: 'My pins', color: '#ff8a1f', on: true, layers: [] },
];
const SERVICE_COLORS = ['match', ['get', 'kind'],
  'hospital', '#ef4444', 'clinic', '#f87171', 'pharmacy', '#22c55e', 'fire_station', '#fb923c', 'police', '#818cf8',
  'fuel', '#facc15', 'supermarket', '#a3e635', 'hardware', '#d4d4d8', '#d4d4d8'];

// ---------- library loading (once) ----------
const loading = {};
function loadScript(src) {
  if (!loading[src]) {
    loading[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => { delete loading[src]; reject(new Error(`Could not load ${src}`)); };
      document.head.appendChild(s);
    });
  }
  return loading[src];
}
function loadCss(href) {
  if (document.querySelector(`link[data-map-css="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.dataset.mapCss = href;
  document.head.appendChild(l);
}
const getJson = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

// ---------- per-visit state ----------
let S = null; // reset on every render; destroy() tears it down

export function destroy() {
  if (!S) return;
  const s = S;
  S = null;
  s.dead = true;
  try { if (s.abort) s.abort.abort(); } catch { /* ignore */ }
  if (s.watchId != null) { try { navigator.geolocation.clearWatch(s.watchId); } catch { /* ignore */ } }
  clearTimeout(s.pressTimer);
  clearTimeout(s.noteTimer);
  for (const m of Object.values(s.markers || {})) { try { m.remove(); } catch { /* ignore */ } }
  teardownMap(s);
  if (s.sheet) { try { s.sheet.close(); } catch { /* ignore */ } }
  if (s.onOnline) { window.removeEventListener('online', s.onOnline); window.removeEventListener('offline', s.onOnline); }
}

function teardownMap(s) {
  if (s.map) {
    try { s.map.remove(); } catch { /* ignore */ }
    s.map = null;
  }
  if (s.protocolSet && window.maplibregl) { try { window.maplibregl.removeProtocol('pmtiles'); } catch { /* ignore */ } s.protocolSet = false; }
}

export async function render(container) {
  loadCss('css/map.css');
  loadCss(MAPLIBRE_CSS);
  const settings = await getSettings();
  const layers = {};
  const saved = settings.mapLayers || {};
  for (const d of LAYER_DEFS) {
    // Phase 4 had one "water" switch; if the phone saved that, it decides the three new water switches until they're set
    const old = d.id.startsWith('water') && typeof saved.water === 'boolean' ? saved.water : d.on;
    layers[d.id] = typeof saved[d.id] === 'boolean' ? saved[d.id] : old;
  }
  S = {
    dead: false, map: null, layers, markers: {}, pins: [], data: null, me: null, watchId: null, wantCenter: false,
    abort: null, pressTimer: null, noteTimer: null, suppressClickUntil: 0, sheet: null, mode: null, downloading: false,
    protocolSet: false, index: null, searchBase: null, onFix: null, updateDismissed: false, findFilter: 'all',
  };
  const s = S;
  container.innerHTML = `
    <div class="map-wrap" id="map-wrap">
      <div class="map-canvas" id="map-canvas"></div>
      <div class="map-banner" id="map-banner" hidden></div>
      <div class="map-controls" id="map-controls" hidden>
        <button class="map-btn find" id="btn-find" aria-label="Find water near me">💧<span class="lbl">Find water</span></button>
        <button class="map-btn" id="btn-locate" aria-label="Show my location">📍</button>
        <button class="map-btn" id="btn-layers" aria-label="Choose map layers">🗂️</button>
        <button class="map-btn" id="btn-search" aria-label="Search the map">🔍</button>
        <button class="map-btn stack" id="btn-pin" aria-label="Add a pin">＋<span class="lbl">Pin</span></button>
        <button class="map-btn" id="btn-info" aria-label="Map information">ⓘ</button>
      </div>
      <div class="map-me-note" id="map-note" role="status" hidden></div>
      <div class="map-card" id="map-card"><div class="card"><p class="muted">Loading the map…</p></div></div>
    </div>`;
  s.el = container;
  const $ = (q) => container.querySelector(q);
  s.$ = $;

  const onClick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'btn-find') findWaterSheet();
    else if (b.id === 'btn-locate') locate();
    else if (b.id === 'btn-layers') layersSheet();
    else if (b.id === 'btn-search') searchSheet();
    else if (b.id === 'btn-pin') addPinHere();
    else if (b.id === 'btn-info') infoSheet();
    else if (b.dataset.act === 'download' || b.dataset.act === 'retry') startDownload();
    else if (b.dataset.act === 'cancel' && s.abort) s.abort.abort();
    else if (b.dataset.act === 'later') { s.updateDismissed = true; paintBanner(); }
  };
  container.addEventListener('click', onClick);

  // wait until the router has put this view on the page: MapLibre needs a real size to start
  waitConnected(container).then(() => (s.dead ? null : init()));
  s.onOnline = () => { if (s.dead) return; if (!s.map && !s.downloading) init(); else if (!s.downloading) paintBanner(); };
  window.addEventListener('online', s.onOnline);
}

function waitConnected(el) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => (el.isConnected || ++n > 200 ? resolve() : setTimeout(tick, 15)); // not rAF: it pauses when the page is hidden
    tick();
  });
}

const note = (text, ms = 6000) => {
  if (!S) return;
  const el = S.$('#map-note');
  el.textContent = text; el.hidden = !text;
  clearTimeout(S.noteTimer);
  if (text && ms) S.noteTimer = setTimeout(() => { el.hidden = true; }, ms);
};
const toast = (message) => window.dispatchEvent(new CustomEvent('hb:toast', { detail: { message } }));

// ---------- start-up ----------
async function init() {
  const s = S;
  if (!s || s.dead) return;
  const status = await getMapStatus();
  const online = navigator.onLine !== false;
  let meta = null;
  try { meta = await getJson('data/map/meta.json'); } catch { /* shown later */ }
  if (s.dead) return;
  s.meta = meta;
  s.status = status;
  const card = s.$('#map-card');

  if (!status.downloaded && !online) {
    s.mode = null;
    teardownMap(s);
    card.hidden = false;
    card.innerHTML = `<div class="card"><h2>🗺️ Map</h2><p><b>Map isn't downloaded.</b></p><p class="muted">Connect to download it. It is about ${mapMb(meta)} MB, so use Wi-Fi.</p></div>`;
    s.$('#map-controls').hidden = true;
    s.$('#map-banner').hidden = true;
    return;
  }
  if (s.map) return; // already showing

  // Not downloaded yet: ask for the download instead of streaming tiles. GitHub Pages ignores
  // HTTP Range requests (it answers 200 with the whole 44 MB file), so pmtiles can't stream from it.
  if (!status.downloaded) {
    s.mode = null;
    teardownMap(s);
    card.hidden = false;
    card.innerHTML = `<div class="card"><h2>🗺️ Offline map</h2><p>Download the Henrico, Ashland and Mechanicsville map once (about ${mapMb(meta)} MB, use Wi-Fi). After that it works with no signal, and GPS still shows where you are.</p><p>Tap <b>Download map</b> at the top.</p></div>`;
    s.$('#map-controls').hidden = true;
    paintBanner();
    try { await Promise.all([loadScript(MAPLIBRE_JS), loadScript(PMTILES_JS)]); } catch { /* retried when the download finishes */ }
    return;
  }

  try {
    await Promise.all([loadScript(MAPLIBRE_JS), loadScript(PMTILES_JS)]);
    if (s.dead) return;
    await buildMap(status.downloaded ? 'local' : 'network');
  } catch (err) {
    console.error(err);
    if (s.dead) return;
    card.hidden = false;
    card.innerHTML = `<div class="card"><h2>🗺️ Map</h2><p><b>The map couldn't start.</b></p><p class="muted">${esc(err.message || String(err))}</p><button class="btn" data-act="retry-init" id="retry-init">Try again</button></div>`;
    card.querySelector('#retry-init').onclick = () => init();
  }
}

const mapMb = (meta) => (meta && meta.pmtiles ? fmtNum(meta.pmtiles.bytes / 1e6, 0) : '49');

async function buildMap(mode) {
  const s = S;
  const { maplibregl, pmtiles } = window;
  teardownMap(s);
  s.mode = mode;

  const [style, data] = await Promise.all([getJson('data/map/style.json'), s.data ? Promise.resolve(s.data) : loadOverlays()]);
  if (s.dead) return;
  s.data = data;
  const base = new URL('.', document.baseURI).href;
  style.glyphs = base + style.glyphs; // MapLibre loads these inside a worker, which needs full addresses
  style.sprite = base + style.sprite;

  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tilev4);
  s.protocolSet = true;
  let fileBounds = null; // the area the saved file really covers (an older download covers less than meta.json says)
  if (mode === 'local') {
    const blob = await loadMapBlob();
    if (s.dead) return;
    if (!blob) { s.status = { downloaded: false }; return buildMap(navigator.onLine === false ? 'none' : 'network'); }
    const archive = new pmtiles.PMTiles(new pmtiles.FileSource(new File([blob], 'henrico.pmtiles')));
    protocol.add(archive);
    try {
      const h = await archive.getHeader();
      if ([h.minLon, h.minLat, h.maxLon, h.maxLat].every(Number.isFinite)) fileBounds = [h.minLon, h.minLat, h.maxLon, h.maxLat];
    } catch { /* fall back to meta.json */ }
    if (s.dead) return;
    style.sources.protomaps.url = 'pmtiles://henrico.pmtiles';
  } else if (mode === 'network') {
    style.sources.protomaps.url = `pmtiles://${mapUrl()}`; // range requests straight from the server (online only)
  } else {
    return init();
  }

  const bb = fileBounds || (s.meta && s.meta.bbox) || [-77.85, 37.3, -77.05, 37.92];
  const pad = 0.05;
  s.$('#map-card').hidden = true;
  s.$('#map-controls').hidden = false;
  const map = new maplibregl.Map({
    container: s.$('#map-canvas'),
    style,
    bounds: clampBounds((s.meta && (s.meta.startBounds || s.meta.boundaryBounds)) || bb, bb), // Henrico plus Ashland and Mechanicsville
    fitBoundsOptions: { padding: 24 },
    maxBounds: [[bb[0] - pad, bb[1] - pad], [bb[2] + pad, bb[3] + pad]],
    minZoom: 8, maxZoom: 17.5,
    dragRotate: false, pitchWithRotate: false,
    attributionControl: { compact: false },
    fadeDuration: 0,
  });
  s.map = map;
  map.touchZoomRotate.disableRotation();
  map.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault());
  map.on('error', (e) => { if (e && e.error) console.warn('map error:', e.error.message || e.error); });
  map.on('load', () => { if (!s.dead && s.map === map) onMapLoad(); });

  paintBanner();
  hookLongPress(map);
  map.on('click', (e) => {
    if (Date.now() < s.suppressClickUntil) return;
    const hit = pickFeature(e.point);
    if (!hit) return;
    if (hit.kind === 'water') waterFeatureSheet(hit.feature, hit); else featureSheet(hit);
  });
  map.on('mousemove', (e) => { map.getCanvas().style.cursor = pickFeature(e.point) ? 'pointer' : ''; });
}

const clampBounds = (b, box) => [Math.max(b[0], box[0]), Math.max(b[1], box[1]), Math.min(b[2], box[2]), Math.min(b[3], box[3])];

async function loadOverlays() {
  const names = ['water', 'waterways', 'waterbodies', 'services', 'routes', 'boundary', 'rings'];
  const [meta, local, ...sets] = await Promise.all([
    getJson('data/map/meta.json').catch(() => null),
    getJson('data/local.json').catch(() => null),
    ...names.map((n) => getJson(`data/map/${n}.geojson`)),
  ]);
  const out = { meta, local };
  names.forEach((n, i) => { out[n] = sets[i]; });
  // numeric ids let a tapped line or outline be matched back to its full geometry (not just the piece in the tile)
  for (const n of ['waterways', 'waterbodies']) out[n].features.forEach((f, i) => { f.id = i; });
  return out;
}

// ---------- overlays ----------
function onMapLoad() {
  const s = S;
  const { map, data } = s;
  if (data.meta) s.meta = data.meta;
  const src = (id, fc) => map.addSource(id, { type: 'geojson', data: fc });
  src('boundary', data.boundary); src('rings', data.rings); src('routes', data.routes);
  src('services', data.services); src('water', data.water); src('waterways', data.waterways); src('waterbodies', data.waterbodies);
  map.addSource('me-acc', { type: 'geojson', data: emptyFc() });
  map.addSource('me-dot', { type: 'geojson', data: emptyFc() });

  const font = ['Noto Sans Medium'];
  const halo = { 'text-color': '#ffffff', 'text-halo-color': '#0d1110', 'text-halo-width': 1.6 };
  // Creeks, rivers, lakes: bright blue on the dark basemap, drawn just under the roads (before the first road layer) so roads stay readable.
  const under = map.getLayer('roads_tunnels_other_casing') ? 'roads_tunnels_other_casing' : undefined;
  map.addLayer({ id: 'wb-fill', type: 'fill', source: 'waterbodies', minzoom: 9, paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.35 } }, under);
  map.addLayer({ id: 'wb-line', type: 'line', source: 'waterbodies', minzoom: 9, paint: { 'line-color': '#7dd3fc', 'line-width': 1.5 } }, under);
  const KIND = ['get', 'kind'];
  const dry = ['==', ['get', 'intermittent'], true];
  const lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'ww-river', type: 'line', source: 'waterways', minzoom: 8, filter: ['==', KIND, 'river'], layout: lineLayout,
    paint: { 'line-color': '#38bdf8', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 12, 4, 15, 7] } }, under);
  const streamWidth = ['interpolate', ['linear'], ['zoom'], 10, 1.5, 12, 2.4, 15, 4];
  map.addLayer({ id: 'ww-stream', type: 'line', source: 'waterways', minzoom: 10, filter: ['all', ['!=', KIND, 'river'], ['!', dry]], layout: lineLayout,
    paint: { 'line-color': '#7dd3fc', 'line-width': streamWidth } }, under);
  map.addLayer({ id: 'ww-dry', type: 'line', source: 'waterways', minzoom: 10, filter: ['all', ['!=', KIND, 'river'], dry],
    layout: { 'line-join': 'round' }, paint: { 'line-color': '#7dd3fc', 'line-width': streamWidth, 'line-dasharray': [2, 1.5] } }, under);

  map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#e8efe9', 'line-width': 1.6, 'line-opacity': 0.9, 'line-dasharray': [4, 2] } });
  map.addLayer({ id: 'rings-line', type: 'line', source: 'rings', paint: { 'line-color': '#f472b6', 'line-width': 2, 'line-dasharray': [3, 2] } });
  map.addLayer({
    id: 'rings-label', type: 'symbol', source: 'rings',
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 13, 'symbol-spacing': 400 },
    paint: { ...halo, 'text-color': '#f9a8d4' },
  });
  map.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f5a524', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 10], 'line-opacity': 0.85 } });
  map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2a2a2e', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 5] } });
  map.addLayer({
    id: 'routes-label', type: 'symbol', source: 'routes', minzoom: 9,
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'text-font': font, 'text-size': 13, 'symbol-spacing': 250 },
    paint: { ...halo, 'text-color': '#fde68a' },
  });
  const MAJOR = ['hospital', 'pharmacy', 'fire_station', 'police'];
  const svcCircle = (id, filter, minzoom) => map.addLayer({
    id, type: 'circle', source: 'services', minzoom, filter,
    paint: { 'circle-color': SERVICE_COLORS, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 12, 4.5, 15, 8], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 13, 1.5] },
  });
  svcCircle('services-major', ['in', ['get', 'kind'], ['literal', MAJOR]], 10);
  svcCircle('services-minor', ['!', ['in', ['get', 'kind'], ['literal', MAJOR]]], 12);
  map.addLayer({
    id: 'services-label', type: 'symbol', source: 'services', minzoom: 13,
    layout: { 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': font, 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: halo,
  });
  // names along the creeks, and on the lakes
  const hasName = ['all', ['has', 'name'], ['!=', ['get', 'name'], null]];
  const waterText = { ...halo, 'text-color': '#bae6fd', 'text-halo-width': 1.8 };
  map.addLayer({
    id: 'ww-label', type: 'symbol', source: 'waterways', minzoom: 12, filter: ['all', hasName, ['!=', KIND, 'river']],
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'symbol-spacing': 280, 'text-max-angle': 40 },
    paint: waterText,
  });
  map.addLayer({
    id: 'ww-label-river', type: 'symbol', source: 'waterways', minzoom: 10, filter: ['all', hasName, ['==', KIND, 'river']],
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 13, 'symbol-spacing': 320, 'text-max-angle': 40 },
    paint: waterText,
  });
  map.addLayer({
    id: 'wb-label', type: 'symbol', source: 'waterbodies', minzoom: 12, filter: hasName,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-max-width': 7, 'text-optional': true },
    paint: waterText,
  });
  // a wide invisible line over every creek, so a fingertip can hit it
  map.addLayer({ id: 'ww-hit', type: 'line', source: 'waterways', minzoom: 9, layout: lineLayout, paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 22 } });

  // water points: bigger and brighter than before. Taps and springs are the brightest; ramps and access points a deeper blue.
  const TAPPY = ['spring', 'tap', 'drinking_water', 'water_point'];
  map.addLayer({
    id: 'water-circle', type: 'circle', source: 'water', filter: ['!=', KIND, 'lake'],
    paint: {
      'circle-color': ['case', ['in', KIND, ['literal', TAPPY]], '#67e8f9', '#0ea5e9'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 7, 15, 10],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 13, 2.5],
    },
  });
  map.addLayer({
    id: 'water-label', type: 'symbol', source: 'water', minzoom: 12, filter: ['!=', KIND, 'lake'],
    layout: { 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': font, 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
    paint: { ...halo, 'text-color': '#bae6fd' },
  });
  map.addLayer({ id: 'me-acc-fill', type: 'fill', source: 'me-acc', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.18 } });
  map.addLayer({ id: 'me-acc-line', type: 'line', source: 'me-acc', paint: { 'line-color': '#60a5fa', 'line-width': 1 } });
  map.addLayer({ id: 'me-dot', type: 'circle', source: 'me-dot', paint: { 'circle-color': '#3b82f6', 'circle-radius': 8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });

  applyLayerVisibility();
  if (s.me) paintMe();
  loadPins();
}

const emptyFc = () => ({ type: 'FeatureCollection', features: [] });

function applyLayerVisibility() {
  const s = S;
  for (const d of LAYER_DEFS) {
    for (const id of d.layers) if (s.map.getLayer(id)) s.map.setLayoutProperty(id, 'visibility', s.layers[d.id] ? 'visible' : 'none');
  }
  // The basemap has its own (fainter) creek names; ours replace them while our creek layer is on, so names are not drawn twice
  if (s.map.getLayer('water_waterway_label')) s.map.setLayoutProperty('water_waterway_label', 'visibility', s.layers.waterways ? 'none' : 'visible');
  for (const m of Object.values(s.markers)) m.getElement().style.display = s.layers.pins ? '' : 'none';
}

const TAP_LAYERS = ['water-circle', 'services-major', 'services-minor'];
// What did the finger land on? Points first (water, then services), then a creek or river line, then a lake or pond outline.
// -> { kind: 'point', props, lat, lon } | { kind: 'water', feature, lat, lon } | null     (lat/lon: where the finger is, or the point itself)
function pickFeature(point) {
  const s = S;
  if (!s || !s.map || !s.map.getLayer('water-circle')) return null;
  const r = 14;
  const box = [[point.x - r, point.y - r], [point.x + r, point.y + r]];
  const live = TAP_LAYERS.filter((id) => s.map.getLayer(id) && s.map.getLayoutProperty(id, 'visibility') !== 'none');
  const c = s.map.unproject(point);
  if (live.length) {
    const feats = s.map.queryRenderedFeatures(box, { layers: live });
    if (feats.length) {
      // water first, then closest to the finger
      feats.sort((a, b) => {
        const wa = a.layer.id.startsWith('water') ? 0 : 1; const wb = b.layer.id.startsWith('water') ? 0 : 1;
        if (wa !== wb) return wa - wb;
        return dist2(a, c) - dist2(b, c);
      });
      const f = feats[0];
      const [lon, lat] = f.geometry.coordinates;
      return { kind: 'point', props: { ...f.properties }, lat, lon, layer: f.layer.id };
    }
  }
  const visible = (id) => s.map.getLayer(id) && s.map.getLayoutProperty(id, 'visibility') !== 'none';
  const full = (src, f) => (f.id !== undefined && s.data[src].features[f.id]) || { type: 'Feature', properties: f.properties, geometry: f.geometry };
  if (visible('ww-hit')) {
    const hits = s.map.queryRenderedFeatures(box, { layers: ['ww-hit'] });
    if (hits.length) {
      // the line closest to the finger wins; rivers lose ties to creeks only because they are wider anyway
      let best = null;
      for (const h of hits) {
        const d = nearestOnGeometry(h.geometry, c.lat, c.lng);
        if (d && (!best || d.meters < best.d)) best = { f: h, d: d.meters };
      }
      return { kind: 'water', feature: full('waterways', best.f), lat: c.lat, lon: c.lng };
    }
  }
  if (visible('wb-fill')) {
    const hits = s.map.queryRenderedFeatures(box, { layers: ['wb-fill'] });
    if (hits.length) return { kind: 'water', feature: full('waterbodies', hits[0]), lat: c.lat, lon: c.lng };
  }
  return null;
}
const dist2 = (f, c) => (f.geometry.coordinates[0] - c.lng) ** 2 + (f.geometry.coordinates[1] - c.lat) ** 2;

// ---------- long press makes a pin ----------
function hookLongPress(map) {
  const s = S;
  let start = null;
  const cancel = () => { clearTimeout(s.pressTimer); s.pressTimer = null; start = null; };
  const down = (e) => {
    if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length > 1) { cancel(); return; }
    if (e.originalEvent && e.originalEvent.button > 0) return;
    start = { x: e.point.x, y: e.point.y };
    const at = e.lngLat;
    clearTimeout(s.pressTimer);
    s.pressTimer = setTimeout(() => {
      if (!start) return;
      s.pressTimer = null;
      s.suppressClickUntil = Date.now() + 600;
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch { /* ignore */ } }
      start = null;
      pinForm({ lat: at.lat, lon: at.lng });
    }, 500);
  };
  const move = (e) => { if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 8) cancel(); };
  map.on('mousedown', down); map.on('touchstart', down);
  map.on('mousemove', move); map.on('touchmove', move);
  for (const ev of ['mouseup', 'touchend', 'touchcancel', 'dragstart', 'zoomstart', 'movestart']) map.on(ev, cancel);
}

// ---------- download banner ----------
function paintBanner(progress) {
  const s = S;
  const el = s.$('#map-banner');
  if (!el) return;
  const mb = mapMb(s.meta);
  if (s.mode === 'local' && !s.downloading && !s.dlError) {
    // A map is saved. If meta.json says the real file has a different size, the phone has an older, smaller map: keep it, offer the new one.
    if (s.status && s.status.outdated && !s.updateDismissed && navigator.onLine !== false) {
      el.hidden = false; el.className = 'map-banner';
      el.innerHTML = `<b>Map update available (${mb} MB)</b><span class="small">Bigger area and creeks. Download on Wi-Fi. Your current map keeps working until the new one is saved.</span>
        <button class="btn small primary" data-act="download">Update map (${mb} MB)</button><button class="btn small" data-act="later">Not now</button>`;
    } else {
      el.hidden = true;
    }
    return;
  }
  el.hidden = false;
  const what = s.status && s.status.downloaded ? 'Updating the map…' : 'Downloading the map…';
  if (s.downloading) {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    el.className = 'map-banner';
    el.innerHTML = `<b>${what}</b>
      <div class="map-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <span class="small muted" id="dl-text">${progress ? `${fmtNum(progress.done / 1e6, 1)} of ${fmtNum((progress.total || 0) / 1e6, 1)} MB (${pct}%)` : 'Starting…'}</span>
      <button class="btn small" data-act="cancel">Cancel</button>`;
    return;
  }
  if (s.dlError) {
    el.className = 'map-banner err';
    el.innerHTML = `<b>Map not saved</b><span class="small">${esc(s.dlError)}</span><button class="btn small" data-act="retry">Retry</button>`;
    return;
  }
  el.className = 'map-banner';
  el.innerHTML = `<b>Not saved for offline yet.</b><span class="small muted">Download the offline map (${mb} MB). Do this on Wi-Fi.</span><button class="btn small primary" data-act="download">Download map (${mb} MB)</button>`;
}

async function startDownload() {
  const s = S;
  if (!s || s.downloading) return;
  s.downloading = true; s.dlError = null;
  s.abort = new AbortController();
  paintBanner();
  let lastPaint = 0;
  try {
    await downloadMap((done, total) => {
      const now = performance.now();
      if (now - lastPaint < 120 && done !== total) return;
      lastPaint = now;
      if (S === s) paintBanner({ done, total });
    }, s.abort.signal);
    if (s.dead) return;
    s.downloading = false;
    toast('Map saved for offline use');
    s.status = await getMapStatus();
    await Promise.all([loadScript(MAPLIBRE_JS), loadScript(PMTILES_JS)]);
    if (s.dead) return;
    await buildMap('local');
  } catch (err) {
    if (s.dead) return;
    s.downloading = false;
    s.dlError = err instanceof MapDownloadError && err.code === 'aborted' ? null : (err.message || 'Something went wrong.');
    paintBanner();
  }
}

// ---------- GPS ----------
function locate() {
  const s = S;
  if (!s.map) return;
  if (!navigator.geolocation) { note('This phone has no location sensor the browser can use.'); return; }
  if (s.watchId != null) {
    if (s.me) s.map.flyTo({ center: [s.me.lon, s.me.lat], zoom: Math.max(s.map.getZoom(), 14) });
    else note('Still looking for a GPS signal… go outside or near a window.');
    return;
  }
  s.wantCenter = true;
  startWatch();
}
function startWatch() {
  const s = S;
  if (s.watchId != null || !navigator.geolocation) return;
  note('Looking for a GPS signal…', 8000);
  s.$('#btn-locate').classList.add('on');
  s.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function onPosition(pos) {
  const s = S;
  if (!s || !s.map) return;
  s.me = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy || 0 };
  paintMe();
  if (s.onFix) s.onFix();
  if (s.wantCenter) {
    s.wantCenter = false;
    s.map.flyTo({ center: [s.me.lon, s.me.lat], zoom: Math.max(s.map.getZoom(), 14) });
    note(`GPS found (accurate to about ${Math.round(s.me.accuracy * 3.28084)} ft).`, 3500);
  }
}
function onPositionError(err) {
  const s = S;
  if (!s) return;
  if (err.code === 1) {
    if (s.watchId != null) navigator.geolocation.clearWatch(s.watchId);
    s.watchId = null;
    s.$('#btn-locate').classList.remove('on');
    note('Location is turned off for Home Base. Allow location in your phone\'s settings (Settings, then Privacy, then Location Services), then tap 📍 again.', 12000);
  } else if (err.code === 2) {
    note('No GPS position yet. Try near a window or outside.', 6000);
  } else {
    note('Still waiting for a GPS signal…', 4000);
  }
}
function paintMe() {
  const s = S;
  if (!s.map || !s.map.getSource('me-dot')) return;
  s.map.getSource('me-dot').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [s.me.lon, s.me.lat] } }] });
  s.map.getSource('me-acc').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleRing(s.me, Math.max(s.me.accuracy, 3))] } }] });
}
const fromMe = (lat, lon) => distanceFrom(S && S.me, { lat, lon });

// ---------- sheets ----------
function showSheet(html, opts) {
  const s = S;
  if (s.sheet) { try { s.sheet.close(); } catch { /* ignore */ } }
  const sheet = openSheet(`<div class="map-sheet">${html}</div>`, { ...opts, onClose: () => { if (S && S.sheet === sheet) S.sheet = null; if (opts && opts.onClose) opts.onClose(); } });
  s.sheet = sheet;
  return sheet;
}

function featureSheet(hit) {
  const p = hit.props;
  const title = featureTitle(p);
  const isWater = WATER_KINDS.includes(p.kind);
  const advice = isWater ? waterAdvice(p.kind, p) : null;
  const rows = [];
  rows.push(['From you', esc(fromMe(hit.lat, hit.lon))]);
  if (p.opening_hours) rows.push(['Hours', esc(p.opening_hours)]);
  const tel = telHref(p.phone);
  if (p.phone) rows.push(['Phone', tel ? `<a href="${esc(tel)}">${esc(p.phone)}</a>` : esc(p.phone)]);
  const addr = formatAddress(p);
  if (addr) rows.push(['Address', esc(addr)]);
  if (p.operator) rows.push(['Operator', esc(p.operator)]);
  if (p.access) rows.push(['Access', esc(p.access)]);
  if (p.fee) rows.push(['Fee', esc(p.fee)]);
  if (p.seasonal) rows.push(['Seasonal', esc(p.seasonal)]);
  if (p.waterbody) rows.push(['Water body', esc(p.waterbody)]);
  if (p.areaAcres) rows.push(['Size', `about ${esc(fmtNum(Number(p.areaAcres), 1))} acres`]);
  const kindLabel = KIND_LABELS[p.kind] || p.kind;
  const html = `
    <h2>${esc(title)}</h2>
    <p class="muted" style="margin:0">${esc(kindLabel)}${advice ? ` · <span class="safety ${advice.safety}">${esc(SAFETY_LABELS[advice.safety])}</span>` : ''}</p>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    ${advice ? `<p class="advice">${esc(advice.text)}</p>
      <p><a class="btn" href="#/guide/${esc(advice.guide)}" data-sheet="close">How to treat water →</a></p>` : ''}
    ${p.note ? `<p class="small muted">${esc(p.note)}</p>` : ''}
    ${isWater ? `<div class="callout disclaimer" role="note"><b class="callout-label">Check before you rely on it</b>${esc(DISCLAIMER)}</div>` : ''}
    <div class="btn-row"><button class="btn primary" data-sheet="pin">Save as pin</button><button class="btn" data-sheet="close">Close</button></div>`;
  showSheet(html, {
    onAction(name, close) {
      if (name !== 'pin') return;
      close();
      pinForm({ lat: hit.lat, lon: hit.lon, name: title, type: isWater ? 'water' : 'other' });
    },
  });
}

// A creek, river, canal or lake/pond/reservoir outline. `tap` is where the finger landed ({lat, lon}), or null.
function waterFeatureSheet(feature, tap) {
  const s = S;
  const p = feature.properties;
  const title = featureTitle(p);
  const advice = waterAdvice(p.kind, p);
  const isLine = WATERWAY_KINDS.includes(p.kind);
  const near = s.me ? nearestOnGeometry(feature.geometry, s.me.lat, s.me.lon) : null;
  const ref = s.me || tap || s.map.getCenter();
  const refPt = { lat: ref.lat, lon: ref.lon !== undefined ? ref.lon : ref.lng };
  const access = isLine && p.name ? nearestAccessPoint(s.data.water.features, p.name, refPt.lat, refPt.lon) : null;
  const rows = [];
  rows.push(['Closest point to you', near ? `<b>${esc(formatDistance(near.meters))} ${esc(compassPoint(bearingDegrees(s.me, near)))}</b> <button class="link" data-sheet="near">Show on map</button>` : '—']);
  if (access) {
    const an = featureTitle(access.props);
    rows.push(['Nearest access', `${esc(an)}<br><span class="muted">${esc(distanceFrom(s.me || refPt, access))}${s.me ? '' : ' from where you tapped'}</span> <button class="link" data-sheet="access">Go there</button>`]);
  } else if (isLine && p.name) {
    rows.push(['Nearest access', '<span class="muted">No ramp or access point on file for this one.</span>']);
  }
  if (p.areaAcres) rows.push(['Size', `about ${esc(fmtNum(Number(p.areaAcres), 1))} acres`]);
  if (p.access) rows.push(['Access', esc(p.access)]);
  const html = `
    <h2>${esc(WATER_ICONS[p.kind] || '💧')} ${esc(title)}</h2>
    <p class="muted" style="margin:0">${esc(KIND_LABELS[p.kind] || p.kind)} · <span class="safety ${advice.safety}">${esc(SAFETY_LABELS[advice.safety])}</span></p>
    ${p.intermittent ? '<p class="seasonal" role="note">⚠ Seasonal — may be dry</p>' : ''}
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    <p class="advice">${esc(advice.text)}</p>
    <p><a class="btn" href="#/guide/${esc(advice.guide)}" data-sheet="close">How to treat water →</a></p>
    <div class="callout disclaimer" role="note"><b class="callout-label">Check before you rely on it</b>${esc(DISCLAIMER)}</div>
    <div class="btn-row"><button class="btn primary" data-sheet="pin">Save as pin</button><button class="btn" data-sheet="close">Close</button></div>`;
  showSheet(html, {
    onAction(name, close) {
      if (name === 'near' && near) { close(); s.map.flyTo({ center: [near.lon, near.lat], zoom: Math.max(s.map.getZoom(), 15) }); }
      else if (name === 'access' && access) {
        close();
        s.map.flyTo({ center: [access.lon, access.lat], zoom: Math.max(s.map.getZoom(), 15) });
        featureSheet({ props: access.props, lat: access.lat, lon: access.lon });
      } else if (name === 'pin') {
        close();
        const snap = tap ? nearestOnGeometry(feature.geometry, tap.lat, tap.lon) : nearestOnGeometry(feature.geometry, refPt.lat, refPt.lon);
        pinForm({ lat: snap ? snap.lat : refPt.lat, lon: snap ? snap.lon : refPt.lon, name: title, type: 'water' });
      }
    },
  });
}

// ---------- Find water ----------
// Every water feature in one list, built once (the distance scan over it is fast enough for thousands of features).
function waterIndex() {
  const s = S;
  if (!s.index) s.index = [...s.data.water.features, ...s.data.waterways.features, ...s.data.waterbodies.features];
  return s.index;
}

function findWaterSheet() {
  const s = S;
  if (!s.data || !s.map) return;
  if (s.watchId == null) startWatch(); // quietly ask for GPS; the list re-sorts when a fix arrives
  let rows = [];
  const html = `<h2>💧 Find water</h2>
    <p class="small muted" id="fw-origin"></p>
    <div class="chips" role="group" aria-label="What kind of water">${WATER_FILTERS.map((f) => `<button class="chip" data-sheet="chip:${f.id}" data-chip="${f.id}">${esc(f.label)}</button>`).join('')}</div>
    <ul class="search-results" id="fw-list"></ul>
    <div class="callout disclaimer" role="note"><b class="callout-label">Treat all outdoor water</b>${esc(DISCLAIMER)}</div>
    <div class="btn-row"><button class="btn" data-sheet="close">Close</button></div>`;
  const sheet = showSheet(html, {
    onAction(name, close) {
      if (name.startsWith('chip:')) { s.findFilter = name.slice(5); paint(); return; }
      if (!name.startsWith('go:')) return;
      const r = rows[Number(name.slice(3))];
      if (!r) return;
      close();
      s.map.flyTo({ center: [r.lon, r.lat], zoom: 15 });
      if (r.group === 'point') featureSheet({ props: r.props, lat: r.lat, lon: r.lon });
      else waterFeatureSheet({ type: 'Feature', properties: r.props, geometry: r.geometry }, { lat: r.lat, lon: r.lon });
    },
    onClose: () => { if (S === s && s.onFix === paint) s.onFix = null; },
  });
  function paint() {
    if (S !== s || !sheet.el.isConnected) return;
    const c = s.map.getCenter();
    const origin = s.me ? { lat: s.me.lat, lon: s.me.lon } : { lat: c.lat, lon: c.lng };
    sheet.el.querySelector('#fw-origin').textContent = s.me ? 'From your GPS position. Nearest first.' : 'From map center (no GPS fix). Nearest first.';
    for (const b of sheet.el.querySelectorAll('[data-chip]')) { b.classList.toggle('on', b.dataset.chip === s.findFilter); b.setAttribute('aria-pressed', String(b.dataset.chip === s.findFilter)); }
    rows = rankWaterSources(waterIndex(), origin.lat, origin.lon, s.findFilter, 15);
    sheet.el.querySelector('#fw-list').innerHTML = rows.length
      ? rows.map((r, i) => {
        const tag = r.safest ? '<span class="tag tap" title="A public tap is the best tier here, but only while the water system works and no boil advisory is in effect.">safest</span>' : (r.tier === 'avoid' ? '<span class="tag avoid">avoid</span>' : '');
        return `<li><button data-sheet="go:${i}"><span class="emoji">${WATER_ICONS[r.kind] || '💧'}</span><span class="grow"><span class="t">${esc(r.title)}</span><span class="s">${esc(KIND_LABELS[r.kind] || r.kind)}${r.intermittent ? ' · may be dry' : ''} · ${esc(r.away)}</span></span>${tag}</button></li>`;
      }).join('')
      : '<li class="muted small" style="padding:10px 2px">Nothing in this group nearby.</li>';
  }
  s.onFix = paint;
  paint();
}

function pinForm({ pin, lat, lon, name = '', type = 'other', notes = '' }) {
  const editing = !!pin;
  const cur = pin || { name, type, notes };
  const html = `
    <h2>${editing ? 'Edit pin' : 'New pin'}</h2>
    <label class="field"><span>Name</span><input type="text" id="pin-name" maxlength="80" value="${esc(cur.name)}" placeholder="e.g. Rally point at the park" autocomplete="off"></label>
    <label class="field"><span>Type</span><select id="pin-type">${PIN_TYPES.map((t) => `<option value="${t.id}"${t.id === cur.type ? ' selected' : ''}>${t.emoji} ${esc(t.label)}</option>`).join('')}</select></label>
    <label class="field"><span>Notes</span><textarea id="pin-notes" rows="3" maxlength="500">${esc(cur.notes || '')}</textarea></label>
    <p class="small muted">${lat.toFixed(5)}, ${lon.toFixed(5)}</p>
    <div class="btn-row"><button class="btn primary" data-sheet="save">Save pin</button><button class="btn" data-sheet="close">Cancel</button>${editing ? '<button class="btn danger" data-sheet="delete">Delete</button>' : ''}</div>`;
  const sheet = showSheet(html, {
    async onAction(action, close) {
      if (action === 'delete') {
        if (!confirm('Delete this pin?')) return;
        await del('pins', pin.id);
        close(); toast('Pin deleted'); await loadPins();
        return;
      }
      if (action !== 'save') return;
      const typeVal = sheet.el.querySelector('#pin-type').value;
      const nm = sheet.el.querySelector('#pin-name').value.trim() || (PIN_TYPES.find((t) => t.id === typeVal) || PIN_TYPES[5]).label;
      const rec = { ...(pin || { id: newId(), createdAt: new Date().toISOString() }), name: nm, type: typeVal, lat, lon, notes: sheet.el.querySelector('#pin-notes').value.trim() };
      await put('pins', rec);
      close(); toast(editing ? 'Pin updated' : 'Pin saved'); await loadPins();
    },
  });
}

function pinSheet(pin) {
  const t = PIN_TYPES.find((x) => x.id === pin.type) || PIN_TYPES[5];
  const html = `
    <h2>${t.emoji} ${esc(pin.name)}</h2>
    <p class="muted" style="margin:0">${esc(t.label)} · My pin</p>
    <dl class="kv"><dt>From you</dt><dd>${esc(fromMe(pin.lat, pin.lon))}</dd>
      ${pin.notes ? `<dt>Notes</dt><dd class="prewrap">${esc(pin.notes)}</dd>` : ''}
      <dt>Location</dt><dd>${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}</dd></dl>
    <div class="btn-row"><button class="btn primary" data-sheet="edit">Edit</button><button class="btn danger" data-sheet="delete">Delete</button><button class="btn" data-sheet="close">Close</button></div>`;
  showSheet(html, {
    async onAction(action, close) {
      if (action === 'edit') { close(); pinForm({ pin, lat: pin.lat, lon: pin.lon }); }
      else if (action === 'delete') {
        if (!confirm('Delete this pin?')) return;
        await del('pins', pin.id); close(); toast('Pin deleted'); await loadPins();
      }
    },
  });
}

function addPinHere() {
  const s = S;
  if (!s.map) return;
  const pt = s.me ? { lat: s.me.lat, lon: s.me.lon } : { lat: s.map.getCenter().lat, lon: s.map.getCenter().lng };
  if (!s.me) note('No GPS fix, so the pin starts at the center of the map.', 4000);
  pinForm(pt);
}

function layersSheet() {
  const s = S;
  const html = `<h2>Layers</h2>
    ${LAYER_DEFS.map((d) => `<label class="layer-row"><input type="checkbox" data-layer="${d.id}"${s.layers[d.id] ? ' checked' : ''}><span class="sw" style="background:${d.color}"></span><span>${esc(d.label)}</span></label>`).join('')}
    <div class="legend" aria-label="Map key">
      <span class="lg"><i class="lg-line"></i>Flowing year-round</span>
      <span class="lg"><i class="lg-line dash"></i>May be dry</span>
      <span class="lg"><i class="lg-fill"></i>Lake or pond</span>
      <span class="lg"><i class="lg-dot tap"></i>Tap or spring</span>
      <span class="lg"><i class="lg-dot ramp"></i>Ramp or access point</span>
    </div>
    <div class="btn-row"><button class="btn" data-sheet="close">Done</button></div>`;
  const sheet = showSheet(html, {});
  sheet.el.addEventListener('change', async (e) => {
    const id = e.target.dataset && e.target.dataset.layer;
    if (!id || !S) return;
    S.layers[id] = e.target.checked;
    applyLayerVisibility();
    await saveSettings({ mapLayers: { ...S.layers } });
  });
}

function searchItems() {
  const s = S;
  if (!s.searchBase) {
    const items = [];
    for (const f of [...s.data.water.features, ...s.data.services.features]) {
      if (!f.properties.name || f.properties.kind === 'lake') continue; // lakes come from their outlines below
      items.push({ name: f.properties.name, kind: f.properties.kind, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], props: f.properties });
    }
    for (const f of s.data.waterbodies.features) {
      const p = f.properties;
      if (p.name) items.push({ name: p.name, kind: p.kind, lat: p.c[1], lon: p.c[0], feature: f });
    }
    const seen = new Set(); // one entry per creek name: the middle of its first piece
    for (const f of s.data.waterways.features) {
      const p = f.properties;
      const key = `${p.kind === 'river' ? 'r' : 'c'}|${p.name}`;
      if (!p.name || seen.has(key)) continue;
      seen.add(key);
      const line = f.geometry.coordinates;
      const mid = line[Math.floor(line.length / 2)];
      items.push({ name: p.name, kind: p.kind, lat: mid[1], lon: mid[0], feature: f });
    }
    s.searchBase = items;
  }
  const items = s.searchBase.slice();
  for (const p of s.pins) items.push({ name: p.name, kind: 'pin', lat: p.lat, lon: p.lon, pin: p });
  return items;
}

function searchSheet() {
  const s = S;
  if (!s.data) return;
  const items = searchItems();
  let results = [];
  const html = `<h2>Search the map</h2>
    <label class="field"><span>Name or type (spring, pharmacy, a pin…)</span><input type="search" id="map-q" autocomplete="off" autocapitalize="none"></label>
    <ul class="search-results" id="map-results"></ul>
    <div class="btn-row"><button class="btn" data-sheet="close">Close</button></div>`;
  const sheet = showSheet(html, {
    onAction(name, close) {
      if (!name.startsWith('go:')) return;
      const it = results[Number(name.slice(3))];
      if (!it) return;
      close();
      s.map.flyTo({ center: [it.lon, it.lat], zoom: 15 });
      if (it.pin) pinSheet(it.pin);
      else if (it.feature) waterFeatureSheet(it.feature, { lat: it.lat, lon: it.lon });
      else featureSheet({ props: it.props, lat: it.lat, lon: it.lon });
    },
  });
  const input = sheet.el.querySelector('#map-q');
  const list = sheet.el.querySelector('#map-results');
  input.addEventListener('input', () => {
    results = searchFeatures(items, input.value, 20);
    list.innerHTML = results.length
      ? results.map((it, i) => `<li><button data-sheet="go:${i}"><span class="emoji">${it.pin ? pinEmoji(it.pin.type) : (WATER_ICONS[it.kind] || '📍')}</span><span class="grow"><span class="t">${esc(it.name)}</span><span class="s">${esc(it.pin ? 'My pin' : (KIND_LABELS[it.kind] || it.kind))} · ${esc(fromMe(it.lat, it.lon))}</span></span></button></li>`).join('')
      : (input.value.trim() ? '<li class="muted small" style="padding:10px 2px">Nothing found.</li>' : '');
  });
}

function infoSheet() {
  const s = S;
  const meta = s.meta || {};
  const shelters = (s.data && s.data.local && s.data.local.shelters) || [];
  const pm = meta.pmtiles;
  const em = ((s.data && s.data.local && s.data.local.emergencyContacts) || []).find((c) => /Emergency Management/i.test(c.name) && c.phone); // phone comes from data/local.json, never typed here
  const html = `<h2>About this map</h2>
    <dl class="kv">
      <dt>Roads and labels</dt><dd>${pm ? `Protomaps build of ${esc(fmtDate(pm.buildDate))}` : '—'}</dd>
      <dt>Water, creeks, services, routes</dt><dd>OpenStreetMap, fetched ${esc(meta.fetchedAt ? fmtDate(meta.fetchedAt.slice(0, 10)) : '—')}</dd>
      <dt>Saved on this phone</dt><dd>${s.status && s.status.downloaded ? `Yes (${fmtNum((s.status.size || 0) / 1e6, 1)} MB${s.status.savedAt ? `, ${esc(fmtDate(s.status.savedAt.slice(0, 10)))}` : ''})` : 'No. Download it from the map screen.'}</dd>
    </dl>
    <p class="small muted">© OpenStreetMap contributors · Protomaps. Data under the ODbL licence.</p>
    <h3>Shelters</h3>
    <p class="small">Henrico hasn't published a current shelter list; listen to local alerts.${em ? ` Call ${esc(em.name)} at <a href="${esc(telHref(em.phone) || '#')}">${esc(em.phone)}</a>, or 211.` : ' Call 211.'} These places have no map position because the sources give no address:</p>
    <ul class="small">${shelters.map((x) => `<li><b>${esc(x.name)}</b>. ${esc(x.address || '')} <span class="muted">${esc(x.notes || '')}</span></li>`).join('')}</ul>
    <div class="callout disclaimer" role="note"><b class="callout-label">Read this</b>${esc(DISCLAIMER)}</div>
    <div class="btn-row"><button class="btn" data-sheet="close">Close</button></div>`;
  showSheet(html, {});
}

// ---------- pins on the map ----------
async function loadPins() {
  const s = S;
  if (!s) return;
  const pins = await getAll('pins');
  if (S !== s || s.dead || !s.map) return;
  s.pins = pins;
  for (const m of Object.values(s.markers)) m.remove();
  s.markers = {};
  for (const p of pins) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const el = document.createElement('button');
    el.className = 'pin-marker';
    el.type = 'button';
    el.setAttribute('aria-label', `Pin: ${p.name}`);
    el.textContent = pinEmoji(p.type);
    el.addEventListener('click', (e) => { e.stopPropagation(); pinSheet(p); });
    s.markers[p.id] = new window.maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(s.map);
  }
  applyLayerVisibility();
}
