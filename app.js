// ============================================================
// app.js — Coordinador principal de la PWA Cocina
// Registra el Service Worker, abre la BD y gestiona la
// navegación entre los tres módulos: Etiquetas, Menú, Facturas.
// ============================================================

// ---- Service Worker ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./trabajador.js')
      .then(r => console.log('[App] SW registrado:', r.scope))
      .catch(e => console.error('[App] SW error:', e));
  });
}

// ---- Navegación entre módulos ----

/** Módulo activo actualmente */
let _moduloActivo = null;

/**
 * Activa el módulo indicado: muestra su sección, oculta las demás
 * y marca la pestaña de navegación como activa.
 * @param {string} id - 'etiquetas' | 'menu' | 'facturas'
 */
function navegarA(id) {
  // Ocultar todos los módulos
  document.querySelectorAll('.modulo-seccion').forEach(sec => sec.style.display = 'none');
  // Mostrar el módulo seleccionado
  const seccion = document.getElementById('modulo-' + id);
  if (seccion) seccion.style.display = 'block';

  // Actualizar estado visual de las pestañas
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('activo', btn.dataset.modulo === id);
  });

  _moduloActivo = id;

  // Guardar el módulo activo en sessionStorage para recargas
  sessionStorage.setItem('moduloActivo', id);
}

// ---- Inicialización ----

document.addEventListener('DOMContentLoaded', async () => {

  // Abrir la base de datos antes de inicializar ningún módulo
  try {
    await BD.abrirBaseDeDatos();
  } catch (e) {
    console.error('[App] Error crítico al abrir IndexedDB:', e);
    alert('Error al acceder a la base de datos local. Recarga la página.');
    return;
  }

  // Autenticar al usuario (bloquea hasta que el login sea correcto)
  await ModuloAuth.init();

  // Inicializar cada módulo (registra sus event listeners y carga datos)
  await ModuloEtiquetas.init();
  await ModuloMenu.init();
  await ModuloFacturas.init();

  // Botón de cierre de sesión
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    if (confirm('¿Cerrar sesión?')) { SB.logout(); location.reload(); }
  });

  // Conectar pestañas de navegación
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => navegarA(btn.dataset.modulo));
  });

  // Restaurar el módulo que estaba activo antes de una recarga, o mostrar Etiquetas
  const moduloGuardado = sessionStorage.getItem('moduloActivo') || 'etiquetas';
  navegarA(moduloGuardado);
});
