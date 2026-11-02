// Plans (#/plans, #/plans/<id>): "Go to Gram's", the packing list, the arrival list, scenario checklists,
// per-person go-bags, emergency contacts and the Go plan itself.
// The logic (what goes on which list, progress, daily reset, plan text) lives in js/plans.js and is tested there.
// Check marks are saved to the `checklists` store on every tap (debounced 300 ms, flushed when the page is hidden).
import { getAll, get, put, del, newId, getSettings, saveSettings } from '../db.js';
import { esc, fmtDate, fmtDays } from '../format.js';
import { localDateString, computeRunway } from '../runway.js';
import { distanceFrom, pinEmoji, telHref } from '../mapinfo.js';
import { openSheet } from '../sheet.js';
import { richText, loadIndex, disclaimerHtml } from '../guides.js';
import { PACE_TIERS, normalizePlan, planIsEmpty } from '../comms.js';
import * as P from '../plans.js';

const TPL = 'data/plans/';
const GRAMS = 'go-to-grams';
const toast = (message) => window.dispatchEvent(new CustomEvent('hb:toast', { detail: { message } }));
const todayStr = () => localDateString(new Date());

let S = null; // per-visit state; destroy() clears it

// ---------- loading ----------
function loadCss(href) {
  const existing = document.querySelector(`link[data-plans-css="${href}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.plansCss = href;
    l.onload = () => resolve(); l.onerror = () => resolve();
    document.head.appendChild(l);
    setTimeout(resolve, 1500); // never block the screen on a slow stylesheet
  });
}

const jsonCache = new Map();
async function getJson(path) {
  if (jsonCache.has(path)) return jsonCache.get(path);
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const json = await res.json();
    jsonCache.set(path, json);
    return json;
  } catch (err) {
    console.warn('Plans data unavailable:', err.message);
    return null;
  }
}
const tpl = (name) => getJson(`${TPL}${name}.json`);

// ---------- saving check marks ----------
const pending = new Map(); // runs waiting for the debounce
const inflight = new Map(); // runs not yet confirmed in IndexedDB (so a screen opened right away still sees them)
let saveTimer = null;
let listening = false;

function queueSave(run) {
  pending.set(run.id, run);
  inflight.set(run.id, run);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

async function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  const runs = [...pending.values()];
  pending.clear();
  for (const r of runs) {
    try { await put('checklists', r); } catch (err) { console.error(err); toast('Could not save your check marks'); }
    if (inflight.get(r.id) === r) inflight.delete(r.id);
  }
}

function ensureListeners() {
  if (listening) return;
  listening = true;
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

async function loadRun(id) {
  return inflight.get(id) || (await get('checklists', id)) || P.emptyRun(id);
}

async function loadRuns() {
  const rows = await getAll('checklists');
  const map = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const [id, r] of inflight) map[id] = r;
  return map;
}

// ---------- small html helpers ----------
const CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const meter = (pct, cls = '') => `<div class="plans-meter ${cls}" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
const back = (href, text) => `<a class="back" href="${href}">← ${esc(text)}</a>`;
const startedText = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  const same = localDateString(d) === todayStr();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Started ${same ? '' : `${fmtDate(localDateString(d))}, `}${t}`;
};

let guideTitles = {};
async function loadGuideTitles() {
  const idx = await loadIndex();
  guideTitles = {};
  for (const g of (idx && idx.guides) || []) guideTitles[g.id] = g.title;
}

// ---------- check-off rows ----------
function lineHtml(line) {
  if (line.type === 'head') {
    return `<div class="plans-line plans-subhead"><div class="plans-name">${richText(line.text)}</div>${line.note ? `<div class="plans-note">${richText(line.note)}</div>` : ''}${guideLink(line.guide)}</div>`;
  }
  const rich = line.type === 'fixed';
  const name = rich ? richText(line.text) : esc(line.text);
  const nameCls = rich ? 'plans-name plans-name-fixed' : 'plans-name';
  const src = line.source ? ` <span class="plans-src" aria-label="source ${line.source}">[${line.source}]</span>` : '';
  let where = '';
  if (line.type === 'item' || line.type === 'med') {
    if (line.location) where = `<span class="plans-loc">📍 ${esc(line.location)}</span>`;
    else if (line.type === 'med' && !line.inStock) where = '<span class="plans-loc plans-noloc">Not in inventory</span>';
    else where = '<span class="plans-loc plans-noloc">📍 No location saved</span>';
  }
  const warn = line.expired ? `<span class="plans-warn">⚠ Expired ${esc(fmtDate(line.expires))}</span>` : '';
  const cls = `plans-line${line.checked ? ' plans-done' : ''}${line.hidden ? ' plans-ghost' : ''}`;
  const qty = line.qty ? `<span class="plans-qty"> · ${esc(line.qty)}</span>` : '';
  const body = `<span class="plans-box" aria-hidden="true">${CHECK}</span>
    <span class="plans-txt"><span class="${nameCls}">${name}${qty}${src}</span>${where}${warn}
      ${line.note ? `<span class="plans-note">${richText(line.note)}</span>` : ''}${line.who ? `<span class="plans-who">👤 ${esc(line.who)}</span>` : ''}</span>`;
  const main = line.hidden
    ? `<div class="plans-row plans-row-off">${body}</div><button type="button" class="plans-more plans-restore" data-act="unhide" data-key="${esc(line.key)}">Restore</button>`
    : `<button type="button" class="plans-row" role="checkbox" aria-checked="${line.checked}" data-act="tick" data-key="${esc(line.key)}">${body}</button>
       <button type="button" class="plans-more" data-act="more" data-key="${esc(line.key)}" aria-label="Options for ${esc(line.text)}">⋯</button>`;
  return `<div class="${cls}" data-line="${esc(line.key)}"><div class="plans-main">${main}</div>${guideLink(line.guide)}</div>`;
}

function guideLink(id) {
  if (!id) return '';
  return `<a class="plans-guide" href="#/guide/${esc(id)}">📖 ${esc(guideTitles[id] || 'Open the guide')} ›</a>`;
}

function groupHtml(g, collapsed) {
  const complete = g.total > 0 && g.done === g.total;
  const dailyNote = g.daily ? `<p class="plans-hint">Resets every day. Today: ${esc(fmtDate(todayStr()))}.</p>` : '';
  return `<section class="plans-group${complete ? ' plans-complete' : ''}${collapsed ? ' plans-collapsed' : ''}" data-group="${esc(g.id)}">
    <button type="button" class="plans-ghead" data-act="gtoggle" data-group="${esc(g.id)}" aria-expanded="${!collapsed}">
      <span class="plans-gtitle">${esc(g.title)}</span>
      <span class="plans-gcount" data-gcount="${esc(g.id)}">${complete ? '✓ ' : ''}${g.done} / ${g.total}</span>
      <span class="plans-chev" aria-hidden="true">›</span>
    </button>
    <div class="plans-gbody">
      ${g.hint ? `<p class="plans-hint">${richText(g.hint)}</p>` : ''}${dailyNote}
      ${g.lines.map(lineHtml).join('')}
      <button type="button" class="plans-add" data-act="addline" data-group="${esc(g.id)}">＋ Add line</button>
    </div>
  </section>`;
}

const groupsOf = (b) => b.tiers || b.groups || [];

// ---------- the checklist screen (loadout, arrival, scenario, go-bag) ----------
// V = { kind, runId, run, build(run, showHidden), built, field: 'tier'|'section', word, ... }
function paintList() {
  const V = S.V;
  V.built = V.build(V.run, V.showHidden);
  const groups = groupsOf(V.built);
  const root = S.root;
  root.querySelector('[data-groups]').innerHTML = groups.map((g) => groupHtml(g, S.collapsed.has(g.id))).join('');
  const extra = root.querySelector('[data-extra]');
  if (extra) extra.innerHTML = extraHtml();
  patchBar();
}

function extraHtml() {
  const V = S.V;
  let html = '';
  if (V.kind === 'loadout' && V.built.atGrams.length) {
    html += `<details class="plans-gram"><summary>Already at Gram's (${V.built.atGrams.length})</summary>
      <p class="plans-hint">No need to pack these. Not counted in the total.</p>
      ${V.built.atGrams.map((l) => `<div class="plans-gline"><span class="plans-name">${esc(l.text)}<span class="plans-qty"> · ${esc(l.qty)}</span></span><span class="plans-loc">📍 ${esc(l.location)}</span></div>`).join('')}
    </details>`;
  }
  if (V.built.hiddenCount > 0 || V.showHidden) {
    html += `<button type="button" class="plans-chipbtn" data-act="showhidden" aria-pressed="${V.showHidden}">${V.showHidden ? 'Stop showing hidden lines' : `Show hidden lines (${V.built.hiddenCount})`}</button>`;
  }
  return html;
}

function barText() {
  const V = S.V;
  const p = P.progress(V.built, { skipDaily: V.kind === 'arrival' });
  return { ...p, text: `${V.word} ${p.done} / ${p.total}` };
}

function patchBar() {
  const V = S.V;
  const bar = S.root.querySelector('[data-bar]');
  if (!bar) return;
  const p = barText();
  bar.querySelector('[data-bartxt]').textContent = p.text;
  bar.querySelector('.plans-meter i').style.width = `${p.pct}%`;
  bar.classList.toggle('plans-bar-done', p.total > 0 && p.done === p.total);
  const st = S.root.querySelector('[data-started]');
  if (st) st.textContent = startedText(V.run.startedAt);
  const rw = S.root.querySelector('[data-runway]');
  if (rw && V.kind === 'loadout') rw.innerHTML = runwayHtml();
}

function patchCounts() {
  const V = S.V;
  for (const g of groupsOf(V.built)) {
    const el = S.root.querySelector(`[data-gcount="${CSS.escape(g.id)}"]`);
    if (!el) continue;
    const complete = g.total > 0 && g.done === g.total;
    el.textContent = `${complete ? '✓ ' : ''}${g.done} / ${g.total}`;
    const sec = el.closest('.plans-group');
    sec.classList.toggle('plans-complete', complete);
    if (complete && !S.collapsed.has(g.id)) {
      // fold a finished group away, but after a beat so nothing moves under the finger that just tapped
      setTimeout(() => {
        if (!S || !S.V) return;
        const now = groupsOf(S.V.built).find((x) => x.id === g.id);
        if (now && now.total > 0 && now.done === now.total && !S.collapsed.has(g.id) && !S.userOpened.has(g.id)) {
          S.collapsed.add(g.id);
          const s2 = S.root.querySelector(`.plans-group[data-group="${CSS.escape(g.id)}"]`);
          if (s2) { s2.classList.add('plans-collapsed'); s2.querySelector('.plans-ghead').setAttribute('aria-expanded', 'false'); }
        }
      }, 700);
    }
  }
  patchBar();
}

function commit(run) {
  S.V.run = run;
  queueSave(run);
}

function tick(key) {
  const V = S.V;
  commit(P.toggleLine(V.run, key, Date.now()));
  V.built = V.build(V.run, V.showHidden);
  const el = S.root.querySelector(`[data-line="${CSS.escape(key)}"]`);
  if (el) {
    const on = !!V.run.checked[key];
    el.classList.toggle('plans-done', on);
    el.classList.add('plans-fresh'); // stays visible even with "Hide packed" until the next repaint
    const btn = el.querySelector('[data-act="tick"]');
    if (btn) btn.setAttribute('aria-checked', String(on));
  }
  patchCounts();
}

function addLineSheet(groupId) {
  const sh = openSheet(`<h2>Add a line</h2>
    <label class="field"><span>What to bring or do</span><input type="text" id="plans-new" maxlength="200" autocomplete="off" enterkeyhint="done"></label>
    <div class="btn-row"><button type="button" class="btn primary" data-sheet="add">Add</button><button type="button" class="btn" data-sheet="close">Cancel</button></div>`, {
    onAction(name, close) {
      if (name !== 'add') return;
      const text = sh.el.querySelector('#plans-new').value.trim();
      if (!text) return;
      const V = S && S.V;
      if (!V) { close(); return; }
      commit(P.addCustomLine(V.run, { id: `c-${newId().slice(0, 8)}`, text, [V.field]: groupId }, Date.now()));
      S.collapsed.delete(groupId);
      paintList();
      close();
    },
  });
  const input = sh.el.querySelector('#plans-new');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sh.el.querySelector('[data-sheet="add"]').click(); } });
}

function moreSheet(key) {
  const V = S.V;
  const line = groupsOf(V.built).flatMap((g) => g.lines).find((l) => l.key === key);
  if (!line) return;
  const custom = line.type === 'custom';
  const isItem = line.type === 'item';
  const sh = openSheet(`<h2>${esc(line.text)}</h2>
    <div class="btn-row plans-sheet-btns">
      ${isItem ? '<button type="button" class="btn" data-sheet="open">Open this item</button>' : ''}
      ${custom ? '<button type="button" class="btn danger" data-sheet="delete">Delete this line</button>'
        : '<button type="button" class="btn" data-sheet="hide">Hide this line</button>'}
      <button type="button" class="btn" data-sheet="close">Close</button>
    </div>
    ${custom ? '' : '<p class="muted small">Hidden lines do not count. Use "Show hidden lines" at the bottom to bring them back. Packing the wrong thing? Change "Pack for Gram\'s" on the item instead.</p>'}`, {
    onAction(name, close) {
      if (!S || !S.V) { close(); return; }
      if (name === 'hide') { commit(P.hideLine(S.V.run, key, Date.now())); paintList(); }
      if (name === 'delete') { commit(P.removeCustomLine(S.V.run, key, Date.now())); paintList(); }
      if (name === 'open') { location.hash = `#/item/${line.id}`; }
      close();
    },
  });
  return sh;
}

