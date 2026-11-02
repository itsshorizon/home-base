// Tests for js/print.js (the printable binder builders). Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDocument, buildWalletCards, buildCover, buildGoPlanSection, buildLoadoutSection, buildArrivalSection, buildPaceSection,
  buildMedicalSection, buildCommsSection, buildGuideSection, buildGobagSection, buildInventorySection, buildPinsSection,
  defaultSelection, normalizeSelection, estimatePagesOf, T1D_CARD_TEXT,
  isFlagged, verifiedNoaa, verifiedRepeaters, SECTION_DEFS,
} from '../js/print.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const loadoutTpl = read('./fixtures/print-plans/loadout.json');
const arrivalTpl = read('./fixtures/print-plans/arrival.json');
const gobagTpl = read('./fixtures/print-plans/gobag.json');
const hurricane = read('./fixtures/print-plans/scenarios/hurricane.json');
const scenarioIndex = read('./fixtures/print-plans/scenarios/index.json');
const comms = read('../data/comms.json');
const guideIndex = read('../data/guides/index.json');
const hypo = read('../data/guides/t1d-hypo.json');

// Text that would break the page if it were not escaped.
const EVIL = '<script>alert(1)</script>';
const EVIL2 = '"><img src=x onerror=alert(2)>';
const NO_RAW = (html) => {
  assert.ok(!html.includes('<script>alert'), 'raw <script> leaked');
  assert.ok(!html.includes('onerror=alert(2)>') || !html.includes('<img src=x onerror'), 'raw <img onerror> leaked');
  assert.ok(!/<img src=x/.test(html), 'raw injected <img> leaked');
};

