import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bandOf, fmtMHz, repeaterOffset, groupRepeaters, groupChannels, coordsFromText, fmtMiles, repeaterDistance, firstSentence,
  emptyPlan, examplePlan, normalizePlan, planIsEmpty, pacePlanText, PACE_METHODS, treeStep, validateTree, endKind,
  simplexShown, chirpCsv, chirpFreq, chirpFilename, CHIRP_HEADER, CHIRP_TONES, CHIRP_NAME_MAX, COMMS_GUIDES,
} from '../js/comms.js';

const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const comms = readJson('../data/comms.json');
const tree = readJson('./fixtures/mesh-tree.json');
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- bands and grouping ----------
test('bandOf: amateur bands, edges and the rest', () => {
  assert.equal(bandOf(145.43), '2 m');
  assert.equal(bandOf(144), '2 m');
  assert.equal(bandOf(148), '2 m');
  assert.equal(bandOf(442.55), '70 cm');
  assert.equal(bandOf(224.42), '1.25 m');
  assert.equal(bandOf(52.525), '6 m');
  assert.equal(bandOf(162.55), 'Other');
  assert.equal(bandOf(462.5625), 'Other');
  assert.equal(bandOf(NaN), 'Other');
  assert.equal(bandOf(undefined), 'Other');
});

test('fmtMHz and repeaterOffset', () => {
  assert.equal(fmtMHz(145.43), '145.430');
  assert.equal(fmtMHz(462.5625), '462.5625');
  assert.equal(fmtMHz(446), '446.000');
  assert.equal(fmtMHz('x'), '—');
  assert.deepEqual(repeaterOffset({ outputMHz: 145.43, inputMHz: 144.83 }), { sign: '-', hz: 600000, mhz: 0.6 });
  assert.deepEqual(repeaterOffset({ outputMHz: 147.135, inputMHz: 147.735 }), { sign: '+', hz: 600000, mhz: 0.6 });
  assert.equal(repeaterOffset({ outputMHz: 224.42, inputMHz: 222.82 }).mhz, 1.6);
  assert.equal(repeaterOffset({ outputMHz: 146.52, inputMHz: 146.52 }).sign, '');
});

test('groupRepeaters: FM only by default, All keeps everything, bands in order, sorted by frequency', () => {
  const fm = groupRepeaters(comms.hamRepeaters);
  assert.deepEqual(fm.map((g) => g.band), ['2 m', '70 cm', '1.25 m']);
  for (const g of fm) for (const r of g.repeaters) assert.equal(r.mode, 'FM');
  const all = groupRepeaters(comms.hamRepeaters, { mode: 'All' });
  assert.equal(all.reduce((n, g) => n + g.repeaters.length, 0), comms.hamRepeaters.length);
  for (const g of all) {
    const f = g.repeaters.map((r) => r.outputMHz);
    assert.deepEqual(f, [...f].sort((a, b) => a - b));
  }
  assert.deepEqual(groupRepeaters([], { mode: 'All' }), []);
  assert.deepEqual(groupRepeaters(null), []);
  const mixed = groupRepeaters([{ outputMHz: 100, mode: 'FM' }, { outputMHz: 146.5, mode: 'FM' }]);
  assert.deepEqual(mixed.map((g) => g.band), ['2 m', 'Other']);
});

test('groupChannels: 22 FRS/GMRS channels collapse into runs with the same power limits', () => {
  const g = groupChannels(comms.frsGmrsChannels);
  assert.equal(g.length, 3);
  assert.deepEqual(g.map((x) => x.channels.length), [7, 7, 8]);
  assert.equal(g[0].channels[0].channel, 1);
  assert.deepEqual(groupChannels([]), []);
});

