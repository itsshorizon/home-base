// Print binder (#/print, #/print/card). The paper backup for when the phone is dead.
// This file loads the data and draws the picker. Every piece of HTML that goes on paper is built in js/print.js
// (pure functions, tested in tests/print.test.js), and all user text in it is escaped there.
import { getAll, getSettings } from '../db.js';
import { esc, toISODate } from '../format.js';
import { loadIndex, loadGuide, sortGuides, GUIDE_CATEGORIES } from '../guides.js';
import {
  SECTION_DEFS, defaultSelection, normalizeSelection, buildDocument, estimatePages, buildWalletCards,
} from '../print.js';

const LS_SEL = 'hb_printSel';
const PLANS_DIR = 'data/plans';
const NOTE = 'On iPhone: if nothing happens, open the app in Safari, then Share → Print, and pinch out on the preview to save a PDF. Print it on Wi-Fi now. Keep the paper copy with the go-bags.';

let S = null; // per-visit state; destroy() clears it
let cssLoaded = false;

export function destroy() {
  document.body.classList.remove('print-active');
  S = null;
}

function loadCss(href) {
  if (cssLoaded || document.querySelector(`link[data-print-css="${href}"]`)) { cssLoaded = true; return Promise.resolve(); }
  cssLoaded = true;
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.printCss = href;
    l.onload = () => resolve(); l.onerror = () => resolve();
    document.head.appendChild(l);
    setTimeout(resolve, 1500); // never block the screen on a slow stylesheet
  });
}

