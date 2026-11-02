// Guides: loading the index, the kind -> guides map, the bleach calculator and the block renderers.
// Everything that touches the network or localStorage is inside a function (and wrapped in try/catch),
// so this file also imports cleanly in Node for the tests. All HTML is built from esc()-ed text:
// guide JSON text never reaches innerHTML raw.
import { esc, fmtDate, fmtNum } from './format.js';
import { ROOM_TEMP_LABELS } from './categories.js';

export const GUIDES_DIR = 'data/guides';

// Display order for the guide categories (also the sort order of the index).
export const GUIDE_CATEGORIES = [
  { key: 'water', label: 'Water', icon: '💧' },
  { key: 'food', label: 'Food', icon: '🥫' },
  { key: 'cooking', label: 'Cooking', icon: '🔥' },
  { key: 'power', label: 'Power', icon: '🔋' },
  { key: 'sanitation', label: 'Sanitation', icon: '🧻' },
  { key: 'hazards', label: 'Hazards', icon: '⚠️' },
  { key: 'comms', label: 'Comms & radio', icon: '📻' },
  { key: 't1d', label: 'Type 1 diabetes', icon: '🩸' },
  { key: 'firstaid', label: 'First aid', icon: '⛑️' },
];
export const GUIDE_CATEGORY_KEYS = GUIDE_CATEGORIES.map((c) => c.key);
export const guideCategory = (key) => GUIDE_CATEGORIES.find((c) => c.key === key) || null;

export const BLOCK_TYPES = ['p', 'h', 'steps', 'list', 'checklist', 'warning', 'tip', 'table', 'calc', 't1dplan', 'source', 'figure'];

export const DISCLAIMER = "General information from the sources below, not medical advice. In an emergency call 911. Follow your own doctor's instructions first.";

// ---------- bleach calculator (EPA emergency disinfection) ----------
// EPA: 8 drops per gallon of 6% bleach, 6 drops per gallon of 8.25%; double it for cloudy water.
// Drop size varies. EPA's own table implies 64 drops per teaspoon at its smallest (16 drops = 1/4 tsp),
// so use that: converting with fewer drops per teaspoon gives MORE bleach, never less.
export const DROPS_PER_TSP = 64;
export function bleachDose(gallons, pct, cloudy) {
  const p = Number(pct);
  let perGal;
  if (Math.abs(p - 6) < 1e-9) perGal = 8;
  else if (Math.abs(p - 8.25) < 1e-9) perGal = 6;
  else throw new RangeError('Bleach strength must be 6 or 8.25');
  const g = Number(gallons);
  if (!Number.isFinite(g) || g <= 0) return 0;
  // round UP to a whole drop: a slightly strong dose is safe, a weak one is not
  return Math.ceil(perGal * g * (cloudy ? 2 : 1) - 1e-9);
}

export function bleachResultHtml(gallons, pct, cloudy) {
  const g = Number(gallons);
  if (!Number.isFinite(g) || g <= 0) return '<p class="muted">Enter how many gallons of water you are treating.</p>';
  const drops = bleachDose(g, pct, cloudy);
  const tsp = drops >= DROPS_PER_TSP
    ? `<div class="calc-tsp">about ${esc(fmtNum(Math.round((drops / DROPS_PER_TSP) * 100) / 100))} teaspoon${drops / DROPS_PER_TSP > 1.005 ? 's' : ''}
        <small>(counting 1 teaspoon as 64 drops, which errs toward more bleach; drops are more accurate)</small></div>` : '';
  return `<div class="calc-drops"><b>${esc(fmtNum(drops))}</b> drops</div>${tsp}
    <p>of ${esc(String(pct))}% plain, unscented bleach in ${esc(fmtNum(g))} gallon${g === 1 ? '' : 's'} of ${cloudy ? 'cloudy' : 'clear'} water.
    Stir, then <b>wait 30 minutes</b> before drinking.</p>`;
}

