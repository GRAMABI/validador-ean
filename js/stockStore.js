/**
 * stockStore.js — Persistencia en IndexedDB de:
 *   - reports   → conteos del módulo Control de Stock  (StockStore)
 *   - despachos → informes de lotes de pedidos cerrados (DespachoStore)
 *
 * Por qué IndexedDB y no localStorage: el catálogo ya ocupa ~612KB de los ~5MB
 * de localStorage. Un histórico ahí adentro puede llenar la cuota, y cuando eso
 * pasa falla TODA escritura del origen — incluido el guardado del catálogo y el
 * progreso de preparación de pedidos. IndexedDB tiene cuota propia y mucho más
 * holgada, así que el histórico no puede tirar abajo la app.
 *
 * Los dos stores viven en la MISMA base a propósito: así un solo
 * requestPersist() protege ambos del desalojo de Android, y un solo estimate()
 * informa el espacio total. El upgrade a v2 es puramente ADITIVO (cada store se
 * crea solo si falta), así que los conteos de stock ya guardados no se tocan.
 */

const _VeanDB = (() => {
  const DB_NAME    = 'vean_stock';
  const DB_VER     = 2;
  const STORE      = 'reports';
  const STORE_DESP = 'despachos';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { return reject(e); }

      req.onupgradeneeded = () => {
        const db = req.result;
        // Aditivo: NO borrar ni recrear stores existentes. Un deleteObjectStore
        // acá se llevaría puestos los conteos de stock del operario.
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('fecha', 'fecha');
          os.createIndex('estado', 'estado');
        }
        if (!db.objectStoreNames.contains(STORE_DESP)) {
          const od = db.createObjectStore(STORE_DESP, { keyPath: 'id' });
          od.createIndex('fecha', 'fecha');
        }
      };

      // Otra pestaña con la versión vieja abierta bloquea el upgrade. Sin esto
      // la app se queda muda esperando para siempre.
      req.onblocked = () => {
        reject(new Error('La app está abierta en otra pestaña. Cerrala y volvé a abrir el Validador.'));
      };

      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror   = () => reject(req.error || new Error('No se pudo abrir IndexedDB'));
    });
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t  = db.transaction(store, mode);
      const os = t.objectStore(store);
      let result;
      try { result = fn(os); } catch (e) { return reject(e); }
      t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      t.onerror    = () => reject(t.error);
      t.onabort    = () => reject(t.error || new Error('Transacción abortada'));
    }));
  }

  /** Pide almacenamiento persistente para que Android no desaloje los datos. */
  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { console.warn('[VeanDB] persist:', e); }
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

  return { open, tx, requestPersist, estimate, STORE, STORE_DESP };
})();

/* API de conteos de stock — se mantiene idéntica a la v1: el módulo de stock
   funciona y no se le cambia nada.
   Se publica en window (mismo patrón que scanner.js) porque app.js se carga
   ANTES que este archivo: sin esto, consultarlo desde app.js tira ReferenceError
   por TDZ en vez de dar undefined, que es lo que permite chequear si ya cargó. */
const StockStore = window.StockStore = (() => {
  const S = _VeanDB.STORE;
  return {
    open:  ()       => _VeanDB.open(),
    put:   (report) => _VeanDB.tx(S, 'readwrite', os => os.put(report)),
    get:   (id)     => _VeanDB.tx(S, 'readonly',  os => os.get(id)),
    del:   (id)     => _VeanDB.tx(S, 'readwrite', os => os.delete(id)),
    all:   ()       => _VeanDB.tx(S, 'readonly',  os => os.getAll()),
    requestPersist: _VeanDB.requestPersist,
    estimate:       _VeanDB.estimate,
  };
})();

/* API de informes de despacho (lotes de pedidos cerrados). */
const DespachoStore = window.DespachoStore = (() => {
  const S = _VeanDB.STORE_DESP;
  return {
    open:  ()      => _VeanDB.open(),
    put:   (rec)   => _VeanDB.tx(S, 'readwrite', os => os.put(rec)),
    get:   (id)    => _VeanDB.tx(S, 'readonly',  os => os.get(id)),
    del:   (id)    => _VeanDB.tx(S, 'readwrite', os => os.delete(id)),
    all:   ()      => _VeanDB.tx(S, 'readonly',  os => os.getAll()),
    requestPersist: _VeanDB.requestPersist,
    estimate:       _VeanDB.estimate,
  };
})();