const TODAY = '2026-11-02';
function fullData(over = {}) {
  return {
    today: TODAY,
    goPlan: {
      destination: { name: `Gram's ${EVIL}`, pinId: 'pin1', address: `12 Elm ${EVIL2}`, notes: `well water ${EVIL}` },
      fallback: { name: `Church ${EVIL}`, pinId: null, notes: 'back lot' },
      routes: [{ label: `Primary ${EVIL}`, text: `Take I-64 ${EVIL2}` }, { label: 'Alternate', text: '' }],
      triggers: [`Evacuation order ${EVIL}`, 'Water is out'],
      assignments: [{ personId: 'p1', task: `Insulin kit ${EVIL}` }, { personId: 'gone', task: 'Pets' }],
      vehicle: `Blue van ${EVIL}`, leaveNote: `Gone to Gram's ${EVIL2}`, updatedAt: 1,
    },
    pacePlan: { tiers: { P: { method: 'Cell call', details: `Call ${EVIL}` }, A: { method: 'Text/SMS', details: '' }, C: { method: 'Meshtastic', details: 'Channel Woodson' }, E: { method: 'FRS/GMRS', details: 'Ch 3' } },
      checkIns: `Every 6 pm ${EVIL}`, codeWords: [{ word: `pineapple ${EVIL}`, meaning: 'come now' }], meetingPoints: [{ name: `Park ${EVIL}`, details: 'by the swings', pinId: 'pin1' }],
      outOfAreaContact: { name: `Aunt ${EVIL}`, details: '555-0100' } },
    meshNodes: [{ owner: `Dad ${EVIL}`, name: `Dad node ${EVIL2}`, shortId: 'a1b2' }],
    people: [
      { id: 'p1', name: `Sam ${EVIL}`, age: 34, bloodType: `O+ ${EVIL}`, allergies: `Penicillin ${EVIL2}`, conditions: `T1D ${EVIL}`,
        meds: [{ name: `Lisinopril ${EVIL}`, dose: `10 mg ${EVIL2}`, perDay: 1 }],
        t1d: { rapidInsulin: 'humalog', basalInsulin: 'lantus', usesPump: true, usesCGM: true,
          plan: { backupBasalInsulin: 'lantus', backupBasalUnits: 18, carbRatio: `1:10 ${EVIL}`, endoName: `Dr. ${EVIL}`, endoPhone: '555-0111', notes: `Call first ${EVIL}`, updatedAt: '2026-10-01T00:00:00Z' } } },
      { id: 'p2', name: 'Kid', age: 9, meds: [], t1d: null },
    ],
    pets: [{ id: 'pet1', name: `Rex ${EVIL}`, species: 'Dog' }],
    items: [
      { id: 'i1', name: `Insulin ${EVIL}`, qty: 3, unit: 'vial', category: 't1d', kind: 'insulin', location: `Fridge ${EVIL2}`, expires: '2026-12-01' },
      { id: 'i2', name: 'Old glucagon', qty: 1, unit: 'kit', category: 't1d', kind: 'glucagon', location: 'Hall closet', expires: '2025-01-01' },
      { id: 'i3', name: 'Solar generator', qty: 1, unit: 'each', category: 'power', kind: 'battery_pack', location: 'Garage' },
      { id: 'i4', name: 'Bottled water', qty: 24, unit: 'bottle', category: 'water', kind: 'water_bottled', location: 'Pantry' },
      { id: 'i5', name: 'Canned beans', qty: 12, unit: 'can', category: 'food', kind: 'canned', location: "Gram's basement" },
      { id: 'i6', name: 'Tarp', qty: 2, unit: 'each', category: 'tools', kind: 'tarp', location: 'Garage', pack: 't2' },
      { id: 'i7', name: 'Heavy anvil', qty: 1, unit: 'each', category: 'tools', kind: 'anvil', location: 'Garage', pack: 'no' },
    ],
    pins: [{ id: 'pin1', name: `Gram's pin ${EVIL}`, type: 'rally', lat: 37.123456789, lon: -77.987654321, notes: `Gate code ${EVIL2}` }],
    contacts: [
      { id: 'c1', name: `Mom ${EVIL}`, relation: `Mother ${EVIL2}`, phones: [{ label: 'Cell', number: '555-0101' }, { label: 'Work', number: '555-0102' }], notes: `Call ${EVIL}`, outOfArea: false, order: 0 },
      { id: 'c2', name: 'Aunt Lee', relation: 'Aunt', phones: [{ label: 'Cell', number: '555-0199' }], notes: '', outOfArea: true, order: 1 },
    ],
    runs: {
      loadout: { custom: [{ id: 'c-1', text: `Board games ${EVIL}`, tier: 't4' }], hidden: ['wallet'] },
      arrival: { custom: [{ id: 'c-2', text: `Hang tarp ${EVIL2}`, section: 'first-day' }], hidden: [] },
      'scenario:hurricane': { custom: [{ id: 'c-3', text: `Board windows ${EVIL}`, section: 'before' }], hidden: [] },
      [`gobag:p1`]: { custom: [{ id: 'c-4', text: `Teddy ${EVIL}`, section: 'x' }], hidden: [] },
    },
    comms, loadoutTpl, arrivalTpl, gobagTpl, scenarioIndex, scenarios: { hurricane }, guideIndex,
    guides: { 't1d-hypo': hypo },
    ...over,
  };
}
const ALL_ON = () => {
  const s = defaultSelection();
  for (const k of Object.keys(s.sections)) s.sections[k] = true;
  s.scenarios = ['hurricane'];
  s.guides = ['t1d-hypo'];
  return s;
};

