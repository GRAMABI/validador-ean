/* v20260701B — modo consolidado por SKU + finalización de lote + UX depósito */
/**
 * app.js — versión con agrupación consolidada por SKU
 * Cambios: vista de pedidos agrupa por marca → SKU (sin comprador ni ID pedido)
 * Al escanear un SKU se muestra solo ese artículo y se requieren N escaneos
 * + Finalización de lote: botón "Finalizar preparación", done-state y faltantes
 * + UX: linterna con estado, reintentar sin detener cámara, toasts globales,
 *   botones más grandes para uso con guantes
 */

const State = {
  catalog: null,
  orders: [],
  currentOrderIdx: -1,   // legacy — ya no se usa en modo detalle
  currentSkuKey: null,   // { sku, marca } — SKU actualmente en escaneo
  pdfLoaded: false,
  catalogLoaded: false,
  operario: localStorage.getItem('vean_operario') || '',
  batchFinalized: false, // lote cerrado por el operario
  finalizedAt: null,     // ISO timestamp del cierre
  shortages: [],          // [{sku, desc, marca, missingQty, reason}] quiebres de stock
};
let _scanning = false;
let _readyToastShown = false; // aviso "todo escaneado" una vez por transición
let _quotaWarned = false;     // aviso de cuota de localStorage una vez
const SCAN_LOCK_MS = 2000;    // alineado con el lock anti-repetición de scanner.js

function setTorchBtnState(btn, state) {
  if (!btn) return;
  if (state === null) { btn.textContent = '🔦 No disponible'; btn.classList.remove('torch-on'); }
  else if (state)      { btn.textContent = '🔦 Linterna ON';   btn.classList.add('torch-on'); }
  else                 { btn.textContent = '🔦 Linterna';      btn.classList.remove('torch-on'); }
}

// ── PERSISTENCIA ─────────────────────────────────────────────
function saveProgress() {
  try {
    localStorage.setItem('vean_progress', JSON.stringify({
      orders: State.orders,
      operario: State.operario,
      batchFinalized: State.batchFinalized,
      finalizedAt: State.finalizedAt,
      shortages: State.shortages,
    }));
  } catch(e) {
    // Cuota de localStorage llena → avisar (una vez) en vez de perder progreso en silencio
    if (!_quotaWarned) {
      _quotaWarned = true;
      showToast('⚠ No se pudo guardar el progreso — exportá el reporte ya', 'error', 5000);
    }
  }
}
function loadProgress() {
  try { return JSON.parse(localStorage.getItem('vean_progress')); } catch { return null; }
}
function clearProgress() {
  localStorage.removeItem('vean_progress');
  State.orders = [];
  State.pdfLoaded = false;
  State.batchFinalized = false;
  State.finalizedAt = null;
  State.shortages = [];
  _readyToastShown = false;
  _quotaWarned = false;
}

// ── NAVEGACIÓN ───────────────────────────────────────────────
// Pantallas que usan cámara: showScreen no debe apagarles el escáner al entrar.
const CAM_SCREENS = ['screen-detail', 'screen-validator', 'screen-stock-scan'];

