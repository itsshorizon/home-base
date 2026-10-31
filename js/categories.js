// Categories, item "kinds" (templates) and the insulin room-temperature table.
// Pure data: no DOM, no storage, so Node can import it (runway.js needs ROOM_TEMP_DAYS).

export const CATEGORIES = [
  { key: 'food', label: 'Food', icon: '🥫' },
  { key: 'water', label: 'Water', icon: '💧' },
  { key: 'treatment', label: 'Water Treatment', icon: '🧪' },
  { key: 'cooking', label: 'Cooking & Fuel', icon: '🔥' },
  { key: 'power', label: 'Power & Light', icon: '🔋' },
  { key: 't1d', label: 'T1D Supplies', icon: '🩸' },
  { key: 'meds', label: 'Medications', icon: '💊' },
  { key: 'firstaid', label: 'First Aid', icon: '⛑️' },
  { key: 'sanitation', label: 'Hygiene & Sanitation', icon: '🧻' },
  { key: 'shelter', label: 'Shelter & Warmth', icon: '🛏️' },
  { key: 'tools', label: 'Tools', icon: '🛠️' },
  { key: 'comms', label: 'Comms Gear', icon: '📻' },
  { key: 'docs', label: 'Documents & Cash', icon: '📄' },
  { key: 'pets', label: 'Pets', icon: '🐾' },
];

export function categoryByKey(key) {
  return CATEGORIES.find((c) => c.key === key) || null;
}

// Human labels for the per-unit numbers an item can carry.
// `count` is special: each kind may give its own label/noun (see KINDS below).
export const FIELD_META = {
  kcal: { label: 'Calories', unit: 'kcal' },
  protein_g: { label: 'Protein', unit: 'g' },
  water_gal: { label: 'Drinking water', unit: 'gal' },
  treat_gal: { label: 'Water it can treat', unit: 'gal' },
  fuel_hours: { label: 'Burn time', unit: 'hours' },
  insulin_units: { label: 'Insulin', unit: 'units' },
  count: { label: 'Count', unit: '' },
  wh: { label: 'Stored energy', unit: 'Wh' },
};

// Insulin room-temperature life in days once it is out of the fridge.
// Values come from manufacturer labeling (opened/in-use limits). They differ between
// vials and pens and between brands, so check the package insert for YOUR product.
export const ROOM_TEMP_DAYS = {
  humalog: 28, admelog: 28, lyumjev: 28, novolog: 28, fiasp: 28, apidra: 28,
  lantus: 28, basaglar: 28, levemir: 42, toujeo: 56, tresiba: 56,
  humulin_r: 31, humulin_n: 31, novolin: 42, other: 28,
};

export const ROOM_TEMP_LABELS = {
  humalog: 'Humalog', admelog: 'Admelog', lyumjev: 'Lyumjev', novolog: 'NovoLog',
  fiasp: 'Fiasp', apidra: 'Apidra', lantus: 'Lantus', basaglar: 'Basaglar',
  levemir: 'Levemir', toujeo: 'Toujeo', tresiba: 'Tresiba',
  humulin_r: 'Humulin R (vial)', humulin_n: 'Humulin N (vial)', novolin: 'Novolin (vial)',
  other: 'Other / not sure (28 days)',
};

export function insulinLabel(key) {
  return ROOM_TEMP_LABELS[key] || key;
}

const BLEACH_INSTRUCTIONS =
  'EPA: 6% bleach — 8 drops per gallon; 8.25% — 6 drops per gallon. Double for cloudy water. ' +
  'Stir, wait 30 min; should smell faintly of chlorine. Use plain unscented bleach only. ' +
  'Bleach loses strength after ~1 year.';