// ---------- escaping (critical: names and notes are typed by the user) ----------
test('user text is escaped in every section', () => {
  const d = fullData();
  const doc = buildDocument(ALL_ON(), d);
  NO_RAW(doc.html);
  assert.ok(doc.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped text should still be shown');
  // each section builder on its own
  for (const html of [buildCover(d), buildGoPlanSection(d), buildLoadoutSection(d), buildArrivalSection(d), buildPaceSection(d), buildMedicalSection(d),
    buildGobagSection(d), buildInventorySection(d), buildPinsSection(d), buildWalletCards(d), buildCommsSection(d)]) {
    assert.ok(html, 'section should render');
    NO_RAW(html);
  }
});

test('hostile guide text is escaped, and only shipped figure paths are used', () => {
  const g = { id: 'x', title: EVIL, category: 'water', summary: EVIL2, medical: true, checkedAt: TODAY, sources: [{ title: EVIL, url: 'javascript:alert(1)' }],
    blocks: [{ type: 'p', text: EVIL }, { type: 'list', items: [EVIL2] }, { type: 'figure', src: 'https://evil.example/x.svg', alt: 'a' },
      { type: 'figure', src: 'img/guides/../../x.svg', alt: 'a' }, { type: 'figure', src: 'img/guides/co-alarm-flow.svg', alt: EVIL2, caption: EVIL }, { type: 'mystery', text: EVIL }] };
  const html = buildGuideSection(g, fullData());
  NO_RAW(html);
  assert.ok(!html.includes('evil.example'));
  assert.ok(!html.includes('..'));
  assert.ok(!html.includes('javascript:'), 'non-http source links must not become links');
  assert.equal((html.match(/<img /g) || []).length, 1);
});

test('web addresses become links only when they are http(s)', () => {
  const html = buildLoadoutSection(fullData());
  assert.ok(html.includes('class="print-link" href="https://www.ready.gov/kit"'));
});

// ---------- blank checkboxes ----------
test('checklists print blank boxes, never ticked ones', () => {
  const d = fullData({ runs: { loadout: { checked: { 'insulin-cooler': true, 'item:i1': true }, custom: [], hidden: [] } } });
  const html = buildLoadoutSection(d);
  assert.ok(html.includes('print-box'));
  assert.ok(!/checked/.test(html));
  assert.ok(!html.includes('✓') && !html.includes('☑'));
});

// ---------- load-out logic ----------
test('load-out puts inventory in tiers with locations, Gram\'s items apart, and honours pack, hide and custom lines', () => {
  const d = fullData();
  const html = buildLoadoutSection(d);
  const tier = (id) => { // the HTML of one tier, by its title
    const titles = { t1: 'Grab first', t2: 'Power and comms', t3: 'Water and food', t4: "If there&#39;s room" };
    const start = html.indexOf(titles[id]);
    const nextStarts = Object.entries(titles).filter(([k]) => k !== id).map(([, t]) => html.indexOf(t)).filter((i) => i > start);
    const grams = html.indexOf('Already at Gram');
    const end = Math.min(...nextStarts, grams > start ? grams : Infinity, html.length);
    return html.slice(start, end);
  };
  assert.ok(tier('t1').includes('Old glucagon') && tier('t1').includes('Insulin'));
  assert.ok(tier('t2').includes('Solar generator') && tier('t2').includes('Tarp'), 'pack: t2 moves the tarp out of tools');
  assert.ok(tier('t3').includes('Bottled water'));
  assert.ok(!tier('t4').includes('Tarp'));
  assert.ok(!html.includes('Heavy anvil'), "pack: 'no' is never listed");
  const grams = html.slice(html.indexOf('Already at Gram'));
  assert.ok(grams.includes('Canned beans') && grams.includes('basement'));
  assert.ok(!html.slice(0, html.indexOf('Already at Gram')).includes('Canned beans'), "Gram's items are not in the pack list");
  assert.ok(!html.includes('Wallet, keys'), 'hidden fixed lines are dropped');
  assert.ok(tier('t4').includes('Board games'), 'the family\'s own line shows in its tier');
  assert.ok(html.includes('EXPIRED'), 'expired glucagon is flagged');
  assert.ok(html.includes('Hall closet') && html.includes('Garage'), 'locations are printed');
  assert.ok(html.includes('Sam') && html.includes('Lisinopril'), "the meds line expands to each person's medications");
  assert.ok(html.includes('Guide: '), 'guide links print as titles');
  assert.ok(html.indexOf('Fridge') < html.indexOf('Hall closet') || html.indexOf('Hall closet') < html.indexOf('Fridge'));
});

test('load-out section is skipped when the template is missing', () => {
  assert.equal(buildLoadoutSection(fullData({ loadoutTpl: null })), null);
  assert.equal(buildArrivalSection(fullData({ arrivalTpl: undefined })), null);
  assert.equal(buildLoadoutSection(fullData({ loadoutTpl: { tiers: [] } })), null);
});

// ---------- go-bags ----------
test('go-bags: base plus the extras that fit each person, pets get the pet kit', () => {
  const html = buildGobagSection(fullData());
  const sam = html.slice(html.indexOf('Sam'), html.indexOf('Kid'));
  assert.ok(sam.includes('Glucose tablets') && sam.includes('Lisinopril') && !sam.includes('comfort item'));
  const kid = html.slice(html.indexOf('Kid'), html.indexOf('Rex'));
  assert.ok(kid.includes('comfort item') && !kid.includes('Glucose tablets'));
  assert.ok(html.slice(html.indexOf('Rex')).includes('Pet food'));
  assert.ok(sam.includes('Teddy'), 'custom lines from the checklist run');
  assert.equal(buildGobagSection(fullData({ gobagTpl: null })), null);
});

// ---------- missing data ----------
test('sections are skipped (with a reason) when their data is missing', () => {
  const empty = { today: TODAY };
  const doc = buildDocument(ALL_ON(), empty);
  assert.ok(doc.html.includes('Home Base binder'), 'the cover always prints');
  const skippedKeys = doc.skipped.map((s) => s.key);
  for (const k of ['goplan', 'loadout', 'arrival', 'pace', 'medical', 'comms', 'gobags', 'inventory', 'pins']) assert.ok(skippedKeys.includes(k), `${k} should be skipped`);
  assert.ok(doc.skipped.every((s) => s.reason));
  assert.doesNotThrow(() => buildDocument(null, {}));
  assert.doesNotThrow(() => buildDocument(ALL_ON(), { today: TODAY, people: [null, {}], items: [null, { name: 'x' }], contacts: [null], pins: [null], goPlan: 'oops', pacePlan: 7, comms: 'no' }));
});

test('an empty go plan is skipped but the cover still has blanks to write on', () => {
  assert.equal(buildGoPlanSection({ goPlan: {} }), null);
  assert.equal(buildGoPlanSection({ goPlan: null }), null);
  const cover = buildCover({ today: TODAY, goPlan: {} });
  assert.ok(cover.includes("Gram&#39;s house"));
  assert.ok(cover.includes('print-blank'));
});

test('contacts: out-of-area first, every phone listed', () => {
  const html = buildPaceSection(fullData());
  assert.ok(html.indexOf('Aunt Lee') < html.indexOf('Mom'));
  assert.ok(html.includes('555-0101') && html.includes('555-0102'));
  assert.ok(html.includes('OUT-OF-AREA CONTACT'));
});

test('medical section carries the privacy notice and the diabetes plan', () => {
  const html = buildMedicalSection(fullData());
  assert.ok(html.includes('Private medical information'));
  assert.ok(html.indexOf('Private medical information') < html.indexOf('Sam'));
  assert.ok(html.includes('18 units') && html.includes('Lantus'));
  assert.equal(buildMedicalSection(fullData({ people: [] })), null);
});

// ---------- comms: nothing from `unverified` ----------
test('comms never prints unverified claims', () => {
  const html = buildCommsSection(fullData());
  for (const u of comms.unverified) {
    assert.ok(!html.includes(u.claim), `claim leaked: ${u.claim}`);
    assert.ok(!html.includes(u.why.slice(0, 40)), `reason leaked: ${u.why}`);
  }
  assert.ok(html.includes('KAE42') && html.includes('162.500') && html.includes('051087'));
  assert.ok(!html.includes('WXK65'), 'a transmitter named in an unverified claim stays off the page');
  assert.ok(!html.includes('NOT CONFIRMED'));
  assert.ok(html.includes('Meshtastic') && html.includes('LongFast'));
  assert.ok(html.includes('a1b2'));
});

test('flagged entries are filtered from a fixture too', () => {
  const c = { checkedAt: '2026-01-01',
    noaaWeatherRadio: [{ callsign: 'KAA11', freqMHz: 162.4, sameCode: '1', source: 'https://x.test/a' }, { callsign: 'WXZ99', freqMHz: 162.55, sameCode: '2', source: 'https://x.test/b' }],
    hamRepeaters: [{ callsign: 'W1ABC', outputMHz: 146.94, inputMHz: 146.34, toneHz: 100, mode: 'FM', location: 'Hill', source: 'https://x.test/c' },
      { callsign: 'W9BAD', outputMHz: 147.0, inputMHz: 147.6, toneHz: 100, mode: 'FM', location: 'Nowhere', source: 'https://x.test/d' },
      { callsign: 'W2DMR', outputMHz: 147.1, inputMHz: 147.7, toneHz: 100, mode: 'DMR', location: 'Elsewhere', source: 'https://x.test/e' }],
    unverified: [{ claim: 'WXZ99 covers us', why: 'no source' }, { claim: 'W9BAD works', why: 'snippet only' }] };
  assert.ok(isFlagged(c, 'WXZ99') && !isFlagged(c, 'KAA11'));
  assert.deepEqual(verifiedNoaa(c).map((w) => w.callsign), ['KAA11']);
  assert.deepEqual(verifiedRepeaters(c).map((r) => r.callsign), ['W1ABC']);
  const html = buildCommsSection({ today: TODAY, comms: c });
  assert.ok(!html.includes('WXZ99') && !html.includes('W9BAD') && !html.includes('covers us') && !html.includes('snippet only'));
  assert.ok(html.includes('W1ABC') && !html.includes('W2DMR'));
  assert.equal(buildCommsSection({ today: TODAY, comms: { unverified: [{ claim: 'x' }] } }), null);
});

test('the wallet card never prints unverified radio data either', () => {
  const html = buildWalletCards(fullData());
  assert.ok(html.includes('162.500'));
  assert.ok(!html.includes('162.475') && !html.includes('WXK65'));
});

// ---------- wallet card ----------
test('wallet card renders with an empty, minimal or missing go plan', () => {
  for (const d of [{}, { today: TODAY }, { today: TODAY, goPlan: {} }, { today: TODAY, goPlan: null, pacePlan: null, people: null, contacts: null, comms: null },
    { today: TODAY, goPlan: { destination: {} }, pacePlan: {}, people: [{ id: 'a', name: 'Solo' }] }]) {
    const html = buildWalletCards(d);
    assert.ok(html.includes('print-card-strip'));
    assert.ok(html.includes('Gram&#39;s house'));
    assert.ok(html.includes('print-blank'), 'blank lines to write on');
  }
});

test('wallet card: four strips per page, the diabetes line only for the T1D person, wording from the hypo guide', () => {
  const html = buildWalletCards(fullData());
  assert.equal((html.match(/print-card-strip/g) || []).length, 4);
  assert.equal((html.match(/print-card-t1d/g) || []).length, 1);
  assert.ok(html.includes('Aunt Lee') && html.includes('555-0199'), 'out-of-area contact name and phone');
  assert.ok(html.includes('Channel Woodson') && html.includes('Ch 3'), 'Meshtastic and FRS details come from the PACE plan');
  assert.ok(html.includes('12 Elm'));
  const many = buildWalletCards(fullData({ people: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })) }));
  assert.equal((many.match(/print-card-page/g) || []).length, 2);
  // the card text only uses ideas that the t1d-hypo guide states
  const all = JSON.stringify(hypo.blocks).toLowerCase();
  for (const w of ['glucagon', '911', 'swallow', 'food or drink']) assert.ok(all.includes(w), `guide mentions ${w}`);
  for (const w of ['glucagon', '911', 'swallow', 'food or drink', 'sugar', 'insulin']) assert.ok(T1D_CARD_TEXT.toLowerCase().includes(w), `card mentions ${w}`);
  assert.ok(!/\d/.test(T1D_CARD_TEXT.replace('911', '').replace('1 ', '')), 'no invented doses or numbers');
});

