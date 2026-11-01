import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, computeRunway } from '../js/runway.js';
import { computeWeakSpots, activeWeakSpots, countBySeverity } from '../js/weakspots.js';
import { ROOM_TEMP_DAYS } from '../js/categories.js';

const NOW = new Date('2026-11-01T12:00:00');
let seq = 0;
const item = (o) => ({ id: `i${++seq}`, name: 'x', category: 'tools', kind: 'tools_other', qty: 1, unit: 'each', storage: 'pantry', expires: null, perUnit: {}, ...o });
const gear = (kind, o = {}) => item({ kind, name: kind, ...o });
const person = (o = {}) => ({ id: 'p1', name: 'Alex', age: 30, sex: 'M', meds: [], t1d: null, ...o });
const t1dPerson = (t1d = {}, o = {}) => person({
  id: 'p2', name: 'Tee',
  t1d: { basalUnits: 20, bolusUnits: 20, usesPump: false, usesCGM: false, pumpType: 'tubeless', pumpChangeDays: 3, cgmDays: 10,
    stripsPerDay: 2, ketoneStripsPerDay: 0, injectionsPerDay: 0, ...t1d },
  ...o,
});
const insulin = (type, o = {}) => item({ category: 't1d', kind: 'insulin', insulinType: type, unit: 'vial', perUnit: { insulin_units: 1000 }, ...o });

const spots = (items, people = [], pets = [], settings = {}) => {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return computeWeakSpots(items, people, pets, s, computeRunway(items, people, pets, s, NOW), NOW);
};
const ids = (list) => list.map((w) => w.id);
const get = (list, id) => list.find((w) => w.id === id);
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const dateDaysAgo = (n) => daysAgo(n).slice(0, 10);

// A household that has everything, so each test can remove or add one thing.
const FULL_KINDS = ['co_detector', 'smoke_detector', 'fire_extinguisher', 'can_opener', 'weather_radio', 'first_aid_kit', 'tourniquet',
  'light', 'battery_cells', 'potassium_iodide'];
const fullKit = () => [
  ...FULL_KINDS.map((k) => gear(k)),
  item({ category: 'water', kind: 'water', qty: 100, perUnit: { water_gal: 1 } }),
  item({ category: 'treatment', kind: 'filter', perUnit: { treat_gal: 1000 } }),
];

test('baseline: a fully stocked simple household has no weak spots', () => {
  assert.deepEqual(ids(spots(fullKit(), [person()])), []);
});

test('empty household: the gear rules fire, plus water-low (zero water)', () => {
  const list = spots([], [], []);
  assert.deepEqual(ids(list).sort(), ['no-extinguisher', 'no-first-aid', 'no-ki', 'no-light', 'no-power', 'no-smoke', 'no-tourniquet',
    'no-treatment', 'no-weather-radio', 'water-low'].sort());
});

test('each result has id, severity, title, detail and fix {label, href}', () => {
  for (const w of spots([], [t1dPerson({ usesPump: true, usesCGM: true })], [{ id: 'd', name: 'Rex' }])) {
    assert.ok(w.id && w.title && w.detail, w.id);
    assert.ok(['red', 'amber', 'info'].includes(w.severity), w.id);
    assert.ok(w.fix && w.fix.label && w.fix.href.startsWith('#/'), w.id);
  }
});

test('pump-no-basal: fires for a pump user without long-acting insulin, with add + how-to links', () => {
  const pump = [t1dPerson({ usesPump: true })];
  const w = get(spots(fullKit(), pump), 'pump-no-basal');
  assert.equal(w.severity, 'red');
  assert.equal(w.title, 'Pump backup: no long-acting insulin');
  assert.equal(w.fix.href, '#/add?cat=t1d&kind=insulin');
  assert.equal(w.howto.href, '#/guide/t1d-pump-failure');
  // rapid-acting insulin does not count
  assert.ok(get(spots([...fullKit(), insulin('humalog')], pump), 'pump-no-basal'));
  // each long-acting type clears it
  for (const type of ['lantus', 'basaglar', 'levemir', 'toujeo', 'tresiba', 'humulin_n']) {
    assert.ok(!get(spots([...fullKit(), insulin(type)], pump), 'pump-no-basal'), type);
  }
  // not a pump user: no rule
  assert.ok(!get(spots(fullKit(), [t1dPerson({ usesPump: false })]), 'pump-no-basal'));
});

