/* Service Worker v2 — precachea app-shell + catálogo para que la PWA abra offline */
const CACHE = 'vean-static-v2';

// Archivos propios: sin esto cacheado, abrir la app sin señal da pantalla en blanco
const OWN_FILES = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/catalog.js',
  './js/pdfParser.js',
  './js/scanner.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './catalog_data.json',
];

// Librerías externas (ambas versiones de pdf.js: primaria unpkg + fallback cdnjs)
const CDN_FILES = [
  'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.min.js',
  'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      // Se precachea por separado: si un CDN falla (mala señal en el depósito),
      // el app-shell igual queda cacheado — antes un solo fallo dejaba TODO sin cachear.
      await c.addAll(OWN_FILES).catch(err => console.warn('[SW] No se pudo precachear el app-shell:', err));
      await c.addAll(CDN_FILES).catch(err => console.warn('[SW] No se pudieron precachear las libs CDN:', err));
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Archivos propios de GitHub → red primero (frescura), y se re-cachea cada
  // respuesta OK. Si no hay señal, cae al caché real en vez de fallar en blanco.
  if (url.includes('gramabi.github.io')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(resp => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Google Sheets → siempre de la red
  if (url.includes('docs.google.com')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  // Librerías externas → caché primero (no cambian de versión)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
