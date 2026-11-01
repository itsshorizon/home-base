// Weak spots: gaps in the household's preparedness that the runway numbers can't show
// (no CO detector, no backup insulin for a pump, no can opener...).
// PURE: no DOM, no IndexedDB, and no Date.now(). `now` is always passed in. Imports cleanly in Node.
import { ROOM_TEMP_DAYS, LONG_ACTING } from './categories.js';
import { usableItems, DEFAULT_SETTINGS } from './runway.js';
import { daysUntil } from './format.js';

export const SEVERITY_ORDER = { red: 0, amber: 1, info: 2 };
export const WATER_TARGET_DAYS = 14; // FEMA / Ready.gov: at least a 2-week supply of water
export const MED_LOW_DAYS = 14;
const BLEACH_MAX_AGE_DAYS = 365;
const DAY_MS = 86400000;

const addHref = (cat, kind) => `#/add?cat=${cat}&kind=${kind}`;
const guideHref = (id) => `#/guide/${id}`;

// An "add" rule: fix = go to the Add form with the kind preselected, howto = optional guide.
function addRule(id, severity, title, detail, cat, kind, label, guide) {
  const w = { id, severity, title, detail, fix: { label, href: addHref(cat, kind) } };
  if (guide) w.howto = { label: 'How-to', href: guideHref(guide), guide };
  return w;
}

const lc = (v) => String(v ?? '').trim().toLowerCase();

