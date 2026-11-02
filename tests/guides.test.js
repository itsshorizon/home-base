import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  bleachDose, bleachResultHtml, richText, kindMap, guidesForKind, blockHtml, guideHtml, t1dPlanHtml, telHref, sortGuides, figureHtml,
  GUIDE_CATEGORY_KEYS, BLOCK_TYPES,
} from '../js/guides.js';
import { validateGuide, checkDir, rewritePrecache, sortEntries, indexEntry, figurePaths } from '../scripts/guides-index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'tests', 'fixtures', 'guides');
const BAD = path.join(ROOT, 'tests', 'fixtures', 'guides-bad');
const FIGROOT = path.join(ROOT, 'tests', 'fixtures', 'figroot'); // has img/guides/ok.svg
const readFix = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));

// ---------- bleach calculator ----------
test('bleachDose: EPA drops per gallon, doubled for cloudy water', () => {
  assert.equal(bleachDose(1, 6, false), 8);
  assert.equal(bleachDose(5, 8.25, true), 60);
  assert.equal(bleachDose(1, 8.25, false), 6);
  assert.equal(bleachDose(1, 6, true), 16);
  assert.equal(bleachDose(10, 6, false), 80);
  assert.equal(bleachDose(0.5, 6, false), 4);
  assert.equal(bleachDose(0.3, 6, false), 3, 'rounds UP (2.4 -> 3) so the dose is never too weak');
  assert.equal(bleachDose('2', '6', false), 16, 'strings from form inputs work');
});

test('bleachDose: bad input', () => {
  assert.equal(bleachDose(0, 6, false), 0);
  assert.equal(bleachDose(-1, 6, false), 0);
  assert.equal(bleachDose(NaN, 6, false), 0);
  assert.throws(() => bleachDose(1, 5, false), RangeError);
});

test('bleachResultHtml: teaspoons only at 64+ drops, always says wait 30 minutes', () => {
  assert.doesNotMatch(bleachResultHtml(5, 6, false), /teaspoon/); // 40 drops
  assert.doesNotMatch(bleachResultHtml(7, 6, false), /teaspoon/); // 56 drops
  assert.match(bleachResultHtml(8, 6, false), /about 1 teaspoon/); // 64 drops
  const big = bleachResultHtml(10, 6, true); // 160 drops
  assert.match(big, /teaspoons/);
  assert.match(big, /1 teaspoon as 64 drops/);
  assert.match(bleachResultHtml(1, 6, false), /wait 30 minutes/);
  assert.match(bleachResultHtml(1, 6, false), /<b>8<\/b> drops/);
  assert.match(bleachResultHtml('', 6, false), /Enter how many gallons/);
});

