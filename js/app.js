/* v20260415 — modo consolidado por SKU */
/**
 * app.js — versión con agrupación consolidada por SKU
 * Cambios: vista de pedidos agrupa por marca → SKU (sin comprador ni ID pedido)
 * Al escanear un SKU se muestra solo ese artículo y se requieren N escaneos
 */

const State = {
  catalog: null,
  orders: [],
  currentOrderIdx: -1,   // legacy — ya no se usa en modo detalle
  currentSkuKey: null,   // { sku, marca } — SKU actualmente en escaneo
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
  try {
    State.catalog = await CatalogService.getCatalog(false);
    State.catalogLoaded = true;
  } catch(e) { console.warn('[Catálogo]', e.message); }

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

  const oi = document.getElementById('input-operario');
  if (oi && State.operario) oi.value = State.operario;
  checkCanGoOrders();
}

function checkCanGoOrders() {
  const catOk = State.catalogLoaded || CatalogService.cachedCount() > 0;
  document.getElementById('btn-go-orders').disabled = !(catOk && State.pdfLoaded);
}

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

// ── HELPERS — CONSOLIDAR SKUs ────────────────────────────────
/**
 * Construye un mapa consolidado de SKUs a partir de todos los pedidos.
 * Estructura: Map<sku, { sku, desc, marca, hasEan, totalQty, scannedQty, allDone, hasError, items[] }>
 * items[] = referencias a los {order, item} originales, para poder actualizar el estado.
 */
function buildSkuMap() {
  const map = new Map(); // key = sku
  State.orders.forEach((order, orderIdx) => {
    order.items.forEach((item, itemIdx) => {
      const key = item.sku;
      if (!map.has(key)) {
        map.set(key, {
          sku:      item.sku,
          desc:     item.desc     || '',
          marca:    item.marca    || 'Varios',
          hasEan:   item.hasEan,
          totalQty:   0,
          scannedQty: 0,
          allDone:  false,
          hasError: false,
          refs: [],  // { order, orderIdx, item, itemIdx }
        });
      }
      const entry = map.get(key);
      entry.totalQty   += item.qty;
      entry.scannedQty += (item.scanned || 0);
      entry.refs.push({ order, orderIdx, item, itemIdx });
    });
  });

  // Calcular estado consolidado
  map.forEach(entry => {
    entry.allDone  = entry.refs.every(r => r.item.status !== 'pending');
    entry.hasError = entry.refs.some(r => r.item.status === 'error' || r.item.lastError);
  });

  return map;
}

// ── LISTA PEDIDOS (consolidada por marca → SKU) ──────────────
function renderOrdersList() {
  const list = document.getElementById('orders-list');
  list.innerHTML = '';

  // Progreso global: pedidos (no SKUs)
  const total = State.orders.length;
  const done  = State.orders.filter(o => o.status !== 'pending').length;
  document.getElementById('progress-fill').style.width = (total ? done / total * 100 : 0) + '%';
  document.getElementById('progress-label').textContent = `${done} de ${total} pedidos procesados`;
  const ol = document.getElementById('operario-label');
  if (ol) ol.textContent = State.operario ? 'Operario: ' + State.operario : '';

  // Construir mapa consolidado
  const skuMap = buildSkuMap();

  // Agrupar SKUs por marca
  const byMarca = {};
  skuMap.forEach((entry, sku) => {
    const marca = (entry.marca || 'Varios').trim();
    if (!byMarca[marca]) byMarca[marca] = [];
    byMarca[marca].push(entry);
  });

  // Ordenar marcas
  const marcas = Object.keys(byMarca).sort((a, b) => {
    if (a === 'Varios') return 1;
    if (b === 'Varios') return -1;
    return a.localeCompare(b, 'es');
  });

  marcas.forEach(marca => {
    const entries = byMarca[marca];

    // Encabezado de marca — totales de unidades
    const totalUnits  = entries.reduce((s, e) => s + e.totalQty, 0);
    const scannedUnits = entries.reduce((s, e) => s + e.scannedQty, 0);

    const header = document.createElement('div');
    header.className = 'marca-header';
    header.innerHTML = `
      <span class="marca-name">${escHtml(marca)}</span>
      <span class="marca-count">${scannedUnits}/${totalUnits}</span>`;
    list.appendChild(header);

    // Un ítem por SKU (consolidado, sin comprador ni ID)
    entries.forEach(entry => {
      const div = document.createElement('div');
      div.className = 'marca-item';

      const allOk  = entry.allDone && !entry.hasError;
      const hasErr = entry.hasError;
      const noEan  = entry.hasEan === false;

      const stIcon = allOk  ? '✓'
                   : hasErr ? '✕'
                   : noEan  ? '—' : '○';
      const stCls  = allOk  ? 'check-ok'
                   : hasErr ? 'check-error'
                   : noEan  ? 'check-warn' : 'check-gray';

      const progress = `${entry.scannedQty}/${entry.totalQty}`;

      div.innerHTML = `
        <div class="sku-check ${stCls}" style="flex-shrink:0">${stIcon}</div>
        <div class="marca-item-info">
          <div class="marca-item-sku">${escHtml(entry.sku)} <span style="font-weight:400;color:var(--gray-text)">×${entry.totalQty}</span></div>
          <div class="marca-item-desc">${escHtml(entry.desc)}</div>
          <div class="marca-item-buyer" style="font-size:11px;color:#aaa">${progress} unidades escaneadas</div>
        </div>
        <button class="marca-item-btn" onclick="openSku('${escHtml(entry.sku)}')">Escanear →</button>`;
      list.appendChild(div);
    });
  });

  saveProgress();
}

