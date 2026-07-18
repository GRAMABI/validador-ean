/**
 * stockStore.js — Persistencia de los conteos de stock en IndexedDB.
 *
 * Por qué IndexedDB y no localStorage: el catálogo ya ocupa ~573KB de los ~5MB
 * de localStorage. Un histórico de conteos ahí adentro puede llenar la cuota, y
 * cuando eso pasa falla TODA escritura del origen — incluido el guardado del
 * catálogo y el progreso de preparación de pedidos. IndexedDB tiene cuota propia
 * y mucho más holgada, así que el módulo de stock no puede tirar abajo la app.
 */

const StockStore = (() => {
  const DB_NAME  = 'vean_stock';
  const DB_VER   = 1;
  const STORE    = 'reports';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('fecha', 'fecha');
          os.createIndex('estado', 'estado');
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror   = () => reject(req.error || new Error('No se pudo abrir IndexedDB'));
    });
  }

  function _tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const os = tx.objectStore(STORE);
      let result;
      try { result = fn(os); } catch (e) { return reject(e); }
      tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => reject(tx.error || new Error('Transacción abortada'));
    }));
  }

  function put(report)  { return _tx('readwrite', os => os.put(report)); }
  function get(id)      { return _tx('readonly',  os => os.get(id)); }
  function del(id)      { return _tx('readwrite', os => os.delete(id)); }
  function all()        { return _tx('readonly',  os => os.getAll()); }

  /** Pide almacenamiento persistente para que Android no desaloje los conteos. */
  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { console.warn('[StockStore] persist:', e); }
    return false;
  }

  async function estimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        return { usage: usage || 0, quota: quota || 0 };
      }
    } catch {}
    return null;
  }

  return { open, put, get, del, all, requestPersist, estimate };
})();