test('pump-no-needles: needs pen needles or syringes', () => {
  const pump = [t1dPerson({ usesPump: true })];
  const w = get(spots(fullKit(), pump), 'pump-no-needles');
  assert.equal(w.severity, 'red');
  assert.equal(w.title, 'Pump backup: no pen needles or syringes');
  assert.ok(!get(spots([...fullKit(), gear('pen_needles')], pump), 'pump-no-needles'));
  assert.ok(!get(spots([...fullKit(), gear('syringes')], pump), 'pump-no-needles'));
  assert.ok(!get(spots(fullKit(), [t1dPerson({ usesPump: false })]), 'pump-no-needles'));
});

test('t1d-no-glucagon (red), only when someone has t1d', () => {
  const w = get(spots(fullKit(), [t1dPerson()]), 't1d-no-glucagon');
  assert.equal(w.severity, 'red');
  assert.ok(!get(spots([...fullKit(), gear('glucagon')], [t1dPerson()]), 't1d-no-glucagon'));
  assert.ok(!get(spots(fullKit(), [person()]), 't1d-no-glucagon'));
});

test('cgm-no-strips: CGM users need fingerstick strips', () => {
  const cgm = [t1dPerson({ usesCGM: true })];
  const w = get(spots(fullKit(), cgm), 'cgm-no-strips');
  assert.equal(w.severity, 'red');
  assert.equal(w.title, 'No fingerstick backup if the CGM fails');
  assert.ok(!get(spots([...fullKit(), gear('test_strips', { perUnit: { count: 50 } })], cgm), 'cgm-no-strips'));
  assert.ok(!get(spots(fullKit(), [t1dPerson({ usesCGM: false })]), 'cgm-no-strips'));
});

test('t1d-no-ketone, t1d-no-fast-sugar, t1d-no-cooler (amber)', () => {
  const p = [t1dPerson()];
  const base = spots(fullKit(), p);
  assert.equal(get(base, 't1d-no-ketone').severity, 'amber');
  assert.equal(get(base, 't1d-no-fast-sugar').severity, 'amber');
  assert.equal(get(base, 't1d-no-fast-sugar').title, 'No fast sugar for lows (glucose tabs or gel)');
  assert.equal(get(base, 't1d-no-cooler').severity, 'amber');
  assert.equal(get(base, 't1d-no-cooler').title, 'No way to keep insulin cool without power');
  const stocked = spots([...fullKit(), gear('ketone_strips'), gear('glucose_tabs'), gear('insulin_cooler')], p);
  for (const id of ['t1d-no-ketone', 't1d-no-fast-sugar', 't1d-no-cooler']) assert.ok(!get(stocked, id), id);
  assert.ok(!get(spots(fullKit(), [person()]), 't1d-no-ketone'));
});

test('t1d-no-plan: needs plan.backupBasalUnits; links to the person', () => {
  const w = get(spots(fullKit(), [t1dPerson()]), 't1d-no-plan');
  assert.equal(w.severity, 'amber');
  assert.equal(w.title, "Fill in Tee's emergency plan");
  assert.equal(w.fix.href, '#/person/p2');
  const planned = t1dPerson({ plan: { backupBasalUnits: 18 } });
  assert.ok(!get(spots(fullKit(), [planned]), 't1d-no-plan'));
  assert.ok(get(spots(fullKit(), [t1dPerson({ plan: { carbRatio: '1:10' } })]), 't1d-no-plan'), 'a plan without the basal dose is still missing');
  assert.ok(!get(spots(fullKit(), [person()]), 't1d-no-plan'));
});

