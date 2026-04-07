/* Service Worker - siempre red para archivos propios */
const CACHE = 'vean-static-v1';
const STATIC = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
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

  // Archivos propios de GitHub → SIEMPRE de la red, nunca del caché
  if (url.includes('gramabi.github.io')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Google Sheets → siempre de la red
  if (url.includes('docs.google.com')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  // Librerías externas → caché (no cambian)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
