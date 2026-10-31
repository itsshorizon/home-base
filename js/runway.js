// Runway engine: how many days can the household last on what it has?
// PURE: no DOM, no IndexedDB, and no Date.now(). `now` is always passed in.
import { ROOM_TEMP_DAYS } from './categories.js';

export const DEFAULT_SETTINGS = {
  rationPct: 100, waterGalPerPersonDay: 1, stoveHoursPerDay: 1, peopleOverride: null,
  insulinUnitsOverride: null, gridDown: false, gridDownSince: null, insulinCooling: false,
  whPerDay: 0, tpRollsPerPersonWeek: 1.5, targetDays: 30, redBelowDays: 14, greenAtDays: 30,
  apiKey: '', aiModel: 'claude-opus-5-5', lastBackupAt: null, installBannerDismissed: false,
};

export const FRIDGE_SAFE_HOURS = 4; // USDA/FoodSafety.gov: fridge food after 4 h without power
export const FREEZER_SAFE_HOURS = 48; // full freezer; half-full = 24 (we use 48 and say so in the UI)

// USDA Dietary Guidelines, "moderately active", rounded. Rows: [maxAgeInclusive, M, F]
const KCAL_TABLE = [
  [3, 1200, 1200],
  [8, 1500, 1500],
  [13, 2000, 1800],
  [18, 2600, 2000],
  [30, 2700, 2100],
  [50, 2500, 2000],
  [Infinity, 2300, 1800],
];

function isSet(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}

export function defaultKcal(person) {
  if (isSet(person.kcalPerDay) && Number(person.kcalPerDay) > 0) return Number(person.kcalPerDay);
  const age = isSet(person.age) ? Number(person.age) : 35; // unknown age: assume an adult
  const row = KCAL_TABLE.find((r) => age <= r[0]) || KCAL_TABLE[KCAL_TABLE.length - 1];
  return person.sex === 'F' ? row[2] : row[1];
}

export function defaultProteinG(person) {
  if (isSet(person.weightLb) && Number(person.weightLb) > 0) {
    return Math.round((Number(person.weightLb) / 2.2046) * 0.8);
  }
  const age = isSet(person.age) ? Number(person.age) : 35;
  return age < 14 ? 30 : 50;
}

export function statusFor(days, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (days < s.redBelowDays) return 'red';
  if (days < s.greenAtDays) return 'amber';
  return 'green';
}

// Local calendar date of `now` as YYYY-MM-DD (an item expiring today still counts).
export function localDateString(now) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function gridDownHours(settings, now) {
  if (!settings || !settings.gridDown || !settings.gridDownSince) return 0;
  const since = new Date(settings.gridDownSince).getTime();
  if (!Number.isFinite(since)) return 0;
  return Math.max(0, (now.getTime() - since) / 3.6e6);
}

// Items that count toward the runway right now.
export function usableItems(items, settings, now) {
  const today = localDateString(now);
  const hours = gridDownHours(settings, now);
  return (items || []).filter((it) => {
    if (!(Number(it.qty) > 0)) return false;
    if (it.expires && it.expires < today) return false;
    if (settings.gridDown) {
      // Insulin is not dropped from the count when the fridge warms: it is limited by its
      // room-temperature life instead (see the grid-down cap in computeRunway).
      if (it.kind !== 'insulin') {
        if (it.storage === 'fridge' && hours > FRIDGE_SAFE_HOURS) return false;
        if (it.storage === 'freezer' && hours > FREEZER_SAFE_HOURS) return false;
      }
    }
    return true;
  });
}

// Longest room-temperature life among the insulin you hold (all of it warms at once).
export function insulinRoomLifeDays(items, settings, now) {
  const ins = usableItems(items, { ...settings, gridDown: false }, now).filter((i) => i.kind === 'insulin');
  if (!ins.length) return null;
  return Math.max(...ins.map((i) => ROOM_TEMP_DAYS[i.insulinType || 'other'] ?? ROOM_TEMP_DAYS.other));
}

// Resources where having none is a real emergency: they stay in the bottleneck at 0 days.
const CRITICAL_KEYS = new Set(['calories', 'water', 'insulin', 'strips']);
const isCritical = (key) => CRITICAL_KEYS.has(key) || key.startsWith('med:');

