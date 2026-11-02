// Printable binder: pure builders that turn data into HTML strings. PURE: no DOM, no IndexedDB, no fetch,
// no Date.now() (the printed-on date is passed in as `today`, 'YYYY-MM-DD'). Safe to import in Node (tests/print.test.js).
//
// Rules this file follows:
//  - Every piece of user-entered text (names, notes, addresses, phone numbers, custom checklist lines) goes through esc().
//    Template and guide text goes through esc() too (richText() escapes first, then turns **x** into <b>x</b>).
//  - Nothing from data/comms.json `unverified` is ever printed, and entries whose callsign an unverified claim mentions are left out.
//  - Missing data never throws: a section with nothing to print is skipped, and buildDocument() says which and why.
import { esc, fmtDate, fmtQty } from './format.js';
import { richText, planHasContent, sortGuides, guideCategory, DISCLAIMER, bleachDose } from './guides.js';
import { ROOM_TEMP_LABELS } from './categories.js';
import { PIN_TYPES } from './mapinfo.js';
import { buildLoadout, buildSections, gobagFor } from './plans.js';
import { PACE_TIERS, normalizePlan, planIsEmpty, fmtMHz, repeaterOffset, bandOf } from './comms.js';

// ---------- the picker's sections ----------
export const SECTION_DEFS = [
  { key: 'cover', label: 'Cover and quick card', hint: "Where we go, routes, fallback", on: true },
  { key: 'goplan', label: "Go to Gram's plan", hint: 'Triggers, who does what, routes', on: true },
  { key: 'loadout', label: 'Load-out checklist', hint: 'What to pack, with where each thing is', on: true },
  { key: 'arrival', label: 'Arrival checklist', hint: 'What to do when we get there', on: true },
  { key: 'pace', label: 'Family plan and contacts', hint: 'PACE plan, phone numbers, out-of-area contact', on: true },
  { key: 'medical', label: 'Medical summary', hint: 'Private: medications, allergies, diabetes plan', on: true },
  { key: 'comms', label: 'Radio quick card', hint: 'Weather radio, FRS/GMRS, Meshtastic, repeaters', on: true },
  { key: 'emergency', label: 'Emergency guides', hint: 'The guides marked emergency, in full', on: true },
  { key: 'scenarios', label: 'Scenario checklists', hint: 'Pick which ones below', on: false },
  { key: 'gobags', label: 'Go-bags', hint: 'One list per person and pet', on: false },
  { key: 'inventory', label: 'Full inventory by location', hint: 'Name, quantity, expiry', on: false },
  { key: 'pins', label: 'Map pins', hint: 'Name, type, coordinates, notes', on: false },
  { key: 'guides', label: 'Other guides', hint: 'Pick which ones below', on: false },
];

export function defaultSelection() {
  const sections = {};
  for (const d of SECTION_DEFS) sections[d.key] = d.on;
  return { sections, guides: [], scenarios: [] };
}

// Accepts whatever was stored in localStorage (or null) and returns a well-shaped selection.
export function normalizeSelection(raw) {
  const base = defaultSelection();
  if (!raw || typeof raw !== 'object') return base;
  if (raw.sections && typeof raw.sections === 'object') {
    for (const d of SECTION_DEFS) if (typeof raw.sections[d.key] === 'boolean') base.sections[d.key] = raw.sections[d.key];
  }
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[a-z0-9-]+$/i.test(x)) : []);
  base.guides = ids(raw.guides);
  base.scenarios = ids(raw.scenarios);
  return base;
}

// ---------- small helpers ----------
const str = (v) => (v == null ? '' : String(v).trim());
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const BOX = '<span class="print-box" aria-hidden="true"></span>';
const BLANK = '<span class="print-blank"></span>';
// Text the user typed, or a blank line to write on when they left it empty.
const orBlank = (v) => (str(v) ? esc(str(v)) : BLANK);
const pre = (v) => `<span class="print-pre">${esc(str(v))}</span>`;
const safeUrl = (u) => /^https?:\/\//i.test(str(u));
const DEFAULT_DEST = "Gram's house";

export function textLen(html) { return String(html || '').replace(/<[^>]*>/g, '').length; }

// Rough page count for one block of HTML: about 3,000 characters per page, and a figure takes a quarter page.
export function estimatePagesOf(html) {
  const imgs = (String(html).match(/<img /g) || []).length;
  return Math.max(1, Math.ceil((textLen(html) + imgs * 900) / 3000));
}

function sec(key, title, inner, today, kicker = '') {
  return `<section class="print-sec" data-sec="${esc(key)}">
    <div class="print-runhead">Home Base · printed ${esc(today)}</div>
    ${kicker ? `<div class="print-kicker">${esc(kicker)}</div>` : ''}
    <h2 class="print-h2">${esc(title)}</h2>${inner}</section>`;
}

const personName = (people, id) => {
  const p = arr(people).find((x) => x && x.id === id);
  return p ? str(p.name) || 'Unnamed' : '(person removed)';
};
const pinById = (pins, id) => (id ? arr(pins).find((p) => p && p.id === id) || null : null);
const guideTitleOf = (ctx, id) => {
  const g = ctx && ctx.guideIndex ? arr(ctx.guideIndex.guides).find((x) => x.id === id) : null;
  return g ? g.title : '';
};

function pinCoords(pin) {
  if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lon)) return '';
  return `${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}`;
}

// A numbered list of sources. The title is a link, and print.css prints the web address after it, so the paper copy
// shows where each fact came from.
export function sourcesHtml(sources, label = 'Sources') {
  const list = arr(sources).filter((s) => isObj(s) && str(s.title));
  if (!list.length) return '';
  return `<div class="print-sources"><b>${esc(label)}</b><ol>${list.map((s) => `<li>${safeUrl(s.url)
    ? `<a class="print-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`
    : esc(s.title)}</li>`).join('')}</ol></div>`;
}

