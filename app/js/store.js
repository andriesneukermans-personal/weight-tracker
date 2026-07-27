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

// Atomic merge-with-current-store write. Reads the store's current
// contents, merges with incoming inside the same readwrite transaction as
// the clear+rewrite, so a concurrent putEntry (e.g. a user logging an entry
// mid-sync) is ordered either entirely before this transaction (and thus
// survives via newest-updatedAt) or entirely after (and thus isn't
// clobbered) rather than being wiped by a stale snapshot.
export function mergeReplaceEntries(db, incoming, mergeFn) {
  return new Promise((resolve, reject) => {
    const txn = db.transaction('entries', 'readwrite');
    const os = txn.objectStore('entries');
    const req = os.getAll();
    req.onsuccess = () => {
      const { merged } = mergeFn(req.result, incoming);
      os.clear();
      for (const e of merged) os.put(e);
    };
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });
}