function resetSheet() {
  openSheet(`<h2>Start over?</h2>
    <p>This clears every check mark and the start time. The lines you added or hid stay.</p>
    <div class="btn-row"><button type="button" class="btn danger" data-sheet="reset">Clear check marks</button><button type="button" class="btn" data-sheet="close">Cancel</button></div>`, {
    onAction(name, close) {
      if (name === 'reset' && S && S.V) {
        commit(P.resetRun(S.V.run, Date.now()));
        S.collapsed = new Set();
        S.userOpened = new Set();
        paintList();
        toast('Check marks cleared');
      }
      close();
    },
  });
}

// "What we're taking lasts" - the household runway over only the packed inventory items
function runwayHtml() {
  const V = S.V;
  const packed = P.packedItems(S.items, V.run);
  if (!packed.length) {
    return '<p class="plans-rw-empty"><b>What we\'re taking lasts…</b> <span class="muted">tick items to see</span></p>';
  }
  const rw = computeRunway(packed, S.people, S.pets, S.settings, new Date());
  const b = rw.resources.find((r) => r.key === rw.bottleneck);
  if (!b) return '<h2>What we\'re taking lasts…</h2><p class="muted">Nothing to measure yet.</p>';
  return `<h2>What we're taking lasts…</h2>
    <p class="plans-days"><b>≈ ${esc(fmtDays(b.days))}</b> <span class="badge ${b.status === 'red' ? 'red' : b.status === 'amber' ? 'amber' : ''}">bottleneck: ${esc(b.label.toLowerCase())}</span></p>
    <p class="muted small">Counts ticked items only, at full quantity, using your settings. Does not include what is already at Gram's.</p>`;
}

