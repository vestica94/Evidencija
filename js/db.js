// Jednostavan omotač oko IndexedDB-a. Svi podaci ostaju na uređaju.
const DB_NAME = 'evidencija';
const DB_VERSION = 1;
export const STORES = ['kv', 'labels', 'events', 'docs'];

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) {
            db.createObjectStore(s, { keyPath: 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function getAll(name) {
  return wrap((await store(name)).getAll());
}

export async function get(name, id) {
  return wrap((await store(name)).get(id));
}

export async function put(name, value) {
  return wrap((await store(name, 'readwrite')).put(value));
}

export async function del(name, id) {
  return wrap((await store(name, 'readwrite')).delete(id));
}

export async function clear(name) {
  return wrap((await store(name, 'readwrite')).clear());
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Traži od preglednika da ne briše podatke kad ponestane prostora.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (_) { /* nije podržano */ }
  return false;
}
