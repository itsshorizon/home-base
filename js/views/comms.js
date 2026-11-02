// Comms & Radio (#/comms): what to listen to, the family PACE plan, Meshtastic, ham repeaters, GMRS/FRS.
// All the facts come from data/comms.json (every entry has a source and a checked date). The logic lives in js/comms.js.
import { getAll, getSettings, saveSettings } from '../db.js';
import { openSheet } from '../sheet.js';
import { esc } from '../format.js';
import { pinEmoji } from '../mapinfo.js';
import {
  COMMS_GUIDES, PACE_TIERS, PACE_METHODS, fmtMHz, repeaterOffset, groupRepeaters, groupChannels, repeaterDistance, firstSentence,
  simplexShown, emptyPlan, examplePlan, normalizePlan, planIsEmpty, pacePlanText, treeStep, validateTree, chirpCsv, chirpFilename,
} from '../comms.js';

const SECTIONS = [
  { id: 'listen', label: 'Listen' },
  { id: 'plan', label: 'Our plan' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'ham', label: 'Ham' },
  { id: 'gmrs', label: 'GMRS/FRS' },
];
const LS_SECTION = 'hb_commsSection';
const TREE_URL = 'data/comms/mesh-troubleshoot.json';
const CAUTION = 'Your frequencies may be out of date — verify before relying on them.';

let S = null; // per-visit state; destroy() clears it
let treeCache; // undefined = not tried yet, null = unavailable, object = valid tree

const toast = (message) => window.dispatchEvent(new CustomEvent('hb:toast', { detail: { message } }));

// ---------- loading ----------
function loadCss(href) {
  const sel = `link[data-comms-css="${href}"]`;
  const existing = document.querySelector(sel);
  if (existing) return Promise.resolve();
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.commsCss = href;
    l.onload = () => resolve(); l.onerror = () => resolve();
    document.head.appendChild(l);
    setTimeout(resolve, 1500); // never block the screen on a slow stylesheet
  });
}

async function ensureTree() {
  if (treeCache !== undefined) return treeCache;
  try {
    const res = await fetch(TREE_URL);
    if (!res.ok) throw new Error(`${TREE_URL}: ${res.status}`);
    const tree = await res.json();
    const v = validateTree(tree);
    if (!v.ok) { console.warn('Meshtastic troubleshooter is invalid:', v.errors); treeCache = null; } else treeCache = tree;
  } catch (err) {
    console.warn('Meshtastic troubleshooter unavailable:', err);
    treeCache = null;
  }
  return treeCache;
}

// ---------- small html helpers ----------
const guideLink = (id, text) => `<a class="comms-guide" href="#/guide/${esc(id)}"><span>${esc(text)}</span><span aria-hidden="true">›</span></a>`;

function srcLine(entry) {
  const url = entry && entry.source;
  const date = (entry && entry.checkedAt) || (S.comms && S.comms.checkedAt) || '';
  const text = `Source · checked ${esc(date)}`;
  if (!url) return `<p class="comms-src">${text}</p>`;
  return `<p class="comms-src"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a></p>`;
}

const notesHtml = (t) => (t ? `<p class="comms-notes">${esc(t)}</p>` : '');

// ---------- section: Listen ----------
function noaaHtml(w) {
  return `<article class="card comms-noaa">
    <div class="comms-kicker">NOAA Weather Radio · ${esc(w.callsign)}</div>
    <div class="comms-freq">${fmtMHz(w.freqMHz)}<small> MHz</small></div>
    <div class="comms-same-row"><span class="comms-lab">SAME code</span><span class="comms-same">${esc(w.sameCode)}</span></div>
    <p class="comms-where">${esc(w.transmitterLocation)}</p>
    ${notesHtml(w.notes)}${srcLine(w)}
  </article>`;
}

function easHtml(s) {
  return `<article class="card comms-station">
    <div class="comms-station-top"><span class="comms-freq-sm">${esc(s.freq)}<small> ${esc(s.band)}</small></span><span class="comms-name">${esc(s.call)}</span>${s.role ? `<span class="comms-badge">${esc(s.role)}</span>` : ''}</div>
    ${notesHtml(s.notes)}${srcLine(s)}
  </article>`;
}

function netHtml(n) {
  return `<article class="card comms-station">
    <div class="comms-station-top"><span class="comms-name">${esc(n.name)}</span></div>
    <p class="comms-when">${esc(n.schedule)}</p>
    <p class="comms-meta"><b>${fmtMHz(n.freqMHz)} MHz</b> · ${esc(n.repeater)}</p>
    ${notesHtml(n.purpose)}${srcLine(n)}
  </article>`;
}

const ENC_LABEL = { yes: 'Encrypted', no: 'Not encrypted', partial: 'Partly encrypted', unknown: 'Unknown' };

