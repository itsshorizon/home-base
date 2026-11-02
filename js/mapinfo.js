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

const WATER = {
  spring: { label: 'Spring', safety: 'treat', text: TREAT_BASE },
  river_access: { label: 'River or creek access', safety: 'treat', text: `${TREAT_BASE} Creek and river water can carry livestock waste, sewage and chemicals. Never use flood water.` },
  boat_ramp: { label: 'Boat ramp', safety: 'treat', text: `${TREAT_BASE} Creek and river water can carry livestock waste, sewage and chemicals. Never use flood water.` },
  lake: { label: 'Lake or pond', safety: 'treat', text: `${TREAT_BASE} Still water is worse than flowing water.` },
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
  hospital: 'Hospital', clinic: 'Clinic', pharmacy: 'Pharmacy', fire_station: 'Fire station', police: 'Police',
  fuel: 'Gas station', supermarket: 'Supermarket', hardware: 'Hardware store',
};
export const WATER_KINDS = ['spring', 'tap', 'drinking_water', 'water_point', 'lake', 'boat_ramp', 'river_access'];

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
  return props.name || KIND_LABELS[props.kind] || 'Unnamed place';
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