function showScreen(id) {
  // Guard: sin esto un id mal escrito dejaba la app SIN ninguna pantalla
  // activa (negro total, solo recuperable recargando).
  const el = document.getElementById(id);
  if (!el) { console.error('[showScreen] no existe la pantalla:', id); return; }
  if (!CAM_SCREENS.includes(id)) Scanner.stop();
  if (id !== 'screen-validator' && id !== 'screen-stock-scan') Scanner2.stop();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
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
  } catch(e) {
    console.warn('[Catálogo]', e.message);
    showToast('⚠ No se pudo cargar el catálogo — revisá la conexión', 'warn', 5000);
  }

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
  State.batchFinalized = prog.batchFinalized || false;
  State.finalizedAt    = prog.finalizedAt || null;
  State.shortages      = prog.shortages || [];
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
    // Lote nuevo → resetear estado de finalización y faltantes
    State.batchFinalized = false;
    State.finalizedAt = null;
    State.shortages = [];
    _readyToastShown = false;
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

  // Progreso global: por UNIDADES/SKU consolidado (fuente de verdad de la UI),
  // no por order.status (que quedaba 'pending' eterno con items sin EAN).
  const stats = getBatchStats();
  const pctVal = stats.totalUnits ? (stats.scannedUnits + stats.missingUnits) / stats.totalUnits * 100 : 0;
  document.getElementById('progress-fill').style.width = pctVal + '%';
  document.getElementById('progress-label').textContent =
    `${stats.scannedUnits} de ${stats.totalUnits} unidades validadas` +
    (stats.missingUnits ? ` · ${stats.missingUnits} faltante(s)` : '');
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

      // Faltante declarado (quiebre de stock) que cubre las unidades sin escanear
      const shortage = State.shortages.find(s => s.sku === entry.sku);
      const shMissing = shortage ? shortage.missingQty : 0;
      const covered  = entry.scannedQty + shMissing >= entry.totalQty && !hasErr;
      const isShort  = shMissing > 0 && covered && !allOk;

      const stIcon = allOk   ? '✓'
                   : isShort ? '⚠'
                   : hasErr  ? '✕'
                   : noEan   ? '—' : '○';
      const stCls  = allOk   ? 'check-ok'
                   : isShort ? 'check-warn'
                   : hasErr  ? 'check-error'
                   : noEan   ? 'check-warn' : 'check-gray';

      const progress = isShort
        ? `${entry.scannedQty}/${entry.totalQty} · ${shMissing} faltante(s)`
        : `${entry.scannedQty}/${entry.totalQty} unidades escaneadas`;

      div.innerHTML = `
        <div class="sku-check ${stCls}" style="flex-shrink:0">${stIcon}</div>
        <div class="marca-item-info">
          <div class="marca-item-sku">${escHtml(entry.sku)} <span style="font-weight:400;color:var(--gray-text)">×${entry.totalQty}</span></div>
          <div class="marca-item-desc">${escHtml(entry.desc)}</div>
          <div class="marca-item-buyer" style="font-size:11px;color:#aaa">${progress}</div>
        </div>
        <button class="marca-item-btn" onclick="openSku('${escHtml(entry.sku)}')">${allOk || isShort ? 'Ver →' : 'Escanear →'}</button>`;
      list.appendChild(div);
    });
  });

  updateBatchActionUI();
  saveProgress();
}

// ── ESTADO DEL LOTE (consolidado por SKU) ────────────────────
/**
 * Estadísticas del lote calculadas SOBRE buildSkuMap (por SKU/unidades),
 * que es la fuente de verdad del modo consolidado — no sobre order.status.
 * Un SKU está "listo" si escaneó todas sus unidades o el resto se declaró faltante.
 */
function getBatchStats() {
  const map = buildSkuMap();
  let totalSkus = 0, readySkus = 0, pendingSkus = 0, errorSkus = 0, noEanPendingSkus = 0;
  let totalUnits = 0, scannedUnits = 0, missingUnits = 0;
  map.forEach(entry => {
    totalSkus++;
    totalUnits   += entry.totalQty;
    scannedUnits += entry.scannedQty;
    const sh = State.shortages.find(s => s.sku === entry.sku);
    const shMissing = sh ? sh.missingQty : 0;
    missingUnits += shMissing;
    const covered = entry.scannedQty + shMissing;
    if (entry.hasError)                { errorSkus++; }
    else if (covered >= entry.totalQty) { readySkus++; }
    else { pendingSkus++; if (entry.hasEan === false) noEanPendingSkus++; }
  });
  const pendingUnits = Math.max(0, totalUnits - scannedUnits - missingUnits);
  const allReady = pendingSkus === 0 && errorSkus === 0 && totalSkus > 0;
  return { totalSkus, readySkus, pendingSkus, errorSkus, noEanPendingSkus,
           totalUnits, scannedUnits, pendingUnits, missingUnits, allReady };
}

/**
 * Refresca el botón "Finalizar preparación" y el banner de lote finalizado.
 * Se llama al final de renderOrdersList (que corre tras cada escaneo).
 */
