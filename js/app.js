/* v20260405 */
/**
 * app.js — versión limpia y funcional
 */

const State = {
  catalog: null,
  orders: [],
  currentOrderIdx: -1,
  pdfLoaded: false,
  catalogLoaded: false,
  operario: localStorage.getItem('vean_operario') || '',
};
let _scanning = false;

// ── PERSISTENCIA ─────────────────────────────────────────────
function saveProgress() {
  try { localStorage.setItem('vean_progress', JSON.stringify({ orders: State.orders, operario: State.operario })); } catch {}
}
function loadProgress() {
  try { return JSON.parse(localStorage.getItem('vean_progress')); } catch { return null; }
}
function clearProgress() {
  localStorage.removeItem('vean_progress');
  State.orders = [];
  State.pdfLoaded = false;
}

// ── NAVEGACIÓN ───────────────────────────────────────────────
function showScreen(id) {
  if (id !== 'screen-detail' && id !== 'screen-validator') Scanner.stop();
  if (id !== 'screen-validator') Scanner2.stop();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'screen-validator') startValidator();
  if (id === 'screen-summary') renderSummary();
}

function showLoader(msg) {
  document.getElementById('loader-msg').textContent = msg || 'Cargando...';
  document.getElementById('loader').style.display = 'flex';
}
function hideLoader() { document.getElementById('loader').style.display = 'none'; }

function showToast(msg, type, duration) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  c.querySelectorAll('.toast').forEach(t => t.remove());
  const d = document.createElement('div');
  d.className = 'toast toast-' + (type || 'ok');
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => d.remove(), duration || 2500);
}

// ── INICIO ───────────────────────────────────────────────────
async function initApp() {
  showScreen('screen-home');
  // Cargar catálogo en segundo plano silenciosamente
  try {
    State.catalog = await CatalogService.getCatalog(false);
    State.catalogLoaded = true;
  } catch(e) { console.warn('[Catálogo]', e.message); }

  // Verificar si hay progreso guardado y mostrar dialog
  const prog = loadProgress();
  if (prog && prog.orders && prog.orders.length > 0) {
    const pending = prog.orders.filter(o => o.status === 'pending').length;
    if (pending > 0) showResumeDialog(prog);
  }
}

function showResumeDialog(prog) {
  const done  = prog.orders.filter(o => o.status !== 'pending').length;
  const total = prog.orders.length;
  const dlg = document.createElement('div');
  dlg.id = 'resume-dlg';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:999;padding:20px;box-sizing:border-box';
  dlg.innerHTML = `<div style="background:#fff;border-radius:16px;padding:24px;max-width:340px;width:100%">
    <div style="font-size:24px;margin-bottom:8px">📋</div>
    <div style="font-size:16px;font-weight:600;margin-bottom:6px">Sesión en progreso</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:16px">${done} de ${total} pedidos procesados</div>
    <button class="btn-primary" style="margin-bottom:8px" onclick="doResume()">Continuar</button>
    <button class="btn-secondary" onclick="doDiscard()">Empezar nuevo</button>
  </div>`;
  document.body.appendChild(dlg);
}

window.doResume = function() {
  document.getElementById('resume-dlg')?.remove();
  const prog = loadProgress();
  if (!prog) return;
  State.orders   = prog.orders;
  State.operario = prog.operario || State.operario;
  State.pdfLoaded = true;
  renderOrdersList();
  showScreen('screen-orders');
};

window.doDiscard = function() {
  document.getElementById('resume-dlg')?.remove();
  clearProgress();
};

// ── BOTONES HOME ─────────────────────────────────────────────
document.getElementById('btn-mode-orders').addEventListener('click', () => {
  updateConfigUI();
  showScreen('screen-config');
});

document.getElementById('btn-mode-validator').addEventListener('click', () => {
  showScreen('screen-validator');
});

