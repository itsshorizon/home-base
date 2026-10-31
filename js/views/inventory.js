// Inventory list (#/inventory) and item detail (#/item/<id>).
import { getAll, get, put, del, newId } from '../db.js';
import { CATEGORIES, KINDS, categoryByKey, fieldLabel, FIELD_META, insulinLabel } from '../categories.js';
import { fmtNum, fmtQty, fmtDate, daysUntil, esc } from '../format.js';

const toast = (message) => window.dispatchEvent(new CustomEvent('hb:toast', { detail: { message } }));

// "Provides" line for the card: first applicable of kcal, water, treat, fuel, insulin, count (then Wh).
export function providesLine(item) {
  const q = Number(item.qty) || 0;
  const pu = item.perUnit || {};
  const has = (f) => pu[f] !== undefined && pu[f] !== null && pu[f] !== '' && Number(pu[f]) > 0;
  if (has('kcal')) return `${fmtNum(q * pu.kcal)} kcal`;
  if (has('water_gal')) return `${fmtNum(q * pu.water_gal)} gal`;
  if (has('treat_gal')) return `treats ${fmtNum(q * pu.treat_gal)} gal`;
  if (has('fuel_hours')) return `~${fmtNum(q * pu.fuel_hours)} burn-hrs`;
  if (has('insulin_units')) return `${fmtNum(q * pu.insulin_units)} u`;
  if (has('count')) return `${fmtNum(q * pu.count)} ${KINDS[item.kind]?.countNoun || 'items'}`;
  if (has('wh')) return `${fmtNum(q * pu.wh)} Wh`;
  return '';
}

function expiryBadge(item, now) {
  if (!item.expires) return '';
  const d = daysUntil(item.expires, now);
  if (d === null) return '';
  if (d < 0) return `<span class="badge red">Expired ${fmtDate(item.expires)}</span>`;
  if (d <= 60) return `<span class="badge amber">${d === 0 ? 'Expires today' : `Expires in ${d} day${d === 1 ? '' : 's'}`}</span>`;
  return `<span class="badge">Exp ${fmtDate(item.expires)}</span>`;
}

function cardHtml(item, now) {
  const cat = categoryByKey(item.category);
  const provides = providesLine(item);
  return `<article class="card item-card" data-id="${esc(item.id)}">
    <a class="item-main" href="#/item/${esc(item.id)}">
      <span class="emoji" aria-hidden="true">${cat ? cat.icon : '📦'}</span>
      <span class="item-text">
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-qty">${esc(fmtQty(item.qty, item.unit))}${provides ? ` · ${esc(provides)}` : ''}</span>
        <span class="item-meta">${expiryBadge(item, now)}${item.opened ? '<span class="badge">Opened</span>' : ''}${item.location ? `<span class="muted">${esc(item.location)}</span>` : ''}</span>
      </span>
    </a>
    <div class="stepper">
      <button class="step" data-step="-1" aria-label="One less ${esc(item.name)}">−</button>
      <button class="step" data-step="1" aria-label="One more ${esc(item.name)}">+</button>
    </div>
  </article>`;
}

// ---------------- list ----------------
let L = null;
let photoUrl = null; // object URL for the detail photo; revoked in destroy()

function isExpiringSoon(item, now) {
  if (!item.expires) return false;
  const d = daysUntil(item.expires, now);
  return d !== null && d <= 60;
}

function urlFor(state) {
  const p = new URLSearchParams();
  if (state.cat) p.set('cat', state.cat);
  if (state.expiring) p.set('expiring', '1');
  const qs = p.toString();
  return `#/inventory${qs ? `?${qs}` : ''}`;
}

