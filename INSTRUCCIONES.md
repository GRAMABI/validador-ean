<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <meta name="theme-color" content="#1a56db"/>
  <meta name="mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
  <meta name="apple-mobile-web-app-title" content="Validador EAN"/>
  <title>Validador EAN</title>
  <link rel="manifest" href="manifest.json"/>
  <link rel="stylesheet" href="css/app.css"/>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════ PANTALLA LOGIN -->
<div id="screen-login" class="screen active">
  <div class="login-wrap">
    <div class="login-icon">📦</div>
    <h1 class="login-title">Validador EAN</h1>
    <p class="login-sub">Preparación de pedidos</p>
    <div class="login-card">
      <p class="login-desc">Para comenzar, cargá el PDF de pedidos del día y sincronizá el catálogo de productos.</p>
      <button class="btn-primary" id="btn-start">Comenzar</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════ PANTALLA CONFIG -->
<div id="screen-config" class="screen">
  <div class="topbar">
    <span class="topbar-title">Configuración inicial</span>
  </div>
  <div class="content">

    <div class="section-label">1. Catálogo SKU → EAN</div>
    <div class="card" id="card-catalog">
      <div class="card-row">
        <span class="card-label">Estado</span>
        <span id="catalog-status" class="badge badge-warn">Sin sincronizar</span>
      </div>
      <div class="card-row" id="catalog-count-row" style="display:none">
        <span class="card-label">SKUs cargados</span>
        <span id="catalog-count" class="card-value">—</span>
      </div>
      <div class="card-row" id="catalog-sync-row" style="display:none">
        <span class="card-label">Última sync</span>
        <span id="catalog-sync-time" class="card-value">—</span>
      </div>
      <button class="btn-secondary mt-8" id="btn-sync">⬇ Sincronizar catálogo</button>
      <div id="sync-error" class="error-msg" style="display:none"></div>
    </div>

    <div class="section-label mt-16">2. PDF de pedidos</div>
    <div class="card">
      <div id="pdf-status-row" class="card-row" style="display:none">
        <span class="card-label">Archivo</span>
        <span id="pdf-name" class="card-value text-truncate">—</span>
      </div>
      <div id="pdf-orders-row" class="card-row" style="display:none">
        <span class="card-label">Pedidos encontrados</span>
        <span id="pdf-orders-count" class="card-value">—</span>
      </div>
      <label class="btn-secondary mt-8" style="text-align:center;cursor:pointer">
        📄 Cargar PDF de pedidos
        <input type="file" id="input-pdf" accept="application/pdf" style="display:none"/>
      </label>
      <div id="pdf-error" class="error-msg" style="display:none"></div>
    </div>

    <button class="btn-primary mt-24" id="btn-go-orders" disabled>Ver pedidos →</button>
  </div>
</div>

<!-- ═════════════════════════════════════════════════════════ PANTALLA PEDIDOS -->
<div id="screen-orders" class="screen">
  <div class="topbar">
    <button class="topbar-back" id="back-to-config">←</button>
    <span class="topbar-title">Pedidos del día</span>
    <button class="topbar-action" id="btn-go-summary">📊</button>
  </div>
  <div class="progress-bar-wrap">
    <div class="progress-bar-fill" id="progress-fill"></div>
  </div>
  <div class="progress-label" id="progress-label">0 de 0 pedidos validados</div>
  <div class="content no-top-pad" id="orders-list"></div>
  <div class="bottom-nav">
    <div class="nav-item active" onclick="showScreen('screen-orders')">
      <span>📦</span><span>Pedidos</span>
    </div>
    <div class="nav-item" onclick="showScreen('screen-scanner-free')">
      <span>⬛</span><span>Escanear</span>
    </div>
    <div class="nav-item" onclick="showScreen('screen-summary')">
      <span>📊</span><span>Resumen</span>
    </div>
    <div class="nav-item" onclick="showScreen('screen-config')">
      <span>⚙️</span><span>Config</span>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════ PANTALLA DETALLE -->
