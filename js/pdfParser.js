/**
 * pdfParser.js — v20260610b
 * Compatible con Android 11 / Chrome viejo (Samsung SM-T510 y similares).
 *
 * Estrategia de carga de pdf.js worker (en orden de preferencia):
 * 1. workerSrc apuntando a unpkg.com (versión 2.16.105)
 * 2. workerSrc apuntando a cdnjs (versión 3.11.174)
 * 3. Blob URL con worker inline (no requiere CDN externo)
 * 4. Sin worker (FakeWorker de pdf.js, más lento pero funciona)
 *
 * Formatos de PDF soportados:
 * - zipnova        → Lista de pickeo / preparación de Zipnova
 * - gramabi        → TiendaNube/Gramabi con "Orden #N - Paquete #N"
 * - full           → Envíos a Full de Mercado Libre (inbound al centro de distribución)
 * - ml_uuid        → Mercado Libre con ID tipo UUID
 * - ml_numeric     → Mercado Libre con ID numérico
 * - ml (default)   → Mercado Libre alfanumérico u otros (vía parseMlUnified)
 */
const PdfParser = (() => {
  function makeInlineWorkerUrl() {
    try {
      const workerCode = `
        self.onmessage = function(e) {
          // Worker dummy — pdf.js lo detecta y cae a FakeWorker
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      return URL.createObjectURL(blob);
    } catch(e) {
      return '';
    }
  }
  async function extractText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const strategies = [
      () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js';
        return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      },
      () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      },
      () => {
        const blobUrl = makeInlineWorkerUrl();
        if (blobUrl) pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl;
        else pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      },
      () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        return pdfjsLib.getDocument({
          data: arrayBuffer,
          isEvalSupported: false,
        }).promise;
      },
    ];
    let pdf = null;
    let lastError = null;
    for (const strategy of strategies) {
      try {
        pdf = await strategy();
        if (pdf) break;
      } catch(e) {
        console.warn('[pdfParser] estrategia falló:', e.message);
        lastError = e;
      }
    }
    if (!pdf) {
      throw new Error('No se pudo leer el PDF. Probá actualizando Chrome o usando otro navegador (Firefox, Samsung Internet).');
    }
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
    // Envíos a Full — chequear ANTES que ML porque comparte el código alfanumérico
    if (/Envío\s*#\d{6,}/i.test(text)
        || /Listado de productos e instrucciones de preparaci/i.test(text)
        || /Productos del envío:\s*\d+\s*\|\s*Total de unidades:\s*\d+/i.test(text)) {
      return 'full';
    }
    if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(text)) return 'ml_uuid';
    if (/\b\d{11}\b/.test(text)) return 'ml_numeric';
    return 'ml_uuid';
  }
  // ── FORMATO GRAMABI
  function parseGramabi(text) {
    const orders = [];
    const normalized = text.replace(/\s+/g, ' ');
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
    const skuRegex = /SKU:\s*([A-Z0-9ÁÉÍÓÚÜÑ_\-]+)/gi;
    let sm;
    while ((sm = skuRegex.exec(block)) !== null) {
      const sku = sm[1].trim().toUpperCase();
      const afterSku = block.slice(sm.index + sm[0].length, sm.index + sm[0].length + 50);
      const qtyMatch = afterSku.match(/^\s*(\d+)/);
      const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      items.push({ sku, qty, scanned: 0, scannedEan: null, status: 'pending', lastError: null });
    }
    return items;
  }
  // ── FORMATO ENVÍOS A FULL (Mercado Libre inbound)
  // Estructura del PDF: tabla con columnas PRODUCTO | UNIDADES | ETIQUETA # | INSTRUCCIONES.
  // pdf.js extrae el texto leyendo la columna PRODUCTO completa primero, después
  // el header de la tabla, y RECIÉN AL FINAL los números de la columna UNIDADES.
  // Por eso no se puede asociar la cantidad parseando solo el bloque de cada
  // producto — hay que extraerlas por separado y matchearlas por orden de aparición.
  //
  // El texto extraído queda así (para 2 páginas, 18 productos):
  //   [header documento] [producto1] ... [producto9]
  //   PRODUCTO UNIDADES ETIQUETA # INSTRUCCIONES DE PREPARACIÓN
  //   12 4 • Envolvelos... 6 2 6 • Envolvelos... 2 ... 14 4
  //   [producto10] ... [producto18]
  //   PRODUCTO UNIDADES ETIQUETA # INSTRUCCIONES DE PREPARACIÓN
  //   10 6 • Envolvelos... 6 2 4 3 6 18 ... 8
  //
  // Se genera UN solo "order" con todos los items: el inbound a Full no tiene
  // comprador final, es un envío consolidado al CD de Mercado Libre. El buyer
  // queda como "Envío Full #<envioNumber>" para que el modo consolidado por SKU
  // del app.js los agrupe naturalmente.
  function parseEnviosFull(text) {
    const envioMatch = text.match(/Envío\s*#(\d+)/i);
    const envioId = envioMatch ? envioMatch[1] : 'FULL';

    // Split usando el header de tabla como separador.
    const TABLE_HEADER = /PRODUCTO\s+UNIDADES\s+ETIQUETA\s*#?\s*INSTRUCCIONES\s+DE\s+PREPARACI[OÓ]N/i;
    const parts = text.split(TABLE_HEADER);

    const products = [];   // [{sku, ean}] en orden de aparición
    const qtys = [];       // [12, 4, ...] en orden de aparición

    // parts[0] solo tiene productos (página 1, antes del primer header)
    extractFullProducts(parts[0], products);

    // Cada chunk posterior arranca con cantidades de la página anterior y, si
    // hay más páginas, sigue con los productos de la siguiente.
    for (let i = 1; i < parts.length; i++) {
      const firstMl = parts[i].search(/Código\s*ML:/i);
      const qtyText  = firstMl >= 0 ? parts[i].slice(0, firstMl) : parts[i];
      const prodText = firstMl >= 0 ? parts[i].slice(firstMl)    : '';
      extractFullQuantities(qtyText, qtys);
      extractFullProducts(prodText, products);
    }

    if (products.length === 0) return [];

    if (qtys.length !== products.length) {
      console.warn('[PDF Full] Desalineación: ' + products.length + ' productos vs '
                 + qtys.length + ' cantidades. Faltantes se asumen como 1.');
    }

    const items = products.map((p, i) => ({
      sku: p.sku,
      qty: qtys[i] || 1,
      scanned: 0,
      scannedEan: p.ean,
      status: 'pending',
      lastError: null
    }));

    console.log('[PDF Full] Envío #' + envioId + ' — ' + items.length + ' productos, '
              + items.reduce((s, it) => s + it.qty, 0) + ' unidades');

    return [{
      id: 'FULL-' + envioId,
      packId: null,
      ventaId: null,
      buyer: 'Envío Full #' + envioId,
      items,
      status: 'pending',
      confirmedAt: null
    }];
  }
  function extractFullProducts(text, into) {
    if (!text) return;
    const blocks = text.split(/(?=Código\s*ML:)/i);
    for (const block of blocks) {
      if (!/^Código\s*ML:/i.test(block.trim())) continue;
      const skuMatch = block.match(/SKU:\s*([A-Za-z0-9ÁÉÍÓÚÜÑ_\-./]+)/i);
      if (!skuMatch) continue;
      const eanMatch = block.match(/Código\s*universal:\s*(\d{13})/i)
                    || block.match(/\b(\d{13})\b/);
      into.push({
        sku: skuMatch[1].trim().toUpperCase(),
        ean: eanMatch ? eanMatch[1] : null
      });
    }
  }
  function extractFullQuantities(text, into) {
    if (!text) return;
    // Enteros aislados de 1-3 dígitos. Las instrucciones ("Envolvelos con papel
    // burbuja...") no contienen números, así que el filtro es seguro.
    const re = /(?:^|\s)(\d{1,3})(?=\s|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      into.push(parseInt(m[1], 10));
    }
  }
  // ── FORMATO ML unificado
  function parseMlUnified(text) {
    const orders = [];
    const norm = text.replace(/fi/g, 'f').replace(/fia/g, 'fa');
    const SKIP = new Set(['DESPACHA','IDENTIFICACION','IDENTIFICACI','PRODUCTOS',
      'AMARILLO','NARANJA','AZUL','NEGRO','BLANCO','GRIS','PLATEADO','TURQUESA',
      'COBRE','VERDE','LISO','CROMADO','ESMALTADO','INCOLORA','CROMADA',
      'IMPRESO','NATURAL','PLATEADA']);
    const idPattern = /(?<![\w\-])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z]{2}\d{6,15}[A-Z0-9]{0,10}|\d{8,20}|[A-Z0-9]{6,25})(?![\w\-])\s+(?=Pack ID:|Venta:)/gi;
    const positions = [];
    let m;
    while ((m = idPattern.exec(norm)) !== null) {
      const id = m[1];
      if (SKIP.has(id.toUpperCase())) continue;
      if (id.length < 6) continue;
      positions.push({ index: m.index, id });
    }
    for (let p = 0; p < positions.length; p++) {
      const start = positions[p].index;
      const end   = positions[p + 1] ? positions[p + 1].index : norm.length;
      const block = norm.slice(start, end);
      const order = parseMlBlock(block, positions[p].id);
      if (order && order.items.length > 0) orders.push(order);
    }
    console.log('[ML Parser] ' + orders.length + ' pedidos encontrados');
    return orders;
  }
  function parseMlBlock(block, id) {
    const packMatch  = block.match(/Pack ID:\s*(\d+)/);
    const packId     = packMatch ? packMatch[1] : null;
    const ventaMatch = block.match(/Venta:\s*(\d+)/);
    const ventaId    = ventaMatch ? ventaMatch[1] : null;
    let buyer = 'Comprador desconocido';
    const buyerMatch = block.match(/(?:Venta:\s*\d+\s*)([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s]+?)(?=\s*SKU:|\s*Pack ID:)/);
    if (buyerMatch) {
      buyer = buyerMatch[1].trim().replace(/\s+/g, ' ');
    } else {
      const fallback = block.match(/(?:[a-f0-9\-]{8,}|[A-Z]{2}\d+[A-Z0-9]*|\d{8,})\s+(?:Pack ID:\s*\d+\s*)?(?:Venta:\s*\d+\s*)?([A-ZÁÉÍÓÚÜÑ][^\d]+?)(?=SKU:)/i);
      if (fallback) buyer = fallback[1].trim().replace(/\s+/g, ' ');
    }
    const skuRegex = /SKU:\s*([A-Za-z0-9ÁÉÍÓÚÜÑ_\-]+)/gi;
    const qtyRegex = /Cantidad:\s*(\d+)/g;
    const skus = [], qtys = [];
    let sm, qm;
    while ((sm = skuRegex.exec(block)) !== null) skus.push(sm[1].trim().toUpperCase());
    while ((qm = qtyRegex.exec(block))  !== null) qtys.push(parseInt(qm[1], 10));
    if (skus.length === 0) return null;
    const items = skus.map((sku, idx) => ({
      sku, qty: qtys[idx] || 1,
      scanned: 0, scannedEan: null, status: 'pending', lastError: null,
    }));
    return { id, packId, ventaId, buyer, items, status: 'pending', confirmedAt: null };
  }
  // ── FORMATO ZIPNOVA
  function parseZipnova(text) {
    const orders = [];
    const normalized = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
    const listStart = normalized.search(/Lista de preparaci[oó]n/i);
    if (listStart !== -1) {
      const listText = normalized.slice(listStart);
      const re1 = /(\d{4}-\d{8})\s+\d{4}-\d{8}-\d{4}\s+([A-Z0-9]+)\s*\((\d+)\)/g;
      let m;
      while ((m = re1.exec(listText)) !== null) {
        const id = m[1], sku = m[2].toUpperCase(), qty = parseInt(m[3], 10);
        let order = orders.find(o => o.id === id);
        if (!order) {
          order = { id, packId: null, ventaId: null, buyer: 'Paquete ' + id,
                    items: [], status: 'pending', confirmedAt: null };
          orders.push(order);
        }
        order.items.push({ sku, qty, scanned: 0, scannedEan: null, status: 'pending', lastError: null });
      }
    }
    if (orders.length === 0) {
      const pickStart = normalized.search(/Lista de pickeo/i);
      const pickEnd   = normalized.search(/Fin del pickeo|Lista de preparaci/i);
      if (pickStart !== -1) {
        const pickText = normalized.slice(pickStart, pickEnd !== -1 ? pickEnd : undefined);
        const pickRe = /\b([A-Z][A-Z0-9]{2,})\b[^\d]*(\d+)(?=\s+[A-Z][A-Z0-9]{2,}|\s*Fin)/g;
        let pm;
        while ((pm = pickRe.exec(pickText)) !== null) {
          const sku = pm[1], qty = parseInt(pm[2], 10);
          if (sku.length < 4) continue;
          orders.push({
            id: 'PICK-' + sku, packId: null, ventaId: null, buyer: sku + ' ×' + qty,
            items: [{ sku, qty, scanned: 0, scannedEan: null, status: 'pending', lastError: null }],
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
    if (format === 'zipnova')       orders = parseZipnova(text);
    else if (format === 'gramabi')  orders = parseGramabi(text);
    else if (format === 'full')     orders = parseEnviosFull(text);
    else if (format === 'ml_numeric') {
      orders = parseMlUnified(text);
      if (orders.length === 0) orders = parseMlUnified(text);
    } else {
      orders = parseMlUnified(text);
    }
     console.log(`[PDF] ${orders.length} pedidos encontrados`);
    return orders;
  }
  return { parse };
})();