// ── DETALLE SKU (modo consolidado) ───────────────────────────
/**
 * Abre la pantalla de escaneo para un SKU específico.
 * Muestra solo ese SKU con la cantidad total consolidada.
 */
window.openSku = function(sku) {
  State.currentSkuKey = sku;
  Scanner.stop();
  _scanning = false;
  document.getElementById('retry-scan-wrap')?.remove();
  renderSkuDetail();
  showScreen('screen-detail');
  startSkuScanner();
};

function getSkuEntry(sku) {
  const skuMap = buildSkuMap();
  return skuMap.get(sku) || null;
}

function renderSkuDetail() {
  const sku = State.currentSkuKey;
  const entry = getSkuEntry(sku);
  if (!entry) return;

  // Reutilizamos la pantalla screen-detail pero mostramos solo el SKU
  document.getElementById('detail-buyer-name').textContent = entry.desc || entry.sku;
  document.getElementById('detail-order-id').textContent   = entry.sku;

  const allOk  = entry.allDone && !entry.hasError;
  const hasErr = entry.hasError;
  const badge  = document.getElementById('detail-status-badge');
  badge.textContent = allOk ? 'OK' : hasErr ? 'Error' : 'Pendiente';
  badge.className   = 'badge ' + (allOk ? 'badge-ok' : hasErr ? 'badge-error' : 'badge-warn');

  const container = document.getElementById('detail-skus');
  container.innerHTML = '';

  // Un único bloque para el SKU consolidado
  const div = document.createElement('div');
  div.className = 'sku-item';

  const scanned  = entry.scannedQty;
  const total    = entry.totalQty;
  const hasErr2  = entry.hasError;
  const noEan    = entry.hasEan === false;

  const icon = allOk  ? '✓'
             : noEan  ? '—'
             : hasErr2 ? '✕' : '○';
  const cls  = allOk  ? 'check-ok'
             : noEan  ? 'check-warn'
             : hasErr2 ? 'check-error' : 'check-gray';

  const progressTxt = `${scanned} de ${total} unidades escaneadas`;
  const eanTxt = allOk        ? '✓ Completo'
               : noEan        ? 'Sin código de barras'
               : hasErr2      ? '✕ EAN incorrecto — reescaneá'
               : scanned > 0  ? progressTxt
               : '—';

  const desc = entry.desc ? `<div class="sku-desc">${escHtml(entry.desc)}</div>` : '';
  const manBtn = (!allOk && noEan)
    ? `<button class="btn-manual" onclick="confirmManualSku()">Confirmar manual (${scanned}/${total})</button>` : '';

  div.innerHTML = `
    <div class="sku-check ${cls}">${icon}</div>
    <div class="sku-info">
      <div class="sku-code">${escHtml(sku)} — ${scanned}/${total}</div>
      ${desc}
      <div class="sku-ean">${eanTxt}</div>
      ${manBtn}
    </div>
    <div class="sku-qty">×${total}</div>`;
  container.appendChild(div);

  // Botón confirmar solo si todo está OK
  document.getElementById('btn-confirm-order').disabled = !allOk;
}

