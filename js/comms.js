// Comms & Radio logic. PURE: no DOM, no IndexedDB, no Date.now(). Safe to import in Node (see tests/comms.test.js).
import { distanceMeters } from './mapinfo.js';

// ---------- guide ids (written by the guides agent; the Comms screen links to them) ----------
export const COMMS_GUIDES = {
  listen: 'comms-listen-first',
  scanner: 'comms-scanner',
  transmit: 'comms-what-can-i-transmit',
  license: 'ham-license',
  repeater: 'ham-repeater-basics',
  chirp: 'ham-baofeng-chirp',
  gmrs: 'gmrs-frs',
  meshBasics: 'meshtastic-basics',
  meshSetup: 'meshtastic-setup',
  pace: 'comms-pace',
};

// ---------- frequencies and bands ----------
// Amateur bands we show. Ranges are the US band edges for these bands.
const BANDS = [
  { label: '2 m', lo: 144, hi: 148 },
  { label: '70 cm', lo: 420, hi: 450 },
  { label: '1.25 m', lo: 222, hi: 225 },
  { label: '6 m', lo: 50, hi: 54 },
];
export const BAND_ORDER = ['2 m', '70 cm', '1.25 m', '6 m', 'Other'];

export function bandOf(mhz) {
  const f = Number(mhz);
  if (!Number.isFinite(f)) return 'Other';
  const b = BANDS.find((x) => f >= x.lo && f <= x.hi);
  return b ? b.label : 'Other';
}

export const isHamBand = (mhz) => bandOf(mhz) !== 'Other';
const HANDHELD_BANDS = ['2 m', '70 cm'];
const onHandheld = (mhz) => HANDHELD_BANDS.includes(bandOf(mhz));

// 145.43 -> "145.430", 462.5625 -> "462.5625", 446 -> "446.000" (at least 3 decimals, at most 4)
export function fmtMHz(mhz) {
  const n = Number(mhz);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(4).replace(/0$/, '');
}

// Offset between a repeater's output and input, as { sign, mhz } ('' sign when there is none).
export function repeaterOffset(r) {
  const out = Math.round(Number(r.outputMHz) * 1e6);
  const inp = Math.round(Number(r.inputMHz) * 1e6);
  if (!Number.isFinite(out) || !Number.isFinite(inp) || out === inp) return { sign: '', hz: 0, mhz: 0 };
  const hz = Math.abs(inp - out);
  return { sign: inp > out ? '+' : '-', hz, mhz: hz / 1e6 };
}

// Group repeaters by band. mode: 'FM' (default, analog FM only) or 'All'.
// Returns [{ band, repeaters }] in band order, each list sorted by output frequency. Empty bands are left out.
export function groupRepeaters(list, { mode = 'FM' } = {}) {
  const keep = (list || []).filter((r) => mode === 'All' || String(r.mode || '').toUpperCase() === String(mode).toUpperCase());
  const groups = new Map();
  for (const r of keep) {
    const b = bandOf(r.outputMHz);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(r);
  }
  return BAND_ORDER.filter((b) => groups.has(b)).map((band) => ({
    band,
    repeaters: groups.get(band).slice().sort((a, b) => a.outputMHz - b.outputMHz),
  }));
}

// FRS/GMRS channels in runs that share the same power limits (so 22 rows become 3 short groups).
export function groupChannels(list) {
  const out = [];
  for (const c of list || []) {
    const last = out[out.length - 1];
    if (last && last.frsWatts === c.frsWatts && last.gmrsWatts === c.gmrsWatts) last.channels.push(c);
    else out.push({ frsWatts: c.frsWatts, gmrsWatts: c.gmrsWatts, notes: c.notes, channels: [c] });
  }
  return out;
}

// ---------- coordinates ----------
// Finds explicit "(37.715, -77.365)" style coordinates in a location string. Never geocodes anything else.
export function coordsFromText(str) {
  if (typeof str !== 'string') return null;
  const m = /\(\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*\)/.exec(str);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
  return { lat, lon };
}

export function milesBetween(a, b) {
  return distanceMeters(a, b) / 1609.344;
}

