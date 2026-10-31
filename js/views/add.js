// Add / Edit item (#/add, #/item/<id>/edit). The form itself lives in itemform.js (shared with Review).
// Add also starts the two fast paths: photo identification and barcode scanning.
import { getAll, get, put, getSettings } from '../db.js';
import { CATEGORIES } from '../categories.js';
import { esc, fmtQty, fmtNum } from '../format.js';
import { mountItemForm } from './itemform.js';
import { enqueuePhoto, enqueueBarcode, processQueue, queueCounts, getRecord, listQueue } from '../queue.js';
import { openScanner } from '../scanner.js';
import { openSheet } from '../sheet.js';
import { sameBarcode } from '../off.js';
import { modelCost } from '../ai.js';

const toast = (message) => window.dispatchEvent(new CustomEvent('hb:toast', { detail: { message } }));

let V = null; // state of the mounted view

// ---------- photo ----------
async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
  if (!files.length) { toast('Please choose a photo.'); return; }
  const status = V.root.querySelector('[data-status]');
  status.hidden = false;
  status.innerHTML = `<span class="spinner" aria-hidden="true"></span> <span>${files.length > 1 ? `Preparing ${files.length} photos…` : 'Preparing photo…'}</span>`;
  const ids = [];
  try {
    for (const f of files) ids.push((await enqueuePhoto(f)).id);
  } catch (err) {
    status.hidden = true;
    toast(`Could not read that photo: ${err.message}`);
    return;
  }
  const settings = await getSettings();
  const online = navigator.onLine !== false;
  const hasKey = !!(settings.apiKey && settings.apiKey.trim());
  if (!hasKey) {
    status.hidden = true;
    toast('Saved. Add your API key in Settings and it will be identified.');
    return;
  }
  if (!online) {
    status.hidden = true;
    const waiting = (await listQueue()).filter((r) => r.status === 'pending').length;
    toast(`Saved — will identify when you're back online (${waiting} waiting)`);
    return;
  }
  status.querySelector('span:last-child').textContent = files.length > 1 ? `Identifying ${files.length} photos…` : 'Identifying…';
  await processQueue();
  if (!V) return; // user navigated away; the queue badge will tell them when it's ready
  status.hidden = true;
  const recs = await Promise.all(ids.map((id) => getRecord(id)));
  const ready = recs.filter((r) => r && r.status === 'ready');
  const failed = recs.find((r) => r && r.status === 'error');
  if (failed) toast(failed.error || 'Could not identify that photo.');
  if (ids.length === 1 && ready.length === 1) { location.hash = `#/review/${ready[0].id}`; return; }
  location.hash = '#/review';
}

async function needKeySheet(onQueueAnyway) {
  openSheet(`
    <h2>Add your API key first</h2>
    <p>Photo ID sends each picture to Anthropic (Claude) to read the labels. That needs your own API key, which you add in Settings. It stays on this phone.</p>
    <p class="muted small">Barcode scanning and typing items in work without a key.</p>
    <div class="btn-row">
      <a class="btn primary" href="#/settings" data-sheet="close">Go to Settings</a>
      <button type="button" class="btn" data-sheet="queue">Save photos for later</button>
    </div>`, { onAction: (name, close) => { if (name === 'queue') { close(); onQueueAnyway(); } } });
}

// ---------- barcode ----------
async function haveSheet(item) {
  const sheet = openSheet(`
    <h2>You have ${esc(fmtNum(item.qty))} × ${esc(item.name)}</h2>
    <div class="btn-row sheet-steps">
      <button type="button" class="btn big" data-sheet="plus1">+1</button>
      <button type="button" class="btn big" data-sheet="plusn">+ how many…</button>
      <button type="button" class="btn big" data-sheet="minus1">−1 (used one)</button>
    </div>
    <div class="btn-row"><a class="btn primary" href="#/item/${esc(item.id)}" data-sheet="close">Open item</a>
      <button type="button" class="btn" data-sheet="close">Done</button></div>`, {
    async onAction(name, close) {
      let delta = 0;
      if (name === 'plus1') delta = 1;
      else if (name === 'minus1') delta = -1;
      else if (name === 'plusn') {
        const raw = prompt('How many are you adding?', '6');
        const n = Number(raw);
        if (raw === null || !Number.isFinite(n) || n <= 0) return;
        delta = n;
      }
      item.qty = Math.max(0, (Number(item.qty) || 0) + delta);
      await put('items', item);
      close();
      toast(`${item.name}: now ${fmtQty(item.qty, item.unit)}`);
    },
  });
  return sheet;
}

async function onBarcode(code) {
  const items = await getAll('items');
  // Local first, so it works with no internet
  const mine = items.find((i) => i.barcode && sameBarcode(i.barcode, code));
  if (mine) { haveSheet(mine); return; }
  const rec = await enqueueBarcode(code);
  const status = V && V.root.querySelector('[data-status]');
  if (navigator.onLine === false) {
    toast("Saved — will look up when you're back online");
    return;
  }
  if (status) { status.hidden = false; status.innerHTML = '<span class="spinner" aria-hidden="true"></span> <span>Looking it up…</span>'; }
  await processQueue();
  if (status) status.hidden = true;
  const done = await getRecord(rec.id);
  if (done && done.status === 'ready') { if (V) location.hash = `#/review/${done.id}`; return; }
  if (done && done.status === 'error') toast(done.error || 'Could not look that up.');
  else toast("Saved — will look up when you're back online");
}

