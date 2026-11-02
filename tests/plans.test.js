import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PACK_OPTIONS, isAtGrams, tierFor, buildLoadout, buildSections, progress, emptyRun, toggleLine, hideLine, unhideLine,
  addCustomLine, removeCustomLine, resetRun, applyDailyReset, dailyKeysOf, packedItems, loadoutAlerts, gobagFor,
  emptyGoPlan, normalizeGoPlan, goPlanIsEmpty, goPlanText, normalizeContact, sortContacts, moveContact, isMedsLine, stripBold,
} from '../js/plans.js';
import { KINDS, kindsForCategory } from '../js/categories.js';
import { computeRunway } from '../js/runway.js';

const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const loadout = readJson('./fixtures/plans-loadout.json');
const arrival = readJson('./fixtures/plans-arrival.json');
const gobag = readJson('./fixtures/plans-gobag.json');
const hurricane = readJson('./fixtures/plans-scenario-hurricane.json');
const tiers = loadout.tiers;

let seq = 0;
const item = (o) => ({ id: `i${++seq}`, name: 'Thing', category: 'tools', kind: 'tools_other', qty: 1, unit: 'each', location: '', ...o });
const dad = { id: 'p1', name: 'Dad', age: 40, meds: [{ name: 'Lisinopril', dose: '10 mg', perDay: 1 }], t1d: null };
const kid = { id: 'p2', name: 'Tee', age: 9, meds: [], t1d: { basalUnits: 10, bolusUnits: 10 } };
const texts = (lines) => lines.map((l) => l.text);
const tier = (b, id) => b.tiers.find((t) => t.id === id);

// ---------- isAtGrams / tierFor ----------
test('isAtGrams: any case, apostrophe or not, only the location counts', () => {
  assert.equal(isAtGrams({ location: "Gram's basement" }), true);
  assert.equal(isAtGrams({ location: 'at GRAMS house' }), true);
  assert.equal(isAtGrams({ location: 'Garage' }), false);
  assert.equal(isAtGrams({ location: '', name: "Gram's blanket" }), false);
  assert.equal(isAtGrams({}), false);
  assert.equal(isAtGrams(null), false);
});

test('tierFor: category match, kind match, pack override, and no', () => {
  assert.equal(tierFor(item({ category: 'water', kind: 'water' }), tiers), 't3');
  assert.equal(tierFor(item({ category: 'power', kind: 'battery_pack' }), tiers), 't2');
  assert.equal(tierFor(item({ category: 'meds', kind: 'med' }), tiers), 't1');
  assert.equal(tierFor(item({ category: 'water', kind: 'water', pack: 't1' }), tiers), 't1');
  assert.equal(tierFor(item({ category: 'water', kind: 'water', pack: 'no' }), tiers), null);
  assert.equal(tierFor(item({ category: 'water', kind: 'water', pack: 'bogus' }), tiers), 't3', 'unknown pack value falls back to auto');
  assert.equal(tierFor(item({ category: 'nonsense', kind: 'x' }), tiers), null);
  assert.equal(tierFor(null, tiers), null);
});

test('tierFor: a kind rule beats a category rule that sits in an earlier tier', () => {
  const custom = [
    { id: 'a', match: { categories: ['power'], kinds: [] } },
    { id: 'b', match: { categories: [], kinds: ['solar_panel'] } },
  ];
  assert.equal(tierFor({ category: 'power', kind: 'solar_panel' }, custom), 'b');
  assert.equal(tierFor({ category: 'power', kind: 'light' }, custom), 'a');
});

test('pack options: Auto first, and the value list matches the tier ids', () => {
  assert.deepEqual(PACK_OPTIONS.map((o) => o.value), ['', 't1', 't2', 't3', 't4', 'no']);
  assert.match(PACK_OPTIONS[0].label, /Auto/);
});