// ---------- coordinates ----------
test('coordsFromText: explicit coordinates only', () => {
  assert.deepEqual(coordsFromText('Hanover (37.715, -77.365)'), { lat: 37.715, lon: -77.365 });
  assert.deepEqual(coordsFromText('Richmond (37.55,-77.46)'), { lat: 37.55, lon: -77.46 });
  assert.deepEqual(coordsFromText('Richmond (37.5365, -77.4301)'), { lat: 37.5365, lon: -77.4301 });
  assert.equal(coordsFromText('Downtown Richmond, near State Capitol'), null);
  assert.equal(coordsFromText('tower (about 730 ft AGL)'), null);
  assert.equal(coordsFromText('Bad (95.0, -77.0)'), null);
  assert.equal(coordsFromText('Bad (37.0, -200.0)'), null);
  assert.equal(coordsFromText(null), null);
  assert.equal(coordsFromText(42), null);
});

test('which repeaters in comms.json have coordinates (so the distance shows)', () => {
  const withCoords = comms.hamRepeaters.filter((r) => coordsFromText(r.location));
  assert.ok(withCoords.length >= 3);
});

test('repeaterDistance: needs a home pin and explicit coordinates', () => {
  const home = { lat: 37.6, lon: -77.5 };
  const r = { location: 'Hanover (37.715, -77.365)' };
  assert.match(repeaterDistance(home, r), /^≈ \d+(\.\d)? mi$/);
  assert.equal(repeaterDistance(null, r), '');
  assert.equal(repeaterDistance(home, { location: 'Chester, Chesterfield Co.' }), '');
  assert.equal(repeaterDistance({ lat: 'x', lon: 1 }, r), '');
  assert.equal(fmtMiles(3.26), '≈ 3.3 mi');
  assert.equal(fmtMiles(12.4), '≈ 12 mi');
  assert.equal(fmtMiles(NaN), '');
});

test('firstSentence', () => {
  assert.equal(firstSentence('Not by a scanner. RadioReference shows 18.'), 'Not by a scanner.');
  assert.equal(firstSentence('No full stop here'), 'No full stop here');
  assert.equal(firstSentence(''), '');
  assert.equal(firstSentence('Per RR, 0 of 28 (Fire Disp 1/2, etc.). A scanner is needed.'), 'Per RR, 0 of 28 (Fire Disp 1/2, etc.).');
});

test('simplexShown hides the entry comms.json lists as unverified', () => {
  const shown = simplexShown(comms.simplexStandards);
  assert.equal(shown.length, comms.simplexStandards.length - 1);
  assert.ok(!shown.some((s) => s.freqMHz === 223.5));
  assert.ok(shown.some((s) => s.freqMHz === 146.52));
  assert.deepEqual(simplexShown(null), []);
});

// ---------- PACE plan ----------
test('example plan: method names only, no frequencies', () => {
  const p = examplePlan();
  assert.deepEqual(['P', 'A', 'C', 'E'].map((k) => p.tiers[k].method), ['Cell call', 'Text/SMS', 'Meshtastic', 'FRS/GMRS']);
  for (const k of ['P', 'A', 'C', 'E']) {
    assert.ok(PACE_METHODS.includes(p.tiers[k].method));
    assert.equal(p.tiers[k].details, '');
  }
  assert.equal(planIsEmpty(p), false);
  assert.equal(planIsEmpty(emptyPlan()), true);
  assert.equal(planIsEmpty(null), true);
});

test('normalizePlan repairs bad or partial stored data', () => {
  assert.deepEqual(normalizePlan(null), emptyPlan());
  assert.deepEqual(normalizePlan('junk'), emptyPlan());
  const p = normalizePlan({ tiers: { P: { method: 'Cell call' } }, codeWords: [null, { word: 'pineapple' }], meetingPoints: 'x', outOfAreaContact: { name: 'Aunt Jo' } });
  assert.equal(p.tiers.P.method, 'Cell call');
  assert.equal(p.tiers.P.details, '');
  assert.equal(p.tiers.A.method, '');
  assert.deepEqual(p.codeWords, [{ word: '', meaning: '' }, { word: 'pineapple', meaning: '' }]);
  assert.deepEqual(p.meetingPoints, []);
  assert.equal(p.outOfAreaContact.name, 'Aunt Jo');
});