<div id="screen-detail" class="screen">
  <div class="topbar">
    <button class="topbar-back" id="back-to-orders">←</button>
    <span class="topbar-title" id="detail-buyer-name">Pedido</span>
    <span class="badge" id="detail-status-badge">Pendiente</span>
  </div>
  <div class="order-id-bar" id="detail-order-id"></div>
  <div class="content no-top-pad">
    <div id="detail-skus"></div>
    <div class="scanner-wrap" id="scanner-wrap">
      <video id="scanner-video" autoplay playsinline muted></video>
      <div class="scanner-overlay-frame">
        <div class="scanner-line"></div>
      </div>
      <div class="scanner-hint">Apuntá al código de barras</div>
    </div>
    <div id="scanner-error" class="error-msg" style="display:none"></div>
    <div class="scanner-controls">
      <button class="btn-secondary" id="btn-torch" style="display:none">🔦 Linterna</button>
    </div>
  </div>
  <div class="bottom-action">
    <button class="btn-primary" id="btn-confirm-order" disabled>Confirmar pedido</button>
  </div>
  <div id="toast-container"></div>
</div>

<!-- ══════════════════════════════════════════════════════ PANTALLA ESCANEO LIBRE -->
<div id="screen-scanner-free" class="screen">
  <div class="topbar">
    <span class="topbar-title">Escaneo rápido</span>
  </div>
  <div class="content">
    <p class="hint-text">Escaneá cualquier EAN para ver a qué SKU pertenece.</p>
    <div class="scanner-wrap">
      <video id="scanner-video-free" autoplay playsinline muted></video>
      <div class="scanner-overlay-frame">
        <div class="scanner-line"></div>
      </div>
      <div class="scanner-hint">Apuntá al código de barras</div>
    </div>
    <div id="free-result" class="card mt-16" style="display:none">
      <div class="card-row"><span class="card-label">EAN</span><span id="free-ean" class="card-value mono">—</span></div>
      <div class="card-row"><span class="card-label">SKU</span><span id="free-sku" class="card-value">—</span></div>
      <div class="card-row"><span class="card-label">Pedido</span><span id="free-order" class="card-value">—</span></div>
    </div>
  </div>
  <div class="bottom-nav">
    <div class="nav-item" onclick="showScreen('screen-orders')"><span>📦</span><span>Pedidos</span></div>
    <div class="nav-item active"><span>⬛</span><span>Escanear</span></div>
    <div class="nav-item" onclick="showScreen('screen-summary')"><span>📊</span><span>Resumen</span></div>
    <div class="nav-item" onclick="showScreen('screen-config')"><span>⚙️</span><span>Config</span></div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════ PANTALLA RESUMEN -->
<div id="screen-summary" class="screen">
  <div class="topbar">
    <button class="topbar-back" onclick="showScreen('screen-orders')">←</button>
    <span class="topbar-title">Resumen del día</span>
  </div>
  <div class="content">
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-val green" id="sum-ok">0</div>
        <div class="metric-label">Validados</div>
      </div>
      <div class="metric-card">
        <div class="metric-val amber" id="sum-pending">0</div>
        <div class="metric-label">Pendientes</div>
      </div>
      <div class="metric-card">
        <div class="metric-val red" id="sum-error">0</div>
        <div class="metric-label">Con error</div>
      </div>
    </div>
    <div id="summary-list"></div>
    <button class="btn-primary mt-16" id="btn-export">📄 Exportar reporte</button>
  </div>
  <div class="bottom-nav">
    <div class="nav-item" onclick="showScreen('screen-orders')"><span>📦</span><span>Pedidos</span></div>
    <div class="nav-item" onclick="showScreen('screen-scanner-free')"><span>⬛</span><span>Escanear</span></div>
    <div class="nav-item active"><span>📊</span><span>Resumen</span></div>
    <div class="nav-item" onclick="showScreen('screen-config')"><span>⚙️</span><span>Config</span></div>
  </div>
</div>

<!-- ══════════════════════════ LOADER OVERLAY -->
<div id="loader" style="display:none">
  <div class="loader-box">
    <div class="spinner"></div>
    <div id="loader-msg" class="loader-msg">Cargando...</div>
  </div>
</div>

<!-- ══════════════════════════ LIBRARIES -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/zxing-js/0.20.0/index.min.js"></script>
<script src="js/catalog.js"></script>
<script src="js/pdfParser.js"></script>
<script src="js/scanner.js"></script>
<script src="js/app.js"></script>
</body>
</html>