function scannerHtml(p) {
  const enc = String(p.encrypted || 'unknown');
  return `<details class="card comms-scan">
    <summary><span class="comms-scan-head"><b>${esc(p.agency)}</b><span class="comms-badge comms-enc-${esc(enc)}">${esc(ENC_LABEL[enc] || enc)}</span></span>
      <span class="comms-meta">${esc(firstSentence(p.monitorable))}</span></summary>
    <p class="comms-notes">${esc(p.monitorable)}</p>
    <p class="comms-meta">${esc(p.system)}</p>${srcLine(p)}
  </details>`;
}

function listenHtml() {
  const c = S.comms;
  return `
    <h2 class="comms-h">Weather radio</h2>
    <p class="comms-intro">Tune a battery or hand-crank weather radio to one of these. Set its SAME code to get alerts for Henrico only.</p>
    ${(c.noaaWeatherRadio || []).map(noaaHtml).join('') || '<p class="muted">No verified weather radio transmitter yet.</p>'}
    <h2 class="comms-h">AM/FM emergency stations</h2>
    ${(c.broadcastEAS || []).map(easHtml).join('') || '<p class="muted">No stations listed.</p>'}
    <h2 class="comms-h">Ham nets to listen to</h2>
    <p class="comms-intro">Listening is fine without a license. A scanner or handheld that covers the ham bands can hear these.</p>
    ${(c.hamNets || []).map(netHtml).join('')}
    <h2 class="comms-h">Scanner note</h2>
    ${(c.publicSafety || []).map(scannerHtml).join('')}
    <div class="comms-guides">
      ${guideLink(COMMS_GUIDES.listen, 'Guide: what to listen to with no power or internet')}
      ${guideLink(COMMS_GUIDES.scanner, 'Guide: scanners and public-safety radio in Henrico')}
    </div>`;
}

// ---------- section: Our plan (PACE) ----------
const pacePill = (key) => `<span class="comms-pace comms-pace-${key}" aria-hidden="true">${key}</span>`;

function pinLabel(id) {
  const p = S.pins.find((x) => x.id === id);
  return p ? `${pinEmoji(p.type)} ${p.name}` : '';
}

