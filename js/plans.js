// Plans: the pure logic behind "Go to Gram's", the packing list, arrival list, scenarios, go-bags and contacts.
// PURE: no DOM, no IndexedDB, and no Date.now(). Anything that needs "today" or "now" is passed in,
// so Node can import this file and `node --test` can check it (see tests/plans.test.js).
//
// Shapes (the same ones Agent A's data/plans/*.json and Agent C's print code use):
//   template line   { id, text, note?, guide?, source?, who? }
//   run (checklists store)  { id, checked:{key:true}, custom:[{id,text,tier?|section?}], hidden:[key], dailyDate, startedAt, updatedAt }
//   a keyed line in a run: fixed lines use their template id, inventory lines use `item:<inventory id>`,
//   per-person medicine lines use `med:<personId>:<name>`, custom lines use their own `c-...` id.
import { fmtQty } from './format.js';

// ---------- pack field (inventory item.pack) ----------
export const PACK_TIER_IDS = ['t1', 't2', 't3', 't4'];
export const PACK_OPTIONS = [
  { value: '', label: 'Auto (by category)' },
  { value: 't1', label: 'Grab first' },
  { value: 't2', label: 'Power & comms' },
  { value: 't3', label: 'Water & food' },
  { value: 't4', label: "If there's room" },
  { value: 'no', label: "Don't pack" },
];

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const asArray = (v) => (Array.isArray(v) ? v : []);

// An item whose location mentions Gram (any case) is already there: no need to pack it.
export function isAtGrams(item) {
  return /gram/i.test(String((item && item.location) || ''));
}

// Which tier id an inventory item belongs in, or null (= not on the packing list).
// pack:'no' removes it; another valid pack value wins; otherwise kinds are tried across every tier, then categories.
export function tierFor(item, tiers) {
  const list = asArray(tiers);
  if (!item || item.pack === 'no') return null;
  if (item.pack && list.some((t) => t.id === item.pack)) return item.pack;
  for (const t of list) if (asArray(t.match && t.match.kinds).includes(item.kind)) return t.id;
  for (const t of list) if (asArray(t.match && t.match.categories).includes(item.category)) return t.id;
  return null;
}

// ---------- lines ----------
function fixedLine(it, run, hiddenSet) {
  const key = it.id;
  return {
    key, type: 'fixed', id: it.id, text: it.text || '', note: it.note || '', guide: it.guide || '', source: it.source || 0, who: it.who || '',
    checked: !!(run.checked && run.checked[key]), hidden: hiddenSet.has(key),
  };
}

function customLine(c, run) {
  return { key: c.id, type: 'custom', id: c.id, text: c.text || '', note: '', guide: '', source: 0, who: '', checked: !!(run.checked && run.checked[c.id]), hidden: false };
}

function itemLine(item, run, hiddenSet, today) {
  const key = `item:${item.id}`;
  const expired = !!(today && item.expires && String(item.expires) < today);
  return {
    key, type: 'item', id: item.id, text: item.name || 'Item', qty: fmtQty(item.qty, item.unit), location: String(item.location || '').trim(),
    expired, expires: item.expires || '', note: '', guide: '', source: 0, who: '', item,
    checked: !!(run.checked && run.checked[key]), hidden: hiddenSet.has(key),
  };
}

const finish = (line) => ({ ...line, countable: line.type !== 'head' && !line.hidden });

const byLocationThenName = (a, b) => {
  const la = a.location.toLowerCase(); const lb = b.location.toLowerCase();
  if (la !== lb) { if (!la) return 1; if (!lb) return -1; return la < lb ? -1 : 1; }
  return a.text.toLowerCase() < b.text.toLowerCase() ? -1 : a.text.toLowerCase() > b.text.toLowerCase() ? 1 : 0;
};

// The fixed line that means "everybody's medications" (expanded to one line per person's medicine).
export function isMedsLine(it) {
  if (!it) return false;
  if (it.expand === 'meds') return true;
  return /(^|-)meds?(-|$)|medication/i.test(String(it.id || '')) || /\bmedications?\b|\bmeds\b/i.test(String(it.text || ''));
}

