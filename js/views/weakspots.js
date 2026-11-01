// Weak spots (#/weakspots): every gap the app found, with fix buttons. Info items can be dismissed.
import { getAll, getSettings, saveSettings } from '../db.js';
import { computeRunway } from '../runway.js';
import { computeWeakSpots, activeWeakSpots, countBySeverity } from '../weakspots.js';
import { loadIndex } from '../guides.js';
import { esc } from '../format.js';

let V = null;
const LABEL = { red: 'Fix soon', amber: 'Worth fixing', info: 'Nice to have' };

function cardHtml(w, { dismissable, restore }) {
  const guideOk = w.howto && V.guideIds.has(w.howto.guide);
  return `<div class="card ws ws-${w.severity}" data-id="${esc(w.id)}">
    <div class="ws-title"><span class="ws-dot" aria-hidden="true"></span><b>${esc(w.title)}</b></div>
    <p class="muted ws-detail">${esc(w.detail)}</p>
    <div class="btn-row">
      <a class="btn small primary" href="${esc(w.fix.href)}">${esc(w.fix.label)}</a>
      ${guideOk ? `<a class="btn small" href="${esc(w.howto.href)}">📖 ${esc(w.howto.label)}</a>` : ''}
      ${dismissable ? '<button type="button" class="btn small" data-dismiss-ws>Dismiss</button>' : ''}
      ${restore ? '<button type="button" class="btn small" data-restore-ws>Restore</button>' : ''}
    </div></div>`;
}

function paint() {
  const { all, settings } = V;
  const gone = new Set(settings.dismissedWeakSpots || []);
  const active = activeWeakSpots(all, settings);
  const dismissed = all.filter((w) => w.severity === 'info' && gone.has(w.id));
  const c = countBySeverity(active);
  let html = `<a class="back" href="#/">← Home</a><h1>Weak spots</h1>
    <p class="muted">${c.red} red · ${c.amber} amber · ${c.info} info. Red and amber can only be fixed, not hidden.</p>`;
  if (!active.length) html += '<div class="card empty"><div class="empty-icon" aria-hidden="true">✅</div><p><b>No weak spots found</b></p></div>';
  for (const sev of ['red', 'amber', 'info']) {
    const group = active.filter((w) => w.severity === sev);
    if (!group.length) continue;
    html += `<h2 class="group-head">${LABEL[sev]} <span class="n">${group.length}</span></h2>${group.map((w) => cardHtml(w, { dismissable: sev === 'info' })).join('')}`;
  }
  if (dismissed.length) {
    html += `<details class="na-group"><summary>Dismissed (${dismissed.length})</summary>${dismissed.map((w) => cardHtml(w, { restore: true })).join('')}</details>`;
  }
  V.root.innerHTML = html;
}

async function setDismissed(id, on) {
  const set = new Set(V.settings.dismissedWeakSpots || []);
  if (on) set.add(id); else set.delete(id);
  V.settings.dismissedWeakSpots = [...set];
  paint();
  try { await saveSettings({ dismissedWeakSpots: V.settings.dismissedWeakSpots }); } catch { /* shown again next visit */ }
}

function onClick(e) {
  const card = e.target.closest('.ws');
  if (!card) return;
  if (e.target.closest('[data-dismiss-ws]')) setDismissed(card.dataset.id, true);
  else if (e.target.closest('[data-restore-ws]')) setDismissed(card.dataset.id, false);
}

export async function render(container) {
  const [items, people, pets, settings, index] = await Promise.all([getAll('items'), getAll('people'), getAll('pets'), getSettings(), loadIndex()]);
  const now = new Date();
  const runway = computeRunway(items, people, pets, settings, now);
  V = {
    root: container, settings, all: computeWeakSpots(items, people, pets, settings, runway, now),
    guideIds: new Set(((index && index.guides) || []).map((g) => g.id)),
  };
  paint();
  container.addEventListener('click', onClick);
}

export function destroy() {
  if (V) V.root.removeEventListener('click', onClick);
  V = null;
}
