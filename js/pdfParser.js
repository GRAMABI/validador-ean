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

  // ── FORMATO ML (numérico y UUID): parser unificado línea por línea
  function parseMlNumeric(text) { return parseMlLineByLine(text); }
  function parseMlUuid(text)    { return parseMlLineByLine(text); }

  function parseMlLineByLine(text) {
    const orders = [];

    // Normalizar artefactos del PDF de ML ("fi" → "f")
    const normalized = text.replace(/fi/g, 'f').replace(/fia/g, 'fa');
    const lines = normalized.split(/\n/).map(l => l.trim()).filter(l => l);

    // Patrón de ID de envío: línea que sea SOLO un identificador
    // Formatos: UUID, HC/HEnúmeroAR, numérico largo, alfanumérico corto/largo
    const idRe = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z]{2}\d{6,15}[A-Z0-9]{0,10}|\d{8,20}|[A-Z0-9]{5,25})$/i;
    const skipRe = /^(SKU:|Cantidad:|Color:|Pack ID:|Venta:|Voltaje:|Nombre:|Frecuencia:|Acabado:|Despacha|Lista|Identificaci|Transportista|Nro\.)/i;

    // Encontrar posiciones de todos los IDs de pedido
    const positions = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!idRe.test(line) || skipRe.test(line)) continue;
      // Verificar que en las próximas líneas (o la misma) haya un SKU
      // Algunos pedidos tienen "Nombre SKU: XXX" en la misma línea del siguiente texto
      const ctx = lines.slice(i, i + 15).join(' ');
      if (ctx.includes('SKU:') || ctx.includes('Venta:')) {
        positions.push({ lineIdx: i, id: line });
      }
    }

    // Extraer bloque de cada pedido
    for (let p = 0; p < positions.length; p++) {
      const start = positions[p].lineIdx;
      const end   = positions[p + 1] ? positions[p + 1].lineIdx : lines.length;
      const block = lines.slice(start, end).join(' ');
      const order = parseMlBlock(block, positions[p].id);
      if (order && order.items.length > 0) orders.push(order);
    }

    return orders;
  }

  function parseMlBlock(block, id) {
    const packMatch = block.match(/Pack ID:\s*(\d+)/);
    const packId    = packMatch ? packMatch[1] : null;
    const ventaMatch = block.match(/Venta:\s*(\d+)/);
    const ventaId   = ventaMatch ? ventaMatch[1] : null;

    // Nombre del comprador — puede estar en línea propia o junto al SKU
    let buyer = 'Comprador desconocido';
    // Intentar extraer entre Venta: y SKU:
    const buyerMatch = block.match(/(?:Venta:\s*\d+\s*)([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s]+?)(?=\s*SKU:|\s*Pack ID:)/);
    if (buyerMatch) {
      buyer = buyerMatch[1].trim().replace(/\s+/g, ' ');
    } else {
      // Fallback: texto entre el ID y el primer SKU
      const fallback = block.match(/(?:[a-f0-9\-]{8,}|[A-Z]{2}\d+[A-Z0-9]*|\d{8,})\s+(?:Pack ID:\s*\d+\s*)?(?:Venta:\s*\d+\s*)?([A-ZÁÉÍÓÚÜÑ][^\d]+?)(?=SKU:)/i);
      if (fallback) buyer = fallback[1].trim().replace(/\s+/g, ' ');
    }

    // SKUs y cantidades — incluir Ñ y caracteres especiales, minúsculas también
    const skuRegex  = /SKU:\s*([A-Za-z0-9ÁÉÍÓÚÜÑ_\-]+)/gi;
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
