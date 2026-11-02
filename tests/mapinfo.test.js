import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  waterAdvice, distanceMeters, bearingDegrees, compassPoint, formatDistance, distanceFrom,
  telHref, formatAddress, searchFeatures, pinEmoji, featureTitle, WATER_KINDS,
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
