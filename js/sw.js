/* Service Worker v20260405 — fuerza recarga de todos los archivos */
const CACHE = 'vean-v20260405';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/catalog.js',
  './js/pdfParser.js',
  './js/scanner.js',
  './js/app.js',
  './manifest.json',
  './catalog_data.json',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
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
  if (e.request.url.includes('catalog_data.json') ||
      e.request.url.includes('docs.google.com')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
