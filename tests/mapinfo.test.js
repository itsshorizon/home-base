import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  waterAdvice, distanceMeters, bearingDegrees, compassPoint, formatDistance, distanceFrom,
  telHref, formatAddress, searchFeatures, pinEmoji, featureTitle, WATER_KINDS, nearestPointOnLine, nearestOnGeometry,
  rankWaterSources, nearestAccessPoint, KIND_LABELS,
} from '../js/mapinfo.js';

const guideIds = new Set(JSON.parse(readFileSync(new URL('../data/guides/index.json', import.meta.url), 'utf8')).guides.map((g) => g.id));

test('untreated sources say treat, and point at the source-choice guide', () => {
  for (const kind of ['spring', 'river_access', 'lake', 'boat_ramp']) {
    const a = waterAdvice(kind);
    assert.equal(a.safety, 'treat', kind);
    assert.equal(a.guide, 'water-source-choice');
    assert.match(a.text, /Not safe to drink untreated/);
    assert.match(a.text, /boil it for 1 minute/);
    assert.match(a.text, /not chemicals/);
  }
});

test('taps are safe only while there is no boil advisory', () => {
  for (const kind of ['tap', 'drinking_water']) {
    const a = waterAdvice(kind);
    assert.equal(a.safety, 'tap');
    assert.equal(a.guide, 'hazard-boil-advisory');
    assert.match(a.text, /boil advisory/);
  }
});

test('private or not-drinking sources are marked avoid', () => {
  assert.equal(waterAdvice('tap', { access: 'private' }).safety, 'avoid');
  assert.equal(waterAdvice('drinking_water', { drinking_water: 'no' }).safety, 'avoid');
  assert.equal(waterAdvice('spring', { access: 'yes' }).safety, 'treat');
});

test('unknown kinds fall back to treat, and every guide link exists', () => {
  assert.equal(waterAdvice('mystery').safety, 'treat');
  for (const k of [...WATER_KINDS, 'mystery']) assert.ok(guideIds.has(waterAdvice(k).guide), k);
});

test('distance: one degree of latitude is about 111 km', () => {
  const d = distanceMeters({ lat: 37, lon: -77 }, { lat: 38, lon: -77 });
  assert.ok(Math.abs(d - 111195) < 200, String(d));
  assert.equal(distanceMeters({ lat: 37.5, lon: -77.4 }, { lat: 37.5, lon: -77.4 }), 0);
});

test('bearing: cardinal directions', () => {
  const o = { lat: 37.5, lon: -77.4 };
  assert.ok(Math.abs(bearingDegrees(o, { lat: 37.6, lon: -77.4 }) - 0) < 0.01);
  assert.ok(Math.abs(bearingDegrees(o, { lat: 37.5, lon: -77.3 }) - 90) < 0.2);
  assert.ok(Math.abs(bearingDegrees(o, { lat: 37.4, lon: -77.4 }) - 180) < 0.01);
  assert.ok(Math.abs(bearingDegrees(o, { lat: 37.5, lon: -77.5 }) - 270) < 0.2);
});

test('compass points', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(44), 'NE');
  assert.equal(compassPoint(200), 'S');
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(-90), 'W');
});

test('distance text', () => {
  assert.equal(formatDistance(3862), '2.4 mi');
  assert.equal(formatDistance(100), '330 ft');
  assert.equal(formatDistance(40000), '25 mi');
  assert.equal(formatDistance(NaN), '—');
});

test('distanceFrom gives "2.4 mi NE", and a dash without a fix', () => {
  const from = { lat: 37.6, lon: -77.5 };
  // about 2.4 mi to the northeast
  const to = { lat: from.lat + 0.0246, lon: from.lon + 0.0311 };
  const text = distanceFrom(from, to);
  assert.match(text, /^2\.\d mi NE$/, text);
  assert.equal(distanceFrom(null, to), '—');
  assert.equal(distanceFrom({ lat: NaN, lon: 1 }, to), '—');
  assert.equal(distanceFrom(from, from), 'here');
});

test('tel links, addresses, titles, pins', () => {
  assert.equal(telHref('+1 804-555-0123'), 'tel:+18045550123');
  assert.equal(telHref('(804) 555-0123; (804) 555-9999'), 'tel:8045550123');
  assert.equal(telHref('911'), null);
  assert.equal(telHref(undefined), null);
  assert.equal(formatAddress({ 'addr:housenumber': '1250', 'addr:street': 'E Marshall St', 'addr:city': 'Richmond' }), '1250 E Marshall St, Richmond');
  assert.equal(formatAddress({}), '');
  assert.equal(featureTitle({ kind: 'spring' }), 'Spring');
  assert.equal(featureTitle({ name: 'Deep Run Park', kind: 'drinking_water' }), 'Deep Run Park');
  assert.equal(pinEmoji('home'), '🏠');
  assert.equal(pinEmoji('nope'), '📍');
});

