/* v20260701C — Módulo de Control de Stock */
/**
 * stock.js — Conteo de stock por marca.
 *
 * IMPORTANTE: este archivo se carga DESPUÉS de app.js. `State` está declarado
 * con `const` en app.js (no es window.State), así que cualquier acceso desde el
 * top-level de un script anterior daría ReferenceError por TDZ.
 *
 * Flujo: elegir marca → contar (escaneando o a mano) → finalizar → reporte
 * guardado con fecha, editable después, exportable a Excel/PDF y compartible.
 *
 * Los conteos viven en IndexedDB (ver stockStore.js), NO en localStorage: el
 * catálogo ya presiona la cuota de localStorage y una escritura fallida ahí
 * puede dejar la app entera sin catálogo.
 */

const StockModule = (() => {

  /**
   * Marcas de LARIX (juguetería). Sale del mapeo PROVEEDOR → marca de
   * CLAUDE.md; el resto del catálogo se considera GRAMABI (ferretería).
   * Se deriva en código a propósito: el catalog_data.json no tiene campo de
   * empresa, así que agregar una marca acá es todo lo que hace falta.
   * Incluye 3 marcas que hoy no tienen SKUs cargados (First Rate, John & Mary,
   * Trucco) para que queden del lado correcto apenas aparezcan.
   */
  const MARCAS_LARIX = new Set([
    'Ruibal', 'Yani Toys', 'Andicar', 'Rivaplast', 'Lalelu', 'JYF Toys',
    'Magic Makers', 'Caffaro', 'Casita de Muñecas', 'Yoly Bell',
    'First Rate', 'John & Mary', 'Trucco', 'Xalingo',
  ]);

  // 'Otros' (sin marca detectada) cuenta como GRAMABI: las marcas LARIX vienen
  // de la columna PROVEEDOR del Excel, que siempre las identifica.
  function empresaDeMarca(marca) {
    return MARCAS_LARIX.has((marca || '').trim()) ? 'LARIX' : 'GRAMABI';
  }

  /**
   * Agrupa los items de un reporte por empresa → marca, con subtotales.
   * La marca sale del catálogo (o de lo que se cargó a mano) y la empresa se
   * deriva de la marca, así que el desglose es siempre el dato real: no hace
   * falta declarar nada antes de empezar a contar.
   */
  function agruparPorEmpresa(items) {
    const emp = {};
    (items || []).forEach(i => {
      const e = empresaDeMarca(i.marca);
      const m = (i.marca || 'Otros').trim() || 'Otros';
      emp[e] = emp[e] || { empresa: e, unidades: 0, productos: 0, marcas: {} };
      emp[e].marcas[m] = emp[e].marcas[m] || { marca: m, unidades: 0, items: [] };
      emp[e].marcas[m].unidades += (+i.cantidad || 0);
      emp[e].marcas[m].items.push(i);
      emp[e].unidades += (+i.cantidad || 0);
      emp[e].productos += 1;
    });
    // GRAMABI primero, y dentro las marcas por cantidad descendente
    return ['GRAMABI', 'LARIX'].filter(e => emp[e]).map(e => ({
      ...emp[e],
      marcas: Object.values(emp[e].marcas).sort((a, b) => b.unidades - a.unidades),
    }));
  }

  /** Texto corto tipo " · GRAMABI 12 · LARIX 3" para el historial. */
  function resumenEmpresas(items) {
    const g = agruparPorEmpresa(items);
    if (!g.length) return '';
    return ' · ' + g.map(e => `${e.empresa} ${e.unidades}`).join(' · ');
  }

  const S = {
    report: null,          // reporte en curso
    modo: 'sumar',         // 'sumar' = +1 por escaneo | 'cantidad' = escanear y tipear
    eanChoice: new Map(),  // EAN ambiguo → SKU elegido (dura lo que dura el conteo)
    scanning: false,
    verReporteId: null,    // reporte abierto en la pantalla de detalle
  };

  // ── HELPERS ────────────────────────────────────────────────
  function nuevoId() {
    return 'stk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function fechaCorta(iso) {
    try {
      return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return ''; }
  }

  function fechaLarga(iso) {
    try { return new Date(iso).toLocaleString('es-AR'); } catch { return ''; }
  }

  function totalUnidades(rep) {
    return (rep && rep.items || []).reduce((s, i) => s + (+i.cantidad || 0), 0);
  }

  // Guardado con debounce: serializar el reporte entero en cada beep del modo
  // ráfaga bloquearía el hilo principal de la tablet.
  let _saveTimer = null;
  let _savePend = null;   // reporte con cambios pendientes de guardar

  function guardarDebounced() {
    // Se recuerda A QUÉ reporte pertenecen los cambios: si el operario navega a
    // otro conteo dentro de los 400ms, antes se guardaba el reporte equivocado
    // y las últimas lecturas se perdían.
    _savePend = S.report;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { _saveTimer = null; guardarYa(); }, 400);
  }

  async function guardarYa() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    const rep = _savePend || S.report;
    _savePend = null;
    if (!rep) return;
    rep.updatedAt = new Date().toISOString();
    try {
      await StockStore.put(rep);
    } catch (e) {
      console.error('[Stock] No se pudo guardar:', e);
      showToast('⚠ No se pudo guardar el conteo', 'error', 5000);
    }
  }

  // Flush antes de que Android mate la pestaña
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && (_savePend || S.report)) guardarYa();
  });

  // ── MODALES ────────────────────────────────────────────────
  function cerrarModal() { document.getElementById('stock-modal')?.remove(); }

  function abrirModal(innerHtml) {
    cerrarModal();
    const d = document.createElement('div');
    d.id = 'stock-modal';
    d.className = 'modal-overlay';
    d.innerHTML = `<div class="modal-box">${innerHtml}</div>`;
    d.addEventListener('click', e => { if (e.target === d) cerrarModal(); });
    document.body.appendChild(d);
    return d;
  }

  // ── DESCARGA / COMPARTIR ───────────────────────────────────
  function descargarBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    // Quitar el <a> recién después: sacarlo en el mismo tick llegó a cancelar
    // la descarga en algunas versiones de Chrome Android.
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
  }

  async function compartirOBajar(blob, filename, mime) {
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: filename });
        return 'compartido';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelado';
      console.warn('[Stock] compartir falló, se descarga:', e);
    }
    descargarBlob(blob, filename);
    return 'descargado';
  }

  // ── PANTALLA: INICIO DEL MÓDULO (lista de conteos) ─────────
  async function abrirModulo() {
    showScreen('screen-stock-home');
    await renderListaReportes();
  }

  async function renderListaReportes() {
    const cont = document.getElementById('stock-reports-list');
    if (!cont) return;
    cont.innerHTML = '<div class="hint-text">Cargando…</div>';
    let reportes = [];
    try {
      reportes = await StockStore.all();
    } catch (e) {
      cont.innerHTML = `<div class="error-msg">No se pudo leer el historial: ${escHtml(e.message)}</div>`;
      return;
    }
    reportes.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    if (!reportes.length) {
      cont.innerHTML = '<div class="hint-text" style="text-align:center;padding:24px 0">Todavía no hay conteos.<br>Tocá “Nuevo conteo” para empezar.</div>';
      return;
    }

    cont.innerHTML = reportes.map(r => {
      const abierto = r.estado === 'abierto';
      const uds = totalUnidades(r);
      return `<div class="stock-report-row" onclick="StockModule.verReporte('${escHtml(r.id)}')">
        <div class="stock-report-info">
          <div class="stock-report-title">Conteo del ${fechaCorta(r.fecha)}</div>
          <div class="stock-report-sub">${(r.items || []).length} productos · ${uds} unidades${resumenEmpresas(r.items)}</div>
        </div>
        <span class="badge ${abierto ? 'badge-warn' : 'badge-ok'}">${abierto ? 'En curso' : 'Cerrado'}</span>
      </div>`;
    }).join('');
  }

  // ── INICIAR / RETOMAR CONTEO ───────────────────────────────
  async function iniciarConteo() {
    if (!State.catalog) {
      showToast('⚠ Sin catálogo cargado — solo vas a poder cargar productos a mano', 'warn', 4000);
    }
    await StockStore.requestPersist();
    S.eanChoice = new Map();
    S.report = {
      id: nuevoId(),
      fecha: new Date().toISOString(),
      operario: State.operario || '',
      estado: 'abierto',
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      closedAt: null,
    };
    try {
      await StockStore.put(S.report);
    } catch (e) {
      showToast('⚠ No se pudo crear el conteo: ' + e.message, 'error', 5000);
      return;
    }
    abrirPantallaConteo();
  }

  async function retomarConteo(id) {
    try {
      const rep = await StockStore.get(id);
      if (!rep) { showToast('No se encontró el conteo', 'error'); return; }
      rep.estado = 'abierto';
      S.report = rep;
      S.eanChoice = new Map();
      await guardarYa();
      abrirPantallaConteo();
    } catch (e) {
      showToast('Error al abrir el conteo: ' + e.message, 'error', 4000);
    }
  }

  function abrirPantallaConteo() {
    showScreen('screen-stock-scan');
    const t = document.getElementById('stock-scan-title');
    if (t) t.textContent = 'Conteo del ' + fechaCorta(S.report && S.report.fecha);
    setModo(S.modo);
    renderItems();
    arrancarScanner();
  }

  // ── ESCÁNER ────────────────────────────────────────────────
  function arrancarScanner() {
    const errBox = document.getElementById('stock-scanner-error');
    if (errBox) errBox.style.display = 'none';
    setTorchBtnState(document.getElementById('btn-torch-stock'), false);

    // En modo "sumar" hay que permitir releer el mismo código; en modo
    // "cantidad" se abre un diálogo, así que alcanza con el anti-repetición.
    const opts = S.modo === 'sumar'
      ? { dedupeMs: 1200, allowRepeat: true, vibrate: true }
      : { dedupeMs: 2000, allowRepeat: false, vibrate: true };

    Scanner2.start('scanner-video-stock', onScan, (msg, motivo) => {
      // Si el operario ya salió, no arrancar nada (evita cámara en pantalla oculta)
      if (!document.getElementById('screen-stock-scan').classList.contains('active')) return;
      if (motivo === 'denied') { mostrarErrorScanner(msg); return; }
      if (motivo === 'camera_lost') { mostrarErrorScanner(msg); return; }
      // Sin BarcodeDetector: caer a html5-qrcode
      Scanner.start('scanner-video-stock', onScan, m2 => mostrarErrorScanner(m2), opts);
    }, opts);
  }

  function mostrarErrorScanner(msg) {
    const box = document.getElementById('stock-scanner-error');
    if (!box) return;
    box.innerHTML = escHtml(msg) + ' <button class="btn-secondary" style="margin-top:8px" onclick="StockModule.reintentarScanner()">↺ Reintentar</button>';
    box.style.display = 'block';
  }

  function reintentarScanner() {
    const box = document.getElementById('stock-scanner-error');
    if (box) box.style.display = 'none';
    Scanner.stop(); Scanner2.stop();
    setTimeout(arrancarScanner, 150);
  }

  function setModo(modo) {
    S.modo = modo === 'cantidad' ? 'cantidad' : 'sumar';
    document.getElementById('btn-modo-sumar')?.classList.toggle('modo-on', S.modo === 'sumar');
    document.getElementById('btn-modo-cantidad')?.classList.toggle('modo-on', S.modo === 'cantidad');
    const hint = document.getElementById('stock-modo-hint');
    if (hint) {
      hint.textContent = S.modo === 'sumar'
        ? 'Cada lectura suma 1 unidad'
        : 'Escaneá y escribí la cantidad';
    }
    if (document.getElementById('screen-stock-scan')?.classList.contains('active')) {
      Scanner.stop(); Scanner2.stop();
      setTimeout(arrancarScanner, 150);
    }
  }

  function onScan(ean) {
    if (S.scanning || !S.report) return;
    S.scanning = true;
    setTimeout(() => { S.scanning = false; }, 300);

    const hits = CatalogService.findByEan(ean, State.catalog);

    if (!hits.length) { playBeep('warn'); pedirAltaProducto(ean); return; }

    if (hits.length === 1) { aplicarLectura(hits[0], ean); return; }

    // EAN compartido por varios SKUs (137 casos en el catálogo actual).
    const elegido = S.eanChoice.get(ean);
    if (elegido) {
      const h = hits.find(x => x.sku === elegido);
      if (h) { aplicarLectura(h, ean); return; }
    }
    playBeep('warn');
    pedirDesambiguacion(ean, hits);
  }

  function aplicarLectura(hit, eanLeido) {
    playBeep('ok');

    if (S.modo === 'cantidad') {
      pedirCantidad(hit, eanLeido);
      return;
    }
    sumarItem(hit, eanLeido, 1);
  }

  // ── ITEMS ──────────────────────────────────────────────────
  function buscarItem(sku, ean) {
    return (S.report.items || []).find(i =>
      (sku && i.sku === sku) || (!sku && !i.sku && i.ean === ean));
  }

  function sumarItem(hit, eanLeido, cant) {
    const n = +cant || 0;
    if (!n) return;
    let it = buscarItem(hit.sku, eanLeido);
    if (it) {
      it.cantidad = (+it.cantidad || 0) + n;
    } else {
      it = {
        id: nuevoId(),
        sku: hit.sku || '',
        ean: hit.ean || eanLeido || '',
        desc: hit.desc || '',
        marca: hit.marca || 'Otros',
        cantidad: n,
        nuevo: !!hit.nuevo,
      };
      S.report.items.unshift(it);
    }
    guardarDebounced();
    renderItems(it.id);
    mostrarUltimaLectura(it);
  }

  function mostrarUltimaLectura(it) {
    const box = document.getElementById('stock-last-read');
    if (!box) return;
    // Feedback persistente sobre la cámara: los toasts se pisan entre sí y en
    // ráfaga el operario no llega a leer ninguno.
    box.innerHTML = `
      <div class="stock-last-desc">${escHtml(it.desc || it.sku || it.ean)}</div>
      <div class="stock-last-row">
        <span class="stock-last-qty">${it.cantidad}</span>
        <button class="stock-undo-btn" onclick="StockModule.deshacer('${escHtml(it.id)}')">↺ Deshacer</button>
      </div>
      <div class="stock-last-meta">${escHtml(it.marca || 'Otros')} · ${escHtml(empresaDeMarca(it.marca))}</div>`;
    box.style.display = 'block';
  }

  function deshacer(itemId) {
    const it = (S.report.items || []).find(i => i.id === itemId);
    if (!it) return;
    it.cantidad = (+it.cantidad || 0) - 1;
    if (it.cantidad <= 0) {
      S.report.items = S.report.items.filter(i => i.id !== itemId);
      document.getElementById('stock-last-read').style.display = 'none';
    } else {
      mostrarUltimaLectura(it);
    }
    guardarDebounced();
    renderItems();
    playBeep('warn');
  }

  function renderItems(destacarId) {
    const cont = document.getElementById('stock-items-list');
    if (!cont || !S.report) return;
    const items = S.report.items || [];

    const resumen = document.getElementById('stock-resumen');
    if (resumen) {
      resumen.textContent = `${items.length} productos · ${totalUnidades(S.report)} unidades`;
    }

    if (!items.length) {
      cont.innerHTML = '<div class="hint-text" style="text-align:center;padding:16px 0">Escaneá el primer producto.</div>';
      return;
    }

    cont.innerHTML = items.map(i => `
      <div class="stock-item${i.id === destacarId ? ' stock-item-hit' : ''}" data-id="${escHtml(i.id)}">
        <div class="stock-item-info">
          <div class="stock-item-desc">${escHtml(i.desc || '(sin nombre)')}</div>
          <div class="stock-item-meta">${escHtml(i.sku || 'sin SKU')}${i.ean ? ' · ' + escHtml(i.ean) : ''}${i.nuevo ? ' · <span class="stock-tag-new">nuevo</span>' : ''}</div>
          <div class="stock-item-marca">${escHtml(i.marca || 'Otros')} · <span class="stock-emp-tag">${escHtml(empresaDeMarca(i.marca))}</span></div>
        </div>
        <div class="stock-item-qty">${i.cantidad}</div>
        <button class="stock-item-edit" onclick="StockModule.editarItem('${escHtml(i.id)}')">✎</button>
      </div>`).join('');
  }

  // ── DIÁLOGOS ───────────────────────────────────────────────
  function pedirCantidad(hit, eanLeido) {
    abrirModal(`
      <div class="modal-title">${escHtml(hit.desc || hit.sku || eanLeido)}</div>
      <div class="modal-sub">${escHtml(hit.sku || '')}${hit.sku && eanLeido ? ' · ' : ''}${escHtml(eanLeido || '')}</div>
      <label class="modal-label">Cantidad contada</label>
      <input type="number" inputmode="numeric" min="1" step="1" value="1" id="stock-qty-input" class="input-field">
      <button class="btn-primary mt-16" onclick="StockModule.confirmarCantidad()">Agregar</button>
      <button class="btn-secondary mt-8" onclick="StockModule.cerrarModal()">Cancelar</button>`);
    S._pendiente = { hit, eanLeido };
    const inp = document.getElementById('stock-qty-input');
    if (inp) { inp.focus(); inp.select(); }
  }

  function confirmarCantidad() {
    const inp = document.getElementById('stock-qty-input');
    const n = Math.max(1, parseInt(inp && inp.value, 10) || 1);
    const p = S._pendiente;
    cerrarModal();
    if (!p) return;
    S._pendiente = null;
    sumarItem(p.hit, p.eanLeido, n);
  }

  function pedirDesambiguacion(ean, hits) {
    const filas = hits.map((h, idx) => `
      <div class="stock-pick-row" onclick="StockModule.elegirSku(${idx})">
        <div class="stock-pick-sku">${escHtml(h.sku)}</div>
        <div class="stock-pick-desc">${escHtml(h.desc)}</div>
        <div class="stock-pick-marca">${escHtml(h.marca)}</div>
      </div>`).join('');
    abrirModal(`
      <div class="modal-title">¿Cuál de estos es?</div>
      <div class="modal-sub">El código ${escHtml(ean)} está en ${hits.length} productos del catálogo.</div>
      <div class="stock-pick-list">${filas}</div>
      <button class="btn-secondary mt-8" onclick="StockModule.cerrarModal()">Cancelar</button>`);
    S._ambiguo = { ean, hits };
  }

  function elegirSku(idx) {
    const a = S._ambiguo;
    cerrarModal();
    if (!a) return;
    const hit = a.hits[idx];
    S._ambiguo = null;
    if (!hit) return;
    // Recordar la elección para no volver a preguntar en este conteo
    S.eanChoice.set(a.ean, hit.sku);
    aplicarLectura(hit, a.ean);
  }

  function pedirAltaProducto(ean) {
    abrirModal(`
      <div class="modal-title">Producto no encontrado</div>
      <div class="modal-sub">El código ${escHtml(ean)} no está en el catálogo. Cargalo para sumarlo al conteo.</div>
      <label class="modal-label">Nombre del producto</label>
      <input type="text" id="stock-new-desc" class="input-field" placeholder="Ej: Amoladora 4.5″">
      <label class="modal-label">SKU (opcional)</label>
      <input type="text" id="stock-new-sku" class="input-field" placeholder="Ej: AMAL720">
      <label class="modal-label">Marca</label>
      <input type="text" id="stock-new-marca" class="input-field" placeholder="Ej: Ruibal (opcional)">
      <label class="modal-label">Cantidad</label>
      <input type="number" inputmode="numeric" min="1" step="1" value="1" id="stock-new-qty" class="input-field">
      <button class="btn-primary mt-16" onclick="StockModule.confirmarAlta()">Agregar al conteo</button>
      <button class="btn-secondary mt-8" onclick="StockModule.cerrarModal()">Descartar lectura</button>`);
    S._altaEan = ean;
    document.getElementById('stock-new-desc')?.focus();
  }

  function confirmarAlta() {
    const desc  = (document.getElementById('stock-new-desc')?.value || '').trim();
    const sku   = (document.getElementById('stock-new-sku')?.value || '').trim().toUpperCase();
    const marca = (document.getElementById('stock-new-marca')?.value || '').trim() || 'Otros';
    const qty   = Math.max(1, parseInt(document.getElementById('stock-new-qty')?.value, 10) || 1);
    const ean   = S._altaEan;
    if (!desc) { showToast('Poné al menos el nombre del producto', 'warn'); return; }
    cerrarModal();
    S._altaEan = null;
    sumarItem({ sku, ean, desc, marca, nuevo: true }, ean, qty);
    playBeep('ok');
  }

  function editarItem(itemId) {
    const it = (S.report.items || []).find(i => i.id === itemId);
    if (!it) return;
    abrirModal(`
      <div class="modal-title">Editar producto</div>
      <label class="modal-label">Nombre del producto</label>
      <input type="text" id="stock-ed-desc" class="input-field" value="${escHtml(it.desc || '')}">
      <label class="modal-label">SKU</label>
      <input type="text" id="stock-ed-sku" class="input-field" value="${escHtml(it.sku || '')}">
      <label class="modal-label">Cantidad</label>
      <input type="number" inputmode="numeric" min="0" step="1" id="stock-ed-qty" class="input-field" value="${+it.cantidad || 0}">
      <button class="btn-primary mt-16" onclick="StockModule.confirmarEdicion('${escHtml(itemId)}')">Guardar</button>
      <button class="btn-secondary mt-8" onclick="StockModule.cerrarModal()">Cancelar</button>
      <button class="btn-manual mt-8" style="background:var(--red-bg);color:var(--red);border-color:#fca5a5" onclick="StockModule.borrarItem('${escHtml(itemId)}')">Quitar del conteo</button>`);
  }

  function confirmarEdicion(itemId) {
    const it = (S.report.items || []).find(i => i.id === itemId);
    if (!it) { cerrarModal(); return; }
    const desc = (document.getElementById('stock-ed-desc')?.value || '').trim();
    const sku  = (document.getElementById('stock-ed-sku')?.value || '').trim().toUpperCase();
    const qty  = Math.max(0, parseInt(document.getElementById('stock-ed-qty')?.value, 10) || 0);
    it.desc = desc; it.sku = sku; it.cantidad = qty; it.editado = true;
    if (qty === 0) S.report.items = S.report.items.filter(i => i.id !== itemId);
    cerrarModal();
    guardarDebounced();
    renderItems();
  }

  function borrarItem(itemId) {
    S.report.items = (S.report.items || []).filter(i => i.id !== itemId);
    cerrarModal();
    guardarDebounced();
    renderItems();
    showToast('Producto quitado del conteo', 'warn');
  }

  // ── CERRAR CONTEO ──────────────────────────────────────────
  async function finalizarConteo() {
    if (!S.report) return;
    const uds = totalUnidades(S.report);
    if (!S.report.items.length) {
      showToast('El conteo está vacío', 'warn');
      return;
    }
    if (!confirm(`¿Finalizar el conteo?\n\n${S.report.items.length} productos · ${uds} unidades\n\nVas a poder reabrirlo y editarlo después.`)) return;
    S.report.estado = 'cerrado';
    S.report.closedAt = new Date().toISOString();
    S.report.operario = State.operario || S.report.operario || '';
    await guardarYa();
    Scanner.stop(); Scanner2.stop();
    S.verReporteId = S.report.id;
    showToast('✓ Conteo guardado', 'ok');
    verReporte(S.report.id);
  }

  // ── PANTALLA: DETALLE DE REPORTE ───────────────────────────
  async function verReporte(id) {
    let rep;
    try { rep = await StockStore.get(id); } catch (e) { showToast('Error: ' + e.message, 'error'); return; }
    if (!rep) { showToast('No se encontró el conteo', 'error'); return; }
    S.verReporteId = id;
    S.report = rep;
    showScreen('screen-stock-report');

    document.getElementById('stock-rep-marca').textContent = 'Conteo del ' + fechaCorta(rep.fecha);
    document.getElementById('stock-rep-meta').textContent =
      `${fechaLarga(rep.fecha)}${rep.operario ? ' · ' + rep.operario : ''}`;
    document.getElementById('stock-rep-totales').innerHTML =
      `${(rep.items || []).length} productos · ${totalUnidades(rep)} unidades` +
      `<div class="stock-rep-file">Archivo: ${escHtml(nombreArchivo(rep, 'xlsx').replace(/\.xlsx$/, ''))}</div>`;
    const badge = document.getElementById('stock-rep-estado');
    badge.textContent = rep.estado === 'abierto' ? 'En curso' : 'Cerrado';
    badge.className = 'badge ' + (rep.estado === 'abierto' ? 'badge-warn' : 'badge-ok');

    // Desglose por empresa → marca. Sale del dato de cada producto, no de un
    // filtro elegido de antemano.
    const cont = document.getElementById('stock-rep-items');
    const grupos = agruparPorEmpresa(rep.items);
    if (!grupos.length) {
      cont.innerHTML = '<div class="hint-text">Sin productos.</div>';
      return;
    }
    cont.innerHTML = grupos.map(emp => `
      <div class="stock-empresa-header">
        <span class="stock-empresa-name">${escHtml(emp.empresa)}</span>
        <span class="stock-empresa-sub">${emp.productos} productos · ${emp.unidades} unidades</span>
      </div>
      ${emp.marcas.map(m => `
        <div class="stock-marca-sub">
          <span>${escHtml(m.marca)}</span>
          <span class="stock-marca-sub-tot">${m.unidades} u.</span>
        </div>
        ${m.items.map(i => `
          <div class="stock-item">
            <div class="stock-item-info">
              <div class="stock-item-desc">${escHtml(i.desc || '(sin nombre)')}</div>
              <div class="stock-item-meta">${escHtml(i.sku || 'sin SKU')}${i.ean ? ' · ' + escHtml(i.ean) : ''}${i.nuevo ? ' · <span class="stock-tag-new">nuevo</span>' : ''}</div>
            </div>
            <div class="stock-item-qty">${i.cantidad}</div>
          </div>`).join('')}
      `).join('')}
    `).join('');
  }

  async function borrarReporte() {
    if (!S.verReporteId) return;
    if (!confirm('¿Borrar este conteo definitivamente?\n\nSi no lo exportaste, se pierde.')) return;
    try {
      await StockStore.del(S.verReporteId);
      S.verReporteId = null; S.report = null;
      showToast('Conteo borrado', 'warn');
      abrirModulo();
    } catch (e) { showToast('Error al borrar: ' + e.message, 'error'); }
  }

  // ── EXPORTAR ───────────────────────────────────────────────
  function filasExport(rep) {
    // Ordenadas por empresa → marca para que el Excel salga ya agrupado
    const ordenados = agruparPorEmpresa(rep.items)
      .flatMap(emp => emp.marcas.flatMap(m => m.items));
    return ordenados.map(i => ({
      Empresa: empresaDeMarca(i.marca),
      Marca: i.marca || 'Otros',
      SKU: i.sku || '',
      Producto: i.desc || '',
      EAN: i.ean || '',
      Cantidad: +i.cantidad || 0,
      Origen: i.nuevo ? 'Nuevo (fuera de catálogo)' : 'Catálogo',
    }));
  }

  /**
   * Nombre único por conteo: fecha + hora de creación.
   * Con solo la fecha, todos los conteos del mismo día generaban el MISMO
   * archivo: Android guardaba "(1)", "(2)"… y el operario terminaba abriendo
   * el conteo equivocado desde Descargas (o el navegador rechazaba la bajada).
   * Es determinístico: re-exportar el mismo conteo reemplaza su archivo en vez
   * de acumular copias.
   */
  /** Marca con más unidades contadas del reporte ('' si no hay productos). */
  function marcaDominante(rep) {
    const porMarca = {};
    (rep.items || []).forEach(i => {
      const m = (i.marca || 'Otros').trim() || 'Otros';
      porMarca[m] = (porMarca[m] || 0) + (+i.cantidad || 0);
    });
    let mejor = '', max = -1;
    Object.entries(porMarca).forEach(([m, u]) => { if (u > max) { max = u; mejor = m; } });
    return mejor;
  }

  /** Saca tildes/ñ y caracteres raros para que el nombre viaje bien por WhatsApp. */
  function limpiarNombre(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * "Control Stock - <marca dominante> - <fecha> <hora>.xlsx"
   * La hora va igual porque dos conteos de la misma marca el mismo día
   * generarían el mismo nombre, y ahí Android guarda "(1)" y el operario
   * termina abriendo el conteo equivocado desde Descargas.
   */
  function nombreArchivo(rep, ext) {
    const d = new Date(rep.fecha || Date.now());
    const p = n => String(n).padStart(2, '0');
    const fecha = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const hora  = `${p(d.getHours())}-${p(d.getMinutes())}`;
    const marca = limpiarNombre(marcaDominante(rep));
    return `Control Stock${marca ? ' - ' + marca : ''} - ${fecha} ${hora}.${ext}`;
  }

  // Chrome Android bloquea (o encola con un prompt) varias descargas seguidas:
  // un doble-tap en el botón hacía que la segunda no bajara nunca.
  let _exportando = false;
  function tomarTurnoExport() {
    if (_exportando) return false;
    _exportando = true;
    setTimeout(() => { _exportando = false; }, 1500);
    return true;
  }

  async function exportarExcel(compartir) {
    const rep = S.report;
    if (!rep) return;
    if (typeof XLSX === 'undefined') {
      showToast('⚠ Falta la librería de Excel. Conectate a internet y recargá la app.', 'error', 6000);
      return;
    }
    if (!tomarTurnoExport()) return;
    try {
      const filas = filasExport(rep);
      const ws = XLSX.utils.json_to_sheet(filas);
      ws['!cols'] = [{ wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 46 }, { wch: 16 }, { wch: 10 }, { wch: 24 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Conteo');
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const nombre = nombreArchivo(rep, 'xlsx');
      if (compartir) {
        const r = await compartirOBajar(blob, nombre, blob.type);
        if (r === 'descargado') showToast('Compartir no disponible — se descargó el archivo', 'warn', 4000);
      } else {
        descargarBlob(blob, nombre);
        // Se nombra el archivo: con varios conteos por día, el operario necesita
        // saber cuál buscar en Descargas.
        showToast('✓ Descargado: ' + nombre, 'ok', 5000);
      }
    } catch (e) {
      console.error('[Stock] Excel:', e);
      showToast('Error generando el Excel: ' + e.message, 'error', 5000);
    }
  }

  function htmlReporte(rep) {
    // Agrupado por empresa → marca, con subtotales
    const filas = agruparPorEmpresa(rep.items).map(emp => `
      <tr class="emp"><td colspan="4">${escHtml(emp.empresa)}</td>
        <td style="text-align:right">${emp.unidades} u.</td></tr>
      ${emp.marcas.map(m => `
        <tr class="mar"><td colspan="4">${escHtml(m.marca)}</td>
          <td style="text-align:right">${m.unidades} u.</td></tr>
        ${m.items.map(i => `<tr>
          <td>${escHtml(i.sku || '')}</td>
          <td>${escHtml(i.desc || '')}</td>
          <td>${escHtml(i.marca || '')}</td>
          <td style="font-family:monospace">${escHtml(i.ean || '')}</td>
          <td style="text-align:right;font-weight:600">${+i.cantidad || 0}</td>
        </tr>`).join('')}`).join('')}`).join('');
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<title>${escHtml(nombreArchivo(rep, 'pdf'))}</title>
<style>
body{font-family:Arial,sans-serif;font-size:13px;padding:24px;color:#111}
h1{color:#1a56db;margin:0 0 4px}
.meta{color:#6b7280;font-size:12px;margin-bottom:16px}
.tot{background:#f3f4f6;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-weight:600}
table{width:100%;border-collapse:collapse}
th{background:#1a56db;color:#fff;padding:7px 10px;font-size:12px;text-align:left}
td{padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px}
tr.emp td{background:#1a56db;color:#fff;font-weight:700;font-size:12px;letter-spacing:.5px}
tr.mar td{background:#e8eefc;font-weight:700;font-size:12px}
@media print{ body{padding:0} }
</style></head><body>
<h1>📦 Conteo de stock</h1>
<div class="meta">Fecha: ${escHtml(fechaLarga(rep.fecha))}${rep.operario ? ' · Operario: <strong>' + escHtml(rep.operario) + '</strong>' : ''}</div>
<div class="tot">${(rep.items || []).length} productos · ${totalUnidades(rep)} unidades contadas${escHtml(resumenEmpresas(rep.items))}</div>
<table><thead><tr><th>SKU</th><th>Producto</th><th>Marca</th><th>EAN</th><th style="text-align:right">Cant.</th></tr></thead>
<tbody>${filas}</tbody></table>
</body></html>`;
  }

  async function exportarPDF(compartir) {
    const rep = S.report;
    if (!rep) return;
    if (!tomarTurnoExport()) return;
    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;

    // Camino preferido: jsPDF genera un archivo real, compartible por WhatsApp.
    if (jsPDFCtor) {
      try {
        const doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
        doc.setFontSize(16); doc.setTextColor('#1a56db');
        doc.text('Conteo de stock', 40, 46);
        doc.setFontSize(10); doc.setTextColor('#444');
        doc.text(`Fecha: ${fechaLarga(rep.fecha)}${rep.operario ? '   Operario: ' + rep.operario : ''}`, 40, 64);
        doc.text(`${(rep.items || []).length} productos · ${totalUnidades(rep)} unidades${resumenEmpresas(rep.items)}`, 40, 78);

        // Filas agrupadas por empresa → marca, con subtotales
        const grupos = agruparPorEmpresa(rep.items);
        const body = [];
        const filasEmpresa = [], filasMarca = [];
        grupos.forEach(emp => {
          filasEmpresa.push(body.length);
          body.push([emp.empresa, '', '', '', `${emp.unidades} u.`]);
          emp.marcas.forEach(m => {
            filasMarca.push(body.length);
            body.push([m.marca, '', '', '', `${m.unidades} u.`]);
            m.items.forEach(i => body.push([
              i.sku || '', i.desc || '', i.marca || '', i.ean || '', String(+i.cantidad || 0),
            ]));
          });
        });

        if (doc.autoTable) {
          doc.autoTable({
            head: [['SKU', 'Producto', 'Marca', 'EAN', 'Cant.']],
            body,
            startY: 96,
            styles: { fontSize: 8, cellPadding: 3 },
            headStyles: { fillColor: [26, 86, 219] },
            columnStyles: { 4: { halign: 'right' } },
            didParseCell: d => {
              if (d.section !== 'body') return;
              if (filasEmpresa.includes(d.row.index)) {
                d.cell.styles.fillColor = [26, 86, 219];
                d.cell.styles.textColor = [255, 255, 255];
                d.cell.styles.fontStyle = 'bold';
              } else if (filasMarca.includes(d.row.index)) {
                d.cell.styles.fillColor = [232, 238, 252];
                d.cell.styles.fontStyle = 'bold';
              }
            },
          });
        } else {
          // Sin autotable: tabla simple paginada a mano
          let y = 112;
          doc.setFontSize(8);
          body.forEach(row => {
            if (y > 780) { doc.addPage(); y = 50; }
            doc.text(String(row[0]).slice(0, 18), 40, y);
            doc.text(String(row[1]).slice(0, 55), 130, y);
            doc.text(String(row[4]), 540, y, { align: 'right' });
            y += 13;
          });
        }
        const blob = doc.output('blob');
        const nombre = nombreArchivo(rep, 'pdf');
        if (compartir) {
          const r = await compartirOBajar(blob, nombre, 'application/pdf');
          if (r === 'descargado') showToast('Compartir no disponible — se descargó el archivo', 'warn', 4000);
        } else {
          descargarBlob(blob, nombre);
          showToast('✓ Descargado: ' + nombre, 'ok', 5000);
        }
        return;
      } catch (e) {
        console.error('[Stock] jsPDF falló, se usa impresión:', e);
      }
    }

    // Fallback sin dependencias: imprimir → "Guardar como PDF" de Android.
    try {
      const w = window.open('', '_blank');
      if (!w) { showToast('Permití las ventanas emergentes para generar el PDF', 'warn', 5000); return; }
      w.document.write(htmlReporte(rep));
      w.document.close();
      w.focus();
      setTimeout(() => { try { w.print(); } catch {} }, 400);
      showToast('Elegí “Guardar como PDF” en el diálogo de impresión', 'ok', 5000);
    } catch (e) {
      showToast('No se pudo generar el PDF: ' + e.message, 'error', 5000);
    }
  }

  // ── CABLEADO ───────────────────────────────────────────────
  function init() {
    document.getElementById('btn-mode-stock')?.addEventListener('click', abrirModulo);
    document.getElementById('btn-stock-nuevo')?.addEventListener('click', iniciarConteo);
    document.getElementById('btn-modo-sumar')?.addEventListener('click', () => setModo('sumar'));
    document.getElementById('btn-modo-cantidad')?.addEventListener('click', () => setModo('cantidad'));
    document.getElementById('btn-stock-finalizar')?.addEventListener('click', finalizarConteo);
    document.getElementById('btn-stock-manual')?.addEventListener('click', () => pedirAltaProducto(''));
    document.getElementById('btn-torch-stock')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-torch-stock');
      let st = await Scanner2.toggleTorch();
      if (st === null) st = await Scanner.toggleTorch();
      setTorchBtnState(btn, st);
      if (st === null && typeof mostrarDiagLinterna === 'function') mostrarDiagLinterna('stock-scanner-error');
    });
    document.getElementById('btn-stock-xls')?.addEventListener('click', () => exportarExcel(false));
    document.getElementById('btn-stock-pdf')?.addEventListener('click', () => exportarPDF(false));
    document.getElementById('btn-stock-share-xls')?.addEventListener('click', () => exportarExcel(true));
    document.getElementById('btn-stock-share-pdf')?.addEventListener('click', () => exportarPDF(true));
    document.getElementById('btn-stock-reabrir')?.addEventListener('click', () => {
      if (S.verReporteId) retomarConteo(S.verReporteId);
    });
    document.getElementById('btn-stock-borrar')?.addEventListener('click', borrarReporte);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    abrirModulo, iniciarConteo, retomarConteo, verReporte,
    deshacer, editarItem, confirmarEdicion, borrarItem,
    confirmarCantidad, confirmarAlta, elegirSku, cerrarModal,
    reintentarScanner, renderListaReportes,
    // Procesa un código como si viniera del lector (carga manual / pruebas)
    procesarCodigo: onScan,
    // Solo lectura, para inspeccionar el conteo en curso
    get reporteActual() { return S.report; },
  };
})();

window.StockModule = StockModule;