// ── CONFIG ───────────────────────────────────────────────────
function updateConfigUI() {
  const st = document.getElementById('catalog-status');
  const cr = document.getElementById('catalog-count-row');
  const sr = document.getElementById('catalog-sync-row');

  if (State.catalogLoaded && State.catalog) {
    st.textContent = 'Sincronizado'; st.className = 'badge badge-ok';
    document.getElementById('catalog-count').textContent = State.catalog.size + ' SKUs';
    document.getElementById('catalog-sync-time').textContent = CatalogService.lastSyncLabel();
    cr.style.display = sr.style.display = 'flex';
  } else {
    const n = CatalogService.cachedCount();
    if (n > 0) {
      st.textContent = 'En caché (' + n + ' SKUs)'; st.className = 'badge badge-warn';
      document.getElementById('catalog-count').textContent = n + ' SKUs';
      document.getElementById('catalog-sync-time').textContent = CatalogService.lastSyncLabel();
      cr.style.display = sr.style.display = 'flex';
    } else {
      st.textContent = 'Sin catálogo'; st.className = 'badge badge-warn';
    }
  }

  // Mostrar nombre del operario
  const oi = document.getElementById('input-operario');
  if (oi && State.operario) oi.value = State.operario;

  checkCanGoOrders();
}

function checkCanGoOrders() {
  const catOk = State.catalogLoaded || CatalogService.cachedCount() > 0;
  document.getElementById('btn-go-orders').disabled = !(catOk && State.pdfLoaded);
}

// Guardar nombre del operario cuando escribe en config
document.getElementById('input-operario').addEventListener('input', e => {
  State.operario = e.target.value.trim();
  localStorage.setItem('vean_operario', State.operario);
});

document.getElementById('btn-sync').addEventListener('click', async () => {
  const err = document.getElementById('sync-error');
  err.style.display = 'none';
  showLoader('Actualizando catálogo...');
  try {
    State.catalog = await CatalogService.getCatalog(true);
    State.catalogLoaded = true;
    updateConfigUI();
  } catch(e) {
    err.textContent = 'Error: ' + e.message;
    err.style.display = 'block';
  } finally { hideLoader(); }
});

document.getElementById('input-pdf').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const err = document.getElementById('pdf-error');
  err.style.display = 'none';
  showLoader('Leyendo PDF...');
  try {
    const orders = await PdfParser.parse(file);
    if (!orders.length) throw new Error('No se encontraron pedidos en el PDF.');

    // Enriquecer con info del catálogo
    if (State.catalog) {
      orders.forEach(o => o.items.forEach(item => {
        const info = CatalogService.getInfo(item.sku, State.catalog);
        item.desc   = info.desc  || '';
        item.hasEan = !!info.ean;
        item.marca  = info.marca || 'Varios';
      }));
    }

    State.orders    = orders;
    State.pdfLoaded = true;
    saveProgress();

    // Calcular estadísticas
    const totalItems   = orders.reduce((s, o) => s + o.items.length, 0);
    const totalUnits   = orders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.qty, 0), 0);
    const uniqueSkus   = new Set(orders.flatMap(o => o.items.map(i => i.sku))).size;

    document.getElementById('pdf-status-row').style.display = 'flex';
    document.getElementById('pdf-orders-row').style.display = 'flex';
    document.getElementById('pdf-name').textContent = file.name;
    document.getElementById('pdf-orders-count').textContent =
      `${orders.length} pedidos · ${uniqueSkus} SKUs distintos · ${totalUnits} unidades`;
    checkCanGoOrders();
  } catch(e) {
    err.textContent = 'Error: ' + e.message;
    err.style.display = 'block';
  } finally { hideLoader(); }
});

document.getElementById('btn-go-orders').addEventListener('click', async () => {
  if (!State.catalog) {
    showLoader('Cargando catálogo...');
    try { State.catalog = await CatalogService.getCatalog(false); State.catalogLoaded = true; }
    catch(e) {} finally { hideLoader(); }
  }
  // Enriquecer ítems que aún no tienen desc/hasEan/marca
  State.orders.forEach(o => o.items.forEach(item => {
    if (item.desc === undefined && State.catalog) {
      const info = CatalogService.getInfo(item.sku, State.catalog);
      item.desc   = info.desc  || '';
      item.hasEan = !!info.ean;
      item.marca  = info.marca || 'Varios';
    }
  }));
  renderOrdersList();
  showScreen('screen-orders');
});

