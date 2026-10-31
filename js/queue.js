// Offline queue for photos and barcodes (IndexedDB store "photoQueue").
// Every photo is saved here FIRST, then processed. One code path, and a photo survives a crash or a closed app.
//
// Record: { id, type: 'photo'|'barcode', createdAt, status: 'pending'|'processing'|'ready'|'error',
//           tries, nextTryAt, imageBlobId, thumbId, barcode, result, error }
// result: { items: [draft...], message, unreadable?, found?, model?, servedByFallback? }
import { getAll, get, put, del, newId, getSettings } from './db.js';
import {
  API_URL, DEFAULT_MODEL, buildRequest, buildHeaders, parseResponse, queueAction, failureState,
} from './ai.js';
import { offUrl, mapOffProduct, normalizeBarcode } from './off.js';
import { fileToJpeg, thumbnail, blobToBase64 } from './image.js';

const changed = () => window.dispatchEvent(new CustomEvent('hb:queue'));
const isOnline = () => navigator.onLine !== false;

// ---------- adding ----------
// Resize, store the full-size JPEG and a thumbnail, and queue the record. Does NOT contact the network.
export async function enqueuePhoto(file, { barcode = null } = {}) {
  const { blob } = await fileToJpeg(file);
  const thumb = await thumbnail(blob, 400);
  const imageBlobId = newId();
  const thumbId = newId();
  await put('blobs', { id: imageBlobId, type: 'queue-image', blob });
  await put('blobs', { id: thumbId, type: 'photo', blob: thumb });
  const rec = await put('photoQueue', {
    id: newId(), type: 'photo', status: 'pending', tries: 0, nextTryAt: 0,
    imageBlobId, thumbId, barcode: barcode ? normalizeBarcode(barcode) : null, result: null, error: null,
  });
  changed();
  return rec;
}

export async function enqueueBarcode(code) {
  const rec = await put('photoQueue', {
    id: newId(), type: 'barcode', status: 'pending', tries: 0, nextTryAt: 0,
    imageBlobId: null, thumbId: null, barcode: normalizeBarcode(code), result: null, error: null,
  });
  changed();
  return rec;
}

// ---------- reading ----------
export async function listQueue() {
  const all = await getAll('photoQueue');
  return all.filter((r) => r.status !== 'done').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getRecord(id) {
  return get('photoQueue', id);
}

export async function queueCounts() {
  const counts = { pending: 0, processing: 0, ready: 0, error: 0, total: 0 };
  for (const r of await listQueue()) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    counts.total++;
  }
  return counts;
}

// ---------- processing ----------
async function fetchWithTimeout(url, init, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function runPhoto(rec, settings) {
  const blobRec = await get('blobs', rec.imageBlobId);
  if (!blobRec) return { ok: false, retry: false, error: 'The saved photo is missing. Delete this one and take it again.', code: 'missing' };
  const model = settings.aiModel || DEFAULT_MODEL;
  const base64 = await blobToBase64(blobRec.blob);
  const res = await fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: buildHeaders(settings.apiKey.trim(), model),
    body: JSON.stringify(buildRequest({ base64, mediaType: 'image/jpeg', model })),
  }, 120000);
  let json = null;
  try { json = await res.json(); } catch { /* not JSON: parseResponse copes */ }
  const parsed = parseResponse(res.status, json);
  if (parsed.ok && rec.barcode && parsed.items.length === 1 && !parsed.items[0].barcode) parsed.items[0].barcode = rec.barcode;
  return parsed;
}

async function runBarcode(rec) {
  const res = await fetchWithTimeout(offUrl(rec.barcode), {}, 20000);
  let json = null;
  try { json = await res.json(); } catch { /* not found pages may not be JSON */ }
  if (res.status === 404) json = { status: 0 };
  else if (!res.ok) {
    return { ok: false, retry: res.status === 429 || res.status >= 500, error: 'The food database had a problem. Will try again.', code: 'off' };
  }
  const mapped = mapOffProduct(json, rec.barcode);
  return { ok: true, items: [mapped.item], message: mapped.message, found: mapped.found };
}

