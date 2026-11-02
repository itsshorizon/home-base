// Checks the static plan templates in data/plans/**.
// These files are read by the Plans screens and the print binder, and checkbox state is saved
// by item id, so a renamed or duplicated id would silently lose people's ticks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLANS = path.join(ROOT, 'data', 'plans');
const SCEN = path.join(PLANS, 'scenarios');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const guideIds = new Set(readJson(path.join(ROOT, 'data', 'guides', 'index.json')).guides.map((g) => g.id));

const loadout = readJson(path.join(PLANS, 'loadout.json'));
const arrival = readJson(path.join(PLANS, 'arrival.json'));
const gobag = readJson(path.join(PLANS, 'gobag.json'));
const scenarioIndex = readJson(path.join(SCEN, 'index.json'));
const scenarioFiles = fs.readdirSync(SCEN).filter((f) => f.endsWith('.json') && f !== 'index.json');
const scenarios = scenarioFiles.map((f) => ({ file: f, data: readJson(path.join(SCEN, f)) }));

const SCENARIO_IDS = [
  'go-to-grams', 'shelter-in-place', 'power-outage', 'boil-water', 'hurricane',
  'winter-storm', 'extreme-heat', 'tornado', 'flood', 'nuclear', 'wildfire-smoke',
];

// Every checklist file as { name, data, items: [Item...] }.
function itemLists() {
  const out = [];
  for (const t of loadout.tiers) out.push({ name: `loadout/${t.id}`, file: 'loadout', data: loadout, items: t.fixed });
  for (const s of arrival.sections) out.push({ name: `arrival/${s.id}`, file: 'arrival', data: arrival, items: s.items });
  for (const k of ['base', 'ifT1D', 'ifMeds', 'ifChild', 'ifPet']) out.push({ name: `gobag/${k}`, file: 'gobag', data: gobag, items: gobag[k] });
  for (const { file, data } of scenarios) {
    for (const p of data.phases) out.push({ name: `${file}/${p.id}`, file, data, items: p.items });
  }
  return out;
}

// All item ids in one file, flattened.
function idsByFile() {
  const files = new Map();
  for (const l of itemLists()) {
    if (!files.has(l.file)) files.set(l.file, []);
    for (const it of l.items) files.get(l.file).push(it.id);
  }
  return files;
}