test('search matches names and kinds, best prefix first', () => {
  const items = [
    { name: 'Deep Run Park', kind: 'drinking_water' },
    { name: 'Henrico Doctors Hospital', kind: 'hospital' },
    { name: 'Park Pharmacy', kind: 'pharmacy' },
    { kind: 'spring' },
  ];
  assert.deepEqual(searchFeatures(items, 'park').map((i) => i.name), ['Park Pharmacy', 'Deep Run Park']);
  assert.equal(searchFeatures(items, 'hospital').length, 1);
  assert.equal(searchFeatures(items, 'spring').length, 1);
  assert.equal(searchFeatures(items, '  ').length, 0);
});

test('circleRing: closed, and every point is the right distance from the center', async () => {
  const { circleRing } = await import('../js/mapinfo.js');
  const c = { lat: 37.55, lon: -77.4 };
  const ring = circleRing(c, 500);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  for (const [lon, lat] of ring) assert.ok(Math.abs(distanceMeters(c, { lat, lon }) - 500) < 1);
});

// ---------- Phase 4b: creeks, rivers, lakes ----------
test('creeks, rivers, ponds and reservoirs say treat, with the guide wording', () => {
  for (const kind of ['stream', 'river', 'canal', 'ditch', 'pond', 'reservoir']) {
    const a = waterAdvice(kind);
    assert.equal(a.safety, 'treat', kind);
    assert.equal(a.guide, 'water-source-choice', kind);
    assert.match(a.text, /Not safe to drink untreated/);
    assert.match(a.text, /boil it for 1 minute/);
    assert.match(a.text, /not chemicals/);
    assert.ok(KIND_LABELS[kind], kind);
  }
  assert.match(waterAdvice('stream').text, /livestock waste, sewage and chemicals/);
  assert.match(waterAdvice('stream').text, /Never use flood water/);
  assert.match(waterAdvice('pond').text, /Still water is worse than flowing water/);
  assert.equal(waterAdvice('stream').label, 'Creek or stream');
  assert.equal(featureTitle({ kind: 'stream' }), 'Unnamed stream');
  assert.equal(featureTitle({ kind: 'pond' }), 'Unnamed pond');
  assert.equal(featureTitle({ kind: 'stream', name: 'Deep Run' }), 'Deep Run');
});

test('nearestPointOnLine: foot of the perpendicular, an end point, and a ring', () => {
  // an east-west line along latitude 37.60 from -77.50 to -77.40
  const line = [[-77.5, 37.6], [-77.4, 37.6]];
  const mid = nearestPointOnLine(line, 37.61, -77.45);
  assert.ok(Math.abs(mid.lon - -77.45) < 1e-6 && Math.abs(mid.lat - 37.6) < 1e-6, JSON.stringify(mid));
  assert.ok(Math.abs(mid.meters - 1112) < 5, String(mid.meters)); // 0.01 deg of latitude
  assert.equal(mid.index, 0);
  // past the east end: snaps to the end point
  const end = nearestPointOnLine(line, 37.6, -77.3);
  assert.ok(Math.abs(end.lon - -77.4) < 1e-9 && Math.abs(end.lat - 37.6) < 1e-9);
  assert.ok(Math.abs(end.meters - distanceMeters({ lat: 37.6, lon: -77.3 }, { lat: 37.6, lon: -77.4 })) < 1);
  // a point on the line is distance 0; it picks the right segment of a bent line
  const bent = [[-77.5, 37.6], [-77.4, 37.6], [-77.4, 37.7]];
  const hit = nearestPointOnLine(bent, 37.65, -77.39);
  assert.equal(hit.index, 1);
  assert.ok(Math.abs(hit.lon - -77.4) < 1e-6 && Math.abs(hit.lat - 37.65) < 1e-6);
  assert.equal(nearestPointOnLine(line, 37.6, -77.45).meters < 0.01, true);
  // empty and single point
  assert.equal(nearestPointOnLine([], 1, 1), null);
  assert.ok(Math.abs(nearestPointOnLine([[-77.4, 37.6]], 37.61, -77.4).meters - 1112) < 5);
  // a closed ring (lake outline): the nearest boundary point, from inside the lake
  const ring = [[-77.41, 37.59], [-77.39, 37.59], [-77.39, 37.61], [-77.41, 37.61], [-77.41, 37.59]];
  const inside = nearestPointOnLine(ring, 37.6, -77.3925);
  assert.ok(Math.abs(inside.lon - -77.39) < 1e-6, JSON.stringify(inside));
});

