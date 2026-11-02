// Fetch map overlay data for Home Base from the OpenStreetMap Overpass API.
// Run on the Mac, not in the app:   npm run map:data     (needs Node 24, uses the built-in fetch)
//
// Writes small GeoJSON files into data/map/:
//   water.geojson     springs, taps, lakes, boat ramps, river access points
//   services.geojson  hospitals, pharmacies, fire, police, fuel, groceries, hardware
//   routes.geojson    the major roads out (I-64, I-95, I-295 ...), simplified
//   boundary.geojson  the Henrico County line, simplified
//   rings.geojson     10 and 50 mile circles around North Anna and Surry (from data/local.json)
//   meta.json         when it was fetched, the bbox, feature counts, sources
//
// Optional: set HB_OSM_CACHE=/some/folder to keep the raw Overpass answers there, so a re-run while
// you are tweaking this script does not hit Overpass again (delete the folder to refresh).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'map');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const UA = 'HomeBase/0.4 (household prep app)';
const BBOX = { w: -77.80, s: 37.33, e: -77.10, n: 37.82 }; // same box as the .pmtiles extract
const BB = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`; // Overpass wants south,west,north,east
const CACHE = process.env.HB_OSM_CACHE || null;
const PAUSE_MS = 8000; // be polite: wait between queries

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------- Overpass ----------
async function overpass(name, ql) {
  const cacheFile = CACHE ? path.join(CACHE, `${name}.json`) : null;
  if (cacheFile && existsSync(cacheFile)) { log(`  [${name}] from cache`); return JSON.parse(await readFile(cacheFile, 'utf8')); }
  let wait = 20000;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: 'data=' + encodeURIComponent(ql),
      });
      if (res.ok) {
        const json = await res.json();
        if (cacheFile) { await mkdir(CACHE, { recursive: true }); await writeFile(cacheFile, JSON.stringify(json)); }
        log(`  [${name}] ${json.elements.length} elements`);
        await sleep(PAUSE_MS);
        return json;
      }
      log(`  [${name}] HTTP ${res.status} (attempt ${attempt}); waiting ${wait / 1000}s`);
    } catch (e) {
      log(`  [${name}] ${e.message} (attempt ${attempt}); waiting ${wait / 1000}s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 240000);
  }
  throw new Error(`Overpass query "${name}" kept failing`);
}

// ---------- geometry helpers (lon/lat arrays are [lon, lat]) ----------
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const round = (n, d = 5) => Math.round(n * 10 ** d) / 10 ** d;
const inBox = (p) => p[0] >= BBOX.w && p[0] <= BBOX.e && p[1] >= BBOX.s && p[1] <= BBOX.n;
const coords = (geom) => (geom || []).map((g) => [g.lon, g.lat]);

// local flat projection in meters around lat0 (good enough for small areas)
function project(p, lat0) { return [rad(p[0]) * R * Math.cos(rad(lat0)), rad(p[1]) * R]; }

function ringAreaCentroid(ring) {
  const lat0 = ring[0][1];
  const pts = ring.map((p) => project(p, lat0));
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) return { area: 0, centroid: ring[0] };
  const mx = cx / (6 * a); const my = cy / (6 * a);
  return { area: Math.abs(a), centroid: [(mx / (R * Math.cos(rad(lat0)))) * (180 / Math.PI), (my / R) * (180 / Math.PI)] };
}

// Douglas-Peucker in meters. tol = meters.
function simplify(line, tol) {
  if (line.length < 3) return line;
  const lat0 = line[0][1];
  const pts = line.map((p) => project(p, lat0));
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let dmax = 0; let idx = -1;
    const [x1, y1] = pts[s]; const [x2, y2] = pts[e];
    const dx = x2 - x1; const dy = y2 - y1; const len2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      let t = len2 ? ((pts[i][0] - x1) * dx + (pts[i][1] - y1) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(pts[i][0] - (x1 + t * dx), pts[i][1] - (y1 + t * dy));
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol && idx > -1) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return line.filter((_, i) => keep[i]);
}