document.getElementById('back-to-home').addEventListener('click', () => {
  showScreen('screen-home');
});

document.getElementById('back-to-config').addEventListener('click', () => {
  updateConfigUI();
  showScreen('screen-config');
});

// ── LISTA PEDIDOS ────────────────────────────────────────────
function renderOrdersList() {
  const list  = document.getElementById('orders-list');
  list.innerHTML = '';
  const total = State.orders.length;
  const done  = State.orders.filter(o => o.status !== 'pending').length;

  document.getElementById('progress-fill').style.width = (total ? done / total * 100 : 0) + '%';
  document.getElementById('progress-label').textContent = `${done} de ${total} pedidos procesados`;
  const ol = document.getElementById('operario-label');
  if (ol) ol.textContent = State.operario ? 'Operario: ' + State.operario : '';

  // Agrupar por marca
  // Estructura: { marca: [ { orderIdx, item, itemIdx } ] }
  const byMarca = {};
  State.orders.forEach((order, orderIdx) => {
    order.items.forEach((item, itemIdx) => {
      const marca = (item.marca || 'Varios').trim();
      if (!byMarca[marca]) byMarca[marca] = [];
      byMarca[marca].push({ orderIdx, itemIdx, item, order });
    });
  });

  // Ordenar marcas: alfabético, 'Varios' al final
  const marcas = Object.keys(byMarca).sort((a, b) => {
    if (a === 'Varios') return 1;
    if (b === 'Varios') return -1;
    return a.localeCompare(b, 'es');
  });

  marcas.forEach(marca => {
    const entries = byMarca[marca];

    // Encabezado de marca
    const header = document.createElement('div');
    header.className = 'marca-header';
    const totalItems = entries.length;
    const doneItems  = entries.filter(e => e.item.status !== 'pending').length;
    header.innerHTML = `
      <span class="marca-name">${escHtml(marca)}</span>
      <span class="marca-count">${doneItems}/${totalItems}</span>`;
    list.appendChild(header);

    // Artículos de esa marca
    entries.forEach(({ orderIdx, itemIdx, item, order }) => {
      const div = document.createElement('div');
      div.className = 'marca-item';

      const stIcon = item.status === 'ok' ? '✓'
                   : item.status === 'error' || item.lastError ? '✕'
                   : item.hasEan === false ? '—' : '○';
      const stCls  = item.status === 'ok' ? 'check-ok'
                   : item.status === 'error' || item.lastError ? 'check-error'
                   : item.hasEan === false ? 'check-warn' : 'check-gray';
      const scanned = item.scanned || 0;
      const progress = item.qty > 1 ? ` (${scanned}/${item.qty})` : '';

      div.innerHTML = `
        <div class="sku-check ${stCls}" style="flex-shrink:0">${stIcon}</div>
        <div class="marca-item-info">
          <div class="marca-item-sku">${escHtml(item.sku)}${progress} <span style="font-weight:400;color:var(--gray-text)">×${item.qty}</span></div>
          <div class="marca-item-desc">${escHtml(item.desc || '')}</div>
          <div class="marca-item-buyer">📦 ${escHtml(order.buyer)} <span style="font-family:monospace;font-size:10px;color:#bbb">${order.id}</span></div>
        </div>
        <button class="marca-item-btn" onclick="openOrder(${orderIdx})">Escanear →</button>`;
      list.appendChild(div);
    });
  });

  saveProgress();
}