// ---------- text safety ----------
test('richText: escapes first, then only **bold** becomes <b>', () => {
  assert.equal(richText('a **b** c'), 'a <b>b</b> c');
  assert.equal(richText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(richText('**<i>x</i>**'), '<b>&lt;i&gt;x&lt;/i&gt;</b>');
  assert.equal(richText('"quoted" & \'single\''), '&quot;quoted&quot; &amp; &#39;single&#39;');
  assert.equal(richText(undefined), '');
});

test('blockHtml: every known block type renders; unknown types and bad input render nothing', () => {
  const guide = { id: 'g', sources: [{ title: 'Src <1>', url: 'https://example.com' }] };
  const ctx = { guide, people: [] };
  const samples = {
    p: { type: 'p', text: 'hello **x**' }, h: { type: 'h', text: 'Head' }, steps: { type: 'steps', items: ['a', 'b'] },
    list: { type: 'list', items: ['a'] }, checklist: { type: 'checklist', items: ['a'] }, warning: { type: 'warning', text: 'w' },
    tip: { type: 'tip', text: 't' }, table: { type: 'table', headers: ['h'], rows: [['c']] }, calc: { type: 'calc', calc: 'bleach' },
    t1dplan: { type: 't1dplan' }, source: { type: 'source', n: 1 },
    figure: { type: 'figure', src: 'img/guides/x.svg', alt: 'A diagram', caption: 'Cap' },
  };
  assert.deepEqual(Object.keys(samples).sort(), [...BLOCK_TYPES].sort(), 'test covers every block type');
  for (const [type, block] of Object.entries(samples)) assert.ok(blockHtml(block, 0, ctx), type);
  assert.match(blockHtml(samples.steps, 0, ctx), /<ol class="g-steps"><li>/);
  assert.match(blockHtml(samples.table, 0, ctx), /class="g-table-wrap"/);
  assert.match(blockHtml(samples.source, 0, ctx), /Source: Src &lt;1&gt;/);
  assert.equal(blockHtml({ type: 'source', n: 9 }, 0, ctx), '');
  assert.equal(blockHtml({ type: 'mystery', text: 'x' }, 0, ctx), '');
  assert.equal(blockHtml(null, 0, ctx), '');
  assert.equal(blockHtml({ type: 'calc', calc: 'other' }, 0, ctx), '');
  assert.match(blockHtml({ type: 'checklist', items: ['a', 'b'] }, 3, ctx), /data-check="3:1"/);
});

test('figure block: an img with lazy loading, alt text and a caption, all escaped', () => {
  const html = blockHtml({ type: 'figure', src: 'img/guides/a.svg', alt: 'Say "hi" <b>x</b>', caption: '<script>alert(1)</script> & more' }, 0, { guide: { id: 'g' } });
  assert.match(html, /^<figure class="g-fig">/);
  assert.match(html, /<img src="img\/guides\/a\.svg" alt="Say &quot;hi&quot; &lt;b&gt;x&lt;\/b&gt;" loading="lazy"/);
  assert.match(html, /<figcaption>&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more<\/figcaption>/);
  assert.match(html, /data-fig-zoom/);
  assert.doesNotMatch(html, /<script|<b>x/);
  const hostile = figureHtml({ type: 'figure', src: 'x" onerror="alert(1)', alt: 'a', caption: '' });
  assert.doesNotMatch(hostile, /onerror="/);
  assert.doesNotMatch(figureHtml({ type: 'figure', src: 'a.svg', alt: 'a' }), /figcaption/, 'no caption, no figcaption');
  assert.equal(figureHtml({ type: 'figure', src: 'a.svg', alt: '' }), '', 'no alt text, nothing rendered');
  assert.equal(figureHtml({ type: 'figure', alt: 'a' }), '');
});

test('guideHtml: fixture guides render safely (no raw markup from JSON)', () => {
  const html = guideHtml(readFix('co-safety'), { people: [], items: [] });
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img /i);
  assert.doesNotMatch(html, /<u>|<i>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Checked Oct 31, 2026/);
  assert.doesNotMatch(html, /not medical advice/, 'non-medical guides have no disclaimer');
});

test('guideHtml: medical guides show the disclaimer; related items link by kind', () => {
  const g = readFix('t1d-pump-failure');
  const items = [
    { id: 'a1', name: 'Pen needles', kind: 'pen_needles', qty: 2, unit: 'box' },
    { id: 'a2', name: 'Soup', kind: 'food', qty: 1, unit: 'can' },
  ];
  const html = guideHtml(g, { people: [], items });
  assert.match(html, /General information from the sources below, not medical advice\. In an emergency call 911\. Follow your own doctor&#39;s instructions first\./);
  assert.match(html, /href="#\/item\/a1"/);
  assert.doesNotMatch(html, /href="#\/item\/a2"/);
  assert.match(html, /Related items in your inventory/);
  assert.match(html, /<h2>Sources<\/h2>/);
  assert.match(html, /https:\/\/example\.com\/pump/);
});

test('sources: only http(s) URLs ever become links, and only when online', () => {
  const g = { id: 'g', title: 't', summary: '', category: 'water', checkedAt: '2026-10-31', blocks: [],
    sources: [{ title: 'A', url: 'https://example.com/a' }, { title: 'B', url: 'javascript:alert(1)' }] };
  const online = guideHtml(g, { online: true });
  assert.match(online, /<a href="https:\/\/example\.com\/a"/);
  assert.doesNotMatch(online, /href="javascript/);
  assert.doesNotMatch(guideHtml(g, { online: false }), /<a href="https/);
});

// ---------- T1D plan block ----------
test('t1dPlanHtml: no T1D people, no plan, and a saved plan with tel: links', () => {
  assert.match(t1dPlanHtml([{ id: 'p', name: 'A', t1d: null }]), /No one in your household is marked as having Type 1 diabetes\./);
  assert.match(t1dPlanHtml([]), /No one in your household/);
  const empty = t1dPlanHtml([{ id: 'p9', name: 'Tee', t1d: { plan: null } }]);
  assert.match(empty, /Fill in your emergency plan with your diabetes team/);
  assert.match(empty, /href="#\/person\/p9"/);
  const withPlan = t1dPlanHtml([{ id: 'p9', name: 'Tee <b>', t1d: { plan: {
    backupBasalInsulin: 'lantus', backupBasalUnits: 18, carbRatio: '1:10', correctionFactor: '1 unit per 50 mg/dL', targetBg: '110',
    endoName: 'Dr. <Test>', endoPhone: '(555) 010-0100', pharmacyName: 'Pharm', pharmacyPhone: '+1 555 010 0200',
    pumpSupportPhone: '555-010-0300', cgmSupportPhone: '', notes: 'line<1>', updatedAt: '2026-10-01T10:00:00.000Z',
  } } }]);
  assert.match(withPlan, /<b>18 units<\/b> of Lantus/);
  assert.match(withPlan, /1:10/);
  assert.match(withPlan, /href="tel:5550100100"/);
  assert.match(withPlan, /href="tel:\+15550100200"/);
  assert.match(withPlan, /href="tel:5550100300"/);
  assert.doesNotMatch(withPlan, /CGM support/, 'blank fields are left out');
  assert.match(withPlan, /Dr\. &lt;Test&gt;/);
  assert.match(withPlan, /Tee &lt;b&gt;/);
  assert.match(withPlan, /Last updated Oct 1, 2026 — review with your doctor yearly/);
  assert.equal(telHref('(804) 555-0100 ext. 2'), 'tel:80455501002');
});

// ---------- index helpers ----------
test('kindMap / guidesForKind', () => {
  const index = { guides: [{ id: 'a', kinds: ['bleach', 'filter'] }, { id: 'b', kinds: ['bleach'] }, { id: 'c' }] };
  assert.deepEqual(kindMap(index).bleach.map((g) => g.id), ['a', 'b']);
  assert.deepEqual(guidesForKind(index, 'filter').map((g) => g.id), ['a']);
  assert.deepEqual(guidesForKind(index, 'nope'), []);
  assert.deepEqual(guidesForKind(null, 'bleach'), []);
});

// ---------- index script ----------
test('validateGuide: the three fixture guides are valid', () => {
  for (const id of ['water-bleach', 't1d-pump-failure', 'co-safety']) {
    const { errors } = validateGuide(readFix(id), id);
    assert.deepEqual(errors, [], id);
  }
});

test('validateGuide: each rule fails on its own bad fixture', () => {
  const expect = {
    'id-mismatch': /does not match the filename/, 'no-sources': /at least one source/, 'few-blocks': /at least 3 blocks/,
    'bad-block': /unknown type "video"/, 'figure-missing-file': /file not found/, 'figure-empty-alt': /alt text/, 'bad-category': /unknown category "weather"/,
  };
  for (const [id, re] of Object.entries(expect)) {
    const g = JSON.parse(fs.readFileSync(path.join(BAD, `${id}.json`), 'utf8'));
    const { errors } = validateGuide(g, id);
    assert.ok(errors.some((e) => re.test(e)), `${id}: ${errors.join(' | ')}`);
  }
  assert.ok(validateGuide(null, 'x').errors.length);
});

test('validateGuide: figure blocks need a real file, alt text and a safe relative path', () => {
  const g = (fig) => ({ ...readFix('co-safety'), blocks: [{ type: 'p', text: 'a' }, fig, { type: 'p', text: 'b' }] });
  const ok = { type: 'figure', src: 'img/guides/ok.svg', alt: 'A diagram', caption: 'c' };
  assert.deepEqual(validateGuide(g(ok), 'co-safety', FIGROOT).errors, []);
  assert.ok(validateGuide(g({ ...ok, src: 'img/guides/gone.svg' }), 'co-safety', FIGROOT).errors.some((e) => /file not found/.test(e)));
  assert.ok(validateGuide(g({ ...ok, alt: '' }), 'co-safety', FIGROOT).errors.some((e) => /alt text/.test(e)));
  assert.ok(validateGuide(g({ ...ok, alt: undefined }), 'co-safety', FIGROOT).errors.some((e) => /alt text/.test(e)));
  assert.ok(validateGuide(g({ ...ok, src: '' }), 'co-safety', FIGROOT).errors.some((e) => /needs a src/.test(e)));
  assert.ok(validateGuide(g({ ...ok, src: '../fixtures/figroot/img/guides/ok.svg' }), 'co-safety', FIGROOT).errors.some((e) => /relative path/.test(e)));
  assert.ok(validateGuide(g({ ...ok, src: '/etc/hosts' }), 'co-safety', FIGROOT).errors.some((e) => /relative path/.test(e)));
  assert.ok(validateGuide(g({ ...ok, src: 'img/guides' }), 'co-safety', FIGROOT).errors.some((e) => /file not found/.test(e)), 'a folder is not a file');
  assert.deepEqual(figurePaths(g(ok)), ['img/guides/ok.svg']);
  assert.deepEqual(figurePaths(readFix('co-safety')), []);
});

test('checkDir: figure files are collected for the service worker precache list', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'hb-figs-'));
  try {
    const base = readFix('co-safety');
    const fig = { type: 'figure', src: 'img/guides/ok.svg', alt: 'A diagram' };
    fs.writeFileSync(path.join(dir, 'co-safety.json'), JSON.stringify({ ...base, blocks: [...base.blocks, fig] }));
    const r = checkDir(dir, FIGROOT);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.figures, ['img/guides/ok.svg']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDir: fixtures pass; the bad folder reports every problem file', () => {
  const ok = checkDir(FIX);
  assert.equal(ok.problems.length, 0);
  assert.equal(ok.entries.length, 3);
  const bad = checkDir(BAD);
  assert.equal(bad.entries.length, 0);
  assert.deepEqual(bad.problems.map((p) => p.file).sort(), ['bad-block.json', 'bad-category.json', 'broken.json', 'few-blocks.json', 'figure-empty-alt.json', 'figure-missing-file.json', 'id-mismatch.json', 'no-sources.json']);
  assert.ok(checkDir(path.join(FIX, 'nope')).problems.length, 'missing folder is a problem');
});

test('sortEntries: category order first (water, food, cooking, power, sanitation, hazards, comms, t1d, firstaid), then title', () => {
  const e = (category, title) => ({ id: title, category, title });
  const sorted = sortEntries([e('firstaid', 'B'), e('t1d', 'Z'), e('water', 'Z'), e('water', 'A'), e('cooking', 'M'), e('food', 'F'), e('hazards', 'H'), e('comms', 'C')]);
  assert.deepEqual(sorted.map((x) => x.title), ['A', 'Z', 'F', 'M', 'H', 'C', 'Z', 'B']);
  assert.deepEqual(GUIDE_CATEGORY_KEYS, ['water', 'food', 'cooking', 'power', 'sanitation', 'hazards', 'comms', 't1d', 'firstaid']);
  assert.equal(sortGuides([e('t1d', 'b'), e('water', 'a')])[0].title, 'a');
});

test('indexEntry: only the list fields, booleans coerced', () => {
  const entry = indexEntry({ ...readFix('co-safety'), blocks: [1], emergency: 'yes' });
  assert.deepEqual(Object.keys(entry), ['id', 'title', 'category', 'summary', 'emergency', 'medical', 'kinds']);
  assert.equal(entry.emergency, false);
});

test('rewritePrecache: replaces only what is between the markers', () => {
  const sw = "const P = [\n  'a.js',\n  // GUIDES:START\n  'old.json',\n  // GUIDES:END\n  'b.js',\n];";
  const out = rewritePrecache(sw, ['data/guides/index.json', 'data/guides/x.json']);
  assert.equal(out, "const P = [\n  'a.js',\n  // GUIDES:START\n  'data/guides/index.json',\n  'data/guides/x.json',\n  // GUIDES:END\n  'b.js',\n];");
  assert.equal(rewritePrecache(out, []).includes("'old.json'"), false);
  assert.throws(() => rewritePrecache('no markers', []), /marker/);
  const real = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.doesNotThrow(() => rewritePrecache(real, ['data/guides/index.json']), 'the real sw.js has the markers');
});

test('CLI: --dir fixtures --dry-run succeeds and writes nothing; bad folder exits non-zero', () => {
  const script = path.join(ROOT, 'scripts', 'guides-index.js');
  const swBefore = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const indexPath = path.join(FIX, 'index.json');
  const indexBefore = fs.existsSync(indexPath) ? fs.statSync(indexPath).mtimeMs : null;
  const ok = spawnSync(process.execPath, [script, '--dir', FIX, '--dry-run'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /3 guides OK/);
  assert.match(ok.stdout, /Dry run/);
  assert.equal(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), swBefore);
  assert.equal(fs.existsSync(indexPath) ? fs.statSync(indexPath).mtimeMs : null, indexBefore);
  const bad = spawnSync(process.execPath, [script, '--dir', BAD, '--dry-run'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /id-mismatch\.json/);
  assert.match(bad.stdout, /no-sources\.json/);
});

test('fixture index.json (what the app loads) matches the validated fixtures', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(FIX, 'index.json'), 'utf8'));
  assert.deepEqual(idx.guides.map((g) => g.id).sort(), ['co-safety', 't1d-pump-failure', 'water-bleach']);
  assert.deepEqual(idx.guides.map((g) => g.id), checkDir(FIX).entries.map((g) => g.id));
});

