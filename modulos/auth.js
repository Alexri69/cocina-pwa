// ============================================================
// modulos/auth.js — Pantalla de login y gestión de sesión
// Depende de: core/supabase.js
// Muestra una pantalla de inicio de sesión antes de cargar
// la app. Si ya hay sesión activa, la salta directamente.
// ============================================================

const ModuloAuth = (() => {

  function _mostrarLogin() {
    document.getElementById('pantalla-login').style.display = 'flex';
    document.getElementById('app-principal').style.display  = 'none';
  }

  function _ocultarLogin() {
    document.getElementById('pantalla-login').style.display = 'none';
    document.getElementById('app-principal').style.display  = 'block';
  }

  function _setError(msg) {
    const el = document.getElementById('login-error');
    if (el) el.textContent = msg;
  }

  function _setEspera(activo) {
    const btn   = document.getElementById('btn-login');
    const email = document.getElementById('login-email');
    const pass  = document.getElementById('login-password');
    if (btn)   { btn.disabled = activo; btn.textContent = activo ? 'Entrando…' : 'Entrar'; }
    if (email)  email.disabled = activo;
    if (pass)   pass.disabled  = activo;
  }

  /**
   * Inicializa el módulo de autenticación.
   * Devuelve una Promise que resuelve cuando el usuario
   * está correctamente autenticado (login nuevo o sesión previa válida).
   */
  async function init() {
    // 1. Sesión activa → saltar login
    if (SB.isLoggedIn()) { _ocultarLogin(); return; }

    // 2. Token caducado → intentar refrescar silenciosamente
    const refrescado = await SB.refrescarSesion();
    if (refrescado) { _ocultarLogin(); return; }

    // 3. Sin sesión → mostrar el formulario de login
    _mostrarLogin();

    return new Promise((resolver) => {

      async function intentarLogin() {
        _setError('');
        const email    = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        if (!email || !password) { _setError('Introduce email y contraseña.'); return; }

        _setEspera(true);
        try {
          await SB.login(email, password);
          _ocultarLogin();
          resolver(); // La Promise se resuelve: la app puede continuar
        } catch (e) {
          _setEspera(false);
          _setError(e.message || 'Error al iniciar sesión. Comprueba los datos.');
        }
      }

      document.getElementById('btn-login')?.addEventListener('click', intentarLogin);

      // Permitir pulsar Enter desde el campo de contraseña
      document.getElementById('login-password')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') intentarLogin();
      });
    });
  }

  return { init };

})();
