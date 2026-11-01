// Dashboard: bottleneck hero, grid-down card, sliders, runway bars, expiring items, shopping list.
import { getAll, getSettings, saveSettings } from '../db.js';
import {
  computeRunway, shoppingList, FRIDGE_SAFE_HOURS, FREEZER_SAFE_HOURS, gridDownHours, insulinRoomLifeDays,
} from '../runway.js';
import { fmtDays, fmtNum, daysUntil, esc, fmtHM } from '../format.js';
import { queueCounts } from '../queue.js';
import { computeWeakSpots, activeWeakSpots, countBySeverity } from '../weakspots.js';

const toast = (message) => window.dispatchEvent(new CustomEvent('hb:toast', { detail: { message } }));

// Which inventory category a runway resource links to.
export function categoryForResource(key) {
  if (key.startsWith('med:')) return 'meds';
  return {
    calories: 'food', protein: 'food', water: 'water', treatment: 'treatment', fuel: 'cooking',
    insulin: 't1d', pumpSites: 't1d', reservoirs: 't1d', cgm: 't1d', strips: 't1d', ketones: 't1d', needles: 't1d',
    power: 'power', tp: 'sanitation', petFood: 'pets',
  }[key] || '';
}

let S = null; // state for the mounted dashboard
let slidersOpen = false; // sliders stay locked until "Adjust" is tapped

function dismissedSet() {
  try { return new Set(JSON.parse(sessionStorage.getItem('hb_dismissed') || '[]')); } catch { return new Set(); }
}
function dismiss(id) {
  const s = dismissedSet(); s.add(id);
  try { sessionStorage.setItem('hb_dismissed', JSON.stringify([...s])); } catch { /* private mode: fine */ }
}

function isStandalone() {
  const mode = (m) => window.matchMedia && window.matchMedia(`(display-mode: ${m})`).matches;
  return mode('fullscreen') || mode('standalone') || window.navigator.standalone === true;
}

function installNudge() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const how = window.hbInstallPrompt
    ? 'Install it so it opens full screen and keeps your data safe.<br><button class="btn small primary" data-install>Install app</button>'
    : ios
      ? 'Tap Share → Add to Home Screen. This keeps your data safe — Safari can erase data for sites that aren\'t installed.'
      : 'In Chrome, tap ⋮ → <b>Install app</b> (not "Add shortcut"). It then opens full screen and keeps your data safe.';
  return `<div class="nudge install"><div><b>Install Home Base</b><br>${how}</div><button class="x" data-dismiss-install aria-label="Dismiss">✕</button></div>`;
}

export async function render(container) {
  slidersOpen = false;
  const [items, people, pets, settings, queue] = await Promise.all([getAll('items'), getAll('people'), getAll('pets'), getSettings(), queueCounts()]);
  S = { container, items, people, pets, settings, ready: queue.ready, pending: {}, saveTimer: null, timer: null, runway: null, now: new Date() };
  container.innerHTML = `
    <div id="d-nudges"></div>
    <section class="card hero" id="d-hero"></section>
    <section class="card" id="d-weak" hidden></section>
    <section class="card" id="d-grid"></section>
    <section class="card" id="d-sliders"></section>
    <section id="d-bars"></section>
    <section class="card" id="d-expiring"></section>
    <section class="card" id="d-shop"></section>`;
  paintNudges();
  paintSliders();
  repaint();
  container.addEventListener('click', onClick);
  window.addEventListener('hb:installable', paintNudges);
  container.addEventListener('change', onChange);
  container.addEventListener('input', onInput);
  S.timer = setInterval(() => { if (S.settings.gridDown) repaint(); }, 60000);
}

export function destroy() {
  if (S) {
    clearInterval(S.timer);
    clearTimeout(S.saveTimer);
    flushSave();
    S.container.removeEventListener('click', onClick);
    S.container.removeEventListener('change', onChange);
    S.container.removeEventListener('input', onInput);
    window.removeEventListener('hb:installable', paintNudges);
  }
  S = null;
}

