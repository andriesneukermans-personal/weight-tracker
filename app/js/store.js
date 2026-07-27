// IndexedDB wrapper. Object store 'entries' is keyed by date, so one
// entry per calendar date is enforced by the storage layer itself.

export function openDB(name = 'weight-tracker') {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('entries', { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(txn) {
  return new Promise((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });
}

export function getAllEntries(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('entries').objectStore('entries').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function putEntry(db, entry) {
  const txn = db.transaction('entries', 'readwrite');
  txn.objectStore('entries').put(entry);
  return done(txn);
}

export function replaceAllEntries(db, entries) {
  const txn = db.transaction('entries', 'readwrite');
  const os = txn.objectStore('entries');
  os.clear();
  for (const e of entries) os.put(e);
  return done(txn);
}