test('real guide figures: file exists, under 25 KB, self-contained, and aria-label equals the block alt', () => {
  const dir = path.join(ROOT, 'data', 'guides');
  let count = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'index.json')) {
    const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const b of g.blocks.filter((x) => x.type === 'figure')) {
      count++;
      const file = path.join(ROOT, b.src);
      assert.ok(fs.existsSync(file), `${f}: ${b.src} is missing`);
      const svg = fs.readFileSync(file, 'utf8');
      assert.ok(Buffer.byteLength(svg) < 25 * 1024, `${b.src} is over 25 KB`);
      assert.doesNotMatch(svg, /<script|<image|<foreignObject|https?:\/\/(?!www\.w3\.org)/i, `${b.src} must be self-contained`);
      assert.match(svg, /role="img"/, `${b.src} needs role="img"`);
      assert.match(svg, /<title>[^<]+<\/title>/, `${b.src} needs a <title>`);
      const m = svg.match(/aria-label="([^"]*)"/);
      assert.ok(m, `${b.src} needs an aria-label`);
      assert.equal(m[1], b.alt, `${b.src}: aria-label must equal the block's alt text`);
      assert.ok(b.caption && b.caption.trim(), `${f}: figure needs a caption`);
    }
  }
  assert.ok(count >= 16, `expected the guide diagrams, found ${count}`);
});

