// Review what the AI (or a barcode lookup) found, and save it. #/review (the list) and #/review/<queueId> (one result).
// Nothing reaches the inventory until the user taps Save on a card.
import { getAll, get, put, getSettings } from '../db.js';
import { KINDS } from '../categories.js';
import { esc, fmtQty, addMonths } from '../format.js';
import { mountItemForm } from './itemform.js';
import { sameBarcode } from '../off.js';
import { describeRecord } from '../ai.js';
import {
  listQueue, getRecord, retryRecord, deleteRecord, markHandled, finishRecord, enqueuePhoto, processQueue,
} from '../queue.js';

const toast = (message) => window.dispatchEvent(new CustomEvent('hb:toast', { detail: { message } }));

let R = null; // state of the mounted view

function revokeUrls() {
  if (R) for (const u of R.urls) URL.revokeObjectURL(u);
  if (R) R.urls = [];
}

async function blobUrl(id) {
  if (!id) return null;
  const rec = await get('blobs', id);
  if (!rec || !rec.blob) return null;
  const url = URL.createObjectURL(rec.blob);
  R.urls.push(url);
  return url;
}

const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- list ----------
async function paintList() {
  if (!R || R.mode !== 'list') return;
  const [recs, settings] = await Promise.all([listQueue(), getSettings()]);
  if (!R || R.mode !== 'list') return;
  revokeUrls();
  const ctx = { online: navigator.onLine !== false, hasKey: !!(settings.apiKey && settings.apiKey.trim()), now: Date.now() };
  const rows = [];
  for (const rec of recs) {
    const thumb = await blobUrl(rec.thumbId);
    const state = describeRecord(rec, ctx);
    const title = rec.type === 'barcode' ? `Barcode ${esc(rec.barcode)}` : 'Photo';
    const count = rec.status === 'ready' && rec.result ? rec.result.items.length : 0;
    const pic = thumb ? `<img class="rv-thumb" src="${thumb}" alt="">` : `<span class="rv-thumb rv-icon" aria-hidden="true">▥</span>`;
    const body = `${pic}<span class="rv-text"><b>${title}</b>
        <span class="rv-state rv-${state.tone}">${esc(state.label)}${count ? ` · ${count} item${count === 1 ? '' : 's'} found` : ''}</span>
        <span class="muted small">${esc(when(rec.createdAt))}</span></span>`;
    let actions = '';
    if (rec.status === 'error') {
      actions = `<div class="btn-row"><button class="btn" data-retry="${esc(rec.id)}">Retry</button><button class="btn danger" data-del="${esc(rec.id)}">Delete</button></div>`;
    } else if (rec.status === 'pending' || rec.status === 'processing') {
      const keyLink = state.tone === 'nokey' ? '<a class="btn" href="#/settings">Open Settings</a>' : '';
      actions = `<div class="btn-row">${keyLink}<button class="btn danger" data-del="${esc(rec.id)}">Delete</button></div>`;
    }
    rows.push(rec.status === 'ready'
      ? `<a class="card rv-row" href="#/review/${esc(rec.id)}">${body}<span class="chev" aria-hidden="true">›</span></a>`
      : `<article class="card"><div class="rv-row">${body}</div>${actions}</article>`);
  }
  R.root.querySelector('[data-list]').innerHTML = rows.length
    ? rows.join('')
    : '<div class="card empty"><div class="empty-icon">📸</div><p>Nothing waiting. Photos and barcodes you scan show up here.</p><a class="btn primary" href="#/add">Add something</a></div>';
}

async function renderList(container) {
  R = { mode: 'list', root: container, urls: [] };
  container.innerHTML = `
    <a class="back" href="#/add">← Add</a>
    <h1>To review</h1>
    <p class="muted small">Photos and scans wait here until you check them. Nothing is added to your inventory until you tap Save.</p>
    <div data-list></div>`;
  R.onClick = async (e) => {
    const retry = e.target.closest('[data-retry]');
    if (retry) { retryRecord(retry.dataset.retry); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!confirm('Delete this one?')) return;
      await deleteRecord(del.dataset.del);
    }
  };
  R.onQueue = () => paintList();
  container.addEventListener('click', R.onClick);
  window.addEventListener('hb:queue', R.onQueue);
  window.addEventListener('online', R.onQueue);
  window.addEventListener('offline', R.onQueue);
  await paintList();
}

// ---------- one result ----------
function findDuplicate(draft, items) {
  if (draft.barcode) {
    const byCode = items.find((i) => i.barcode && sameBarcode(i.barcode, draft.barcode));
    if (byCode) return byCode;
  }
  const name = (draft.name || '').trim().toLowerCase();
  if (!name) return null;
  return items.find((i) => (i.name || '').trim().toLowerCase() === name && i.kind === draft.kind) || null;
}

