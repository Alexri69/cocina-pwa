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

  const FORMAS = ['login-forma', 'registro-forma', 'recuperar-forma', 'nueva-pass-forma'];
  function _verForma(id, foco) {
    FORMAS.forEach(f => { const el = document.getElementById(f); if (el) el.style.display = f === id ? 'flex' : 'none'; });
    document.querySelectorAll('#pantalla-login .login-error').forEach(el => { el.textContent = ''; el.style.color = ''; });
    document.getElementById(foco)?.focus();
  }

  const _irALogin     = () => _verForma('login-forma', 'login-email');
  const _irARegistro  = () => _verForma('registro-forma', 'reg-email');
  function _irARecuperar() {
    _verForma('recuperar-forma', 'rec-email');
    // Rellenar con el email que ya hubiera escrito en el login
    const e = document.getElementById('login-email').value.trim();
    if (e) document.getElementById('rec-email').value = e;
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
    // ¿Venimos del enlace de un email de Supabase (recuperar contraseña / confirmar cuenta)?
    const enlace = SB.sesionDesdeEnlace();
    if (enlace?.tipo === 'recovery') { await _pedirNuevaPassword(); return; }

    if (SB.isLoggedIn()) { _ocultarLogin(); return; }
    const refrescado = await SB.refrescarSesion();
    if (refrescado) { _ocultarLogin(); return; }
    // Sin conexión con una sesión guardada: entrar igualmente con los datos locales.
    // El token se renovará solo al volver la red.
    if (refrescado === null && SB.tieneSesion()) { _ocultarLogin(); return; }

    _mostrarLogin();
    if (enlace?.error) { _setErrorLogin(enlace.error); }

    return new Promise((resolver) => {

      // ---- RECUPERAR CONTRASEÑA ----
      async function intentarRecuperar() {
        const err = document.getElementById('rec-error');
        err.style.color = ''; err.textContent = '';
        const email = document.getElementById('rec-email').value.trim();
        if (!email || !validarEmail(email)) { err.textContent = 'Escribe un email válido.'; return; }
        const btn = document.getElementById('btn-recuperar');
        _setEspera(btn, true, 'Enviando…', 'Enviar enlace');
        try {
          await SB.recuperarPassword(email);
          err.style.color = 'var(--ok)';
          err.textContent = '✔ Si hay una cuenta con ese email, te llegará un enlace para poner una contraseña nueva. Mira también en spam.';
        } catch (e) {
          err.textContent = e.message || 'No se pudo enviar el email.';
        }
        _setEspera(btn, false, '', 'Enviar enlace');
      }
      document.getElementById('btn-ir-recuperar')?.addEventListener('click', _irARecuperar);
      document.getElementById('btn-rec-volver')?.addEventListener('click', _irALogin);
      document.getElementById('btn-recuperar')?.addEventListener('click', intentarRecuperar);
      document.getElementById('rec-email')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') intentarRecuperar(); });

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
            document.getElementById('reg-error').style.color = 'var(--ok)';
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

  /** Pantalla «Nueva contraseña» tras abrir el enlace del email. Resuelve al guardarla (ya con sesión). */
  function _pedirNuevaPassword() {
    _mostrarLogin();
    _verForma('nueva-pass-forma', 'np-password');
    return new Promise((resolver) => {
      const err = document.getElementById('np-error');
      async function guardar() {
        err.textContent = '';
        const p1 = document.getElementById('np-password').value;
        const p2 = document.getElementById('np-password2').value;
        if (p1.length < 6) { err.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
        if (p1 !== p2)     { err.textContent = 'Las contraseñas no coinciden.'; return; }
        const btn = document.getElementById('btn-nueva-pass');
        _setEspera(btn, true, 'Guardando…', 'Guardar y entrar');
        try {
          await SB.cambiarPassword(p1);
          _ocultarLogin();
          aviso('✔ Contraseña cambiada.', { tipo: 'ok', ms: 4000 });
          resolver();
        } catch (e) {
          _setEspera(btn, false, '', 'Guardar y entrar');
          err.textContent = e.message || 'No se pudo cambiar la contraseña.';
        }
      }
      document.getElementById('btn-nueva-pass').addEventListener('click', guardar);
      document.getElementById('np-password2').addEventListener('keydown', (e) => { if (e.key === 'Enter') guardar(); });
    });
  }

  return { init };

})();