// ---------- Phase 5: comms guides and the Meshtastic troubleshooting tree ----------
const COMMS_IDS = ['comms-listen-first', 'comms-what-can-i-transmit', 'ham-license', 'ham-repeater-basics', 'ham-baofeng-chirp',
  'gmrs-frs', 'meshtastic-basics', 'meshtastic-setup', 'comms-pace', 'comms-scanner'];

test('comms guides: all ten required ids exist, are in the comms category, and carry sources', () => {
  for (const id of COMMS_IDS) {
    const file = path.join(ROOT, 'data', 'guides', `${id}.json`);
    assert.ok(fs.existsSync(file), `${id} is missing`);
    const g = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(g.id, id);
    assert.equal(g.category, 'comms');
    assert.ok(g.sources.length >= 1 && g.blocks.length >= 3);
    for (const b of g.blocks.filter((x) => x.type === 'source')) assert.ok(b.n >= 1 && b.n <= g.sources.length, `${id}: source block ${b.n} out of range`);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'guides', 'comms-listen-first.json'), 'utf8')).kinds, ['weather_radio']);
  for (const id of ['ham-baofeng-chirp', 'gmrs-frs']) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'guides', `${id}.json`), 'utf8')).kinds, ['two_way_radio']);
});

test('comms guides: never show unverified claims (the RVA Mesh claim stays out)', () => {
  for (const id of COMMS_IDS) {
    const text = fs.readFileSync(path.join(ROOT, 'data', 'guides', `${id}.json`), 'utf8');
    assert.doesNotMatch(text, /906\.875|msh\/US\/VA|RVA Mesh/i, `${id} contains an unverified RVA Mesh detail`);
  }
});