function medLines(people, medItems, run, hiddenSet) {
  const out = [];
  const absorbed = new Set();
  for (const p of asArray(people)) {
    for (const m of asArray(p.meds)) {
      const name = String((m && m.name) || '').trim();
      if (!name) continue;
      const key = `med:${p.id}:${slug(name)}`;
      const matches = medItems.filter((i) => String(i.medName || '').trim().toLowerCase() === name.toLowerCase());
      matches.forEach((i) => absorbed.add(i.id));
      const withLoc = matches.find((i) => String(i.location || '').trim());
      const dose = String(m.dose || '').trim();
      out.push({
        key, type: 'med', id: key, text: `${p.name || 'Person'}: ${name}${dose ? ` ${dose}` : ''}`, qty: '',
        location: withLoc ? String(withLoc.location).trim() : '', inStock: matches.length > 0,
        note: '', guide: '', source: 0, who: '', checked: !!(run.checked && run.checked[key]), hidden: hiddenSet.has(key),
      });
    }
  }
  return { lines: out, absorbed };
}

// ---------- the packing list ----------
// template: data/plans/loadout.json; items: inventory; run: checklists record (or null); people: for the meds line.
// opts: { today: 'YYYY-MM-DD' (to flag expired items), showHidden: bool }
export function buildLoadout(template, items, run, people, opts = {}) {
  const r = run || { checked: {}, custom: [], hidden: [] };
  const hiddenSet = new Set(asArray(r.hidden));
  const tiers = asArray(template && template.tiers);
  const today = opts.today || null;
  const showHidden = !!opts.showHidden;
  const inv = asArray(items).filter((i) => i && Number(i.qty) > 0);
  const medItems = inv.filter((i) => i.kind === 'med');

  const atGrams = inv.filter((i) => i.pack !== 'no' && isAtGrams(i)).map((i) => finish(itemLine(i, r, hiddenSet, today))).sort(byLocationThenName);
  const toPack = inv.filter((i) => !isAtGrams(i));

  // medicines: expand the meds line in t1 (or the first tier that has one) into one line per person's medicine
  let medsTierId = null;
  let medsLineId = null;
  for (const t of tiers) {
    const hit = asArray(t.fixed).find(isMedsLine);
    if (hit && (t.id === 't1' || medsTierId === null)) { medsTierId = t.id; medsLineId = hit.id; if (t.id === 't1') break; }
  }
  const meds = medLines(people, medItems.filter((i) => !isAtGrams(i)), r, hiddenSet);
  const expandMeds = medsLineId !== null && meds.lines.length > 0;

  const out = [];
  let hiddenCount = 0;
  const lastTier = tiers.length ? tiers[tiers.length - 1].id : null;
  for (const t of tiers) {
    let lines = [];
    for (const it of asArray(t.fixed)) {
      const base = fixedLine(it, r, hiddenSet);
      if (expandMeds && t.id === medsTierId && it.id === medsLineId) {
        lines.push({ ...base, type: 'head', checked: false });
        if (!base.hidden) lines.push(...meds.lines);
        continue;
      }
      lines.push(base);
    }
    const mine = toPack.filter((i) => tierFor(i, tiers) === t.id && !(expandMeds && meds.absorbed.has(i.id)))
      .map((i) => itemLine(i, r, hiddenSet, today)).sort(byLocationThenName);
    lines.push(...mine);
    lines.push(...asArray(r.custom).filter((c) => (c.tier && tiers.some((x) => x.id === c.tier) ? c.tier : lastTier) === t.id).map((c) => customLine(c, r)));
    hiddenCount += lines.filter((l) => l.hidden).length;
    if (!showHidden) lines = lines.filter((l) => !l.hidden);
    out.push({ id: t.id, title: t.title || t.id, hint: t.hint || '', daily: false, lines: lines.map(finish) });
  }
  const groups = withCounts(out);
  const total = progress({ groups });
  return { tiers: groups, atGrams, hiddenCount, done: total.done, total: total.total };
}

function withCounts(groups) {
  return groups.map((g) => {
    const c = g.lines.filter((l) => l.countable);
    return { ...g, done: c.filter((l) => l.checked).length, total: c.length };
  });
}

