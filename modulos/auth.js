// ============================================================
// modulos/auth.js — Pantalla de login/registro y gestión de sesión
// Depende de: core/supabase.js
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

  function _irALogin() {
    document.getElementById('login-forma').style.display    = 'flex';
    document.getElementById('registro-forma').style.display = 'none';
    document.getElementById('login-error').textContent = '';
    document.getElementById('login-email').focus();
  }

  function _irARegistro() {
    document.getElementById('login-forma').style.display    = 'none';
    document.getElementById('registro-forma').style.display = 'flex';
    document.getElementById('reg-error').textContent = '';
    document.getElementById('reg-email').focus();
  }

  function _setErrorLogin(msg)    { const el = document.getElementById('login-error'); if (el) el.textContent = msg; }
  function _setErrorRegistro(msg) { const el = document.getElementById('reg-error');   if (el) el.textContent = msg; }

  function _setEspera(btn, activo, textoEspera, textoNormal) {
    if (btn) { btn.disabled = activo; btn.textContent = activo ? textoEspera : textoNormal; }
  }

  /**
   * Inicializa el módulo de autenticación.
   * Devuelve una Promise que resuelve cuando el usuario está autenticado.
   */
  async function init() {
    if (SB.isLoggedIn()) { _ocultarLogin(); return; }
    const refrescado = await SB.refrescarSesion();
    if (refrescado) { _ocultarLogin(); return; }

    _mostrarLogin();

    return new Promise((resolver) => {

      // ---- LOGIN ----
      async function intentarLogin() {
        _setErrorLogin('');
        const email    = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        if (!email || !password) { _setErrorLogin('Introduce email y contraseña.'); return; }

        const btn = document.getElementById('btn-login');
        _setEspera(btn, true, 'Entrando…', 'Entrar');
        try {
          await SB.login(email, password);
          _ocultarLogin();
          resolver();
        } catch (e) {
          _setEspera(btn, false, '', 'Entrar');
          _setErrorLogin(e.message || 'Credenciales incorrectas.');
        }
      }

      // ---- REGISTRO ----
      async function intentarRegistro() {
        _setErrorRegistro('');
        const email = document.getElementById('reg-email').value.trim();
        const pass1 = document.getElementById('reg-password').value;
        const pass2 = document.getElementById('reg-password2').value;

        if (!email || !pass1) { _setErrorRegistro('Rellena todos los campos.'); return; }
        if (pass1.length < 6) { _setErrorRegistro('La contraseña debe tener al menos 6 caracteres.'); return; }
        if (pass1 !== pass2)  { _setErrorRegistro('Las contraseñas no coinciden.'); return; }

        const btn = document.getElementById('btn-registro');
        _setEspera(btn, true, 'Creando cuenta…', 'Crear cuenta');
        try {
          const logadoDirecto = await SB.signup(email, pass1);
          if (logadoDirecto) {
            _ocultarLogin();
            resolver();
          } else {
            // Supabase necesita confirmación por email
            _setEspera(btn, false, '', 'Crear cuenta');
            _setErrorRegistro('');
            document.getElementById('reg-error').style.color = '#82d6a0';
            document.getElementById('reg-error').textContent =
              '✔ Cuenta creada. Revisa tu email para confirmar y después inicia sesión.';
          }
        } catch (e) {
          _setEspera(btn, false, '', 'Crear cuenta');
          _setErrorRegistro(e.message || 'Error al crear la cuenta.');
        }
      }

      // Event listeners
      document.getElementById('btn-login')?.addEventListener('click', intentarLogin);
      document.getElementById('login-password')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') intentarLogin();
      });

      document.getElementById('btn-registro')?.addEventListener('click', intentarRegistro);
      document.getElementById('reg-password2')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') intentarRegistro();
      });

      document.getElementById('btn-ir-registro')?.addEventListener('click', _irARegistro);
      document.getElementById('btn-ir-login')?.addEventListener('click', _irALogin);
    });
  }

  return { init };

})();
