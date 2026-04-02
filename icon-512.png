/**
 * app.js
 * Lógica principal de la app: estado, navegación y eventos.
 */

// ═══════════════════════════════════════════════════ ESTADO GLOBAL
const State = {
  catalog: null,        // Map<SKU, EAN>
  orders: [],           // Array de pedidos parseados
  currentOrderIdx: -1,  // Índice del pedido abierto
  currentItemIdx: -1,   // Ítem siendo escaneado
  pdfLoaded: false,
  catalogLoaded: false,
};

// ═══════════════════════════════════════════════════ NAVEGACIÓN
function showScreen(id) {
  // Detener escáner al salir de pantallas de escaneo
  if (id !== 'screen-detail' && id !== 'screen-scanner-free') {
    Scanner.stop();
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');

  // Arrancar escáner libre automáticamente
  if (id === 'screen-scanner-free') startFreeScanner();
  if (id === 'screen-summary') renderSummary();
}

// ═══════════════════════════════════════════════════ LOADER
function showLoader(msg = 'Cargando...') {
  document.getElementById('loader-msg').textContent = msg;
  document.getElementById('loader').style.display = 'flex';
}
function hideLoader() {
  document.getElementById('loader').style.display = 'none';
}

// ═══════════════════════════════════════════════════ TOAST
function showToast(msg, type = 'ok', duration = 2500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `toast toast-${type}`;
  div.textContent = msg;
  container.appendChild(div);
  setTimeout(() => div.remove(), duration);
}

// ═══════════════════════════════════════════════════ PANTALLA CONFIG

function updateConfigUI() {
  // Estado catálogo
  const statusEl = document.getElementById('catalog-status');
  const countRow = document.getElementById('catalog-count-row');
  const syncRow  = document.getElementById('catalog-sync-row');

  if (State.catalogLoaded && State.catalog) {
    statusEl.textContent = 'Sincronizado';
    statusEl.className = 'badge badge-ok';
    document.getElementById('catalog-count').textContent = State.catalog.size + ' SKUs';
    document.getElementById('catalog-sync-time').textContent = CatalogService.lastSyncLabel();
    countRow.style.display = 'flex';
    syncRow.style.display  = 'flex';
  } else {
    const cached = CatalogService.cachedCount();
    if (cached > 0) {
      statusEl.textContent = 'En caché (' + cached + ' SKUs)';
      statusEl.className = 'badge badge-warn';
      countRow.style.display = 'flex';
      syncRow.style.display  = 'flex';
      document.getElementById('catalog-count').textContent = cached + ' SKUs';
      document.getElementById('catalog-sync-time').textContent = CatalogService.lastSyncLabel();
    } else {
      statusEl.textContent = 'Sin sincronizar';
      statusEl.className = 'badge badge-warn';
    }
  }

  checkCanGoOrders();
}

function checkCanGoOrders() {
  const catalogOk = State.catalogLoaded || CatalogService.cachedCount() > 0;
  const pdfOk     = State.pdfLoaded;
  document.getElementById('btn-go-orders').disabled = !(catalogOk && pdfOk);
}

// Sincronizar catálogo
document.getElementById('btn-sync').addEventListener('click', async () => {
  const errEl = document.getElementById('sync-error');
  errEl.style.display = 'none';
  showLoader('Descargando catálogo...');
  try {
    State.catalog = await CatalogService.getCatalog(true);
    State.catalogLoaded = true;
    updateConfigUI();
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message + '. Verificá tu conexión a internet.';
    errEl.style.display = 'block';
    console.error('[Catalog]', e);
  } finally {
    hideLoader();
  }
});

// Cargar PDF
document.getElementById('input-pdf').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const errEl = document.getElementById('pdf-error');
  errEl.style.display = 'none';
  showLoader('Leyendo PDF...');
  try {
    const orders = await PdfParser.parse(file);
    if (orders.length === 0) {
      throw new Error('No se encontraron pedidos en el PDF. Verificá que sea el PDF de Mercado Libre correcto.');
    }
    State.orders = orders;
    State.pdfLoaded = true;

    document.getElementById('pdf-status-row').style.display = 'flex';
    document.getElementById('pdf-orders-row').style.display = 'flex';
    document.getElementById('pdf-name').textContent = file.name;
    document.getElementById('pdf-orders-count').textContent = orders.length + ' pedidos';

    checkCanGoOrders();
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.style.display = 'block';
    console.error('[PDF]', e);
  } finally {
    hideLoader();
  }
});

