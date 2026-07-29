/* Snapshot storage. IndexedDB when the page is served over http(s); an in-memory
   fallback (plus JSON export) when opened straight from the filesystem, where
   browsers give the page an opaque origin and refuse persistent storage. */
(function (HR) {
  'use strict';

  const DB_NAME = 'helloid-recon';
  const DB_VERSION = 1;
  const STORE = 'snapshots';

  let dbPromise = null;
  let memory = new Map();
  let usingMemory = false;

  function open() {
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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    }).catch(err => { usingMemory = true; throw err; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const os = t.objectStore(STORE);
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

  HR.store = { list, get, put, remove, clear, makeSnapshot, exportAll, importJSON, isMemory };
})(window.HR);