test('insulin-open-old: 27 days is fine, 29 days is past the humalog limit of 28', () => {
  const p = [person()];
  const open = (type, days, o = {}) => insulin(type, { name: 'Humalog vial', opened: true, openedAt: dateDaysAgo(days), ...o });
  assert.equal(ROOM_TEMP_DAYS.humalog, 28);
  assert.ok(!get(spots([...fullKit(), open('humalog', 27)], p), 'insulin-open-old'));
  assert.ok(!get(spots([...fullKit(), open('humalog', 28)], p), 'insulin-open-old'));
  const w = get(spots([...fullKit(), open('humalog', 29)], p), 'insulin-open-old');
  assert.equal(w.severity, 'amber');
  assert.equal(w.title, 'Humalog vial: opened 29 days ago, past its in-use limit');
  // limits differ by type: levemir allows 42
  assert.ok(!get(spots([...fullKit(), open('levemir', 40)], p), 'insulin-open-old'));
  assert.ok(get(spots([...fullKit(), open('levemir', 43)], p), 'insulin-open-old'));
  // not opened, or no date recorded: can't tell, so no warning
  assert.ok(!get(spots([...fullKit(), open('humalog', 60, { opened: false })], p), 'insulin-open-old'));
  assert.ok(!get(spots([...fullKit(), open('humalog', 60, { openedAt: undefined })], p), 'insulin-open-old'));
  // one weak spot for several old items
  const two = spots([...fullKit(), open('humalog', 40), open('lantus', 50, { name: 'Lantus pen' })], p);
  assert.equal(two.filter((x) => x.id === 'insulin-open-old').length, 1);
});

test('water-low: red under 14 days, fine at 14', () => {
  const people = [person()]; // 1 gal/day
  const water = (gal) => item({ category: 'water', kind: 'water', qty: gal, perUnit: { water_gal: 1 } });
  const rest = fullKit().filter((i) => i.kind !== 'water');
  const w = get(spots([...rest, water(13)], people), 'water-low');
  assert.equal(w.severity, 'red');
  assert.equal(w.title, 'Less than 2 weeks of water');
  assert.match(w.detail, /FEMA/);
  assert.equal(w.howto.href, '#/guide/water-how-much');
  assert.ok(!get(spots([...rest, water(14)], people), 'water-low'));
  assert.ok(get(spots(rest, people), 'water-low'), 'no water at all is a red weak spot');
});

test('no-treatment: needs any item that treats water', () => {
  const rest = fullKit().filter((i) => i.kind !== 'filter');
  assert.equal(get(spots(rest, [person()]), 'no-treatment').severity, 'amber');
  assert.ok(!get(spots([...rest, item({ kind: 'bleach', category: 'treatment', perUnit: { treat_gal: 500 }, createdAt: daysAgo(10) })], [person()]), 'no-treatment'));
});

test('bleach-old: over a year since createdAt, or expired', () => {
  const bleach = (o) => item({ category: 'treatment', kind: 'bleach', perUnit: { treat_gal: 500 }, createdAt: daysAgo(100), ...o });
  const p = [person()];
  assert.ok(!get(spots([...fullKit(), bleach({})], p), 'bleach-old'));
  assert.ok(!get(spots([...fullKit(), bleach({ createdAt: daysAgo(365) })], p), 'bleach-old'));
  const w = get(spots([...fullKit(), bleach({ createdAt: daysAgo(366) })], p), 'bleach-old');
  assert.equal(w.severity, 'amber');
  assert.equal(w.title, 'Bleach may be too weak');
  assert.equal(w.howto.href, '#/guide/water-bleach');
  assert.ok(get(spots([...fullKit(), bleach({ expires: '2026-10-31' })], p), 'bleach-old'), 'expired bleach');
  assert.ok(!get(spots([...fullKit(), bleach({ expires: '2026-11-01' })], p), 'bleach-old'), 'expires today is still good');
});

