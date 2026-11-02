// Map helpers that need no browser: water advice, distance/bearing, labels.
// PURE: no DOM, no IndexedDB, no Date.now(). Imports cleanly in Node, so `node --test` can check it.
//
// The water advice below reuses the wording and numbers of the guides water-source-choice, water-filters,
// water-boil and water-bleach (CDC / EPA / FEMA), and hazard-boil-advisory. It adds no new facts.
// Deliberately left out: a warning about sewage overflows into the James River below Richmond. The
// spec wanted one only if backed by data/local.json or Richmond DPU / James River Association, and that
// could not be verified, so it is not here.

const GUIDE_TREAT = 'water-source-choice';
const GUIDE_TAP = 'hazard-boil-advisory';

const TREAT_BASE = 'Not safe to drink untreated. Let cloudy water settle or strain it through a cloth, then filter it, then boil it for 1 minute or add bleach (30 minutes). '
  + "Filters, boiling and bleach kill germs, not chemicals or fuel, so skip water with a sheen or a chemical smell.";
const TAP_TEXT = 'Public tap. Safe only while the water system is working and no boil advisory is in effect. Otherwise treat it: boil 1 minute, or use bottled water.';

const MOVING = `${TREAT_BASE} Creek and river water can carry livestock waste, sewage and chemicals. Never use flood water.`;
const STILL = `${TREAT_BASE} Still water is worse than flowing water.`;

const WATER = {
  spring: { label: 'Spring', safety: 'treat', text: TREAT_BASE },
  river_access: { label: 'River or creek access', safety: 'treat', text: MOVING },
  boat_ramp: { label: 'Boat ramp', safety: 'treat', text: MOVING },
  lake: { label: 'Lake or pond', safety: 'treat', text: STILL },
  // Phase 4b: the creek, river and lake lines and outlines. Same guide wording (water-source-choice): creek or river = moving water,
  // pond or lake = still water. Canals and ditches get the plain treatment steps only, because the guide says nothing more about them.
  stream: { label: 'Creek or stream', safety: 'treat', text: MOVING },
  river: { label: 'River', safety: 'treat', text: MOVING },
  canal: { label: 'Canal', safety: 'treat', text: TREAT_BASE },
  ditch: { label: 'Ditch', safety: 'treat', text: TREAT_BASE },
  pond: { label: 'Pond', safety: 'treat', text: STILL },
  reservoir: { label: 'Reservoir', safety: 'treat', text: STILL },
  tap: { label: 'Water tap', safety: 'tap', text: TAP_TEXT },
  drinking_water: { label: 'Drinking water', safety: 'tap', text: TAP_TEXT },
  water_point: { label: 'Water point', safety: 'tap', text: TAP_TEXT },
};

// waterAdvice(kind, tags?) -> { label, safety: 'treat'|'tap'|'avoid', text, guide }
export function waterAdvice(kind, tags = {}) {
  const base = WATER[kind];
  if (!base) {
    return { label: 'Water', safety: 'treat', text: TREAT_BASE, guide: GUIDE_TREAT };
  }
  const guide = base.safety === 'tap' ? GUIDE_TAP : GUIDE_TREAT;
  if (tags && (tags.drinking_water === 'no' || tags.access === 'private')) {
    const why = tags.drinking_water === 'no' ? 'is tagged "not drinking water"' : 'is on private property';
    return { label: base.label, safety: 'avoid', text: `This source ${why}. Look for another source, and treat any water you can't be sure of.`, guide: GUIDE_TREAT };
  }
  return { label: base.label, safety: base.safety, text: base.text, guide };
}

export const SAFETY_LABELS = { treat: 'Treat before drinking', tap: 'Tap: check for advisory', avoid: 'Avoid' };