function $(id) { return S.container.querySelector(`#${id}`); }

// ---------- saving ----------
function queueSave(partial) {
  Object.assign(S.pending, partial);
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flushSave, 300);
}
function flushSave() {
  if (!S || !Object.keys(S.pending).length) return;
  const p = S.pending; S.pending = {};
  saveSettings(p).catch((e) => toast(`Could not save: ${e.message}`));
}

// ---------- paint ----------
function repaint() {
  S.now = new Date();
  S.runway = computeRunway(S.items, S.people, S.pets, S.settings, S.now);
  paintHero();
  paintWeak();
  paintGrid();
  paintBars();
  paintExpiring();
  paintShopping();
}

function paintNudges() {
  const { settings, items, people } = S;
  const gone = dismissedSet();
  const out = [];
  if (S.ready >= 1) {
    out.push(`<div class="nudge"><a href="#/review">📸 ${S.ready} ${S.ready === 1 ? 'result is' : 'results are'} ready to review</a></div>`);
  }
  if (!people.length && !gone.has('household')) {
    out.push(`<div class="nudge"><a href="#/household">Add your household so the math is right</a><button class="x" data-dismiss="household" aria-label="Dismiss">✕</button></div>`);
  }
  const last = settings.lastBackupAt ? new Date(settings.lastBackupAt).getTime() : null;
  const stale = last === null || Date.now() - last > 7 * 86400000;
  if (items.length && stale && !gone.has('backup')) {
    out.push(`<div class="nudge"><a href="#/settings">Back up your data</a><button class="x" data-dismiss="backup" aria-label="Dismiss">✕</button></div>`);
  }
  if (!isStandalone() && !settings.installBannerDismissed) {
    out.push(installNudge());
  }
  $('d-nudges').innerHTML = out.join('');
}

function paintHero() {
  const { runway, items } = S;
  const el = $('d-hero');
  const b = runway.resources.find((r) => r.key === runway.bottleneck);
  if (!items.length || !b) {
    el.className = 'card hero';
    el.innerHTML = `<div class="hero-big">Add your first items to see how long you can last</div>
      <a class="btn primary" href="#/add">Add items</a>`;
    return;
  }
  const cat = categoryForResource(b.key);
  el.className = `card hero hero-${b.status}`;
  el.innerHTML = `
    <div class="hero-small">You can last about</div>
    <div class="hero-days">${esc(fmtDays(b.days))}</div>
    <div class="hero-limit">Limited by <a href="#/inventory?cat=${cat}"><b>${esc(b.label)}</b></a></div>
    ${runway.defaultAdult ? '<div class="muted small">Assuming one adult. Add your household for real numbers.</div>' : ''}`;
}

// Weak spots: counts by severity, the top 3 red/amber gaps, and a link to the full list.
function paintWeak() {
  const { items, people, pets, settings, runway, now } = S;
  const el = $('d-weak');
  if (!items.length) { el.hidden = true; return; } // brand-new install: the hero already says "add items"
  const all = activeWeakSpots(computeWeakSpots(items, people, pets, settings, runway, now), settings);
  const c = countBySeverity(all);
  const urgent = all.filter((w) => w.severity !== 'info');
  const top = urgent.slice(0, 3);
  el.hidden = false;
  el.innerHTML = `<div class="row-between"><h2>Weak spots</h2>
      <span class="ws-counts"><span class="badge red">${c.red} red</span><span class="badge amber">${c.amber} amber</span><span class="badge">${c.info} info</span></span></div>
    ${top.length ? top.map((w) => `<a class="exp-row ws-row ws-${w.severity}" href="${esc(w.fix.href)}"><span><span class="ws-dot" aria-hidden="true"></span>${esc(w.title)}</span><span class="chev" aria-hidden="true">›</span></a>`).join('')
      : `<p class="ok">${c.info ? 'Nothing urgent.' : 'No weak spots found.'}</p>`}
    ${all.length ? `<a class="btn small ws-all" href="#/weakspots">See all (${all.length})</a>` : ''}`;
}

