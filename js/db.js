// IndexedDB wrapper. All household data lives here, on the device, and nowhere else.
import { DEFAULT_SETTINGS } from './runway.js';

const DB_NAME = 'homebase';
const DB_VERSION = 1;
const ID_STORES = ['items', 'people', 'pets', 'pins', 'contacts', 'photoQueue', 'blobs'];
const KEY_STORES = ['settings'];
export const ALL_STORES = [...ID_STORES, ...KEY_STORES];
// Stores that go into a backup file. Photos (the "blobs" store) and the photo queue are not included:
// blobs are not JSON, and queued photos are temporary. Items may carry optional `barcode`, `brand` and
// `photoId` fields (Phase 2); a restored item whose thumbnail is missing simply shows no picture.
const EXPORT_STORES = ['items', 'people', 'pets', 'pins', 'contacts', 'settings'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ID_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      for (const s of KEY_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => reject(new Error('Database is open in another tab. Close other Home Base tabs and reload.'));
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function get(store, id) {
  const db = await openDB();
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(id));
}

export async function put(store, obj) {
  const db = await openDB();
  const now = new Date().toISOString();
  const rec = { ...obj, updatedAt: now };
  if (!rec.createdAt) rec.createdAt = now;
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(rec);
  await done(tx);
  return rec;
}

export async function del(store, id) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  return done(tx);
}

export async function clear(store) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}

export function newId() {
  return crypto.randomUUID();
}

export async function getSettings() {
  const rows = await getAll('settings');
  const stored = {};
  for (const r of rows) stored[r.key] = r.value;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(partial) {
  const db = await openDB();
  const tx = db.transaction('settings', 'readwrite');
  const st = tx.objectStore('settings');
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(partial)) st.put({ key, value, updatedAt: now });
  await done(tx);
}

export async function exportAll() {
  const stores = {};
  for (const s of EXPORT_STORES) stores[s] = await getAll(s);
  return { app: 'home-base', schema: 1, exportedAt: new Date().toISOString(), stores };
}

export async function importAll(obj) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'home-base') throw new Error('Not a Home Base backup');
  if (!(Number(obj.schema) <= 1)) throw new Error('This backup is from a newer version of Home Base. Update the app first.');
  const stores = obj.stores && typeof obj.stores === 'object' ? obj.stores : {};
  const names = Object.keys(stores).filter((s) => ALL_STORES.includes(s));
  for (const s of names) if (!Array.isArray(stores[s])) throw new Error(`Backup is damaged (${s})`);
  const db = await openDB();
  const tx = db.transaction(names, 'readwrite');
  for (const s of names) {
    const st = tx.objectStore(s);
    st.clear();
    for (const rec of stores[s]) st.put(rec);
  }
  await done(tx);
}

// Wipes every store (used by "Erase all data").
export async function eraseAll() {
  const db = await openDB();
  const tx = db.transaction(ALL_STORES, 'readwrite');
  for (const s of ALL_STORES) tx.objectStore(s).clear();
  return done(tx);
}

export async function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch { return false; }
  }
  return false;
}
