/**
 * scanner.js
 * Escáner de códigos de barra usando la cámara del dispositivo (ZXing).
 * Soporta EAN-13, EAN-8, Code128, Code39, QR.
 */

const Scanner = (() => {

  let activeReader   = null;
  let activeVideoEl  = null;
  let activeStream   = null;
  let torchEnabled   = false;

  /**
   * Inicia el escáner en el elemento <video> indicado.
   * @param {string} videoId  - ID del elemento <video>
   * @param {function} onScan - callback(ean: string)
   * @param {function} onErr  - callback(error: string)
   */
  async function start(videoId, onScan, onErr) {
    await stop(); // detener cualquier escáner previo

    const video = document.getElementById(videoId);
    if (!video) { onErr('Elemento de video no encontrado'); return; }
    activeVideoEl = video;

    try {
      // Preferir cámara trasera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      activeStream = stream;
      video.srcObject = stream;
      await video.play();

      // Activar linterna si está disponible
      const track = stream.getVideoTracks()[0];
      const caps  = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) {
        document.getElementById('btn-torch') && (document.getElementById('btn-torch').style.display = 'block');
      }

      // Iniciar ZXing
      const hints = new Map();
      const formats = [
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.UPC_A,
      ];
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

      const reader = new ZXing.BrowserMultiFormatReader(hints);
      activeReader = reader;

      reader.decodeFromVideoElement(video, (result, err) => {
        if (result) {
          const ean = result.getText();
          vibrate(50);
          onScan(ean);
        }
        // err es normal cuando no hay barcode en el frame, ignorar
      });

    } catch (e) {
      if (e.name === 'NotAllowedError') {
        onErr('Permiso de cámara denegado. Habilitalo en la configuración del navegador.');
      } else if (e.name === 'NotFoundError') {
        onErr('No se encontró cámara en este dispositivo.');
      } else {
        onErr('Error al iniciar la cámara: ' + e.message);
      }
    }
  }

  async function stop() {
    if (activeReader) {
      try { activeReader.reset(); } catch {}
      activeReader = null;
    }
    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      activeStream = null;
    }
    if (activeVideoEl) {
      activeVideoEl.srcObject = null;
      activeVideoEl = null;
    }
    torchEnabled = false;
  }

  async function toggleTorch() {
    if (!activeStream) return;
    const track = activeStream.getVideoTracks()[0];
    if (!track) return;
    try {
      torchEnabled = !torchEnabled;
      await track.applyConstraints({ advanced: [{ torch: torchEnabled }] });
    } catch (e) { console.warn('Linterna no disponible:', e); }
  }

  function vibrate(ms = 50) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  return { start, stop, toggleTorch };
})();