// Ir a pedidos
document.getElementById('btn-go-orders').addEventListener('click', async () => {
  // Si no tenemos catálogo en memoria pero sí en cache, cargarlo
  if (!State.catalog) {
    showLoader('Cargando catálogo...');
    try {
      State.catalog = await CatalogService.getCatalog(false);
      State.catalogLoaded = true;
    } catch (e) {
      console.error(e);
    } finally {
      hideLoader();
    }
  }
  renderOrdersList();
  showScreen('screen-orders');
});

// Botón inicio
document.getElementById('btn-start').addEventListener('click', () => {
  updateConfigUI();
  showScreen('screen-config');
});

// ═══════════════════════════════════════════════════ LISTA DE PEDIDOS

function renderOrdersList() {
  const list = document.getElementById('orders-list');
  list.innerHTML = '';

  const total   = State.orders.length;
  const doneOk  = State.orders.filter(o => o.status === 'ok').length;
  const errored = State.orders.filter(o => o.status === 'error').length;
  const done    = doneOk + errored;

  document.getElementById('progress-fill').style.width = (total ? (done / total * 100) : 0) + '%';
  document.getElementById('progress-label').textContent = `${done} de ${total} pedidos procesados`;

  State.orders.forEach((order, idx) => {
    const div = document.createElement('div');
    div.className = 'order-item';

    const dotClass = order.status === 'ok' ? 'dot-ok' : order.status === 'error' ? 'dot-error' : 'dot-warn';
    const badgeClass = order.status === 'ok' ? 'badge-ok' : order.status === 'error' ? 'badge-error' : 'badge-warn';
    const badgeText  = order.status === 'ok' ? 'OK' : order.status === 'error' ? 'Error' : 'Pendiente';
    const pendingCount = order.items.filter(i => i.status === 'pending').length;
    const sub = order.status === 'pending'
      ? `${order.items.length} producto${order.items.length > 1 ? 's' : ''} · ${pendingCount} sin escanear`
      : order.status === 'ok'
        ? `${order.items.length} producto${order.items.length > 1 ? 's' : ''} · Validado`
        : `${order.items.length} producto${order.items.length > 1 ? 's' : ''} · Con errores`;

    div.innerHTML = `
      <div class="order-dot ${dotClass}"></div>
      <div class="order-info">
        <div class="order-name">${escHtml(order.buyer)}</div>
        <div class="order-sub">${sub}</div>
        <div class="order-id-text">${order.id}</div>
      </div>
      <span class="badge ${badgeClass}">${badgeText}</span>
    `;
    div.addEventListener('click', () => openOrder(idx));
    list.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════ DETALLE DE PEDIDO

function openOrder(idx) {
  State.currentOrderIdx = idx;
  State.currentItemIdx  = -1;
  Scanner.stop();
  renderDetail();
  showScreen('screen-detail');
  startDetailScanner();
}

function renderDetail() {
  const order = State.orders[State.currentOrderIdx];
  if (!order) return;

  document.getElementById('detail-buyer-name').textContent = order.buyer;
  document.getElementById('detail-order-id').textContent   = order.id;

  const badge = document.getElementById('detail-status-badge');
  badge.textContent  = order.status === 'ok' ? 'OK' : order.status === 'error' ? 'Error' : 'Pendiente';
  badge.className    = 'badge ' + (order.status === 'ok' ? 'badge-ok' : order.status === 'error' ? 'badge-error' : 'badge-warn');

  // Lista de SKUs
  const container = document.getElementById('detail-skus');
  container.innerHTML = '';

  order.items.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'sku-item';
    div.id = `sku-item-${i}`;

    const icon  = item.status === 'ok' ? '✓' : item.status === 'error' ? '✕' : item.status === 'not_in_catalog' ? '?' : '○';
    const cls   = item.status === 'ok' ? 'check-ok' : item.status === 'error' ? 'check-error' : item.status === 'not_in_catalog' ? 'check-warn' : 'check-gray';
    const eanTxt = item.scannedEan ? item.scannedEan : '—';
    const progress = item.qty > 1 ? ` (${item.scanned}/${item.qty})` : '';

    div.innerHTML = `
      <div class="sku-check ${cls}">${icon}</div>
      <div class="sku-info">
        <div class="sku-code">${escHtml(item.sku)}${progress}</div>
        <div class="sku-ean">${eanTxt}</div>
      </div>
      <div class="sku-qty">×${item.qty}</div>
    `;
    container.appendChild(div);
  });

  // Botón confirmar
  const allProcessed = order.items.every(i => i.status !== 'pending');
  document.getElementById('btn-confirm-order').disabled = !allProcessed;
}

function startDetailScanner() {
  const errEl = document.getElementById('scanner-error');
  errEl.style.display = 'none';

  Scanner.start('scanner-video', (ean) => {
    onEanScanned(ean);
  }, (err) => {
    errEl.textContent = err;
    errEl.style.display = 'block';
  });
}

function onEanScanned(ean) {
  const order = State.orders[State.currentOrderIdx];
  if (!order) return;

  // Encontrar el próximo ítem pendiente
  const itemIdx = order.items.findIndex(i => i.status === 'pending');
  if (itemIdx === -1) {
    showToast('Todos los ítems ya fueron escaneados', 'warn');
    return;
  }

  const item = order.items[itemIdx];

  // Validar
  const result = CatalogService.validate(item.sku, ean, State.catalog);
  item.scannedEan = ean;

  if (result.status === 'ok') {
    item.scanned++;
    if (item.scanned >= item.qty) {
      item.status = 'ok';
      showToast(`✓ ${item.sku} — correcto`, 'ok');
    } else {
      showToast(`✓ ${item.scanned}/${item.qty} unidades`, 'ok');
    }
    playBeep('ok');
  } else if (result.status === 'error') {
    item.status = 'error';
    showToast(`✕ EAN incorrecto\nLeído: ${ean}\nEsperado: ${result.expected}`, 'error', 3500);
    playBeep('error');
  } else {
    item.status = 'not_in_catalog';
    showToast(`⚠ SKU ${item.sku} sin EAN en catálogo`, 'warn', 3000);
  }

  // Actualizar estado del pedido
  const hasError   = order.items.some(i => i.status === 'error');
  const allDone    = order.items.every(i => i.status !== 'pending');
  order.status = !allDone ? 'pending' : hasError ? 'error' : 'ok';

  renderDetail();
  renderOrdersList();
}

// Confirmar pedido
document.getElementById('btn-confirm-order').addEventListener('click', () => {
  const order = State.orders[State.currentOrderIdx];
  if (!order) return;
  order.confirmedAt = new Date().toLocaleTimeString('es-AR');
  Scanner.stop();
  showScreen('screen-orders');
  renderOrdersList();
});

// Botón linterna
document.getElementById('btn-torch').addEventListener('click', () => {
  Scanner.toggleTorch();
});

// Volver desde detalle
document.getElementById('back-to-orders').addEventListener('click', () => {
  Scanner.stop();
  renderOrdersList();
  showScreen('screen-orders');
});

// Volver desde pedidos a config
document.getElementById('back-to-config').addEventListener('click', () => {
  updateConfigUI();
  showScreen('screen-config');
});

// ═══════════════════════════════════════════════════ ESCÁNER LIBRE

function startFreeScanner() {
  Scanner.start('scanner-video-free', (ean) => {
    // Buscar EAN en catálogo (inverso: EAN → SKU)
    let foundSku = null;
    if (State.catalog) {
      for (const [sku, e] of State.catalog) {
        if (e.trim() === ean.trim()) { foundSku = sku; break; }
      }
    }

    // Buscar si ese SKU está en algún pedido del día
    let foundOrder = null;
    if (foundSku) {
      foundOrder = State.orders.find(o => o.items.some(i => i.sku === foundSku));
    }

    document.getElementById('free-result').style.display = 'block';
    document.getElementById('free-ean').textContent = ean;
    document.getElementById('free-sku').textContent = foundSku || '— No encontrado en catálogo';
    document.getElementById('free-order').textContent = foundOrder ? `${foundOrder.buyer} (${foundOrder.id})` : '— Sin pedido asignado';
  }, (err) => {
    console.warn('[Free scanner]', err);
  });
}

// ═══════════════════════════════════════════════════ RESUMEN

function renderSummary() {
  const ok      = State.orders.filter(o => o.status === 'ok').length;
  const pending = State.orders.filter(o => o.status === 'pending').length;
  const error   = State.orders.filter(o => o.status === 'error').length;

  document.getElementById('sum-ok').textContent      = ok;
  document.getElementById('sum-pending').textContent = pending;
  document.getElementById('sum-error').textContent   = error;

  const list = document.getElementById('summary-list');
  list.innerHTML = '';

  State.orders.forEach(order => {
    const div = document.createElement('div');
    div.className = 'summary-item';
    const badgeCls = order.status === 'ok' ? 'badge-ok' : order.status === 'error' ? 'badge-error' : 'badge-warn';
    const badgeTxt = order.status === 'ok' ? '✓ OK' : order.status === 'error' ? '✕ Error' : 'Pendiente';
    div.innerHTML = `
      <div>
        <div class="summary-name">${escHtml(order.buyer)}</div>
        <div class="summary-sub">${order.id}</div>
      </div>
      <span class="badge ${badgeCls}">${badgeTxt}</span>
    `;
    list.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════ EXPORTAR REPORTE

document.getElementById('btn-export').addEventListener('click', () => {
  const now = new Date().toLocaleString('es-AR');
  const ok = State.orders.filter(o => o.status === 'ok');
  const err = State.orders.filter(o => o.status === 'error');
  const pend = State.orders.filter(o => o.status === 'pending');

  let html = `
<!DOCTYPE html><html lang="es">
<head><meta charset="UTF-8"/>
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #111; padding: 24px; }
  h1 { color: #1a56db; font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin: 16px 0 8px; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 16px; }
  .metrics { display: flex; gap: 16px; margin-bottom: 20px; }
  .metric { background: #f3f4f6; border-radius: 8px; padding: 12px 20px; text-align: center; }
  .metric .val { font-size: 28px; font-weight: 700; }
  .metric .lbl { font-size: 11px; color: #6b7280; }
  .green { color: #1D9E75; } .red { color: #dc2626; } .amber { color: #d97706; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #1a56db; color: #fff; padding: 7px 10px; text-align: left; font-size: 12px; }
  td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
  tr:nth-child(even) td { background: #f9fafb; }
  .ok { color: #1D9E75; font-weight: 600; }
  .er { color: #dc2626; font-weight: 600; }
  .pn { color: #d97706; font-weight: 600; }
</style>
</head>
<body>
<h1>📦 Reporte de despacho</h1>
<div class="meta">Generado el ${now} · Catálogo sync: ${CatalogService.lastSyncLabel()}</div>
<div class="metrics">
  <div class="metric"><div class="val green">${ok.length}</div><div class="lbl">Validados</div></div>
  <div class="metric"><div class="val amber">${pend.length}</div><div class="lbl">Pendientes</div></div>
  <div class="metric"><div class="val red">${err.length}</div><div class="lbl">Con error</div></div>
  <div class="metric"><div class="val">${State.orders.length}</div><div class="lbl">Total</div></div>
</div>
<h2>Detalle de pedidos</h2>
<table>
<thead><tr><th>ID Envío</th><th>Comprador</th><th>SKUs</th><th>Estado</th></tr></thead>
<tbody>
`;

  State.orders.forEach(o => {
    const stCls = o.status === 'ok' ? 'ok' : o.status === 'error' ? 'er' : 'pn';
    const stTxt = o.status === 'ok' ? '✓ OK' : o.status === 'error' ? '✕ Error' : 'Pendiente';
    const skuList = o.items.map(i => `${i.sku} ×${i.qty}`).join(', ');
    html += `<tr><td class="mono">${o.id}</td><td>${escHtml(o.buyer)}</td><td>${escHtml(skuList)}</td><td class="${stCls}">${stTxt}</td></tr>`;
  });

  html += `</tbody></table>`;

  if (err.length > 0) {
    html += `<h2>⚠ Incidencias</h2><table>
    <thead><tr><th>Comprador</th><th>SKU</th><th>EAN escaneado</th><th>EAN esperado</th></tr></thead><tbody>`;
    err.forEach(o => {
      o.items.filter(i => i.status === 'error').forEach(i => {
        const expected = State.catalog ? (State.catalog.get(i.sku) || '—') : '—';
        html += `<tr><td>${escHtml(o.buyer)}</td><td class="mono">${i.sku}</td><td class="mono er">${i.scannedEan || '—'}</td><td class="mono">${expected}</td></tr>`;
      });
    });
    html += `</tbody></table>`;
  }

  html += `</body></html>`;

  // Descargar como HTML (imprimible como PDF desde el navegador)
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `reporte-despacho-${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
});

// ═══════════════════════════════════════════════════ AUDIO FEEDBACK

function playBeep(type) {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = type === 'ok' ? 880 : 220;
    gain.gain.setValueAtTime(.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + (type === 'ok' ? .15 : .4));
    osc.start();
    osc.stop(ctx.currentTime + (type === 'ok' ? .15 : .4));
  } catch {}
}

// ═══════════════════════════════════════════════════ UTILS
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════ SERVICE WORKER (PWA)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.warn);
}

// ═══════════════════════════════════════════════════ INIT
(function init() {
  // Al arrancar, mostrar pantalla de login
  showScreen('screen-login');
})();