// ---------- checklist rows ----------
// Lines come from js/plans.js (buildLoadout / buildSections), which Agent B owns: the same logic as the on-screen lists.
// Checkbox state is never printed: the paper copy is always a blank form.
const stripRun = (run) => ({ checked: {}, custom: arr(run && run.custom).filter((c) => c && str(c.text)), hidden: arr(run && run.hidden) });

function metaHtml(l, ctx, sources) {
  const gt = l.guide ? guideTitleOf(ctx, l.guide) : '';
  const src = Number.isInteger(l.source) && l.source >= 1 && l.source <= arr(sources).length ? `<sup class="print-ref">[${l.source}]</sup>` : '';
  return { src, extra: `${str(l.who) ? `<span class="print-line-who">${esc(l.who)}</span>` : ''}${str(l.note) ? `<span class="print-line-note">${richText(l.note)}</span>` : ''}${gt ? `<span class="print-line-note">Guide: ${esc(gt)}</span>` : ''}` };
}

// One built line (any type) as a list item with an empty box.
function lineHtml(l, ctx, sources) {
  if (l.type === 'head') return `<li class="print-line-head">${richText(l.text)}</li>`;
  const { src, extra } = metaHtml(l, ctx, sources);
  const loc = str(l.location) ? `<span class="print-loc">${esc(l.location)}</span>` : '';
  let text;
  if (l.type === 'item') {
    text = `<b>${esc(l.text)}</b> <span class="print-qty">${esc(l.qty)}</span>`;
    return `<li class="print-line">${BOX}<div class="print-line-body"><span class="print-line-text">${text}</span>
      ${loc || '<span class="print-loc"><i>location not set</i></span>'}
      ${l.expired ? `<span class="print-expired">EXPIRED ${esc(fmtDate(l.expires))}</span>` : ''}${extra}</div></li>`;
  }
  if (l.type === 'med') text = esc(l.text); // "Dad: lisinopril 10 mg": typed by the user
  else if (l.type === 'custom') text = esc(l.text);
  else text = richText(l.text);
  return `<li class="print-line">${BOX}<div class="print-line-body"><span class="print-line-text">${text}${src}</span>${loc}${extra}</div></li>`;
}

const groupHtml = (g, ctx, sources, { daily = true } = {}) => `<div class="print-tier"><h3 class="print-h3">${esc(g.title)}${daily && g.daily ? ' <small>(repeat every day)</small>' : ''}</h3>
  ${str(g.hint) ? `<p class="print-hint">${esc(g.hint)}</p>` : ''}
  <ul class="print-lines">${g.lines.map((l) => lineHtml(l, ctx, sources)).join('')}</ul>
  ${g.lines.length ? '' : '<p class="print-none">Nothing here yet.</p>'}</div>`;

// ---------- load-out ----------
export function loadoutHtml(template, items, run, people, ctx, today) {
  const built = buildLoadout(template, items, stripRun(run), people, { today });
  const grams = built.atGrams.length
    ? `<div class="print-tier"><h3 class="print-h3">Already at Gram's (no need to pack)</h3>
        <ul class="print-lines-plain">${built.atGrams.map((l) => `<li class="print-line-plain"><b>${esc(l.text)}</b> ${esc(l.qty)} <span class="print-loc">${esc(l.location)}</span></li>`).join('')}</ul></div>` : '';
  return `${built.tiers.map((t) => groupHtml(t, ctx, template.sources)).join('')}${grams}${sourcesHtml(template.sources)}`;
}

export function buildLoadoutSection(data) {
  const tpl = data.loadoutTpl;
  if (!isObj(tpl) || !arr(tpl.tiers).length) return null;
  const ctx = { guideIndex: data.guideIndex };
  const inner = `<p class="print-intro">Tick each box as it goes in the car. Take it in this order: if time runs out, the first group matters most.</p>
    ${loadoutHtml(tpl, data.items, (data.runs || {}).loadout, data.people, ctx, data.today)}`;
  return sec('loadout', `Load-out checklist: go to ${destName(data.goPlan)}`, inner, data.today);
}

// ---------- arrival ----------
export function buildArrivalSection(data) {
  const tpl = data.arrivalTpl;
  if (!isObj(tpl) || !arr(tpl.sections).length) return null;
  const ctx = { guideIndex: data.guideIndex };
  const built = buildSections(tpl.sections, stripRun((data.runs || {}).arrival));
  const notes = str(data.goPlan && data.goPlan.destination && data.goPlan.destination.notes);
  const inner = `${notes ? `<div class="print-callout"><b>About ${esc(destName(data.goPlan))}:</b> ${pre(notes)}</div>` : ''}
    ${built.groups.map((g) => groupHtml(g, ctx, tpl.sources)).join('')}${sourcesHtml(tpl.sources)}`;
  return sec('arrival', `When we get to ${destName(data.goPlan)}`, inner, data.today);
}

// ---------- scenarios ----------
export function buildScenarioSection(tpl, data) {
  if (!isObj(tpl) || !arr(tpl.phases).length) return null;
  const ctx = { guideIndex: data.guideIndex };
  const run = stripRun((data.runs || {})[`scenario:${tpl.id}`]);
  const built = buildSections(tpl.phases, run);
  // custom lines that name no known phase would vanish: keep them in their own group
  const lost = run.custom.filter((c) => !tpl.phases.some((p) => p.id === c.section) && !run.hidden.includes(c.id));
  const guides = arr(tpl.guides).map((id) => guideTitleOf(ctx, id)).filter(Boolean);
  const inner = `${str(tpl.summary) ? `<p class="print-intro">${richText(tpl.summary)}</p>` : ''}
    ${built.groups.map((g) => groupHtml(g, ctx, tpl.sources)).join('')}
    ${lost.length ? `<div class="print-tier"><h3 class="print-h3">Our own lines</h3><ul class="print-lines">${lost.map((c) => lineHtml({ type: 'custom', text: c.text }, ctx, [])).join('')}</ul></div>` : ''}
    ${guides.length ? `<p class="print-hint"><b>Related guides:</b> ${guides.map(esc).join(' · ')}</p>` : ''}${sourcesHtml(tpl.sources)}`;
  return sec(`scenario-${tpl.id}`, str(tpl.title) || 'Scenario', inner, data.today, 'Scenario checklist');
}

