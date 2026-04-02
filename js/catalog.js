/**
 * catalog.js
 * Descarga el Excel desde OneDrive (sin login) y construye Map<SKU, EAN>
 */
 
const CatalogService = (() => {
 
  const SHARED_LINK  = 'https://1drv.ms/x/c/46155be10bdedafa/IQD62t4L4VsVIIBGid8HAAAAAeq3Dwdezoecx4cXEg2z1DY?e=MK9wWh';
  const SHEET_NAME   = 'Publicaciones';
  const COL_SKU      = 12;   // Columna M (base-0)
  const COL_EAN      = 20;   // Columna U (base-0)
  const CACHE_KEY    = 'vean_catalog';
  const CACHE_TS_KEY = 'vean_catalog_ts';
  const CACHE_TTL    = 24 * 60 * 60 * 1000; // 24 horas
 
  // Genera todas las URLs posibles para intentar la descarga
  function buildDownloadUrls(link) {
    const b64 = btoa(link).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return [
      // Estrategia 1: API de shares de OneDrive (la más directa)
      `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`,
      // Estrategia 2: Graph API
      `https://graph.microsoft.com/v1.0/shares/u!${b64}/root/content`,
      // Estrategia 3: URL de descarga directa de OneDrive personal
      link.replace('1drv.ms/x', '1drv.ms/x/download').replace(/\?.*/, '') + '?download=1',
    ];
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
 
  // Parsea el ArrayBuffer del Excel y devuelve el Map<SKU, EAN>
  function parseExcel(buf) {
    const wb = XLSX.read(buf, { type: 'array' });
 
    // Buscar la hoja — puede llamarse "Publicaciones" o similar
    let sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('publicacion'));
    if (!sheetName) sheetName = wb.SheetNames[0];
    console.log(`[Catalog] Usando hoja: "${sheetName}"`);
 
    const ws   = wb.Sheets[sheetName];
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
    if (loaded === 0) {
      // Mostrar primeras filas para debug
      console.warn('[Catalog] 0 SKUs. Primeras filas:', rows.slice(0, 3));
      throw new Error(`No se encontraron datos en columnas M y U. Verificá la hoja "${sheetName}".`);
    }
    return map;
  }
 
  // Descarga intentando múltiples URLs
  async function download() {
    const urls = buildDownloadUrls(SHARED_LINK);
    let lastError = null;
 
    for (const url of urls) {
      try {
        console.log('[Catalog] Intentando:', url);
        const resp = await fetch(url, {
          headers: { 'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*' }
        });
        if (!resp.ok) {
          lastError = new Error(`HTTP ${resp.status} en ${url}`);
          console.warn('[Catalog]', lastError.message);
          continue;
        }
        const buf = await resp.arrayBuffer();
        const map = parseExcel(buf);
        saveCache(map);
        return map;
      } catch (e) {
        lastError = e;
        console.warn('[Catalog] Error con URL:', url, e.message);
      }
    }
 
    // Si todas fallaron, dar instrucciones claras
    throw new Error(
      'No se pudo descargar el catálogo desde OneDrive. ' +
      'Verificá que el link sea público ("Cualquier persona con el vínculo puede ver"). ' +
      'Error: ' + (lastError?.message || 'desconocido')
    );
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
 
