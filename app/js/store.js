// IndexedDB wrapper. Object store 'entries' is keyed by id
// (`date#time`, or the bare date for untimed entries), so several
// weigh-ins per day can coexist while a given moment stays unique.

export function openDB(name = 'weight-tracker') {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 2);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (ev.oldVersion < 1) {
        db.createObjectStore('entries', { keyPath: 'id' });
        return;
      }
      // v1 (keyed by date) → v2 (keyed by id): re-key existing rows
      const getReq = req.transaction.objectStore('entries').getAll();
      getReq.onsuccess = () => {
        const rows = getReq.result;
        db.deleteObjectStore('entries');
        const os = db.createObjectStore('entries', { keyPath: 'id' });
        for (const e of rows) {
          os.put({ ...e, id: e.time ? `${e.date}#${e.time}` : e.date });
        }
      };
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
