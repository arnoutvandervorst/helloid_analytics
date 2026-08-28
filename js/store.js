/* Snapshot storage. IndexedDB when the page is served over http(s); an in-memory
   fallback (plus JSON export) when opened straight from the filesystem, where
   browsers give the page an opaque origin and refuse persistent storage. */
(function (HR) {
  'use strict';

  const DB_NAME = 'helloid-recon';
  const DB_VERSION = 2;
  const STORE = 'snapshots';
  /* The vault, the rules and the activity exports describe the tenant rather than a
     single reconciliation run, so they outlive any one snapshot and are kept apart. */
  const CONTEXT = 'context';

  let dbPromise = null;
  let memory = new Map();
  let usingMemory = false;

  function open() {
    /* Storage off: reject before touching the cached connection, so every
       caller drops into its existing in-memory fallback. Not cached, so
       re-enabling works without a reload. */
    if (HR.storageMode && !HR.storageMode.enabled()) {
      usingMemory = true;
      return Promise.reject(new Error('storage disabled'));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('importedAt', 'importedAt');
        }
        if (!db.objectStoreNames.contains(CONTEXT)) {
          db.createObjectStore(CONTEXT, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    }).catch(err => { usingMemory = true; throw err; });
    return dbPromise;
  }

  function tx(mode, fn, storeName) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(storeName || STORE, mode);
      const os = t.objectStore(storeName || STORE);
      let result;
      try { result = fn(os); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    })).catch(err => { usingMemory = true; throw err; });
  }

  const isMemory = () => usingMemory;

  async function list() {
    try {
      const rows = await tx('readonly', os => os.getAll());
      return (rows || []).map(stripHeavy).sort((a, b) => b.importedAt - a.importedAt);
    } catch (e) {
      return Array.from(memory.values()).map(stripHeavy).sort((a, b) => b.importedAt - a.importedAt);
    }
  }

  async function get(id) {
    try { return await tx('readonly', os => os.get(id)); }
    catch (e) { return memory.get(id) || null; }
  }

  async function put(snap) {
    memory.set(snap.id, snap);
    try { await tx('readwrite', os => os.put(snap)); return { persisted: true }; }
    catch (e) { usingMemory = true; return { persisted: false, error: e }; }
  }

  async function remove(id) {
    memory.delete(id);
    try { await tx('readwrite', os => os.delete(id)); } catch (e) { /* memory only */ }
  }

  async function clear() {
    memory.clear();
    try { await tx('readwrite', os => os.clear()); } catch (e) { /* memory only */ }
  }

  /* Raw text is kept rather than the parsed object: re-parsing costs milliseconds and
     avoids any question about what survives structured cloning. */
  let contextMemory = null;

  async function saveContext(ctx) {
    contextMemory = Object.assign({}, contextMemory, ctx, { id: 'current', savedAt: Date.now() });
    try { await tx('readwrite', os => os.put(contextMemory), CONTEXT); return { persisted: true }; }
    catch (e) { usingMemory = true; return { persisted: false, error: e }; }
  }

  async function loadContext() {
    try {
      const stored = await tx('readonly', os => os.get('current'), CONTEXT);
      if (stored) contextMemory = stored;
    } catch (e) { /* memory only */ }
    return contextMemory;
  }

  async function clearContext() {
    contextMemory = null;
    try { await tx('readwrite', os => os.delete('current'), CONTEXT); } catch (e) { /* memory only */ }
  }

  function stripHeavy(s) {
    const { records, ...rest } = s;
    return { ...rest, rowCount: rest.rowCount ?? (records ? records.length : 0) };
  }

  function makeSnapshot(parsed, model, name) {
    return {
      id: 'snap_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: name || parsed.meta.fileName.replace(/\.csv$/i, ''),
      fileName: parsed.meta.fileName,
      importedAt: Date.now(),
      fingerprint: parsed.meta.fingerprint,
      rowCount: parsed.records.length,
      summary: model.summary,
      records: parsed.records
    };
  }

  async function exportAll() {
    const ids = (await list()).map(s => s.id);
    const full = [];
    for (const id of ids) { const s = await get(id); if (s) full.push(s); }
    return JSON.stringify({ kind: 'helloid-recon-snapshots', version: 1, exportedAt: Date.now(), snapshots: full });
  }

  async function importJSON(text) {
    const data = JSON.parse(text);
    const snaps = Array.isArray(data) ? data : (data.snapshots || []);
    if (!snaps.length) throw new Error('No snapshots found in that file.');
    for (const s of snaps) {
      if (!s.id || !s.records) throw new Error('Snapshot file is malformed.');
      await put(s);
    }
    return snaps.length;
  }

  /** The kill-switch's half: close the connection, delete the database, and
      forget the in-memory copies so the archive reads as empty afterwards. */
  async function wipeDb() {
    if (dbPromise) {
      try { const db = await dbPromise; if (db) db.close(); } catch (e) { /* never opened */ }
    }
    dbPromise = null;
    memory = new Map();
    contextMemory = null;
    await new Promise(res => {
      let req;
      try { req = indexedDB.deleteDatabase(DB_NAME); } catch (e) { return res(); }
      req.onsuccess = req.onerror = req.onblocked = () => res();
    });
  }

  HR.store = { list, get, put, remove, clear, makeSnapshot, exportAll, importJSON, isMemory,
    saveContext, loadContext, clearContext, wipeDb };
})(window.HR);