function planViewHtml() {
  const p = normalizePlan(S.plan);
  const tiers = PACE_TIERS.map((t) => {
    const { method, details } = p.tiers[t.key];
    return `<div class="card comms-tier">${pacePill(t.key)}
      <div class="comms-tier-body"><div class="comms-tier-name">${esc(t.label)}</div>
        <div class="comms-tier-method">${method ? esc(method) : '<span class="muted">Not set</span>'}</div>
        ${details.trim() ? `<div class="comms-tier-details">${esc(details)}</div>` : ''}</div></div>`;
  }).join('');
  const words = p.codeWords.filter((c) => c.word.trim());
  const pts = p.meetingPoints.filter((m) => m.name.trim());
  const o = p.outOfAreaContact;
  return `
    <div class="comms-plan-top"><h2 class="comms-h">Family PACE plan</h2></div>
    <p class="comms-intro">Primary, Alternate, Contingency, Emergency: if one way to reach each other fails, move to the next.</p>
    ${tiers}
    ${p.checkIns.trim() ? `<div class="card"><h3 class="comms-h3">Check-ins</h3><p class="comms-pre">${esc(p.checkIns)}</p></div>` : ''}
    ${words.length ? `<div class="card"><h3 class="comms-h3">Code words</h3><ul class="comms-list">${words.map((c) => `<li><b>${esc(c.word)}</b>${c.meaning.trim() ? ` · ${esc(c.meaning)}` : ''}</li>`).join('')}</ul></div>` : ''}
    ${pts.length ? `<div class="card"><h3 class="comms-h3">Meeting points</h3><ul class="comms-list">${pts.map((m) => `<li><b>${esc(m.name)}</b>${m.details.trim() ? `<br>${esc(m.details)}` : ''}${m.pinId && pinLabel(m.pinId) ? `<br><span class="muted small">${esc(pinLabel(m.pinId))}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${(o.name.trim() || o.details.trim()) ? `<div class="card"><h3 class="comms-h3">Out-of-area contact</h3><p class="comms-pre"><b>${esc(o.name)}</b>${o.details.trim() ? `\n${esc(o.details)}` : ''}</p></div>` : ''}
    <div class="comms-btns">
      <button type="button" class="btn primary" data-act="plan-edit">Edit plan</button>
      <button type="button" class="btn" data-act="plan-copy">Copy as text</button>
    </div>
    ${guideLink(COMMS_GUIDES.pace, 'Guide: family PACE plan')}`;
}

function planEmptyHtml() {
  return `
    <h2 class="comms-h">Family PACE plan</h2>
    <div class="card empty comms-empty">
      <div class="empty-icon" aria-hidden="true">👨‍👩‍👧</div>
      <p><b>How will we reach each other when the phones stop working?</b></p>
      <p class="muted">A PACE plan is four ways to get in touch, in order: Primary, Alternate, Contingency, Emergency. Write it down now, while everything still works.</p>
      <div class="comms-btns comms-btns-col">
        <button type="button" class="btn primary big" data-act="plan-example">Start from example</button>
        <button type="button" class="btn" data-act="plan-blank">Start blank</button>
      </div>
    </div>
    ${guideLink(COMMS_GUIDES.pace, 'Guide: family PACE plan')}`;
}

function methodSelect(tier, value) {
  return `<select data-f="method" data-tier="${tier}" aria-label="${tier} method"><option value="">Choose a method</option>${PACE_METHODS.map((m) => `<option${m === value ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>`;
}

function planFormHtml() {
  const d = S.draft;
  const tiers = PACE_TIERS.map((t) => `<div class="card comms-tier-edit">
      <div class="comms-tier-edit-head">${pacePill(t.key)}<b>${t.label}</b></div>
      <label class="field"><span>Method</span>${methodSelect(t.key, d.tiers[t.key].method)}</label>
      <label class="field"><span>Details</span><input type="text" data-f="details" data-tier="${t.key}" value="${esc(d.tiers[t.key].details)}" maxlength="200" placeholder="e.g. FRS ch 7, code off" autocomplete="off"></label>
    </div>`).join('');
  const words = d.codeWords.map((c, i) => `<div class="comms-row2">
      <input type="text" data-f="cw-word" data-i="${i}" value="${esc(c.word)}" maxlength="60" placeholder="Word" aria-label="Code word ${i + 1}" autocomplete="off">
      <input type="text" data-f="cw-meaning" data-i="${i}" value="${esc(c.meaning)}" maxlength="120" placeholder="Means" aria-label="Meaning ${i + 1}" autocomplete="off">
      <button type="button" class="btn comms-x" data-act="cw-del" data-i="${i}" aria-label="Remove code word ${i + 1}">✕</button>
    </div>`).join('');
  const pinOpts = (sel) => `<option value="">No map pin</option>${S.pins.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(pinEmoji(p.type))} ${esc(p.name)}</option>`).join('')}`;
  const pts = d.meetingPoints.map((m, i) => `<div class="comms-mp">
      <div class="comms-row2"><input type="text" data-f="mp-name" data-i="${i}" value="${esc(m.name)}" maxlength="80" placeholder="Name, e.g. Library lot" aria-label="Meeting point ${i + 1} name" autocomplete="off">
        <input type="text" data-f="mp-details" data-i="${i}" value="${esc(m.details)}" maxlength="200" placeholder="Details" aria-label="Meeting point ${i + 1} details" autocomplete="off">
        <button type="button" class="btn comms-x" data-act="mp-del" data-i="${i}" aria-label="Remove meeting point ${i + 1}">✕</button></div>
      ${S.pins.length ? `<label class="field comms-pinpick"><span>Map pin (optional)</span><select data-f="mp-pin" data-i="${i}">${pinOpts(m.pinId)}</select></label>` : ''}
    </div>`).join('');
  return `
    <h2 class="comms-h">Edit PACE plan</h2>
    ${planIsEmpty(S.plan) ? '<p class="comms-intro">Fill in the details for each way of reaching each other. Nothing is saved until you tap Save.</p>' : ''}
    ${tiers}
    <div class="card"><label class="field"><span>Check-in times</span><textarea data-f="checkins" rows="2" maxlength="300" placeholder="e.g. Top of every hour, 2 minutes">${esc(d.checkIns)}</textarea></label></div>
    <div class="card"><h3 class="comms-h3">Code words</h3>${words || '<p class="muted small">None yet.</p>'}
      <button type="button" class="btn small" data-act="cw-add">+ Add code word</button></div>
    <div class="card"><h3 class="comms-h3">Meeting points</h3>${pts || '<p class="muted small">None yet.</p>'}
      <button type="button" class="btn small" data-act="mp-add">+ Add meeting point</button></div>
    <div class="card"><h3 class="comms-h3">Out-of-area contact</h3>
      <label class="field"><span>Name</span><input type="text" data-f="ooa-name" value="${esc(d.outOfAreaContact.name)}" maxlength="80" autocomplete="off"></label>
      <label class="field"><span>How to reach them</span><textarea data-f="ooa-details" rows="2" maxlength="300">${esc(d.outOfAreaContact.details)}</textarea></label></div>
    <div class="comms-btns"><button type="button" class="btn primary" data-act="plan-save">Save plan</button><button type="button" class="btn" data-act="plan-cancel">Cancel</button></div>`;
}

// copy what is typed in the form back into S.draft
function readDraft() {
  if (!S || !S.editing) return;
  const r = S.root;
  const val = (sel) => { const el = r.querySelector(sel); return el ? el.value : ''; };
  const d = emptyPlan();
  for (const t of PACE_TIERS) {
    d.tiers[t.key] = { method: val(`[data-f="method"][data-tier="${t.key}"]`), details: val(`[data-f="details"][data-tier="${t.key}"]`) };
  }
  d.checkIns = val('[data-f="checkins"]');
  d.codeWords = [...r.querySelectorAll('[data-f="cw-word"]')].map((el) => ({ word: el.value, meaning: val(`[data-f="cw-meaning"][data-i="${el.dataset.i}"]`) }));
  d.meetingPoints = [...r.querySelectorAll('[data-f="mp-name"]')].map((el) => ({
    name: el.value, details: val(`[data-f="mp-details"][data-i="${el.dataset.i}"]`), pinId: val(`[data-f="mp-pin"][data-i="${el.dataset.i}"]`),
  }));
  d.outOfAreaContact = { name: val('[data-f="ooa-name"]'), details: val('[data-f="ooa-details"]') };
  S.draft = d;
}

function planHtml() {
  if (S.editing) return planFormHtml();
  return planIsEmpty(S.plan) ? planEmptyHtml() : planViewHtml();
}

async function copyPlan() {
  const text = pacePlanText(S.plan);
  if (!text) { toast('Nothing to copy yet'); return; }
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    toast('Plan copied. Paste it into a text message.');
  } catch {
    // no clipboard access (or it was refused): show the text so it can be selected and copied by hand
    const sheet = openSheet(`<h2>Copy your plan</h2><p class="muted small">Press and hold in the box, choose Select all, then Copy.</p>
      <textarea class="comms-copybox" readonly rows="10" aria-label="Your plan as text">${esc(text)}</textarea>
      <div class="btn-row"><button type="button" class="btn primary" data-sheet="close">Done</button></div>`);
    const ta = sheet.el.querySelector('textarea');
    if (ta) { ta.focus(); ta.select(); }
  }
}

async function savePlan() {
  readDraft();
  const plan = normalizePlan(S.draft);
  const value = planIsEmpty(plan) ? null : plan;
  await saveSettings({ pacePlan: value });
  S.settings.pacePlan = value;
  S.plan = value;
  S.editing = false; S.draft = null;
  toast('Plan saved');
  paintBody();
}

// ---------- section: Mesh ----------
function radiosHtml() {
  const list = Array.isArray(S.settings.meshNodes) ? S.settings.meshNodes : [];
  const rows = list.map((n, i) => `<button type="button" class="comms-radio" data-act="radio-edit" data-i="${i}">
      <span class="comms-radio-owner">${esc(n.owner || 'Unnamed')}</span>
      <span class="comms-radio-id">${esc(n.name || '')}${n.shortId ? ` · <b>${esc(n.shortId)}</b>` : ''}</span><span aria-hidden="true">›</span></button>`).join('');
  return `<div class="card"><h3 class="comms-h3">My radios</h3>
    <p class="comms-intro">Write down each family radio's name and short ID so you know who is who on the mesh.</p>
    ${rows || '<p class="muted small">No radios added yet.</p>'}
    <button type="button" class="btn small" data-act="radio-add">+ Add a radio</button></div>`;
}

function meshHtml() {
  const m = S.comms.meshtastic || {};
  const comms = (m.communities || []).map((c) => `<div class="comms-callout comms-callout-warn" role="note">
      <b class="comms-callout-label">${esc(c.name)}</b>${esc(c.notes)}
      ${srcLine(c)}</div>`).join('');
  return `
    <h2 class="comms-h">Meshtastic</h2>
    <p class="comms-intro">Text messages between radios with no cell service. Set up the radios and test them <b>before</b> you need them.</p>
    <div class="card comms-status">
      <div class="comms-kv"><span>Region</span><b>${esc(m.region || '')}</b></div>
      <div class="comms-kv"><span>Band</span><b>${esc(m.band || '')}</b></div>
      <div class="comms-kv"><span>Default preset</span><b>${esc(m.defaultPreset || '')}</b></div>
      <details class="comms-more"><summary>Details and notes</summary>${notesHtml(m.notes)}</details>
      ${srcLine(m)}
    </div>
    <h3 class="comms-h3">Local community</h3>
    ${comms || '<p class="muted">No Meshtastic community verified near Richmond.</p>'}
    <p class="comms-plan-line"><b>Plan on your own private channel</b> for the family. No Meshtastic community in the Richmond area is verified.</p>
    <button type="button" class="btn primary big comms-wide" data-act="ts-start">🛠 Troubleshoot</button>
    ${S.treeBad ? '<p class="comms-unavail" role="status">Troubleshooter not available</p>' : ''}
    ${radiosHtml()}
    <div class="comms-guides">
      ${guideLink(COMMS_GUIDES.meshBasics, 'Guide: Meshtastic basics')}
      ${guideLink(COMMS_GUIDES.meshSetup, 'Guide: set up two radios for the family')}
    </div>`;
}

function alternateHtml() {
  const a = normalizePlan(S.plan).tiers.A;
  if (!a.method && !a.details.trim()) {
    return '<p class="muted">Your plan has no Alternate set yet. Add one under <a href="#" data-act="goto-plan">Our plan</a>.</p>';
  }
  return `<div class="card comms-tier">${pacePill('A')}<div class="comms-tier-body"><div class="comms-tier-name">Your Alternate</div>
    <div class="comms-tier-method">${a.method ? esc(a.method) : ''}</div>${a.details.trim() ? `<div class="comms-tier-details">${esc(a.details)}</div>` : ''}</div></div>`;
}

function troubleHtml() {
  const w = S.walk;
  const tree = S.tree;
  const cur = w.stack[w.stack.length - 1];
  const step = treeStep(tree, cur);
  const crumbs = w.picks.length ? `<div class="comms-crumbs" aria-label="Your answers so far">${w.picks.map((p) => `<span class="comms-crumb">${esc(p)}</span>`).join('<span class="comms-crumb-sep" aria-hidden="true">›</span>')}</div>` : '';
  const head = `<div class="comms-ts-head"><button type="button" class="btn small" data-act="ts-exit">← Mesh</button><button type="button" class="btn small" data-act="ts-restart">Start over</button></div>${crumbs}`;
  const back = `<div class="comms-btns"><button type="button" class="btn" data-act="ts-back"${w.stack.length === 1 && !w.end ? ' disabled' : ''}>← Back</button><button type="button" class="btn" data-act="ts-restart">Start over</button></div>`;
  if (w.end === 'fixed') {
    return `${head}<div class="card empty comms-end comms-end-ok"><div class="comms-end-icon" aria-hidden="true">🎉</div><h2>Fixed 🎉</h2>
      <p class="muted">Glad it worked. Send a test message to be sure.</p>
      <button type="button" class="btn primary" data-act="ts-exit">Done</button></div>${back}`;
  }
  if (w.end === 'stuck') {
    return `${head}<div class="card comms-end comms-end-stuck"><h2>Still stuck → fall back to your PACE Alternate</h2>
      <p class="muted">Don't lose time on a radio that won't cooperate. Move to the next way of reaching each other.</p>
      ${alternateHtml()}</div>${back}`;
  }
  if (!step) return `${head}<p class="comms-unavail">Troubleshooter not available</p>`;
  const opts = step.options.map((o, i) => `<button type="button" class="btn comms-opt" data-act="ts-opt" data-i="${i}">${esc(o.label)}</button>`).join('');
  if (step.kind === 'fix') {
    const f = step.fix;
    return `${head}<div class="card comms-fix"><div class="comms-kicker">Try this</div><h2>${esc(f.title)}</h2>
      <ol class="comms-steps">${f.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${f.source ? `<p class="comms-src">${f.source.url ? `<a href="${esc(f.source.url)}" target="_blank" rel="noopener noreferrer">Source: ${esc(f.source.title)}</a>` : `Source: ${esc(f.source.title)}`}</p>` : ''}</div>
      <div class="comms-opts">${opts}</div>${back}`;
  }
  return `${head}<div class="card comms-q"><h2>${esc(step.text)}</h2></div><div class="comms-opts">${opts}</div>${back}`;
}

function radioSheet(i) {
  const list = Array.isArray(S.settings.meshNodes) ? S.settings.meshNodes.slice() : [];
  const cur = i != null ? list[i] : null;
  const html = `<h2>${cur ? 'Edit radio' : 'Add a radio'}</h2>
    <label class="field"><span>Whose radio is it?</span><input type="text" id="comms-r-owner" value="${esc(cur ? cur.owner : '')}" maxlength="60" autocomplete="off"></label>
    <label class="field"><span>Node name (long name)</span><input type="text" id="comms-r-name" value="${esc(cur ? cur.name : '')}" maxlength="60" autocomplete="off"></label>
    <label class="field"><span>Short ID (4 characters)</span><input type="text" id="comms-r-id" value="${esc(cur ? cur.shortId : '')}" maxlength="8" autocomplete="off" autocapitalize="off"></label>
    <div class="btn-row"><button type="button" class="btn primary" data-sheet="save">Save</button><button type="button" class="btn" data-sheet="close">Cancel</button>${cur ? '<button type="button" class="btn danger" data-sheet="delete">Delete</button>' : ''}</div>`;
  const sheet = openSheet(html, {
    async onAction(action, close) {
      if (action === 'delete') { list.splice(i, 1); } else if (action === 'save') {
        const rec = {
          owner: sheet.el.querySelector('#comms-r-owner').value.trim(),
          name: sheet.el.querySelector('#comms-r-name').value.trim(),
          shortId: sheet.el.querySelector('#comms-r-id').value.trim(),
        };
        if (!rec.owner && !rec.name && !rec.shortId) { toast('Fill in at least one box'); return; }
        if (cur) list[i] = rec; else list.push(rec);
      } else return;
      await saveSettings({ meshNodes: list });
      S.settings.meshNodes = list;
      close();
      paintBody();
    },
  });
}

// ---------- section: Ham ----------
function repeaterHtml(r) {
  const off = repeaterOffset(r);
  const tone = r.toneHz != null ? `${r.toneHz} Hz` : (r.dcs ? `DCS ${esc(r.dcs)}` : 'none listed');
  const dist = repeaterDistance(S.home, r);
  return `<details class="card comms-rep">
    <summary>
      <span class="comms-rep-top"><span class="comms-freq-sm">${fmtMHz(r.outputMHz)}<small> MHz</small></span><span class="comms-badge">${esc(r.mode)}</span><span class="comms-name">${esc(r.callsign)}</span>${dist ? `<span class="comms-dist">${esc(dist)}</span>` : ''}</span>
      <span class="comms-meta">${off.sign ? `Offset <b>${off.sign}${off.mhz.toFixed(3)}</b> · Input ${fmtMHz(r.inputMHz)}` : 'Simplex'} · Tone <b>${tone}</b></span>
      <span class="comms-meta">${esc(r.location)}</span>
      ${r.sponsor ? `<span class="comms-meta">Sponsor: ${esc(r.sponsor)}</span>` : ''}
      ${r.linkedTo ? `<span class="comms-meta">Linked to: ${esc(r.linkedTo)}</span>` : ''}
    </summary>
    ${notesHtml(r.notes)}${srcLine(r)}
  </details>`;
}

function orgHtml(o) {
  return `<article class="card comms-station">
    <div class="comms-station-top"><span class="comms-name">${esc(o.name)}</span><span class="comms-badge">${esc(o.type)}</span></div>
    <p class="comms-meta">${esc(o.area)}</p>
    ${notesHtml(o.notes)}
    ${o.url ? `<p class="comms-meta"><a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.url)}</a></p>` : ''}
    ${srcLine(o)}</article>`;
}

function hamHtml() {
  const c = S.comms;
  const licensed = !!S.settings.hamLicensed;
  const banner = licensed ? '' : `<div class="comms-callout comms-callout-warn" role="note"><b class="comms-callout-label">Listen only</b>
      Nobody in the household is licensed yet: listen only. Read what the emergency rules do and don't cover before you ever transmit.
      <span class="comms-banner-links"><a href="#/guide/${COMMS_GUIDES.transmit}">What you may transmit</a><a href="#/guide/${COMMS_GUIDES.license}">Getting licensed</a></span></div>`;
  const licenseRow = `<label class="field check comms-lic"><input type="checkbox" data-f="ham-licensed"${licensed ? ' checked' : ''}><span>Someone in our household has a ham license</span></label>`;
  const groups = groupRepeaters(c.hamRepeaters, { mode: S.hamMode });
  const anyCoords = (c.hamRepeaters || []).some((r) => repeaterDistance({ lat: 0, lon: 0 }, r));
  const hint = !S.home && anyCoords ? '<p class="comms-intro">Add a Home pin on the Map to see how far away repeaters are (shown where the data has coordinates).</p>' : '';
  const simplex = simplexShown(c.simplexStandards).map((s) => `<article class="card comms-station">
      <div class="comms-station-top"><span class="comms-freq-sm">${fmtMHz(s.freqMHz)}<small> MHz</small></span><span class="comms-badge">${esc(s.band)}</span></div>
      ${notesHtml(s.use)}${srcLine(s)}</article>`).join('');
  return `
    ${banner}${licenseRow}
    <h2 class="comms-h">Repeaters</h2>
    <div class="comms-chips" role="group" aria-label="Mode filter">
      ${['FM', 'All'].map((m) => `<button type="button" class="comms-chip${S.hamMode === m ? ' comms-on' : ''}" data-act="ham-mode" data-mode="${m}" aria-pressed="${S.hamMode === m}">${m === 'FM' ? 'FM (analog)' : 'All modes'}</button>`).join('')}
    </div>
    ${S.hamMode === 'FM' ? '<p class="comms-intro">Analog FM works on any handheld. Choose All modes to see Fusion, DMR and D-STAR machines (some of them also carry plain FM).</p>' : ''}
    ${hint}
    ${groups.map((g) => `<h3 class="comms-h3">${esc(g.band)}</h3>${g.repeaters.map(repeaterHtml).join('')}`).join('') || '<p class="muted">No repeaters match.</p>'}
    <h2 class="comms-h">Simplex frequencies</h2>
    <p class="comms-intro">Radio to radio, no repeater needed.</p>
    ${simplex}
    <h2 class="comms-h">Clubs and groups</h2>
    ${(c.hamOrganizations || []).map(orgHtml).join('')}
    <h2 class="comms-h">Program a handheld</h2>
    <div class="card">
      <button type="button" class="btn primary big comms-wide" data-act="chirp">⬇ Export CHIRP file (.csv)</button>
      <p class="comms-intro comms-after">Program the radio with CHIRP on a computer. Ham repeaters are listen-only until you're licensed.</p>
    </div>
    <div class="comms-guides">
      ${guideLink(COMMS_GUIDES.repeater, 'Guide: using a repeater')}
      ${guideLink(COMMS_GUIDES.chirp, 'Guide: program a handheld with CHIRP')}
      ${guideLink(COMMS_GUIDES.license, 'Guide: getting a Technician license')}
    </div>`;
}

function downloadChirp() {
  const csv = chirpCsv(S.comms);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = chirpFilename(new Date());
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Saved ${a.download}`);
}

// ---------- section: GMRS / FRS ----------
function gmrsHtml() {
  const c = S.comms;
  const groups = groupChannels(c.frsGmrsChannels);
  const reps = c.gmrsRepeaters || [];
  return `
    <div class="comms-callout comms-callout-warn" role="note"><b class="comms-callout-label">License needed for GMRS</b>
      Transmitting on GMRS needs an FCC license. <a href="#/guide/${COMMS_GUIDES.gmrs}">See the FRS and GMRS guide</a>.</div>
    <h2 class="comms-h">FRS / GMRS channels</h2>
    ${groups.map((g) => `<div class="card comms-chgroup">
      <div class="comms-chgroup-head"><span class="comms-chgroup-range">Channels ${g.channels[0].channel}–${g.channels[g.channels.length - 1].channel}</span></div>
      <div class="comms-power"><span><b>FRS</b> ${esc(g.frsWatts)}</span><span><b>GMRS</b> ${esc(g.gmrsWatts)}</span></div>
      <div class="comms-chans">${g.channels.map((ch) => `<span class="comms-chan"><b>${ch.channel}</b> ${fmtMHz(ch.freqMHz)}</span>`).join('')}</div>
      ${notesHtml(g.notes)}${srcLine(g.channels[0])}</div>`).join('')}
    <h2 class="comms-h">MURS</h2>
    <div class="card comms-chgroup">
      <div class="comms-chans">${(c.murs || []).map((ch) => `<span class="comms-chan"><b>${ch.channel}</b> ${fmtMHz(ch.freqMHz)}</span>`).join('')}</div>
      ${(c.murs || []).length ? `${notesHtml('Up to 2 W (47 CFR 95.2767).')}${srcLine(c.murs[0])}` : ''}
    </div>
    <h2 class="comms-h">GMRS repeaters</h2>
    ${reps.length ? reps.map(repeaterHtml).join('') : '<p class="muted">No verified local GMRS repeaters yet.</p>'}
    <div class="comms-guides">${guideLink(COMMS_GUIDES.gmrs, 'Guide: FRS and GMRS walkie-talkies')}</div>`;
}

// ---------- page ----------
function bodyHtml() {
  if (S.section === 'mesh' && S.walk) return troubleHtml();
  switch (S.section) {
    case 'plan': return planHtml();
    case 'mesh': return meshHtml();
    case 'ham': return hamHtml();
    case 'gmrs': return gmrsHtml();
    default: return listenHtml();
  }
}

function footHtml() {
  return `<div class="callout disclaimer comms-foot" role="note"><b class="callout-label">Check before you rely on it</b>
    ${esc(CAUTION)} Data checked ${esc(S.comms.checkedAt || '')}.</div>`;
}

function paintBody() {
  const body = S.root.querySelector('.comms-body');
  body.innerHTML = bodyHtml() + footHtml();
}

function paintSeg() {
  S.root.querySelectorAll('[data-seg]').forEach((b) => {
    const on = b.dataset.seg === S.section;
    b.classList.toggle('comms-on', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
}

function setSection(id) {
  if (!SECTIONS.some((s) => s.id === id)) return;
  readDraft();
  if (id !== S.section) S.walk = null;
  S.section = id;
  try { localStorage.setItem(LS_SECTION, id); } catch { /* ignore */ }
  paintSeg();
  paintBody();
  window.scrollTo(0, 0);
}

async function onClick(e) {
  if (!S) return;
  const seg = e.target.closest('[data-seg]');
  if (seg) { setSection(seg.dataset.seg); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const i = el.dataset.i != null ? Number(el.dataset.i) : null;
  switch (act) {
    case 'goto-plan': e.preventDefault(); setSection('plan'); break;
    case 'plan-example': S.draft = normalizePlan(examplePlan()); S.editing = true; paintBody(); window.scrollTo(0, 0); break;
    case 'plan-blank': S.draft = emptyPlan(); S.editing = true; paintBody(); window.scrollTo(0, 0); break;
    case 'plan-edit': S.draft = normalizePlan(S.plan); S.editing = true; paintBody(); window.scrollTo(0, 0); break;
    case 'plan-cancel': S.editing = false; S.draft = null; paintBody(); break;
    case 'plan-save': await savePlan(); break;
    case 'plan-copy': await copyPlan(); break;
    case 'cw-add': readDraft(); S.draft.codeWords.push({ word: '', meaning: '' }); paintBody(); break;
    case 'cw-del': readDraft(); S.draft.codeWords.splice(i, 1); paintBody(); break;
    case 'mp-add': readDraft(); S.draft.meetingPoints.push({ name: '', details: '', pinId: '' }); paintBody(); break;
    case 'mp-del': readDraft(); S.draft.meetingPoints.splice(i, 1); paintBody(); break;
    case 'radio-add': radioSheet(null); break;
    case 'radio-edit': radioSheet(i); break;
    case 'ham-mode': S.hamMode = el.dataset.mode === 'All' ? 'All' : 'FM'; paintBody(); break;
    case 'chirp': downloadChirp(); break;
    case 'ts-start': {
      const tree = await ensureTree();
      if (!S) return;
      if (!tree) { S.treeBad = true; paintBody(); break; }
      S.tree = tree; S.treeBad = false;
      S.walk = { stack: [tree.start], picks: [], end: null };
      paintBody(); window.scrollTo(0, 0);
      break;
    }
    case 'ts-exit': S.walk = null; paintBody(); window.scrollTo(0, 0); break;
    case 'ts-restart': S.walk = { stack: [S.tree.start], picks: [], end: null }; paintBody(); window.scrollTo(0, 0); break;
    case 'ts-back': {
      const w = S.walk;
      if (w.end) { w.end = null; w.picks.pop(); } else if (w.stack.length > 1) { w.stack.pop(); w.picks.pop(); }
      paintBody(); window.scrollTo(0, 0);
      break;
    }
    case 'ts-opt': {
      const w = S.walk;
      const step = treeStep(S.tree, w.stack[w.stack.length - 1]);
      const opt = step && step.options[i];
      if (!opt) break;
      w.picks.push(opt.label);
      if (opt.next === null) w.end = opt.end; else w.stack.push(opt.next);
      paintBody(); window.scrollTo(0, 0);
      break;
    }
    default: break;
  }
}

async function onChange(e) {
  if (!S) return;
  const box = e.target.closest('[data-f="ham-licensed"]');
  if (box) {
    const on = !!box.checked;
    await saveSettings({ hamLicensed: on });
    S.settings.hamLicensed = on;
    paintBody();
  }
}

export async function render(container) {
  await loadCss('css/comms.css');
  let comms;
  try {
    const res = await fetch('data/comms.json');
    if (!res.ok) throw new Error(`comms.json: ${res.status}`);
    comms = await res.json();
  } catch (err) {
    container.innerHTML = `<h1>Comms &amp; Radio</h1><div class="card empty"><p><b>Comms data could not be loaded.</b></p><p class="muted">${esc(err.message)}</p></div>`;
    return;
  }
  const [settings, pins] = await Promise.all([getSettings(), getAll('pins')]);
  let section = 'listen';
  try { const saved = localStorage.getItem(LS_SECTION); if (SECTIONS.some((s) => s.id === saved)) section = saved; } catch { /* ignore */ }
  const home = pins.find((p) => p.type === 'home' && Number.isFinite(p.lat) && Number.isFinite(p.lon)) || null;
  S = {
    root: container, comms, settings, pins, home, section, hamMode: 'FM',
    plan: settings.pacePlan ? normalizePlan(settings.pacePlan) : null,
    editing: false, draft: null, tree: null, treeBad: false, walk: null,
  };
  container.innerHTML = `<h1 class="comms-title">Comms &amp; Radio</h1>
    <div class="comms-seg" role="tablist" aria-label="Comms sections">${SECTIONS.map((s) => `<button type="button" class="comms-segbtn" role="tab" data-seg="${s.id}">${s.label}</button>`).join('')}</div>
    <div class="comms-body"></div>`;
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  paintSeg();
  paintBody();
}

export function destroy() {
  if (S) {
    S.root.removeEventListener('click', onClick);
    S.root.removeEventListener('change', onChange);
  }
  S = null;
}