window.confirmManualSku = function() {
  const sku = State.currentSkuKey;
  const entry = getSkuEntry(sku);
  if (!entry) return;

  // Buscar el primer ítem pendiente sin EAN y confirmar una unidad
  let confirmed = false;
  for (const ref of entry.refs) {
    if (ref.item.status === 'pending' && ref.item.hasEan === false) {
      ref.item.scanned = (ref.item.scanned || 0) + 1;
      if (ref.item.scanned >= ref.item.qty) {
        ref.item.status     = 'ok';
        ref.item.scannedEan = 'Confirmado manualmente';
        updateOrderStatus(ref.order);
      }
      confirmed = true;
      break;
    }
  }

  if (confirmed) {
    const newEntry = getSkuEntry(sku);
    if (newEntry && newEntry.scannedQty >= newEntry.totalQty) {
      showToast(`✓ ${sku} — ${newEntry.totalQty} unidades confirmadas`, 'ok');
    } else if (newEntry) {
      showToast(`✓ ${newEntry.scannedQty}/${newEntry.totalQty} confirmadas — tocá de nuevo`, 'ok', 2000);
    }
  }

  saveProgress();
  renderSkuDetail();
  renderOrdersList();
};

function startSkuScanner() {
  document.getElementById('scanner-error').style.display = 'none';
  const sku = State.currentSkuKey;
  const entry = getSkuEntry(sku);

  // Si todos los ítems no tienen EAN, ocultar escáner
  if (entry && entry.refs.every(r => r.item.hasEan === false)) {
    document.getElementById('scanner-wrap').style.display = 'none';
    return;
  }
  document.getElementById('scanner-wrap').style.display = 'block';
  Scanner.start('scanner-video', onEanScannedSku, err => {
    document.getElementById('scanner-error').textContent = err;
    document.getElementById('scanner-error').style.display = 'block';
  });
}

/**
 * Al escanear en modo SKU consolidado:
 * - Busca el primer ítem pendiente de ese SKU (en cualquier pedido)
 * - Valida el EAN contra el SKU
 * - Acumula unidades hasta completar la cantidad total
 */
function onEanScannedSku(ean) {
  if (_scanning) return;
  _scanning = true;

  const sku = State.currentSkuKey;
  const entry = getSkuEntry(sku);
  if (!entry) { _scanning = false; return; }

  // Buscar primer ref pendiente con EAN
  const pendingRef = entry.refs.find(r => r.item.status === 'pending' && r.item.hasEan !== false);
  if (!pendingRef) { _scanning = false; return; }

  const item   = pendingRef.item;
  const order  = pendingRef.order;
  const result = CatalogService.validate(item.sku, ean, State.catalog);
  item.scannedEan = ean;

  if (result.status === 'ok') {
    item.scanned = (item.scanned || 0) + 1;
    if (item.scanned >= item.qty) {
      item.status = 'ok';
    }

    // Recalcular estado consolidado
    const newEntry = getSkuEntry(sku);
    const newScanned = newEntry ? newEntry.scannedQty : 0;
    const newTotal   = newEntry ? newEntry.totalQty   : 0;

    if (newScanned >= newTotal) {
      showToast(`✓ ${sku} — ${newTotal} unidades OK`, 'ok');
    } else {
      showToast(`✓ Unidad ${newScanned}/${newTotal} — escaneá la siguiente`, 'ok', 2000);
    }

    playBeep('ok');
    setTimeout(() => { _scanning = false; }, 800);
    updateOrderStatus(order);
    renderSkuDetail();
    renderOrdersList();

  } else if (result.status === 'error') {
    item.lastError = ean;
    playBeep('error');
    Scanner.stop();
    _scanning = false;
    showToast('✕ EAN incorrecto. Tocá "Reintentar".', 'error', 4000);
    renderSkuDetail();
    document.getElementById('retry-scan-wrap')?.remove();
    const retryDiv = document.createElement('div');
    retryDiv.id = 'retry-scan-wrap';
    retryDiv.style.cssText = 'padding:10px 0';
    retryDiv.innerHTML = '<button class="btn-secondary" onclick="retryScanSku()" style="border-color:#dc2626;color:#dc2626">↺ Reintentar escaneo</button>';
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
    renderSkuDetail();
    renderOrdersList();
  }
}