async function processOne(rec, settings) {
  rec.status = 'processing';
  await put('photoQueue', rec);
  changed();
  let outcome;
  try {
    outcome = rec.type === 'photo' ? await runPhoto(rec, settings) : await runBarcode(rec);
  } catch (err) {
    // fetch() throws TypeError when there is no network; AbortError means it timed out. Both are worth retrying.
    outcome = { ok: false, retry: true, error: err && err.name === 'AbortError' ? 'Anthropic took too long to answer. Will try again.' : "Couldn't reach the internet. Will try again.", code: 'network' };
  }
  const current = await get('photoQueue', rec.id);
  if (!current) return; // deleted while we were waiting for the answer
  let next;
  if (outcome.ok) {
    const { items, message, unreadable, found, model, servedByFallback } = outcome;
    next = { ...current, status: 'ready', error: null, tries: current.tries, nextTryAt: 0, result: { items, message, unreadable: !!unreadable, found, model, servedByFallback } };
  } else {
    next = { ...current, ...failureState(current, { retry: outcome.retry, error: outcome.error, now: Date.now() }) };
  }
  await put('photoQueue', next);
  changed();
}

let running = null;
let rerun = false;
let retryTimer = null;

async function pass() {
  const settings = await getSettings();
  const all = await getAll('photoQueue');
  // A record left "processing" means the app closed mid-request. Put it back in line.
  for (const r of all) {
    if (r.status === 'processing') { r.status = 'pending'; await put('photoQueue', r); }
  }
  const todo = all.filter((r) => r.status === 'pending').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const rec of todo) {
    const ctx = { online: isOnline(), hasKey: !!(settings.apiKey && settings.apiKey.trim()), now: Date.now() };
    if (queueAction(rec, ctx) === 'process') await processOne(rec, settings);
  }
  await scheduleRetry();
}

// If something is waiting out a backoff, wake up when it is due.
async function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
  const waiting = (await getAll('photoQueue')).filter((r) => r.status === 'pending' && r.nextTryAt > Date.now());
  if (!waiting.length) return;
  const next = Math.min(...waiting.map((r) => r.nextTryAt));
  retryTimer = setTimeout(() => { processQueue(); }, Math.max(1000, next - Date.now() + 250));
}

// Single flight: if it is already running, ask it to go around once more and share its promise.
export function processQueue() {
  if (running) { rerun = true; return running; }
  running = (async () => {
    try {
      do {
        rerun = false;
        try { await pass(); } catch (err) { console.error('Queue pass failed', err); }
      } while (rerun);
    } finally {
      running = null;
      changed();
    }
  })();
  return running;
}

export function initQueue() {
  window.addEventListener('online', () => { processQueue(); });
  processQueue();
}

// ---------- user actions ----------
export async function retryRecord(id) {
  const rec = await get('photoQueue', id);
  if (!rec) return;
  await put('photoQueue', { ...rec, status: 'pending', tries: 0, nextTryAt: 0, error: null });
  changed();
  return processQueue();
}

async function dropBlob(id) {
  if (id) { try { await del('blobs', id); } catch { /* already gone */ } }
}

export async function deleteRecord(id) {
  const rec = await get('photoQueue', id);
  if (!rec) return;
  await del('photoQueue', id);
  await dropBlob(rec.imageBlobId);
  await dropBlob(rec.thumbId);
  changed();
}

// Remember which cards of a result were saved or skipped, so reopening it shows only what is left.
export async function markHandled(id, index, how) {
  const rec = await get('photoQueue', id);
  if (!rec) return null;
  const handled = { ...(rec.handled || {}), [index]: how };
  return put('photoQueue', { ...rec, handled });
}

// Everything in the result was saved or skipped: mark done, then delete the record and the big photo.
// The thumbnail stays when at least one saved item points at it.
export async function finishRecord(id, { keepThumb }) {
  const rec = await get('photoQueue', id);
  if (!rec) return;
  await put('photoQueue', { ...rec, status: 'done' });
  await del('photoQueue', id);
  await dropBlob(rec.imageBlobId);
  if (!keepThumb) await dropBlob(rec.thumbId);
  changed();
}
