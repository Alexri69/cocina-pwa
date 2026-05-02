// ============================================================
// app.js — Coordinador principal de la PWA Cocina
// ============================================================

// ---- Service Worker ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./trabajador.js')
      .then(r => console.log('[App] SW registrado:', r.scope))
      .catch(e => console.error('[App] SW error:', e));
  });
}

// ---- Tema claro / oscuro ----

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  localStorage.setItem('cocina_tema', tema);
  const btn = document.getElementById('btn-tema');
  if (btn) btn.textContent = tema === 'oscuro' ? '🌙' : '☀';
}

function _toggleTema() {
  const actual = document.documentElement.getAttribute('data-tema') || 'oscuro';
  aplicarTema(actual === 'oscuro' ? 'claro' : 'oscuro');
}

// ---- Navegación entre módulos ----

let _moduloActivo = null;

function navegarA(id) {
  document.querySelectorAll('.modulo-seccion').forEach(sec => sec.style.display = 'none');
  const seccion = document.getElementById('modulo-' + id);
  if (seccion) seccion.style.display = 'block';
  document.querySelectorAll('.nav-tab, .nav-bottom-tab').forEach(btn => {
    btn.classList.toggle('activo', btn.dataset.modulo === id);
  });
  _moduloActivo = id;
  sessionStorage.setItem('moduloActivo', id);
}

// ---- Inicialización ----

document.addEventListener('DOMContentLoaded', async () => {

  // Sincronizar icono del botón de tema con el tema ya aplicado por el inline script del <head>
  const temaActual = document.documentElement.getAttribute('data-tema') || 'oscuro';
  const btnTema = document.getElementById('btn-tema');
  if (btnTema) btnTema.textContent = temaActual === 'oscuro' ? '🌙' : '☀';

  // Abrir IndexedDB (para el módulo de etiquetas)
  try {
    await BD.abrirBaseDeDatos();
  } catch (e) {
    console.error('[App] Error crítico al abrir IndexedDB:', e);
    alert('Error al acceder a la base de datos local. Recarga la página.');
    return;
  }

  // Autenticar (bloquea hasta que el login sea correcto)
  await ModuloAuth.init();

  // Navegar al módulo correcto inmediatamente para evitar parpadeo
  navegarA(sessionStorage.getItem('moduloActivo') || 'dashboard');

  // Inicializar módulos
  await ModuloEtiquetas.init();
  await ModuloMenu.init();
  await ModuloBebidas.init();
  await ModuloFacturas.init();
  await ModuloConfig.init();

  // Estado de conexión inicial
  _actualizarBannerOffline();

  // Comprobar caducidades y mostrar alertas
  await _comprobarCaducidades();

  // Botón de tema en cabecera
  document.getElementById('btn-tema')?.addEventListener('click', _toggleTema);

  // Búsqueda global
  document.getElementById('btn-buscar')    ?.addEventListener('click', _abrirBusqueda);
  document.getElementById('busqueda-cerrar')?.addEventListener('click', _cerrarBusqueda);
  document.getElementById('busqueda-overlay')?.addEventListener('click', e => { if (e.target.id === 'busqueda-overlay') _cerrarBusqueda(); });
  document.getElementById('busqueda-inp')  ?.addEventListener('input', e => _ejecutarBusqueda(e.target.value));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _cerrarBusqueda(); });

  // Pestañas de navegación (header + barra inferior móvil)
  document.querySelectorAll('.nav-tab, .nav-bottom-tab').forEach(btn => {
    btn.addEventListener('click', () => navegarA(btn.dataset.modulo));
  });
});

// ---- Banner offline + indicador de conexión ----

function _actualizarBannerOffline() {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.style.display = navigator.onLine ? 'none' : 'block';

  const dot = document.getElementById('ind-conexion');
  if (dot) {
    dot.classList.toggle('online',  navigator.onLine);
    dot.classList.toggle('offline', !navigator.onLine);
    dot.title = navigator.onLine ? 'Conectado' : 'Sin conexión';
  }
}