test('pacePlanText: full plan', () => {
  const p = examplePlan();
  p.tiers.P.details = 'Call Dad first';
  p.tiers.C.details = "Meshtastic channel 'Woodfam'";
  p.tiers.E.details = 'FRS ch 7, code off';
  p.checkIns = 'Top of every hour, 2 min';
  p.codeWords = [{ word: 'pineapple', meaning: 'I need help' }, { word: '', meaning: 'ignored' }, { word: 'umbrella', meaning: '' }];
  p.meetingPoints = [{ name: 'Library lot', details: 'Back corner' }, { name: '', details: 'ignored' }];
  p.outOfAreaContact = { name: 'Aunt Jo', details: 'texts only' };
  assert.equal(pacePlanText(p), [
    'FAMILY COMMUNICATION PLAN (PACE)',
    '',
    'P - Primary: Cell call - Call Dad first',
    'A - Alternate: Text/SMS',
    "C - Contingency: Meshtastic - Meshtastic channel 'Woodfam'",
    'E - Emergency: FRS/GMRS - FRS ch 7, code off',
    '',
    'Check-ins: Top of every hour, 2 min',
    '',
    'Code words:',
    '- pineapple: I need help',
    '- umbrella',
    '',
    'Meeting points:',
    '- Library lot: Back corner',
    '',
    'Out-of-area contact: Aunt Jo - texts only',
  ].join('\n'));
});

test('pacePlanText: skips empty tiers and sections; empty plan gives empty text', () => {
  const p = emptyPlan();
  p.tiers.A.method = 'Meet in person';
  assert.equal(pacePlanText(p), 'FAMILY COMMUNICATION PLAN (PACE)\n\nA - Alternate: Meet in person');
  assert.equal(pacePlanText(emptyPlan()), '');
  assert.equal(pacePlanText(undefined), '');
});

// ---------- troubleshooting tree ----------
test('validateTree: the fixture is valid', () => {
  const v = validateTree(tree);
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
});

test('validateTree: missing next', () => {
  const t = clone(tree);
  t.nodes.bt.options[0].next = 'nope';
  const v = validateTree(t);
  assert.equal(v.ok, false);
  assert.match(v.errors.join('\n'), /next "nope" does not exist/);
});

test('validateTree: cycle', () => {
  const t = clone(tree);
  t.nodes['last-resort'].options[1].next = 'root';
  const v = validateTree(t);
  assert.equal(v.ok, false);
  assert.match(v.errors.join('\n'), /cycle: root/);
});

test('validateTree: unreachable node', () => {
  const t = clone(tree);
  t.nodes.orphan = { q: 'Nobody links here', options: [{ label: 'ok', next: null }] };
  const v = validateTree(t);
  assert.equal(v.ok, false);
  assert.match(v.errors.join('\n'), /orphan: not reachable/);
});

test('validateTree: bad source index', () => {
  for (const bad of [0, 3, -1, 1.5, '1']) {
    const t = clone(tree);
    t.nodes['bt-fix-1'].fix.source = bad;
    const v = validateTree(t);
    assert.equal(v.ok, false, String(bad));
    assert.match(v.errors.join('\n'), /out of range/);
  }
});

test('validateTree: other shape problems', () => {
  assert.equal(validateTree(null).ok, false);
  assert.equal(validateTree({}).ok, false);
  assert.equal(validateTree({ nodes: {} }).ok, false);
  let t = clone(tree); t.start = 'missing';
  assert.match(validateTree(t).errors.join('\n'), /start "missing"/);
  t = clone(tree); delete t.nodes.root.q;
  assert.match(validateTree(t).errors.join('\n'), /exactly one of q or fix/);
  t = clone(tree); t.nodes.root.fix = { title: 't', steps: ['s'] };
  assert.match(validateTree(t).errors.join('\n'), /exactly one of q or fix/);
  t = clone(tree); t.nodes.bt.options = [];
  assert.match(validateTree(t).errors.join('\n'), /needs options/);
  t = clone(tree); t.nodes['bt-fix-1'].fix.steps = [];
  assert.match(validateTree(t).errors.join('\n'), /needs steps/);
});