function toggleHtml(id, label, on) {
  return `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="track"><span class="thumb"></span></span><span class="switch-label">${esc(label)}</span></label>`;
}

function paintGrid() {
  const { settings, items, now } = S;
  const el = $('d-grid');
  const hours = gridDownHours(settings, now);
  let html = `<h2>Grid-down mode</h2>${toggleHtml('t-grid', 'Power is out', settings.gridDown)}`;
  if (settings.gridDown) {
    const fridgeLeft = FRIDGE_SAFE_HOURS - hours;
    const freezerLeft = FREEZER_SAFE_HOURS - hours;
    const life = insulinRoomLifeDays(items, settings, now);
    html += `<ul class="countdowns">
      <li class="muted">Power out for ${esc(fmtHM(hours))}</li>
      <li class="${fridgeLeft > 0 ? 'ok' : 'bad'}">${fridgeLeft > 0
        ? `Fridge food safe for ${esc(fmtHM(fridgeLeft))}`
        : `Fridge food: discard (unsafe after ${FRIDGE_SAFE_HOURS} h)`}</li>
      <li class="${freezerLeft > 0 ? 'ok' : 'bad'}">${freezerLeft > 0
        ? `Freezer (full): ${Math.floor(freezerLeft)}h left`
        : `Freezer: discard (unsafe after ${FREEZER_SAFE_HOURS} h)`}</li>
      ${life !== null ? `<li>${settings.insulinCooling
        ? 'Insulin: kept cool, so the room-temperature limit is off'
        : `Insulin out of fridge: day ${Math.floor(hours / 24) + 1} of ~${life}`}</li>` : ''}
    </ul>
    ${toggleHtml('t-cool', 'Keeping insulin cool', settings.insulinCooling)}
    <p class="muted small">Food safety limits: USDA/FoodSafety.gov (fridge 4 h, full freezer 48 h; a half-full freezer is closer to 24 h). Fridge and freezer food leaves your totals after those limits. Insulin room-temperature days come from manufacturer labeling: check your own package insert.</p>`;
  }
  el.innerHTML = html;
}

function sliderRow(id, label, min, max, step, value, unit, resetKey) {
  return `<div class="slider-row">
    <div class="slider-head"><label for="${id}">${label}</label>
      <span><b id="${id}-v">${fmtNum(value)}</b> ${unit}${resetKey ? ` <a href="#" class="reset" data-reset="${resetKey}">reset</a>` : ''}</span></div>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
  </div>`;
}

function insulinPerDay() {
  const { settings, people } = S;
  if (settings.insulinUnitsOverride !== null && settings.insulinUnitsOverride !== undefined) return Number(settings.insulinUnitsOverride);
  return people.reduce((t, p) => t + (p.t1d ? (Number(p.t1d.basalUnits) || 0) + (Number(p.t1d.bolusUnits) || 0) : 0), 0);
}

function paintSliders() {
  const { settings, people } = S;
  const heads = settings.peopleOverride ?? Math.max(1, people.length);
  const anyT1d = people.some((p) => p.t1d);
  const insulin = Math.min(150, Math.max(5, insulinPerDay() || 40));
  // Collapsed by default so scrolling the dashboard can't nudge a slider by accident.
  const summary = [`${heads} ${heads === 1 ? 'person' : 'people'}`, `${settings.rationPct}% food`,
    `${fmtNum(settings.waterGalPerPersonDay)} gal water`, `${fmtNum(settings.stoveHoursPerDay)} h stove`,
    ...(anyT1d ? [`${insulin} u insulin`] : []), `goal ${settings.targetDays} days`].join(' · ');
  if (!slidersOpen) {
    $('d-sliders').innerHTML = `<div class="row-between"><h2>Daily use</h2>
      <button type="button" class="btn small" data-sliders="open">Adjust</button></div>
      <p class="muted">${esc(summary)}</p>`;
    return;
  }
  $('d-sliders').innerHTML = `<div class="row-between"><h2>Adjust daily use</h2>
      <button type="button" class="btn small primary" data-sliders="close">Done</button></div>
    ${sliderRow('s-people', 'People', 1, 12, 1, heads, 'people', 'peopleOverride')}
    ${sliderRow('s-ration', 'Ration', 50, 120, 5, settings.rationPct, '% of normal food')}
    ${sliderRow('s-water', 'Water per person', 0.5, 2, 0.25, settings.waterGalPerPersonDay, 'gal/day')}
    ${sliderRow('s-stove', 'Stove hours', 0, 4, 0.25, settings.stoveHoursPerDay, 'hours/day')}
    ${anyT1d ? sliderRow('s-insulin', 'Insulin', 5, 150, 1, insulin, 'units/day', 'insulinUnitsOverride') : ''}
    ${sliderRow('s-goal', 'Goal', 7, 180, 1, settings.targetDays, 'days')}`;
}