const pkey = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

// Join way segments end to end into rings (used for lakes and the county line).
function assembleRings(segments) {
  const left = segments.filter((s) => s.length > 1).map((s) => s.slice());
  const rings = [];
  while (left.length) {
    let ring = left.pop();
    let guard = 0;
    while (pkey(ring[0]) !== pkey(ring[ring.length - 1]) && guard++ < 5000) {
      const end = pkey(ring[ring.length - 1]);
      const i = left.findIndex((s) => pkey(s[0]) === end || pkey(s[s.length - 1]) === end);
      if (i === -1) break;
      let seg = left.splice(i, 1)[0];
      if (pkey(seg[0]) !== end) seg = seg.reverse();
      ring = ring.concat(seg.slice(1));
    }
    if (pkey(ring[0]) === pkey(ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// Chain ways that meet end to end into longer lines (so each road is a few lines, not hundreds).
// Ends are compared by coordinates, because a way's end node is the same point as the next way's start.
function chainWays(ways) {
  const startKey = (w) => pkey(w.pts[0]);
  const endKey = (w) => pkey(w.pts[w.pts.length - 1]);
  const byStart = new Map();
  const byEnd = new Map();
  ways.forEach((w, i) => {
    if (!byStart.has(startKey(w))) byStart.set(startKey(w), []);
    byStart.get(startKey(w)).push(i);
    if (!byEnd.has(endKey(w))) byEnd.set(endKey(w), []);
    byEnd.get(endKey(w)).push(i);
  });
  const used = new Set();
  const lines = [];
  for (let i = 0; i < ways.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let line = ways[i].pts.slice();
    for (let grew = true; grew;) {
      grew = false;
      const next = (byStart.get(pkey(line[line.length - 1])) || []).find((j) => !used.has(j));
      if (next !== undefined) { used.add(next); line = line.concat(ways[next].pts.slice(1)); grew = true; continue; }
      const prev = (byEnd.get(pkey(line[0])) || []).find((j) => !used.has(j));
      if (prev !== undefined) { used.add(prev); line = ways[prev].pts.slice(0, -1).concat(line); grew = true; }
    }
    lines.push(line);
  }
  return lines;
}

function circle(center, miles, n = 64) {
  const d = (miles * 1609.344) / R;
  const lat1 = rad(center[1]); const lon1 = rad(center[0]);
  const ring = [];
  for (let i = 0; i < n; i++) {
    const brg = (2 * Math.PI * i) / n;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([round((lon2 * 180) / Math.PI), round((lat2 * 180) / Math.PI)]);
  }
  ring.push(ring[0]);
  return ring;
}

// ---------- tags -> feature properties ----------
const KEEP_TAGS = ['name', 'access', 'operator', 'opening_hours', 'phone', 'brand', 'seasonal', 'fee', 'description', 'drinking_water', 'website',
  'addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode'];
function baseProps(el, kind) {
  const t = el.tags || {};
  const p = { osm_id: `${el.type}/${el.id}`, kind };
  if (!t.name && t.brand) p.name = t.brand;
  for (const k of KEEP_TAGS) if (t[k] !== undefined) p[k] = t[k];
  if (t['contact:phone'] && !p.phone) p.phone = t['contact:phone'];
  if (p.website && p.website.length > 120) delete p.website;
  return p;
}
const elPoint = (el) => (el.type === 'node' ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null);
const pointFeature = (pt, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [round(pt[0]), round(pt[1])] } });

function waterKind(t) {
  if (t.natural === 'spring') return 'spring';
  if (t.amenity === 'drinking_water') return 'drinking_water';
  if (t.amenity === 'water_point') return 'water_point';
  if (t.man_made === 'water_tap') return 'tap';
  if (t.leisure === 'slipway') return 'boat_ramp';
  if (t.leisure === 'fishing' || t.man_made === 'pier') return 'river_access';
  return null;
}
function serviceKind(t) {
  if (t.amenity === 'hospital') return 'hospital';
  if (t.amenity === 'clinic') return 'clinic';
  if (t.amenity === 'pharmacy') return 'pharmacy';
  if (t.amenity === 'fire_station') return 'fire_station';
  if (t.amenity === 'police') return 'police';
  if (t.amenity === 'fuel') return 'fuel';
  if (t.shop === 'supermarket') return 'supermarket';
  if (t.shop === 'hardware' || t.shop === 'doityourself') return 'hardware';
  return null;
}

// ---------- spatial index of named waterways (for "which river is this ramp on" and bridge crossings) ----------
const CELL = 0.0007; // about 75 m
const cellKey = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
function densify(line, maxStepM = 30) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const d = haversine(line[i - 1], line[i]);
    const steps = Math.max(1, Math.ceil(d / maxStepM));
    for (let s = 1; s <= steps; s++) out.push([line[i - 1][0] + ((line[i][0] - line[i - 1][0]) * s) / steps, line[i - 1][1] + ((line[i][1] - line[i - 1][1]) * s) / steps]);
  }
  return out;
}
function buildIndex(groups) {
  const grid = new Map();
  for (const g of groups) {
    for (const line of g.lines) {
      for (const p of densify(line)) {
        const k = cellKey(p[0], p[1]);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push({ p, name: g.name });
      }
    }
  }
  return grid;
}
function nearest(grid, pt, maxM) {
  const cx = Math.floor(pt[0] / CELL); const cy = Math.floor(pt[1] / CELL);
  const reach = Math.ceil(maxM / 75);
  let best = null;
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (const e of grid.get(`${cx + dx}:${cy + dy}`) || []) {
        const d = haversine(pt, e.p);
        if (d <= maxM && (!best || d < best.d)) best = { d, p: e.p, name: e.name };
      }
    }
  }
  return best;
}

