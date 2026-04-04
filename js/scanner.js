/**
 * scanner.js
 * Compatible con Android 5+ usando html5-qrcode.
 */

const Scanner = (() => {

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
        fps: 10,
        qrbox: { width: 240, height: 100 },
        aspectRatio: 1.4,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
        ]
      };

      // Capturar el track de video para la linterna DESPUÉS del start
      // Lo hacemos con un pequeño delay para que el stream esté activo
      setTimeout(() => {
        const videos = document.querySelectorAll('video');
        for (const video of videos) {
          if (video.srcObject) {
            const tracks = video.srcObject.getVideoTracks();
            for (const track of tracks) {
              const caps = track.getCapabilities ? track.getCapabilities() : {};
              if (caps.torch) { _videoTrack = track; break; }
            }
          }
        }
        console.log('[Scanner] Track para linterna:', _videoTrack ? 'OK' : 'no disponible');
      }, 1500);

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
  let _videoTrack = null; // guardamos el track activo para la linterna

  async function toggleTorch() {
    try {
      // Si ya tenemos el track guardado, usarlo directamente
      if (_videoTrack) {
        _torchOn = !_torchOn;
        await _videoTrack.applyConstraints({ advanced: [{ torch: _torchOn }] });
        return;
      }
      // Buscar el track en todos los videos activos
      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        if (video.srcObject) {
          const tracks = video.srcObject.getVideoTracks();
          for (const track of tracks) {
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
      alert('Linterna no disponible en este dispositivo.');
    } catch(e) {
      console.warn('Linterna error:', e);
    }
  }

  return { start, stop, toggleTorch };
})();

/* Estilos extra para html5-qrcode — se inyectan en el head */
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #scanner-video, #scanner-video-free {
      width: 100% !important;
      border-radius: 12px;
      overflow: hidden;
    }
    #scanner-video > *, #scanner-video-free > * {
      border-radius: 12px !important;
    }
    #html5-qrcode-button-camera-permission {
      background: #1a56db !important;
      color: white !important;
      border: none !important;
      padding: 12px 24px !important;
      border-radius: 8px !important;
      font-size: 15px !important;
      cursor: pointer !important;
      margin: 16px auto !important;
      display: block !important;
    }
    #html5-qrcode-anchor-scan-type-change { display: none !important; }
  `;
  document.head.appendChild(style);
})();