// ── DETALLE PEDIDO ───────────────────────────────────────────
function openOrder(idx) {
  State.currentOrderIdx = idx;
  Scanner.stop();
  _scanning = false;
  document.getElementById('retry-scan-wrap')?.remove();
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
  badge.textContent = order.status === 'ok' ? 'OK' : order.status === 'error' ? 'Error' : 'Pendiente';
  badge.className   = 'badge ' + (order.status === 'ok' ? 'badge-ok' : order.status === 'error' ? 'badge-error' : 'badge-warn');

  const container = document.getElementById('detail-skus');
  container.innerHTML = '';

  order.items.forEach((item, i) => {
    const div      = document.createElement('div');
    div.className  = 'sku-item';
    const scanned  = item.scanned || 0;
    const hasErr   = item.lastError && item.status === 'pending';
    const icon = item.status === 'ok' ? '✓'
               : item.status === 'no_ean' ? '—'
               : item.status === 'not_in_catalog' ? '?'
               : hasErr ? '✕' : '○';
    const cls  = item.status === 'ok' ? 'check-ok'
               : item.status === 'no_ean' ? 'check-warn'
               : item.status === 'not_in_catalog' ? 'check-warn'
               : hasErr ? 'check-error' : 'check-gray';
    const progress = item.qty > 1 ? ` (${scanned}/${item.qty})` : '';
    const eanTxt   = item.status === 'ok' ? (item.scannedEan || '')
                   : item.hasEan === false ? 'Sin código de barras'
                   : hasErr ? `✕ ${item.lastError} — reescaneá`
                   : scanned > 0 ? `${scanned}/${item.qty} escaneados` : '—';
    const desc   = item.desc ? `<div class="sku-desc">${escHtml(item.desc)}</div>` : '';
    const manBtn = (item.status === 'pending' && item.hasEan === false)
      ? `<button class="btn-manual" onclick="confirmManual(${i})">Confirmar manual</button>` : '';

    div.innerHTML = `
      <div class="sku-check ${cls}">${icon}</div>
      <div class="sku-info">
        <div class="sku-code">${escHtml(item.sku)}${progress}</div>
        ${desc}<div class="sku-ean">${eanTxt}</div>${manBtn}
      </div>
      <div class="sku-qty">×${item.qty}</div>`;
    container.appendChild(div);
  });

  document.getElementById('btn-confirm-order').disabled =
    !order.items.every(i => i.status !== 'pending');
}

window.confirmManual = function(i) {
  const o = State.orders[State.currentOrderIdx]; if (!o) return;
  o.items[i].status     = 'ok';
  o.items[i].scannedEan = 'Confirmado manualmente';
  updateOrderStatus(o);
  renderDetail();
  renderOrdersList();
  showToast('✓ Confirmado manualmente', 'ok');
};

function startDetailScanner() {
  document.getElementById('scanner-error').style.display = 'none';
  const order = State.orders[State.currentOrderIdx];
  if (order && order.items.every(i => i.hasEan === false)) {
    document.getElementById('scanner-wrap').style.display = 'none';
    return;
  }
  document.getElementById('scanner-wrap').style.display = 'block';
  Scanner.start('scanner-video', onEanScanned, err => {
    document.getElementById('scanner-error').textContent = err;
    document.getElementById('scanner-error').style.display = 'block';
  });
}

