// ============================================================
// trabajador.js — Service Worker (cache-first, offline total)
// v37: vuelve a stale-while-revalidate para evitar cuelgues
// ============================================================

const NOMBRE_CACHE = 'cocina-etiquetas-v44';

const ARCHIVOS_A_CACHEAR = [
  './index.html',
  './estilo.css',
  './manifest.json',
  './core/voz.js?v=44',
  './core/supabase.js?v=44',
  './modulos/etiquetas.js?v=44',
  './modulos/menu.js?v=44',
  './modulos/bebidas.js?v=44',
  './modulos/facturas.js?v=44',
  './modulos/auth.js?v=44',
  './modulos/config.js?v=44',
  './app.js?v=44',
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

// ---- ACTIVATE: limpiar cachés antiguas y avisar a los clientes ----
self.addEventListener('activate', (e) => {
  self.clients.claim();
  e.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(nombres.filter(n => n !== NOMBRE_CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => clients.forEach(c => c.postMessage({ tipo: 'SW_ACTUALIZADO' })))
  );
});

// ---- FETCH: stale-while-revalidate (cache-first, actualiza en bg) ----
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

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