// ---------- generic checklists (arrival, scenarios, go-bags) ----------
// sections: [{ id, title, hint?, items:[template line], daily? }]
export function buildSections(sections, run, opts = {}) {
  const r = run || { checked: {}, custom: [], hidden: [] };
  const hiddenSet = new Set(asArray(r.hidden));
  const showHidden = !!opts.showHidden;
  let hiddenCount = 0;
  const out = asArray(sections).map((s) => {
    let lines = asArray(s.items).map((it) => fixedLine(it, r, hiddenSet));
    lines.push(...asArray(r.custom).filter((c) => c.section === s.id).map((c) => customLine(c, r)));
    hiddenCount += lines.filter((l) => l.hidden).length;
    if (!showHidden) lines = lines.filter((l) => !l.hidden);
    return { id: s.id, title: s.title || s.id, hint: s.hint || '', daily: !!s.daily, lines: lines.map(finish) };
  });
  const groups = withCounts(out);
  const total = progress({ groups });
  return { groups, hiddenCount, done: total.done, total: total.total };
}

// { done, total, pct }. `src` is a built loadout / built sections object, or a plain array of lines.
// opts.skipDaily leaves out groups marked daily (they reset every day, so they make "overall progress" meaningless).
export function progress(src, opts = {}) {
  let lines;
  if (Array.isArray(src)) lines = src;
  else {
    const groups = asArray(src && (src.tiers || src.groups));
    lines = groups.filter((g) => !(opts.skipDaily && g.daily)).flatMap((g) => g.lines);
  }
  const counted = lines.filter((l) => l.countable !== undefined ? l.countable : !l.hidden);
  const done = counted.filter((l) => l.checked).length;
  return { done, total: counted.length, pct: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

// ---------- run records ----------
export function emptyRun(id) {
  return { id, checked: {}, custom: [], hidden: [], dailyDate: '', startedAt: 0, updatedAt: 0 };
}

const norm = (run) => ({ ...run, checked: { ...(run.checked || {}) }, custom: asArray(run.custom).map((c) => ({ ...c })), hidden: [...asArray(run.hidden)] });

// Tap a line. The first check of a run also stamps startedAt.
export function toggleLine(run, key, now) {
  const r = norm(run);
  if (r.checked[key]) delete r.checked[key];
  else {
    r.checked[key] = true;
    if (!r.startedAt) r.startedAt = now;
  }
  r.updatedAt = now;
  return r;
}

export function hideLine(run, key, now) {
  const r = norm(run);
  if (!r.hidden.includes(key)) r.hidden.push(key);
  delete r.checked[key];
  r.updatedAt = now;
  return r;
}

export function unhideLine(run, key, now) {
  const r = norm(run);
  r.hidden = r.hidden.filter((k) => k !== key);
  r.updatedAt = now;
  return r;
}

// line: { id, text, tier? , section? }. Blank text is ignored.
export function addCustomLine(run, line, now) {
  const r = norm(run);
  const text = String((line && line.text) || '').trim();
  if (!text) return r;
  const c = { id: line.id, text: text.slice(0, 200) };
  if (line.tier) c.tier = line.tier;
  if (line.section) c.section = line.section;
  r.custom.push(c);
  r.updatedAt = now;
  return r;
}

export function removeCustomLine(run, id, now) {
  const r = norm(run);
  r.custom = r.custom.filter((c) => c.id !== id);
  delete r.checked[id];
  r.updatedAt = now;
  return r;
}

// Reset clears the check marks and the start time. Added lines and hidden lines stay.
export function resetRun(run, now) {
  const r = norm(run);
  r.checked = {};
  r.startedAt = 0;
  r.updatedAt = now;
  return r;
}

// Keys that belong to "daily" sections (template items and the user's own lines in those sections).
export function dailyKeysOf(sections, run) {
  const daily = asArray(sections).filter((s) => s.daily);
  const ids = new Set(daily.map((s) => s.id));
  const keys = daily.flatMap((s) => asArray(s.items).map((i) => i.id));
  for (const c of asArray(run && run.custom)) if (ids.has(c.section)) keys.push(c.id);
  return keys;
}

// A new day wipes the check marks on daily lines. `todayStr` is passed in (never read from the clock here).
// `dailyKeys` says which keys are daily (see dailyKeysOf); without it only the date is stamped.
// A run with no dailyDate yet is just stamped: nothing was checked on an earlier day.
export function applyDailyReset(run, todayStr, dailyKeys) {
  const r = norm(run);
  if (r.dailyDate === todayStr) return r;
  if (r.dailyDate) for (const k of asArray(dailyKeys)) delete r.checked[k];
  r.dailyDate = todayStr;
  return r;
}

// Inventory items the family ticked as packed (for the "what we're taking lasts" runway).
// A ticked "Dad: Lisinopril" line also packs the bottle that is its source, because the list shows that bottle on the medicine line.
export function packedItems(items, run) {
  const checked = (run && run.checked) || {};
  const medSlugs = new Set(Object.keys(checked).filter((k) => checked[k] && k.startsWith('med:')).map((k) => k.split(':').slice(2).join(':')));
  return asArray(items).filter((i) => checked[`item:${i.id}`] || (i.kind === 'med' && medSlugs.has(slug(i.medName))));
}

// ---------- alerts at the top of the packing list ----------
export function loadoutAlerts(items, people) {
  const have = (kind) => asArray(items).some((i) => i && i.kind === kind && Number(i.qty) > 0);
  const out = [];
  if (!have('solar_panel')) {
    out.push({ id: 'no-solar-panel', text: 'No **solar panels** in inventory. Add them so they show up here.', cat: 'power', kind: 'solar_panel' });
  }
  if (!have('battery_pack')) {
    out.push({ id: 'no-power-station', text: 'No **solar generator / power station** in inventory.', cat: 'power', kind: 'battery_pack' });
  }
  if (asArray(people).some((p) => p && p.t1d) && !have('insulin')) {
    out.push({ id: 'no-insulin', text: 'No **insulin** in inventory.', cat: 't1d', kind: 'insulin' });
  }
  return out;
}

// ---------- go-bags ----------
const BAG_TITLES = { base: 'The basics', ifT1D: 'Type 1 diabetes kit', ifMeds: 'Medications', ifChild: 'For a child', ifPet: 'Pet kit' };

// Sections for one person's (or pet's) bag. Returns [{ id, title, items }], skipping empty ones.
export function gobagFor(person, template, isPet = false) {
  const t = template || {};
  const secs = [];
  const add = (id, items, extra = []) => {
    const all = [...asArray(items), ...extra];
    if (all.length) secs.push({ id, title: BAG_TITLES[id], items: all });
  };
  if (isPet) { add('ifPet', t.ifPet); return secs; }
  const p = person || {};
  add('base', t.base);
  if (p.t1d) add('ifT1D', t.ifT1D);
  const meds = asArray(p.meds).filter((m) => m && String(m.name || '').trim());
  if (meds.length) {
    const medItems = meds.map((m) => {
      const dose = String(m.dose || '').trim();
      const per = Number(m.perDay);
      return { id: `med-${slug(m.name)}`, text: `${String(m.name).trim()}${dose ? ` ${dose}` : ''}`, note: Number.isFinite(per) && per > 0 ? `${per} per day` : '' };
    });
    add('ifMeds', t.ifMeds, medItems);
  }
  if (typeof p.age === 'number' ? p.age < 18 : (p.age !== '' && p.age !== null && p.age !== undefined && Number(p.age) < 18)) add('ifChild', t.ifChild);
  return secs;
}

// ---------- the Go plan ----------
export function emptyGoPlan() {
  return {
    destination: { name: "Gram's house", pinId: null, address: '', notes: '' },
    fallback: { name: '', pinId: null, notes: '' },
    routes: [{ label: 'Primary', text: '' }, { label: 'Alternate', text: '' }],
    triggers: [], assignments: [], vehicle: '', leaveNote: '', updatedAt: 0,
  };
}

const str = (v) => (typeof v === 'string' ? v : '');

// Fill in anything missing so the screens never have to check for undefined.
export function normalizeGoPlan(plan) {
  const e = emptyGoPlan();
  const p = plan && typeof plan === 'object' ? plan : {};
  const d = p.destination || {};
  const f = p.fallback || {};
  return {
    destination: { name: str(d.name).trim() || e.destination.name, pinId: d.pinId || null, address: str(d.address), notes: str(d.notes) },
    fallback: { name: str(f.name), pinId: f.pinId || null, notes: str(f.notes) },
    routes: Array.isArray(p.routes) ? p.routes.map((r) => ({ label: str(r && r.label), text: str(r && r.text) })) : e.routes,
    triggers: asArray(p.triggers).map(str),
    assignments: asArray(p.assignments).map((a) => ({ personId: (a && a.personId) || '', task: str(a && a.task) })),
    vehicle: str(p.vehicle), leaveNote: str(p.leaveNote), updatedAt: Number(p.updatedAt) || 0,
  };
}

// True when the family has typed nothing beyond the defaults.
export function goPlanIsEmpty(plan) {
  if (!plan) return true;
  const p = normalizeGoPlan(plan);
  return !(p.destination.address.trim() || p.destination.notes.trim() || p.destination.pinId || p.destination.name !== emptyGoPlan().destination.name
    || p.fallback.name.trim() || p.fallback.notes.trim() || p.fallback.pinId
    || p.routes.some((r) => r.text.trim()) || p.triggers.some((t) => t.trim())
    || p.assignments.some((a) => a.task.trim()) || p.vehicle.trim() || p.leaveNote.trim());
}

// The plan as plain text, to paste into a message or print. Empty parts are left out.
export function goPlanText(plan, people, pins) {
  const p = normalizeGoPlan(plan);
  const pinName = (id) => { const x = asArray(pins).find((q) => q.id === id); return x ? x.name : ''; };
  const personName = (id) => { const x = asArray(people).find((q) => q.id === id); return x ? x.name : ''; };
  const L = [];
  L.push(`GO PLAN: ${p.destination.name}`);
  if (p.destination.address.trim()) L.push(`Address: ${p.destination.address.trim()}`);
  if (p.destination.pinId && pinName(p.destination.pinId)) L.push(`Map pin: ${pinName(p.destination.pinId)}`);
  if (p.destination.notes.trim()) L.push(`About the place: ${p.destination.notes.trim()}`);
  const fb = [p.fallback.name.trim(), p.fallback.pinId ? pinName(p.fallback.pinId) : ''].filter(Boolean);
  if (fb.length || p.fallback.notes.trim()) {
    L.push('', `If we can't get there: ${fb.join(' / ') || '(see notes)'}`);
    if (p.fallback.notes.trim()) L.push(p.fallback.notes.trim());
  }
  const routes = p.routes.filter((r) => r.text.trim());
  if (routes.length) { L.push('', 'Routes:'); for (const r of routes) L.push(`- ${r.label.trim() || 'Route'}: ${r.text.trim()}`); }
  const triggers = p.triggers.filter((t) => t.trim());
  if (triggers.length) { L.push('', 'We go when:'); for (const t of triggers) L.push(`- ${t.trim()}`); }
  const jobs = p.assignments.filter((a) => a.task.trim());
  if (jobs.length) { L.push('', 'Who does what:'); for (const a of jobs) L.push(`- ${personName(a.personId) || 'Someone'}: ${a.task.trim()}`); }
  if (p.vehicle.trim()) L.push('', `Vehicle: ${p.vehicle.trim()}`);
  if (p.leaveNote.trim()) L.push('', `Note to leave behind: ${p.leaveNote.trim()}`);
  return L.join('\n');
}

// Plain-text version of template text (which may use **bold**), for putting into an input box.
export const stripBold = (s) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1');

// ---------- contacts ----------
export function normalizeContact(c) {
  const x = c || {};
  return {
    ...x, name: str(x.name).trim(), relation: str(x.relation).trim(), notes: str(x.notes),
    phones: asArray(x.phones).map((p) => ({ label: str(p && p.label).trim() || 'Cell', number: str(p && p.number).trim() })).filter((p) => p.number),
    outOfArea: !!x.outOfArea, order: Number.isFinite(Number(x.order)) ? Number(x.order) : 0,
  };
}

// Out-of-area contacts first, then everybody by their order number (name breaks ties).
export function sortContacts(list) {
  return [...asArray(list)].sort((a, b) => (b.outOfArea ? 1 : 0) - (a.outOfArea ? 1 : 0)
    || (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name)));
}

// Move one contact up (-1) or down (+1) within its group. Returns only the records whose order changed.
export function moveContact(list, id, dir) {
  const sorted = sortContacts(list);
  const i = sorted.findIndex((c) => c.id === id);
  if (i < 0) return [];
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= sorted.length || !!sorted[j].outOfArea !== !!sorted[i].outOfArea) return [];
  const seq = [...sorted];
  [seq[i], seq[j]] = [seq[j], seq[i]];
  const changed = [];
  seq.forEach((c, n) => { if (Number(c.order) !== n) changed.push({ ...c, order: n }); });
  return changed;
}
