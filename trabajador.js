// ============================================================
// trabajador.js — Service Worker (cache-first, offline total)
// Versión 2: cubre la nueva estructura de archivos con módulos.
// ============================================================

const NOMBRE_CACHE = 'cocina-etiquetas-v9'; // Cambiar versión invalida la caché anterior

const ARCHIVOS_A_CACHEAR = [
  './index.html',
  './estilo.css',
  './app.js',
  './manifest.json',
  './core/bd.js',
  './core/voz.js',
  './core/supabase.js',
  './modulos/etiquetas.js',
  './modulos/menu.js',
  './modulos/facturas.js',
  './modulos/auth.js',
  './modulos/config.js',
  './iconos/icono-192.png',
  './iconos/icono-512.png'
];

// ---- INSTALL: pre-cachear todos los recursos ----
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Activar inmediatamente sin esperar cierre de pestañas
  e.waitUntil(
    caches.open(NOMBRE_CACHE).then(cache =>
      // Si algún icono no existe aún, no bloqueamos la instalación
      cache.addAll(ARCHIVOS_A_CACHEAR).catch(() =>
        cache.addAll(ARCHIVOS_A_CACHEAR.filter(f => !f.includes('iconos')))
      )
    )
  );
});

// ---- ACTIVATE: limpiar cachés antiguas ----
self.addEventListener('activate', (e) => {
  self.clients.claim();
  e.waitUntil(
    caches.keys().then(nombres =>
      Promise.all(nombres.filter(n => n !== NOMBRE_CACHE).map(n => caches.delete(n)))
    )
  );
});

// ---- FETCH: cache-first con actualización en segundo plano ----
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // No interceptar llamadas a APIs externas (Supabase, etc.)
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      // Siempre devolvemos la caché si existe (respuesta instantánea)
      // y en paralelo actualizamos la caché desde la red (stale-while-revalidate)
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