window.retryScanSku = function() {
  document.getElementById('retry-scan-wrap')?.remove();
  _scanning = false;
  const sku = State.currentSkuKey;
  // Limpiar lastError en todos los refs de este SKU
  const entry = getSkuEntry(sku);
  if (entry) entry.refs.forEach(r => { if (r.item.lastError) delete r.item.lastError; });
  renderSkuDetail();
  startSkuScanner();
};

// ── Confirmar SKU completo y volver ─────────────────────────
document.getElementById('btn-confirm-order').addEventListener('click', () => {
  const sku = State.currentSkuKey;
  const entry = getSkuEntry(sku);
  if (entry) {
    entry.refs.forEach(r => {
      if (!r.order.confirmedAt) r.order.confirmedAt = new Date().toLocaleTimeString('es-AR');
    });
  }
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

// ── HELPERS ──────────────────────────────────────────────────
function updateOrderStatus(order) {
  const hasError = order.items.some(i => i.status === 'error');
  const allDone  = order.items.every(i => i.status !== 'pending');
  order.status   = !allDone ? 'pending' : hasError ? 'error' : 'ok';
}

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
      res.style.display    = 'block';
      res.style.borderColor = foundSku ? '#1D9E75' : '#dc2626';
    }, e => console.warn('[Validador fallback]', e));
  });
}

document.getElementById('back-from-validator').addEventListener('click', () => {
  Scanner.stop();
  Scanner2.stop();
  showScreen('screen-home');
});

['btn-torch-validator', 'btn-torch-validator-2'].forEach(id => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', () => Scanner2.toggleTorch());
});

// ── RESUMEN ──────────────────────────────────────────────────
function renderSummary() {
  const ok   = State.orders.filter(o => o.status === 'ok').length;
  const pend = State.orders.filter(o => o.status === 'pending').length;
  const err  = State.orders.filter(o => o.status === 'error').length;
  document.getElementById('sum-ok').textContent      = ok;
  document.getElementById('sum-pending').textContent = pend;
  document.getElementById('sum-error').textContent   = err;

  const so = document.getElementById('sum-operario');
  if (so) so.textContent = State.operario ? 'Operario: ' + State.operario : '';

  // Resumen por SKU consolidado (sin comprador)
  const list = document.getElementById('summary-list');
  list.innerHTML = '';
  const skuMap = buildSkuMap();

  skuMap.forEach((entry, sku) => {
    const div = document.createElement('div');
    div.className = 'summary-item';
    const allOk  = entry.allDone && !entry.hasError;
    const hasErr = entry.hasError;
    const bc = allOk ? 'badge-ok' : hasErr ? 'badge-error' : 'badge-warn';
    const bt = allOk ? '✓ OK' : hasErr ? '✕ Error' : 'Pendiente';
    div.innerHTML = `
      <div>
        <div class="summary-name">${escHtml(sku)}</div>
        <div class="summary-sub">${escHtml(entry.desc)} — ${entry.scannedQty}/${entry.totalQty} uds</div>
      </div>
      <span class="badge ${bc}">${bt}</span>`;
    list.appendChild(div);
  });
}