// ---------- buildLoadout ----------
const water = item({ id: 'w1', name: 'Water jugs', category: 'water', kind: 'water', qty: 6, unit: 'gal', location: 'Pantry' });
const ins = item({ id: 'in1', name: 'Humalog', category: 't1d', kind: 'insulin', qty: 2, unit: 'vial', location: 'Fridge' });
const gen = item({ id: 'g1', name: 'Power station', category: 'power', kind: 'battery_pack', qty: 1, location: 'Garage' });
const atG = item({ id: 'ag1', name: 'Old blankets', category: 'shelter', kind: 'shelter_other', location: "Gram's basement" });
const medBottle = item({ id: 'm1', name: 'Lisinopril bottle', category: 'meds', kind: 'med', qty: 1, unit: 'bottle', medName: 'lisinopril', location: 'Bathroom cabinet' });

test('buildLoadout: tiers in template order, each = fixed lines then inventory then custom', () => {
  const run = { ...emptyRun('loadout'), custom: [{ id: 'c-1', text: 'Board games', tier: 't4' }] };
  const b = buildLoadout(loadout, [water, ins, gen, medBottle, atG], run, [dad]);
  assert.deepEqual(b.tiers.map((t) => t.id), ['t1', 't2', 't3', 't4']);
  const t3 = tier(b, 't3');
  assert.deepEqual(texts(t3.lines), ['Water containers, filled', 'Water jugs']);
  assert.deepEqual(t3.lines.map((l) => l.type), ['fixed', 'item']);
  assert.equal(t3.lines[1].key, 'item:w1');
  assert.equal(t3.lines[1].location, 'Pantry');
  assert.equal(t3.lines[1].qty, '6 gal');
  assert.deepEqual(tier(b, 't4').lines.map((l) => l.type), ['fixed', 'fixed', 'custom']);
  assert.equal(tier(b, 't4').lines[2].text, 'Board games');
});

test('buildLoadout: inventory lines are sorted by location so you can walk the house', () => {
  const a = item({ id: 'a', name: 'Zed', category: 'water', kind: 'water', location: 'Attic' });
  const b2 = item({ id: 'b', name: 'Alpha', category: 'water', kind: 'water', location: 'Pantry' });
  const c = item({ id: 'c', name: 'Mid', category: 'water', kind: 'water', location: '' });
  const d = item({ id: 'd', name: 'Beta', category: 'water', kind: 'water', location: 'Pantry' });
  const built = buildLoadout(loadout, [c, b2, a, d], null, []);
  assert.deepEqual(texts(tier(built, 't3').lines).slice(1), ['Zed', 'Alpha', 'Beta', 'Mid']);
});

test('buildLoadout: pack override moves an item between tiers; pack:no drops it', () => {
  const moved = { ...water, pack: 't1' };
  let b = buildLoadout(loadout, [moved], null, []);
  assert.ok(texts(tier(b, 't1').lines).includes('Water jugs'));
  assert.ok(!texts(tier(b, 't3').lines).includes('Water jugs'));
  b = buildLoadout(loadout, [{ ...water, pack: 'no' }], null, []);
  assert.ok(b.tiers.every((t) => !texts(t.lines).includes('Water jugs')));
  assert.equal(b.atGrams.length, 0);
});

test("buildLoadout: items at Gram's go to their own list and are not counted", () => {
  const b = buildLoadout(loadout, [atG, water], null, []);
  assert.deepEqual(texts(b.atGrams), ['Old blankets']);
  assert.ok(b.tiers.every((t) => !texts(t.lines).includes('Old blankets')));
  const without = buildLoadout(loadout, [water], null, []);
  assert.equal(b.total, without.total);
});

test('buildLoadout: pack:no wins even at Gram\'s; zero-quantity items are skipped', () => {
  const b = buildLoadout(loadout, [{ ...atG, pack: 'no' }, { ...water, qty: 0 }], null, []);
  assert.equal(b.atGrams.length, 0);
  assert.ok(!texts(tier(b, 't3').lines).includes('Water jugs'));
});

