/**
 * catalog.js
 * Descarga el catálogo SKU→EAN→Descripción desde Google Sheets (CSV público)
 */
 
const CatalogService = (() => {
 
  const CSV_URL      = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRMWDQw0ieF8eB6j3bgr8ZSxFLE97X0VkeDiPp-_BdwpzcdaE81aMeHKvXfPBHWbQ/pub?gid=1452240181&single=true&output=csv';
  const COL_DESC     = 10;   // Columna K (base-0) — descripción
  const COL_SKU      = 12;   // Columna M (base-0) — SKU
  const COL_EAN      = 20;   // Columna U (base-0) — EAN
  const CACHE_KEY    = 'vean_catalog';
  const CACHE_TS_KEY = 'vean_catalog_ts';
  const CACHE_TTL    = 24 * 60 * 60 * 1000;
 
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
 
  function parseCSV(text) {
    const lines = text.split('\n');
    // map: SKU → { ean, desc }
    const map = new Map();
    let loaded = 0;
 
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = parseCSVLine(line);
      const sku  = (cols[COL_SKU]  || '').trim().toUpperCase();
      const ean  = (cols[COL_EAN]  || '').trim();
      const desc = (cols[COL_DESC] || '').trim();
      if (!sku) continue;
      if (!map.has(sku)) {
        // EAN puede estar vacío — lo guardamos igual para mostrar descripción
        map.set(sku, { ean: ean || null, desc });
        loaded++;
      }
    }
 
    console.log(`[Catalog] ${loaded} SKUs cargados`);
    if (loaded === 0) throw new Error('No se encontraron datos en las columnas K, M y U.');
    return map;
  }
 
  function loadCache() {
    try {
      const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0', 10);
      if (Date.now() - ts > CACHE_TTL) return null;
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      // Reconstruir Map desde objeto plano
      const obj = JSON.parse(raw);
      const map = new Map(Object.entries(obj));
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
 
  async function download() {
    console.log('[Catalog] Descargando desde Google Sheets...');
    const resp = await fetch(CSV_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar el catálogo`);
    const text = await resp.text();
    const map  = parseCSV(text);
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
 
  /**
   * Obtiene descripción y EAN de un SKU.
   * @returns {{ ean: string|null, desc: string }}
   */
  function getInfo(sku, catalog) {
    return catalog.get(sku.trim().toUpperCase()) || { ean: null, desc: '' };
  }
 
  /**
   * Valida el EAN escaneado contra el SKU del pedido.
   * FIX: solo acepta el EAN exacto del SKU — no cualquier EAN del catálogo.
   */
  function validate(sku, scannedEan, catalog) {
    const info = catalog.get(sku.trim().toUpperCase());
 
    if (!info) return { status: 'not_in_catalog', expected: null, desc: '' };
 
    // SKU existe pero no tiene EAN registrado
    if (!info.ean) return { status: 'no_ean', expected: null, desc: info.desc };
 
    // Comparación estricta: solo el EAN de ESTE SKU es válido
    const match = scannedEan.trim() === info.ean.trim();
    return {
      status: match ? 'ok' : 'error',
      expected: info.ean,
      desc: info.desc,
    };
  }
 
  return { getCatalog, validate, getInfo, lastSyncLabel, cachedCount };
})();
 