test('wallet card clips long PACE details', () => {
  const long = 'x'.repeat(300);
  const html = buildWalletCards({ today: TODAY, pacePlan: { tiers: { E: { method: 'FRS/GMRS', details: long } } } });
  assert.ok(!html.includes(long));
});

// ---------- guides ----------
test('a real guide renders: warning, steps, figure with local path, sources and a blank checklist', () => {
  const html = buildGuideSection(hypo, fullData());
  assert.ok(html.includes('print-callout-warn'));
  assert.ok(html.includes('<img src="img/guides/t1d-hypo-15-15.svg"'));
  assert.ok(html.includes('Medical information'));
  assert.ok(html.includes('class="print-link" href="https://www.cdc.gov'));
  assert.equal(buildGuideSection({ id: 'x' }, {}), null);
});

test('every shipped guide renders without throwing', () => {
  for (const g of guideIndex.guides) {
    const guide = read(`../data/guides/${g.id}.json`);
    const html = buildGuideSection(guide, fullData());
    assert.ok(html && html.includes('print-sec'), g.id);
  }
});

test('the emergency section prints every emergency guide that was downloaded, and says so when one is not', () => {
  const sel = defaultSelection();
  const doc = buildDocument(sel, fullData());
  const em = guideIndex.guides.filter((g) => g.emergency);
  assert.ok(em.length > 0);
  assert.ok(doc.parts.some((p) => p.key === 'guide-t1d-hypo'));
  assert.equal(doc.skipped.filter((s) => s.reason.startsWith('The guide')).length, em.length - 1);
});