test('nearestOnGeometry handles lines, multi-lines and polygons with holes', () => {
  const multi = { type: 'MultiLineString', coordinates: [[[-77.5, 37.6], [-77.49, 37.6]], [[-77.4, 37.7], [-77.4, 37.71]]] };
  const r = nearestOnGeometry(multi, 37.705, -77.39);
  assert.ok(Math.abs(r.lon - -77.4) < 1e-6 && Math.abs(r.lat - 37.705) < 1e-6);
  const poly = { type: 'Polygon', coordinates: [[[-77.41, 37.59], [-77.39, 37.59], [-77.39, 37.61], [-77.41, 37.61], [-77.41, 37.59]]] };
  assert.ok(nearestOnGeometry(poly, 37.6, -77.3).meters > 1000);
  assert.equal(nearestOnGeometry({ type: 'Point', coordinates: [-77.4, 37.6] }, 37.6, -77.4).meters, 0);
  assert.equal(nearestOnGeometry(null, 1, 1), null);
});

const pt = (kind, lon, lat, extra = {}) => ({ type: 'Feature', properties: { osm_id: `node/${kind}${lon}${lat}`, kind, ...extra }, geometry: { type: 'Point', coordinates: [lon, lat] } });
const line = (name, kind, coords, extra = {}) => ({ type: 'Feature', properties: { osm_id: `way/${name}${coords[0]}`, name, kind, intermittent: false, ...extra }, geometry: { type: 'LineString', coordinates: coords } });
const body = (name, kind, ring, extra = {}) => ({ type: 'Feature', properties: { osm_id: `way/${name}${ring[0]}`, name, kind, areaAcres: 5, ...extra }, geometry: { type: 'MultiPolygon', coordinates: [[ring]] } });

const HOME = { lat: 37.665, lon: -77.505 };
const sample = () => [
  pt('tap', -77.505, 37.675, { name: 'Park tap' }),                       // about 1.1 km north
  pt('spring', -77.505, 37.655, { name: 'Little spring' }),               // about 1.1 km south
  pt('boat_ramp', -77.52, 37.665, { name: 'Ramp' }),                      // about 1.3 km west
  pt('lake', -77.5, 37.665, { name: 'Lake centroid' }),                   // must be ignored: the outline stands for it
  pt('tap', -77.505, 37.7, { access: 'private' }),                        // private
  pt('hospital', -77.505, 37.665),                                        // not water: ignored
  line('Deep Run', 'stream', [[-77.51, 37.66], [-77.51, 37.67]]),         // 0.4 km west
  line('Deep Run', 'stream', [[-77.6, 37.6], [-77.6, 37.61]]),            // a far piece of the same creek
  line('Dry Branch', 'stream', [[-77.49, 37.66], [-77.49, 37.67]], { intermittent: true }), // 1.3 km east
  line(null, 'stream', [[-77.5, 37.68], [-77.499, 37.68]]),               // unnamed, 1.7 km away: inside a mile
  line(null, 'stream', [[-77.4, 37.68], [-77.399, 37.68]]),               // unnamed, far: left out
  body('Big Pond', 'pond', [[-77.515, 37.66], [-77.514, 37.66], [-77.514, 37.661], [-77.515, 37.661], [-77.515, 37.66]]),
  body('James River Lake', 'lake', [[-77.3, 37.5], [-77.29, 37.5], [-77.29, 37.51], [-77.3, 37.51], [-77.3, 37.5]]),
];

test('rankWaterSources: nearest first, one row per named creek, unnamed only within a mile, lake points skipped', () => {
  const rows = rankWaterSources(sample(), HOME.lat, HOME.lon, 'all', 15);
  const names = rows.map((r) => r.title);
  assert.equal(names.filter((n) => n === 'Deep Run').length, 1);
  assert.ok(!names.includes('Lake centroid'));
  assert.ok(!rows.some((r) => r.kind === 'hospital'));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].meters >= rows[i - 1].meters, 'sorted by distance');
  assert.equal(names[0], 'Deep Run'); // the creek is the closest thing
  const deep = rows.find((r) => r.title === 'Deep Run');
  assert.ok(deep.meters < 500, String(deep.meters)); // the near piece, not the far one
  assert.match(deep.away, /^\d+ ft W$|^0\.\d mi W$/);
  // unnamed streams: only the one inside a mile... which here is 1.7 km, so none at all
  assert.equal(rows.filter((r) => r.name === null && r.kind === 'stream').length, 0);
  const near = rankWaterSources([line(null, 'stream', [[-77.51, 37.66], [-77.51, 37.67]])], HOME.lat, HOME.lon, 'all', 15);
  assert.equal(near.length, 1);
  assert.equal(near[0].title, 'Unnamed stream');
  // the dry one is flagged
  assert.equal(rows.find((r) => r.title === 'Dry Branch').intermittent, true);
  assert.equal(rows.find((r) => r.title === 'Deep Run').intermittent, false);
});

