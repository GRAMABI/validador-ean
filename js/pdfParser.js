/**
 * pdfParser.js
 * Parsea PDFs de pedidos — soporta 3 formatos:
 * 1. Mercado Libre (IDs numéricos 11 dígitos)
 * 2. Mercado Libre nuevo (IDs UUID o alfanuméricos)
 * 3. Gramabi propio (Orden #XXXX)
 */

const PdfParser = (() => {

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  async function extractText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map(i => i.str).join(' ');
      fullText += pageText + '\n';
    }
    return fullText;
  }

  function detectFormat(text) {
    if (/zipnova|Lista de pickeo|Lista de preparaci/i.test(text)) return 'zipnova';
    if (/Orden\s*#\d+\s*-\s*Paquete/i.test(text)) return 'gramabi';
    if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(text)) return 'ml_uuid';
    if (/\b\d{11}\b/.test(text)) return 'ml_numeric';
    return 'ml_uuid';
  }

  // ── FORMATO GRAMABI: "Orden #6829 - Paquete #1"
  function parseGramabi(text) {
    const orders = [];
    const normalized = text.replace(/\s+/g, ' ');

    // Dividir por "Orden #XXXX - Paquete"
    const blocks = normalized.split(/(?=Orden\s*#\d+\s*-\s*Paquete)/i);

    for (const block of blocks) {
      if (!block.trim()) continue;

      const ordenMatch = block.match(/Orden\s*#(\d+)\s*-\s*Paquete\s*#(\d+)/i);
      if (!ordenMatch) continue;

      const id    = ordenMatch[1];
      const buyer = extractBuyerGramabi(block);
      const items = extractItemsGramabi(block);

      if (items.length > 0) {
        orders.push({ id, packId: null, ventaId: null, buyer, items, status: 'pending', confirmedAt: null });
      }
    }
    return orders;
  }

  function extractBuyerGramabi(block) {
    const match = block.match(/Enviar a:\s*([A-ZÁÉÍÓÚÜÑ][^\n]+?)(?:\s*Teléfono|$)/i);
    if (match) return match[1].trim().replace(/\s+/g, ' ');
    return 'Comprador desconocido';
  }

  function extractItemsGramabi(block) {
    const items = [];
    // Formato: "Nombre del producto\nSKU: XXXXX\nN" o "SKU: XXXXX\nN"
    const skuRegex = /SKU:\s*([A-Z0-9ÁÉÍÓÚÜÑ_\-]+)/gi;
    let sm;
    while ((sm = skuRegex.exec(block)) !== null) {
      const sku = sm[1].trim().toUpperCase();
      // Buscar cantidad después del SKU
      const afterSku = block.slice(sm.index + sm[0].length, sm.index + sm[0].length + 50);
      const qtyMatch = afterSku.match(/^\s*(\d+)/);
      const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      items.push({ sku, qty, scanned: 0, scannedEan: null, status: 'pending', lastError: null });
    }
    return items;
  }

  // ── FORMATO ML NUMÉRICO: IDs de 11 dígitos
  function parseMlNumeric(text) {
    const orders = [];
    const normalized = text.replace(/\s+/g, ' ');
    const blockRegex = /(\b\d{11}\b)/g;
    const positions = [];
    let match;
    while ((match = blockRegex.exec(normalized)) !== null) {
      const before = normalized[match.index - 1];
      const after  = normalized[match.index + 11];
      if ((!before || /\s/.test(before)) && (!after || /\s/.test(after))) {
        positions.push({ index: match.index, id: match[1] });
      }
    }
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].index;
      const end   = positions[i + 1] ? positions[i + 1].index : normalized.length;
      const block = normalized.slice(start, end);
      const order = parseMlBlock(block, positions[i].id);
      if (order && order.items.length > 0) orders.push(order);
    }
    return orders;
  }

  // ── FORMATO ML UUID: IDs tipo "f996ad7c-a59d-..." o "HC402989495AR"
  function parseMlUuid(text) {
    const orders = [];
    const normalized = text.replace(/\s+/g, ' ');

    // IDs pueden ser: UUID (con letras fi → f, i), alfanumérico con AR, etc.
    // Normalizar "fi" → "f" + detectar patrón
    const norm2 = normalized.replace(/fi/g, 'f').replace(/fia/g, 'fa');

    // Detectar bloques por UUID o por código alfanumérico tipo HC402989495AR
    const idPattern = /(?:^|\s)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z]{2}\d{9,12}[A-Z]{2})\s/gi;
    const positions = [];
    let m;
    while ((m = idPattern.exec(norm2)) !== null) {
      positions.push({ index: m.index, id: m[1] });
    }

    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].index;
      const end   = positions[i + 1] ? positions[i + 1].index : norm2.length;
      const block = norm2.slice(start, end);
      const order = parseMlBlock(block, positions[i].id);
      if (order && order.items.length > 0) orders.push(order);
    }
    return orders;
  }

  function parseMlBlock(block, id) {
    const packMatch = block.match(/Pack ID:\s*(\d+)/);
    const packId    = packMatch ? packMatch[1] : null;
    const ventaMatch = block.match(/Venta:\s*(\d+)/);
    const ventaId   = ventaMatch ? ventaMatch[1] : null;

    // Nombre del comprador
    let buyer = 'Comprador desconocido';
    const buyerMatch = block.match(/(?:Venta:\s*\d+\s*)([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s]+?)(?=\s*SKU:)/);
    if (buyerMatch) {
      buyer = buyerMatch[1].trim().replace(/\s+/g, ' ');
    } else {
      const fallback = block.match(/(?:[a-f0-9\-]{8,}|[A-Z]{2}\d+[A-Z]{2})\s+(?:Pack ID:\s*\d+\s*)?(?:Venta:\s*\d+\s*)?([A-ZÁÉÍÓÚÜÑ][^\d]+?)(?=SKU:)/i);
      if (fallback) buyer = fallback[1].trim().replace(/\s+/g, ' ');
    }

    // SKUs y cantidades — FIX: incluir Ñ y caracteres especiales en SKU
    const skuRegex  = /SKU:\s*([A-Z0-9ÁÉÍÓÚÜÑ_\-]+)/gi;
    const qtyRegex  = /Cantidad:\s*(\d+)/g;
    const skus = [];
    const qtys = [];
    let sm, qm;
    while ((sm = skuRegex.exec(block)) !== null) skus.push(sm[1].trim().toUpperCase());
    while ((qm = qtyRegex.exec(block))  !== null) qtys.push(parseInt(qm[1], 10));

    if (skus.length === 0) return null;

    const items = skus.map((sku, idx) => ({
      sku,
      qty: qtys[idx] || 1,
      scanned: 0,
      scannedEan: null,
      status: 'pending',
      lastError: null,
    }));

    return { id, packId, ventaId, buyer, items, status: 'pending', confirmedAt: null };
  }

  // ── FORMATO ZIPNOVA ─────────────────────────────────────────
  function parseZipnova(text) {
    const orders = [];

    // Normalizar completamente: unir todo en una sola línea
    const normalized = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
    console.log('[Zipnova] Texto normalizado (primeros 300 chars):', normalized.slice(0, 300));

    // ESTRATEGIA 1: Parsear "Lista de preparación" con ID de paquete + etiqueta + SKU (qty)
    const listStart = normalized.search(/Lista de preparaci[oó]n/i);
    if (listStart !== -1) {
      const listText = normalized.slice(listStart);
      console.log('[Zipnova] Sección preparación encontrada en pos', listStart);
      console.log('[Zipnova] Primeros 400 chars:', listText.slice(0, 400));

      // Patrón: XXXX-XXXXXXXX  XXXX-XXXXXXXX-XXXX  SKU (qty)
      const re1 = /(\d{4}-\d{8})\s+\d{4}-\d{8}-\d{4}\s+([A-Z0-9]+)\s*\((\d+)\)/g;
      let m;
      while ((m = re1.exec(listText)) !== null) {
        const id  = m[1];
        const sku = m[2].toUpperCase();
        const qty = parseInt(m[3], 10);
        let order = orders.find(o => o.id === id);
        if (!order) {
          order = { id, packId: null, ventaId: null, buyer: 'Paquete ' + id,
                    items: [], status: 'pending', confirmedAt: null };
          orders.push(order);
        }
        order.items.push({ sku, qty, scanned: 0, scannedEan: null,
                           status: 'pending', lastError: null });
      }
    }

    // ESTRATEGIA 2 (fallback): Si no encontró nada, usar "Lista de pickeo"
    // Formato: SKU  descripcion  cantidad (al final de la línea)
    if (orders.length === 0) {
      console.log('[Zipnova] Estrategia 1 falló, intentando con Lista de pickeo...');
      const pickStart = normalized.search(/Lista de pickeo/i);
      const pickEnd   = normalized.search(/Fin del pickeo|Lista de preparaci/i);
      if (pickStart !== -1) {
        const pickText = normalized.slice(pickStart, pickEnd !== -1 ? pickEnd : undefined);
        // Formato pickeo: SKU descripcion... cantidad
        // El SKU es la primera palabra (mayúsculas/números), la cantidad es el último número antes del siguiente SKU
        const pickRe = /\b([A-Z][A-Z0-9]{2,})\b[^\d]*(\d+)(?=\s+[A-Z][A-Z0-9]{2,}|\s*Fin)/g;
        let pm;
        while ((pm = pickRe.exec(pickText)) !== null) {
          const sku = pm[1];
          const qty = parseInt(pm[2], 10);
          if (sku.length < 4) continue;
          // En modo pickeo no tenemos ID de paquete, crear uno por SKU
          const fakeId = 'PICK-' + sku;
          orders.push({
            id: fakeId, packId: null, ventaId: null,
            buyer: sku + ' ×' + qty,
            items: [{ sku, qty, scanned: 0, scannedEan: null,
                      status: 'pending', lastError: null }],
            status: 'pending', confirmedAt: null
          });
        }
      }
    }

    console.log('[PDF Zipnova] ' + orders.length + ' paquetes/items encontrados');
    return orders;
  }

  async function parse(file) {
    const text   = await extractText(file);
    const format = detectFormat(text);
    console.log('[PDF] Formato detectado:', format);

    let orders = [];
    if (format === 'zipnova') {
      orders = parseZipnova(text);
    } else if (format === 'gramabi') {
      orders = parseGramabi(text);
    } else if (format === 'ml_numeric') {
      orders = parseMlNumeric(text);
      if (orders.length === 0) orders = parseMlUuid(text);
    } else {
      orders = parseMlUuid(text);
      if (orders.length === 0) orders = parseMlNumeric(text);
    }

    console.log(`[PDF] ${orders.length} pedidos encontrados`);
    return orders;
  }

  return { parse };
})();