function calcHtml() {
  return `<div class="card g-calc" data-calc="bleach">
    <h3>Bleach dose calculator</h3>
    <div class="field-pair">
      <label class="field"><span>Gallons of water</span><input type="number" inputmode="decimal" step="any" min="0" value="1" id="calc-gal"></label>
      <label class="field"><span>Bleach strength</span><select id="calc-pct"><option value="6">6%</option><option value="8.25">8.25%</option></select></label>
    </div>
    <label class="field"><span>Water looks</span><select id="calc-cloudy"><option value="0">Clear</option><option value="1">Cloudy or cold</option></select></label>
    <div class="calc-out" id="calc-out" aria-live="polite">${bleachResultHtml(1, 6, false)}</div>
    <p class="hint">Check the label: use plain bleach with no scent, thickener or added cleaners. EPA dose: 8 drops per gallon at 6%, 6 drops at 8.25%, doubled for cloudy water.</p>
  </div>`;
}

// ---------- text ----------
// Escape first, THEN turn **x** into <b>x</b>. Order matters: it keeps raw guide text out of the HTML.
export function richText(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// ---------- loading ----------
let indexCache = null;
export function resetGuidesCache() { indexCache = null; }

export async function loadIndex() {
  if (indexCache) return indexCache;
  try {
    const res = await fetch(`${GUIDES_DIR}/index.json`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.guides)) return null;
    indexCache = json;
    return json;
  } catch {
    return null; // missing, offline and never cached, or damaged: the views say "not downloaded yet"
  }
}

export async function loadGuide(id) {
  if (!/^[a-z0-9-]+$/i.test(String(id))) return null;
  try {
    const res = await fetch(`${GUIDES_DIR}/${id}.json`);
    if (!res.ok) return null;
    const g = await res.json();
    return g && Array.isArray(g.blocks) ? g : null;
  } catch {
    return null;
  }
}

// Category order, then title (the index is already sorted this way; the list view sorts again to be safe).
export function sortGuides(list) {
  const rank = (g) => { const i = GUIDE_CATEGORY_KEYS.indexOf(g.category); return i === -1 ? 99 : i; };
  return [...list].sort((a, b) => rank(a) - rank(b) || String(a.title).localeCompare(String(b.title)));
}

// kind -> [index entries], from the index.
export function kindMap(index) {
  const map = {};
  for (const g of (index && index.guides) || []) {
    for (const k of g.kinds || []) (map[k] ||= []).push(g);
  }
  return map;
}
export function guidesForKind(index, kind) {
  return kindMap(index)[kind] || [];
}