const num = (v) => (isSet(v) ? Number(v) : 0);
const perUnit = (it, f) => num(it.perUnit && it.perUnit[f]);
const countPer = (it) => (it.perUnit && isSet(it.perUnit.count) ? Number(it.perUnit.count) : 1);

function sumBy(items, fn) {
  let t = 0;
  for (const it of items) t += fn(it);
  return t;
}

export function computeRunway(items, people, pets, settingsIn, now) {
  const settings = { ...DEFAULT_SETTINGS, ...(settingsIn || {}) };
  people = people || [];
  pets = pets || [];
  const hours = gridDownHours(settings, now);
  const usable = usableItems(items, settings, now);
  const ration = settings.rationPct / 100;

  // ---- head count and per-person daily needs ----
  const hasPeople = people.length > 0;
  const override = isSet(settings.peopleOverride) ? Number(settings.peopleOverride) : null;
  const n = override ?? people.length;
  let dailyKcal; let dailyProtein; let dailyWater;
  let defaultAdult = false;
  if (!hasPeople) {
    defaultAdult = true;
    const heads = override ?? 1;
    dailyKcal = 2000 * heads;
    dailyProtein = 50 * heads;
    dailyWater = settings.waterGalPerPersonDay * heads;
  } else {
    const scale = n / people.length;
    dailyKcal = sumBy(people, (p) => defaultKcal(p)) * scale;
    dailyProtein = sumBy(people, (p) => defaultProteinG(p)) * scale;
    dailyWater = sumBy(people, (p) => (isSet(p.waterGalPerDay) ? Number(p.waterGalPerDay) : settings.waterGalPerPersonDay)) * scale;
  }
  const petWater = sumBy(pets, (p) => num(p.waterGalPerDay));
  const petKcal = sumBy(pets, (p) => num(p.kcalPerDay));
  const waterDaily = dailyWater + petWater;
  const heads = hasPeople ? n : (override ?? 1);

  const t1d = people.filter((p) => p.t1d);
  const ofKind = (...kinds) => usable.filter((i) => kinds.includes(i.kind));
  const foodNote = defaultAdult ? 'Assumes one adult: add your household for accurate numbers.' : '';

  const defs = [];
  const def = (key, label, supply, supplyUnit, daily, dailyUnit, note = '') =>
    defs.push({ key, label, supply, supplyUnit, daily, dailyUnit, note });

  def('calories', 'Calories', sumBy(ofKind('food'), (i) => i.qty * perUnit(i, 'kcal')), 'kcal', dailyKcal * ration, 'kcal/day', foodNote);
  def('protein', 'Protein', sumBy(ofKind('food'), (i) => i.qty * perUnit(i, 'protein_g')), 'g', dailyProtein * ration, 'g/day', foodNote);
  def('water', 'Drinking water', sumBy(usable, (i) => i.qty * perUnit(i, 'water_gal')), 'gal', waterDaily, 'gal/day', '');
  def('treatment', 'Water treatment', sumBy(usable, (i) => i.qty * perUnit(i, 'treat_gal')), 'gal', waterDaily, 'gal/day',
    'Days of water you can make safe from a river or creek');
  def('fuel', 'Cooking fuel', sumBy(usable, (i) => i.qty * perUnit(i, 'fuel_hours')), 'burn-hrs', num(settings.stoveHoursPerDay), 'hrs/day', '');

  const insulinDaily = isSet(settings.insulinUnitsOverride)
    ? Number(settings.insulinUnitsOverride)
    : sumBy(t1d, (p) => num(p.t1d.basalUnits) + num(p.t1d.bolusUnits));
  def('insulin', 'Insulin', sumBy(ofKind('insulin'), (i) => i.qty * perUnit(i, 'insulin_units')), 'units', insulinDaily, 'units/day', '');
  def('pumpSites', 'Pump pods / sites', sumBy(ofKind('pump_site'), (i) => i.qty * countPer(i)), 'sites',
    sumBy(t1d.filter((p) => p.t1d.usesPump), (p) => 1 / (num(p.t1d.pumpChangeDays) || 3)), 'sites/day', '');
  def('reservoirs', 'Pump reservoirs', sumBy(ofKind('reservoir'), (i) => i.qty * countPer(i)), 'reservoirs',
    sumBy(t1d.filter((p) => p.t1d.usesPump && p.t1d.pumpType === 'tubed'), (p) => 1 / (num(p.t1d.pumpChangeDays) || 3)), 'reservoirs/day', '');
  def('cgm', 'CGM sensors', sumBy(ofKind('cgm_sensor'), (i) => i.qty * countPer(i)), 'sensors',
    sumBy(t1d.filter((p) => p.t1d.usesCGM), (p) => 1 / (num(p.t1d.cgmDays) || 10)), 'sensors/day', '');
  def('strips', 'Test strips', sumBy(ofKind('test_strips'), (i) => i.qty * countPer(i)), 'strips',
    sumBy(t1d, (p) => num(p.t1d.stripsPerDay)), 'strips/day', '');
  def('ketones', 'Ketone strips', sumBy(ofKind('ketone_strips'), (i) => i.qty * countPer(i)), 'strips',
    sumBy(t1d, (p) => num(p.t1d.ketoneStripsPerDay)), 'strips/day', '');
  def('needles', 'Needles / syringes', sumBy(ofKind('pen_needles', 'syringes'), (i) => i.qty * countPer(i)), 'needles',
    sumBy(t1d, (p) => num(p.t1d.injectionsPerDay)), 'needles/day', '');

  for (const p of people) {
    for (const m of p.meds || []) {
      const name = String(m.name || '').trim().toLowerCase();
      if (!name) continue;
      const supply = sumBy(
        ofKind('med').filter((i) => String(i.medName || '').trim().toLowerCase() === name),
        (i) => i.qty * countPer(i),
      );
      def(`med:${p.id}:${name}`, `${p.name || 'Person'} — ${String(m.name).trim()}`, supply, 'doses',
        isSet(m.perDay) ? Number(m.perDay) : 1, 'doses/day', '');
    }
  }

  def('power', 'Power', sumBy(usable, (i) => i.qty * perUnit(i, 'wh')), 'Wh', num(settings.whPerDay), 'Wh/day', '');
  def('tp', 'Toilet paper', sumBy(ofKind('toilet_paper'), (i) => i.qty * countPer(i)), 'rolls',
    (heads * num(settings.tpRollsPerPersonWeek)) / 7, 'rolls/day', '');
  def('petFood', 'Pet food', sumBy(ofKind('pet_food'), (i) => i.qty * perUnit(i, 'kcal')), 'kcal', petKcal, 'kcal/day', '');

  // ---- days, status, insulin heat cap ----
  const insulinLife = insulinRoomLifeDays(items, settings, now);
  const resources = defs.map((r) => {
    let days = r.daily > 0 ? r.supply / r.daily : null;
    const out = { ...r, days, critical: isCritical(r.key) };
    if (r.key === 'insulin' && days !== null && settings.gridDown && !settings.insulinCooling && hours > 0 && insulinLife !== null) {
      const remaining = Math.max(0, insulinLife - hours / 24);
      if (remaining < days) {
        out.days = remaining;
        out.capped = true;
        out.note = `Limited by heat: insulin out of the fridge lasts ~${insulinLife} days. Keep it cool (Frio pouch, evaporative cooling) to remove this limit.`;
      }
    }
    if (out.days === null) {
      out.note = 'Not used by your household';
      out.status = 'na';
    } else if (out.supply === 0 && !out.critical) {
      // Nothing stocked for something non-essential: a weak spot to fix, not a bottleneck.
      out.status = 'missing';
      out.note = 'None stocked yet';
    } else {
      out.status = statusFor(out.days, settings);
    }
    return out;
  });

  const missingList = resources.filter((r) => r.status === 'missing');
  const applicable = resources.filter((r) => r.days !== null && r.status !== 'missing').sort((a, b) => a.days - b.days); // stable
  const notApplicable = resources.filter((r) => r.days === null);
  const ordered = [...applicable, ...missingList, ...notApplicable];

  return {
    resources: ordered,
    bottleneck: applicable.length ? applicable[0].key : null,
    missing: missingList.map((r) => r.key),
    gridDownHours: hours,
    headCount: heads,
    defaultAdult,
  };
}

export function shoppingList(runway, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const out = [];
  for (const r of runway.resources) {
    if (r.days === null || !(r.days < s.targetDays)) continue;
    const raw = (s.targetDays - r.days) * r.daily;
    const eps = 1e-9;
    const need = r.supplyUnit === 'gal' ? Math.ceil(raw * 10 - eps) / 10 : Math.ceil(raw - eps);
    out.push({ key: r.key, label: r.label, need, unit: r.supplyUnit });
  }
  return out;
}
