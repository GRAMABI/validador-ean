/**
 * pdfParser.js — v20260415b
 * Compatible con Android 11 / Chrome viejo (Samsung SM-T510 y similares).
 *
 * Estrategia de carga de pdf.js worker (en orden de preferencia):
 * 1. workerSrc apuntando a unpkg.com (versión 2.16.105)
 * 2. Blob URL con worker inline (no requiere CDN externo)
 * 3. Sin worker (FakeWorker de pdf.js, más lento pero funciona)
 */

const PdfParser = (() => {

  // Worker inline mínimo — funciona sin CDN
  // Esto crea un Web Worker desde un blob en memoria
  function makeInlineWorkerUrl() {
    try {
      // El worker inline le dice a pdf.js que use el modo "fake" sin proceso separado
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

    // Lista de estrategias a probar en orden
    const strategies = [
      // 1. Worker desde unpkg (más compatible que cdnjs para versión 2.x)
      () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js';
        return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      },
      // 2. Worker desde cdnjs con versión 3.x (Chrome moderno)
      () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      },
      // 3. Blob worker inline (sin CDN)
      () => {
        const blobUrl = makeInlineWorkerUrl();
        if (blobUrl) pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl;
        else pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      },
      // 4. Sin worker (workerSrc vacío = FakeWorker de pdf.js)
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