function barHtml() {
  const V = S.V;
  return `<div class="plans-tools">
      <button type="button" class="plans-chipbtn" data-act="hidepacked" aria-pressed="false">Hide ${V.kind === 'arrival' || V.kind === 'scenario' ? 'done' : 'packed'}</button>
      <button type="button" class="plans-chipbtn" data-act="reset">Reset</button>
      <span class="plans-started" data-started></span>
    </div>
    <div class="plans-bar" data-bar>
      <div class="plans-bar-top"><b data-bartxt></b></div>
      ${meter(0)}
    </div>`;
}

function sourcesHtml(tplData) {
  const src = (tplData && tplData.sources) || [];
  if (!src.length) return '';
  return `<div class="card plans-sources"><h3>Sources</h3>
    <ol>${src.map((s) => `<li>${/^https?:\/\//.test(s.url || '') ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>` : esc(s.title)}</li>`).join('')}</ol>
    ${tplData.checkedAt ? `<p class="muted small">Checked ${esc(fmtDate(tplData.checkedAt))}. Check the source before you rely on it.</p>` : ''}</div>`;
}

function missing(container, backHref, backText, title, what) {
  container.innerHTML = `${back(backHref, backText)}<h1>${esc(title)}</h1><div class="card empty"><p><b>${esc(what)} could not be loaded.</b></p>
    <p class="muted">The plan files may not be downloaded yet. Open the app once with a connection, then try again.</p></div>`;
}

// shared skeleton + wiring for the four checklist kinds
function startChecklist(st, cfg) {
  const container = st.root;
  const run = cfg.run;
  const dailyKeys = cfg.dailyKeys || [];
  const fixed = P.applyDailyReset(run, todayStr(), dailyKeys);
  if (fixed.dailyDate !== run.dailyDate) queueSave(fixed);
  st.V = {
    kind: cfg.kind, run: fixed, build: cfg.build, field: cfg.field, word: cfg.word, showHidden: false, built: null,
  };
  st.collapsed = new Set();
  st.userOpened = new Set();
  container.innerHTML = `
    ${back(cfg.backHref, cfg.backText)}
    <div class="plans-titlerow"><h1>${cfg.title}</h1></div>
    ${cfg.subtitle ? `<p class="muted plans-sub">${cfg.subtitle}</p>` : ''}
    ${barHtml()}
    <div class="plans-top">${cfg.topHtml || ''}</div>
    <div data-groups></div>
    <div data-extra class="plans-extra"></div>
    ${cfg.bottomHtml || ''}`;
  // groups that are already complete start folded away
  st.V.built = st.V.build(st.V.run, false);
  for (const g of groupsOf(st.V.built)) if (g.total > 0 && g.done === g.total) st.collapsed.add(g.id);
  paintList();
}

// ---------- Load-out ----------
async function renderLoadout(st) {
  const [template, items, people, pets, settings, run] = await Promise.all([
    tpl('loadout'), getAll('items'), getAll('people'), getAll('pets'), getSettings(), loadRun('loadout'), loadGuideTitles(),
  ]);
  if (S !== st) return;
  if (!template) { missing(st.root, '#/plans', 'Plans', 'Pack for Gram\'s', 'The packing list'); return; }
  Object.assign(st, { items, people, pets, settings });
  const goPlan = P.normalizeGoPlan(settings.goPlan);
  const today = todayStr();
  const alerts = P.loadoutAlerts(items, people);
  const alertHtml = alerts.map((a) => `<div class="plans-alert" role="note"><span aria-hidden="true">⚠️</span>
      <span class="plans-alert-txt">${richText(a.text)}</span>
      <a class="plans-alert-add" href="#/add?cat=${esc(a.cat)}&kind=${esc(a.kind)}">＋ Add</a></div>`).join('');
  startChecklist(st, {
    kind: 'loadout', runId: 'loadout', run, field: 'tier', word: 'Packed',
    build: (r, showHidden) => P.buildLoadout(template, items, r, people, { today, showHidden }),
    backHref: '#/plans', backText: 'Plans',
    title: `Pack for ${esc(goPlan.destination.name)}`,
    subtitle: 'Tap a row when it is in the car. 📍 = where to find it.',
    topHtml: `${alertHtml}<div class="card plans-runway" data-runway></div>`,
    bottomHtml: `${sourcesHtml(template)}<div class="plans-links"><a class="btn" href="#/plans/arrival">We're here: arrival list ›</a><a class="btn" href="#/plans/go">The plan ›</a></div>`,
  });
}