test('all plan files parse and carry checkedAt and sources', () => {
  const all = [['loadout', loadout], ['arrival', arrival], ['gobag', gobag], ...scenarios.map((s) => [s.file, s.data])];
  for (const [name, d] of all) {
    assert.match(d.checkedAt, /^\d{4}-\d{2}-\d{2}$/, `${name}: checkedAt`);
    assert.ok(Array.isArray(d.sources) && d.sources.length >= 1, `${name}: has sources`);
    for (const s of d.sources) {
      assert.ok(s.title && typeof s.title === 'string', `${name}: source title`);
      assert.match(s.url, /^https:\/\//, `${name}: source url is https`);
    }
  }
});

test('every item has the right shape', () => {
  for (const l of itemLists()) {
    assert.ok(Array.isArray(l.items) && l.items.length >= 1, `${l.name}: has items`);
    for (const it of l.items) {
      assert.match(it.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${l.name}: id "${it.id}" is kebab-case`);
      assert.ok(typeof it.text === 'string' && it.text.trim(), `${it.id}: text`);
      for (const k of ['note', 'guide', 'who']) {
        if (k in it) assert.ok(typeof it[k] === 'string' && it[k].trim(), `${it.id}: ${k} is a non-empty string`);
      }
      const extra = Object.keys(it).filter((k) => !['id', 'text', 'note', 'guide', 'source', 'who'].includes(k));
      assert.deepEqual(extra, [], `${it.id}: unexpected keys`);
    }
  }
});

test('item ids are unique within each file', () => {
  for (const [file, ids] of idsByFile()) {
    const seen = new Set();
    for (const id of ids) {
      assert.ok(!seen.has(id), `${file}: duplicate item id "${id}"`);
      seen.add(id);
    }
  }
});

test('source indexes are 1-based and in range', () => {
  for (const l of itemLists()) {
    for (const it of l.items) {
      if (it.source === undefined) continue;
      assert.ok(Number.isInteger(it.source), `${it.id}: source is an integer`);
      assert.ok(it.source >= 1 && it.source <= l.data.sources.length, `${l.name}/${it.id}: source ${it.source} out of range`);
    }
  }
});

test('every linked guide id exists in the guide index', () => {
  for (const l of itemLists()) {
    for (const it of l.items) {
      if (it.guide) assert.ok(guideIds.has(it.guide), `${l.name}/${it.id}: unknown guide "${it.guide}"`);
    }
  }
  for (const { file, data } of scenarios) {
    assert.ok(Array.isArray(data.guides), `${file}: guides array`);
    for (const g of data.guides) assert.ok(guideIds.has(g), `${file}: unknown guide "${g}"`);
  }
});

test('loadout tiers are exactly t1 to t4 with the agreed match rules', () => {
  assert.deepEqual(loadout.tiers.map((t) => t.id), ['t1', 't2', 't3', 't4']);
  const expected = {
    t1: ['t1d', 'meds', 'docs'],
    t2: ['power', 'comms'],
    t3: ['water', 'treatment', 'food', 'pets'],
    t4: ['firstaid', 'cooking', 'sanitation', 'shelter', 'tools'],
  };
  for (const t of loadout.tiers) {
    assert.deepEqual(t.match, { categories: expected[t.id], kinds: [] }, `${t.id}: match rule`);
    assert.ok(t.title, `${t.id}: title`);
    assert.ok(Array.isArray(t.fixed) && t.fixed.length >= 1, `${t.id}: fixed lines`);
  }
  assert.equal(loadout.tiers[0].title, 'Grab first: medical and must-haves');
  assert.equal(loadout.tiers[1].title, 'Power and comms');
  assert.equal(loadout.tiers[2].title, 'Water and food');
  assert.equal(loadout.tiers[3].title, 'If there\'s room and time');
});

test('loadout has the required fixed lines', () => {
  const byTier = Object.fromEntries(loadout.tiers.map((t) => [t.id, t.fixed]));
  const has = (tier, id) => byTier[tier].find((i) => i.id === id);
  const insulin = has('t1', 'insulin-cooler');
  assert.ok(insulin, 'insulin-cooler');
  assert.equal(insulin.guide, 't1d-insulin-storage');
  assert.equal(has('t1', 'diabetes-devices').guide, 't1d-pump-failure');
  assert.equal(has('t1', 'glucagon-sugar-pocket').guide, 't1d-hypo');
  for (const id of ['medications-all', 'phones-cables', 'wallet-keys-id-cash', 'glasses-contacts', 'pets-carriers']) {
    assert.ok(has('t1', id), `t1 ${id}`);
  }
  assert.match(has('t2', 'solar-generators').text, /Solar generator\(s\): grab them, plus every charging cable/);
  assert.match(has('t2', 'solar-panels').text, /Solar panels: fold them, and bring their cables and connectors/);
  for (const id of ['power-banks', 'meshtastic-radios', 'frs-radios', 'weather-radio', 'printed-binder']) {
    assert.ok(has('t2', id), `t2 ${id}`);
  }
  for (const id of ['water-containers', 'water-filter', 'bleach', 'food-trip', 'pet-food']) {
    assert.ok(has('t3', id), `t3 ${id}`);
  }
  assert.equal(has('t3', 'water-filter').guide, 'water-filters');
  assert.equal(has('t3', 'bleach').guide, 'water-bleach');
  for (const id of ['first-aid-kit', 'stove-fuel', 'bedding', 'clothes', 'sanitation-supplies', 'basic-tools']) {
    assert.ok(has('t4', id), `t4 ${id}`);
  }
  assert.equal(has('t4', 'stove-fuel').guide, 'co-safety');
});

test('arrival has the agreed sections and required items', () => {
  assert.deepEqual(arrival.sections.map((s) => s.id), ['first-hour', 'first-day', 'daily']);
  assert.equal(arrival.sections.filter((s) => s.daily).length, 1);
  assert.equal(arrival.sections.find((s) => s.id === 'daily').daily, true);
  const ids = arrival.sections.flatMap((s) => s.items.map((i) => i.id));
  for (const id of [
    'insulin-fridge', 'check-bg-cgm', 'check-in-family', 'unload-tier-order',
    'panels-setup', 'charging-priority', 'water-check', 'stock-take', 'mesh-node', 'weather-radio-setup',
    'sanitation-plan', 'co-alarms',
    'daily-sugar-insulin', 'daily-water', 'daily-generator', 'daily-radio-checkin', 'daily-food',
  ]) assert.ok(ids.includes(id), `arrival item ${id}`);
  const fh = arrival.sections[0].items;
  assert.equal(fh.find((i) => i.id === 'insulin-fridge').guide, 't1d-insulin-storage');
});

test('gobag has all five lists', () => {
  for (const k of ['base', 'ifT1D', 'ifMeds', 'ifChild', 'ifPet']) {
    assert.ok(Array.isArray(gobag[k]) && gobag[k].length >= 1, `gobag.${k}`);
  }
  assert.ok(gobag.ifMeds.find((i) => i.text.startsWith('Each of this person')), 'meds line');
  assert.ok(gobag.ifT1D.find((i) => i.guide === 't1d-insulin-storage'), 'T1D insulin links the storage guide');
});

test('scenario index and scenario files match, go-to-grams first', () => {
  assert.equal(scenarioIndex[0].id, 'go-to-grams');
  assert.deepEqual(scenarioIndex.map((s) => s.id), SCENARIO_IDS);
  const indexed = scenarioIndex.map((s) => s.id).sort();
  const filed = scenarioFiles.map((f) => f.replace(/\.json$/, '')).sort();
  assert.deepEqual(indexed, filed, 'every index entry has a file and vice versa');
  for (const s of scenarioIndex) {
    assert.deepEqual(Object.keys(s).sort(), ['icon', 'id', 'summary', 'title']);
    for (const k of ['icon', 'summary', 'title']) assert.ok(s[k], `${s.id}: ${k}`);
  }
  for (const { file, data } of scenarios) {
    assert.equal(data.id + '.json', file, `${file}: id matches filename`);
    const entry = scenarioIndex.find((s) => s.id === data.id);
    assert.equal(data.title, entry.title);
    assert.equal(data.icon, entry.icon);
    assert.equal(data.summary, entry.summary);
    assert.ok(data.phases.length >= 2, `${file}: phases`);
    const phaseIds = data.phases.map((p) => p.id);
    assert.equal(new Set(phaseIds).size, phaseIds.length, `${file}: unique phase ids`);
  }
});

test('go-to-grams has the triggers phase and the leaving phase', () => {
  const g = scenarios.find((s) => s.data.id === 'go-to-grams').data;
  assert.deepEqual(g.phases.map((p) => p.id), ['when-we-go', 'leaving']);
  const triggers = g.phases[0].items;
  assert.ok(triggers.length >= 4);
  for (const t of triggers) assert.match(t.id, /^trigger-/, 'every item in "when-we-go" is a trigger');
  assert.ok(g.phases[1].items.find((i) => i.id === 'leave-loadout'));
  assert.ok(g.phases[1].items.find((i) => i.id === 'leave-arrival-list'));
  assert.ok(g.guides.includes('hazard-evacuation'));
});

test('hazard scenarios link the right guides', () => {
  const nuclear = scenarios.find((s) => s.data.id === 'nuclear').data;
  assert.ok(nuclear.guides.includes('hazard-nuclear'));
  const hur = scenarios.find((s) => s.data.id === 'hurricane').data;
  assert.ok(hur.guides.includes('hazard-hurricane'));
});

test('text is plain: only **bold**, no HTML, no phone numbers', () => {
  const strings = [];
  const walk = (v, key) => {
    if (typeof v === 'string') { if (['text', 'note', 'title', 'hint', 'summary', 'who'].includes(key)) strings.push(v); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk([loadout, arrival, gobag, ...scenarios.map((s) => s.data)]);
  assert.ok(strings.length > 100);
  for (const s of strings) {
    assert.ok(!/[<>]/.test(s), `HTML-like characters in: ${s}`);
    assert.ok(!/https?:\/\//.test(s), `link in text: ${s}`);
    const stripped = s.replace(/\*\*[^*]+\*\*/g, '');
    assert.ok(!stripped.includes('*'), `stray asterisk in: ${s}`);
    assert.ok(!/\d{3}[-. )]+\d{3,4}[-. ]\d{4}/.test(s) && !/\(\d{3}\)\s*\d{3}/.test(s),
      `phone number written into the text (use comms/local data): ${s}`);
  }
});

test('insulin items never carry temperatures (the insulin storage guide owns those)', () => {
  const temp = /\d\s*°|degrees|\b\d+\s*(?:F|C)\b/;
  for (const l of itemLists()) {
    for (const it of l.items) {
      const mentionsInsulin = /insulin/i.test(`${it.text} ${it.note || ''}`) || it.guide === 't1d-insulin-storage';
      if (!mentionsInsulin) continue;
      assert.ok(!temp.test(`${it.text} ${it.note || ''}`), `${l.name}/${it.id}: insulin item has a temperature`);
    }
  }
});

test('anything about storing or moving insulin links the insulin storage guide', () => {
  const must = [
    ['loadout', 'insulin-cooler'], ['arrival', 'insulin-fridge'], ['arrival', 'daily-sugar-insulin'],
  ];
  const ids = new Map();
  for (const l of itemLists()) for (const it of l.items) ids.set(`${l.file}:${it.id}`, it);
  for (const [file, id] of must) {
    assert.equal(ids.get(`${file}:${id}`).guide, 't1d-insulin-storage', `${file}/${id}`);
  }
  assert.equal(ids.get('go-to-grams.json:leave-insulin').guide, 't1d-insulin-storage');
  // Any other line that talks about keeping insulin cool, warm, frozen or in a fridge must link it too.
  const storage = /\b(cool|cooler|cooling|fridge|freez\w*|frozen|warm\w*|heat|sun|stor\w+)\b/i;
  for (const l of itemLists()) {
    for (const it of l.items) {
      const t = `${it.text} ${it.note || ''}`;
      if (/insulin/i.test(t) && storage.test(t)) {
        assert.equal(it.guide, 't1d-insulin-storage', `${l.name}/${it.id}: talks about insulin storage but does not link the guide`);
      }
    }
  }
});