// JSON that may not exist yet (the plan templates are added in Phase 6) or may be offline-missing: null, never an error.
async function getJson(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function readSel() {
  try { return normalizeSelection(JSON.parse(localStorage.getItem(LS_SEL))); } catch { return defaultSelection(); }
}
function saveSel(sel) {
  try { localStorage.setItem(LS_SEL, JSON.stringify(sel)); } catch { /* private mode: the choices last for this visit */ }
}

async function loadData() {
  const [people, pets, items, pins, contacts, checklists, settings] = await Promise.all([
    getAll('people'), getAll('pets'), getAll('items'), getAll('pins'), getAll('contacts'), getAll('checklists'), getSettings(),
  ]);
  const runs = {};
  for (const r of checklists) if (r && r.id) runs[r.id] = r;
  const [comms, loadoutTpl, arrivalTpl, gobagTpl, scenarioIndex, guideIndex] = await Promise.all([
    getJson('data/comms.json'), getJson(`${PLANS_DIR}/loadout.json`), getJson(`${PLANS_DIR}/arrival.json`), getJson(`${PLANS_DIR}/gobag.json`),
    getJson(`${PLANS_DIR}/scenarios/index.json`), loadIndex(),
  ]);
  const idx = Array.isArray(scenarioIndex) ? scenarioIndex.filter((x) => x && /^[a-z0-9-]+$/i.test(String(x.id))) : [];
  const scenarios = {};
  await Promise.all(idx.map(async (x) => { const t = await getJson(`${PLANS_DIR}/scenarios/${x.id}.json`); if (t) scenarios[x.id] = t; }));
  return {
    today: toISODate(new Date()),
    goPlan: settings.goPlan || null, pacePlan: settings.pacePlan || null, meshNodes: settings.meshNodes || [],
    people, pets, items, pins, contacts, runs, comms, loadoutTpl, arrivalTpl, gobagTpl, scenarioIndex: idx, scenarios,
    guideIndex: guideIndex || null, guides: {},
  };
}

// Guide bodies are fetched only when needed (emergency guides and the ones ticked).
async function ensureGuides(ids) {
  const st = S;
  if (!st) return;
  await Promise.all(ids.filter((id) => !(id in st.data.guides)).map(async (id) => {
    const g = await loadGuide(id);
    if (g) st.data.guides[id] = g; // loadGuide returns null for a guide that is not downloaded: it is reported as left out
  }));
}
const neededGuideIds = () => {
  const idx = (S.data.guideIndex && S.data.guideIndex.guides) || [];
  const ids = [];
  if (S.sel.sections.emergency) ids.push(...idx.filter((g) => g.emergency).map((g) => g.id));
  if (S.sel.sections.guides) ids.push(...S.sel.guides);
  return [...new Set(ids)];
};

// ---------- render ----------
export async function render(container, params) {
  document.body.classList.add('print-active');
  await loadCss('css/print.css');
  S = { container, data: await loadData(), sel: readSel() };
  if (params && params.name === 'printpart' && params.id === 'card') return renderCard();
  return renderPicker();
}

const optHtml = (attrs, title, hint, checked) => `<label class="print-opt"><input type="checkbox" ${attrs}${checked ? ' checked' : ''}>
  <span class="print-opt-text"><span class="print-opt-title">${esc(title)}</span>${hint ? `<span class="print-opt-hint">${esc(hint)}</span>` : ''}</span></label>`;

function subHtml(key) {
  const d = S.data;
  if (key === 'scenarios') {
    if (!d.scenarioIndex.length) return '<p class="print-opt-hint">The scenario checklists are not on this phone yet.</p>';
    return d.scenarioIndex.map((x) => optHtml(`data-scenario="${esc(x.id)}"`, `${x.icon ? `${x.icon} ` : ''}${x.title}`, '', S.sel.scenarios.includes(x.id))).join('');
  }
  if (key === 'guides') {
    const idx = sortGuides(((d.guideIndex && d.guideIndex.guides) || []).filter((g) => !g.emergency || !S.sel.sections.emergency));
    if (!idx.length) return '<p class="print-opt-hint">The guide list is not on this phone yet.</p>';
    return GUIDE_CATEGORIES.map((c) => {
      const list = idx.filter((g) => g.category === c.key);
      if (!list.length) return '';
      const n = list.filter((g) => S.sel.guides.includes(g.id)).length;
      return `<details class="print-sub-group"><summary>${esc(c.icon)} ${esc(c.label)}${n ? ` (${n})` : ''}</summary>${list.map((g) => optHtml(`data-guide="${esc(g.id)}"`, g.title, '', S.sel.guides.includes(g.id))).join('')}</details>`;
    }).join('');
  }
  return '';
}

function renderPicker() {
  const rows = SECTION_DEFS.map((def) => {
    const on = !!S.sel.sections[def.key];
    const sub = (def.key === 'scenarios' || def.key === 'guides') && on ? `<div class="print-sub" data-sub="${def.key}">${subHtml(def.key)}</div>` : '';
    return optHtml(`data-sec="${def.key}"`, def.label, def.hint, on) + sub;
  }).join('');
  S.container.innerHTML = `
    <div class="print-controls">
      <a class="back" href="#/more">← More</a>
      <h1>Print binder</h1>
      <p class="muted">A paper copy for when the phone is dead. Pick what goes in, look at the preview, then print or save a PDF.</p>
      <div class="card print-picker" id="print-picker">${rows}</div>
      <a class="card row-link" href="#/print/card"><span class="grow"><span class="row-title">🪪 Wallet card</span><span class="muted small block">Fold-over card with the meeting place, contacts and radio</span></span><span class="chev" aria-hidden="true">›</span></a>
      <div class="print-bar">
        <span class="print-pages" id="print-pages" aria-live="polite"></span>
        <button type="button" class="btn big" id="print-preview-btn">Preview</button>
        <button type="button" class="btn primary big" id="print-go">Print / Save as PDF</button>
      </div>
      <p class="print-note" id="print-note">${esc(NOTE)}</p>
      <div id="print-skipped"></div>
    </div>
    <div class="print-preview" id="print-preview"></div>`;

  const q = (sel) => S.container.querySelector(sel);
  const canPrint = typeof window.print === 'function';
  if (!canPrint) q('#print-go').disabled = true;

  const pages = () => {
    const n = estimatePages(S.sel, S.data);
    q('#print-pages').textContent = `≈ ${n} page${n === 1 ? '' : 's'}`;
  };
  pages();
  // download the guides we will need in the background, so the page estimate is not a guess
  ensureGuides(neededGuideIds()).then(() => { if (S) pages(); });

  q('#print-picker').addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.sec) {
      const key = t.dataset.sec;
      S.sel.sections[key] = t.checked;
      saveSel(S.sel);
      const label = t.closest('label');
      if (key === 'scenarios' || key === 'guides') { // show or hide the pick-list under this row
        const next = label.nextElementSibling;
        if (next && next.classList.contains('print-sub')) next.remove();
        if (t.checked) label.insertAdjacentHTML('afterend', `<div class="print-sub" data-sub="${key}">${subHtml(key)}</div>`);
      }
      const guidesSub = q('[data-sub="guides"]');
      if (key === 'emergency' && guidesSub) guidesSub.innerHTML = subHtml('guides'); // emergency guides are not offered twice
      await ensureGuides(neededGuideIds());
      if (S) pages();
      return;
    }
    if (t.dataset.scenario) {
      const set = new Set(S.sel.scenarios);
      if (t.checked) set.add(t.dataset.scenario); else set.delete(t.dataset.scenario);
      S.sel.scenarios = [...set];
    } else if (t.dataset.guide) {
      const set = new Set(S.sel.guides);
      if (t.checked) set.add(t.dataset.guide); else set.delete(t.dataset.guide);
      S.sel.guides = [...set];
      await ensureGuides(neededGuideIds());
    }
    saveSel(S.sel);
    if (S) pages();
  });

  const preview = async () => {
    const btn = q('#print-preview-btn');
    btn.disabled = true; btn.textContent = 'Building…';
    try {
      await ensureGuides(neededGuideIds());
      const doc = buildDocument(S.sel, S.data);
      q('#print-preview').innerHTML = `<h2 class="print-preview-title print-noprint">Preview (about ${doc.pages} page${doc.pages === 1 ? '' : 's'})</h2><div class="print-doc" id="print-doc">${doc.html}</div>`;
      q('#print-skipped').innerHTML = doc.skipped.length
        ? `<div class="print-skipped"><b>Left out:</b><ul>${doc.skipped.map((s) => `<li>${esc(s.reason)}</li>`).join('')}</ul></div>` : '';
      q('#print-pages').textContent = `≈ ${doc.pages} page${doc.pages === 1 ? '' : 's'}`;
      q('#print-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return doc;
    } finally {
      btn.disabled = false; btn.textContent = 'Preview';
    }
  };
  q('#print-preview-btn').addEventListener('click', preview);
  q('#print-go').addEventListener('click', async () => {
    if (!q('#print-doc')) await preview();
    if (canPrint) window.print();
  });
}

function renderCard() {
  const html = buildWalletCards(S.data);
  S.container.innerHTML = `
    <div class="print-controls">
      <a class="back" href="#/print">← Print binder</a>
      <h1>Wallet card</h1>
      <p class="muted">One fold-over card per person: where we meet, who to call, the radio and, for anyone with Type 1 diabetes, what to do. Fill in the blanks with a pen.</p>
      <div class="print-bar">
        <button type="button" class="btn primary big" id="print-go">Print / Save as PDF</button>
      </div>
      <p class="print-note">${esc(NOTE)}</p>
    </div>
    <div class="print-preview"><div class="print-doc" id="print-doc">${html}</div></div>`;
  const btn = S.container.querySelector('#print-go');
  if (typeof window.print !== 'function') btn.disabled = true;
  btn.addEventListener('click', () => { if (typeof window.print === 'function') window.print(); });
}