// ---------- Arrival ----------
async function renderArrival(st) {
  const [template, settings, run] = await Promise.all([tpl('arrival'), getSettings(), loadRun('arrival'), loadGuideTitles()]);
  if (S !== st) return;
  if (!template) { missing(st.root, '#/plans', 'Plans', 'When we get there', 'The arrival list'); return; }
  const goPlan = P.normalizeGoPlan(settings.goPlan);
  const sections = template.sections || [];
  const notes = goPlan.destination.notes.trim();
  startChecklist(st, {
    kind: 'arrival', runId: 'arrival', run, field: 'section', word: 'Done',
    dailyKeys: P.dailyKeysOf(sections, run),
    build: (r, showHidden) => P.buildSections(sections, r, { showHidden }),
    backHref: '#/plans', backText: 'Plans',
    title: `We're at ${esc(goPlan.destination.name)}`,
    subtitle: 'Do these in order. "Every day there" starts fresh each morning.',
    topHtml: notes ? `<div class="card plans-destnotes"><b>About ${esc(goPlan.destination.name)}</b><p class="plans-pre">${esc(notes)}</p></div>` : '',
    bottomHtml: `${sourcesHtml(template)}`,
  });
}

// ---------- Scenario ----------
async function renderScenario(st, id) {
  const index = await tpl('scenarios/index');
  const entry = (index || []).find((s) => s.id === id);
  if (!entry) {
    st.root.innerHTML = `${back('#/plans', 'Plans')}<div class="card empty"><p><b>That checklist was not found.</b></p><a class="btn" href="#/plans">Back to Plans</a></div>`;
    return;
  }
  const [template, run] = await Promise.all([tpl(`scenarios/${id}`), loadRun(`scenario:${id}`), loadGuideTitles()]);
  if (S !== st) return;
  if (!template) { missing(st.root, '#/plans', 'Plans', entry.title, 'This checklist'); return; }
  const guides = (template.guides || []).filter((g) => /^[a-z0-9-]+$/i.test(g));
  const chips = guides.length ? `<div class="plans-chips"><div class="plans-chiplabel">Guides</div>${guides.map((g) => `<a class="plans-chip" href="#/guide/${esc(g)}">📖 ${esc(guideTitles[g] || g)}</a>`).join('')}</div>` : '';
  const grams = id === GRAMS
    ? '<div class="plans-bigbtns"><a class="btn primary big" href="#/plans/loadout">🎒 Start packing</a><a class="btn big" href="#/plans/arrival">📍 We\'re here</a></div>' : '';
  startChecklist(st, {
    kind: 'scenario', runId: `scenario:${id}`, run, field: 'section', word: 'Done',
    build: (r, showHidden) => P.buildSections(template.phases || [], r, { showHidden }),
    backHref: '#/plans', backText: 'Plans',
    title: `${esc(entry.icon || '')} ${esc(template.title || entry.title)}`,
    subtitle: esc(template.summary || entry.summary || ''),
    topHtml: grams,
    bottomHtml: `${chips}${sourcesHtml(template)}${disclaimerHtml()}`,
  });
}

// ---------- Go-bag ----------
async function renderGobag(st, rest) {
  const isPet = rest.startsWith('pet-');
  const id = isPet ? rest.slice(4) : rest;
  const [who, template, run] = await Promise.all([get(isPet ? 'pets' : 'people', id), tpl('gobag'), loadRun(`gobag:${isPet ? 'pet-' : ''}${id}`), loadGuideTitles()]);
  if (S !== st) return;
  if (!who) { st.root.innerHTML = `${back('#/plans', 'Plans')}<div class="card empty"><p><b>That ${isPet ? 'pet' : 'person'} no longer exists.</b></p></div>`; return; }
  if (!template) { missing(st.root, '#/plans', 'Plans', `${who.name}'s go-bag`, 'The go-bag list'); return; }
  const sections = P.gobagFor(who, template, isPet);
  startChecklist(st, {
    kind: 'gobag', run, field: 'section', word: 'Packed',
    build: (r, showHidden) => P.buildSections(sections, r, { showHidden }),
    backHref: '#/plans', backText: 'Plans',
    title: `${isPet ? '🐾' : '🎒'} ${esc(who.name)}'s go-bag`,
    subtitle: isPet ? 'A grab-and-go kit for this pet.' : `${who.t1d ? 'Includes the Type 1 diabetes kit. ' : ''}A bag that is ready before you need it.`,
    bottomHtml: sourcesHtml(template),
  });
}

// ---------- Hub ----------
const row = (href, icon, title, sub, badge = '') => `<a class="card row-link big-row" href="${href}">
  <span class="emoji" aria-hidden="true">${icon}</span>
  <span class="grow"><span class="row-title">${title}</span>${sub ? `<span class="muted small block">${sub}</span>` : ''}</span>${badge}
  <span class="chev" aria-hidden="true">›</span></a>`;