// ---------- go-bags ----------
export function buildGobagSection(data) {
  const tpl = data.gobagTpl;
  if (!isObj(tpl)) return null;
  const ctx = { guideIndex: data.guideIndex };
  const runs = data.runs || {};
  const bags = [];
  const one = (name, subject, sections, run) => {
    if (!sections.length) return;
    const built = buildSections(sections, stripRun(run));
    const mine = stripRun(run).custom;
    bags.push(`<div class="print-bag"><h3 class="print-h3 print-bagname">${esc(name)} <small>${esc(subject)}</small></h3>
      ${built.groups.map((g) => `<h4 class="print-h4">${esc(g.title)}</h4><ul class="print-lines">${g.lines.map((l) => lineHtml(l, ctx, tpl.sources)).join('')}</ul>`).join('')}
      ${mine.length ? `<h4 class="print-h4">Our own lines</h4><ul class="print-lines">${mine.map((c) => lineHtml({ type: 'custom', text: c.text }, ctx, [])).join('')}</ul>` : ''}</div>`);
  };
  for (const p of arr(data.people)) if (p && str(p.name)) one(p.name, 'go-bag', gobagFor(p, tpl), runs[`gobag:${p.id}`]);
  for (const p of arr(data.pets)) if (p && str(p.name)) one(p.name, 'pet go-bag', gobagFor(p, tpl, true), runs[`gobag:${p.id}`] || runs[`gobag:pet-${p.id}`]);
  if (!bags.length) return null;
  return sec('gobags', 'Go-bags', `${bags.join('')}${sourcesHtml(tpl.sources)}`, data.today);
}

// ---------- go plan and cover ----------
export const destName = (goPlan) => str(goPlan && goPlan.destination && goPlan.destination.name) || DEFAULT_DEST;

export function goPlanHasContent(gp) {
  if (!isObj(gp)) return false;
  const d = gp.destination || {};
  const f = gp.fallback || {};
  return !!(str(d.address) || str(d.notes) || d.pinId || str(f.name) || str(f.notes) || f.pinId
    || arr(gp.routes).some((r) => str(r && r.text)) || arr(gp.triggers).some((t) => str(t))
    || arr(gp.assignments).some((a) => a && str(a.task)) || str(gp.vehicle) || str(gp.leaveNote));
}

function placeBlock(label, place, pins, { showName = true } = {}) {
  const pin = pinById(pins, place && place.pinId);
  const coords = pinCoords(pin);
  return `<div class="print-place"><div class="print-label">${esc(label)}</div>
    ${showName ? `<div class="print-big">${orBlank(place && place.name)}</div>` : ''}
    ${place && 'address' in place ? `<div>${orBlank(place.address)}</div>` : ''}
    ${coords ? `<div class="print-small">Pin: ${esc(coords)}</div>` : ''}
    ${str(place && place.notes) ? `<div class="print-small">${pre(place.notes)}</div>` : ''}</div>`;
}

function routesHtml(routes) {
  const list = arr(routes).filter((r) => r && (str(r.text) || str(r.label)));
  if (!list.length) return '';
  return `<div class="print-label">Routes</div><ul class="print-plain">${list.map((r) => `<li><b>${esc(str(r.label) || 'Route')}:</b> ${str(r.text) ? pre(r.text) : BLANK}</li>`).join('')}</ul>`;
}