function barRow(r, isBottleneck) {
  const cat = categoryForResource(r.key);
  const missing = r.status === 'missing';
  const href = missing ? `#/add?cat=${cat}` : `#/inventory?cat=${cat}`;
  const pct = r.days === null ? 0 : Math.min(r.days / S.settings.targetDays, 1) * 100;
  const supply = `${fmtNum(r.supply)} ${esc(r.supplyUnit)}`;
  const sub = r.days === null ? esc(r.note) : missing ? `None stocked yet · you use ${fmtNum(r.daily)}/day` : `${supply} · ${fmtNum(r.daily)}/day`;
  const note = !missing && r.days !== null && r.note ? `<div class="bar-note ${r.capped ? 'warn' : ''}">${esc(r.note)}</div>` : '';
  return `<a class="card bar-row st-${r.status}${isBottleneck ? ' bottleneck' : ''}" href="${href}">
    <div class="bar-top"><span class="bar-label">${esc(r.label)}${isBottleneck ? ' <span class="tag">BOTTLENECK</span>' : ''}</span>
      <span class="bar-days">${missing ? 'Add +' : esc(fmtDays(r.days))}</span></div>
    <div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
    <div class="bar-sub">${sub}</div>${note}</a>`;
}

function paintBars() {
  const { runway } = S;
  const live = runway.resources.filter((r) => r.days !== null && r.status !== 'missing');
  const missing = runway.resources.filter((r) => r.status === 'missing');
  const na = runway.resources.filter((r) => r.days === null);
  $('d-bars').innerHTML = `<h2 class="section-title">Runway</h2>
    ${live.map((r) => barRow(r, r.key === runway.bottleneck)).join('')}
    ${missing.length ? `<details class="missing-group"><summary>Not stocked yet (${missing.length})</summary>
      ${missing.map((r) => barRow(r, false)).join('')}</details>` : ''}
    ${na.length ? `<details class="na-group"><summary>Not tracked for your household (${na.length})</summary>
      ${na.map((r) => barRow(r, false)).join('')}</details>` : ''}`;
}

function paintExpiring() {
  const { items, now } = S;
  const rows = items
    .filter((i) => i.expires && Number(i.qty) > 0)
    .map((i) => ({ i, d: daysUntil(i.expires, now) }))
    .filter((x) => x.d !== null && x.d <= 60)
    .sort((a, b) => a.d - b.d);
  const shown = rows.slice(0, 8);
  $('d-expiring').innerHTML = `<div class="row-between"><h2>Expiring soon</h2><a href="#/inventory?expiring=1">see all${rows.length > 8 ? ` (${rows.length})` : ''}</a></div>
    ${shown.length ? shown.map(({ i, d }) => `<a class="exp-row ${d < 0 ? 'red' : 'amber'}" href="#/item/${esc(i.id)}">
      <span>${esc(i.name)}</span>
      <span class="exp-when">${d < 0 ? `expired ${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'expires today' : `in ${d} day${d === 1 ? '' : 's'}`}</span></a>`).join('')
      : '<p class="muted">Nothing expires in the next 60 days.</p>'}`;
}

function shoppingLines() {
  return shoppingList(S.runway, S.settings).map((s) =>
    `${s.label} — ${fmtNum(s.need)} more ${s.unit} to reach ${S.settings.targetDays} days`);
}

function paintShopping() {
  const lines = shoppingLines();
  $('d-shop').innerHTML = `<div class="row-between"><h2>Shopping list</h2>
    ${lines.length ? '<button class="btn small" data-copy>Copy list</button>' : ''}</div>
    ${lines.length ? `<ul class="shop">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      : `<p class="muted">${S.items.length ? `Everything tracked reaches your ${S.settings.targetDays}-day goal.` : 'Add items to build a shopping list.'}</p>`}`;
}