test('other guides come only from the ticked list, and never twice', () => {
  const sel = { sections: { ...defaultSelection().sections, guides: true }, guides: ['t1d-hypo', 'water-boil'], scenarios: [] };
  const d = fullData({ guides: { 't1d-hypo': hypo, 'water-boil': read('../data/guides/water-boil.json') } });
  const doc = buildDocument(sel, d);
  assert.equal(doc.parts.filter((p) => p.key === 'guide-t1d-hypo').length, 1);
  assert.ok(doc.parts.some((p) => p.key === 'guide-water-boil'));
});

// ---------- document and picker ----------
test('selection: defaults match the spec and stored junk is repaired', () => {
  const s = defaultSelection();
  for (const k of ['cover', 'goplan', 'loadout', 'arrival', 'pace', 'medical', 'comms', 'emergency']) assert.equal(s.sections[k], true, k);
  for (const k of ['scenarios', 'gobags', 'inventory', 'pins', 'guides']) assert.equal(s.sections[k], false, k);
  assert.equal(SECTION_DEFS.length, Object.keys(s.sections).length);
  assert.deepEqual(normalizeSelection(null), s);
  assert.deepEqual(normalizeSelection('junk'), s);
  const n = normalizeSelection({ sections: { cover: false, bogus: true, pins: 'yes' }, guides: ['water-boil', 7, '../x', null], scenarios: 'no' });
  assert.equal(n.sections.cover, false);
  assert.equal(n.sections.pins, false);
  assert.ok(!('bogus' in n.sections));
  assert.deepEqual(n.guides, ['water-boil']);
  assert.deepEqual(n.scenarios, []);
});