// ---------- main ----------
async function main() {
  const local = JSON.parse(await readFile(path.join(ROOT, 'data', 'local.json'), 'utf8'));
  await mkdir(OUT, { recursive: true });
  const sources = [
    { name: 'OpenStreetMap via Overpass API', url: 'https://overpass-api.de/api/interpreter', license: 'ODbL, © OpenStreetMap contributors' },
  ];
  const head = '[out:json][timeout:180];';

  // 1. water points -------------------------------------------------------
  log('Water points...');
  const pointQl = `${head}(
    nwr["natural"="spring"](${BB});
    nwr["amenity"="drinking_water"](${BB});
    nwr["amenity"="water_point"](${BB});
    nwr["man_made"="water_tap"](${BB});
    nwr["leisure"="slipway"](${BB});
    nwr["leisure"="fishing"](${BB});
    nwr["man_made"="pier"](${BB});
  );out center tags;`;
  const pointsRaw = await overpass('water-points', pointQl);

  log('Lakes and ponds...');
  const lakeQl = `${head}(
    way["natural"="water"]["name"](${BB});
    relation["natural"="water"]["name"](${BB});
  );out geom;`;
  const lakesRaw = await overpass('water-lakes', lakeQl);

  log('Named rivers and creeks...');
  const riverQl = `${head}way["waterway"~"^(river|stream)$"]["name"](${BB});out geom;`;
  const riversRaw = await overpass('waterways', riverQl);

  log('Road bridges...');
  const bridgeQl = `${head}way["highway"]["bridge"]["bridge"!="no"](${BB});out center tags;`;
  const bridgesRaw = await overpass('bridges', bridgeQl);

  // named waterways grouped by name
  const wwMap = new Map();
  for (const el of riversRaw.elements) {
    if (el.type !== 'way' || !el.geometry) continue;
    const name = el.tags.name;
    if (!wwMap.has(name)) wwMap.set(name, { name, kind: el.tags.waterway, lines: [], lengthM: 0 });
    const g = wwMap.get(name);
    const line = coords(el.geometry);
    g.lines.push(line);
    for (let i = 1; i < line.length; i++) if (inBox(line[i]) && inBox(line[i - 1])) g.lengthM += haversine(line[i - 1], line[i]);
    if (el.tags.waterway === 'river') g.kind = 'river';
  }
  const wwGroups = [...wwMap.values()];
  const wwGrid = buildIndex(wwGroups);
  const wwKind = new Map(wwGroups.map((g) => [g.name, g.kind]));

  const water = [];
  const seenOsm = new Set();
  for (const el of pointsRaw.elements) {
    const kind = waterKind(el.tags || {});
    const pt = elPoint(el);
    if (!kind || !pt || !inBox(pt)) continue;
    if (el.tags.access === 'private' && kind !== 'spring') continue; // private taps and docks are not for us
    // piers and fishing spots: keep only ones that are actually at a named waterway or lake edge, or have a name
    const props = baseProps(el, kind);
    if (kind === 'river_access' || kind === 'boat_ramp') {
      const near = nearest(wwGrid, pt, 300);
      if (near) props.waterbody = near.name;
      // an unnamed pier is usually a backyard dock: keep it only if it is a fishing spot or sits on a real river
      if (kind === 'river_access' && !props.name && el.tags.leisure !== 'fishing' && !(near && wwKind.get(near.name) === 'river')) continue;
    }
    seenOsm.add(props.osm_id);
    water.push(pointFeature(pt, props));
  }

  // lakes and ponds as centroid points with an area estimate
  const SKIP_WATER = new Set(['river', 'stream', 'canal', 'oxbow', 'reflecting_pool', 'moat', 'wastewater', 'basin_stormwater', 'fountain', 'pool']);
  let lakeCount = 0;
  for (const el of lakesRaw.elements) {
    const t = el.tags || {};
    if (SKIP_WATER.has(t.water)) continue;
    let segs = [];
    if (el.type === 'way') segs = [coords(el.geometry)];
    else if (el.type === 'relation') segs = (el.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => coords(m.geometry));
    const rings = assembleRings(segs);
    if (!rings.length) continue;
    let area = 0; let best = null;
    for (const r of rings) {
      const ac = ringAreaCentroid(r);
      area += ac.area;
      if (!best || ac.area > best.area) best = ac;
    }
    if (area < 4000 || !inBox(best.centroid)) continue; // under about 1 acre: not a dependable source
    const props = baseProps(el, 'lake');
    props.areaM2 = Math.round(area);
    props.areaAcres = round(area / 4046.856, 1);
    if (t.water) props.water = t.water;
    water.push(pointFeature(best.centroid, props));
    lakeCount++;
  }

  // one access point per named river or creek: a point on the waterway where a road bridge crosses it
  const bridges = bridgesRaw.elements.filter((b) => b.center && b.tags && !/^(motorway|trunk|motorway_link|trunk_link|footway|cycleway|path|pedestrian|steps|track|service)$/.test(b.tags.highway));
  const NAME_OK = /(River|Creek|Run|Brook|Branch|Swamp|Fork)$/;
  let inferredCount = 0;
  for (const g of wwGroups) {
    if (!NAME_OK.test(g.name) || g.lengthM < 1500) continue;
    const gGrid = buildIndex([g]);
    const cands = [];
    for (const b of bridges) {
      const bp = [b.center.lon, b.center.lat];
      if (!inBox(bp)) continue;
      const hit = nearest(gGrid, bp, 45);
      if (hit) cands.push({ p: hit.p, road: b.tags.name || b.tags.ref || null, rank: b.tags.name ? 0 : 1 });
    }
    cands.sort((a, b) => a.p[0] - b.p[0]);
    let picks = [];
    const n = Math.max(1, Math.min(3, Math.ceil(g.lengthM / 25000)));
    if (cands.length) {
      for (let i = 0; i < n; i++) picks.push(cands[Math.min(cands.length - 1, Math.floor(((i + 0.5) * cands.length) / n))]);
      picks = [...new Map(picks.map((p) => [pkey(p.p), p])).values()];
    } else {
      const pts = g.lines.flatMap((l) => l).filter(inBox).sort((a, b) => a[0] - b[0]);
      if (!pts.length) continue;
      for (let i = 0; i < n; i++) picks.push({ p: pts[Math.min(pts.length - 1, Math.floor(((i + 0.5) * pts.length) / n))], road: null });
    }
    for (const pk of picks) {
      water.push(pointFeature(pk.p, {
        osm_id: `waterway/${g.name}`, kind: 'river_access', name: pk.road ? `${g.name} (at ${pk.road})` : `${g.name} (midpoint)`,
        waterbody: g.name, inferred: true,
        note: pk.road ? 'Inferred: a point on the waterway where this road crosses it. Not a surveyed access point; check access and ownership.' : 'Inferred: a point on the waterway. No road crossing found. Not a surveyed access point.',
      }));
      inferredCount++;
    }
  }
  log(`  water features: ${water.length} (${lakeCount} lakes/ponds, ${inferredCount} inferred river/creek points)`);

  // 2. services ----------------------------------------------------------
  log('Services...');
  const svcQl = `${head}(
    nwr["amenity"~"^(hospital|clinic|pharmacy|fire_station|police|fuel)$"](${BB});
    nwr["shop"~"^(supermarket|hardware|doityourself)$"](${BB});
  );out center tags;`;
  const svcRaw = await overpass('services', svcQl);
  const services = [];
  for (const el of svcRaw.elements) {
    const kind = serviceKind(el.tags || {});
    const pt = elPoint(el);
    if (!kind || !pt || !inBox(pt)) continue;
    const props = baseProps(el, kind);
    if (!props.name && !['hospital', 'fire_station', 'police', 'pharmacy'].includes(kind)) { if (kind !== 'fuel') continue; } // unnamed shops are noise
    services.push(pointFeature(pt, props));
  }

  // 3. routes ------------------------------------------------------------
  log('Routes...');
  const REFS = ['I 64', 'I 95', 'I 295', 'I 195', 'US 60', 'US 250', 'US 33', 'US 360', 'US 1', 'VA 5'];
  const routeQl = `${head}way["highway"~"^(motorway|trunk|primary)$"]["ref"~"(^|;)(I 64|I 95|I 295|I 195|US 60|US 250|US 33|US 360|US 1|VA 5)(;|$)"](${BB});out geom;`;
  const routeRaw = await overpass('routes', routeQl);
  const byRef = new Map(REFS.map((r) => [r, []]));
  for (const el of routeRaw.elements) {
    if (el.type !== 'way' || !el.geometry) continue;
    for (const ref of el.tags.ref.split(';').map((s) => s.trim())) {
      if (byRef.has(ref)) byRef.get(ref).push({ pts: coords(el.geometry), name: el.tags.name });
    }
  }
  const routes = [];
  for (const [ref, ways] of byRef) {
    if (!ways.length) continue;
    const lines = chainWays(ways).map((l) => simplify(l, 12).map((p) => [round(p[0]), round(p[1])])).filter((l) => l.length > 1);
    const names = [...new Set(ways.map((w) => w.name).filter(Boolean))].slice(0, 3);
    routes.push({ type: 'Feature', properties: { ref, kind: 'route', name: ref, local_names: names.join(' / ') || undefined }, geometry: { type: 'MultiLineString', coordinates: lines } });
  }

  // 4. Henrico boundary ---------------------------------------------------
  log('Boundary...');
  const bQl = `${head}relation["boundary"="administrative"]["admin_level"="6"]["name"="Henrico County"];out geom;`;
  const bRaw = await overpass('boundary', bQl);
  const rel = bRaw.elements.find((e) => e.type === 'relation');
  if (!rel) throw new Error('Henrico County boundary relation not found');
  const outer = assembleRings((rel.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => coords(m.geometry)));
  if (!outer.length) throw new Error('Could not assemble the Henrico boundary into a closed ring');
  const boundary = outer.map((r) => simplify(r, 40).map((p) => [round(p[0]), round(p[1])]));
  const boundaryFc = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: 'Henrico County', osm_id: `relation/${rel.id}`, kind: 'boundary' }, geometry: { type: 'MultiPolygon', coordinates: boundary.map((r) => [r]) } }],
  };
  const allB = boundary.flat();
  const bounds = [Math.min(...allB.map((p) => p[0])), Math.min(...allB.map((p) => p[1])), Math.max(...allB.map((p) => p[0])), Math.max(...allB.map((p) => p[1]))];

  // 5. nuclear rings (from data/local.json, not from memory) ---------------------
  const ringFeatures = [];
  for (const plant of local.nuclearPlants) {
    const short = plant.name.replace(/ (Power Station|Nuclear.*)$/, '');
    for (const miles of [plant.epzMiles, plant.ingestionZoneMiles]) {
      ringFeatures.push({
        type: 'Feature',
        properties: {
          kind: 'ring', name: `${short} — ${miles} mi`, plant: plant.name, miles, role: miles === plant.epzMiles ? 'emergency planning zone (plume)' : 'ingestion pathway zone',
          center: [plant.lon, plant.lat], source: plant.source, zoneSource: plant.zoneSource, checkedAt: plant.checkedAt,
          note: 'A plain circle of this radius around the plant. Official zones follow roads and county lines; ask Henrico Emergency Management.',
        },
        geometry: { type: 'Polygon', coordinates: [circle([plant.lon, plant.lat], miles)] },
      });
    }
  }

  // ---------- write ----------
  const fc = (features) => ({ type: 'FeatureCollection', features });
  const files = {
    'water.geojson': fc(water),
    'services.geojson': fc(services),
    'routes.geojson': fc(routes),
    'boundary.geojson': boundaryFc,
    'rings.geojson': fc(ringFeatures),
  };
  const sizes = {};
  for (const [file, data] of Object.entries(files)) {
    const text = JSON.stringify(data);
    await writeFile(path.join(OUT, file), text);
    sizes[file] = text.length;
  }
  const count = (list) => list.reduce((m, f) => { m[f.properties.kind] = (m[f.properties.kind] || 0) + 1; return m; }, {});
  const meta = {
    fetchedAt: new Date().toISOString(),
    bbox: [BBOX.w, BBOX.s, BBOX.e, BBOX.n],
    boundaryBounds: bounds.map((n) => round(n)),
    counts: { water: water.length, services: services.length, routes: routes.length, rings: ringFeatures.length, boundary: 1 },
    countsByKind: { water: count(water), services: count(services), routes: Object.fromEntries(routes.map((r) => [r.properties.ref, r.geometry.coordinates.length + ' line(s)'])) },
    bytes: sizes,
    notes: [
      'River and creek access points are inferred: a point on the named waterway where a road bridge crosses it (or its midpoint if no bridge). They are not surveyed access points.',
      'Lakes and ponds under about 1 acre are left out. Private taps and docks are left out.',
      'Nuclear rings are plain circles from the plant coordinates in data/local.json.',
    ],
    sources: [...sources, { name: 'Plant locations and zone definitions', url: 'data/local.json (nuclearPlants)' }],
  };
  // the basemap file (data/map/henrico.pmtiles) is made by hand with the pmtiles tool; keep its notes if they are there
  try { const old = JSON.parse(await readFile(path.join(OUT, 'meta.json'), 'utf8')); if (old.pmtiles) meta.pmtiles = old.pmtiles; } catch { /* first run */ }
  await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
  log('\nDone.', JSON.stringify(meta.counts), sizes);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