// ---------- events ----------
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function setSlider(id, value) {
  const el = $(id);
  if (el) { el.value = value; $(`${id}-v`).textContent = fmtNum(Number(value)); }
}

function onClick(e) {
  const t = e.target;
  const dis = t.closest('[data-dismiss]');
  if (dis) { dismiss(dis.dataset.dismiss); paintNudges(); return; }
  if (t.closest('[data-install]') && window.hbInstallPrompt) {
    const prompt = window.hbInstallPrompt;
    prompt.prompt();
    prompt.userChoice.finally(() => { window.hbInstallPrompt = null; paintNudges(); });
    return;
  }
  if (t.closest('[data-dismiss-install]')) {
    S.settings.installBannerDismissed = true;
    saveSettings({ installBannerDismissed: true });
    paintNudges();
    return;
  }
  const sl = t.closest('[data-sliders]');
  if (sl) {
    slidersOpen = sl.dataset.sliders === 'open';
    paintSliders();
    return;
  }
  if (t.closest('[data-copy]')) {
    const text = `Home Base shopping list (goal: ${S.settings.targetDays} days)\n${shoppingLines().map((l) => `- ${l}`).join('\n')}`;
    copyText(text).then((ok) => toast(ok ? 'List copied' : 'Could not copy'));
    return;
  }
  const reset = t.closest('[data-reset]');
  if (reset) {
    e.preventDefault();
    const key = reset.dataset.reset;
    S.settings[key] = null;
    queueSave({ [key]: null });
    if (key === 'peopleOverride') setSlider('s-people', Math.max(1, S.people.length));
    if (key === 'insulinUnitsOverride') setSlider('s-insulin', Math.min(150, Math.max(5, insulinPerDay() || 40)));
    repaint();
  }
}

function onChange(e) {
  const id = e.target.id;
  if (id === 't-grid') {
    const on = e.target.checked;
    S.settings.gridDown = on;
    S.settings.gridDownSince = on ? new Date().toISOString() : null;
    queueSave({ gridDown: S.settings.gridDown, gridDownSince: S.settings.gridDownSince });
    flushSave();
    repaint();
  } else if (id === 't-cool') {
    S.settings.insulinCooling = e.target.checked;
    queueSave({ insulinCooling: e.target.checked });
    flushSave();
    repaint();
  }
}

function onInput(e) {
  const id = e.target.id;
  if (!id || !id.startsWith('s-')) return;
  const v = Number(e.target.value);
  $(`${id}-v`).textContent = fmtNum(v);
  const s = S.settings;
  let patch = {};
  if (id === 's-people') {
    const val = S.people.length && v === S.people.length ? null : v;
    patch = { peopleOverride: val };
  } else if (id === 's-ration') patch = { rationPct: v };
  else if (id === 's-water') patch = { waterGalPerPersonDay: v };
  else if (id === 's-stove') patch = { stoveHoursPerDay: v };
  else if (id === 's-insulin') patch = { insulinUnitsOverride: v };
  else if (id === 's-goal') {
    // the goal also moves the green line; red stays at 14 days (or half the goal if that's smaller)
    patch = { targetDays: v, greenAtDays: v, redBelowDays: Math.min(14, Math.round(v / 2)) };
  }
  Object.assign(s, patch);
  queueSave(patch); // saved 300 ms after the last movement
  repaint();
}
