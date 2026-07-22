/**
 * scanner.js
 * Compatible con Android 5+ usando html5-qrcode.
 */

const Scanner = window.Scanner = (() => {

  let activeScanner = null;

  // opts: { dedupeMs = 2000, allowRepeat = false, vibrate = true }
  // Defaults idénticos al comportamiento previo — pedidos y validador no cambian.
  async function start(videoId, onScan, onErr, opts) {
    await stop();
    const o = opts || {};
    const dedupeMs   = o.dedupeMs != null ? o.dedupeMs : 2000;
    const allowRepeat = !!o.allowRepeat;
    const doVibrate  = o.vibrate !== false;

    if (typeof Html5Qrcode === 'undefined') {
      onErr('Librería de escáner no disponible. Recargá la página.');
      return;
    }

    // El div debe estar vacío antes de iniciar
    const el = document.getElementById(videoId);
    if (el) el.innerHTML = '';

    try {
      const scanner = new Html5Qrcode(videoId, {
        verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      });
      activeScanner = scanner;

      const config = {
        fps: 15,                          // más frames = más chances de leer
        qrbox: { width: 200, height: 80 }, // área más chica = más zoom en esa zona
        aspectRatio: 1.5,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true  // usar API nativa del browser si está disponible
        },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
        ]
      };


      // Capturar el track con reintentos hasta que esté disponible.
      // El timer se guarda a nivel de módulo para poder cortarlo en stop(): antes
      // quedaba corriendo y, al abrir un SKU tras otro, los intervalos viejos
      // dejaban guardado un track YA MUERTO y la linterna dejaba de andar.
      if (_findTrackTimer) { clearInterval(_findTrackTimer); _findTrackTimer = null; }
      let _attempts = 0;
      _findTrackTimer = setInterval(() => {
        _attempts++;
        const t = _liveTrack();
        if (t) {
          _videoTrack = t;
          clearInterval(_findTrackTimer); _findTrackTimer = null;
          return;
        }
        if (_attempts >= 10) {
          console.log('[Scanner] No se encontró track de cámara tras', _attempts, 'intentos');
          clearInterval(_findTrackTimer); _findTrackTimer = null;
        }
      }, 500);

      await scanner.start(
        { facingMode: 'environment' },
        config,
        (() => {
          let _lastEan = null;
          let _lock = false;
          return (decodedText) => {
            // Anti-repetición: en modo ráfaga (allowRepeat) se permite releer el
            // mismo código, solo se respeta la ventana de dedupeMs.
            if (_lock) return;
            if (!allowRepeat && decodedText === _lastEan) return;
            _lock = true;
            _lastEan = decodedText;
            setTimeout(() => { _lock = false; if (!allowRepeat) _lastEan = null; }, dedupeMs);
            if (doVibrate && navigator.vibrate) navigator.vibrate(50);
            onScan(decodedText);
          };
        })(),
        () => {}  // error por frame — normal, ignorar
      );

    } catch (e) {
      const msg = e ? e.toString() : '';
      if (msg.includes('NotAllowedError') || msg.includes('Permission') || msg.includes('permiso')) {
        onErr('Permiso de cámara denegado. Tocá el candado 🔒 en la barra de direcciones → Permisos → Cámara → Permitir.');
      } else if (msg.includes('NotFoundError') || msg.includes('no camera')) {
        onErr('No se encontró cámara en este dispositivo.');
      } else {
        onErr('Error al iniciar la cámara: ' + msg);
      }
    }
  }

  async function stop() {
    // Capturar y anular ANTES de cualquier await: si en esa ventana arranca un
    // start() nuevo, el stop viejo apagaba el stream recién creado y la pantalla
    // quedaba en negro sin error en consola.
    const sc = activeScanner;
    const tr = _videoTrack;
    activeScanner = null;
    _videoTrack = null;
    _torchOn = false;

    if (_findTrackTimer) { clearInterval(_findTrackTimer); _findTrackTimer = null; }

    if (sc) {
      try {
        const state = sc.getState();
        if (state === 2 || state === 3) await sc.stop();
        sc.clear();
      } catch {}
    }
    if (tr) {
      try { await tr.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
      try { tr.stop(); } catch {}
    }
  }

  let _torchOn = false;
  let _videoTrack = null;
  let _findTrackTimer = null;

  /** Primer track de video VIVO del DOM (el que abrió html5-qrcode). */
  function _liveTrack() {
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      const ss = video.srcObject;
      if (!ss || !ss.getVideoTracks) continue;
      for (const t of ss.getVideoTracks()) {
        if (t.readyState === 'live') return t;
      }
    }
    return null;
  }

  // Devuelve true/false = nuevo estado de la linterna, null = no disponible
  async function toggleTorch() {
    // Descartar un track muerto de un escaneo anterior: usarlo hacía fallar el
    // applyConstraints y se terminaba pidiendo una SEGUNDA cámara mientras el
    // escáner ya tenía la suya. En Android eso da "cámara ocupada" y el botón
    // quedaba en "No disponible" aunque el equipo sí tenga linterna.
    if (_videoTrack && _videoTrack.readyState !== 'live') {
      _videoTrack = null;
      _torchOn = false;
    }
    const track = _videoTrack || _liveTrack();
    if (!track) return null;

    const next = !_torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
    } catch(e) {
      console.warn('Linterna error:', e);
      return null;
    }
    // Confirmar que el equipo realmente la soporta: si no aparece ni en
    // settings ni en capabilities, el applyConstraints se ignoró en silencio.
    const st   = track.getSettings     ? track.getSettings()     : {};
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (st.torch === undefined && !caps.torch) return null;

    _videoTrack = track;
    _torchOn = next;
    return next;
  }

  function isTorchOn() { return _torchOn; }

  return { start, stop, toggleTorch, isTorchOn };
})();