export function buildCover(data, contents = []) {
  const gp = isObj(data.goPlan) ? data.goPlan : {};
  const dest = { ...(gp.destination || {}), name: destName(gp), address: str(gp.destination && gp.destination.address) };
  const fb = gp.fallback || {};
  const inner = `<p class="print-lead">Printed ${esc(fmtDate(data.today))}. Keep this binder with the go-bags.</p>
    ${placeBlock('If we have to leave, we go to', dest, data.pins)}
    ${placeBlock('If we cannot get there, we meet at', { name: fb.name, notes: fb.notes, pinId: fb.pinId }, data.pins)}
    ${routesHtml(gp.routes) || `<div class="print-label">Routes</div><ul class="print-plain"><li>Primary: ${BLANK}</li><li>Alternate: ${BLANK}</li></ul>`}
    ${contents.length ? `<div class="print-label">In this binder</div><ol class="print-contents">${contents.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
    <p class="print-hint">Phone numbers and the radio plan are in the sections that follow. This paper is the backup for when the phone is dead.</p>`;
  return sec('cover', 'Home Base binder', inner, data.today);
}

export function buildGoPlanSection(data) {
  const gp = data.goPlan;
  if (!goPlanHasContent(gp)) return null;
  const d = { ...(gp.destination || {}), name: destName(gp), address: str(gp.destination && gp.destination.address) };
  const fb = gp.fallback || {};
  const triggers = arr(gp.triggers).map(str).filter(Boolean);
  const assigns = arr(gp.assignments).filter((a) => a && str(a.task));
  const inner = `${placeBlock('Destination', d, data.pins)}
    ${placeBlock('Fallback', { name: fb.name, notes: fb.notes, pinId: fb.pinId }, data.pins)}
    ${triggers.length ? `<h3 class="print-h3">We go when</h3><ul class="print-plain">${triggers.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${routesHtml(gp.routes)}
    ${assigns.length ? `<h3 class="print-h3">Who does what</h3><table class="print-table"><thead><tr><th>Who</th><th>Job</th></tr></thead><tbody>${assigns.map((a) => `<tr><td>${esc(personName(data.people, a.personId))}</td><td>${esc(a.task)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${str(gp.vehicle) ? `<h3 class="print-h3">Vehicle</h3><p>${pre(gp.vehicle)}</p>` : ''}
    ${str(gp.leaveNote) ? `<h3 class="print-h3">Note to leave behind</h3><p>${pre(gp.leaveNote)}</p>` : ''}`;
  return sec('goplan', `The plan: go to ${destName(gp)}`, inner, data.today);
}

// ---------- family plan (PACE) and contacts ----------
export function contactsSorted(contacts) {
  return arr(contacts).filter((c) => c && str(c.name)).slice()
    .sort((a, b) => (b.outOfArea ? 1 : 0) - (a.outOfArea ? 1 : 0) || (Number(a.order) || 0) - (Number(b.order) || 0));
}

function contactHtml(c) {
  const phones = arr(c.phones).filter((p) => p && str(p.number));
  return `<div class="print-contact${c.outOfArea ? ' print-contact-oa' : ''}">
    <div><b>${esc(c.name)}</b>${str(c.relation) ? ` <span class="print-small">${esc(c.relation)}</span>` : ''}${c.outOfArea ? ' <span class="print-tag">OUT-OF-AREA CONTACT</span>' : ''}</div>
    ${phones.length ? `<div class="print-phones">${phones.map((p) => `<span>${esc(str(p.label) || 'Phone')}: <b>${esc(p.number)}</b></span>`).join('')}</div>` : '<div class="print-small">No phone number saved</div>'}
    ${str(c.notes) ? `<div class="print-small">${pre(c.notes)}</div>` : ''}</div>`;
}

export function buildPaceSection(data) {
  const plan = normalizePlan(data.pacePlan);
  const hasPlan = !planIsEmpty(data.pacePlan);
  const contacts = contactsSorted(data.contacts);
  if (!hasPlan && !contacts.length) return null;
  let paceHtml = '';
  if (hasPlan) {
    const rows = PACE_TIERS.map((t) => `<tr><th scope="row">${t.key} · ${t.label}</th><td>${str(plan.tiers[t.key].method) ? `<b>${esc(plan.tiers[t.key].method)}</b>` : BLANK}</td><td>${str(plan.tiers[t.key].details) ? pre(plan.tiers[t.key].details) : ''}</td></tr>`).join('');
    const words = plan.codeWords.filter((c) => str(c.word));
    const points = plan.meetingPoints.filter((m) => str(m.name));
    const oa = plan.outOfAreaContact;
    paceHtml = `<h3 class="print-h3">How we reach each other (PACE)</h3>
      <table class="print-table print-pace"><thead><tr><th>Tier</th><th>Method</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table>
      ${str(plan.checkIns) ? `<p><b>Check-ins:</b> ${pre(plan.checkIns)}</p>` : ''}
      ${words.length ? `<p><b>Code words:</b></p><ul class="print-plain">${words.map((c) => `<li><b>${esc(c.word)}</b>${str(c.meaning) ? `: ${esc(c.meaning)}` : ''}</li>`).join('')}</ul>` : ''}
      ${points.length ? `<p><b>Meeting points:</b></p><ul class="print-plain">${points.map((m) => {
        const c = pinCoords(pinById(data.pins, m.pinId));
        return `<li><b>${esc(m.name)}</b>${str(m.details) ? `: ${esc(m.details)}` : ''}${c ? ` <span class="print-small">(${esc(c)})</span>` : ''}</li>`;
      }).join('')}</ul>` : ''}
      ${str(oa.name) || str(oa.details) ? `<p><b>Out-of-area contact:</b> ${esc([str(oa.name), str(oa.details)].filter(Boolean).join(' · '))}</p>` : ''}`;
  }
  const contactsHtml = contacts.length ? `<h3 class="print-h3">Emergency contacts</h3>${contacts.map(contactHtml).join('')}` : '';
  return sec('pace', 'Family plan and contacts', `${paceHtml}${contactsHtml}`, data.today);
}

// ---------- medical summary ----------
function t1dPlanPrint(p) {
  const plan = p.t1d && p.t1d.plan;
  if (!planHasContent(plan)) return '<p class="print-none">Emergency plan not filled in yet.</p>';
  const rows = [];
  const row = (k, v) => { if (v) rows.push(`<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`); };
  const units = plan.backupBasalUnits;
  if (units !== null && units !== undefined && str(units) !== '') {
    const ins = ROOM_TEMP_LABELS[plan.backupBasalInsulin] || '';
    row('Long-acting dose if the pump fails', `<b>${esc(units)} units</b>${ins ? ` of ${esc(ins)}` : ''}`);
  } else if (plan.backupBasalInsulin) {
    row('Long-acting insulin if the pump fails', esc(ROOM_TEMP_LABELS[plan.backupBasalInsulin] || plan.backupBasalInsulin));
  }
  row('Carb ratio', esc(str(plan.carbRatio)));
  row('Correction factor', esc(str(plan.correctionFactor)));
  row('Target blood sugar', esc(str(plan.targetBg)));
  for (const [nameKey, phoneKey, label] of [['endoName', 'endoPhone', 'Diabetes doctor'], ['pharmacyName', 'pharmacyPhone', 'Pharmacy'],
    [null, 'pumpSupportPhone', 'Pump support'], [null, 'cgmSupportPhone', 'CGM support']]) {
    const name = nameKey ? str(plan[nameKey]) : '';
    const phone = str(plan[phoneKey]);
    if (name || phone) row(label, `${name ? esc(name) : ''}${name && phone ? ' · ' : ''}${phone ? `<b>${esc(phone)}</b>` : ''}`);
  }
  return `<table class="print-table print-kv"><tbody>${rows.join('')}</tbody></table>
    ${str(plan.notes) ? `<p>${pre(plan.notes)}</p>` : ''}
    ${plan.updatedAt ? `<p class="print-small">Plan last updated ${esc(fmtDate(String(plan.updatedAt).slice(0, 10)))}. Review with your doctor yearly.</p>` : ''}`;
}

export function buildMedicalSection(data) {
  const people = arr(data.people).filter((p) => p && str(p.name));
  if (!people.length) return null;
  const cards = people.map((p) => {
    const meds = arr(p.meds).filter((m) => m && str(m.name));
    const t1d = p.t1d
      ? `<h4 class="print-h4">Type 1 diabetes</h4>
         <p class="print-small">${[
    p.t1d.rapidInsulin ? `Mealtime insulin: ${esc(ROOM_TEMP_LABELS[p.t1d.rapidInsulin] || p.t1d.rapidInsulin)}` : '',
    p.t1d.basalInsulin ? `Long-acting insulin: ${esc(ROOM_TEMP_LABELS[p.t1d.basalInsulin] || p.t1d.basalInsulin)}` : '',
    `Pump: ${p.t1d.usesPump ? 'yes' : 'no'}`, `CGM: ${p.t1d.usesCGM ? 'yes' : 'no'}`].filter(Boolean).join(' · ')}</p>
         ${t1dPlanPrint(p)}`
      : '';
    return `<div class="print-person"><h3 class="print-h3">${esc(p.name)}${str(p.age) !== '' ? `, ${esc(p.age)}` : ''}${p.t1d ? ' <span class="print-tag">TYPE 1 DIABETES</span>' : ''}</h3>
      <table class="print-table print-kv"><tbody>
        <tr><th scope="row">Blood type</th><td>${orDash(p.bloodType)}</td></tr>
        <tr><th scope="row">Allergies</th><td>${orDash(p.allergies)}</td></tr>
        <tr><th scope="row">Conditions</th><td>${orDash(p.conditions)}</td></tr></tbody></table>
      ${meds.length ? `<table class="print-table"><thead><tr><th>Medication</th><th>Dose</th><th>Per day</th></tr></thead><tbody>${meds.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(str(m.dose))}</td><td>${esc(str(m.perDay))}</td></tr>`).join('')}</tbody></table>` : '<p class="print-none">No medications listed.</p>'}
      ${t1d}</div>`;
  }).join('');
  const inner = `<div class="print-private" role="note"><b>Private medical information.</b> Keep this page with the family. Do not leave it where strangers can read it.</div>
    <p class="print-small">${esc(DISCLAIMER)}</p>${cards}`;
  return sec('medical', 'Medical summary', inner, data.today);
}
const orDash = (v) => (str(v) ? esc(str(v)) : '—');

// ---------- radio quick card ----------
// A table entry is left out when an `unverified` claim in comms.json mentions its callsign: the claim is still unconfirmed.
export function unverifiedTexts(comms) {
  return arr(comms && comms.unverified).map((u) => `${str(u && u.claim)} ${str(u && u.why)}`.toLowerCase());
}
export function isFlagged(comms, ...ids) {
  const texts = unverifiedTexts(comms);
  return ids.map(str).filter((t) => t.length >= 3).some((t) => texts.some((x) => x.includes(t.toLowerCase())));
}
export const verifiedNoaa = (comms) => arr(comms && comms.noaaWeatherRadio).filter((w) => w && Number.isFinite(Number(w.freqMHz)) && !isFlagged(comms, w.callsign));
const verifiedEas = (comms) => arr(comms && comms.broadcastEAS).filter((e) => e && !isFlagged(comms, e.call));
const handheld = (mhz) => ['2 m', '70 cm'].includes(bandOf(mhz));
export function verifiedRepeaters(comms, limit = 8) {
  return arr(comms && comms.hamRepeaters)
    .filter((r) => r && String(r.mode || '').toUpperCase() === 'FM' && handheld(r.outputMHz) && !isFlagged(comms, r.callsign))
    .slice(0, limit);
}

export function buildCommsSection(data) {
  const c = data.comms;
  if (!isObj(c)) return null;
  const noaa = verifiedNoaa(c);
  const eas = verifiedEas(c);
  const reps = verifiedRepeaters(c);
  const ch = arr(c.frsGmrsChannels).filter((x) => x && x.channel != null);
  const mesh = isObj(c.meshtastic) ? c.meshtastic : null;
  const nodes = arr(data.meshNodes).filter((n) => n && (str(n.owner) || str(n.name) || str(n.shortId)));
  if (!noaa.length && !eas.length && !reps.length && !ch.length && !mesh && !nodes.length) return null;
  const used = [];
  const take = (...e) => { for (const x of e) if (x && safeUrl(x.source)) used.push(x.source); };
  noaa.forEach((w) => take(w)); eas.forEach((e) => take(e)); reps.forEach((r) => take(r)); take(ch[0]); take(mesh);
  const uniq = [...new Set(used)];
  const inner = `<p class="print-hint">Checked ${esc(fmtDate(c.checkedAt))}. Frequencies may be out of date: verify before relying on them. Listen first; transmit only if you are allowed to.</p>
    ${noaa.length ? `<h3 class="print-h3">NOAA Weather Radio</h3><table class="print-table"><thead><tr><th>Call</th><th>MHz</th><th>SAME code</th><th>Where</th></tr></thead><tbody>${noaa.map((w) => `<tr><td><b>${esc(w.callsign)}</b></td><td><b>${esc(fmtMHz(w.freqMHz))}</b></td><td>${esc(str(w.sameCode))}</td><td>${esc(str(w.transmitterLocation))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${eas.length ? `<h3 class="print-h3">Emergency Alert System radio stations</h3><table class="print-table"><thead><tr><th>Station</th><th>Frequency</th><th>Role</th></tr></thead><tbody>${eas.map((e) => `<tr><td><b>${esc(e.call)}</b></td><td>${esc(str(e.freq))} ${esc(str(e.band))}</td><td>${esc(str(e.role))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${ch.length ? `<h3 class="print-h3">FRS / GMRS channels</h3><table class="print-table print-dense"><thead><tr><th>Ch</th><th>MHz</th><th>FRS power</th><th>GMRS power</th></tr></thead><tbody>${ch.map((x) => `<tr><td><b>${esc(x.channel)}</b></td><td>${esc(fmtMHz(x.freqMHz))}</td><td>${esc(str(x.frsWatts))}</td><td>${esc(str(x.gmrsWatts))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${mesh || nodes.length ? `<h3 class="print-h3">Meshtastic</h3>
      ${mesh ? `<table class="print-table print-kv"><tbody><tr><th scope="row">Region</th><td>${esc(str(mesh.region))}</td></tr><tr><th scope="row">Band</th><td>${esc(str(mesh.band))}</td></tr><tr><th scope="row">Default preset</th><td>${esc(str(mesh.defaultPreset))}</td></tr></tbody></table>` : ''}
      ${nodes.length ? `<table class="print-table"><thead><tr><th>Whose radio</th><th>Node name</th><th>Short ID</th></tr></thead><tbody>${nodes.map((n) => `<tr><td>${esc(str(n.owner))}</td><td>${esc(str(n.name))}</td><td><b>${esc(str(n.shortId))}</b></td></tr>`).join('')}</tbody></table>` : ''}` : ''}
    ${reps.length ? `<h3 class="print-h3">Ham repeaters (FM, listen-only unless licensed)</h3><table class="print-table print-dense"><thead><tr><th>Call</th><th>Output MHz</th><th>Offset</th><th>Tone Hz</th><th>Where</th></tr></thead><tbody>${reps.map((r) => {
    const o = repeaterOffset(r);
    return `<tr><td><b>${esc(r.callsign)}</b></td><td>${esc(fmtMHz(r.outputMHz))}</td><td>${o.sign ? `${esc(o.sign)}${esc(String(o.mhz))}` : 'none'}</td><td>${r.toneHz ? esc(String(r.toneHz)) : 'none'}</td><td>${esc(str(r.location))}</td></tr>`;
  }).join('')}</tbody></table>` : ''}
    ${uniq.length ? `<div class="print-sources"><b>Sources</b><ol>${uniq.map((u) => `<li><a class="print-link print-link-bare" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`).join('')}</ol></div>` : ''}`;
  return sec('comms', 'Radio quick card', inner, data.today);
}

// ---------- inventory and pins ----------
export function buildInventorySection(data) {
  const items = arr(data.items).filter((i) => i && str(i.name));
  if (!items.length) return null;
  const groups = new Map();
  for (const it of items) {
    const k = str(it.location) || '(no location set)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const inner = keys.map((k) => `<div class="print-tier"><h3 class="print-h3">${esc(k)}</h3>
    <table class="print-table print-dense"><thead><tr><th>Item</th><th>Quantity</th><th>Expires</th></tr></thead><tbody>${groups.get(k).sort((a, b) => str(a.name).localeCompare(str(b.name))).map((it) => `<tr><td>${esc(it.name)}</td><td>${esc(fmtQty(it.qty, it.unit))}</td><td>${it.expires ? esc(fmtDate(it.expires)) : ''}${it.expires && String(it.expires) < data.today ? ' <b>expired</b>' : ''}</td></tr>`).join('')}</tbody></table></div>`).join('');
  return sec('inventory', 'Inventory by location', inner, data.today);
}

export function buildPinsSection(data) {
  const pins = arr(data.pins).filter((p) => p && str(p.name));
  if (!pins.length) return null;
  const typeLabel = (t) => (PIN_TYPES.find((x) => x.id === t) || PIN_TYPES[PIN_TYPES.length - 1]).label;
  const rows = pins.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(typeLabel(p.type))}</td><td>${esc(pinCoords(p))}</td><td>${str(p.notes) ? pre(p.notes) : ''}</td></tr>`).join('');
  return sec('pins', 'Map pins', `<table class="print-table"><thead><tr><th>Name</th><th>Type</th><th>Latitude, longitude</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`, data.today);
}

// ---------- guides ----------
const GUIDE_IMG = /^img\/[\w\-./]+$/;

function figurePrint(b) {
  const src = str(b.src);
  const alt = str(b.alt);
  if (!GUIDE_IMG.test(src) || src.includes('..') || !alt) return '';
  const cap = str(b.caption);
  return `<figure class="print-fig"><img src="${esc(src)}" alt="${esc(alt)}">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>`;
}

function calcPrint() {
  const rows = [1, 2, 5].map((g) => `<tr><td>${g} gallon${g === 1 ? '' : 's'}</td><td>${bleachDose(g, 6, false)}</td><td>${bleachDose(g, 6, true)}</td><td>${bleachDose(g, 8.25, false)}</td><td>${bleachDose(g, 8.25, true)}</td></tr>`).join('');
  return `<table class="print-table print-dense"><caption>Bleach drops (EPA). Plain unscented bleach. Stir, wait 30 minutes.</caption>
    <thead><tr><th>Water</th><th>6% clear</th><th>6% cloudy</th><th>8.25% clear</th><th>8.25% cloudy</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function printBlockHtml(block, ctx) {
  if (!isObj(block)) return '';
  const items = arr(block.items);
  switch (block.type) {
    case 'p': return `<p>${richText(block.text)}</p>`;
    case 'h': return `<h3 class="print-gh">${richText(block.text)}</h3>`;
    case 'steps': return `<ol class="print-steps">${items.map((t) => `<li>${richText(t)}</li>`).join('')}</ol>`;
    case 'list': return `<ul class="print-plain">${items.map((t) => `<li>${richText(t)}</li>`).join('')}</ul>`;
    case 'checklist': return `<ul class="print-lines">${items.map((t) => `<li class="print-line">${BOX}<div class="print-line-body"><span class="print-line-text">${richText(t)}</span></div></li>`).join('')}</ul>`;
    case 'warning': return `<div class="print-callout print-callout-warn" role="note"><b>WARNING.</b> ${richText(block.text)}</div>`;
    case 'tip': return `<div class="print-callout" role="note"><b>Tip.</b> ${richText(block.text)}</div>`;
    case 'table': {
      const headers = arr(block.headers);
      const rows = arr(block.rows);
      return `<table class="print-table">${headers.length ? `<thead><tr>${headers.map((h) => `<th>${richText(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map((r) => `<tr>${(Array.isArray(r) ? r : [r]).map((c) => `<td>${richText(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    case 'calc': return block.calc === 'bleach' ? calcPrint() : '';
    case 't1dplan': {
      const t1d = arr(ctx.people).filter((p) => p && p.t1d);
      return t1d.length ? t1d.map((p) => `<h4 class="print-h4">${esc(str(p.name))}</h4>${t1dPlanPrint(p)}`).join('') : '';
    }
    case 'source': {
      const s = ctx.guide.sources && ctx.guide.sources[Number(block.n) - 1];
      return s ? `<p class="print-gsrc">Source: ${esc(s.title)}</p>` : '';
    }
    case 'figure': return figurePrint(block);
    default: return '';
  }
}

export function buildGuideSection(guide, data, kicker = '') {
  if (!isObj(guide) || !Array.isArray(guide.blocks)) return null;
  const cat = guideCategory(guide.category);
  const ctx = { guide, people: data.people };
  const inner = `${str(guide.summary) ? `<p class="print-lead">${esc(guide.summary)}</p>` : ''}
    ${guide.medical ? `<div class="print-callout"><b>Medical information.</b> ${esc(DISCLAIMER)}</div>` : ''}
    <div class="print-guide-body">${guide.blocks.map((b) => printBlockHtml(b, ctx)).join('')}</div>
    ${sourcesHtml(guide.sources)}
    <p class="print-small">Checked ${esc(fmtDate(guide.checkedAt))}</p>`;
  return sec(`guide-${guide.id}`, str(guide.title) || guide.id, inner, data.today, kicker || (cat ? cat.label : ''));
}

// ---------- the whole document ----------
// sel: { sections: {key: bool}, guides: [id], scenarios: [id] }.
// data: { today, goPlan, pacePlan, meshNodes, people, pets, items, pins, contacts, runs: {runId: record}, comms,
//         loadoutTpl, arrivalTpl, gobagTpl, scenarioIndex: [...], scenarios: {id: tpl}, guideIndex, guides: {id: guide} }
// Returns { html, parts: [{key,title,pages}], skipped: [{title, reason}], pages }.
export function buildDocument(sel, data) {
  const s = normalizeSelection(sel);
  const d = { ...data, today: str(data.today) || '' };
  const parts = [];
  const skipped = [];
  const push = (key, title, html, reason) => {
    if (html) parts.push({ key, title, html, pages: estimatePagesOf(html) });
    else skipped.push({ key, title, reason });
  };
  const idxGuides = arr(d.guideIndex && d.guideIndex.guides);

  const wants = (k) => s.sections[k];
  const bodyParts = [];
  const add = (key, title, html, reason) => bodyParts.push({ key, title, html, reason });

  if (wants('goplan')) add('goplan', 'Go-to plan', buildGoPlanSection(d), 'No go-to plan has been filled in yet.');
  if (wants('loadout')) add('loadout', 'Load-out checklist', buildLoadoutSection(d), 'The load-out template (data/plans/loadout.json) is not available.');
  if (wants('arrival')) add('arrival', 'Arrival checklist', buildArrivalSection(d), 'The arrival template (data/plans/arrival.json) is not available.');
  if (wants('pace')) add('pace', 'Family plan and contacts', buildPaceSection(d), 'No family plan or contacts saved yet.');
  if (wants('medical')) add('medical', 'Medical summary', buildMedicalSection(d), 'No one is in the household yet.');
  if (wants('comms')) add('comms', 'Radio quick card', buildCommsSection(d), 'The radio data (data/comms.json) is not available.');

  if (wants('emergency')) {
    const em = sortGuides(idxGuides.filter((g) => g.emergency));
    if (!em.length) add('emergency', 'Emergency guides', '', 'The guide list is not available.');
    for (const g of em) {
      const body = d.guides && d.guides[g.id];
      add(`guide-${g.id}`, g.title, body ? buildGuideSection(body, d, 'Emergency guide') : '', `The guide "${g.title}" is not available.`);
    }
  }
  if (wants('scenarios')) {
    const idx = arr(d.scenarioIndex);
    const chosen = idx.filter((x) => s.scenarios.includes(x.id));
    if (!chosen.length) add('scenarios', 'Scenario checklists', '', 'No scenarios ticked, or the scenario files are not available.');
    for (const x of chosen) add(`scenario-${x.id}`, x.title, buildScenarioSection(d.scenarios && d.scenarios[x.id], d) || '', `The scenario "${x.title}" is not available.`);
  }
  if (wants('gobags')) add('gobags', 'Go-bags', buildGobagSection(d), 'The go-bag template is not available, or no one is in the household.');
  if (wants('inventory')) add('inventory', 'Inventory', buildInventorySection(d), 'The inventory is empty.');
  if (wants('pins')) add('pins', 'Map pins', buildPinsSection(d), 'There are no map pins.');
  if (wants('guides')) {
    const emIds = new Set(wants('emergency') ? idxGuides.filter((g) => g.emergency).map((g) => g.id) : []);
    const chosen = sortGuides(idxGuides.filter((g) => s.guides.includes(g.id) && !emIds.has(g.id)));
    for (const g of chosen) {
      const body = d.guides && d.guides[g.id];
      add(`guide-${g.id}`, g.title, body ? buildGuideSection(body, d) : '', `The guide "${g.title}" is not available.`);
    }
  }

  // Cover first, listing what follows it.
  for (const b of bodyParts) push(b.key, b.title, b.html, b.reason);
  if (wants('cover')) {
    const html = buildCover(d, parts.map((p) => p.title));
    parts.unshift({ key: 'cover', title: 'Cover', html, pages: 1 });
  }
  const html = parts.map((p) => p.html).join('\n');
  return { html, parts: parts.map(({ key, title, pages }) => ({ key, title, pages })), skipped, pages: parts.reduce((n, p) => n + p.pages, 0) };
}

// Picker estimate. Sections that are not built yet (guides not downloaded) count as 1.5 pages each.
export function estimatePages(sel, data) {
  const doc = buildDocument(sel, data);
  const pending = doc.skipped.filter((k) => k.reason.startsWith('The guide')).length;
  return Math.max(0, Math.round(doc.pages + pending * 1.5));
}

// ---------- wallet card ----------
// Wording adapted from the t1d-hypo guide (its warning block and glucagon section): fast sugar only if they can swallow;
// otherwise no food or drink, glucagon, then 911.
export const T1D_CARD_TEXT = 'Type 1 diabetic: needs insulin. If confused but able to swallow: give fast sugar. If unresponsive or cannot swallow: NO food or drink. Give glucagon and call 911.';

const clip = (v, n) => { const t = str(v).replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function cardFacts(data) {
  const gp = isObj(data.goPlan) ? data.goPlan : {};
  const plan = normalizePlan(data.pacePlan);
  const oaContact = contactsSorted(data.contacts).find((c) => c.outOfArea);
  const oaPlan = plan.outOfAreaContact;
  const oaPhone = oaContact ? str(arr(oaContact.phones).find((p) => p && str(p.number))?.number) : '';
  const method = (m) => PACE_TIERS.map((t) => plan.tiers[t.key]).find((t) => t.method === m);
  const frs = method('FRS/GMRS');
  const mesh = method('Meshtastic');
  const noaa = verifiedNoaa(data.comms)[0] || null;
  return {
    dest: destName(gp),
    address: str(gp.destination && gp.destination.address),
    fallback: str(gp.fallback && gp.fallback.name),
    oaName: oaContact ? str(oaContact.name) : str(oaPlan.name),
    oaPhone: oaPhone || (!oaContact ? str(oaPlan.details) : ''),
    pace: PACE_TIERS.map((t) => ({ key: t.key, method: plan.tiers[t.key].method })).filter((t) => t.method),
    frs: frs ? str(frs.details) : '',
    mesh: mesh ? str(mesh.details) : '',
    noaa,
  };
}

function cardStrip(f, person) {
  const front = `<div class="print-card-face print-card-front">
      <div class="print-card-top"><b>HOME BASE</b><span class="print-card-name">${person ? esc(str(person.name)) : `Name: ${BLANK}`}</span></div>
      <div class="print-card-row"><b>Meet at:</b> ${esc(f.dest)}</div>
      <div class="print-card-row">${f.address ? esc(f.address) : BLANK}</div>
      <div class="print-card-row"><b>Fallback:</b> ${f.fallback ? esc(f.fallback) : BLANK}</div>
      <div class="print-card-row"><b>Out-of-area:</b> ${f.oaName ? esc(f.oaName) : BLANK} ${f.oaPhone ? `<b>${esc(f.oaPhone)}</b>` : ''}</div>
      <div class="print-card-row print-card-pace"><b>Reach us:</b> ${f.pace.length ? f.pace.map((t) => `<span>${esc(t.key)} ${esc(t.method)}</span>`).join(' ') : `P ${BLANK} A ${BLANK}`}</div>
    </div>`;
  const t1d = person && person.t1d ? `<div class="print-card-t1d">${esc(T1D_CARD_TEXT)}</div>` : '';
  const back = `<div class="print-card-face print-card-back">
      <div class="print-card-top"><b>RADIO</b>${person ? `<span class="print-card-name">${esc(str(person.name))}</span>` : ''}</div>
      ${f.noaa ? `<div class="print-card-row"><b>Weather radio:</b> ${esc(fmtMHz(f.noaa.freqMHz))} MHz${str(f.noaa.sameCode) ? ` · SAME ${esc(str(f.noaa.sameCode))}` : ''}</div>` : ''}
      ${f.frs ? `<div class="print-card-row"><b>FRS/GMRS:</b> ${esc(clip(f.frs, 42))}</div>` : ''}
      ${f.mesh ? `<div class="print-card-row"><b>Meshtastic:</b> ${esc(clip(f.mesh, 42))}</div>` : ''}
      ${t1d}
    </div>`;
  return `<div class="print-card-strip">${front}${back}</div>`;
}

// Fold-over strips, 7 x 2 in each (front on the left, back on the right), 4 to a letter page. Cut on the dashed lines and fold in half.
export function buildWalletCards(data) {
  const f = cardFacts(data);
  const people = arr(data.people).filter((p) => p && str(p.name));
  const subjects = people.length ? people.slice() : [null];
  while (subjects.length % 4) subjects.push(null);
  const pages = [];
  for (let i = 0; i < subjects.length; i += 4) {
    pages.push(`<div class="print-card-page">${subjects.slice(i, i + 4).map((p) => cardStrip(f, p)).join('')}</div>`);
  }
  return `<div class="print-cards">${pages.join('')}
    <p class="print-hint print-noprint">Print at 100% (not "fit to page"). Cut along the dashed lines and fold each strip in half so the front and back face out. Printed ${esc(fmtDate(data.today))}.</p></div>`;
}
