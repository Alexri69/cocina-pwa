// ============================================================
// trabajador.js — Service Worker (cache-first, offline total)
// v27: network-first para HTML, auto-reload al actualizar SW
// ============================================================

const NOMBRE_CACHE = 'cocina-etiquetas-v27';

const ARCHIVOS_A_CACHEAR = [
  './index.html',
  './estilo.css',
  './manifest.json',
  './core/bd.js?v=26',
  './core/voz.js?v=26',
  './core/supabase.js?v=26',
  './modulos/etiquetas.js?v=26',
  './modulos/menu.js?v=26',
  './modulos/bebidas.js?v=26',
  './modulos/facturas.js?v=26',
  './modulos/auth.js?v=26',
  './modulos/config.js?v=26',
  './app.js?v=26',
  './iconos/icono-192.png',
  './iconos/icono-512.png'
];

// ---- INSTALL: pre-cachear todos los recursos ----
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(NOMBRE_CACHE).then(cache =>
      cache.addAll(ARCHIVOS_A_CACHEAR).catch(() =>
        cache.addAll(ARCHIVOS_A_CACHEAR.filter(f => !f.includes('iconos')))
      )
    )
  );
});

// ---- ACTIVATE: limpiar cachés antiguas y avisar a los clientes para recargar ----
self.addEventListener('activate', (e) => {
  self.clients.claim();
  e.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(nombres.filter(n => n !== NOMBRE_CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => clients.forEach(c => c.postMessage({ tipo: 'SW_ACTUALIZADO' })))
  );
});

// ---- FETCH: network-first para HTML, cache-first para el resto ----
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  const url = e.request.url;
  const esHTML = e.request.headers.get('Accept')?.includes('text/html')
    || url.endsWith('.html')
    || url === self.location.origin + '/'
    || url === self.location.origin;

  if (esHTML) {
    // Network-first para HTML: siempre la versión más reciente del servidor
    e.respondWith(
      fetch(e.request).then(res => {
        if (res?.status === 200) {
          const copia = res.clone();
          caches.open(NOMBRE_CACHE).then(c => c.put(e.request, copia));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first con stale-while-revalidate para JS/CSS/imágenes
  e.respondWith(
    caches.match(e.request).then(cached => {
      const red = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copia = res.clone();
          caches.open(NOMBRE_CACHE).then(c => c.put(e.request, copia));
        }
        return res;
      }).catch(() => null);
      return cached || red;
    })
  );
});