// ---------- checklist state (localStorage, per guide) ----------
const checkKey = (guideId) => `hb_checklist_${guideId}`;
export function getChecked(guideId) {
  try {
    const arr = JSON.parse(localStorage.getItem(checkKey(guideId)) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
export function setChecked(guideId, set) {
  try {
    if (set.size) localStorage.setItem(checkKey(guideId), JSON.stringify([...set]));
    else localStorage.removeItem(checkKey(guideId));
  } catch { /* private mode / storage full: the list still works for this visit */ }
}

// ---------- T1D plan ----------
export const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;

const PLAN_TEXT = [
  ['carbRatio', 'Carb ratio'], ['correctionFactor', 'Correction factor'], ['targetBg', 'Target blood sugar'],
];
const PLAN_PHONES = [
  ['endoName', 'endoPhone', 'Diabetes doctor'], ['pharmacyName', 'pharmacyPhone', 'Pharmacy'],
  [null, 'pumpSupportPhone', 'Pump support'], [null, 'cgmSupportPhone', 'CGM support'],
];

export function planHasContent(plan) {
  if (!plan) return false;
  return ['backupBasalInsulin', 'backupBasalUnits', 'carbRatio', 'correctionFactor', 'targetBg', 'endoName', 'endoPhone',
    'pharmacyName', 'pharmacyPhone', 'pumpSupportPhone', 'cgmSupportPhone', 'notes']
    .some((k) => plan[k] !== undefined && plan[k] !== null && String(plan[k]).trim() !== '');
}

export function t1dPlanHtml(people) {
  const t1d = (people || []).filter((p) => p && p.t1d);
  if (!t1d.length) return '<div class="card g-plan"><p class="muted">No one in your household is marked as having Type 1 diabetes.</p></div>';
  return t1d.map((p) => {
    const plan = p.t1d.plan;
    if (!planHasContent(plan)) {
      return `<div class="card g-plan"><h3>${esc(p.name)}</h3>
        <p>Fill in your emergency plan with your diabetes team.</p>
        <a class="btn primary" href="#/person/${esc(p.id)}">Fill in ${esc(p.name)}'s plan</a></div>`;
    }
    const row = (k, v) => `<div class="fact"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    let rows = '';
    if (plan.backupBasalUnits !== null && plan.backupBasalUnits !== undefined && plan.backupBasalUnits !== '') {
      const ins = ROOM_TEMP_LABELS[plan.backupBasalInsulin] || '';
      rows += row('Long-acting dose if the pump fails', `<b>${esc(fmtNum(plan.backupBasalUnits))} units</b>${ins ? ` of ${esc(ins)}` : ''}`);
    } else if (plan.backupBasalInsulin) {
      rows += row('Long-acting insulin if the pump fails', esc(ROOM_TEMP_LABELS[plan.backupBasalInsulin] || plan.backupBasalInsulin));
    }
    for (const [key, label] of PLAN_TEXT) if (String(plan[key] || '').trim()) rows += row(label, esc(plan[key]));
    for (const [nameKey, phoneKey, label] of PLAN_PHONES) {
      const name = nameKey ? String(plan[nameKey] || '').trim() : '';
      const phone = String(plan[phoneKey] || '').trim();
      if (!name && !phone) continue;
      rows += row(label, `${name ? `${esc(name)}<br>` : ''}${phone ? `<a class="tel" href="${esc(telHref(phone))}">📞 ${esc(phone)}</a>` : ''}`);
    }
    return `<div class="card g-plan"><h3>${esc(p.name)}</h3><dl class="facts plan-facts">${rows}</dl>
      ${String(plan.notes || '').trim() ? `<div class="prewrap g-plan-notes">${esc(plan.notes)}</div>` : ''}
      <p class="muted small">${plan.updatedAt ? `Last updated ${esc(fmtDate(String(plan.updatedAt).slice(0, 10)))} — ` : ''}review with your doctor yearly.
      <a href="#/person/${esc(p.id)}">Edit plan</a></p></div>`;
  }).join('');
}

// ---------- blocks ----------
export function sourceLine(guide, n) {
  const s = guide.sources && guide.sources[Number(n) - 1];
  return s ? `<p class="g-source">Source: ${esc(s.title)}</p>` : '';
}

// A diagram: an SVG file shipped with the app (img/guides/...), shown inside a button so a tap opens it full screen.
// src, alt and caption are all escaped. A figure with no src or no alt text renders nothing (the validator rejects it anyway).
export function figureHtml(block) {
  const src = String(block.src || '').trim();
  const alt = String(block.alt || '').trim();
  if (!src || !alt) return '';
  const cap = String(block.caption || '').trim();
  return `<figure class="g-fig"><button type="button" class="g-fig-btn" data-fig-zoom aria-label="Open the diagram full screen">
    <img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" width="480"></button>
    ${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>`;
}

// `ctx`: { guide, people }. Returns an HTML string for one block, or '' for an unknown/empty block.
export function blockHtml(block, bi, ctx) {
  if (!block || typeof block !== 'object') return '';
  const items = Array.isArray(block.items) ? block.items : [];
  switch (block.type) {
    case 'p': return `<p class="g-p">${richText(block.text)}</p>`;
    case 'h': return `<h2 class="g-h">${richText(block.text)}</h2>`;
    case 'steps': return `<ol class="g-steps">${items.map((t) => `<li><span>${richText(t)}</span></li>`).join('')}</ol>`;
    case 'list': return `<ul class="g-list">${items.map((t) => `<li>${richText(t)}</li>`).join('')}</ul>`;
    case 'checklist': {
      const done = getChecked(ctx.guide.id);
      return `<ul class="g-check">${items.map((t, i) => {
        const key = `${bi}:${i}`;
        return `<li><label><input type="checkbox" data-check="${key}"${done.has(key) ? ' checked' : ''}><span>${richText(t)}</span></label></li>`;
      }).join('')}</ul>
        <button type="button" class="linklike" data-reset-checklist>Reset checklist</button>`;
    }
    case 'warning': return `<div class="callout warn" role="note"><b class="callout-label">⚠️ Warning</b>${richText(block.text)}</div>`;
    case 'tip': return `<div class="callout tip" role="note"><b class="callout-label">💡 Tip</b>${richText(block.text)}</div>`;
    case 'table': {
      const headers = Array.isArray(block.headers) ? block.headers : [];
      const rows = Array.isArray(block.rows) ? block.rows : [];
      return `<div class="g-table-wrap" tabindex="0"><table class="g-table">
        ${headers.length ? `<thead><tr>${headers.map((h) => `<th>${richText(h)}</th>`).join('')}</tr></thead>` : ''}
        <tbody>${rows.map((r) => `<tr>${(Array.isArray(r) ? r : [r]).map((c) => `<td>${richText(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    case 'calc': return block.calc === 'bleach' ? calcHtml() : '';
    case 't1dplan': return t1dPlanHtml(ctx.people);
    case 'source': return sourceLine(ctx.guide, block.n);
    case 'figure': return figureHtml(block);
    default: return ''; // unknown block types are skipped, never shown raw
  }
}

export function sourcesListHtml(guide, online) {
  const list = guide.sources || [];
  if (!list.length) return '';
  return `<section class="card"><h2>Sources</h2><ul class="g-sources">${list.map((s) => {
    const safe = /^https?:\/\//i.test(String(s.url || ''));
    return `<li><b>${esc(s.title)}</b><br>${safe && online
      ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="g-url">${esc(s.url)}</a>`
      : `<span class="g-url muted">${esc(s.url || '')}</span>`}</li>`;
  }).join('')}</ul>
    <p class="muted small">Links open outside the app and need internet.</p></section>`;
}

export function relatedItemsHtml(guide, items) {
  const kinds = new Set(guide.kinds || []);
  const rel = (items || []).filter((i) => kinds.has(i.kind));
  if (!rel.length) return '';
  return `<section class="card"><h2>Related items in your inventory</h2>${rel.map((i) =>
    `<a class="exp-row" href="#/item/${esc(i.id)}"><span>${esc(i.name)}</span><span class="exp-when">${esc(fmtNum(i.qty))}${i.unit ? ` ${esc(i.unit)}` : ''}</span></a>`).join('')}</section>`;
}

export function disclaimerHtml() {
  return `<div class="callout disclaimer" role="note"><b class="callout-label">Medical information</b>${esc(DISCLAIMER)}</div>`;
}

export function guideHtml(guide, { people = [], items = [], online = true } = {}) {
  const ctx = { guide, people };
  const cat = guideCategory(guide.category);
  return `<a class="back" href="#/guides">← Guides</a>
    <header class="g-head">${cat ? `<div class="muted small">${cat.icon} ${esc(cat.label)}</div>` : ''}
      <h1>${esc(guide.title)}</h1>
      ${guide.summary ? `<p class="g-summary">${esc(guide.summary)}</p>` : ''}</header>
    ${guide.medical ? disclaimerHtml() : ''}
    <div class="g-body">${guide.blocks.map((b, i) => blockHtml(b, i, ctx)).join('')}</div>
    ${relatedItemsHtml(guide, items)}
    ${sourcesListHtml(guide, online)}
    <p class="muted small g-checked">Checked ${esc(fmtDate(guide.checkedAt))}</p>`;
}