test('buildLoadout: the meds line expands to one line per person medicine and absorbs the matching bottle', () => {
  const b = buildLoadout(loadout, [medBottle], null, [dad, kid]);
  const t1 = tier(b, 't1');
  const head = t1.lines.find((l) => l.id === 'meds');
  assert.equal(head.type, 'head');
  assert.equal(head.countable, false);
  const med = t1.lines.find((l) => l.type === 'med');
  assert.equal(med.text, 'Dad: Lisinopril 10 mg');
  assert.equal(med.key, 'med:p1:lisinopril');
  assert.equal(med.location, 'Bathroom cabinet');
  assert.equal(med.inStock, true);
  assert.ok(!t1.lines.some((l) => l.type === 'item'), 'the bottle is shown on the med line, not twice');
});

test('buildLoadout: with nobody on medication the meds line stays a normal checkable line', () => {
  const b = buildLoadout(loadout, [], null, [kid]);
  const line = tier(b, 't1').lines.find((l) => l.id === 'meds');
  assert.equal(line.type, 'fixed');
  assert.equal(line.countable, true);
});

test('buildLoadout: a medicine with no bottle in inventory still gets a line', () => {
  const b = buildLoadout(loadout, [], null, [dad]);
  const med = tier(b, 't1').lines.find((l) => l.type === 'med');
  assert.equal(med.inStock, false);
  assert.equal(med.location, '');
});

test('buildLoadout: checked state, expiry flag and progress', () => {
  const old = item({ id: 'x1', name: 'Old tabs', category: 'treatment', kind: 'purifier_tabs', expires: '2026-01-01', location: 'Shelf' });
  const run = { ...emptyRun('loadout'), checked: { 'item:x1': true, 'solar-panels': true } };
  const b = buildLoadout(loadout, [old], run, [], { today: '2026-11-02' });
  const line = tier(b, 't3').lines.find((l) => l.key === 'item:x1');
  assert.equal(line.expired, true);
  assert.equal(line.checked, true);
  assert.equal(tier(b, 't2').done, 1);
  assert.equal(b.done, 2);
  const noToday = buildLoadout(loadout, [old], run, []);
  assert.equal(tier(noToday, 't3').lines.find((l) => l.key === 'item:x1').expired, false);
});

test('buildLoadout: hidden lines are removed, counted, and come back with showHidden', () => {
  const run = { ...emptyRun('loadout'), hidden: ['bedding', 'item:w1'] };
  const b = buildLoadout(loadout, [water], run, []);
  assert.ok(!texts(tier(b, 't4').lines).includes('Bedding'));
  assert.ok(!texts(tier(b, 't3').lines).includes('Water jugs'));
  assert.equal(b.hiddenCount, 2);
  const all = buildLoadout(loadout, [water], run, [], { showHidden: true });
  const bed = tier(all, 't4').lines.find((l) => l.id === 'bedding');
  assert.equal(bed.hidden, true);
  assert.equal(bed.countable, false);
  assert.equal(all.total, b.total, 'hidden lines never count toward the total');
});

test('buildLoadout: a custom line with an unknown tier lands in the last tier; null run and empty input are safe', () => {
  const run = { ...emptyRun('loadout'), custom: [{ id: 'c-9', text: 'Lantern', tier: 'zz' }] };
  const b = buildLoadout(loadout, [], run, []);
  assert.ok(texts(tier(b, 't4').lines).includes('Lantern'));
  const empty = buildLoadout(null, null, null, null);
  assert.deepEqual(empty.tiers, []);
  assert.equal(empty.total, 0);
});

// ---------- progress ----------
test('progress: counts, percentage, daily skipping and plain arrays', () => {
  const run = { ...emptyRun('arrival'), checked: { unload: true, bg: true } };
  const b = buildSections(arrival.sections, run);
  assert.deepEqual(progress(b), { done: 2, total: 8, pct: 25 });
  assert.deepEqual(progress(b, { skipDaily: true }), { done: 1, total: 5, pct: 20 });
  assert.deepEqual(progress([]), { done: 0, total: 0, pct: 0 });
  assert.deepEqual(progress([{ checked: true }, { checked: false }]), { done: 1, total: 2, pct: 50 });
});