function updateBatchActionUI() {
  const btn    = document.getElementById('btn-finish-batch');
  const banner = document.getElementById('batch-done-banner');
  const hint   = document.getElementById('orders-batch-hint');
  if (!btn) return;
  const s = getBatchStats();

  if (hint) {
    hint.textContent = State.batchFinalized ? '' :
      `${s.readySkus} listos · ${s.pendingSkus} pendientes` +
      (s.errorSkus ? ` · ${s.errorSkus} con error` : '') +
      (s.missingUnits ? ` · ${s.missingUnits} faltante(s)` : '');
  }

  if (State.batchFinalized) {
    btn.textContent = '📋 Ver resumen';
    btn.className = 'btn-secondary';
    if (banner) {
      const t = State.finalizedAt
        ? new Date(State.finalizedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
        : '';
      banner.style.display = 'block';
      banner.textContent = `✓ Lote finalizado${t ? ' a las ' + t : ''}`;
    }
    document.querySelectorAll('#orders-list .marca-item-btn').forEach(b => b.classList.add('locked'));
    return;
  }

  if (banner) banner.style.display = 'none';
  document.querySelectorAll('#orders-list .marca-item-btn').forEach(b => b.classList.remove('locked'));

  if (s.allReady) {
    btn.textContent = '✓ Finalizar preparación';
    btn.className = 'btn-primary';
    if (!_readyToastShown) { _readyToastShown = true; showToast('Todo listo — tocá Finalizar', 'ok', 3000); }
  } else {
    const n = s.pendingUnits;
    btn.textContent = `Finalizar (faltan ${n} ud${n === 1 ? '' : 's'})`;
    btn.className = 'btn-primary btn-warn';
    _readyToastShown = false;
  }
}

// ── FINALIZAR PREPARACIÓN DEL LOTE ───────────────────────────
function showFinishDialog() {
  const s = getBatchStats();
  document.getElementById('finish-dlg')?.remove();
  const clean = s.allReady;
  const rows = [];
  rows.push(`<div style="display:flex;justify-content:space-between;padding:4px 0"><span>SKUs listos</span><strong>${s.readySkus}/${s.totalSkus}</strong></div>`);
  if (s.pendingUnits) rows.push(`<div style="display:flex;justify-content:space-between;padding:4px 0;color:#d97706"><span>Unidades sin validar</span><strong>${s.pendingUnits}</strong></div>`);
  if (s.errorSkus)    rows.push(`<div style="display:flex;justify-content:space-between;padding:4px 0;color:#dc2626"><span>SKUs con error</span><strong>${s.errorSkus}</strong></div>`);
  if (s.missingUnits) rows.push(`<div style="display:flex;justify-content:space-between;padding:4px 0;color:#6b7280"><span>Faltantes declarados</span><strong>${s.missingUnits}</strong></div>`);
  const dlg = document.createElement('div');
  dlg.id = 'finish-dlg';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:999;padding:20px;box-sizing:border-box';
  dlg.innerHTML = `<div style="background:#fff;border-radius:16px;padding:24px;max-width:360px;width:100%">
    <div style="font-size:26px;margin-bottom:8px">${clean ? '✅' : '⚠️'}</div>
    <div style="font-size:16px;font-weight:600;margin-bottom:10px">${clean ? 'Preparación completa' : 'Finalizar con pendientes'}</div>
    <div style="font-size:13px;margin-bottom:16px">${rows.join('')}</div>
    <button class="btn-primary${clean ? '' : ' btn-warn'}" style="margin-bottom:8px" onclick="doFinishBatch()">${clean ? 'Finalizar preparación' : 'Finalizar igual'}</button>
    <button class="btn-secondary" onclick="document.getElementById('finish-dlg').remove()">Seguir preparando</button>
  </div>`;
  document.body.appendChild(dlg);
}

window.doFinishBatch = function() {
  document.getElementById('finish-dlg')?.remove();
  finalizeBatch();
  showScreen('screen-summary');
};

function finalizeBatch() {
  if (State.batchFinalized) return; // idempotente
  const now = new Date().toLocaleTimeString('es-AR');
  State.orders.forEach(o => { updateOrderStatus(o); if (!o.confirmedAt) o.confirmedAt = now; });
  State.batchFinalized = true;
  State.finalizedAt = new Date().toISOString();
  Scanner.stop();
  saveProgress();
  showToast('✓ Lote finalizado', 'ok');
}

// ── DETALLE SKU (modo consolidado) ───────────────────────────
/**
 * Abre la pantalla de escaneo para un SKU específico.
 * Muestra solo ese SKU con la cantidad total consolidada.
 */
window.openSku = function(sku) {
  if (State.batchFinalized) {
    showToast('Lote finalizado — iniciá nueva sesión para re-escanear', 'warn', 3000);
    return;
  }
  State.currentSkuKey = sku;
  Scanner.stop();
  _scanning = false;
  setTorchBtnState(document.getElementById('btn-torch'), false);
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
  const remaining = total - scanned;
  const manBtn = (!allOk && noEan)
    ? `<button class="btn-manual" onclick="confirmManualSku()">Confirmar 1 (${scanned}/${total})</button>` +
      (remaining > 1 ? `<button class="btn-manual" style="margin-top:4px" onclick="confirmAllNoEan()">Confirmar todo (${remaining})</button>` : '')
    : '';
  // Quiebre de stock: marcar las unidades faltantes para poder cerrar el lote
  const shortBtn = (!allOk && remaining > 0)
    ? `<button class="btn-manual" style="margin-top:4px;background:var(--red-bg);color:var(--red);border-color:#fca5a5" onclick="markShortage()">⚠ Marcar faltante (${remaining})</button>`
    : '';

  div.innerHTML = `
    <div class="sku-check ${cls}">${icon}</div>
    <div class="sku-info">
      <div class="sku-code">${escHtml(sku)} — ${scanned}/${total}</div>
      ${desc}
      <div class="sku-ean">${eanTxt}</div>
      ${manBtn}
      ${shortBtn}
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

// Confirmar en bloque todas las unidades restantes de un SKU sin EAN
window.confirmAllNoEan = function() {
  const sku = State.currentSkuKey;
  const entry = getSkuEntry(sku);
  if (!entry) return;
  entry.refs.forEach(ref => {
    if (ref.item.status === 'pending' && ref.item.hasEan === false) {
      ref.item.scanned = ref.item.qty;
      ref.item.status = 'ok';
      ref.item.scannedEan = 'Confirmado manualmente';
      updateOrderStatus(ref.order);
    }
  });
  saveProgress();
  const ne = getSkuEntry(sku);
  showToast(`✓ ${sku} — ${ne ? ne.totalQty : ''} unidades confirmadas`, 'ok');
  renderSkuDetail();
  renderOrdersList();
};

// Declarar quiebre de stock: registra las unidades faltantes del SKU actual
window.markShortage = function() {
  const sku = State.currentSkuKey;
  const entry = getSkuEntry(sku);
  if (!entry) return;
  const missing = entry.totalQty - entry.scannedQty;
  if (missing <= 0) return;
  if (!confirm(`¿Marcar ${missing} unidad(es) de ${sku} como faltante (quiebre de stock)?`)) return;

  const existing = State.shortages.find(s => s.sku === sku);
  if (existing) existing.missingQty = missing;
  else State.shortages.push({ sku, desc: entry.desc, marca: entry.marca, missingQty: missing, reason: 'Sin stock' });

  // Limpiar errores de este SKU para que no bloqueen la finalización
  entry.refs.forEach(r => {
    if (r.item.lastError) delete r.item.lastError;
    if (r.item.status === 'error') r.item.status = 'pending';
    updateOrderStatus(r.order);
  });

  saveProgress();
  showToast(`⚠ ${missing} faltante(s) registrada(s) en ${sku}`, 'warn', 3000);
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
  delete item.lastError; // un nuevo intento reemplaza el error anterior (lo re-setea la rama 'error' si corresponde)

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
    setTimeout(() => { _scanning = false; }, SCAN_LOCK_MS);
    updateOrderStatus(order);
    renderSkuDetail();
    renderOrdersList();

  } else if (result.status === 'error') {
    item.lastError = ean;
    playBeep('error');
    // La cámara sigue activa: no hace falta ubicar un botón para reintentar,
    // solo reapuntar. El lock de scanner.js ya evita re-disparar el mismo EAN.
    showToast('✕ EAN incorrecto — reintentá', 'error', 2500);
    setTimeout(() => { _scanning = false; }, SCAN_LOCK_MS);
    renderSkuDetail();

  } else {
    if (result.status === 'no_ean') {
      item.status = 'no_ean';
      showToast('⚠ Sin EAN registrado', 'warn');
    } else {
      item.status = 'not_in_catalog';
      showToast('⚠ SKU no encontrado en catálogo', 'warn', 3000);
    }
    setTimeout(() => { _scanning = false; }, SCAN_LOCK_MS);
    updateOrderStatus(order);
    renderSkuDetail();
    renderOrdersList();
  }
}

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

document.getElementById('btn-torch').addEventListener('click', async () => {
  const btn = document.getElementById('btn-torch');
  const state = await Scanner.toggleTorch();
  setTorchBtnState(btn, state);
});

// Finalizar preparación del lote completo
document.getElementById('btn-finish-batch').addEventListener('click', () => {
  if (State.batchFinalized) { showScreen('screen-summary'); return; }
  if (!State.orders.length) { showToast('No hay lote cargado', 'warn'); return; }
  showFinishDialog();
});

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
  setTorchBtnState(document.getElementById('btn-torch-validator-2'), false);

  // Búsqueda por índice inverso (antes era un for..of lineal sobre 3779 SKUs
  // en CADA lectura, duplicado en los dos caminos).
  const mostrarResultado = (ean) => {
    const hits = CatalogService.findByEan(ean, State.catalog);
    const res = document.getElementById('val-result');
    document.getElementById('val-ean').textContent = ean;
    if (!hits.length) {
      document.getElementById('val-sku').textContent  = '— No encontrado';
      document.getElementById('val-desc').textContent = 'EAN no registrado en catálogo';
      res.style.borderColor = '#dc2626';
    } else {
      // 137 EANs del catálogo apuntan a más de un SKU: mostrarlos todos.
      document.getElementById('val-sku').textContent  = hits.map(h => h.sku).join('  ·  ');
      document.getElementById('val-desc').textContent = hits.length === 1
        ? hits[0].desc
        : hits.map(h => `${h.sku}: ${h.desc}`).join('\n');
      res.style.borderColor = '#1D9E75';
    }
    res.style.display = 'block';
  };

  Scanner2.start('scanner-video-validator', mostrarResultado, err => {
    console.warn('[Validador] BarcodeDetector no disponible, usando fallback:', err);
    // Si el operario ya salió de la pantalla, NO arrancar el fallback: dejaba
    // la cámara prendida en una pantalla oculta.
    if (!document.getElementById('screen-validator').classList.contains('active')) return;
    Scanner.start('scanner-video-validator', mostrarResultado,
      e => console.warn('[Validador fallback]', e));
  });
}

document.getElementById('back-from-validator').addEventListener('click', () => {
  Scanner.stop();
  Scanner2.stop();
  showScreen('screen-home');
});

document.getElementById('btn-torch-validator-2')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-torch-validator-2');
  // Scanner2 (BarcodeDetector) es el camino principal; si no tiene track activo
  // (cayó al fallback Scanner/html5-qrcode), probamos ese.
  let state = await Scanner2.toggleTorch();
  if (state === null) state = await Scanner.toggleTorch();
  setTorchBtnState(btn, state);
});

// ── RESUMEN ──────────────────────────────────────────────────
function renderSummary() {
  // Métricas por SKU consolidado (no por pedido) — coherente con la vista del operario
  const s = getBatchStats();
  document.getElementById('sum-ok').textContent      = s.readySkus;
  document.getElementById('sum-pending').textContent = s.pendingSkus;
  document.getElementById('sum-error').textContent   = s.errorSkus;

  const so = document.getElementById('sum-operario');
  if (so) so.textContent = State.operario ? 'Operario: ' + State.operario : '';

  const fin = document.getElementById('sum-finalized');
  if (fin) {
    if (State.finalizedAt) {
      fin.style.display = 'block';
      fin.textContent = `✓ Lote FINALIZADO — ${new Date(State.finalizedAt).toLocaleString('es-AR')}`;
    } else {
      fin.style.display = 'none';
    }
  }

  // Resumen por SKU consolidado (sin comprador)
  const list = document.getElementById('summary-list');
  list.innerHTML = '';
  const skuMap = buildSkuMap();

  skuMap.forEach((entry, sku) => {
    const div = document.createElement('div');
    div.className = 'summary-item';
    const shortage = State.shortages.find(x => x.sku === sku);
    const shMissing = shortage ? shortage.missingQty : 0;
    const allOk  = entry.allDone && !entry.hasError;
    const hasErr = entry.hasError;
    const isShort = shMissing > 0 && (entry.scannedQty + shMissing >= entry.totalQty) && !hasErr && !allOk;
    const bc = allOk ? 'badge-ok' : hasErr ? 'badge-error' : isShort ? 'badge-warn' : 'badge-warn';
    const bt = allOk ? '✓ OK' : hasErr ? '✕ Error' : isShort ? '⚠ Faltante' : 'Pendiente';
    const sub = `${escHtml(entry.desc)} — ${entry.scannedQty}/${entry.totalQty} uds` +
                (shMissing ? ` · ${shMissing} faltante(s)` : '');
    div.innerHTML = `
      <div>
        <div class="summary-name">${escHtml(sku)}</div>
        <div class="summary-sub">${sub}</div>
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

  const stats = getBatchStats();
  const skuMap = buildSkuMap();
  let skuRows = '';
  skuMap.forEach((entry, sku) => {
    const shortage = State.shortages.find(x => x.sku === sku);
    const shMissing = shortage ? shortage.missingQty : 0;
    const allOk  = entry.allDone && !entry.hasError;
    const hasErr = entry.hasError;
    const isShort = shMissing > 0 && (entry.scannedQty + shMissing >= entry.totalQty) && !hasErr && !allOk;
    const sc = allOk ? 'ok' : hasErr ? 'er' : 'pn';
    const st = allOk ? '✓ OK' : hasErr ? '✕ Error' : isShort ? '⚠ Faltante' : 'Pendiente';
    const uds = `${entry.scannedQty}/${entry.totalQty}` + (shMissing ? ` (${shMissing} falt.)` : '');
    skuRows += `<tr>
      <td style="font-family:monospace">${escHtml(sku)}</td>
      <td>${escHtml(entry.desc)}</td>
      <td>${escHtml(entry.marca)}</td>
      <td>${uds}</td>
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
<div class="meta">Operario: <strong>${escHtml(State.operario || 'Sin identificar')}</strong> · Generado: ${now}${State.finalizedAt ? ' · <strong style="color:#1D9E75">LOTE FINALIZADO ' + escHtml(new Date(State.finalizedAt).toLocaleString('es-AR')) + '</strong>' : ' · <strong style="color:#d97706">En preparación</strong>'}</div>
<div class="metrics">
  <div class="metric"><div class="val green">${stats.readySkus}</div><div>SKUs listos</div></div>
  <div class="metric"><div class="val amber">${stats.pendingSkus}</div><div>Pendientes</div></div>
  <div class="metric"><div class="val red">${stats.errorSkus}</div><div>Con error</div></div>
  <div class="metric"><div class="val">${stats.scannedUnits}/${stats.totalUnits}</div><div>Unidades</div></div>
</div>
<h2>SKUs procesados</h2>
<table><thead><tr><th>SKU</th><th>Descripción</th><th>Marca</th><th>Uds</th><th>Estado</th></tr></thead>
<tbody>${skuRows}</tbody></table>`;

  if (State.shortages.length) {
    html += `<h2>⚠ Faltantes (quiebre de stock)</h2>
<table><thead><tr><th>SKU</th><th>Descripción</th><th>Marca</th><th>Uds faltantes</th><th>Motivo</th></tr></thead><tbody>`;
    State.shortages.forEach(s => {
      html += `<tr><td style="font-family:monospace">${escHtml(s.sku)}</td><td>${escHtml(s.desc||'')}</td><td>${escHtml(s.marca||'')}</td><td class="pn">${s.missingQty}</td><td>${escHtml(s.reason||'')}</td></tr>`;
    });
    html += '</tbody></table>';
  }

  if (err.length) {
    html += `<h2>⚠ Incidencias</h2>
<table><thead><tr><th>SKU</th><th>Descripción</th><th>EAN leído</th><th>EAN esperado</th></tr></thead><tbody>`;
    err.forEach(o => o.items.filter(i => i.status === 'error' || i.lastError).forEach(i => {
      const exp = State.catalog ? (State.catalog.get(i.sku)?.ean || '—') : '—';
      html += `<tr><td>${escHtml(i.sku)}</td><td>${escHtml(i.desc||'')}</td><td style="color:#dc2626">${escHtml(i.scannedEan||'—')}</td><td>${escHtml(exp)}</td></tr>`;
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
// Un ÚNICO AudioContext reutilizado. Antes se creaba uno por beep y nunca se
// cerraba: Chrome corta cerca de los 6 por pestaña, así que en un conteo en
// ráfaga los beeps se apagaban a la mitad — justo el feedback del que depende
// el operario para no mirar la pantalla.
let _actx = null;
function playBeep(type) {
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === 'suspended') _actx.resume();
    const freq = type === 'ok' ? 880 : type === 'warn' ? 440 : 220;
    const dur  = type === 'ok' ? .15 : type === 'warn' ? .22 : .4;
    const o = _actx.createOscillator(), g = _actx.createGain();
    o.connect(g); g.connect(_actx.destination);
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(.3, _actx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, _actx.currentTime + dur);
    o.start();
    o.stop(_actx.currentTime + dur);
  } catch (e) { console.warn('[beep]', e); }
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
initApp();