test('treeStep: a question, a fix with a resolved source, and an unknown id', () => {
  const q = treeStep(tree, 'root');
  assert.equal(q.kind, 'q');
  assert.equal(q.text, "What's wrong?");
  assert.deepEqual(q.options.map((o) => o.next), ['bt', 'nodes']);
  assert.deepEqual(q.options.map((o) => o.end), [null, null]);
  const f = treeStep(tree, 'bt-fix-1');
  assert.equal(f.kind, 'fix');
  assert.equal(f.fix.title, 'Forget and re-pair');
  assert.equal(f.fix.steps.length, 3);
  assert.deepEqual(f.fix.source, { title: 'Fixture source one', url: 'https://example.com/one' });
  assert.deepEqual(f.options.map((o) => o.label), ['That fixed it', 'Still broken']);
  assert.equal(treeStep(tree, 'region-fix').fix.source, null);
  assert.equal(treeStep(tree, 'nope'), null);
  assert.equal(treeStep(tree, 'toString'), null);
  assert.equal(treeStep(null, 'root'), null);
});

test('walking: three paths, two ending Fixed and one Still stuck; every walk terminates', () => {
  const walk = (labels) => {
    let id = tree.start;
    for (const label of labels) {
      const step = treeStep(tree, id);
      const opt = step.options.find((o) => o.label === label);
      assert.ok(opt, `${id} has option ${label}`);
      if (opt.next === null) return { id, end: opt.end };
      id = opt.next;
    }
    throw new Error('walk did not end');
  };
  assert.deepEqual(walk(["Phone won't connect to the radio", 'Yes', 'That fixed it']), { id: 'bt-fix-1', end: 'fixed' });
  assert.deepEqual(walk(['No other radios show up', 'No', 'That fixed it']), { id: 'region-fix', end: 'fixed' });
  assert.deepEqual(walk(["Phone won't connect to the radio", 'No', 'Still broken', 'Still stuck']), { id: 'last-resort', end: 'stuck' });
});

test('endKind', () => {
  assert.equal(endKind('That fixed it'), 'fixed');
  assert.equal(endKind('Fixed'), 'fixed');
  assert.equal(endKind('Still stuck'), 'stuck');
  assert.equal(endKind('Still broken'), 'stuck');
  assert.equal(endKind("It didn't work"), 'stuck');
});

test("Part A's real tree (if present) passes validateTree", () => {
  const real = readJson('../data/comms/mesh-troubleshoot.json');
  const v = validateTree(real);
  assert.deepEqual(v.errors, []);
});

// ---------- CHIRP CSV ----------
// A tiny re-implementation of the checks CHIRP's CSV importer makes (chirp/drivers/generic_csv.py, chirp/chirp_common.py).
const CHIRP_MODES = ['WFM', 'FM', 'NFM', 'AM', 'NAM', 'DV', 'USB', 'LSB', 'CW', 'RTTY', 'DIG', 'PKT', 'NCW', 'NCWR', 'CWR', 'P25', 'Auto', 'RTTYR', 'FSK', 'FSKR', 'DMR', 'DN', 'NXDN'];
const CHIRP_TONE_MODES = ['', 'Tone', 'TSQL', 'DTCS', 'DTCS-R', 'TSQL-R', 'Cross'];
const CHIRP_DUPLEX = ['', '-', '+', 'split', 'off'];
const CHIRP_CROSS = ['Tone->Tone', 'DTCS->', '->DTCS', 'Tone->DTCS', 'DTCS->Tone', '->Tone', 'DTCS->DTCS', 'Tone->'];