// ---------- run records ----------
test('toggleLine: first check stamps startedAt, unchecking removes the key, input is not mutated', () => {
  const r0 = emptyRun('loadout');
  const r1 = toggleLine(r0, 'wallet', 1000);
  assert.deepEqual(r0.checked, {});
  assert.equal(r1.checked.wallet, true);
  assert.equal(r1.startedAt, 1000);
  const r2 = toggleLine(r1, 'bedding', 2000);
  assert.equal(r2.startedAt, 1000);
  const r3 = toggleLine(r2, 'wallet', 3000);
  assert.equal('wallet' in r3.checked, false);
  assert.equal(r3.updatedAt, 3000);
});

test('hide / unhide / custom lines / reset', () => {
  let r = toggleLine(emptyRun('loadout'), 'bedding', 1);
  r = hideLine(r, 'bedding', 2);
  assert.deepEqual(r.hidden, ['bedding']);
  assert.equal('bedding' in r.checked, false, 'hiding unchecks');
  r = hideLine(r, 'bedding', 3);
  assert.deepEqual(r.hidden, ['bedding'], 'no duplicates');
  r = addCustomLine(r, { id: 'c-1', text: '  Lantern  ', tier: 't2' }, 4);
  r = addCustomLine(r, { id: 'c-2', text: '   ', tier: 't2' }, 5);
  assert.deepEqual(r.custom, [{ id: 'c-1', text: 'Lantern', tier: 't2' }]);
  r = toggleLine(r, 'c-1', 6);
  const reset = resetRun(r, 7);
  assert.deepEqual(reset.checked, {});
  assert.equal(reset.startedAt, 0);
  assert.equal(reset.custom.length, 1, 'reset keeps custom lines');
  assert.deepEqual(reset.hidden, ['bedding'], 'reset keeps hidden lines');
  assert.deepEqual(unhideLine(reset, 'bedding', 8).hidden, []);
  const gone = removeCustomLine(r, 'c-1', 9);
  assert.deepEqual(gone.custom, []);
  assert.equal('c-1' in gone.checked, false);
});

test('applyDailyReset: clears only daily keys on a new day, and stamps the date', () => {
  const dailyKeys = dailyKeysOf(arrival.sections, { custom: [{ id: 'c-d', text: 'x', section: 'daily' }, { id: 'c-o', text: 'y', section: 'first-day' }] });
  assert.deepEqual(dailyKeys.sort(), ['bg', 'c-d', 'gen-charge', 'water-left']);
  const run = { ...emptyRun('arrival'), dailyDate: '2026-11-01', checked: { bg: true, 'c-d': true, unload: true, panels: true } };
  const same = applyDailyReset(run, '2026-11-01', dailyKeys);
  assert.deepEqual(same.checked, run.checked);
  const next = applyDailyReset(run, '2026-11-02', dailyKeys);
  assert.deepEqual(next.checked, { unload: true, panels: true });
  assert.equal(next.dailyDate, '2026-11-02');
  assert.equal(run.dailyDate, '2026-11-01', 'input is not mutated');
  assert.equal(run.checked.bg, true);
});

test('applyDailyReset: a run with no date yet is only stamped; no keys given means date only', () => {
  const fresh = applyDailyReset({ ...emptyRun('arrival'), checked: { bg: true } }, '2026-11-02', ['bg']);
  assert.equal(fresh.checked.bg, true);
  assert.equal(fresh.dailyDate, '2026-11-02');
  const noKeys = applyDailyReset({ ...emptyRun('arrival'), dailyDate: '2026-11-01', checked: { bg: true } }, '2026-11-02');
  assert.equal(noKeys.checked.bg, true);
  assert.equal(noKeys.dailyDate, '2026-11-02');
});

