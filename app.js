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