function initialItem(draft) {
  const kind = KINDS[draft.kind] ? draft.kind : 'food_other';
  const k = KINDS[kind];
  let expires = draft.expires || '';
  let estimated = false;
  if (!expires && draft.shelfLifeMonths) { expires = addMonths(new Date(), draft.shelfLifeMonths); estimated = true; }
  const notes = [draft.packageSize ? `Package: ${draft.packageSize}` : '', draft.notes || ''].filter(Boolean).join('\n');
  return {
    item: {
      category: k.category, kind, name: draft.name || '', qty: draft.qty || 1, unit: draft.unit || k.unit,
      storage: draft.storage || 'pantry', location: '', expires, opened: false, notes,
      instructions: draft.instructions || k.instructions || '', medName: '', insulinType: draft.insulinType || 'other',
      perUnit: { ...k.perUnit, ...draft.perUnit },
    },
    estimated,
  };
}

function nutritionNote(draft) {
  const k = KINDS[draft.kind];
  const wantsKcal = k && k.fields.includes('kcal');
  if (draft.nutritionSource === 'estimated') return 'Nutrition estimated — check the label.';
  if (draft.nutritionSource === 'none' && wantsKcal) return 'No nutrition found — enter it from the label.';
  return '';
}

function cardHtml(draft, index, total, rec, dup) {
  const conf = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence — double-check' }[draft.confidence] || '';
  const notes = [];
  const nn = nutritionNote(draft);
  if (nn) notes.push(`<p class="rv-note">${esc(nn)}</p>`);
  for (const w of draft.warnings || []) notes.push(`<p class="rv-note">${esc(w)}</p>`);
  if (rec.type === 'barcode' && rec.result && rec.result.found === false) {
    notes.push(`<p class="rv-note">${esc(rec.result.message || 'Not in the food database. Take a photo or type it in.')}</p>`);
  }
  const dupHtml = dup ? `<div class="rv-dup" data-dup>
      <p>You already have <b>${esc(fmtQty(dup.qty, dup.unit))}</b> of these (${esc(dup.name)}).</p>
      <div class="btn-row"><button type="button" class="btn primary" data-merge>Add ${esc(String(draft.qty))} to existing</button>
        <button type="button" class="btn" data-asnew>Save as new</button></div></div>` : '';
  return `<article class="card review-card" data-card="${index}">
    <div class="rv-head"><b>${total > 1 ? `Item ${index + 1} of ${total}` : 'Item'}</b>
      ${conf ? `<span class="badge${draft.confidence === 'low' ? ' amber' : ''}">${esc(conf)}</span>` : ''}</div>
    ${notes.join('')}${dupHtml}
    <div data-form></div>
  </article>`;
}

