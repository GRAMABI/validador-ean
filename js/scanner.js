/**
 * scanner.js
 * Compatible con Android 5+ usando html5-qrcode.
 */

const Scanner = window.Scanner = (() => {

  let activeScanner = null;

  async function start(videoId, onScan, onErr) {
    await stop();

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


      // Capturar el track con reintentos hasta que esté disponible
      let _attempts = 0;
      const _findTrack = setInterval(() => {
        _attempts++;
        const videos = document.querySelectorAll('video');
        for (const video of videos) {
          if (video.srcObject) {
            const tracks = video.srcObject.getVideoTracks();
            for (const track of tracks) {
              const caps = track.getCapabilities ? track.getCapabilities() : {};
              if (caps.torch) {
                _videoTrack = track;
                console.log('[Scanner] Track con linterna encontrado en intento', _attempts);
                clearInterval(_findTrack);
                return;
              }
            }
          }
        }
        if (_attempts >= 10) {
          console.log('[Scanner] No se encontró track con linterna después de', _attempts, 'intentos');
          clearInterval(_findTrack);
        }
      }, 500);

      await scanner.start(
        { facingMode: 'environment' },
        config,
        (() => {
          let _lastEan = null;
          let _lock = false;
          return (decodedText) => {
            // Anti-repetición a nivel de escáner: mismo EAN o lock activo = ignorar
            if (_lock || decodedText === _lastEan) return;
            _lock = true;
            _lastEan = decodedText;
            setTimeout(() => { _lock = false; _lastEan = null; }, 2000);
            if (navigator.vibrate) navigator.vibrate(50);
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
    if (activeScanner) {
      try {
        const state = activeScanner.getState();
        if (state === 2 || state === 3) {
          await activeScanner.stop();
        }
        activeScanner.clear();
      } catch {}
      activeScanner = null;
    }
    // Apagar linterna y limpiar track
    if (_videoTrack) {
      try { await _videoTrack.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
      _videoTrack = null;
    }
    _torchOn = false;
  }

  let _torchOn = false;
  let _videoTrack = null;

  async function toggleTorch() {
    try {
      // 1. Usar track guardado
      if (_videoTrack) {
        _torchOn = !_torchOn;
        await _videoTrack.applyConstraints({ advanced: [{ torch: _torchOn }] });
        return;
      }

      // 2. Buscar en videos del DOM
      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        if (video.srcObject) {
          for (const track of video.srcObject.getVideoTracks()) {
            const caps = track.getCapabilities ? track.getCapabilities() : {};
            if (caps.torch) {
              _videoTrack = track;
              _torchOn = !_torchOn;
              await track.applyConstraints({ advanced: [{ torch: _torchOn }] });
              return;
            }
          }
        }
      }

      // 3. Último recurso: pedir stream propio con torch activado
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', advanced: [{ torch: true }] }
      });
      const track = stream.getVideoTracks()[0];
      if (track) {
        _videoTrack = track;
        _torchOn = true;
      }
    } catch(e) {
      console.warn('Linterna error:', e);
      // Intentar con constraint directo
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }
        });
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) {
          _videoTrack = track;
          _torchOn = !_torchOn;
          await track.applyConstraints({ advanced: [{ torch: _torchOn }] });
        } else {
          alert('La linterna no está disponible en este dispositivo o navegador.');
        }
      } catch(e2) {
        console.warn('Linterna fallback error:', e2);
      }
    }
  }

  return { start, stop, toggleTorch };
})();

/* Estilos extra para html5-qrcode — se inyectan cuando el DOM está listo */
document.addEventListener('DOMContentLoaded', function() {
  const style = document.createElement('style');
  style.textContent = `
    #scanner-video > *, #scanner-video-free > * { border-radius: 12px !important; }
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

  async function start(videoId, onScan, onErr) {
    await stop();

    // BarcodeDetector API — disponible en Chrome Android 83+
    if (!('BarcodeDetector' in window)) {
      onErr('Tu navegador no soporta el escáner nativo. Actualizá Chrome.');
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

      // Escanear cada 300ms
      let _lastEan = null;
      let _lock = false;
      _interval = setInterval(async () => {
        if (!_video || _video.readyState < 2 || _lock) return;
        try {
          const barcodes = await _detector.detect(_video);
          if (barcodes.length > 0) {
            const ean = barcodes[0].rawValue;
            if (ean === _lastEan) return;
            _lock = true;
            _lastEan = ean;
            setTimeout(() => { _lock = false; _lastEan = null; }, 2500);
            if (navigator.vibrate) navigator.vibrate(50);
            onScan(ean);
          }
        } catch {}
      }, 300);

    } catch(e) {
      if (e.name === 'NotAllowedError') {
        onErr('Permiso de cámara denegado.');
      } else {
        onErr('Error al iniciar cámara: ' + e.message);
      }
    }
  }

  async function stop() {
    if (_interval) { clearInterval(_interval); _interval = null; }
    if (_track) {
      try { await _track.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
      _track = null;
    }
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    if (_video) { _video.srcObject = null; _video = null; }
    _torchOn = false;
  }

  async function toggleTorch() {
    if (!_track) { alert('Esperá que la cámara encienda antes de usar la linterna.'); return; }
    const caps = _track.getCapabilities ? _track.getCapabilities() : {};
    if (!caps.torch) { alert('Linterna no disponible en este dispositivo.'); return; }
    _torchOn = !_torchOn;
    try {
      await _track.applyConstraints({ advanced: [{ torch: _torchOn }] });
    } catch(e) {
      console.warn('Torch error:', e);
    }
  }

  return { start, stop, toggleTorch };
})();