async function renderHub(st) {
  const [index, loadout, arrival, gobag, items, people, pets, pins, settings, runs, contacts] = await Promise.all([
    tpl('scenarios/index'), tpl('loadout'), tpl('arrival'), tpl('gobag'), getAll('items'), getAll('people'), getAll('pets'),
    getAll('pins'), getSettings(), loadRuns(), getAll('contacts'),
  ]);
  if (S !== st) return;
  const plan = P.normalizeGoPlan(settings.goPlan);
  const today = todayStr();
  const pLoad = loadout ? P.progress(P.buildLoadout(loadout, items, runs.loadout, people, { today })) : null;
  const pArr = arrival ? P.progress(P.buildSections(arrival.sections, runs.arrival), { skipDaily: true }) : null;
  const home = pins.find((p) => p.type === 'home' && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const dpin = plan.destination.pinId ? pins.find((p) => p.id === plan.destination.pinId) : null;
  const dist = home && dpin ? distanceFrom(home, dpin) : '';
  const name = esc(plan.destination.name);
  const prog = (label, p, word) => (p ? `<div class="plans-hprog"><div class="plans-hprog-top"><span>${label}</span><b>${p.done} / ${p.total} ${word}</b></div>${meter(p.pct)}</div>` : '');

  const hero = `<section class="plans-hero">
    <div class="plans-hero-title"><span aria-hidden="true">🚗</span> Go to ${name}</div>
    ${plan.destination.address.trim() ? `<div class="plans-hero-sub">${esc(plan.destination.address.trim())}</div>` : ''}
    ${dist && dist !== '—' ? `<div class="plans-hero-sub">${dpin ? `${pinEmoji(dpin.type)} ` : ''}≈ ${esc(dist)} from home</div>` : ''}
    <div class="plans-hprogs">${prog('Load-out', pLoad, 'packed')}${prog('Arrival', pArr, 'done')}</div>
    <div class="plans-hero-btns">
      <a class="btn primary big" href="#/plans/loadout">🎒 Start packing</a>
      <a class="btn big" href="#/plans/arrival">📍 We're here</a>
      <a class="btn" href="#/plans/go">The plan</a>
    </div></section>`;

  const scenarios = (index || []).map((s) => {
    const r = runs[`scenario:${s.id}`];
    const n = r ? Object.keys(r.checked || {}).length : 0;
    return row(`#/plans/${esc(s.id)}`, esc(s.icon || '📋'), esc(s.title), esc(s.summary || ''), n ? `<span class="badge">${n} checked</span>` : '');
  }).join('');

  const bagProg = (key, who, isPet) => {
    if (!gobag) return '';
    const p = P.progress(P.buildSections(P.gobagFor(who, gobag, isPet), runs[key]));
    return p.total ? `<span class="badge${p.done === p.total ? '' : ' amber'}">${p.done} / ${p.total}</span>` : '';
  };
  const bags = [
    ...people.map((p) => row(`#/plans/gobag-${esc(p.id)}`, '🎒', esc(p.name), p.t1d ? 'Includes the Type 1 diabetes kit' : 'Go-bag checklist', bagProg(`gobag:${p.id}`, p, false))),
    ...pets.map((p) => row(`#/plans/gobag-pet-${esc(p.id)}`, '🐾', esc(p.name), esc(p.species || 'Pet'), bagProg(`gobag:pet-${p.id}`, p, true))),
  ].join('') || '<div class="card empty"><p class="muted">Add people and pets in <a href="#/household">Household</a> to get a go-bag checklist for each.</p></div>';

  const ooa = contacts.find((c) => c.outOfArea);
  st.root.innerHTML = `
    ${back('#/more', 'More')}
    <h1>Plans &amp; Checklists</h1>
    ${hero}
    <h2 class="plans-h">Scenarios</h2>
    ${scenarios || '<div class="card empty"><p class="muted">Scenario checklists are not downloaded yet.</p></div>'}
    <h2 class="plans-h">Go-bags</h2>
    ${bags}
    <h2 class="plans-h">People to reach</h2>
    ${row('#/plans/contacts', '📞', 'Emergency contacts', ooa ? `Out-of-area: ${esc(ooa.name)}` : 'Add an out-of-area contact', `<span class="badge">${contacts.length}</span>`)}
    ${row('#/print', '🖨️', 'Print binder', 'Paper backup for when the phone is dead')}`;
}

// ---------- The Go plan ----------
async function copyText(text, title) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    toast('Plan copied. Paste it into a text message.');
  } catch {
    const sheet = openSheet(`<h2>${esc(title)}</h2><p class="muted small">Press and hold in the box, choose Select all, then Copy.</p>
      <textarea class="plans-copybox" readonly rows="10" aria-label="Plan as text">${esc(text)}</textarea>
      <div class="btn-row"><button type="button" class="btn primary" data-sheet="close">Done</button></div>`);
    const ta = sheet.el.querySelector('textarea');
    if (ta) { ta.focus(); ta.select(); }
  }
}

function pinName(pins, id) {
  const p = pins.find((x) => x.id === id);
  return p ? `${pinEmoji(p.type)} ${p.name}` : '';
}

function paceSummary(settings) {
  const raw = settings.pacePlan;
  if (!raw || planIsEmpty(raw)) {
    return '<div class="card"><h3 class="plans-h3">Family PACE plan</h3><p class="muted">No family contact plan yet.</p><a class="btn small" href="#/comms">Set it up in Comms ›</a></div>';
  }
  const p = normalizePlan(raw);
  const rows = PACE_TIERS.map((t) => {
    const { method, details } = p.tiers[t.key];
    return `<div class="plans-pace"><span class="plans-pace-k">${esc(t.key)}</span><span>${method ? `<b>${esc(method)}</b>` : '<span class="muted">Not set</span>'}${details.trim() ? ` · ${esc(details)}` : ''}</span></div>`;
  }).join('');
  const o = p.outOfAreaContact;
  return `<div class="card"><h3 class="plans-h3">Family PACE plan</h3>${rows}
    ${o.name.trim() ? `<p class="plans-pace-ooa"><span class="muted">Out-of-area contact:</span> <b>${esc(o.name)}</b>${o.details.trim() ? ` · ${esc(o.details)}` : ''}</p>` : ''}
    <a class="btn small" href="#/comms">Open Comms → Our plan ›</a></div>`;
}