/* Estilos extra para html5-qrcode — se inyectan cuando el DOM está listo */
document.addEventListener('DOMContentLoaded', function() {
  const style = document.createElement('style');
  style.textContent = `
    #scanner-video > *, #scanner-video-validator > *, #scanner-video-stock > * { border-radius: 12px !important; }
    #html5-qrcode-button-camera-permission {
      background: #1a56db !important; color: white !important;
      border: none !important; padding: 12px 24px !important;
      border-radius: 8px !important; font-size: 15px !important;
      cursor: pointer !important; margin: 16px auto !important; display: block !important;
    }
    #html5-qrcode-anchor-scan-type-change { display: none !important; }
  `;
  document.head.appendChild(style);
});


// ═══════════════════════════════════════════════════════════
// Scanner2: escáner directo con getUserMedia + BarcodeDetector
// Usado en Consultar EAN para tener acceso al track de video
// ═══════════════════════════════════════════════════════════
const Scanner2 = window.Scanner2 = (() => {
  let _stream = null;
  let _track  = null;
  let _torchOn = false;
  let _interval = null;
  let _detector = null;
  let _video = null;

  // opts: { dedupeMs = 2500, allowRepeat = false, vibrate = true }
  async function start(videoId, onScan, onErr, opts) {
    await stop();
    const o = opts || {};
    const dedupeMs    = o.dedupeMs != null ? o.dedupeMs : 2500;
    const allowRepeat = !!o.allowRepeat;
    const doVibrate   = o.vibrate !== false;

    // BarcodeDetector API — disponible en Chrome Android 83+
    if (!('BarcodeDetector' in window)) {
      // Sin cámara pedida todavía: el llamador puede caer al fallback.
      onErr('Tu navegador no soporta el escáner nativo. Actualizá Chrome.', 'no_support');
      return;
    }

    _detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e']
    });

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      _track = _stream.getVideoTracks()[0];

      // Mostrar stream en el div contenedor
      const container = document.getElementById(videoId);
      if (container) {
        container.innerHTML = '';
        _video = document.createElement('video');
        _video.srcObject = _stream;
        _video.autoplay = true;
        _video.playsInline = true;
        _video.muted = true;
        _video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px';
        container.appendChild(_video);
        await _video.play();
      }

      // Watchdog: si Android le quita la cámara a la app (llamada entrante, otra
      // app toma el recurso), el track termina y el loop quedaba haciendo return
      // en silencio para siempre — cuadro negro y el operario escaneando al vacío.
      const _watchTrack = _track;
      if (_watchTrack) {
        _watchTrack.addEventListener('ended', () => {
          try { onErr('Se perdió la cámara. Tocá "Reintentar".', 'camera_lost'); } catch {}
        });
      }

      // Escanear cada 300ms
      let _lastEan = null;
      let _lock = false;
      _interval = setInterval(async () => {
        if (!_video || _lock) return;
        if (_watchTrack && _watchTrack.readyState === 'ended') return;
        if (_video.readyState < 2) return;
        try {
          const barcodes = await _detector.detect(_video);
          if (barcodes.length > 0) {
            const ean = barcodes[0].rawValue;
            if (!allowRepeat && ean === _lastEan) return;
            _lock = true;
            _lastEan = ean;
            setTimeout(() => { _lock = false; if (!allowRepeat) _lastEan = null; }, dedupeMs);
            if (doVibrate && navigator.vibrate) navigator.vibrate(50);
            onScan(ean);
          }
        } catch {}
      }, 300);

    } catch(e) {
      // Distinguir el motivo: si el permiso está denegado, reintentar con el
      // otro escáner falla igual — no tiene sentido caer al fallback.
      if (e.name === 'NotAllowedError') {
        onErr('Permiso de cámara denegado.', 'denied');
      } else {
        onErr('Error al iniciar cámara: ' + e.message, 'error');
      }
    }
  }

  async function stop() {
    // Capturar y anular ANTES de los await (misma race que en Scanner).
    const iv = _interval, tr = _track, st = _stream, vd = _video;
    _interval = null; _track = null; _stream = null; _video = null;
    _torchOn = false;

    if (iv) clearInterval(iv);
    if (tr) {
      try { await tr.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
    }
    if (st) { try { st.getTracks().forEach(t => t.stop()); } catch {} }
    if (vd) { try { vd.srcObject = null; } catch {} }
  }

  // Devuelve true/false = nuevo estado de la linterna, null = no disponible
  async function toggleTorch() {
    if (!_track) return null;
    const caps = _track.getCapabilities ? _track.getCapabilities() : {};
    if (!caps.torch) return null;
    _torchOn = !_torchOn;
    try {
      await _track.applyConstraints({ advanced: [{ torch: _torchOn }] });
      return _torchOn;
    } catch(e) {
      console.warn('Torch error:', e);
      return null;
    }
  }

  function isTorchOn() { return _torchOn; }

  return { start, stop, toggleTorch, isTorchOn };
})();