window.addEventListener('online',  _actualizarBannerOffline);
window.addEventListener('offline', _actualizarBannerOffline);

// ---- Búsqueda global ----

function _abrirBusqueda() {
  const ov = document.getElementById('busqueda-overlay');
  if (ov) { ov.style.display = 'flex'; document.getElementById('busqueda-inp')?.focus(); }
}

function _cerrarBusqueda() {
  const ov = document.getElementById('busqueda-overlay');
  if (ov) { ov.style.display = 'none'; document.getElementById('busqueda-inp').value = ''; }
  document.getElementById('busqueda-resultados').innerHTML = '';
}

async function _ejecutarBusqueda(q) {
  const res = document.getElementById('busqueda-resultados');
  if (!res) return;
  q = q.trim().toLowerCase();
  if (!q) { res.innerHTML = ''; return; }

  try {
    const [platos, bebidas, ings] = await Promise.all([
      SB.obtenerPlatos(), SB.obtenerBebidas(), SB.obtenerIngredientes()
    ]);

    const filtrar = (arr, modulo, icono, tipo) =>
      (arr || [])
        .filter(i => i.nombre.toLowerCase().includes(q))
        .map(i => `<div class="busq-item" onclick="navegarA('${modulo}');_cerrarBusqueda()">
          <span>${icono}</span>
          <span>${i.nombre}${i.precio > 0 ? ' · ' + i.precio.toFixed(2) + ' €' : ''}</span>
          <span class="busq-tipo">${tipo}</span>
        </div>`).join('');

    const html = filtrar(platos, 'menu', '🍽', 'Carta')
               + filtrar(bebidas, 'bebidas', '🥤', 'Bebidas')
               + filtrar(ings, 'menu', '🥬', 'Ingrediente');

    res.innerHTML = html || '<p style="padding:16px;color:var(--texto2);text-align:center">Sin resultados para "' + q + '"</p>';
  } catch (e) {
    res.innerHTML = '<p style="padding:16px;color:var(--err)">Error al buscar</p>';
  }
}

// ---- Alertas de caducidad ----

async function _comprobarCaducidades() {
  try {
    const { caducados, proximos } = await ModuloEtiquetas.verificarCaducidades();
    const total = caducados.length + proximos.length;

    _actualizarBadgeEtiquetas(total);
    _renderAlertasDashboard(caducados, proximos);

    if (total > 0 && 'Notification' in window && Notification.permission !== 'denied') {
      const perm = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (perm === 'granted') {
        const partes = [];
        if (caducados.length) partes.push(`${caducados.length} caducado${caducados.length > 1 ? 's' : ''}`);
        if (proximos.length)  partes.push(`${proximos.length} próximo${proximos.length > 1 ? 's' : ''} a caducar`);
        new Notification('🍽 Cocina — Alerta de caducidad', {
          body: partes.join(' · '),
          icon: './iconos/icono-192.png',
          tag:  'cocina-caducidad'
        });
      }
    }
  } catch (e) { console.warn('[App] Error comprobando caducidades:', e); }
}

function _actualizarBadgeEtiquetas(n) {
  ['etq-badge-nav', 'etq-badge-bottom'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent    = n;
    el.style.display  = n > 0 ? 'inline-block' : 'none';
  });
}

function _renderAlertasDashboard(caducados, proximos) {
  const cont  = document.getElementById('dash-alertas');
  const lista = document.getElementById('dash-alertas-lista');
  if (!cont || !lista) return;
  if (!caducados.length && !proximos.length) { cont.style.display = 'none'; return; }
  lista.innerHTML = [
    ...caducados.map(p =>
      `<div class="dash-alerta-item rojo">🔴 <strong>${p.nombre}</strong> — Lote ${p.lote} — <em>CADUCADO</em></div>`),
    ...proximos.map(p =>
      `<div class="dash-alerta-item amarillo">🟡 <strong>${p.nombre}</strong> — Lote ${p.lote} — caduca ${VOZ.formatearFechaSolo(p.fechaCaducidad)}</div>`),
  ].join('');
  cont.style.display = 'block';
}