test('the cover lists what follows, and turning a section off removes it', () => {
  const sel = defaultSelection();
  sel.sections.medical = false;
  const doc = buildDocument(sel, fullData());
  assert.ok(!doc.parts.some((p) => p.key === 'medical'));
  assert.equal(doc.parts[0].key, 'cover');
  assert.ok(doc.html.includes('Load-out checklist'));
  sel.sections.cover = false;
  assert.ok(!buildDocument(sel, fullData()).html.includes('In this binder'));
});

test('the default document has every default section with the date on each', () => {
  const doc = buildDocument(defaultSelection(), fullData());
  const keys = doc.parts.map((p) => p.key);
  for (const k of ['cover', 'goplan', 'loadout', 'arrival', 'pace', 'medical', 'comms']) assert.ok(keys.includes(k), k);
  const secs = doc.html.match(/<section class="print-sec"/g).length;
  assert.equal((doc.html.match(/Home Base · printed 2026-11-02/g) || []).length, secs);
  assert.ok(doc.pages >= secs);
});

test('page estimate is at least one page and grows with content', () => {
  assert.equal(estimatePagesOf(''), 1);
  assert.ok(estimatePagesOf('x'.repeat(9000)) >= 3);
  assert.ok(estimatePagesOf('<img src="a">'.repeat(8)) > 1);
});