// RFC 4180 reader (what Python's csv module does)
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r') { /* skip */ } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function chirpAccepts(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  assert.deepEqual(header, CHIRP_HEADER);
  const mems = [];
  for (const line of rows.slice(1)) {
    assert.equal(line.length, header.length, `column count: ${line.join('|')}`);
    const get = (h) => line[header.indexOf(h)];
    assert.ok(Number.isInteger(Number(get('Location'))));
    assert.match(get('Frequency'), /^\d+\.\d{6}$/);
    assert.match(get('Offset'), /^\d+\.\d{6}$/);
    assert.ok(CHIRP_DUPLEX.includes(get('Duplex')), `duplex ${get('Duplex')}`);
    assert.ok(CHIRP_TONE_MODES.includes(get('Tone')));
    assert.ok(CHIRP_TONES.includes(Number(get('rToneFreq'))));
    assert.ok(CHIRP_TONES.includes(Number(get('cToneFreq'))));
    assert.match(get('DtcsCode'), /^\d{3}$/);
    assert.ok(['NN', 'NR', 'RN', 'RR'].includes(get('DtcsPolarity')));
    assert.match(get('RxDtcsCode'), /^\d{3}$/);
    assert.ok(CHIRP_CROSS.includes(get('CrossMode')));
    assert.ok(CHIRP_MODES.includes(get('Mode')));
    assert.ok(Number.isFinite(Number(get('TStep'))));
    assert.ok(['', 'S', 'P'].includes(get('Skip')));
    assert.match(get('Power'), /^\s*[0-9.]+\s*[Ww]?\s*$/, 'Power must parse as watts');
    assert.ok(get('Name').length > 0 && get('Name').length <= CHIRP_NAME_MAX, `name "${get('Name')}"`);
    mems.push({ name: get('Name'), freq: get('Frequency'), duplex: get('Duplex'), offset: get('Offset'), tone: get('Tone'), rtone: get('rToneFreq'), comment: get('Comment') });
  }
  assert.ok(mems.length > 0);
  assert.equal(new Set(mems.map((m) => m.name)).size, mems.length, 'channel names are unique');
  return mems;
}

test('chirpFreq: six decimals, no float noise', () => {
  assert.equal(chirpFreq(145.43), '145.430000');
  assert.equal(chirpFreq(144.83), '144.830000');
  assert.equal(chirpFreq(443.5875), '443.587500');
  assert.equal(chirpFreq(0), '0.000000');
  assert.equal(chirpFreq(0.6), '0.600000');
  assert.equal(chirpFreq(1.6), '1.600000');
});

test('chirpCsv: matches the fixture derived from CHIRP\'s format', () => {
  const mini = readJson('./fixtures/comms-mini.json');
  const expected = readFileSync(new URL('./fixtures/chirp-mini.csv', import.meta.url), 'utf8');
  assert.equal(chirpCsv(mini), expected);
  chirpAccepts(expected);
});