export function computeWeakSpots(items, people, pets, settingsIn, runway, now) {
  const settings = { ...DEFAULT_SETTINGS, ...(settingsIn || {}) };
  people = people || [];
  pets = pets || [];
  // Same filtering as the runway (qty > 0 and not expired). Food-spoilage rules for grid-down
  // don't apply to "do I own a CO detector / glucagon", so presence checks ignore grid-down mode.
  const usable = usableItems(items || [], { ...settings, gridDown: false }, now);
  const has = (kind) => usable.some((i) => i.kind === kind);

  const t1dPeople = people.filter((p) => p && p.t1d);
  const t1d = t1dPeople.length > 0;
  const pumpUsers = t1dPeople.filter((p) => p.t1d.usesPump);
  const cgmUsers = t1dPeople.filter((p) => p.t1d.usesCGM);
  const out = [];
  const add = (w) => out.push(w);

  // ---- Type 1 diabetes ----
  if (pumpUsers.length && !usable.some((i) => i.kind === 'insulin' && LONG_ACTING.includes(i.insulinType))) {
    add(addRule('pump-no-basal', 'red', 'Pump backup: no long-acting insulin',
      'If the pump fails you need long-acting insulin and a way to inject it (Lantus, Basaglar, Levemir, Toujeo, Tresiba or Humulin N). Ask your diabetes team how much to keep for backup.',
      't1d', 'insulin', 'Add long-acting insulin', 't1d-pump-failure'));
  }
  if (pumpUsers.length && !has('pen_needles') && !has('syringes')) {
    add(addRule('pump-no-needles', 'red', 'Pump backup: no pen needles or syringes',
      'Without a pump you inject insulin. Keep pen needles or syringes for that.',
      't1d', 'pen_needles', 'Add pen needles', 't1d-pump-failure'));
  }
  if (t1d && !has('glucagon')) {
    add(addRule('t1d-no-glucagon', 'red', 'No glucagon for severe lows',
      'Glucagon treats a severe low when someone can\'t swallow safely. Keep an unexpired one where you can reach it.',
      't1d', 'glucagon', 'Add glucagon', 't1d-glucagon'));
  }
  if (cgmUsers.length && !has('test_strips')) {
    add(addRule('cgm-no-strips', 'red', 'No fingerstick backup if the CGM fails',
      'Sensors fail, run out, or lose signal. A meter and test strips let you check your blood sugar anyway.',
      't1d', 'test_strips', 'Add test strips', 't1d-cgm-failure'));
  }
  if (t1d && !has('ketone_strips')) {
    add(addRule('t1d-no-ketone', 'amber', 'No ketone strips',
      'Ketone strips help you catch dangerous illness or missed insulin early.',
      't1d', 'ketone_strips', 'Add ketone strips', 't1d-sick-days-ketones'));
  }
  if (t1d && !has('glucose_tabs')) {
    add(addRule('t1d-no-fast-sugar', 'amber', 'No fast sugar for lows (glucose tabs or gel)',
      'Fast-acting sugar is the first treatment for a low. Keep some at home and in every bag.',
      't1d', 'glucose_tabs', 'Add glucose tabs', 't1d-hypo'));
  }
  if (t1d && !has('insulin_cooler')) {
    add(addRule('t1d-no-cooler', 'amber', 'No way to keep insulin cool without power',
      'Insulin spoils in heat. A cooling pouch or cooler keeps it usable when the fridge is off.',
      't1d', 'insulin_cooler', 'Add a cooling pouch', 't1d-insulin-storage'));
  }
  const noPlan = t1dPeople.filter((p) => !(p.t1d.plan && p.t1d.plan.backupBasalUnits !== null
    && p.t1d.plan.backupBasalUnits !== undefined && p.t1d.plan.backupBasalUnits !== ''));
  if (noPlan.length) {
    const first = noPlan[0];
    const many = noPlan.length > 1;
    const names = noPlan.map((p) => p.name || 'this person');
    add({
      id: 't1d-no-plan', severity: 'amber',
      title: many ? `Fill in emergency plans for ${names.join(', ')}` : `Fill in ${names[0]}'s emergency plan`,
      detail: 'Write down the backup long-acting dose, ratios and phone numbers your diabetes team gave you, so they are one tap away in an emergency. The app never calculates doses.',
      fix: { label: 'Fill in plan', href: `#/person/${first.id}` },
    });
  }
  // Opened insulin that has been out of the fridge / in use longer than its label allows.
  const old = usable
    .filter((i) => i.kind === 'insulin' && i.opened && i.openedAt)
    .map((i) => {
      const type = ROOM_TEMP_DAYS[i.insulinType] !== undefined ? i.insulinType : 'other';
      const limit = ROOM_TEMP_DAYS[type];
      const d = daysUntil(i.openedAt, now);
      return { i, limit, age: d === null ? null : -d };
    })
    .filter((x) => x.age !== null && x.age > x.limit)
    .sort((a, b) => (b.age - b.limit) - (a.age - a.limit));
  if (old.length) {
    const top = old[0];
    add({
      id: 'insulin-open-old', severity: 'amber',
      title: old.length === 1
        ? `${top.i.name}: opened ${top.age} days ago, past its in-use limit`
        : `${old.length} insulin items are past their in-use limit`,
      detail: old.map((x) => `${x.i.name}: opened ${x.age} days ago, limit ${x.limit} days`).join('. ')
        + '. Check your package insert; use an unopened one instead.',
      fix: { label: 'Open item', href: `#/item/${top.i.id}` },
      howto: { label: 'How-to', href: guideHref('t1d-insulin-storage'), guide: 't1d-insulin-storage' },
    });
  }

  // ---- water ----
  const water = runway && (runway.resources || []).find((r) => r.key === 'water');
  if (water && water.days !== null && water.days < WATER_TARGET_DAYS) {
    add(addRule('water-low', 'red', 'Less than 2 weeks of water',
      `You have about ${Math.floor(water.days)} day${Math.floor(water.days) === 1 ? '' : 's'} of drinking water. FEMA (Ready.gov) recommends at least a 2-week supply.`,
      'water', 'water', 'Add water', 'water-how-much'));
  }
  if (!usable.some((i) => Number(i.perUnit && i.perUnit.treat_gal) > 0)) {
    add(addRule('no-treatment', 'amber', 'No way to treat water',
      'A filter, purification tablets or bleach lets you make creek, rain or tap water safe when the supply is cut off.',
      'treatment', 'filter', 'Add a filter', 'water-filters'));
  }
  const nowMs = now.getTime();
  const bleachOld = (items || []).some((i) => {
    if (i.kind !== 'bleach' || !(Number(i.qty) > 0)) return false;
    const created = i.createdAt ? Date.parse(i.createdAt) : NaN;
    if (Number.isFinite(created) && nowMs - created > BLEACH_MAX_AGE_DAYS * DAY_MS) return true;
    if (i.expires) { const d = daysUntil(i.expires, now); if (d !== null && d < 0) return true; }
    return false;
  });
  if (bleachOld) {
    add(addRule('bleach-old', 'amber', 'Bleach may be too weak',
      'Household bleach loses strength with time. Bleach more than about a year old may not disinfect water properly. Replace it.',
      'treatment', 'bleach', 'Add fresh bleach', 'water-bleach'));
  }

  // ---- fuel, food, gear ----
  if ((has('fuel_butane') || has('fuel_propane') || has('stove')) && !has('co_detector')) {
    add(addRule('fuel-no-co', 'red', 'Fuel stoves but no CO detector',
      'Burning fuel makes carbon monoxide, which you cannot see or smell. A battery CO detector warns you before it harms anyone.',
      'tools', 'co_detector', 'Add a CO detector', 'co-safety'));
  }
  if (usable.some((i) => (i.kind === 'food' || i.category === 'food') && lc(i.unit) === 'can') && !has('can_opener')) {
    add(addRule('cans-no-opener', 'amber', 'Canned food but no manual can opener',
      'An electric opener won\'t work in an outage. Keep a manual one.', 'tools', 'can_opener', 'Add a can opener'));
  }
  if (!has('weather_radio')) {
    add(addRule('no-weather-radio', 'amber', 'No NOAA weather radio',
      'A battery or hand-crank weather radio gets alerts when phones and internet are down.',
      'comms', 'weather_radio', 'Add a weather radio'));
  }
  if (!has('first_aid_kit')) {
    add(addRule('no-first-aid', 'amber', 'No first aid kit', 'Keep a stocked kit where everyone knows to find it.',
      'firstaid', 'first_aid_kit', 'Add a first aid kit', 'firstaid-kit-checklist'));
  }
  if (!has('tourniquet')) {
    add(addRule('no-tourniquet', 'info', 'No tourniquet', 'A tourniquet can save a life from severe bleeding in a limb. Get training too.',
      'firstaid', 'tourniquet', 'Add a tourniquet', 'firstaid-bleeding'));
  }
  if (!has('light')) {
    add(addRule('no-light', 'amber', 'No flashlight or lantern', 'Keep a light with spare batteries for every adult.',
      'power', 'light', 'Add a light', 'power-phone-battery'));
  }
  if (!usable.some((i) => Number(i.perUnit && i.perUnit.wh) > 0) && !has('battery_cells')) {
    add(addRule('no-power', 'info', 'No stored power', 'A power bank or battery pack keeps phones and medical devices charged.',
      'power', 'power_bank', 'Add a power bank', 'power-phone-battery'));
  }
  if (!has('fire_extinguisher')) {
    add(addRule('no-extinguisher', 'amber', 'No fire extinguisher', 'Keep one in the kitchen and know how to use it.',
      'tools', 'fire_extinguisher', 'Add an extinguisher'));
  }
  if (!has('smoke_detector')) {
    add(addRule('no-smoke', 'info', 'No smoke detector tracked', 'Smoke detectors need working batteries. Add yours to track them.',
      'tools', 'smoke_detector', 'Add a smoke detector'));
  }
  if (pets.length && !has('pet_food')) {
    add(addRule('pets-no-food', 'amber', 'No pet food stocked', 'Your pets need food and water in an emergency too.',
      'pets', 'pet_food', 'Add pet food'));
  }

  // ---- medicines running low ----
  if (runway) {
    for (const r of runway.resources || []) {
      if (!r.key.startsWith('med:') || r.days === null || !(r.days < MED_LOW_DAYS)) continue;
      const rest = r.key.slice(4);
      const personId = rest.slice(0, rest.indexOf(':'));
      const medKey = rest.slice(rest.indexOf(':') + 1);
      const person = people.find((p) => p.id === personId);
      const med = person && (person.meds || []).find((m) => lc(m.name) === medKey);
      const medName = med ? String(med.name).trim() : medKey;
      const days = Math.floor(r.days);
      add({
        id: `med-low:${personId}:${medKey}`, severity: 'red',
        title: `Refill ${medName} for ${person ? person.name : 'someone'} (${days} day${days === 1 ? '' : 's'} left)`,
        detail: 'Refill now. Ask the pharmacy about an early or emergency refill if you need one.',
        fix: { label: 'Add medication', href: addHref('meds', 'med') },
      });
    }
  }

  if (!has('potassium_iodide')) {
    add(addRule('no-ki', 'info', 'No potassium iodide (KI)',
      'Henrico is outside the 10-mile emergency zones of North Anna and Surry. KI is mainly for people closer in; see the nuclear guide.',
      'meds', 'potassium_iodide', 'Add KI', 'hazard-nuclear'));
  }

  // stable sort: red, then amber, then info; table order kept inside each group
  return out
    .map((w, n) => ({ w, n }))
    .sort((a, b) => SEVERITY_ORDER[a.w.severity] - SEVERITY_ORDER[b.w.severity] || a.n - b.n)
    .map((x) => x.w);
}

// Hide info-level spots the user dismissed. Red and amber can never be hidden.
export function activeWeakSpots(list, settings) {
  const gone = new Set((settings && settings.dismissedWeakSpots) || []);
  return list.filter((w) => w.severity !== 'info' || !gone.has(w.id));
}

export function countBySeverity(list) {
  const c = { red: 0, amber: 0, info: 0 };
  for (const w of list) c[w.severity] += 1;
  return c;
}