async function renderDetail(container, id) {
  R = { mode: 'detail', root: container, urls: [], forms: [], id };
  const rec = await getRecord(id);
  if (!rec) {
    container.innerHTML = '<a class="back" href="#/review">← To review</a><div class="card empty"><p>That one is no longer here.</p></div>';
    return;
  }
  if (rec.status !== 'ready') {
    container.innerHTML = '<a class="back" href="#/review">← To review</a><div class="card empty"><p>This one is not ready yet.</p><a class="btn" href="#/review">See the list</a></div>';
    return;
  }
  const items = await getAll('items');
  R.rec = rec;
  const drafts = rec.result.items || [];
  const handled = { ...(rec.handled || {}) };
  const photoUrl = rec.type === 'photo' ? (await blobUrl(rec.imageBlobId)) || (await blobUrl(rec.thumbId)) : null;

  container.innerHTML = `
    <a class="back" href="#/review">← To review</a>
    <h1>${rec.type === 'barcode' ? 'Barcode result' : 'Review items'}</h1>
    ${photoUrl ? `<button type="button" class="rv-photo" data-zoom aria-label="View the photo full size"><img src="${photoUrl}" alt="Your photo"></button>` : ''}
    ${rec.type === 'barcode' ? `<p class="muted small">Barcode ${esc(rec.barcode)}</p>` : ''}
    ${rec.result.servedByFallback ? '<p class="muted small">A backup model answered this one. Check the details.</p>' : ''}
    ${rec.result.message && drafts.length === 0 ? `<div class="card"><p>${esc(rec.result.message)}</p></div>` : ''}
    <div data-cards></div>
    <div class="btn-row" data-empty-actions hidden>
      <button type="button" class="btn primary" data-discard>Discard</button>
      <a class="btn" href="#/add">Type it in instead</a>
    </div>
    <input type="file" accept="image/*" capture="environment" data-retake hidden>`;

  const cardsEl = container.querySelector('[data-cards]');
  const settle = async () => {
    const done = drafts.every((_, i) => handled[i]);
    if (!done) return;
    const values = Object.values(handled);
    const savedCount = values.filter((v) => v === 'saved' || v === 'merged').length;
    await finishRecord(id, { keepThumb: values.includes('saved') });
    toast(savedCount ? `Saved ${savedCount} item${savedCount === 1 ? '' : 's'}` : 'Nothing saved');
    location.hash = '#/inventory';
  };

  if (!drafts.length) {
    container.querySelector('[data-empty-actions]').hidden = false;
    if (!rec.result.message) cardsEl.innerHTML = '<div class="card"><p>Nothing could be identified in that photo.</p></div>';
  }

  drafts.forEach((draft, i) => {
    if (handled[i]) return; // done in an earlier visit
    const dup = findDuplicate(draft, items);
    cardsEl.insertAdjacentHTML('beforeend', cardHtml(draft, i, drafts.length, rec, dup));
    const card = cardsEl.querySelector(`[data-card="${i}"]`);
    const { item: initial, estimated } = initialItem(draft);
    const extra = {};
    if (draft.barcode || rec.barcode) extra.barcode = draft.barcode || rec.barcode;
    if (draft.brand) extra.brand = draft.brand;
    if (rec.type === 'photo' && rec.thumbId) extra.photoId = rec.thumbId;
    const retakeAction = rec.type === 'barcode' && rec.result.found === false
      ? [{ label: '📷 Take photo instead', name: 'retake' }] : [];

    const markDone = async (how, text) => {
      handled[i] = how;
      await markHandled(id, i, how);
      card.className = 'card review-done';
      card.innerHTML = text;
      await settle();
    };

    const form = mountItemForm(card.querySelector('[data-form]'), {
      mode: 'review', initial, items, extra, bare: true,
      hints: estimated ? { expires: 'Estimated from typical shelf life. Check the package.' } : {},
      buttons: [{ label: 'Save', after: 'open', primary: true }],
      actions: [...retakeAction, { label: 'Skip', name: 'skip' }],
      async onSave(item) {
        await put('items', item);
        await markDone('saved', `✓ Saved <b>${esc(item.name)}</b>`);
      },
      onAction(name) {
        if (name === 'skip') markDone('skipped', `Skipped <b>${esc(draft.name || 'this item')}</b>`);
        else if (name === 'retake') container.querySelector('[data-retake]').click();
      },
    });
    R.forms.push(form);

    if (dup) {
      const mergeBtn = card.querySelector('[data-merge]');
      card.addEventListener('input', () => {
        const n = form.getQty();
        mergeBtn.textContent = `Add ${Number.isFinite(n) ? n : 0} to existing`;
      });
      mergeBtn.addEventListener('click', async () => {
        const n = form.getQty();
        if (!Number.isFinite(n) || n <= 0) { toast('Set a quantity first.'); return; }
        const fresh = (await get('items', dup.id)) || dup;
        fresh.qty = (Number(fresh.qty) || 0) + n;
        let usedThumb = false;
        if (!fresh.barcode && extra.barcode) fresh.barcode = extra.barcode;
        if (!fresh.photoId && extra.photoId) { fresh.photoId = extra.photoId; usedThumb = true; }
        await put('items', fresh);
        await markDone(usedThumb ? 'saved' : 'merged', `✓ Added ${esc(String(n))} to <b>${esc(fresh.name)}</b> (now ${esc(fmtQty(fresh.qty, fresh.unit))})`);
      });
      card.querySelector('[data-asnew]').addEventListener('click', () => {
        card.querySelector('[data-dup]').hidden = true;
      });
    }
  });

  R.onClick = async (e) => {
    if (e.target.closest('[data-zoom]')) {
      const ov = document.createElement('div');
      ov.className = 'lightbox';
      ov.innerHTML = `<img src="${photoUrl}" alt="Your photo, full size">`;
      ov.addEventListener('click', () => ov.remove());
      document.body.appendChild(ov);
      return;
    }
    if (e.target.closest('[data-discard]')) {
      await finishRecord(id, { keepThumb: false });
      toast('Discarded');
      location.hash = '#/add';
    }
  };
  R.onChange = async (e) => {
    if (!e.target.matches('[data-retake]') || !e.target.files.length) return;
    const file = e.target.files[0];
    e.target.value = '';
    const settings = await getSettings();
    try {
      const newRec = await enqueuePhoto(file, { barcode: rec.barcode });
      await deleteRecord(id);
      if (!(settings.apiKey && settings.apiKey.trim())) { toast('Saved. Add your API key in Settings and it will be identified.'); location.hash = '#/review'; return; }
      if (navigator.onLine === false) { toast("Saved — will identify when you're back online"); location.hash = '#/review'; return; }
      toast('Identifying…');
      await processQueue();
      const done = await getRecord(newRec.id);
      location.hash = done && done.status === 'ready' ? `#/review/${done.id}` : '#/review';
    } catch (err) {
      toast(`Could not read that photo: ${err.message}`);
    }
  };
  container.addEventListener('click', R.onClick);
  container.addEventListener('change', R.onChange);
  // Everything in this result was already handled on an earlier visit
  if (drafts.length && drafts.every((_, i) => handled[i])) await settle();
}

export async function render(container, params) {
  if (params.name === 'review-item') return renderDetail(container, params.id);
  return renderList(container);
}

export function destroy() {
  if (R) {
    revokeUrls();
    for (const f of R.forms || []) f.destroy();
    if (R.onClick) R.root.removeEventListener('click', R.onClick);
    if (R.onChange) R.root.removeEventListener('change', R.onChange);
    if (R.onQueue) {
      window.removeEventListener('hb:queue', R.onQueue);
      window.removeEventListener('online', R.onQueue);
      window.removeEventListener('offline', R.onQueue);
    }
  }
  R = null;
  document.querySelectorAll('.lightbox').forEach((el) => el.remove());
}