function paintList() {
  const now = new Date();
  const q = L.q.trim().toLowerCase();
  const base = L.items.filter((i) => {
    if (L.expiring && !isExpiringSoon(i, now)) return false;
    if (q && !`${i.name} ${i.location || ''} ${i.notes || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const counts = {};
  for (const i of base) counts[i.category] = (counts[i.category] || 0) + 1;
  const chips = [{ key: '', label: 'All', icon: '', n: base.length }, ...CATEGORIES.map((c) => ({ ...c, n: counts[c.key] || 0 }))];
  L.root.querySelector('#inv-chips').innerHTML = chips.map((c) =>
    `<button class="chip${L.cat === c.key ? ' on' : ''}" data-cat="${c.key}">${c.icon ? `${c.icon} ` : ''}${esc(c.label)} <span class="n">${c.n}</span></button>`).join('');

  const shown = base.filter((i) => !L.cat || i.category === L.cat);
  const list = L.root.querySelector('#inv-list');
  if (!L.items.length) {
    list.innerHTML = `<div class="card empty"><div class="empty-icon">📦</div><p>Nothing here yet.</p><a class="btn primary big" href="#/add">Add your first item</a></div>`;
    return;
  }
  if (!shown.length) {
    list.innerHTML = '<div class="card empty"><p class="muted">No items match.</p></div>';
    return;
  }
  if (L.expiring) {
    shown.sort((a, b) => a.expires.localeCompare(b.expires));
    list.innerHTML = `<p class="muted small">Items expired or expiring within 60 days, soonest first.</p>${shown.map((i) => cardHtml(i, now)).join('')}`;
    return;
  }
  let html = '';
  for (const c of CATEGORIES) {
    const group = shown.filter((i) => i.category === c.key).sort((a, b) => a.name.localeCompare(b.name));
    if (!group.length) continue;
    html += `<h2 class="group-head">${c.icon} ${esc(c.label)} <span class="n">${group.length}</span></h2>${group.map((i) => cardHtml(i, now)).join('')}`;
  }
  // items with a category we don't know about (e.g. from a newer backup) still show up
  const known = new Set(CATEGORIES.map((c) => c.key));
  const rest = shown.filter((i) => !known.has(i.category));
  if (rest.length) html += `<h2 class="group-head">📦 Other</h2>${rest.map((i) => cardHtml(i, now)).join('')}`;
  list.innerHTML = html;
}

async function renderList(container, params) {
  const items = await getAll('items');
  L = {
    root: container, items, q: '', cat: params.query.get('cat') || '', expiring: params.query.get('expiring') === '1',
  };
  container.innerHTML = `
    <div class="sticky-search"><input type="search" id="inv-q" placeholder="Search name, location, notes" autocomplete="off" aria-label="Search inventory"></div>
    <div class="chips" id="inv-chips"></div>
    <div id="inv-list"></div>`;
  paintList();

  L.onInput = (e) => { if (e.target.id === 'inv-q') { L.q = e.target.value; paintList(); } };
  L.onClick = async (e) => {
    const chip = e.target.closest('[data-cat]');
    if (chip) {
      L.cat = chip.dataset.cat;
      history.replaceState(null, '', urlFor(L)); // doesn't trigger a route change, so search text stays
      paintList();
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const card = step.closest('.item-card');
      const item = L.items.find((i) => i.id === card.dataset.id);
      if (!item) return;
      item.qty = Math.max(0, (Number(item.qty) || 0) + Number(step.dataset.step));
      card.outerHTML = cardHtml(item, new Date());
      try { await put('items', item); } catch (err) { toast(`Could not save: ${err.message}`); }
      return;
    }
    const card = e.target.closest('.item-card');
    if (card && !e.target.closest('a')) location.hash = `#/item/${card.dataset.id}`;
  };
  container.addEventListener('input', L.onInput);
  container.addEventListener('click', L.onClick);
}

// ---------------- detail ----------------
function expiryText(item, now) {
  if (!item.expires) return '—';
  const d = daysUntil(item.expires, now);
  let rel = '';
  if (d !== null) rel = d < 0 ? ` (expired ${-d} day${d === -1 ? '' : 's'} ago)` : d === 0 ? ' (today)' : ` (${d} day${d === 1 ? '' : 's'} left)`;
  return `${fmtDate(item.expires)}${rel}`;
}

async function renderDetail(container, id) {
  const item = await get('items', id);
  if (!item) {
    container.innerHTML = `<a class="back" href="#/inventory">← Inventory</a><div class="card empty"><p>That item no longer exists.</p></div>`;
    return;
  }
  if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
  if (item.photoId) {
    try {
      const blobRec = await get('blobs', item.photoId);
      if (blobRec && blobRec.blob) photoUrl = URL.createObjectURL(blobRec.blob);
    } catch { /* no photo: the page still works */ }
  }
  const now = new Date();
  const cat = categoryByKey(item.category);
  const pu = item.perUnit || {};
  const per = Object.keys(pu).filter((f) => pu[f] !== null && pu[f] !== '' && !Number.isNaN(Number(pu[f])));
  const fact = (k, v) => `<div class="fact"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  const storage = { pantry: 'Pantry', fridge: 'Fridge', freezer: 'Freezer', other: 'Other' }[item.storage] || item.storage || '—';
  const perFacts = per.map((f) => fact(fieldLabel(f, item.kind, item.unit), `${esc(fmtNum(pu[f]))} ${f === 'count' ? '' : esc(FIELD_META[f]?.unit || '')}`)).join('');
  const totalFacts = per.map((f) => {
    const t = (Number(item.qty) || 0) * Number(pu[f]);
    const lbl = f === 'count' ? (KINDS[item.kind]?.countNoun || 'items') : (FIELD_META[f]?.unit || '');
    return fact(`Total ${f === 'count' ? (KINDS[item.kind]?.countNoun || 'count') : (FIELD_META[f]?.label || f).toLowerCase()}`, `${esc(fmtNum(t))} ${esc(f === 'count' ? '' : lbl)}`);
  }).join('');
  container.innerHTML = `
    <a class="back" href="#/inventory${item.category ? `?cat=${esc(item.category)}` : ''}">← ${cat ? esc(cat.label) : 'Inventory'}</a>
    <header class="detail-head"><span class="emoji big" aria-hidden="true">${cat ? cat.icon : '📦'}</span>
      <div><h1>${esc(item.name)}</h1><div class="muted">${cat ? esc(cat.label) : ''}${KINDS[item.kind] && !item.kind.endsWith('_other') && KINDS[item.kind].label !== cat?.label ? ` · ${esc(KINDS[item.kind].label)}` : ''}</div></div></header>
    ${photoUrl ? `<img class="detail-photo" src="${photoUrl}" alt="Photo of ${esc(item.name)}">` : ''}
    <dl class="card facts">
      ${fact('Quantity', esc(fmtQty(item.qty, item.unit)))}
      ${item.brand ? fact('Brand', esc(item.brand)) : ''}
      ${item.barcode ? fact('Barcode', esc(item.barcode)) : ''}
      ${fact('Storage', esc(storage))}
      ${fact('Location', esc(item.location || '—'))}
      ${fact('Expires', esc(expiryText(item, now)))}
      ${fact('Opened', item.opened ? 'Yes' : 'No')}
      ${item.medName ? fact('Medication', esc(item.medName)) : ''}
      ${item.insulinType ? fact('Insulin type', esc(insulinLabel(item.insulinType))) : ''}
      ${perFacts}${totalFacts}
    </dl>
    ${item.instructions ? `<section class="card"><h2>Instructions</h2><div class="prewrap">${esc(item.instructions)}</div></section>` : ''}
    ${item.notes ? `<section class="card"><h2>Notes</h2><div class="prewrap">${esc(item.notes)}</div></section>` : ''}
    <div class="btn-row">
      <a class="btn primary" href="#/item/${esc(item.id)}/edit">Edit</a>
      <button class="btn" id="dup">Duplicate</button>
      <button class="btn danger" id="del">Delete</button>
    </div>`;
  container.querySelector('#dup').addEventListener('click', async () => {
    const copy = { ...item, id: newId(), name: `${item.name} (copy)`, createdAt: undefined };
    delete copy.createdAt;
    await put('items', copy);
    location.hash = `#/item/${copy.id}/edit`;
  });
  container.querySelector('#del').addEventListener('click', async () => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    await del('items', item.id);
    // drop the photo too, unless another item still uses it
    if (item.photoId && !(await getAll('items')).some((i) => i.photoId === item.photoId)) {
      try { await del('blobs', item.photoId); } catch { /* already gone */ }
    }
    toast('Deleted');
    location.hash = `#/inventory${item.category ? `?cat=${item.category}` : ''}`;
  });
}

export async function render(container, params) {
  if (params.name === 'item') return renderDetail(container, params.id);
  return renderList(container, params);
}

export function destroy() {
  if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
  if (L) {
    L.root.removeEventListener('input', L.onInput);
    L.root.removeEventListener('click', L.onClick);
  }
  L = null;
}
