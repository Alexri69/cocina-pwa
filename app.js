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

  // Inicializar módulos
  await ModuloEtiquetas.init();
  await ModuloMenu.init();
  await ModuloBebidas.init();
  await ModuloFacturas.init();
  await ModuloConfig.init();

  // Comprobar caducidades y mostrar alertas
  await _comprobarCaducidades();

  // Botones de cabecera
  document.getElementById('btn-tema')?.addEventListener('click', _toggleTema);
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    if (confirm('¿Cerrar sesión?')) { SB.logout(); location.reload(); }
  });

  // Botones de tema en la sección Config
  document.getElementById('cfg-btn-tema-osc')?.addEventListener('click', () => aplicarTema('oscuro'));
  document.getElementById('cfg-btn-tema-cla')?.addEventListener('click', () => aplicarTema('claro'));

  // Pestañas de navegación (header + barra inferior móvil)
  document.querySelectorAll('.nav-tab, .nav-bottom-tab').forEach(btn => {
    btn.addEventListener('click', () => navegarA(btn.dataset.modulo));
  });

  // Restaurar módulo activo
  const moduloGuardado = sessionStorage.getItem('moduloActivo') || 'dashboard';
  navegarA(moduloGuardado);
});

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