// ---------- distance and direction ----------
const R_M = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Great-circle distance in meters. a and b are {lat, lon}.
export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Compass bearing from a to b in degrees, 0 = north, clockwise, in [0, 360).
export function bearingDegrees(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compassPoint(bearing) {
  return POINTS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  const miles = meters / 1609.344;
  if (miles < 0.1) return `${Math.round((meters * 3.28084) / 10) * 10} ft`;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

// "2.4 mi NE", or "—" with no GPS fix.
export function distanceFrom(from, to) {
  if (!from || !to || !Number.isFinite(from.lat) || !Number.isFinite(from.lon) || !Number.isFinite(to.lat) || !Number.isFinite(to.lon)) return '—';
  const m = distanceMeters(from, to);
  if (m < 30) return 'here';
  return `${formatDistance(m)} ${compassPoint(bearingDegrees(from, to))}`;
}

// ---------- labels and tag formatting ----------
export const KIND_LABELS = {
  spring: 'Spring', tap: 'Water tap', drinking_water: 'Drinking water', water_point: 'Water point', lake: 'Lake or pond',
  boat_ramp: 'Boat ramp', river_access: 'River or creek access',
  stream: 'Creek or stream', river: 'River', canal: 'Canal', ditch: 'Ditch', pond: 'Pond', reservoir: 'Reservoir',
  hospital: 'Hospital', clinic: 'Clinic', pharmacy: 'Pharmacy', fire_station: 'Fire station', police: 'Police',
  fuel: 'Gas station', supermarket: 'Supermarket', hardware: 'Hardware store',
};
export const WATER_KINDS = ['spring', 'tap', 'drinking_water', 'water_point', 'lake', 'boat_ramp', 'river_access', 'stream', 'river', 'canal', 'ditch', 'pond', 'reservoir'];
export const WATERWAY_KINDS = ['stream', 'river', 'canal', 'ditch'];
export const WATERBODY_KINDS = ['lake', 'pond', 'reservoir'];
const TAP_KINDS = ['tap', 'drinking_water', 'water_point', 'spring'];
const ACCESS_KINDS = ['boat_ramp', 'river_access'];

export const PIN_TYPES = [
  { id: 'home', label: 'Home', emoji: '🏠' },
  { id: 'rally', label: 'Rally point', emoji: '🚩' },
  { id: 'water', label: 'Water', emoji: '💧' },
  { id: 'cache', label: 'Cache', emoji: '📦' },
  { id: 'danger', label: 'Danger', emoji: '⚠️' },
  { id: 'other', label: 'Other', emoji: '📍' },
];
export const pinEmoji = (type) => (PIN_TYPES.find((t) => t.id === type) || PIN_TYPES[5]).emoji;

export function featureTitle(props) {
  if (props.name) return props.name;
  if (WATERWAY_KINDS.includes(props.kind) || WATERBODY_KINDS.includes(props.kind)) return `Unnamed ${(KIND_LABELS[props.kind] || 'water').toLowerCase().replace('creek or stream', 'stream')}`;
  return KIND_LABELS[props.kind] || 'Unnamed place';
}

export function formatAddress(props) {
  const street = [props['addr:housenumber'], props['addr:street']].filter(Boolean).join(' ');
  const city = [props['addr:city'], props['addr:postcode']].filter(Boolean).join(' ');
  return [street, city].filter(Boolean).join(', ');
}

// "(804) 555-0100" -> "tel:+18045550100"-ish: keep digits and a leading +. Returns null if nothing usable.
export function telHref(phone) {
  if (!phone) return null;
  const first = String(phone).split(/[;,]/)[0];
  const digits = first.replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? `tel:${digits}` : null;
}

// Offline search over a list of {name, kind, ...}. Case-insensitive; every word must appear. Returns at most `limit`.
export function searchFeatures(items, query, limit = 25) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const it of items) {
    const hay = `${it.name || ''} ${KIND_LABELS[it.kind] || it.kind || ''}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) hits.push(it);
    if (hits.length >= limit * 4) break;
  }
  const q = words.join(' ');
  hits.sort((a, b) => Number((b.name || '').toLowerCase().startsWith(q)) - Number((a.name || '').toLowerCase().startsWith(q)));
  return hits.slice(0, limit);
}

// A circle of `meters` radius around {lat, lon} as a GeoJSON ring (used for the GPS accuracy circle).
export function circleRing(center, meters, steps = 48) {
  const d = Math.max(0, meters) / R_M;
  const lat1 = rad(center.lat);
  const lon1 = rad(center.lon);
  const ring = [];
  for (let i = 0; i < steps; i++) {
    const brg = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([deg(lon2), deg(lat2)]);
  }
  ring.push(ring[0]);
  return ring;
}

// ---------- nearest point on a line or outline ----------
const M_PER_DEG = (Math.PI / 180) * R_M;

// Closest point to (lat, lon) on a line given as [[lon, lat], ...]. A closed ring (a lake outline) works too.
// -> { lat, lon, meters, index } or null for an empty line. `index` is the segment that holds the point.
export function nearestPointOnLine(coords, lat, lon) {
  if (!Array.isArray(coords) || !coords.length) return null;
  const kx = Math.cos(rad(lat)) * M_PER_DEG;
  const ky = M_PER_DEG;
  let best = null;
  const consider = (px, py, i) => {
    const d2 = px * px + py * py;
    if (!best || d2 < best.d2) best = { d2, x: px, y: py, index: i };
  };
  if (coords.length === 1) consider((coords[0][0] - lon) * kx, (coords[0][1] - lat) * ky, 0);
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1][0] - lon) * kx; const ay = (coords[i - 1][1] - lat) * ky;
    const bx = (coords[i][0] - lon) * kx; const by = (coords[i][1] - lat) * ky;
    const dx = bx - ax; const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(ax * dx + ay * dy) / len2 : 0; // the query point is the origin
    t = Math.max(0, Math.min(1, t));
    consider(ax + t * dx, ay + t * dy, i - 1);
  }
  const outLat = lat + best.y / ky;
  const outLon = lon + best.x / kx;
  return { lat: outLat, lon: outLon, meters: distanceMeters({ lat, lon }, { lat: outLat, lon: outLon }), index: best.index };
}

// Closest point on any GeoJSON geometry (Point, LineString, MultiLineString, Polygon, MultiPolygon: outlines only).
export function nearestOnGeometry(geom, lat, lon) {
  if (!geom) return null;
  const lines = [];
  switch (geom.type) {
    case 'Point': {
      const [x, y] = geom.coordinates;
      return { lat: y, lon: x, meters: distanceMeters({ lat, lon }, { lat: y, lon: x }), index: 0 };
    }
    case 'LineString': lines.push(geom.coordinates); break;
    case 'MultiLineString': lines.push(...geom.coordinates); break;
    case 'Polygon': lines.push(...geom.coordinates); break;
    case 'MultiPolygon': for (const poly of geom.coordinates) lines.push(...poly); break;
    default: return null;
  }
  let best = null;
  for (const l of lines) {
    const r = nearestPointOnLine(l, lat, lon);
    if (r && (!best || r.meters < best.meters)) best = r;
  }
  return best;
}

// ---------- Find water ----------
export const WATER_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'taps', label: 'Taps & springs' },
  { id: 'creeks', label: 'Creeks & rivers' },
  { id: 'lakes', label: 'Lakes & ponds' },
];
export const WATER_ICONS = { spring: '💧', tap: '🚰', drinking_water: '🚰', water_point: '🚰', boat_ramp: '⛵', river_access: '🎣', stream: '〰️', river: '🌊', canal: '〰️', ditch: '〰️', lake: '🏞️', pond: '🏞️', reservoir: '🏞️' };

const UNNAMED_STREAM_RADIUS_M = 1609.344; // unnamed streams count only within 1 mile
const UNNAMED_CAP = 3; // and at most this many unnamed streams / unnamed ponds are listed, so they never bury the named sources

// rankWaterSources(features, lat, lon, filter, limit): the nearest water, nearest first.
//   features: GeoJSON features from water.geojson (points), waterways.geojson (lines) and waterbodies.geojson (polygons), mixed.
//   filter:   'all' | 'taps' (taps, drinking water, water points, springs) | 'creeks' (streams, rivers, and their ramps and access points) | 'lakes'.
//   Lake centroid points in water.geojson are skipped: the polygon in waterbodies.geojson stands for the lake.
//   One row per named waterway (its closest point to you). Lakes and ponds are measured to their closest shoreline point.
// -> [{ key, title, name, kind, group, lat, lon, meters, bearing, away, intermittent, tier, safest, props }]
//   tier comes from waterAdvice(); `safest` is true only for kinds whose advice tier is 'tap' (public taps), nothing more.
export function rankWaterSources(features, lat, lon, filter = 'all', limit = 15) {
  const from = { lat, lon };
  const rows = [];
  const named = new Map(); // "kind-group|name" -> index into rows
  const unnamedStreams = [];
  const unnamedBodies = [];
  const want = (group, kind) => {
    if (filter === 'all') return true;
    if (filter === 'taps') return group === 'point' && TAP_KINDS.includes(kind);
    if (filter === 'creeks') return group === 'waterway' || (group === 'point' && ACCESS_KINDS.includes(kind));
    if (filter === 'lakes') return group === 'body';
    return true;
  };
  for (const f of features || []) {
    const p = f && f.properties;
    const g = f && f.geometry;
    if (!p || !g) continue;
    let group;
    if (g.type === 'Point') group = 'point';
    else if (g.type === 'LineString' || g.type === 'MultiLineString') group = 'waterway';
    else if (g.type === 'Polygon' || g.type === 'MultiPolygon') group = 'body';
    else continue;
    if (group === 'point' && (p.kind === 'lake' || !WATER_KINDS.includes(p.kind))) continue;
    if (!want(group, p.kind)) continue;
    const near = nearestOnGeometry(g, lat, lon);
    if (!near) continue;
    const advice = waterAdvice(p.kind, p);
    const row = {
      key: `${p.osm_id || ''}|${p.kind}|${p.name || ''}`, title: featureTitle(p), name: p.name || null, kind: p.kind, group,
      lat: near.lat, lon: near.lon, meters: near.meters, bearing: bearingDegrees(from, near), away: '',
      intermittent: !!p.intermittent, tier: advice.safety, safest: advice.safety === 'tap', props: p, geometry: g,
    };
    if (group === 'waterway' && p.name) {
      const k = p.name; // one row per name, even when OpenStreetMap tags part of it 'river' and part 'stream'
      if (named.has(k)) { const i = named.get(k); if (row.meters < rows[i].meters) rows[i] = row; continue; }
      named.set(k, rows.length);
    } else if (group === 'waterway') {
      if (row.meters <= UNNAMED_STREAM_RADIUS_M && p.kind === 'stream') unnamedStreams.push(row);
      continue;
    } else if (group === 'body' && !p.name) {
      if ((p.areaAcres || 0) >= 1) unnamedBodies.push(row);
      continue;
    }
    rows.push(row);
  }
  unnamedStreams.sort((a, b) => a.meters - b.meters);
  unnamedBodies.sort((a, b) => a.meters - b.meters);
  rows.push(...unnamedStreams.slice(0, UNNAMED_CAP), ...unnamedBodies.slice(0, UNNAMED_CAP));
  rows.sort((a, b) => a.meters - b.meters);
  const out = rows.slice(0, limit);
  for (const r of out) r.away = r.meters < 30 ? 'here' : `${formatDistance(r.meters)} ${compassPoint(r.bearing)}`;
  return out;
}

// The access point (boat ramp, pier, or inferred creek/river point) nearest to (lat, lon) that sits on the waterway called `name`.
// -> feature props + { lat, lon, meters } or null. `points` are the Point features of water.geojson.
export function nearestAccessPoint(points, name, lat, lon) {
  if (!name) return null;
  let best = null;
  for (const f of points || []) {
    const p = f && f.properties;
    if (!p || !ACCESS_KINDS.includes(p.kind) || p.waterbody !== name || !f.geometry || f.geometry.type !== 'Point') continue;
    const [x, y] = f.geometry.coordinates;
    const m = distanceMeters({ lat, lon }, { lat: y, lon: x });
    if (!best || m < best.meters) best = { props: p, lat: y, lon: x, meters: m };
  }
  return best;
}