test('chirpCsv: the real comms.json produces a file CHIRP would accept', () => {
  const text = chirpCsv(comms);
  assert.ok(text.endsWith('\r\n'));
  const mems = chirpAccepts(text);
  // NOAA first, receive only
  const noaa = mems.filter((m) => /NOAA/.test(m.comment));
  assert.equal(noaa.length, comms.noaaWeatherRadio.length);
  for (const m of noaa) { assert.equal(m.duplex, 'off'); assert.equal(m.tone, ''); }
  // analog FM repeaters on 2 m / 70 cm only (handhelds can't tune 1.25 m)
  const fm = comms.hamRepeaters.filter((r) => r.mode === 'FM' && ['2 m', '70 cm'].includes(bandOf(r.outputMHz)));
  assert.ok(!mems.some((m) => Number(m.freq) > 200 && Number(m.freq) < 400), 'no 1.25 m rows');
  assert.ok(!mems.some((m) => Number(m.freq) < 100), 'no 6 m rows');
  assert.equal(mems.filter((m) => /^Repeater/.test(m.comment)).length, fm.length);
  // KG4MRA 2 m: output 145.43, input 144.83 -> "-" 0.6, tone 74.4
  const kg = mems.find((m) => m.freq === '145.430000');
  assert.equal(kg.duplex, '-'); assert.equal(kg.offset, '0.600000'); assert.equal(kg.tone, 'Tone'); assert.equal(kg.rtone, '74.4');
  // a repeater with no tone listed gets no tone
  const ka = mems.find((m) => m.freq === '147.360000');
  assert.equal(ka.tone, '');
  // one callsign on two bands still gives unique names
  assert.equal(new Set(mems.map((m) => m.name)).size, mems.length);
  assert.ok(!mems.some((m) => m.name === 'W4RAT'), 'Fusion / DMR / D-STAR repeaters are not exported');
  // simplex: no SSB / unconfirmed rows
  assert.ok(mems.some((m) => m.freq === '146.520000' && m.duplex === ''));
  assert.ok(!mems.some((m) => m.freq === '144.200000'));
  assert.ok(!mems.some((m) => m.freq === '223.500000'));
  assert.ok(!mems.some((m) => m.freq === '432.100000'));
  assert.ok(!mems.some((m) => /^46[27]\./.test(m.freq)), 'FRS/GMRS is not exported');
});

test('chirpCsv: long names are cut to 7, duplicates numbered, odd tones and commas handled', () => {
  const text = chirpCsv({
    hamRepeaters: [
      { callsign: 'ABCDEFGHIJ', outputMHz: 146.94, inputMHz: 146.34, toneHz: 74.4, mode: 'FM', location: 'Somewhere, VA (1.0, 2.0)' },
      { callsign: 'ABCDEFGHIJ', outputMHz: 147.0, inputMHz: 147.6, toneHz: 99.9, mode: 'FM', location: 'x' },
      { callsign: 'ABCDEFGHIJ', outputMHz: 147.2, inputMHz: 147.8, toneHz: 100, mode: 'FM' },
      { callsign: 'DMRONE', outputMHz: 443.5, inputMHz: 448.5, toneHz: null, mode: 'DMR' },
    ],
  });
  const mems = chirpAccepts(text);
  assert.deepEqual(mems.map((m) => m.name), ['ABCDEFG', 'ABCDEF2', 'ABCDEF3']);
  assert.equal(mems[1].tone, '', '99.9 Hz is not a CHIRP tone, so no tone is written');
  assert.equal(mems[2].tone, 'Tone');
  assert.equal(mems[2].rtone, '100.0');
  assert.equal(mems[0].comment, 'Repeater - Somewhere, VA', 'comma in the comment is quoted and the coordinates are dropped');
});

test('chirpCsv: empty or missing data gives just the header', () => {
  assert.equal(chirpCsv({}), `${CHIRP_HEADER.join(',')}\r\n`);
  assert.equal(chirpCsv(null), `${CHIRP_HEADER.join(',')}\r\n`);
});

test('chirpFilename', () => {
  assert.equal(chirpFilename(new Date(2026, 10, 2)), 'home-base-chirp-20261102.csv');
  assert.equal(chirpFilename(new Date(2027, 0, 9)), 'home-base-chirp-20270109.csv');
});

test('guide ids the Comms screen links to are the ones the spec fixed', () => {
  assert.deepEqual(Object.values(COMMS_GUIDES).sort(), [
    'comms-listen-first', 'comms-pace', 'comms-scanner', 'comms-what-can-i-transmit', 'ham-baofeng-chirp', 'ham-license',
    'ham-repeater-basics', 'gmrs-frs', 'meshtastic-basics', 'meshtastic-setup',
  ].sort());
  // once the guides agent has published them they must all exist
  const index = readJson('../data/guides/index.json');
  const have = new Set(index.guides.map((g) => g.id));
  const missing = Object.values(COMMS_GUIDES).filter((id) => !have.has(id));
  if (missing.length && missing.length === Object.values(COMMS_GUIDES).length) return; // Part A not merged yet
  assert.deepEqual(missing, []);
});
