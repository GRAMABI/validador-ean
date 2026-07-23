/* Service Worker v4 — precachea app-shell + catálogo para que la PWA abra offline */
const CACHE = 'vean-static-v4';

// Archivos propios: sin esto cacheado, abrir la app sin señal da pantalla en blanco
const OWN_FILES = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/catalog.js',
  './js/pdfParser.js',
  './js/scanner.js',
  './js/stockStore.js',
  './js/stock.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
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
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

// Archivo por archivo (allSettled) en vez de addAll: addAll es ATÓMICO, así que
// una sola URL caída dejaba TODO el lote sin cachear. Con mala señal en el
// depósito eso significaba quedarse sin pdf.js ni el escáner.
function precache(cache, urls) {
  return Promise.allSettled(urls.map(u => cache.add(u).catch(err => {
    console.warn('[SW] no se pudo precachear', u, err);
    throw err;
  })));
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await precache(c, OWN_FILES);
      await precache(c, CDN_FILES);
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Solo purgar las cachés viejas si la nueva quedó realmente usable. Antes se
    // borraban siempre: si el precache fallaba por señal mala, la tablet quedaba
    // con MENOS caché offline que antes del deploy (pantalla en blanco).
    let nuevaOk = false;
    try {
      const c = await caches.open(CACHE);
      nuevaOk = !!(await c.match('./index.html')) && !!(await c.match('./js/app.js'));
    } catch {}

    if (nuevaOk) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    } else {
      console.warn('[SW] precache incompleto: se conserva la caché anterior');
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  let url;
  try { url = new URL(e.request.url); } catch { return; }

  // Archivos propios → red primero (frescura), re-cacheando cada respuesta OK.
  // Comparar contra el propio origen (antes era el hostname hardcodeado de
  // GitHub Pages, así que en local todo caía en la rama cache-first y las
  // ediciones no se veían).
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(resp => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return resp;
        })
        // ignoreSearch: catalog.js pide el catálogo con ?t=<timestamp>, que nunca
        // matcheaba contra la entrada precacheada sin query.
        .catch(async () => {
          const hit = await caches.match(e.request, { ignoreSearch: true });
          if (hit) return hit;
          if (e.request.mode === 'navigate') {
            const shell = await caches.match('./index.html');
            if (shell) return shell;
          }
          return new Response('Sin conexión y sin copia en caché', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
    );
    return;
  }

  // Google Sheets → siempre de la red
  if (url.hostname === 'docs.google.com') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  // Librerías externas → caché primero, y si hay que ir a la red se guarda la
  // copia. Antes nunca se hacía put: si el precache del install fallaba, esas
  // libs quedaban permanentemente no disponibles offline.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && (resp.ok || resp.type === 'opaque')) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => new Response('', { status: 503 }));
    })
  );
});
