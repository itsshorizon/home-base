// The offline map file (data/map/henrico.pmtiles, about 42 MB) lives in its own cache, "hb-map-v1".
// It is NOT in the service worker's precache (too big to hold up the install), and sw.js never touches
// caches named hb-map-*, so updating the app can't delete it. This module is the only code that reads or
// writes that cache. Used by the map view and by Settings.
import { getSettings, saveSettings } from './db.js';

export const MAP_CACHE = 'hb-map-v1';
export const MAP_PATH = 'data/map/henrico.pmtiles';
export const mapUrl = () => new URL(MAP_PATH, document.baseURI).href;

// Real (unzipped) size of the map file, from data/map/meta.json (precached), or 0 if unknown.
async function expectedSize() {
  try {
    const res = await fetch(new URL('data/map/meta.json', document.baseURI).href);
    const meta = await res.json();
    return Number(meta && meta.pmtiles && meta.pmtiles.bytes) || 0;
  } catch {
    return 0;
  }
}

// A PMTiles file starts with the ASCII bytes "PMTiles".
async function looksLikePmtiles(chunks) {
  const head = new Uint8Array(await new Blob(chunks).slice(0, 7).arrayBuffer());
  return String.fromCharCode(...head) === 'PMTiles';
}

export class MapDownloadError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// -> { downloaded, size, savedAt }   (size in bytes, savedAt ISO string)
export async function getMapStatus() {
  try {
    if (!('caches' in window) || !(await caches.has(MAP_CACHE))) return { downloaded: false }; // has() first: open() would create an empty cache
    const cache = await caches.open(MAP_CACHE);
    const hit = await cache.match(mapUrl());
    if (!hit) return { downloaded: false };
    const s = await getSettings();
    const info = s.mapDownload || {};
    return { downloaded: true, size: info.size || Number(hit.headers.get('content-length')) || 0, savedAt: info.savedAt || hit.headers.get('x-hb-saved-at') || null };
  } catch {
    return { downloaded: false };
  }
}

// The cached file as a Blob, or null if it isn't saved.
export async function loadMapBlob() {
  if (!('caches' in window) || !(await caches.has(MAP_CACHE))) return null;
  const cache = await caches.open(MAP_CACHE);
  const hit = await cache.match(mapUrl());
  return hit ? hit.blob() : null;
}

export async function deleteMap() {
  if ('caches' in window) await caches.delete(MAP_CACHE);
  await saveSettings({ mapDownload: null });
}

// Download the map with progress. onProgress(bytesDone, bytesTotal). Throws MapDownloadError with
// code 'offline' | 'network' | 'quota' | 'aborted' | 'http' | 'size'.
export async function downloadMap(onProgress, signal) {
  if (navigator.onLine === false) throw new MapDownloadError('offline', 'You are offline. Connect to Wi-Fi to download the map.');
  let res;
  try {
    res = await fetch(mapUrl(), { cache: 'no-store', signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new MapDownloadError('aborted', 'Download cancelled.');
    throw new MapDownloadError('network', "Couldn't reach the server. Check your connection and retry.");
  }
  if (!res.ok || !res.body) throw new MapDownloadError('http', `The server answered ${res.status}. Try again later.`);
  // GitHub Pages gzips this file in transit: Content-Length is then the COMPRESSED size, while the
  // stream hands us the unzipped bytes. So trust the real file size from meta.json, and only fall
  // back to Content-Length when the response isn't encoded.
  const encoded = !!res.headers.get('content-encoding');
  const headerLen = Number(res.headers.get('content-length')) || 0;
  const expected = await expectedSize();
  const total = expected || (encoded ? 0 : headerLen);
  const reader = res.body.getReader();
  const chunks = [];
  let done = 0;
  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      chunks.push(value);
      done += value.length;
      if (onProgress) onProgress(done, total);
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new MapDownloadError('aborted', 'Download cancelled.');
    throw new MapDownloadError('network', 'The connection dropped part way. Retry; the download starts over.');
  }
  if (total && done !== total) throw new MapDownloadError('size', 'The download was cut short. Retry.');
  if (!(await looksLikePmtiles(chunks))) throw new MapDownloadError('size', "The downloaded file isn't a map. Retry.");

  const savedAt = new Date().toISOString();
  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  try {
    const cache = await caches.open(MAP_CACHE);
    await cache.put(mapUrl(), new Response(blob, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(blob.size), 'x-hb-saved-at': savedAt } }));
  } catch (e) {
    try { await caches.delete(MAP_CACHE); } catch { /* ignore */ }
    if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)))) {
      throw new MapDownloadError('quota', "This phone doesn't have enough free space for the map. Free up some storage and retry.");
    }
    throw new MapDownloadError('save', `Couldn't save the map (${e && e.message ? e.message : 'unknown error'}).`);
  }
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* optional */ }
  await saveSettings({ mapDownload: { size: blob.size, savedAt } });
  return { size: blob.size, savedAt };
}