// ---------- sections (arrival / scenarios) ----------
test('buildSections: arrival groups, daily flag, custom lines go to their section', () => {
  const run = { ...emptyRun('arrival'), custom: [{ id: 'c-1', text: 'Call Gram', section: 'first-hour' }], hidden: ['unload'] };
  const b = buildSections(arrival.sections, run);
  assert.deepEqual(b.groups.map((g) => g.id), ['first-hour', 'first-day', 'daily']);
  assert.equal(b.groups[2].daily, true);
  assert.equal(b.groups[0].lines.at(-1).text, 'Call Gram');
  assert.ok(!texts(b.groups[0].lines).includes('Unload in tier order'));
  assert.equal(b.hiddenCount, 1);
});

test('buildSections: scenario phases use the same machinery', () => {
  const b = buildSections(hurricane.phases, { ...emptyRun('scenario:hurricane'), checked: { charge: true } });
  assert.deepEqual(b.groups.map((g) => g.id), ['before', 'during', 'after']);
  assert.equal(b.groups[0].lines[1].source, 0);
  assert.equal(b.groups[0].lines[0].source, 1);
  assert.deepEqual(progress(b), { done: 1, total: 4, pct: 25 });
});

// ---------- packed runway ----------
test('packedItems feeds computeRunway with only the ticked inventory lines', () => {
  const jugs = item({ id: 'w2', name: 'Jugs', category: 'water', kind: 'water', qty: 10, unit: 'gal', perUnit: { water_gal: 1 } });
  const cans = item({ id: 'f2', name: 'Chili', category: 'food', kind: 'food', qty: 10, unit: 'can', perUnit: { kcal: 400, protein_g: 20 } });
  const run = { ...emptyRun('loadout'), checked: { 'item:w2': true, wallet: true } };
  const packed = packedItems([jugs, cans], run);
  assert.deepEqual(packed.map((i) => i.id), ['w2']);
  const rw = computeRunway(packed, [dad], [], {}, new Date('2026-11-02T12:00:00'));
  const water = rw.resources.find((r) => r.key === 'water');
  assert.equal(water.days, 10);
  assert.equal(packedItems([jugs], null).length, 0);
});

test('packedItems: ticking a person medicine line packs the matching bottle', () => {
  const other = item({ id: 'm2', name: 'Other pills', category: 'meds', kind: 'med', medName: 'Metformin', qty: 1 });
  const run = { ...emptyRun('loadout'), checked: { 'med:p1:lisinopril': true } };
  assert.deepEqual(packedItems([medBottle, other], run).map((i) => i.id), ['m1']);
  const none = { ...emptyRun('loadout'), checked: { 'med:p1:lisinopril': false } };
  assert.equal(packedItems([medBottle], none).length, 0);
});

// ---------- alerts ----------
test('loadoutAlerts: solar panel, power station, and insulin only when someone is T1D', () => {
  const ids = (items, people) => loadoutAlerts(items, people).map((a) => a.id);
  assert.deepEqual(ids([], []), ['no-solar-panel', 'no-power-station']);
  assert.deepEqual(ids([], [kid]), ['no-solar-panel', 'no-power-station', 'no-insulin']);
  assert.deepEqual(ids([gen], []), ['no-solar-panel']);
  const panel = item({ kind: 'solar_panel', category: 'power' });
  assert.deepEqual(ids([gen, panel], []), []);
  assert.deepEqual(ids([gen, panel, ins], [kid]), []);
  assert.deepEqual(ids([gen, { ...panel, qty: 0 }], []), ['no-solar-panel'], 'a zero-quantity panel is not a panel');
  const a = loadoutAlerts([], [])[0];
  assert.match(a.text, /solar panels/);
  assert.equal(a.kind, 'solar_panel');
});

test('the solar_panel kind exists, lives under power, and the add flow lists it', () => {
  assert.equal(KINDS.solar_panel.category, 'power');
  assert.equal(KINDS.solar_panel.label, 'Solar panel');
  assert.ok(kindsForCategory('power').some((k) => k.key === 'solar_panel'));
  assert.equal(tierFor({ category: 'power', kind: 'solar_panel' }, tiers), 't2');
});