test('scenarios print their phases, own lines, guide titles (only real ones) and sources', () => {
  const sel = { sections: { ...defaultSelection().sections, scenarios: true }, guides: [], scenarios: ['hurricane'] };
  const doc = buildDocument(sel, fullData());
  const sc = doc.html;
  assert.ok(sc.includes('Hurricane or tropical storm') && sc.includes('Fill clean containers'));
  assert.ok(sc.includes('Board windows'));
  assert.ok(!sc.includes('not-a-real-guide'));
  const noSc = buildDocument(sel, fullData({ scenarios: {} }));
  assert.ok(noSc.skipped.some((s) => s.key === 'scenario-hurricane'));
});

// ---------- the real plan files (data/plans/*), whatever phases and sections they have ----------
test('the real plan templates all render, with every phase and item', () => {
  const real = (p) => read(`../data/plans/${p}`);
  const idx = real('scenarios/index.json');
  const scenarios = {};
  for (const x of idx) scenarios[x.id] = real(`scenarios/${x.id}.json`);
  const d = fullData({ loadoutTpl: real('loadout.json'), arrivalTpl: real('arrival.json'), gobagTpl: real('gobag.json'), scenarioIndex: idx, scenarios, runs: {} });
  const strip = (t) => t.replace(/\*\*/g, '');
  const text = (html) => html.replace(/<[^>]*>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const x of idx) {
    const html = buildDocument({ sections: { ...defaultSelection().sections, scenarios: true }, guides: [], scenarios: [x.id] }, d).html;
    const flat = text(html);
    for (const ph of scenarios[x.id].phases) {
      assert.ok(flat.includes(text(ph.title)), `${x.id}: phase ${ph.id}`);
      for (const it of ph.items) assert.ok(flat.includes(strip(it.text)), `${x.id}/${ph.id}/${it.id}`);
    }
  }
  const lo = text(buildLoadoutSection(d));
  for (const t of d.loadoutTpl.tiers) for (const f of t.fixed) assert.ok(lo.includes(strip(f.text)), `loadout ${f.id}`);
  const ar = text(buildArrivalSection(d));
  for (const s of d.arrivalTpl.sections) for (const it of s.items) assert.ok(ar.includes(strip(it.text)), `arrival ${it.id}`);
  assert.ok(buildArrivalSection(d).includes('repeat every day'));
  assert.ok(buildGobagSection(d));
  for (const t of [d.loadoutTpl, d.arrivalTpl, d.gobagTpl]) assert.ok(Array.isArray(t.sources));
});
