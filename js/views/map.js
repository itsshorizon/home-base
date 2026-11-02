// Offline Henrico map (#/map). MapLibre GL draws the Protomaps vector tiles from a .pmtiles file that was
// saved to this phone (see js/mapcache.js). Overlays (water, services, routes...) are small GeoJSON files.
// Everything is loaded the first time this tab opens, not at app start.
import { getAll, put, del, newId, getSettings, saveSettings } from '../db.js';
import { openSheet } from '../sheet.js';
import { esc, fmtDate, fmtNum } from '../format.js';
import {
  waterAdvice, SAFETY_LABELS, KIND_LABELS, WATER_KINDS, PIN_TYPES, pinEmoji, featureTitle, formatAddress, telHref,
  distanceFrom, searchFeatures, circleRing,
} from '../mapinfo.js';
import { getMapStatus, loadMapBlob, downloadMap, mapUrl, MapDownloadError } from '../mapcache.js';

const VENDOR = 'vendor/map/';
const MAPLIBRE_JS = `${VENDOR}maplibre-gl-4.7.1.js`;
const MAPLIBRE_CSS = `${VENDOR}maplibre-gl-4.7.1.css`;
const PMTILES_JS = `${VENDOR}pmtiles-3.2.1.js`;
const DISCLAIMER = 'Map data may be out of date. Water sources must always be treated. Routes out are major roads, not official evacuation routes.';

const LAYER_DEFS = [
  { id: 'water', label: 'Water sources', color: '#38bdf8', on: true, layers: ['water-circle', 'water-lake', 'water-label'] },
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
  for (const d of LAYER_DEFS) layers[d.id] = settings.mapLayers && typeof settings.mapLayers[d.id] === 'boolean' ? settings.mapLayers[d.id] : d.on;
  S = {
    dead: false, map: null, layers, markers: {}, pins: [], data: null, me: null, watchId: null, wantCenter: false,
    abort: null, pressTimer: null, noteTimer: null, suppressClickUntil: 0, sheet: null, mode: null, downloading: false,
    protocolSet: false,
  };
  const s = S;
  container.innerHTML = `
    <div class="map-wrap" id="map-wrap">
      <div class="map-canvas" id="map-canvas"></div>
      <div class="map-banner" id="map-banner" hidden></div>
      <div class="map-controls" id="map-controls" hidden>
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
    if (b.id === 'btn-locate') locate();
    else if (b.id === 'btn-layers') layersSheet();
    else if (b.id === 'btn-search') searchSheet();
    else if (b.id === 'btn-pin') addPinHere();
    else if (b.id === 'btn-info') infoSheet();
    else if (b.dataset.act === 'download' || b.dataset.act === 'retry') startDownload();
    else if (b.dataset.act === 'cancel' && s.abort) s.abort.abort();
  };
  container.addEventListener('click', onClick);

  // wait until the router has put this view on the page: MapLibre needs a real size to start
  waitConnected(container).then(() => (s.dead ? null : init()));
  s.onOnline = () => { if (!s.dead && !s.map && !s.downloading) init(); };
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
    card.innerHTML = `<div class="card"><h2>🗺️ Offline map</h2><p>Download the Henrico map once (about ${mapMb(meta)} MB, use Wi-Fi). After that it works with no signal, and GPS still shows where you are.</p><p>Tap <b>Download map</b> at the top.</p></div>`;
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

const mapMb = (meta) => (meta && meta.pmtiles ? fmtNum(meta.pmtiles.bytes / 1e6, 0) : '44');

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
  if (mode === 'local') {
    const blob = await loadMapBlob();
    if (s.dead) return;
    if (!blob) { s.status = { downloaded: false }; return buildMap(navigator.onLine === false ? 'none' : 'network'); }
    protocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(new File([blob], 'henrico.pmtiles'))));
    style.sources.protomaps.url = 'pmtiles://henrico.pmtiles';
  } else if (mode === 'network') {
    style.sources.protomaps.url = `pmtiles://${mapUrl()}`; // range requests straight from the server (online only)
  } else {
    return init();
  }

  const bb = (s.meta && s.meta.bbox) || [-77.8, 37.33, -77.1, 37.82];
  const pad = 0.05;
  s.$('#map-card').hidden = true;
  s.$('#map-controls').hidden = false;
  const map = new maplibregl.Map({
    container: s.$('#map-canvas'),
    style,
    bounds: (s.meta && s.meta.boundaryBounds) || bb,
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
    if (hit) featureSheet(hit);
  });
  map.on('mousemove', (e) => { map.getCanvas().style.cursor = pickFeature(e.point) ? 'pointer' : ''; });
}