test('fuel-no-co: butane, propane or a stove without a CO detector', () => {
  const noCo = fullKit().filter((i) => i.kind !== 'co_detector');
  assert.ok(!get(spots(noCo, [person()]), 'fuel-no-co'), 'no fuel, no warning');
  for (const kind of ['fuel_butane', 'fuel_propane', 'stove']) {
    const w = get(spots([...noCo, gear(kind, { category: 'cooking' })], [person()]), 'fuel-no-co');
    assert.equal(w.severity, 'red', kind);
    assert.equal(w.title, 'Fuel stoves but no CO detector');
    assert.equal(w.howto.href, '#/guide/co-safety');
    assert.ok(!get(spots([...fullKit(), gear(kind, { category: 'cooking' })], [person()]), 'fuel-no-co'), kind);
  }
});

test('cans-no-opener: food in cans needs a manual opener', () => {
  const noOpener = fullKit().filter((i) => i.kind !== 'can_opener');
  const can = item({ category: 'food', kind: 'food', unit: 'can', perUnit: { kcal: 200 } });
  const bag = item({ category: 'food', kind: 'food', unit: 'bag', perUnit: { kcal: 200 } });
  assert.equal(get(spots([...noOpener, can], [person()]), 'cans-no-opener').severity, 'amber');
  assert.ok(!get(spots([...noOpener, bag], [person()]), 'cans-no-opener'));
  assert.ok(!get(spots([...fullKit(), can], [person()]), 'cans-no-opener'));
});

test('simple gear rules: weather radio, first aid, tourniquet, light, extinguisher, smoke', () => {
  const cases = [
    ['no-weather-radio', 'amber', 'weather_radio'], ['no-first-aid', 'amber', 'first_aid_kit'], ['no-tourniquet', 'info', 'tourniquet'],
    ['no-light', 'amber', 'light'], ['no-extinguisher', 'amber', 'fire_extinguisher'], ['no-smoke', 'info', 'smoke_detector'],
    ['no-ki', 'info', 'potassium_iodide'],
  ];
  for (const [id, sev, kind] of cases) {
    const without = fullKit().filter((i) => i.kind !== kind);
    const w = get(spots(without, [person()]), id);
    assert.ok(w, `${id} fires`);
    assert.equal(w.severity, sev, id);
    assert.ok(!get(spots(fullKit(), [person()]), id), `${id} clears`);
  }
  assert.match(get(spots([], []), 'no-ki').detail, /outside the 10-mile emergency zones of North Anna and Surry/);
  assert.equal(get(spots([], []), 'no-ki').howto.href, '#/guide/hazard-nuclear');
});

test('no-power: fires only with no Wh item and no batteries', () => {
  const rest = fullKit().filter((i) => i.kind !== 'battery_cells');
  assert.equal(get(spots(rest, [person()]), 'no-power').severity, 'info');
  assert.ok(!get(spots(fullKit(), [person()]), 'no-power'), 'batteries clear it');
  assert.ok(!get(spots([...rest, item({ category: 'power', kind: 'power_bank', perUnit: { wh: 50 } })], [person()]), 'no-power'), 'a power bank clears it');
});

test('pets-no-food: only when you have pets', () => {
  const dog = { id: 'd1', name: 'Rex', kcalPerDay: 1000, waterGalPerDay: 0.2 };
  assert.equal(get(spots(fullKit(), [person()], [dog]), 'pets-no-food').severity, 'amber');
  assert.ok(!get(spots(fullKit(), [person()], []), 'pets-no-food'));
  assert.ok(!get(spots([...fullKit(), gear('pet_food', { category: 'pets', perUnit: { kcal: 90000 } })], [person()], [dog]), 'pets-no-food'));
});

