// Home Base: boot, hash router, tab bar, toasts, service worker, update check.
import * as dashboard from './views/dashboard.js';
import * as inventory from './views/inventory.js';
import * as add from './views/add.js';
import * as household from './views/household.js';
import * as settingsView from './views/settings.js';
import * as more from './views/more.js';
import * as placeholder from './views/placeholder.js';
import * as review from './views/review.js';
import * as guides from './views/guides.js';
import * as guide from './views/guide.js';
import * as weakspots from './views/weakspots.js';
import * as mapView from './views/map.js';
import * as commsView from './views/comms.js';
import { requestPersist } from './db.js';
import { initQueue, queueCounts } from './queue.js';

export const BUILD_ID = '0.6.0';

// ---------- routes ----------
// `tab` says which bottom tab to highlight (null = none). `name` is handed to the view.
const ROUTES = [
  { re: /^\/$/, name: 'dashboard', view: dashboard, tab: 'home' },
  { re: /^\/inventory$/, name: 'inventory', view: inventory, tab: 'inventory' },
  { re: /^\/item\/([^/]+)$/, name: 'item', view: inventory, tab: 'inventory' },
  { re: /^\/item\/([^/]+)\/edit$/, name: 'item-edit', view: add, tab: 'inventory' },
  { re: /^\/add$/, name: 'add', view: add, tab: 'add' },
  { re: /^\/review$/, name: 'review', view: review, tab: 'add' },
  { re: /^\/review\/([^/]+)$/, name: 'review-item', view: review, tab: 'add' },
  { re: /^\/household$/, name: 'household', view: household, tab: null },
  { re: /^\/person\/([^/]+)$/, name: 'person', view: household, tab: null },
  { re: /^\/pet\/([^/]+)$/, name: 'pet', view: household, tab: null },
  { re: /^\/settings$/, name: 'settings', view: settingsView, tab: null },
  { re: /^\/more$/, name: 'more', view: more, tab: null },
  { re: /^\/map$/, name: 'map', view: mapView, tab: 'map' },
  { re: /^\/guides$/, name: 'guides', view: guides, tab: 'guides' },
  { re: /^\/guide\/([^/]+)$/, name: 'guide', view: guide, tab: 'guides' },
  { re: /^\/weakspots$/, name: 'weakspots', view: weakspots, tab: 'home' },
  { re: /^\/comms$/, name: 'comms', view: commsView, tab: null },
  { re: /^\/plans$/, name: 'plans', view: placeholder, tab: null },
];

const viewEl = document.getElementById('view');
let current = null; // the view module currently mounted
let routeToken = 0;

function setActiveTab(tab) {
  document.querySelectorAll('.tabbar [data-tab]').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function route() {
  const raw = location.hash.slice(1) || '/';
  const qIndex = raw.indexOf('?');
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1));
  let found = null;
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (m) { found = { r, m }; break; }
  }
  if (!found) { location.replace('#/'); return; } // unknown route: go home

  const token = ++routeToken;
  if (current && current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
  current = null;
  setActiveTab(found.r.tab);

  const el = document.createElement('div');
  el.className = 'view-inner';
  const id = found.m[1] ? decodeURIComponent(found.m[1]) : undefined;
  try {
    await found.r.view.render(el, { name: found.r.name, id, query });
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="card empty"><p><b>Something went wrong.</b></p><p class="muted">${String(err && err.message ? err.message : err).replace(/[<&]/g, ' ')}</p><a class="btn" href="#/">Go home</a></div>`;
  }
  if (token !== routeToken) {
    // a newer navigation started while this one was loading; clean up if it was a different view
    if (current !== found.r.view && found.r.view.destroy) { try { found.r.view.destroy(); } catch (e) { console.error(e); } }
    return;
  }
  current = found.r.view;
  viewEl.replaceChildren(el);
  window.scrollTo(0, 0);
}

// ---------- toasts ----------
export function showToast(message, { onClick, ms = 2600 } = {}) {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = message;
  if (onClick) { t.classList.add('tap'); t.addEventListener('click', onClick); }
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
window.addEventListener('hb:toast', (e) => showToast(e.detail.message));

// ---------- queue badge on the Add tab ----------
async function paintBadge() {
  const badge = document.getElementById('add-badge');
  if (!badge) return;
  try {
    const { ready } = await queueCounts();
    badge.hidden = !ready;
    badge.textContent = String(ready);
    badge.setAttribute('aria-label', `${ready} ready to review`);
  } catch { badge.hidden = true; }
}
window.addEventListener('hb:queue', paintBadge);

// ---------- install (Android/Chrome) ----------
// Chrome fires this when the app can be installed. Keep the event so the dashboard
// can show a real "Install app" button instead of menu instructions.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.hbInstallPrompt = e;
  window.dispatchEvent(new Event('hb:installable'));
});
window.addEventListener('appinstalled', () => {
  window.hbInstallPrompt = null;
  window.dispatchEvent(new Event('hb:installable'));
});

// ---------- offline pill ----------
function paintOnline() {
  document.getElementById('offline-pill').hidden = navigator.onLine !== false;
}
window.addEventListener('online', paintOnline);
window.addEventListener('offline', paintOnline);

// ---------- service worker + update check ----------
let swReg = null;
let latestVersion = null;

export async function checkForUpdate() {
  if (navigator.onLine === false) return { current: BUILD_ID, latest: BUILD_ID, error: 'You are offline. Try again when you have a connection.' };
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { version } = await res.json();
    latestVersion = version;
    if (version !== BUILD_ID && swReg) await swReg.update();
    return { current: BUILD_ID, latest: version };
  } catch {
    return { current: BUILD_ID, latest: BUILD_ID, error: 'Could not check for updates right now.' };
  }
}

async function startServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const wasControlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled) return; // first install: nothing to reload
    showToast(`Updated to v${latestVersion || 'new version'} — tap to reload`, { onClick: () => location.reload(), ms: 15000 });
  });
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
    if (navigator.onLine !== false) checkForUpdate();
  } catch (e) {
    console.error('Service worker failed', e);
  }
}

async function firstRunPersist() {
  let done = false;
  try { done = localStorage.getItem('hb_persist_asked') === '1'; } catch { /* ignore */ }
  if (done) return;
  await requestPersist();
  try { localStorage.setItem('hb_persist_asked', '1'); } catch { /* ignore */ }
}

// ---------- boot ----------
window.addEventListener('hashchange', route);
paintOnline();
route();
startServiceWorker();
firstRunPersist();
paintBadge();
initQueue(); // identify anything that was waiting, and again whenever the phone gets back online