// ── EXPORTAR REPORTE ─────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  const now  = new Date().toLocaleString('es-AR');
  const ok   = State.orders.filter(o => o.status === 'ok');
  const err  = State.orders.filter(o => o.status === 'error');
  const pend = State.orders.filter(o => o.status === 'pending');

  const skuMap = buildSkuMap();
  let skuRows = '';
  skuMap.forEach((entry, sku) => {
    const allOk  = entry.allDone && !entry.hasError;
    const hasErr = entry.hasError;
    const sc = allOk ? 'ok' : hasErr ? 'er' : 'pn';
    const st = allOk ? '✓ OK' : hasErr ? '✕ Error' : 'Pendiente';
    skuRows += `<tr>
      <td style="font-family:monospace">${sku}</td>
      <td>${escHtml(entry.desc)}</td>
      <td>${escHtml(entry.marca)}</td>
      <td>${entry.scannedQty}/${entry.totalQty}</td>
      <td class="${sc}">${st}</td>
    </tr>`;
  });

  let html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<style>
body{font-family:Arial,sans-serif;font-size:13px;padding:24px}
h1{color:#1a56db}.meta{color:#6b7280;font-size:12px;margin-bottom:16px}
.metrics{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.metric{background:#f3f4f6;border-radius:8px;padding:12px 20px;text-align:center}
.val{font-size:28px;font-weight:700}.green{color:#1D9E75}.red{color:#dc2626}.amber{color:#d97706}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th{background:#1a56db;color:#fff;padding:7px 10px;font-size:12px;text-align:left}
td{padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px}
tr:nth-child(even) td{background:#f9fafb}
.ok{color:#1D9E75;font-weight:600}.er{color:#dc2626;font-weight:600}.pn{color:#d97706;font-weight:600}
</style></head><body>
<h1>📦 Reporte de despacho</h1>
<div class="meta">Operario: <strong>${escHtml(State.operario || 'Sin identificar')}</strong> · Generado: ${now}</div>
<div class="metrics">
  <div class="metric"><div class="val green">${ok.length}</div><div>Pedidos OK</div></div>
  <div class="metric"><div class="val amber">${pend.length}</div><div>Pendientes</div></div>
  <div class="metric"><div class="val red">${err.length}</div><div>Con error</div></div>
  <div class="metric"><div class="val">${State.orders.length}</div><div>Total pedidos</div></div>
</div>
<h2>SKUs procesados</h2>
<table><thead><tr><th>SKU</th><th>Descripción</th><th>Marca</th><th>Uds</th><th>Estado</th></tr></thead>
<tbody>${skuRows}</tbody></table>`;

  if (err.length) {
    html += `<h2>⚠ Incidencias</h2>
<table><thead><tr><th>SKU</th><th>Descripción</th><th>EAN leído</th><th>EAN esperado</th></tr></thead><tbody>`;
    err.forEach(o => o.items.filter(i => i.status === 'error' || i.lastError).forEach(i => {
      const exp = State.catalog ? (State.catalog.get(i.sku)?.ean || '—') : '—';
      html += `<tr><td>${i.sku}</td><td>${escHtml(i.desc||'')}</td><td style="color:#dc2626">${i.scannedEan||'—'}</td><td>${exp}</td></tr>`;
    }));
    html += '</tbody></table>';
  }
  html += '</body></html>';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = `reporte-${(State.operario||'sin-nombre').replace(/\s+/g,'-')}-${new Date().toISOString().slice(0,10)}.html`;
  a.click();

  setTimeout(() => {
    if (confirm('¿Querés cerrar esta sesión y empezar una nueva?')) {
      clearProgress();
      showScreen('screen-home');
    }
  }, 500);
});

const btnNew = document.getElementById('btn-new-session');
if (btnNew) btnNew.addEventListener('click', () => {
  if (!confirm('¿Cerrar sesión y empezar nueva? Exportá el reporte antes si lo necesitás.')) return;
  clearProgress();
  showScreen('screen-home');
});

// ── AUDIO ────────────────────────────────────────────────────
function playBeep(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = type === 'ok' ? 880 : 220;
    g.gain.setValueAtTime(.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + (type === 'ok' ? .15 : .4));
    o.start();
    o.stop(ctx.currentTime + (type === 'ok' ? .15 : .4));
  } catch {}
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
initApp();