test('rankWaterSources: a creek that is partly tagged river still gets one row', () => {
  const rows = rankWaterSources([line('Chick', 'river', [[-77.51, 37.66], [-77.51, 37.67]]), line('Chick', 'stream', [[-77.52, 37.66], [-77.52, 37.67]])], HOME.lat, HOME.lon, 'all', 15);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'river');
});

test('rankWaterSources: filters', () => {
  const kinds = (f) => new Set(rankWaterSources(sample(), HOME.lat, HOME.lon, f, 15).map((r) => r.kind));
  assert.deepEqual([...kinds('taps')].sort(), ['spring', 'tap']);
  const creeks = kinds('creeks');
  assert.ok(creeks.has('stream') && creeks.has('boat_ramp'));
  assert.ok(!creeks.has('tap') && !creeks.has('pond') && !creeks.has('lake'));
  assert.deepEqual([...kinds('lakes')].sort(), ['lake', 'pond']);
});

test('rankWaterSources: limit, safest tag only from the tap tier, private taps marked avoid', () => {
  assert.equal(rankWaterSources(sample(), HOME.lat, HOME.lon, 'all', 3).length, 3);
  const taps = rankWaterSources(sample(), HOME.lat, HOME.lon, 'taps', 15);
  const park = taps.find((r) => r.title === 'Park tap');
  assert.equal(park.safest, true);
  assert.equal(park.tier, 'tap');
  const spring = taps.find((r) => r.kind === 'spring');
  assert.equal(spring.safest, false); // the guides say spring water needs treating, so no "safest" claim
  assert.equal(spring.tier, 'treat');
  const priv = taps.find((r) => r.props.access === 'private');
  assert.equal(priv.tier, 'avoid');
  assert.equal(priv.safest, false);
  assert.equal(rankWaterSources([], 1, 1, 'all', 15).length, 0);
  assert.equal(rankWaterSources(null, 1, 1).length, 0);
});

test('rankWaterSources: a lake is measured to its shoreline, and unnamed ponds are capped', () => {
  const ring = [[-77.5, 37.67], [-77.49, 37.67], [-77.49, 37.68], [-77.5, 37.68], [-77.5, 37.67]];
  const rows = rankWaterSources([body('Shore Lake', 'lake', ring)], 37.665, -77.495, 'lakes', 15);
  assert.ok(Math.abs(rows[0].meters - 556) < 5, String(rows[0].meters)); // 0.005 deg of latitude south of the shore
  const ponds = Array.from({ length: 10 }, (_, i) => body(null, 'pond', [[-77.5 + i * 0.001, 37.67], [-77.4995 + i * 0.001, 37.67], [-77.4995 + i * 0.001, 37.6705], [-77.5 + i * 0.001, 37.67]], { areaAcres: 2 }));
  assert.equal(rankWaterSources(ponds, 37.665, -77.495, 'lakes', 15).length, 3);
});

test('rankWaterSources is quick on 10,000 features', () => {
  const many = [];
  for (let i = 0; i < 10000; i++) many.push(line(`Creek ${i % 400}`, 'stream', [[-77.8 + (i % 100) * 0.007, 37.3 + Math.floor(i / 100) * 0.006], [-77.79 + (i % 100) * 0.007, 37.305 + Math.floor(i / 100) * 0.006]]));
  const t = Date.now();
  const rows = rankWaterSources(many, 37.665, -77.505, 'all', 15);
  assert.equal(rows.length, 15);
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
});

test('nearestAccessPoint: same-named waterway only, nearest to the reference point', () => {
  const pts = [
    pt('boat_ramp', -77.5, 37.6, { name: 'Far ramp', waterbody: 'Deep Run' }),
    pt('river_access', -77.45, 37.6, { name: 'Deep Run (at Nuckols Rd)', waterbody: 'Deep Run', inferred: true }),
    pt('boat_ramp', -77.451, 37.6, { name: 'Other creek ramp', waterbody: 'Tuckahoe Creek' }),
    pt('tap', -77.45, 37.6, { name: 'A tap' }),
  ];
  const a = nearestAccessPoint(pts, 'Deep Run', 37.6, -77.44);
  assert.equal(a.props.name, 'Deep Run (at Nuckols Rd)');
  assert.ok(a.meters > 800 && a.meters < 900, String(a.meters));
  assert.equal(nearestAccessPoint(pts, 'Nope Creek', 37.6, -77.44), null);
  assert.equal(nearestAccessPoint(pts, null, 37.6, -77.44), null);
  assert.equal(nearestAccessPoint([], 'Deep Run', 1, 1), null);
});
