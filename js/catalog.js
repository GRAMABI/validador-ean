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

  // Ignora el TTL — se usa como último recurso si no hay señal para descargar
  function loadCacheStale() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      return new Map(Object.entries(JSON.parse(raw)));
    } catch { return null; }
  }

  function saveCache(map) {
    // NO borrar antes de escribir: si el setItem falla por cuota llena, un
    // removeItem previo dejaba la tablet SIN catálogo (y sin app usable).
    // El setItem sobreescribe igual, y ante error se restaura el valor previo.
    const prev   = localStorage.getItem(CACHE_KEY);
    const prevTs = localStorage.getItem(CACHE_TS_KEY);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(map)));
      localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
    } catch (e) {
      console.warn('[Catalog] No se pudo guardar caché:', e);
      try {
        if (prev !== null) localStorage.setItem(CACHE_KEY, prev);
        if (prevTs !== null) localStorage.setItem(CACHE_TS_KEY, prevTs);
      } catch {}
    }
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
      // Sin caché fresco: intentar descargar, y si no hay señal, usar el
      // caché vencido antes que dejar al operario sin catálogo (24hs era
      // una bomba de tiempo para conectividad pobre de depósito).
      try {
        return await download();
      } catch (e) {
        const stale = loadCacheStale();
        if (stale) {
          console.warn('[Catalog] Descarga falló, usando caché vencido:', e.message);
          return stale;
        }
        throw e;
      }
    }
    // Sync explícito del operario: si falla, que se entere (sin fallback silencioso)
    return await download();
  }

  function getInfo(sku, catalog) {
    // Guard: un item sin SKU (alta manual) rompía todo el render con TypeError.
    if (!sku || !catalog) return { ean: null, desc: '', marca: 'Otros' };
    return catalog.get(String(sku).trim().toUpperCase()) || { ean: null, desc: '', marca: 'Otros' };
  }

  // ── NORMALIZACIÓN DE CÓDIGOS ────────────────────────────────
  // El catálogo mezcla EAN-13 (3013), UPC-A de 12 (94), GTIN-14 de bulto (35)
  // y un EAN-8. El lector puede devolver cualquiera de esas formas, así que
  // comparar en crudo (como se hacía) produce falsos negativos.
  function _digits(s) { return String(s || '').replace(/\D/g, ''); }

  function _checkDigit13(d12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += (+d12[i]) * (i % 2 === 0 ? 1 : 3);
    return (10 - (sum % 10)) % 10;
  }

  /**
   * Variantes equivalentes de un código, para indexar y para buscar.
   * - 12 dígitos (UPC-A) → se le antepone 0 para formar el EAN-13.
   * - 14 dígitos (GTIN-14 de bulto) → se quita el dígito indicador y se
   *   RECALCULA el verificador (quitarlo a lo bruto da un código inválido).
   */
  function eanVariants(code) {
    const d = _digits(code);
    if (!d) return [];
    const out = [d];
    if (d.length === 12) out.push('0' + d);
    if (d.length === 13 && d[0] === '0') out.push(d.slice(1));
    if (d.length === 14) {
      const base12 = d.slice(1, 13);
      out.push(base12 + _checkDigit13(base12));
    }
    return Array.from(new Set(out));
  }

  function eansMatch(a, b) {
    const va = eanVariants(a), vb = eanVariants(b);
    return va.some(x => vb.includes(x));
  }

  /**
   * Índice inverso EAN → [SKU,...]. Se construye UNA vez por catálogo.
   * Devuelve un array porque 137 EANs del catálogo están compartidos por
   * más de un SKU (hasta 12), así que el llamador debe desambiguar.
   */
  let _idxCache = null, _idxSrc = null;
  function eanIndex(catalog) {
    if (!catalog) return new Map();
    if (_idxCache && _idxSrc === catalog) return _idxCache;
    const idx = new Map();
    catalog.forEach((info, sku) => {
      if (!info || !info.ean) return;
      eanVariants(info.ean).forEach(v => {
        if (!idx.has(v)) idx.set(v, []);
        const arr = idx.get(v);
        if (!arr.includes(sku)) arr.push(sku);
      });
    });
    _idxCache = idx; _idxSrc = catalog;
    return idx;
  }

  /** Devuelve [{sku, ean, desc, marca}, ...] — vacío si no está en catálogo. */
  function findByEan(scannedEan, catalog) {
    if (!catalog) return [];
    const idx = eanIndex(catalog);
    const seen = new Set();
    const out = [];
    eanVariants(scannedEan).forEach(v => {
      (idx.get(v) || []).forEach(sku => {
        if (seen.has(sku)) return;
        seen.add(sku);
        const info = catalog.get(sku) || {};
        out.push({ sku, ean: info.ean || '', desc: info.desc || '', marca: info.marca || 'Otros' });
      });
    });
    return out;
  }

  function validate(sku, scannedEan, catalog) {
    const info = catalog.get(String(sku || '').trim().toUpperCase());
    if (!info)     return { status: 'not_in_catalog', expected: null, desc: '' };
    if (!info.ean) return { status: 'no_ean', expected: null, desc: info.desc };
    // Comparación normalizada: un UPC-A leído como 12 dígitos ahora matchea
    // contra el EAN-13 del catálogo (y el bulto GTIN-14 contra la unidad).
    const match = eansMatch(scannedEan, info.ean);
    return { status: match ? 'ok' : 'error', expected: info.ean, desc: info.desc };
  }

  return { getCatalog, validate, getInfo, lastSyncLabel, cachedCount,
           eanVariants, eansMatch, eanIndex, findByEan };
})();