async function loadOverlays() {
  const names = ['water', 'services', 'routes', 'boundary', 'rings'];
  const [meta, local, ...sets] = await Promise.all([
    getJson('data/map/meta.json').catch(() => null),
    getJson('data/local.json').catch(() => null),
    ...names.map((n) => getJson(`data/map/${n}.geojson`)),
  ]);
  const out = { meta, local };
  names.forEach((n, i) => { out[n] = sets[i]; });
  return out;
}

// ---------- overlays ----------
function onMapLoad() {
  const s = S;
  const { map, data } = s;
  if (data.meta) s.meta = data.meta;
  const src = (id, fc) => map.addSource(id, { type: 'geojson', data: fc });
  src('boundary', data.boundary); src('rings', data.rings); src('routes', data.routes);
  src('services', data.services); src('water', data.water);
  map.addSource('me-acc', { type: 'geojson', data: emptyFc() });
  map.addSource('me-dot', { type: 'geojson', data: emptyFc() });

  const font = ['Noto Sans Medium'];
  const halo = { 'text-color': '#ffffff', 'text-halo-color': '#0d1110', 'text-halo-width': 1.6 };
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
  const waterPaint = { 'circle-color': '#38bdf8', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 12, 5.5, 15, 9], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 13, 2] };
  map.addLayer({ id: 'water-circle', type: 'circle', source: 'water', filter: ['!=', ['get', 'kind'], 'lake'], paint: waterPaint });
  map.addLayer({ id: 'water-lake', type: 'circle', source: 'water', minzoom: 11, filter: ['==', ['get', 'kind'], 'lake'], paint: { ...waterPaint, 'circle-color': '#0ea5e9' } });
  map.addLayer({
    id: 'water-label', type: 'symbol', source: 'water', minzoom: 12,
    layout: { 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': font, 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
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
  for (const m of Object.values(s.markers)) m.getElement().style.display = s.layers.pins ? '' : 'none';
}

const TAP_LAYERS = ['water-circle', 'water-lake', 'services-major', 'services-minor'];
function pickFeature(point) {
  const s = S;
  if (!s || !s.map || !s.map.getLayer('water-circle')) return null;
  const r = 14;
  const live = TAP_LAYERS.filter((id) => s.map.getLayer(id));
  const feats = s.map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers: live });
  if (!feats.length) return null;
  // water first, then closest to the finger
  const c = s.map.unproject(point);
  feats.sort((a, b) => {
    const wa = a.layer.id.startsWith('water') ? 0 : 1; const wb = b.layer.id.startsWith('water') ? 0 : 1;
    if (wa !== wb) return wa - wb;
    return dist2(a, c) - dist2(b, c);
  });
  const f = feats[0];
  const [lon, lat] = f.geometry.coordinates;
  return { props: { ...f.properties }, lat, lon, layer: f.layer.id };
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
  if (s.mode === 'local' && !s.downloading) { el.hidden = true; return; }
  el.hidden = false;
  const mb = mapMb(s.meta);
  if (s.downloading) {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    el.className = 'map-banner';
    el.innerHTML = `<b>Downloading the map…</b>
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
  note('Looking for a GPS signal…', 8000);
  s.$('#btn-locate').classList.add('on');
  s.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function onPosition(pos) {
  const s = S;
  if (!s || !s.map) return;
  s.me = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy || 0 };
  paintMe();
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
  const items = [];
  for (const f of [...s.data.water.features, ...s.data.services.features]) {
    if (!f.properties.name) continue;
    items.push({ name: f.properties.name, kind: f.properties.kind, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], props: f.properties });
  }
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
      else featureSheet({ props: it.props, lat: it.lat, lon: it.lon });
    },
  });
  const input = sheet.el.querySelector('#map-q');
  const list = sheet.el.querySelector('#map-results');
  input.addEventListener('input', () => {
    results = searchFeatures(items, input.value, 20);
    list.innerHTML = results.length
      ? results.map((it, i) => `<li><button data-sheet="go:${i}"><span class="emoji">${it.pin ? pinEmoji(it.pin.type) : '📍'}</span><span class="grow"><span class="t">${esc(it.name)}</span><span class="s">${esc(it.pin ? 'My pin' : (KIND_LABELS[it.kind] || it.kind))} · ${esc(fromMe(it.lat, it.lon))}</span></span></button></li>`).join('')
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
      <dt>Water, services, routes</dt><dd>OpenStreetMap, fetched ${esc(meta.fetchedAt ? fmtDate(meta.fetchedAt.slice(0, 10)) : '—')}</dd>
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