function loadMeshTree() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'comms', 'mesh-troubleshoot.json'), 'utf8')); }

test('mesh troubleshooting tree: shape, every next exists, sources in range, 25-40 nodes', () => {
  const t = loadMeshTree();
  const ids = Object.keys(t.nodes);
  assert.ok(ids.length >= 25 && ids.length <= 40, `expected 25-40 nodes, got ${ids.length}`);
  assert.ok(t.nodes[t.start]);
  assert.ok(Array.isArray(t.sources) && t.sources.every((s) => s.title && /^https:\/\//.test(s.url)));
  for (const id of ids) {
    const n = t.nodes[id];
    assert.ok(Boolean(n.q) !== Boolean(n.fix), `${id}: needs exactly one of q or fix`);
    assert.ok(Array.isArray(n.options) && n.options.length >= 1, `${id}: needs options`);
    if (n.fix) {
      assert.ok(n.fix.title && n.fix.steps.length >= 1, `${id}: fix needs a title and steps`);
      assert.ok(Number.isInteger(n.fix.source) && n.fix.source >= 1 && n.fix.source <= t.sources.length, `${id}: fix.source out of range`);
    }
    for (const o of n.options) {
      assert.ok(o.label, `${id}: option without a label`);
      assert.ok(o.next === null || t.nodes[o.next], `${id}: next "${o.next}" does not exist`);
    }
  }
});

test('mesh troubleshooting tree: no cycles, every node reachable from start', () => {
  const t = loadMeshTree();
  const state = {};
  const seen = new Set();
  const visit = (id, trail) => {
    assert.notEqual(state[id], 1, `cycle: ${[...trail, id].join(' -> ')}`);
    if (state[id] === 2) return;
    state[id] = 1; seen.add(id);
    for (const o of t.nodes[id].options) if (o.next) visit(o.next, [...trail, id]);
    state[id] = 2;
  };
  visit(t.start, []);
  assert.deepEqual(Object.keys(t.nodes).filter((id) => !seen.has(id)), [], 'unreachable nodes');
});

test('mesh troubleshooting tree: every walk ends in "fixed" or "Still stuck", and stuck always passes the last-resort fix', () => {
  const t = loadMeshTree();
  // The Comms screen reads an ending from the label of an option whose next is null.
  const isStuck = (label) => /\b(still|stuck|not fixed|didn'?t|did not|no luck|nothing)\b/i.test(label);
  const ends = [];
  for (const [id, n] of Object.entries(t.nodes)) {
    if (n.q) assert.ok(n.options.every((o) => o.next), `${id}: a question must lead somewhere`);
    for (const o of n.options) if (o.next === null) ends.push({ id, label: o.label, stuck: isStuck(o.label) });
    if (n.fix) {
      assert.ok(n.options.some((o) => o.next === null && /fixed/i.test(o.label) && !isStuck(o.label)), `${id}: a fix needs a "That fixed it" ending`);
      if (id !== 'last-resort') assert.ok(n.options.some((o) => o.next !== null), `${id}: a fix needs a "Still broken" path`);
    }
  }
  const last = t.nodes['last-resort'];
  assert.ok(last && last.fix, 'last-resort fix exists');
  assert.ok(last.options.some((o) => o.next === null && /^Still stuck$/.test(o.label)));
  assert.ok(last.options.every((o) => o.next === null), 'the last resort ends the walk');
  assert.deepEqual(ends.filter((e) => e.stuck).map((e) => e.id), ['last-resort'], 'only the last resort may end "Still stuck"');
  assert.ok(JSON.stringify(last.fix.steps).includes('PACE'), 'the last resort reminds the reader to fall back to the next PACE method');
  // every non-last-resort fix eventually reaches last-resort via "Still broken"
  const reaches = (id, seen = new Set()) => {
    if (id === 'last-resort') return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return t.nodes[id].options.filter((o) => o.next).some((o) => reaches(o.next, seen));
  };
  for (const id of Object.keys(t.nodes)) assert.ok(reaches(id), `${id} cannot reach the last resort`);
});
