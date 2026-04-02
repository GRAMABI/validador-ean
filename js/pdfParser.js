/**
 * pdfParser.js
 * Parsea el PDF de pedidos de Mercado Libre y extrae los pedidos estructurados.
 */

const PdfParser = (() => {

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  /**
   * Extrae texto plano de todas las páginas del PDF.
   * @param {File} file
   * @returns {Promise<string>}
   */
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

  /**
   * Parsea el texto extraído del PDF y devuelve un array de pedidos.
   *
   * Estructura de cada pedido:
   * {
   *   id: string,           // Número de envío (11 dígitos)
   *   packId: string|null,
   *   ventaId: string|null,
   *   buyer: string,
   *   items: [{ sku, qty, scanned, scannedEan, status }],
   *   status: 'pending'|'ok'|'error'
   * }
   */
  function parseOrders(text) {
    const orders = [];

    // Normalizar espacios múltiples
    const normalized = text.replace(/\s+/g, ' ');

    // Dividir el texto en bloques por número de envío (11 dígitos consecutivos)
    // El número de envío siempre aparece al inicio de cada bloque
    const blockRegex = /(\d{11})/g;
    const positions = [];
    let match;
    while ((match = blockRegex.exec(normalized)) !== null) {
      // Filtrar para que no sean partes de números más grandes
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
      const order = parseBlock(block, positions[i].id);
      if (order && order.items.length > 0) {
        orders.push(order);
      }
    }

    return orders;
  }

  function parseBlock(block, id) {
    // Pack ID
    const packMatch = block.match(/Pack ID:\s*(\d+)/);
    const packId = packMatch ? packMatch[1] : null;

    // Venta ID
    const ventaMatch = block.match(/Venta:\s*(\d+)/);
    const ventaId = ventaMatch ? ventaMatch[1] : null;

    // Nombre del comprador: texto entre el ID/PackID/Venta y el primer SKU
    // Buscar el nombre como el texto que aparece antes de "SKU:"
    let buyer = 'Comprador desconocido';
    const buyerMatch = block.match(/(?:Venta:\s*\d+\s*)([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s]+?)(?=\s*SKU:)/);
    if (buyerMatch) {
      buyer = buyerMatch[1].trim().replace(/\s+/g, ' ');
    } else {
      // Fallback: buscar nombre antes del primer SKU
      const fallback = block.match(/\d{11}\s+(?:Pack ID:\s*\d+\s*)?(?:Venta:\s*\d+\s*)?([A-ZÁÉÍÓÚÜÑ][^\d]+?)(?=SKU:)/i);
      if (fallback) buyer = fallback[1].trim().replace(/\s+/g, ' ');
    }

    // Extraer todos los SKUs y cantidades en orden
    const skuRegex = /SKU:\s*([A-Z0-9]+)/g;
    const qtyRegex = /Cantidad:\s*(\d+)/g;

    const skus = [];
    const qtys = [];

    let sm;
    while ((sm = skuRegex.exec(block)) !== null) skus.push(sm[1].trim().toUpperCase());

    let qm;
    while ((qm = qtyRegex.exec(block)) !== null) qtys.push(parseInt(qm[1], 10));

    if (skus.length === 0) return null;

    const items = skus.map((sku, idx) => ({
      sku,
      qty: qtys[idx] || 1,
      scanned: 0,         // cuántas unidades ya escaneadas
      scannedEan: null,   // último EAN escaneado
      status: 'pending',  // pending | ok | error | not_in_catalog
    }));

    return {
      id,
      packId,
      ventaId,
      buyer,
      items,
      status: 'pending',
      confirmedAt: null,
    };
  }

  async function parse(file) {
    const text = await extractText(file);
    const orders = parseOrders(text);
    return orders;
  }

  return { parse };
})();