function onEanScanned(ean) {
  if (_scanning) return;
  _scanning = true;
  const order = State.orders[State.currentOrderIdx];
  if (!order) { _scanning = false; return; }

  const itemIdx = order.items.findIndex(i => i.status === 'pending' && i.hasEan !== false);
  if (itemIdx === -1) { _scanning = false; return; }

  const item   = order.items[itemIdx];
  const result = CatalogService.validate(item.sku, ean, State.catalog);
  item.scannedEan = ean;

  if (result.status === 'ok') {
    item.scanned = (item.scanned || 0) + 1;
    if (item.scanned >= item.qty) {
      item.status = 'ok';
      showToast(`✓ ${item.sku} — ${item.qty > 1 ? item.qty + ' unidades OK' : 'correcto'}`, 'ok');
    } else {
      showToast(`✓ Unidad ${item.scanned}/${item.qty} — escaneá la siguiente`, 'ok', 2000);
    }
    playBeep('ok');
    setTimeout(() => { _scanning = false; }, 800);
    updateOrderStatus(order);
    renderDetail();
    renderOrdersList();

  } else if (result.status === 'error') {
    item.lastError = ean;
    playBeep('error');
    Scanner.stop();
    _scanning = false;
    showToast('✕ EAN incorrecto. Tocá "Reintentar".', 'error', 4000);
    renderDetail();
    document.getElementById('retry-scan-wrap')?.remove();
    const retryDiv = document.createElement('div');
    retryDiv.id = 'retry-scan-wrap';
    retryDiv.style.cssText = 'padding:10px 0';
    retryDiv.innerHTML = '<button class="btn-secondary" onclick="retryScan()" style="border-color:#dc2626;color:#dc2626">↺ Reintentar escaneo</button>';
    document.getElementById('scanner-wrap').insertAdjacentElement('afterend', retryDiv);

  } else {
    if (result.status === 'no_ean') {
      item.status = 'no_ean';
      showToast('⚠ Sin EAN registrado', 'warn');
    } else {
      item.status = 'not_in_catalog';
      showToast('⚠ SKU no encontrado en catálogo', 'warn', 3000);
    }
    setTimeout(() => { _scanning = false; }, 800);
    updateOrderStatus(order);
    renderDetail();
    renderOrdersList();
  }
}

window.retryScan = function() {
  document.getElementById('retry-scan-wrap')?.remove();
  _scanning = false;
  const o = State.orders[State.currentOrderIdx];
  if (o) o.items.forEach(i => { if (i.lastError) { delete i.lastError; } });
  renderDetail();
  startDetailScanner();
};

function updateOrderStatus(order) {
  const hasError = order.items.some(i => i.status === 'error');
  const allDone  = order.items.every(i => i.status !== 'pending');
  order.status   = !allDone ? 'pending' : hasError ? 'error' : 'ok';
}

document.getElementById('btn-confirm-order').addEventListener('click', () => {
  const o = State.orders[State.currentOrderIdx]; if (!o) return;
  o.confirmedAt = new Date().toLocaleTimeString('es-AR');
  Scanner.stop();
  renderOrdersList();
  showScreen('screen-orders');
});

document.getElementById('btn-torch').addEventListener('click', () => Scanner.toggleTorch());

document.getElementById('back-to-orders').addEventListener('click', () => {
  Scanner.stop();
  renderOrdersList();
  showScreen('screen-orders');
});

// ── VALIDADOR EAN ────────────────────────────────────────────
function startValidator() {
  document.getElementById('val-result').style.display = 'none';
  Scanner2.start('scanner-video-validator', ean => {
    let foundSku = '', foundDesc = '';
    if (State.catalog) {
      for (const [sku, info] of State.catalog) {
        if (info.ean && info.ean.trim() === ean.trim()) {
          foundSku = sku; foundDesc = info.desc; break;
        }
      }
    }
    const res = document.getElementById('val-result');
    document.getElementById('val-ean').textContent  = ean;
    document.getElementById('val-sku').textContent  = foundSku || '— No encontrado';
    document.getElementById('val-desc').textContent = foundDesc || (foundSku ? '' : 'EAN no registrado en catálogo');
    res.style.display    = 'block';
    res.style.borderColor = foundSku ? '#1D9E75' : '#dc2626';
  }, err => {
    // BarcodeDetector no disponible — usar html5-qrcode como fallback
    console.warn('[Validador] BarcodeDetector no disponible, usando fallback:', err);
    Scanner.start('scanner-video-validator', ean => {
      let foundSku = '', foundDesc = '';
      if (State.catalog) {
        for (const [sku, info] of State.catalog) {
          if (info.ean && info.ean.trim() === ean.trim()) {
            foundSku = sku; foundDesc = info.desc; break;
          }
        }
      }
      const res = document.getElementById('val-result');
      document.getElementById('val-ean').textContent  = ean;
      document.getElementById('val-sku').textContent  = foundSku || '— No encontrado';
      document.getElementById('val-desc').textContent = foundDesc || '';
      res.