// ---------- go-bags ----------
test('gobagFor: base always; T1D, meds and child sections only when they apply', () => {
  const adult = gobagFor({ id: 'a', name: 'Alex', age: 35, meds: [], t1d: null }, gobag);
  assert.deepEqual(adult.map((s) => s.id), ['base']);
  const t1d = gobagFor(kid, gobag);
  assert.deepEqual(t1d.map((s) => s.id), ['base', 'ifT1D', 'ifChild']);
  const meds = gobagFor(dad, gobag);
  assert.deepEqual(meds.map((s) => s.id), ['base', 'ifMeds']);
  const medSection = meds[1];
  assert.deepEqual(texts(medSection.items), ['A written medication list', 'Lisinopril 10 mg']);
  assert.equal(medSection.items[1].note, '1 per day');
  assert.equal(gobagFor({ name: 'Eighteen', age: 18 }, gobag).some((s) => s.id === 'ifChild'), false);
});

test('gobagFor: no ifChild list means no child section; pets get only the pet kit; empty template is safe', () => {
  const noKids = gobagFor(kid, { ...gobag, ifChild: undefined });
  assert.equal(noKids.some((s) => s.id === 'ifChild'), false);
  const pet = gobagFor({ id: 'pet1', name: 'Rex' }, gobag, true);
  assert.deepEqual(pet.map((s) => s.id), ['ifPet']);
  assert.deepEqual(gobagFor(dad, null), [{ id: 'ifMeds', title: 'Medications', items: [{ id: 'med-lisinopril', text: 'Lisinopril 10 mg', note: '1 per day' }] }]);
  const age = gobagFor({ name: 'No age', meds: [] }, gobag);
  assert.equal(age.some((s) => s.id === 'ifChild'), false, 'unknown age is not treated as a child');
});

// ---------- go plan ----------
test('normalizeGoPlan fills defaults and survives junk', () => {
  const e = normalizeGoPlan(null);
  assert.equal(e.destination.name, "Gram's house");
  assert.deepEqual(e.routes.map((r) => r.label), ['Primary', 'Alternate']);
  const p = normalizeGoPlan({ destination: { name: '  ' }, triggers: ['a', 5], assignments: [{ personId: 'p1', task: 'Insulin' }, null], routes: 'x' });
  assert.equal(p.destination.name, "Gram's house");
  assert.deepEqual(p.triggers, ['a', '']);
  assert.equal(p.assignments.length, 2);
  assert.equal(p.routes.length, 2);
});

test('goPlanIsEmpty: defaults are empty, anything typed is not', () => {
  assert.equal(goPlanIsEmpty(null), true);
  assert.equal(goPlanIsEmpty(emptyGoPlan()), true);
  assert.equal(goPlanIsEmpty({ ...emptyGoPlan(), leaveNote: 'Gone to Gram' }), false);
  const renamed = emptyGoPlan(); renamed.destination.name = "Aunt Lee's";
  assert.equal(goPlanIsEmpty(renamed), false);
});