// ---------- the "ready to review" banner ----------
async function paintBanner() {
  if (!V) return;
  const el = V.root.querySelector('[data-banner]');
  if (!el) return;
  const c = await queueCounts();
  if (!V) return;
  if (!c.total) { el.hidden = true; return; }
  const parts = [];
  if (c.ready) parts.push(`📸 ${c.ready} ready to review`);
  const waiting = c.pending + c.processing;
  if (waiting) parts.push(`${waiting} waiting`);
  if (c.error) parts.push(`${c.error} need${c.error === 1 ? 's' : ''} attention`);
  el.hidden = false;
  el.className = `nudge${c.ready ? '' : ' quiet'}`;
  el.innerHTML = `<a href="#/review">${esc(parts.join(' · '))}</a><span class="chev" aria-hidden="true">›</span>`;
}

function onQueueChange() { paintBanner(); }

// ---------- view ----------
export async function render(container, params) {
  const edit = params.name === 'item-edit';
  const [items, people, settings] = await Promise.all([getAll('items'), getAll('people'), getSettings()]);
  let existing = null;
  if (edit) {
    existing = items.find((i) => i.id === params.id) || (await get('items', params.id));
    if (!existing) {
      container.innerHTML = '<a class="back" href="#/inventory">← Inventory</a><div class="card empty"><p>That item no longer exists.</p></div>';
      return;
    }
  }
  const q = params.query;
  const cat = q.get('cat') && CATEGORIES.some((c) => c.key === q.get('cat')) ? q.get('cat') : 'food';
  const medNames = [...new Set(people.flatMap((p) => (p.meds || []).map((m) => m.name)).filter(Boolean))];
  const hasKey = !!(settings.apiKey && settings.apiKey.trim());

  container.innerHTML = `
    <a class="back" href="${edit ? `#/item/${esc(existing.id)}` : '#/inventory'}">← ${edit ? 'Cancel' : 'Inventory'}</a>
    <h1>${edit ? 'Edit item' : 'Add item'}</h1>
    ${edit ? '' : `
    <div id="add-banner" data-banner hidden></div>
    <div class="methods">
      <button type="button" class="method" data-act="camera"><span>📷 Take photo</span></button>
      <button type="button" class="method" data-act="pick"><span>🖼️ Choose photos</span></button>
      <button type="button" class="method" data-act="barcode"><span>▥ Barcode</span></button>
      <button type="button" class="method on" data-act="type"><span>⌨️ Type it in</span></button>
    </div>
    <input type="file" accept="image/*" capture="environment" id="in-camera" hidden>
    <input type="file" accept="image/*" multiple id="in-pick" hidden>
    <div class="working card" data-status hidden role="status"></div>
    <p class="muted small ai-note">Photos are sent to Anthropic to identify them, using your key. About ${esc(modelCost(settings.aiModel))} each.${hasKey ? '' : ' Add your key in <a href="#/settings">Settings</a> first.'}</p>`}
    <div data-form></div>`;

  V = { root: container, edit, form: null, hasKey };
  V.form = mountItemForm(container.querySelector('[data-form]'), {
    mode: edit ? 'edit' : 'add', existing, category: cat, kind: q.get('kind'), items, medNames,
    buttons: edit
      ? [{ label: 'Save', after: 'open', primary: true }]
      : [{ label: 'Save', after: 'open', primary: true }, { label: 'Save &amp; add another', after: 'again' }],
    async onSave(item, { again }) {
      await put('items', item);
      toast('Saved');
      if (again) {
        V.form.reset(item.category, item.kind);
        window.scrollTo(0, 0);
        V.form.focusName();
        return;
      }
      location.hash = `#/inventory?cat=${item.category}`;
    },
  });

  if (!edit) {
    V.onClick = (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const open = (id) => container.querySelector(id).click();
      if (act === 'camera' || act === 'pick') {
        const id = act === 'camera' ? '#in-camera' : '#in-pick';
        getSettings().then((s) => {
          if (s.apiKey && s.apiKey.trim()) open(id);
          else needKeySheet(() => open(id));
        });
      } else if (act === 'barcode') {
        openScanner({ onCode: onBarcode });
      } else if (act === 'type') {
        V.form.focusName();
      }
    };
    V.onChange = async (e) => {
      if (e.target.id !== 'in-camera' && e.target.id !== 'in-pick') return;
      const files = [...e.target.files];
      e.target.value = '';
      if (files.length) await handleFiles(files);
    };
    container.addEventListener('click', V.onClick);
    container.addEventListener('change', V.onChange);
    window.addEventListener('hb:queue', onQueueChange);
    paintBanner();
  }
}

export function destroy() {
  if (V) {
    if (V.form) V.form.destroy();
    if (V.onClick) V.root.removeEventListener('click', V.onClick);
    if (V.onChange) V.root.removeEventListener('change', V.onChange);
    window.removeEventListener('hb:queue', onQueueChange);
  }
  V = null;
}
