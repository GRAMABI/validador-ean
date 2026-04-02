/**
 * catalog.js
 * Descarga el catálogo SKU→EAN desde Google Sheets (CSV público)
 * y construye un Map<SKU, EAN> para validación.
 */
 
const CatalogService = (() => {
 
  // URL CSV pública de Google Sheets — hoja "Publicaciones"
  const CSV_URL      = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRMWDQw0ieF8eB6j3bgr8ZSxFLE97X0VkeDiPp-_BdwpzcdaE81aMeHKvXfPBHWbQ/pub?gid=1452240181&single=true&output=csv';
  const COL_SKU      = 12;   // Columna M (base-0)
  const COL_EAN      = 20;   // Columna U (base-0)
  const CACHE_KEY    = 'vean_catalog';
  const CACHE_TS_KEY = 'vean_catalog_ts';
  const CACHE_TTL    = 24 * 60 * 60 * 1000; // 24 horas
 
  // Parsea el texto CSV y devuelve Map<SKU, EAN>
  function parseCSV(text) {
    const lines = text.split('\n');
    const map = new Map();
    let loaded = 0;
 
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
 
      const cols = parseCSVLine(line);
      const sku = (cols[COL_SKU] || '').trim().toUpperCase();
      const ean = (cols[COL_EAN] || '').trim();
 
      if (!sku || !ean) continue;
      if (!map.has(sku)) { map.set(sku, ean); loaded++; }
    }
 
    console.log(`[Catalog] ${loaded} SKUs cargados desde CSV`);
 
    if (loaded === 0) {
      console.warn('[Catalog] 0 SKUs. Primeras líneas:', lines.slice(0, 3));
      throw new Error('No se encontraron datos en las columnas M y U. Verificá la hoja "Publicaciones".');
    }
 
    return map;
  }
 
  // Parsea una línea CSV respetando campos entre comillas
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
 
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }
 
  // Caché local
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
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(map)));
      localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
    } catch (e) { console.warn('[Catalog] No se pudo guardar caché:', e); }
  }
 
  // Descarga el CSV desde Google Sheets
  async function download() {
    console.log('[Catalog] Descargando desde Google Sheets...');
    const resp = await fetch(CSV_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar el catálogo`);
    const text = await resp.text();
    const map  = parseCSV(text);
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
 
  function validate(sku, scannedEan, catalog) {
    const key      = sku.trim().toUpperCase();
    const expected = catalog.get(key);
    if (!expected) return { status: 'not_in_catalog', expected: null };
    const match = scannedEan.trim() === expected.trim();
    return { status: match ? 'ok' : 'error', expected };
  }
 
  return { getCatalog, validate, lastSyncLabel, cachedCount };
})();