// 12.4 -> "≈ 12 mi", 3.26 -> "≈ 3.3 mi"
export function fmtMiles(miles) {
  if (!Number.isFinite(miles)) return '';
  return `≈ ${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

// Distance text for a repeater from the home pin, or '' when there is no pin or no explicit coordinates.
export function repeaterDistance(home, r) {
  if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lon)) return '';
  const c = coordsFromText(r && r.location);
  return c ? fmtMiles(milesBetween(home, c)) : '';
}

// First sentence of a long note (for one-line summaries).
export function firstSentence(text) {
  const t = String(text || '').trim();
  const m = /^.*?[.!?](?=\s|$)/s.exec(t);
  return m ? m[0] : t;
}

// Simplex entries that are safe to show: the ones the data itself marks "NOT CONFIRMED" are the same claims listed
// under `unverified` in comms.json, so they never reach the screen.
export function simplexShown(list) {
  return (list || []).filter((s) => !/NOT CONFIRMED/i.test(s.use || ''));
}

// ---------- PACE plan ----------
export const PACE_TIERS = [
  { key: 'P', label: 'Primary' },
  { key: 'A', label: 'Alternate' },
  { key: 'C', label: 'Contingency' },
  { key: 'E', label: 'Emergency' },
];
export const PACE_METHODS = ['Cell call', 'Text/SMS', 'Meshtastic', 'FRS/GMRS', 'Ham', 'Meet in person', 'Other'];

export function emptyPlan() {
  return {
    tiers: { P: { method: '', details: '' }, A: { method: '', details: '' }, C: { method: '', details: '' }, E: { method: '', details: '' } },
    checkIns: '',
    codeWords: [],
    meetingPoints: [],
    outOfAreaContact: { name: '', details: '' },
  };
}

// Method names only (no frequencies): the household fills in the details themselves.
export function examplePlan() {
  const p = emptyPlan();
  p.tiers.P.method = 'Cell call';
  p.tiers.A.method = 'Text/SMS';
  p.tiers.C.method = 'Meshtastic';
  p.tiers.E.method = 'FRS/GMRS';
  return p;
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Accepts whatever was stored (or null) and returns a complete, well-shaped plan.
export function normalizePlan(plan) {
  const base = emptyPlan();
  if (!plan || typeof plan !== 'object') return base;
  for (const t of PACE_TIERS) {
    const src = plan.tiers && plan.tiers[t.key];
    if (src) base.tiers[t.key] = { method: str(src.method), details: str(src.details) };
  }
  base.checkIns = str(plan.checkIns);
  base.codeWords = (Array.isArray(plan.codeWords) ? plan.codeWords : []).map((c) => ({ word: str(c && c.word), meaning: str(c && c.meaning) }));
  base.meetingPoints = (Array.isArray(plan.meetingPoints) ? plan.meetingPoints : []).map((m) => ({
    name: str(m && m.name), details: str(m && m.details), pinId: m && m.pinId ? str(m.pinId) : '',
  }));
  const o = plan.outOfAreaContact || {};
  base.outOfAreaContact = { name: str(o.name), details: str(o.details) };
  return base;
}

export function planIsEmpty(plan) {
  const p = normalizePlan(plan);
  return !PACE_TIERS.some((t) => p.tiers[t.key].method || p.tiers[t.key].details.trim())
    && !p.checkIns.trim()
    && !p.codeWords.some((c) => c.word.trim() || c.meaning.trim())
    && !p.meetingPoints.some((m) => m.name.trim() || m.details.trim())
    && !p.outOfAreaContact.name.trim() && !p.outOfAreaContact.details.trim();
}

// Plain text the household can text to family while the network still works.
export function pacePlanText(plan) {
  if (planIsEmpty(plan)) return '';
  const p = normalizePlan(plan);
  const lines = ['FAMILY COMMUNICATION PLAN (PACE)', ''];
  for (const t of PACE_TIERS) {
    const { method, details } = p.tiers[t.key];
    if (!method && !details.trim()) continue;
    lines.push(`${t.key} - ${t.label}: ${[method, details.trim()].filter(Boolean).join(' - ')}`);
  }
  if (p.checkIns.trim()) lines.push('', `Check-ins: ${p.checkIns.trim()}`);
  const words = p.codeWords.filter((c) => c.word.trim());
  if (words.length) {
    lines.push('', 'Code words:');
    for (const c of words) lines.push(`- ${c.word.trim()}${c.meaning.trim() ? `: ${c.meaning.trim()}` : ''}`);
  }
  const pts = p.meetingPoints.filter((m) => m.name.trim());
  if (pts.length) {
    lines.push('', 'Meeting points:');
    for (const m of pts) lines.push(`- ${m.name.trim()}${m.details.trim() ? `: ${m.details.trim()}` : ''}`);
  }
  const o = p.outOfAreaContact;
  if (o.name.trim() || o.details.trim()) lines.push('', `Out-of-area contact: ${[o.name.trim(), o.details.trim()].filter(Boolean).join(' - ')}`);
  return lines.join('\n');
}

// ---------- Meshtastic troubleshooting tree ----------
// Schema (data/comms/mesh-troubleshoot.json): { checkedAt, sources:[{title,url}], start, nodes:{ id: { q | fix, options:[{label,next}] } } }
// `next: null` ends the walk.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Returns { ok, errors }: every next exists, no cycles from start, every node reachable, every fix.source in range.
export function validateTree(tree) {
  const errors = [];
  if (!isObj(tree)) return { ok: false, errors: ['tree is not an object'] };
  if (!isObj(tree.nodes) || !Object.keys(tree.nodes).length) return { ok: false, errors: ['tree has no nodes'] };
  const sources = Array.isArray(tree.sources) ? tree.sources : [];
  const ids = Object.keys(tree.nodes);
  if (typeof tree.start !== 'string' || !tree.nodes[tree.start]) errors.push(`start "${tree.start}" is not a node`);

  for (const id of ids) {
    const n = tree.nodes[id];
    if (!isObj(n)) { errors.push(`${id}: not an object`); continue; }
    const hasQ = typeof n.q === 'string' && n.q.trim() !== '';
    const hasFix = isObj(n.fix);
    if (hasQ === hasFix) errors.push(`${id}: needs exactly one of q or fix`);
    if (hasFix) {
      if (typeof n.fix.title !== 'string' || !n.fix.title.trim()) errors.push(`${id}: fix has no title`);
      if (!Array.isArray(n.fix.steps) || !n.fix.steps.length || n.fix.steps.some((s) => typeof s !== 'string' || !s.trim())) errors.push(`${id}: fix needs steps`);
      const s = n.fix.source;
      if (s !== undefined && s !== null && !(Number.isInteger(s) && s >= 1 && s <= sources.length)) errors.push(`${id}: fix.source ${s} is out of range`);
    }
    if (!Array.isArray(n.options) || !n.options.length) { errors.push(`${id}: needs options`); continue; }
    for (const o of n.options) {
      if (!isObj(o) || typeof o.label !== 'string' || !o.label.trim()) { errors.push(`${id}: option without a label`); continue; }
      if (o.next !== null && (typeof o.next !== 'string' || !tree.nodes[o.next])) errors.push(`${id}: next "${o.next}" does not exist`);
    }
  }
  if (errors.length) return { ok: false, errors };

  // cycles (depth-first from start) and reachability
  const state = {}; // 1 = on the current path, 2 = finished
  const seen = new Set();
  const visit = (id, path) => {
    if (state[id] === 1) { errors.push(`cycle: ${[...path, id].join(' -> ')}`); return; }
    if (state[id] === 2) return;
    state[id] = 1; seen.add(id);
    for (const o of tree.nodes[id].options) if (o.next) visit(o.next, [...path, id]);
    state[id] = 2;
  };
  visit(tree.start, []);
  for (const id of ids) if (!seen.has(id)) errors.push(`${id}: not reachable from start`);
  return { ok: errors.length === 0, errors };
}

// A terminal option ("next: null") means "Fixed" unless its label says otherwise.
export function endKind(label) {
  return /\b(still|stuck|not fixed|didn'?t|did not|no luck|nothing)\b/i.test(String(label || '')) ? 'stuck' : 'fixed';
}

// One screen of the walk. Returns null for an unknown id.
// { id, kind: 'q' | 'fix', text, fix: { title, steps, source: {title,url} | null } | null, options: [{ label, next, end }] }
export function treeStep(tree, id) {
  const n = tree && tree.nodes && Object.prototype.hasOwnProperty.call(tree.nodes, id) ? tree.nodes[id] : null;
  if (!n) return null;
  const isFix = isObj(n.fix);
  let fix = null;
  if (isFix) {
    const src = Number.isInteger(n.fix.source) && Array.isArray(tree.sources) ? tree.sources[n.fix.source - 1] : null;
    fix = { title: n.fix.title || '', steps: Array.isArray(n.fix.steps) ? n.fix.steps.slice() : [], source: src ? { title: src.title || '', url: src.url || '' } : null };
  }
  return {
    id,
    kind: isFix ? 'fix' : 'q',
    text: isFix ? (n.fix.title || '') : (n.q || ''),
    fix,
    options: (Array.isArray(n.options) ? n.options : []).map((o) => ({
      label: o.label, next: o.next == null ? null : o.next, end: o.next == null ? endKind(o.label) : null,
    })),
  };
}

// ---------- CHIRP CSV export ----------
// Format source: CHIRP's own code, https://github.com/kk7ds/chirp (chirp/chirp_common.py: Memory.CSV_FORMAT, TONES,
// TONE_MODES, MODES; chirp/drivers/generic_csv.py: the CSV import driver). The CHIRP wiki page
// https://chirpmyradio.com/projects/chirp/wiki/ChirpCsv sits behind a Cloudflare check that blocks automated reads, so the
// column list and value rules were taken from that code, which is what actually reads the file:
//   - the header is the 21 names in CHIRP_HEADER, in that order
//   - Frequency and Offset are in MHz with 6 decimals ("%i.%06i")
//   - Duplex is "", "+", "-", "split" or "off" ("off" = no transmit, i.e. receive only)
//   - Tone is "", "Tone", "TSQL", "DTCS", ...; for "Tone" the CTCSS value goes in rToneFreq
//   - rToneFreq / cToneFreq must be one of the 50 standard CTCSS tones; DtcsCode "023", DtcsPolarity "NN", CrossMode "Tone->Tone" are the defaults
//   - Mode is one of CHIRP's master modes ("FM" here); TStep like "5.00"
//   - Power must parse as watts ("5.0W"); an empty Power cell is rejected by the importer, so we always write one
export const CHIRP_HEADER = ['Location', 'Name', 'Frequency', 'Duplex', 'Offset', 'Tone', 'rToneFreq', 'cToneFreq', 'DtcsCode', 'DtcsPolarity',
  'RxDtcsCode', 'CrossMode', 'Mode', 'TStep', 'Skip', 'Power', 'Comment', 'URCALL', 'RPT1CALL', 'RPT2CALL', 'DVCODE'];
export const CHIRP_TONES = [67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0,
  127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5,
  203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1];
export const CHIRP_NAME_MAX = 7; // many handhelds show only 6-7 characters

// "145.430000" (integer math, so 144.83 never becomes 144.829999)
export function chirpFreq(mhz) {
  const hz = Math.round(Number(mhz) * 1e6);
  return `${Math.floor(hz / 1e6)}.${String(hz % 1e6).padStart(6, '0')}`;
}

// One CSV cell: quoted only when it has a comma, quote or newline.
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const cleanName = (s) => String(s || '').replace(/[^\x20-\x7e]/g, '').replace(/,/g, ' ').trim();

function uniqueNames(names) {
  const used = new Set();
  return names.map((raw) => {
    let name = cleanName(raw).slice(0, CHIRP_NAME_MAX);
    if (!used.has(name)) { used.add(name); return name; }
    for (let i = 2; i < 100; i += 1) {
      const sfx = String(i);
      const alt = `${name.slice(0, CHIRP_NAME_MAX - sfx.length)}${sfx}`;
      if (!used.has(alt)) { used.add(alt); return alt; }
    }
    return name;
  });
}

// Rows for CHIRP: NOAA channels (receive only), FM simplex frequencies, then analog FM repeaters.
// Ham rows are 2 m and 70 cm only: typical dual-band handhelds can't tune 6 m or 1.25 m.
// Returns the CSV text. `comms` is the parsed data/comms.json.
export function chirpCsv(comms) {
  const c = comms || {};
  const rows = []; // { name, freq, duplex, offset, tone, comment }

  for (const w of c.noaaWeatherRadio || []) {
    rows.push({ name: w.callsign || 'WX', freq: w.freqMHz, duplex: 'off', offset: 0, tone: null, comment: 'NOAA Weather Radio - receive only' });
  }
  for (const s of c.simplexStandards || []) {
    if (!onHandheld(s.freqMHz)) continue;
    if (/\b(SSB|USB|LSB|weak-signal|NOT CONFIRMED)\b/i.test(s.use || '')) continue; // not FM, or not a confirmed channel
    const calling = /calling|national simplex|primary FM simplex/i.test(s.use || '');
    rows.push({ name: Number(s.freqMHz).toFixed(3), freq: s.freqMHz, duplex: '', offset: 0, tone: null, comment: calling ? 'Simplex calling' : 'Simplex' });
  }
  for (const r of c.hamRepeaters || []) {
    if (String(r.mode || '').toUpperCase() !== 'FM') continue; // analog FM only
    if (!onHandheld(r.outputMHz)) continue;
    const off = repeaterOffset(r);
    rows.push({
      name: r.callsign, freq: r.outputMHz, duplex: off.sign, offset: off.mhz, tone: r.toneHz,
      comment: `Repeater${r.location ? ` - ${String(r.location).replace(/\s*\([^)]*\)/g, '')}` : ''}`,
    });
  }

  // duplicate callsigns (one repeater site, two bands) get a number so every channel name is unique
  const names = uniqueNames(rows.map((r) => r.name));
  const lines = [CHIRP_HEADER.join(',')];
  rows.forEach((r, i) => {
    const hasTone = r.tone != null && CHIRP_TONES.includes(Number(r.tone));
    const tone = hasTone ? Number(r.tone).toFixed(1) : '88.5';
    lines.push([
      i + 1, names[i], chirpFreq(r.freq), r.duplex, chirpFreq(r.offset), hasTone ? 'Tone' : '', tone, '88.5', '023', 'NN', '023', 'Tone->Tone',
      'FM', '5.00', '', '5.0W', r.comment, '', '', '', '',
    ].map(csvCell).join(','));
  });
  return `${lines.join('\r\n')}\r\n`;
}

export function chirpFilename(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `home-base-chirp-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`;
}