// KINDS: each kind belongs to a category and says which per-unit numbers the form asks for.
//   fields      per-unit field names shown in the form
//   perUnit     default values applied when the kind is picked
//   countLabel  label for the `count` field; countNoun is what the card says ("90 doses")
export const KINDS = {
  // food
  food: { category: 'food', label: 'Food', unit: 'can', fields: ['kcal', 'protein_g'], perUnit: {}, instructions: '' },
  // water
  water: { category: 'water', label: 'Drinking water', unit: 'gal', fields: ['water_gal'], perUnit: { water_gal: 1 }, instructions: '' },
  // treatment
  filter: {
    category: 'treatment', label: 'Water filter', unit: 'each', fields: ['treat_gal'], perUnit: {},
    instructions: "Add the manufacturer's steps here (Phase 3 adds full guides).",
  },
  bleach: {
    category: 'treatment', label: 'Bleach (for water)', unit: 'bottle', fields: ['treat_gal'], perUnit: {},
    instructions: BLEACH_INSTRUCTIONS,
  },
  purifier_tabs: {
    category: 'treatment', label: 'Purification tablets', unit: 'bottle', fields: ['treat_gal', 'count'], perUnit: {},
    countLabel: 'Tablets per bottle', countNoun: 'tablets', instructions: '',
  },
  // cooking
  fuel_butane: {
    category: 'cooking', label: 'Butane canister', unit: 'canister', fields: ['fuel_hours'], perUnit: { fuel_hours: 1.5 },
    instructions: 'Indoors only if the stove is rated for indoor use; open a window and run a CO detector.',
  },
  fuel_propane: {
    category: 'cooking', label: 'Propane cylinder', unit: 'cylinder', fields: ['fuel_hours'], perUnit: { fuel_hours: 2 }, instructions: '',
  },
  stove: { category: 'cooking', label: 'Stove', unit: 'each', fields: [], perUnit: {}, instructions: '' },
  // power
  power_bank: { category: 'power', label: 'Power bank', unit: 'each', fields: ['wh'], perUnit: {}, instructions: '' },
  battery_pack: { category: 'power', label: 'Battery pack / power station', unit: 'each', fields: ['wh'], perUnit: {}, instructions: '' },
  battery_cells: {
    category: 'power', label: 'Batteries (AA, AAA, D...)', unit: 'pack', fields: ['count'], perUnit: {},
    countLabel: 'Batteries per pack', countNoun: 'cells', instructions: '',
  },
  light: { category: 'power', label: 'Light', unit: 'each', fields: [], perUnit: {}, instructions: '' },
  // t1d
  insulin: {
    category: 't1d', label: 'Insulin', unit: 'vial', fields: ['insulin_units'], perUnit: { insulin_units: 1000 },
    instructions: 'Unopened: keep refrigerated until the date on the package. Out of the fridge, use the room-temperature days for your brand.',
  },
  pump_site: {
    category: 't1d', label: 'Pump pods / infusion sets', unit: 'box', fields: ['count'], perUnit: {},
    countLabel: 'Pods / infusion sets', countNoun: 'pods/sets', instructions: '',
  },
  reservoir: {
    category: 't1d', label: 'Pump reservoirs / cartridges', unit: 'box', fields: ['count'], perUnit: {},
    countLabel: 'Reservoirs per box', countNoun: 'reservoirs', instructions: '',
  },
  cgm_sensor: {
    category: 't1d', label: 'CGM sensors', unit: 'box', fields: ['count'], perUnit: {},
    countLabel: 'Sensors per box', countNoun: 'sensors', instructions: '',
  },
  test_strips: {
    category: 't1d', label: 'Test strips', unit: 'box', fields: ['count'], perUnit: { count: 50 },
    countLabel: 'Strips per box', countNoun: 'strips', instructions: '',
  },
  ketone_strips: {
    category: 't1d', label: 'Ketone strips', unit: 'box', fields: ['count'], perUnit: { count: 10 },
    countLabel: 'Strips per box', countNoun: 'strips', instructions: '',
  },
  pen_needles: {
    category: 't1d', label: 'Pen needles', unit: 'box', fields: ['count'], perUnit: { count: 100 },
    countLabel: 'Needles per box', countNoun: 'needles', instructions: '',
  },
  syringes: {
    category: 't1d', label: 'Syringes', unit: 'box', fields: ['count'], perUnit: { count: 100 },
    countLabel: 'Syringes per box', countNoun: 'syringes', instructions: '',
  },
  glucagon: {
    category: 't1d', label: 'Glucagon', unit: 'each', fields: ['count'], perUnit: {},
    countLabel: 'Doses per package', countNoun: 'doses', instructions: '',
  },
  glucose_tabs: {
    category: 't1d', label: 'Glucose tablets / gel', unit: 'tube', fields: ['count'], perUnit: {},
    countLabel: 'Tablets per tube', countNoun: 'tablets', instructions: '',
  },
  lancets: {
    category: 't1d', label: 'Lancets', unit: 'box', fields: ['count'], perUnit: {},
    countLabel: 'Lancets per box', countNoun: 'lancets', instructions: '',
  },
  // meds
  med: {
    category: 'meds', label: 'Medication', unit: 'bottle', fields: ['count'], perUnit: {},
    countLabel: 'Doses per bottle', countNoun: 'doses', instructions: '',
  },
  // sanitation
  toilet_paper: {
    category: 'sanitation', label: 'Toilet paper', unit: 'pack', fields: ['count'], perUnit: {},
    countLabel: 'Rolls per pack', countNoun: 'rolls', instructions: '',
  },
  // pets
  pet_food: { category: 'pets', label: 'Pet food', unit: 'bag', fields: ['kcal'], perUnit: {}, instructions: '' },
};

// Every category also gets a generic "<category>_other" kind so anything can be entered.
for (const c of CATEGORIES) {
  KINDS[`${c.key}_other`] = {
    category: c.key, label: 'Other', unit: 'each', fields: [], perUnit: {}, instructions: '',
  };
}

export function kindsForCategory(categoryKey) {
  return Object.entries(KINDS)
    .filter(([, k]) => k.category === categoryKey)
    .map(([key, k]) => ({ key, ...k }))
    // keep "Other" last
    .sort((a, b) => (a.key.endsWith('_other') ? 1 : 0) - (b.key.endsWith('_other') ? 1 : 0));
}

export function defaultKindFor(categoryKey) {
  return kindsForCategory(categoryKey)[0]?.key || `${categoryKey}_other`;
}

// Label for a perUnit field on a given kind/unit, e.g. "Calories per can".
export function fieldLabel(field, kindKey, unit) {
  const kind = KINDS[kindKey];
  const per = unit ? ` per ${unit}` : '';
  if (field === 'count') return kind?.countLabel ? `${kind.countLabel}` : `Count${per}`;
  const meta = FIELD_META[field];
  return `${meta ? meta.label : field}${per}`;
}

export const COMMON_UNITS = [
  'can', 'lb', 'gal', 'canister', 'cylinder', 'vial', 'pen', 'box', 'pack', 'roll', 'each', 'bag', 'bottle',
  'jar', 'pouch', 'carton', 'bar', 'tube', 'jug', 'tin',
];
