import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, computeRunway, shoppingList, statusFor, defaultKcal, defaultProteinG,
  FRIDGE_SAFE_HOURS, FREEZER_SAFE_HOURS,
} from '../js/runway.js';

const NOW = new Date('2026-11-01T12:00:00');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3.6e6).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

let seq = 0;
const item = (o) => ({ id: `i${++seq}`, name: 'x', category: 'food', kind: 'food', qty: 1, unit: 'can', storage: 'pantry', expires: null, perUnit: {}, ...o });
const food = (qty, kcal, extra = {}) => item({ kind: 'food', qty, perUnit: { kcal, protein_g: 0 }, ...extra });
const adultM = { id: 'p1', name: 'Mark', age: 35, sex: 'M', meds: [], t1d: null };
const adultF = { id: 'p2', name: 'Fran', age: 35, sex: 'F', meds: [], t1d: null };
const t1dPerson = (extra = {}) => ({
  id: 'p3', name: 'Tee', age: 35, sex: 'F', meds: [],
  t1d: { basalUnits: 20, bolusUnits: 20, usesPump: true, pumpType: 'tubeless', pumpChangeDays: 3, usesCGM: true, cgmDays: 10,
    stripsPerDay: 2, ketoneStripsPerDay: 0, injectionsPerDay: 0, rapidInsulin: 'humalog', basalInsulin: 'lantus', ...extra },
});
const run = (items, people, settings = {}, pets = []) => computeRunway(items, people, pets, { ...DEFAULT_SETTINGS, ...settings }, NOW);
const res = (r, key) => r.resources.find((x) => x.key === key);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} expected ${b}, got ${a}`);

test('1. calories: 4500/day, ration scales it', () => {
  const items = [food(10, 4500)];
  const r = run(items, [adultM, adultF]);
  assert.equal(res(r, 'calories').daily, 4500);
  assert.equal(res(r, 'calories').days, 10);
  assert.equal(res(run(items, [adultM, adultF], { rationPct: 50 }), 'calories').days, 20);
});

test('2. water: 14 gal and 2 people', () => {
  const items = [item({ category: 'water', kind: 'water', qty: 14, perUnit: { water_gal: 1 } })];
  assert.equal(res(run(items, [adultM, adultF]), 'water').days, 7);
  assert.equal(res(run(items, [adultM, adultF], { waterGalPerPersonDay: 0.5 }), 'water').days, 14);
});

test('3. peopleOverride scales per-person totals', () => {
  const r = run([food(1, 1000)], [adultM, adultF], { peopleOverride: 4 });
  assert.equal(res(r, 'calories').daily, 9000);
});

test('4. no people: one default adult (2000 kcal, 1 gal)', () => {
  const r = run([], []);
  assert.equal(res(r, 'calories').daily, 2000);
  assert.equal(res(r, 'protein').daily, 50);
  assert.equal(res(r, 'water').daily, 1);
  assert.equal(r.defaultAdult, true);
});

test('5. insulin: baseline, grid-down cap, cooling, mixed types', () => {
  const vials = item({ category: 't1d', kind: 'insulin', qty: 4, unit: 'vial', insulinType: 'humalog', storage: 'fridge', perUnit: { insulin_units: 1000 } });
  const people = [t1dPerson()];
  near(res(run([vials], people), 'insulin').days, 100);

  const down = { gridDown: true, gridDownSince: daysAgo(10) };
  const capped = res(run([vials], people, down), 'insulin');
  near(capped.days, 18);
  assert.equal(capped.capped, true);
  assert.match(capped.note, /Limited by heat/);

  near(res(run([vials], people, { ...down, insulinCooling: true }), 'insulin').days, 100);

  const pen = item({ category: 't1d', kind: 'insulin', qty: 1, unit: 'pen', insulinType: 'tresiba', perUnit: { insulin_units: 300 } });
  near(res(run([vials, pen], people, down), 'insulin').days, 46);
});

test('6. expired items are excluded; expiring today is included', () => {
  const people = [t1dPerson()];
  const expired = item({ kind: 'insulin', qty: 1, insulinType: 'humalog', perUnit: { insulin_units: 1000 }, expires: '2026-10-31' });
  const today = item({ kind: 'insulin', qty: 1, insulinType: 'humalog', perUnit: { insulin_units: 1000 }, expires: '2026-11-01' });
  near(res(run([expired], people), 'insulin').days, 0);
  near(res(run([today], people), 'insulin').days, 25);
  near(res(run([expired, today], people), 'insulin').days, 25);
});

test('7. fridge and freezer food during grid-down', () => {
  const people = [adultM, adultF];
  const fridge = food(1, 4500, { storage: 'fridge' });
  const freezer = food(1, 4500, { storage: 'freezer' });
  const pantry = food(1, 4500, { storage: 'pantry' });
  const at = (h) => ({ gridDown: true, gridDownSince: hoursAgo(h) });
  assert.equal(FRIDGE_SAFE_HOURS, 4);
  assert.equal(FREEZER_SAFE_HOURS, 48);
  assert.equal(res(run([fridge], people, at(3)), 'calories').days, 1);
  assert.equal(res(run([fridge], people, at(5)), 'calories').days, 0);
  assert.equal(res(run([freezer], people, at(47)), 'calories').days, 1);
  assert.equal(res(run([freezer], people, at(49)), 'calories').days, 0);
  assert.equal(res(run([pantry], people, at(500)), 'calories').days, 1);
  // not in grid-down mode: fridge food always counts
  assert.equal(res(run([fridge], people, { gridDown: false, gridDownSince: hoursAgo(99) }), 'calories').days, 1);
});

test('8. CGM sensors', () => {
  const people = [t1dPerson()];
  const nine = item({ kind: 'cgm_sensor', qty: 9, perUnit: { count: 1 } });
  near(res(run([nine], people), 'cgm').days, 90);
  const box = item({ kind: 'cgm_sensor', qty: 3, perUnit: { count: 3 } });
  near(res(run([box], people), 'cgm').days, 90);
});

test('9. med matching is case-insensitive and trimmed', () => {
  const p = { ...adultM, meds: [{ name: 'Levothyroxine', dose: '50 mcg', perDay: 1 }] };
  const bottle = item({ category: 'meds', kind: 'med', qty: 1, unit: 'bottle', medName: ' levothyroxine ', perUnit: { count: 90 } });
  const r = run([bottle], [p]);
  const m = res(r, 'med:p1:levothyroxine');
  assert.ok(m, 'med resource exists');
  assert.equal(m.days, 90);
  assert.equal(m.label, 'Mark — Levothyroxine');
});

test('10. fuel: burn-hours per day, and n/a at 0 h/day', () => {
  const fuel = item({ category: 'cooking', kind: 'fuel_butane', qty: 4, unit: 'canister', perUnit: { fuel_hours: 1.5 } });
  assert.equal(res(run([fuel], [adultM]), 'fuel').days, 6);
  const off = run([fuel, food(1, 2000), item({ kind: 'water', qty: 3, perUnit: { water_gal: 1 } })], [adultM], { stoveHoursPerDay: 0 });
  assert.equal(res(off, 'fuel').days, null);
  assert.equal(res(off, 'fuel').status, 'na');
  assert.notEqual(off.bottleneck, 'fuel');
});

test('11. bottleneck is the lowest applicable days; n/a stays out; unstocked non-critical is "missing"', () => {
  const people = [adultM, adultF]; // 4500 kcal, 2 gal per day
  const items = [
    item({ category: 'water', kind: 'water', qty: 14, perUnit: { water_gal: 1 } }), // 7 days
    item({ kind: 'food', qty: 10, perUnit: { kcal: 4500, protein_g: 200 } }), // 10 days
  ];
  const r = run(items, people);
  assert.equal(r.bottleneck, 'water');
  assert.equal(res(r, 'insulin').status, 'na');
  assert.equal(res(r, 'insulin').days, null);
  for (const k of ['fuel', 'treatment', 'tp']) {
    assert.ok(r.missing.includes(k), `${k} should be missing`);
    assert.equal(res(r, k).status, 'missing');
    assert.equal(res(r, k).days, 0);
    assert.equal(res(r, k).note, 'None stocked yet');
  }
  // applicable first (ascending), then missing, then n/a
  const live = r.resources.filter((x) => x.days !== null && x.status !== 'missing').map((x) => x.days);
  assert.deepEqual(live, [...live].sort((a, b) => a - b));
  const kinds = r.resources.map((x) => (x.status === 'na' ? 2 : x.status === 'missing' ? 1 : 0));
  assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b));
  // missing resources still show up in the shopping list: need = targetDays x daily
  const list = shoppingList(r, { ...DEFAULT_SETTINGS });
  assert.equal(list.find((x) => x.key === 'fuel').need, 30);
  // nothing applicable at all -> no bottleneck
  const none = computeRunway([], [], [], { ...DEFAULT_SETTINGS, rationPct: 0, waterGalPerPersonDay: 0, stoveHoursPerDay: 0, tpRollsPerPersonWeek: 0 }, NOW);
  assert.equal(none.bottleneck, null);
});

test('11b. critical resources with zero supply stay in the bottleneck at 0 days', () => {
  const people = [adultM, adultF];
  const food10 = item({ kind: 'food', qty: 10, perUnit: { kcal: 4500, protein_g: 200 } });
  const r = run([food10], people); // no water items at all
  assert.equal(r.bottleneck, 'water');
  assert.equal(res(r, 'water').days, 0);
  assert.equal(res(r, 'water').status, 'red');
  assert.ok(!r.missing.includes('water'));
  // insulin, strips and meds are critical too
  const t1d = t1dPerson();
  const p = { ...adultM, meds: [{ name: 'Metformin', perDay: 2 }] };
  const r2 = run([], [t1d, p]);
  for (const k of ['insulin', 'strips', `med:${p.id}:metformin`]) {
    assert.equal(res(r2, k).days, 0, k);
    assert.equal(res(r2, k).status, 'red', k);
    assert.ok(!r2.missing.includes(k), k);
  }
  // a non-critical T1D supply (CGM) with zero stock is missing, not red
  assert.equal(res(r2, 'cgm').status, 'missing');
});

test('12. statusFor thresholds', () => {
  assert.equal(statusFor(13.9, DEFAULT_SETTINGS), 'red');
  assert.equal(statusFor(14, DEFAULT_SETTINGS), 'amber');
  assert.equal(statusFor(29.9, DEFAULT_SETTINGS), 'amber');
  assert.equal(statusFor(30, DEFAULT_SETTINGS), 'green');
});

test('13. shoppingList: water 7 days, 2 gal/day, target 30 -> 46 gal', () => {
  const items = [item({ category: 'water', kind: 'water', qty: 14, perUnit: { water_gal: 1 } })];
  const s = { ...DEFAULT_SETTINGS, targetDays: 30 };
  const r = computeRunway(items, [adultM, adultF], [], s, NOW);
  const list = shoppingList(r, s);
  const w = list.find((x) => x.key === 'water');
  assert.equal(w.need, 46);
  assert.equal(w.unit, 'gal');
  assert.ok(!list.some((x) => x.key === 'insulin'), 'n/a resources are not listed');
});

test('14. tubeless pump creates no reservoir demand; tubed does', () => {
  const r = run([], [t1dPerson({ pumpType: 'tubeless' })]);
  assert.equal(res(r, 'reservoirs').days, null);
  assert.ok(res(r, 'pumpSites').daily > 0);
  const tubed = run([item({ kind: 'reservoir', qty: 2, perUnit: { count: 10 } })], [t1dPerson({ pumpType: 'tubed' })]);
  near(res(tubed, 'reservoirs').days, 60);
});

// ---- extras: sanity checks on the helpers ----
test('defaultKcal table and overrides', () => {
  assert.equal(defaultKcal({ age: 2, sex: 'M' }), 1200);
  assert.equal(defaultKcal({ age: 10, sex: 'F' }), 1800);
  assert.equal(defaultKcal({ age: 16, sex: 'M' }), 2600);
  assert.equal(defaultKcal({ age: 25, sex: 'F' }), 2100);
  assert.equal(defaultKcal({ age: 40, sex: 'M' }), 2500);
  assert.equal(defaultKcal({ age: 70, sex: 'F' }), 1800);
  assert.equal(defaultKcal({ age: 40, sex: 'M', kcalPerDay: 3000 }), 3000);
});

test('defaultProteinG', () => {
  assert.equal(defaultProteinG({ age: 35, weightLb: 180 }), Math.round((180 / 2.2046) * 0.8));
  assert.equal(defaultProteinG({ age: 8 }), 30);
  assert.equal(defaultProteinG({ age: 35 }), 50);
});

test('pets add water and pet-food demand', () => {
  const r = run([item({ kind: 'pet_food', qty: 2, perUnit: { kcal: 10000 } })], [adultM], {}, [{ id: 'd', name: 'Rex', kcalPerDay: 1000, waterGalPerDay: 0.2 }]);
  near(res(r, 'water').daily, 1.2);
  assert.equal(res(r, 'petFood').days, 20);
});
