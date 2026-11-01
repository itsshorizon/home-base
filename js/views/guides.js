// Guides list (#/guides): emergency tiles, search, and guides grouped by category.
import { loadIndex, GUIDE_CATEGORIES, guideCategory } from '../guides.js';
import { esc } from '../format.js';

let V = null;

function tileHtml(g) {
  const cat = guideCategory(g.category);
  return `<a class="em-tile" href="#/guide/${esc(g.id)}"><span class="em-icon" aria-hidden="true">${cat ? cat.icon : '📖'}</span><span class="em-title">${esc(g.title)}</span></a>`;
}

function rowHtml(g) {
  return `<a class="card row-link guide-row" href="#/guide/${esc(g.id)}">
    <span class="grow"><span class="row-title">${esc(g.title)}</span><span class="muted small block">${esc(g.summary || '')}</span></span>
    ${g.medical ? '<span class="badge">Medical</span>' : ''}<span class="chev" aria-hidden="true">›</span></a>`;
}

function paint() {
  const q = V.q.trim().toLowerCase();
  const all = V.index.guides;
  const matches = (g) => !q || `${g.title} ${g.summary || ''}`.toLowerCase().includes(q);
  const emergency = all.filter((g) => g.emergency);
  let html = '';
  if (!q && emergency.length) {
    html += `<h2 class="section-title em-head">In an emergency</h2><div class="em-grid">${emergency.map(tileHtml).join('')}</div>`;
  }
  let shown = 0;
  for (const c of GUIDE_CATEGORIES) {
    const group = all.filter((g) => g.category === c.key && matches(g));
    if (!group.length) continue;
    shown += group.length;
    html += `<h2 class="group-head">${c.icon} ${esc(c.label)} <span class="n">${group.length}</span></h2>${group.map(rowHtml).join('')}`;
  }
  const known = new Set(GUIDE_CATEGORIES.map((c) => c.key));
  const rest = all.filter((g) => !known.has(g.category) && matches(g));
  if (rest.length) { shown += rest.length; html += `<h2 class="group-head">📖 Other</h2>${rest.map(rowHtml).join('')}`; }
  if (!shown) html += `<div class="card empty"><p class="muted">${q ? 'No guides match.' : 'No guides yet.'}</p></div>`;
  V.root.querySelector('#g-list').innerHTML = html;
}

export async function render(container) {
  const index = await loadIndex();
  if (!index || !index.guides.length) {
    container.innerHTML = `<h1>Guides</h1><div class="card empty"><div class="empty-icon" aria-hidden="true">📖</div>
      <p><b>Guides haven't been downloaded yet</b></p>
      <p class="muted">Open Home Base once while you have internet and they will be saved to this phone for offline use.</p></div>`;
    return;
  }
  V = { root: container, index, q: '' };
  container.innerHTML = `<h1>Guides</h1>
    <div class="sticky-search"><input type="search" id="g-q" placeholder="Search guides" autocomplete="off" aria-label="Search guides"></div>
    <div id="g-list"></div>`;
  paint();
  V.onInput = (e) => { if (e.target.id === 'g-q') { V.q = e.target.value; paint(); } };
  container.addEventListener('input', V.onInput);
}

export function destroy() {
  if (V && V.onInput) V.root.removeEventListener('input', V.onInput);
  V = null;
}
