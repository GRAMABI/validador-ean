/**
 * catalog.js
 * Lee el catálogo SKU→EAN desde catalog_data.json (alojado en GitHub)
 * Para actualizar: subir nuevo catalog_data.json a GitHub
 */

const CatalogService = (() => {

  const JSON_URL     = './catalog_data.json';
  const CACHE_KEY    = 'vean_catalog';
  const CACHE_TS_KEY = 'vean_catalog_ts';
  const CACHE_TTL    = 24 * 60 * 60 * 1000;

  function loadCache() {
    try {
      const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0', 10);
      if (Date.now() - ts > CACHE_TTL) return null;
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const map = new Map(Object.entries(JSON.parse(raw)));
      console.log(`[Catalog] Desde caché: ${map.size} SKUs`);
      return map;
    } catch { return null; }
  }

  function saveCache(map) {
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_TS_KEY);
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(map)));
      localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
    } catch (e) { console.warn('[Catalog] No se pudo guardar caché:', e); }
  }

  async function download() {
    console.log('[Catalog] Descargando catalog_data.json...');
    const resp = await fetch(JSON_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar el catálogo`);
    const obj = await resp.json();
    // obj es { SKU: { ean, desc }, ... }
    const map = new Map(Object.entries(obj));
    console.log(`[Catalog] ${map.size} SKUs cargados`);
    saveCache(map);
    return map;
  }

  function lastSyncLabel() {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0', 10);
    if (!ts) return 'Sin sincronizar';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'hace menos de 1 minuto';
    if (mins < 60) return `hace ${mins} min`;
    const h = Math.floor(mins / 60);
    if (h < 24)    return `hace ${h} hs`;
    return `hace ${Math.floor(h / 24)} días`;
  }

  function cachedCount() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return 0;
      return Object.keys(JSON.parse(raw)).length;
    } catch { return 0; }
  }

  async function getCatalog(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = loadCache();
      if (cached) return cached;
    }
    return await download();
  }

  function getInfo(sku, catalog) {
    return catalog.get(sku.trim().toUpperCase()) || { ean: null, desc: '' };
  }

  function validate(sku, scannedEan, catalog) {
    const info = catalog.get(sku.trim().toUpperCase());
    if (!info)     return { status: 'not_in_catalog', expected: null, desc: '' };
    if (!info.ean) return { status: 'no_ean', expected: null, desc: info.desc };
    const match = scannedEan.trim() === info.ean.trim();
    return { status: match ? 'ok' : 'error', expected: info.ean, desc: info.desc };
  }

  return { getCatalog, validate, getInfo, lastSyncLabel, cachedCount };
})();