function goViewHtml() {
  const { plan, people, pins, settings } = S;
  const d = plan.destination;
  const home = pins.find((p) => p.type === 'home' && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const dpin = d.pinId ? pins.find((p) => p.id === d.pinId) : null;
  const dist = home && dpin ? distanceFrom(home, dpin) : '';
  const personName = (id) => (people.find((p) => p.id === id) || {}).name || 'Someone';
  const routes = plan.routes.filter((r) => r.text.trim());
  const triggers = plan.triggers.filter((t) => t.trim());
  const jobs = plan.assignments.filter((a) => a.task.trim());
  const fb = plan.fallback;
  const empty = P.goPlanIsEmpty(settings.goPlan);
  return `
    ${back('#/plans', 'Plans')}
    <h1>The plan: ${esc(d.name)}</h1>
    ${empty ? '<div class="card plans-empty"><p><b>Nothing written down yet.</b></p><p class="muted">Fill in the address, the route and who does what while everything still works.</p></div>' : ''}
    <div class="card"><h3 class="plans-h3">Destination</h3>
      <p class="plans-big">${esc(d.name)}</p>
      ${d.address.trim() ? `<p class="plans-pre">${esc(d.address)}</p>` : '<p class="muted">No address saved yet.</p>'}
      ${dpin ? `<p>${esc(pinName(pins, d.pinId))}${dist && dist !== '—' ? ` <span class="muted">· ≈ ${esc(dist)} from home</span>` : ''} <a href="#/map">Map ›</a></p>` : ''}
      ${d.notes.trim() ? `<p class="plans-pre">${esc(d.notes)}</p>` : ''}</div>
    ${(fb.name.trim() || fb.notes.trim() || fb.pinId) ? `<div class="card"><h3 class="plans-h3">If we can't get there</h3>
      <p class="plans-big">${esc(fb.name || pinName(pins, fb.pinId))}</p>${fb.pinId && fb.name.trim() ? `<p>${esc(pinName(pins, fb.pinId))}</p>` : ''}
      ${fb.notes.trim() ? `<p class="plans-pre">${esc(fb.notes)}</p>` : ''}</div>` : ''}
    ${routes.length ? `<div class="card"><h3 class="plans-h3">Routes</h3>${routes.map((r) => `<p class="plans-item"><b>${esc(r.label || 'Route')}</b><br><span class="plans-pre">${esc(r.text)}</span></p>`).join('')}</div>` : ''}
    ${triggers.length ? `<div class="card"><h3 class="plans-h3">We go when…</h3><ul class="plans-list">${triggers.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${jobs.length ? `<div class="card"><h3 class="plans-h3">Who does what</h3>${jobs.map((a) => `<p class="plans-item"><b>${esc(personName(a.personId))}</b> · ${esc(a.task)}</p>`).join('')}</div>` : ''}
    ${(plan.vehicle.trim() || plan.leaveNote.trim()) ? `<div class="card">
      ${plan.vehicle.trim() ? `<h3 class="plans-h3">Vehicle</h3><p class="plans-pre">${esc(plan.vehicle)}</p>` : ''}
      ${plan.leaveNote.trim() ? `<h3 class="plans-h3">Note to leave behind</h3><p class="plans-pre">${esc(plan.leaveNote)}</p>` : ''}</div>` : ''}
    ${paceSummary(settings)}
    <div class="btn-row"><button type="button" class="btn primary" data-act="go-edit">${empty ? 'Fill in the plan' : 'Edit plan'}</button>
      <button type="button" class="btn" data-act="go-copy">Copy as text</button></div>
    <div class="plans-links"><a class="btn" href="#/plans/${GRAMS}">Decision checklist ›</a><a class="btn" href="#/plans/loadout">Pack ›</a></div>`;
}

function pinOptions(pins, sel) {
  return `<option value="">No map pin</option>${pins.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(pinEmoji(p.type))} ${esc(p.name)}</option>`).join('')}`;
}

function goFormHtml() {
  const d = S.draft;
  const { pins, people } = S;
  const pinHint = pins.length ? '' : '<small class="hint">No pins yet. Drop one on the <a href="#/map">Map</a>, then pick it here.</small>';
  const routes = d.routes.map((r, i) => `<div class="plans-edrow">
      <input type="text" data-f="r-label" data-i="${i}" value="${esc(r.label)}" maxlength="40" placeholder="Name" aria-label="Route ${i + 1} name" autocomplete="off">
      <button type="button" class="btn plans-x" data-act="r-del" data-i="${i}" aria-label="Remove route ${i + 1}">✕</button>
      <textarea data-f="r-text" data-i="${i}" rows="2" maxlength="600" placeholder="Roads, turns, landmarks…" aria-label="Route ${i + 1} directions">${esc(r.text)}</textarea></div>`).join('');
  const trig = d.triggers.map((t, i) => `<div class="plans-edrow plans-edrow-1">
      <input type="text" data-f="t-text" data-i="${i}" value="${esc(t)}" maxlength="200" placeholder="e.g. An official evacuation order" aria-label="Trigger ${i + 1}" autocomplete="off">
      <button type="button" class="btn plans-x" data-act="t-del" data-i="${i}" aria-label="Remove trigger ${i + 1}">✕</button></div>`).join('');
  const jobs = d.assignments.map((a, i) => `<div class="plans-edrow">
      <select data-f="a-person" data-i="${i}" aria-label="Person ${i + 1}"><option value="">Choose a person</option>${people.map((p) => `<option value="${esc(p.id)}"${p.id === a.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <button type="button" class="btn plans-x" data-act="a-del" data-i="${i}" aria-label="Remove row ${i + 1}">✕</button>
      <input type="text" data-f="a-task" data-i="${i}" value="${esc(a.task)}" maxlength="200" placeholder="e.g. Insulin and T1D kit" aria-label="Task ${i + 1}" autocomplete="off"></div>`).join('');
  return `
    <a class="back" href="#/plans/go" data-act="go-cancel">← Cancel</a>
    <h1>Edit the plan</h1>
    <p class="muted">Everything here stays on this phone. Nothing is saved until you tap Save.</p>
    <div class="card"><h3 class="plans-h3">Destination</h3>
      <label class="field"><span>Name</span><input type="text" data-f="d-name" value="${esc(d.destination.name)}" maxlength="80" autocomplete="off"></label>
      <label class="field"><span>Map pin</span><select data-f="d-pin">${pinOptions(pins, d.destination.pinId)}</select>${pinHint}</label>
      <label class="field"><span>Address</span><textarea data-f="d-address" rows="2" maxlength="300" autocomplete="off">${esc(d.destination.address)}</textarea></label>
      <label class="field"><span>Good to know</span><textarea data-f="d-notes" rows="3" maxlength="600" placeholder="e.g. well water, gas stove, where the spare key is">${esc(d.destination.notes)}</textarea></label></div>
    <div class="card"><h3 class="plans-h3">If we can't get there</h3>
      <label class="field"><span>Name</span><input type="text" data-f="f-name" value="${esc(d.fallback.name)}" maxlength="80" autocomplete="off"></label>
      <label class="field"><span>Map pin</span><select data-f="f-pin">${pinOptions(pins, d.fallback.pinId)}</select></label>
      <label class="field"><span>Notes</span><textarea data-f="f-notes" rows="2" maxlength="400">${esc(d.fallback.notes)}</textarea></label></div>
    <div class="card"><h3 class="plans-h3">Routes</h3>${routes || '<p class="muted small">None yet.</p>'}
      <button type="button" class="btn small" data-act="r-add">＋ Add a route</button></div>
    <div class="card"><h3 class="plans-h3">We go when…</h3>
      <p class="muted small">Your own rules for when it is time to leave.</p>${trig || '<p class="muted small">None yet.</p>'}
      <div class="plans-btnline"><button type="button" class="btn small" data-act="t-add">＋ Add a trigger</button>
      <button type="button" class="btn small" data-act="t-examples">Start from examples</button></div></div>
    <div class="card"><h3 class="plans-h3">Who does what</h3>${jobs || '<p class="muted small">None yet.</p>'}
      <button type="button" class="btn small" data-act="a-add">＋ Add a row</button></div>
    <div class="card">
      <label class="field"><span>Vehicle notes</span><textarea data-f="vehicle" rows="2" maxlength="400" placeholder="Which car, gas level, who drives">${esc(d.vehicle)}</textarea></label>
      <label class="field"><span>Note to leave behind</span><textarea data-f="leaveNote" rows="3" maxlength="600" placeholder="Where we went and when">${esc(d.leaveNote)}</textarea></label></div>
    <div class="btn-row"><button type="button" class="btn primary" data-act="go-save">Save plan</button><button type="button" class="btn" data-act="go-cancel">Cancel</button></div>`;
}

function readGoDraft() {
  const r = S.root;
  const val = (sel) => { const el = r.querySelector(sel); return el ? el.value : ''; };
  S.draft = {
    destination: { name: val('[data-f="d-name"]'), pinId: val('[data-f="d-pin"]') || null, address: val('[data-f="d-address"]'), notes: val('[data-f="d-notes"]') },
    fallback: { name: val('[data-f="f-name"]'), pinId: val('[data-f="f-pin"]') || null, notes: val('[data-f="f-notes"]') },
    routes: [...r.querySelectorAll('[data-f="r-label"]')].map((el) => ({ label: el.value, text: val(`[data-f="r-text"][data-i="${el.dataset.i}"]`) })),
    triggers: [...r.querySelectorAll('[data-f="t-text"]')].map((el) => el.value),
    assignments: [...r.querySelectorAll('[data-f="a-person"]')].map((el) => ({ personId: el.value, task: val(`[data-f="a-task"][data-i="${el.dataset.i}"]`) })),
    vehicle: val('[data-f="vehicle"]'), leaveNote: val('[data-f="leaveNote"]'), updatedAt: 0,
  };
}

function paintGo() {
  S.root.innerHTML = S.editing ? goFormHtml() : goViewHtml();
  window.scrollTo(0, 0);
}

async function saveGo() {
  readGoDraft();
  const plan = P.normalizeGoPlan(S.draft);
  plan.routes = plan.routes.filter((r) => r.label.trim() || r.text.trim());
  plan.triggers = plan.triggers.map((t) => t.trim()).filter(Boolean);
  plan.assignments = plan.assignments.filter((a) => a.personId || a.task.trim());
  plan.updatedAt = Date.now();
  await saveSettings({ goPlan: plan });
  S.settings.goPlan = plan;
  S.plan = P.normalizeGoPlan(plan);
  S.editing = false; S.draft = null;
  toast('Plan saved');
  paintGo();
}

async function triggerExamples() {
  const tplData = await tpl(`scenarios/${GRAMS}`);
  if (!S) return;
  const phases = (tplData && tplData.phases) || [];
  const phase = phases.find((p) => p.id === 'when-we-go') || phases.find((p) => /^(when|triggers?)$/i.test(p.id)) || phases.find((p) => /when we go/i.test(p.title || '')) || phases[0];
  const items = (phase && phase.items) || [];
  const trig = items.filter((i) => /^trigger-/.test(i.id || ''));
  const lines = (trig.length ? trig : items).map((i) => P.stripBold(i.text)).filter(Boolean);
  if (!lines.length) { toast('The examples are not downloaded yet'); return; }
  readGoDraft();
  const have = new Set(S.draft.triggers.map((t) => t.trim()).filter(Boolean));
  S.draft.triggers = [...S.draft.triggers.filter((t) => t.trim()), ...lines.filter((l) => !have.has(l))];
  paintGo();
}

async function renderGo(st) {
  const [settings, people, pins] = await Promise.all([getSettings(), getAll('people'), getAll('pins')]);
  if (S !== st) return;
  Object.assign(st, { settings, people, pins, plan: P.normalizeGoPlan(settings.goPlan), editing: false, draft: null });
  paintGo();
}

// ---------- Contacts ----------
function contactsHtml() {
  const list = P.sortContacts(S.contacts);
  const card = (c, i) => {
    const sameGroup = (n) => list[n] && !!list[n].outOfArea === !!c.outOfArea;
    return `<div class="card plans-contact${c.outOfArea ? ' plans-ooa' : ''}">
      <div class="plans-c-top"><span class="plans-big">${esc(c.name || 'Unnamed')}</span>
        ${c.relation ? `<span class="badge">${esc(c.relation)}</span>` : ''}${c.outOfArea ? '<span class="badge amber">Out-of-area</span>' : ''}</div>
      ${(c.phones || []).map((p) => {
        const href = telHref(p.number);
        return href ? `<a class="btn plans-tel" href="${esc(href)}"><span class="muted">${esc(p.label)}</span> 📞 ${esc(p.number)}</a>` : `<p class="plans-item"><span class="muted">${esc(p.label)}</span> ${esc(p.number)}</p>`;
      }).join('')}
      ${c.notes && c.notes.trim() ? `<p class="plans-pre">${esc(c.notes)}</p>` : ''}
      <div class="plans-c-btns">
        <button type="button" class="btn small" data-act="c-up" data-id="${esc(c.id)}" aria-label="Move ${esc(c.name)} up"${sameGroup(i - 1) ? '' : ' disabled'}>↑</button>
        <button type="button" class="btn small" data-act="c-down" data-id="${esc(c.id)}" aria-label="Move ${esc(c.name)} down"${sameGroup(i + 1) ? '' : ' disabled'}>↓</button>
        <button type="button" class="btn small grow" data-act="c-edit" data-id="${esc(c.id)}">Edit</button></div></div>`;
  };
  return `
    ${back('#/plans', 'Plans')}
    <h1>Emergency contacts</h1>
    <p class="muted">Typed in by you and kept on this phone only. Pick one person outside the area that everyone can call or text to check in.</p>
    ${list.length ? list.map(card).join('') : '<div class="card empty"><div class="empty-icon" aria-hidden="true">📞</div><p><b>No contacts yet.</b></p><p class="muted">Start with an out-of-area contact.</p></div>'}
    <button type="button" class="btn primary big plans-wide" data-act="c-add">＋ Add a contact</button>`;
}

const phoneRowHtml = (p, i) => `<div class="plans-phone"><input type="text" class="pc-label" value="${esc(p.label)}" maxlength="20" placeholder="Label" aria-label="Phone ${i + 1} label" autocomplete="off">
  <input type="tel" class="pc-number" value="${esc(p.number)}" maxlength="40" placeholder="Number" inputmode="tel" aria-label="Phone ${i + 1} number" autocomplete="off">
  <button type="button" class="btn plans-x" data-sheet="rmphone" data-i="${i}" aria-label="Remove phone ${i + 1}">✕</button></div>`;

function contactSheet(existing) {
  const c = existing ? P.normalizeContact(existing) : { name: '', relation: '', phones: [{ label: 'Cell', number: '' }], notes: '', outOfArea: !S.contacts.some((x) => x.outOfArea) };
  if (!c.phones.length) c.phones = [{ label: 'Cell', number: '' }];
  let armed = false;
  const sh = openSheet(`<h2>${existing ? 'Edit contact' : 'Add a contact'}</h2>
    <label class="field"><span>Name</span><input type="text" id="pc-name" value="${esc(c.name)}" maxlength="80" autocomplete="off" autocapitalize="words"></label>
    <label class="field"><span>Who are they to you?</span><input type="text" id="pc-rel" value="${esc(c.relation)}" maxlength="40" placeholder="e.g. Aunt, neighbor" autocomplete="off"></label>
    <div id="pc-phones">${c.phones.map(phoneRowHtml).join('')}</div>
    <button type="button" class="btn small" data-sheet="addphone">＋ Add a phone</button>
    <label class="field check"><input type="checkbox" id="pc-ooa"${c.outOfArea ? ' checked' : ''}><span>Out-of-area contact</span></label>
    <label class="field"><span>Notes</span><textarea id="pc-notes" rows="2" maxlength="400">${esc(c.notes)}</textarea></label>
    <p class="error" id="pc-err" role="alert" hidden></p>
    <div class="btn-row"><button type="button" class="btn primary" data-sheet="save">Save</button>
      ${existing ? '<button type="button" class="btn danger" data-sheet="delete">Delete</button>' : ''}
      <button type="button" class="btn" data-sheet="close">Cancel</button></div>`, {
    async onAction(name, close, btn) {
      const q = (s) => sh.el.querySelector(s);
      const phones = () => [...sh.el.querySelectorAll('.plans-phone')].map((r) => ({ label: r.querySelector('.pc-label').value, number: r.querySelector('.pc-number').value }));
      const repaint = (list) => { q('#pc-phones').innerHTML = list.map(phoneRowHtml).join(''); };
      if (name === 'addphone') { const l = phones(); l.push({ label: '', number: '' }); repaint(l); return; }
      if (name === 'rmphone') { const l = phones(); l.splice(Number(btn.dataset.i), 1); repaint(l.length ? l : [{ label: 'Cell', number: '' }]); return; }
      if (name === 'delete') {
        if (!armed) { armed = true; btn.textContent = 'Tap again to delete'; return; }
        await del('contacts', existing.id);
        S.contacts = S.contacts.filter((x) => x.id !== existing.id);
        close(); paintContacts(); toast('Contact deleted');
        return;
      }
      if (name === 'save') {
        const rec = P.normalizeContact({
          ...(existing || {}), id: existing ? existing.id : newId(), name: q('#pc-name').value, relation: q('#pc-rel').value,
          phones: phones(), notes: q('#pc-notes').value, outOfArea: q('#pc-ooa').checked,
          order: existing ? existing.order : S.contacts.reduce((m, x) => Math.max(m, Number(x.order) || 0), -1) + 1,
        });
        if (!rec.name) { const e = q('#pc-err'); e.textContent = 'Please enter a name.'; e.hidden = false; q('#pc-name').focus(); return; }
        const saved = await put('contacts', rec);
        S.contacts = [...S.contacts.filter((x) => x.id !== saved.id), saved];
        close(); paintContacts(); toast('Contact saved');
      }
    },
  });
}

function paintContacts() {
  S.root.innerHTML = contactsHtml();
}

async function moveContact(id, dir) {
  const changed = P.moveContact(S.contacts, id, dir);
  if (!changed.length) return;
  for (const c of changed) await put('contacts', c);
  S.contacts = S.contacts.map((c) => changed.find((x) => x.id === c.id) || c);
  paintContacts();
}

// ---------- events ----------
async function onClick(e) {
  if (!S) return;
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const i = el.dataset.i != null ? Number(el.dataset.i) : null;
  if (S.V) {
    switch (act) {
      case 'tick': tick(el.dataset.key); return;
      case 'more': moreSheet(el.dataset.key); return;
      case 'unhide': commit(P.unhideLine(S.V.run, el.dataset.key, Date.now())); paintList(); return;
      case 'addline': addLineSheet(el.dataset.group); return;
      case 'reset': resetSheet(); return;
      case 'showhidden': S.V.showHidden = !S.V.showHidden; paintList(); return;
      case 'hidepacked': {
        const on = el.getAttribute('aria-pressed') !== 'true';
        el.setAttribute('aria-pressed', String(on));
        S.root.classList.toggle('plans-hidepacked', on);
        S.root.querySelectorAll('.plans-fresh').forEach((x) => x.classList.remove('plans-fresh'));
        return;
      }
      case 'gtoggle': {
        const id = el.dataset.group;
        const sec = el.closest('.plans-group');
        const nowCollapsed = !sec.classList.contains('plans-collapsed');
        sec.classList.toggle('plans-collapsed', nowCollapsed);
        el.setAttribute('aria-expanded', String(!nowCollapsed));
        if (nowCollapsed) S.collapsed.add(id); else { S.collapsed.delete(id); S.userOpened.add(id); }
        return;
      }
      default: return;
    }
  }
  if (S.mode === 'go') {
    switch (act) {
      case 'go-edit': S.draft = P.normalizeGoPlan(S.plan); S.editing = true; paintGo(); break;
      case 'go-cancel': e.preventDefault(); S.editing = false; S.draft = null; paintGo(); break;
      case 'go-save': await saveGo(); break;
      case 'go-copy': await copyText(P.goPlanText(S.plan, S.people, S.pins), 'Copy the plan'); break;
      case 'r-add': readGoDraft(); S.draft.routes.push({ label: '', text: '' }); paintGo(); break;
      case 'r-del': readGoDraft(); S.draft.routes.splice(i, 1); paintGo(); break;
      case 't-add': readGoDraft(); S.draft.triggers.push(''); paintGo(); break;
      case 't-del': readGoDraft(); S.draft.triggers.splice(i, 1); paintGo(); break;
      case 't-examples': await triggerExamples(); break;
      case 'a-add': readGoDraft(); S.draft.assignments.push({ personId: '', task: '' }); paintGo(); break;
      case 'a-del': readGoDraft(); S.draft.assignments.splice(i, 1); paintGo(); break;
      default: break;
    }
    return;
  }
  if (S.mode === 'contacts') {
    const c = S.contacts.find((x) => x.id === el.dataset.id);
    switch (act) {
      case 'c-add': contactSheet(null); break;
      case 'c-edit': if (c) contactSheet(c); break;
      case 'c-up': await moveContact(el.dataset.id, -1); break;
      case 'c-down': await moveContact(el.dataset.id, 1); break;
      default: break;
    }
  }
}

// ---------- entry points ----------
export async function render(container, params) {
  ensureListeners();
  await loadCss('css/plans.css');
  const st = { root: container, mode: 'hub', V: null, collapsed: new Set(), userOpened: new Set() };
  S = st;
  container.classList.add('plans-view');
  container.addEventListener('click', onClick);
  const id = params && params.name === 'plan' ? params.id : null;
  try {
    if (!id) { st.mode = 'hub'; await renderHub(st); return; }
    if (id === 'loadout') { st.mode = 'loadout'; await renderLoadout(st); return; }
    if (id === 'arrival') { st.mode = 'arrival'; await renderArrival(st); return; }
    if (id === 'go') { st.mode = 'go'; await renderGo(st); return; }
    if (id === 'contacts') {
      st.mode = 'contacts';
      const contacts = await getAll('contacts');
      if (S !== st) return;
      st.contacts = contacts;
      paintContacts();
      return;
    }
    if (id.startsWith('gobag-')) { st.mode = 'gobag'; await renderGobag(st, id.slice(6)); return; }
    st.mode = 'scenario';
    await renderScenario(st, id);
  } catch (err) {
    console.error(err);
    container.innerHTML = `${back('#/plans', 'Plans')}<div class="card empty"><p><b>Something went wrong.</b></p><p class="muted">${esc(err && err.message ? err.message : err)}</p></div>`;
  }
}

export function destroy() {
  if (S) S.root.removeEventListener('click', onClick);
  S = null;
  flush(); // never lose a check mark that is still waiting for its 300 ms
}
