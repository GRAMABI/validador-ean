/**
 * catalog.js
 * Descarga el Excel desde OneDrive (sin login) y construye Map<SKU, EAN>
 */

const CatalogService = (() => {

  const SHARED_LINK  = 'https://1drv.ms/x/c/46155be10bdedafa/IQD62t4L4VsVIIBGVZMHAAAAAZfgPqrerynkfFHqnIGaMCM?e=nFhHVq';
  const SHEET_NAME   = 'Publicaciones';
  const COL_SKU      = 12;   // Columna M (base-0)
  const COL_EAN      = 20;   // Columna U (base-0)
  const CACHE_KEY    = 'vean_catalog';
  const CACHE_TS_KEY = 'vean_catalog_ts';
  const CACHE_TTL    = 24 * 60 * 60 * 1000; // 24 horas

  // Construye la URL de descarga directa a partir del link compartido
  function buildDownloadUrl(link) {
    const b64 = btoa(link).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`;
  }

  // Intenta cargar el catálogo desde localStorage
  function loadCache() {
    try {
      const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0', 10);
      if (Date.now() - ts > CACHE_TTL) return null;
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const map = new Map(Object.entries(obj));
      console.log(`[Catalog] Cache: ${map.size} SKUs`);
      return map;
    } catch { return null; }
  }

  function saveCache(map) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(map)));
      localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
    } catch (e) { console.warn('[Catalog] No se pudo guardar cache:', e); }
  }

  // Descarga y parsea el Excel
  async function download() {
    const url = buildDownloadUrl(SHARED_LINK);
    console.log('[Catalog] Descargando desde OneDrive...');

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar el Excel`);

    const buf  = await resp.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });

    if (!wb.SheetNames.includes(SHEET_NAME)) {
      throw new Error(`Hoja "${SHEET_NAME}" no encontrada. Disponibles: ${wb.SheetNames.join(', ')}`);
    }

    const ws   = wb.Sheets[SHEET_NAME];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const map = new Map();
    let loaded = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sku = String(row[COL_SKU] ?? '').trim().toUpperCase();
      const ean = String(row[COL_EAN] ?? '').trim();
      if (!sku || !ean) continue;
      if (!map.has(sku)) { map.set(sku, ean); loaded++; }
    }

    console.log(`[Catalog] ${loaded} SKUs cargados`);
    saveCache(map);
    return map;
  }

  // Tiempo desde última sincronización
  function lastSyncLabel() {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0', 10);
    if (!ts) return 'Sin sincronizar';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'hace menos de 1 minuto';
    if (mins < 60) return `hace ${mins} min`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `hace ${h} hs`;
    return `hace ${Math.floor(h / 24)} días`;
  }

  function cachedCount() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return 0;
      return Object.keys(JSON.parse(raw)).length;
    } catch { return 0; }
  }

  // API pública
  async function getCatalog(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = loadCache();
      if (cached) return cached;
    }
    return await download();
  }

  function validate(sku, scannedEan, catalog) {
    const key = sku.trim().toUpperCase();
    const expected = catalog.get(key);
    if (!expected) return { status: 'not_in_catalog', expected: null };
    const match = scannedEan.trim() === expected.trim();
    return { status: match ? 'ok' : 'error', expected };
  }

  return { getCatalog, validate, lastSyncLabel, cachedCount };
})();