test('med-low:<person>:<med>: red when under 14 days', () => {
  const p = person({ meds: [{ name: 'Levothyroxine', dose: '50 mcg', perDay: 1 }] });
  const bottle = (n) => item({ category: 'meds', kind: 'med', unit: 'bottle', medName: 'levothyroxine', qty: 1, perUnit: { count: n } });
  const w = get(spots([...fullKit(), bottle(10)], [p]), 'med-low:p1:levothyroxine');
  assert.equal(w.severity, 'red');
  assert.equal(w.title, 'Refill Levothyroxine for Alex (10 days left)');
  assert.ok(!get(spots([...fullKit(), bottle(14)], [p]), 'med-low:p1:levothyroxine'));
  assert.ok(get(spots(fullKit(), [p]), 'med-low:p1:levothyroxine'), 'none stocked is also low');
  assert.equal(get(spots([...fullKit(), bottle(1)], [p]), 'med-low:p1:levothyroxine').title, 'Refill Levothyroxine for Alex (1 day left)');
});

test('expired and qty-0 items do not count', () => {
  const pump = [t1dPerson({ usesPump: true, usesCGM: true })];
  const expiredGlucagon = gear('glucagon', { expires: '2026-10-31' });
  const emptyGlucagon = gear('glucagon', { qty: 0 });
  assert.ok(get(spots([...fullKit(), expiredGlucagon], pump), 't1d-no-glucagon'));
  assert.ok(get(spots([...fullKit(), emptyGlucagon], pump), 't1d-no-glucagon'));
  assert.ok(!get(spots([...fullKit(), gear('glucagon', { expires: '2026-11-01' })], pump), 't1d-no-glucagon'), 'expires today still counts');
  // a CO detector that is expired, or used up, does not satisfy the CO rule
  const noCo = fullKit().filter((i) => i.kind !== 'co_detector');
  const stove = gear('stove', { category: 'cooking' });
  assert.ok(get(spots([...noCo, stove, gear('co_detector', { expires: '2020-01-01' })], [person()]), 'fuel-no-co'));
  assert.ok(get(spots([...noCo, stove, gear('co_detector', { qty: 0 })], [person()]), 'fuel-no-co'));
  // expired long-acting insulin does not count either
  assert.ok(get(spots([...fullKit(), insulin('lantus', { expires: '2026-01-01' })], pump), 'pump-no-basal'));
});

test('sorted red, then amber, then info', () => {
  const list = spots([gear('stove', { category: 'cooking' })], [t1dPerson({ usesPump: true, usesCGM: true })], [{ id: 'd', name: 'Rex' }]);
  const rank = { red: 0, amber: 1, info: 2 };
  for (let i = 1; i < list.length; i++) assert.ok(rank[list[i - 1].severity] <= rank[list[i].severity], `${list[i - 1].id} before ${list[i].id}`);
  assert.equal(list[0].severity, 'red');
  assert.equal(list[list.length - 1].severity, 'info');
  assert.ok(new Set(ids(list)).size === list.length, 'ids are unique');
});

test('activeWeakSpots hides dismissed info items only; countBySeverity counts', () => {
  const list = spots([], []);
  const settings = { dismissedWeakSpots: ['no-ki', 'no-light'] }; // no-light is amber: cannot be dismissed
  const active = activeWeakSpots(list, settings);
  assert.ok(!get(active, 'no-ki'));
  assert.ok(get(active, 'no-light'));
  assert.equal(active.length, list.length - 1);
  const c = countBySeverity(list);
  assert.equal(c.red + c.amber + c.info, list.length);
});

test('pure: does not read the clock (same inputs, different real time, same output)', () => {
  const realNow = Date.now;
  try {
    const a = JSON.stringify(spots([], [t1dPerson({ usesPump: true })]));
    Date.now = () => 0;
    const b = JSON.stringify(spots([], [t1dPerson({ usesPump: true })]));
    assert.equal(a, b);
  } finally { Date.now = realNow; }
});