test('goPlanText: includes what was typed, leaves out the rest, resolves names', () => {
  const plan = {
    destination: { name: "Gram's house", pinId: 'pin1', address: '12 Example Lane', notes: 'Well water' },
    fallback: { name: 'Library lot', pinId: null, notes: '' },
    routes: [{ label: 'Primary', text: 'Take the back road' }, { label: 'Alternate', text: '' }],
    triggers: ['Evacuation order', ''],
    assignments: [{ personId: 'p1', task: 'Load the car' }, { personId: 'gone', task: 'Pets' }, { personId: 'p2', task: '' }],
    vehicle: 'Minivan', leaveNote: '',
  };
  const text = goPlanText(plan, [dad, kid], [{ id: 'pin1', name: "Gram's pin" }]);
  assert.match(text, /^GO PLAN: Gram's house/);
  assert.match(text, /Address: 12 Example Lane/);
  assert.match(text, /Map pin: Gram's pin/);
  assert.match(text, /About the place: Well water/);
  assert.match(text, /If we can't get there: Library lot/);
  assert.match(text, /- Primary: Take the back road/);
  assert.ok(!/Alternate/.test(text));
  assert.match(text, /- Evacuation order/);
  assert.match(text, /- Dad: Load the car/);
  assert.match(text, /- Someone: Pets/);
  assert.ok(!/Tee/.test(text), 'a row with no task is left out');
  assert.match(text, /Vehicle: Minivan/);
  assert.ok(!/Note to leave/.test(text));
  assert.equal(goPlanText(null, [], []), "GO PLAN: Gram's house");
});

test('stripBold removes ** markers', () => {
  assert.equal(stripBold('An **official** order'), 'An official order');
  assert.equal(stripBold(undefined), '');
});

test('isMedsLine finds the medications line by id, expand flag, or wording', () => {
  assert.equal(isMedsLine({ id: 'meds', text: 'x' }), true);
  assert.equal(isMedsLine({ id: 'all-medications', text: 'x' }), true);
  assert.equal(isMedsLine({ id: 'q', text: "Everyone's medications" }), true);
  assert.equal(isMedsLine({ id: 'q', text: 'Anything', expand: 'meds' }), true);
  assert.equal(isMedsLine({ id: 'insulin-cooler', text: 'Insulin out of the fridge' }), false);
  assert.equal(isMedsLine({ id: 'comedy', text: 'Board games' }), false);
});

// ---------- contacts ----------
test('normalizeContact trims, drops empty phones, defaults labels', () => {
  const c = normalizeContact({ id: 'c1', name: ' Aunt Lee ', phones: [{ label: '', number: ' 555 ' }, { label: 'Home', number: '' }], outOfArea: 1 });
  assert.equal(c.name, 'Aunt Lee');
  assert.deepEqual(c.phones, [{ label: 'Cell', number: '555' }]);
  assert.equal(c.outOfArea, true);
  assert.equal(c.order, 0);
});

test('sortContacts: out-of-area first, then order, then name', () => {
  const list = [
    { id: 'a', name: 'Zed', order: 0 }, { id: 'b', name: 'Amy', order: 1 }, { id: 'c', name: 'Ooa', order: 5, outOfArea: true }, { id: 'd', name: 'Bob', order: 0 },
  ];
  assert.deepEqual(sortContacts(list).map((c) => c.id), ['c', 'd', 'a', 'b']);
  assert.deepEqual(list.map((c) => c.id), ['a', 'b', 'c', 'd'], 'input is not reordered');
});

test('moveContact: swaps neighbours, renumbers, refuses to cross the out-of-area line or fall off the ends', () => {
  const list = [
    { id: 'o', name: 'Ooa', order: 0, outOfArea: true }, { id: 'a', name: 'A', order: 1 }, { id: 'b', name: 'B', order: 2 }, { id: 'c', name: 'C', order: 3 },
  ];
  const up = moveContact(list, 'c', -1);
  const after = sortContacts(list.map((c) => up.find((u) => u.id === c.id) || c));
  assert.deepEqual(after.map((c) => c.id), ['o', 'a', 'c', 'b']);
  assert.deepEqual(up.map((c) => c.id).sort(), ['b', 'c']);
  assert.deepEqual(moveContact(list, 'a', -1), [], 'cannot move above the out-of-area contact');
  assert.deepEqual(moveContact(list, 'c', 1), [], 'last stays last');
  assert.deepEqual(moveContact(list, 'nope', 1), []);
  const messy = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }];
  const moved = moveContact(messy, 'y', -1);
  assert.deepEqual(sortContacts(messy.map((c) => moved.find((u) => u.id === c.id) || c)).map((c) => c.id), ['y', 'x']);
});
