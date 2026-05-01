// ============================================================
// core/supabase.js — Cliente Supabase usando la REST API nativa
// No necesita ningún SDK externo: usa fetch() puro.
// Gestiona autenticación, refresco de token y CRUD de datos.
// ============================================================

const SB = (() => {

  // Credenciales del proyecto (la anon key es pública por diseño;
  // la seguridad real viene de las políticas RLS en Supabase)
  const BASE = 'https://cznszdjcwajqutcyjgjr.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6bnN6ZGpjd2FqcXV0Y3lqZ2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MTk2MTMsImV4cCI6MjA5MzE5NTYxM30.KJE9RXGGqIipbWRqcxRhU7lCBzB5P-kqwO2BoP3nitc';
  const CLAVE_SESION = 'cocina_sesion';

  let _sesion = null; // { access_token, refresh_token, expires_at }

  // ----------------------------------------------------------
  // AUTENTICACIÓN
  // ----------------------------------------------------------

  function _cargarSesion() {
    if (_sesion) return;
    try { _sesion = JSON.parse(localStorage.getItem(CLAVE_SESION)); } catch { _sesion = null; }
  }

  function _guardarSesion(datos) {
    _sesion = {
      access_token:  datos.access_token,
      refresh_token: datos.refresh_token,
      expires_at:    Date.now() + (datos.expires_in || 3600) * 1000
    };
    localStorage.setItem(CLAVE_SESION, JSON.stringify(_sesion));
  }

  /** Devuelve true si hay sesión activa y no ha expirado. */
  function isLoggedIn() {
    _cargarSesion();
    return !!(
      _sesion?.access_token &&
      _sesion?.expires_at > Date.now()
    );
  }

  /**
   * Inicia sesión con email y contraseña.
   * Lanza un Error con mensaje en español si falla.
   */
  async function login(email, password) {
    const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error_description || err.msg || err.message || 'Credenciales incorrectas';
      throw new Error(msg);
    }
    _guardarSesion(await res.json());
  }

  /**
   * Intenta renovar el token de acceso usando el refresh_token.
   * Devuelve true si tuvo éxito, false si hay que volver a logarse.
   */
  async function refrescarSesion() {
    _cargarSesion();
    if (!_sesion?.refresh_token) return false;
    try {
      const res = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
        method:  'POST',
        headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: _sesion.refresh_token })
      });
      if (!res.ok) { _sesion = null; localStorage.removeItem(CLAVE_SESION); return false; }
      _guardarSesion(await res.json());
      return true;
    } catch { return false; }
  }

  /** Cierra la sesión y limpia el almacenamiento local. */
  function logout() {
    _sesion = null;
    localStorage.removeItem(CLAVE_SESION);
  }

  // ----------------------------------------------------------
  // CABECERAS HTTP
  // ----------------------------------------------------------

  function _cab(extra = {}) {
    _cargarSesion();
    return {
      'apikey':        ANON,
      'Authorization': `Bearer ${_sesion?.access_token || ANON}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...extra
    };
  }

  // ----------------------------------------------------------
  // FETCH GENÉRICO CON REINTENTO AUTOMÁTICO EN TOKEN EXPIRADO
  // ----------------------------------------------------------

  async function _req(ruta, opciones = {}) {
    let res = await fetch(`${BASE}/rest/v1/${ruta}`, opciones);

    // Si el token expiró, intentamos refrescarlo una vez y reintentamos
    if (res.status === 401) {
      const ok = await refrescarSesion();
      if (ok) {
        opciones.headers = { ...opciones.headers, 'Authorization': `Bearer ${_sesion.access_token}` };
        res = await fetch(`${BASE}/rest/v1/${ruta}`, opciones);
      } else {
        // No se pudo refrescar: forzar logout y recarga
        logout();
        location.reload();
        return;
      }
    }

    if (res.status === 204) return null; // Sin contenido (DELETE exitoso)

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Error Supabase ${res.status}: ${body}`);
    }

    return res.json();
  }

  // CRUD genérico
  const _get    = (tabla, q = '')  => _req(`${tabla}${q}`, { headers: _cab({ 'Prefer': '' }) });
  const _post   = (tabla, datos)   => _req(tabla, { method: 'POST',   headers: _cab(), body: JSON.stringify(datos) });
  const _patch  = (tabla, id, d)   => _req(`${tabla}?id=eq.${id}`, { method: 'PATCH',  headers: _cab(), body: JSON.stringify(d) });
  const _delete = (tabla, id)      => _req(`${tabla}?id=eq.${id}`, { method: 'DELETE', headers: _cab({ 'Prefer': '' }) });

  const _primero = (arr) => Array.isArray(arr) ? arr[0] ?? null : arr;

  // ----------------------------------------------------------
  // INGREDIENTES
  // ----------------------------------------------------------

  const obtenerIngredientes   = ()    => _get('ingredientes', '?select=*&order=timestamp.desc');
  const obtenerIngrediente    = (id)  => _get('ingredientes', `?id=eq.${id}&select=*`).then(_primero);
  const guardarIngrediente    = (d)   => _post('ingredientes', { nombre: d.nombre, alergenos: d.alergenos, timestamp: Date.now() }).then(_primero);
  const actualizarIngrediente = (d)   => _patch('ingredientes', d.id, { nombre: d.nombre, alergenos: d.alergenos }).then(_primero);
  const eliminarIngrediente   = (id)  => _delete('ingredientes', id);

  // ----------------------------------------------------------
  // PLATOS
  // ----------------------------------------------------------

  const obtenerPlatos   = ()    => _get('platos', '?select=*&order=timestamp.desc');
  const obtenerPlato    = (id)  => _get('platos', `?id=eq.${id}&select=*`).then(_primero);
  const guardarPlato    = (d)   => _post('platos', { nombre: d.nombre, descripcion: d.descripcion, precio: d.precio, ingredientes: d.ingredientes, alergenos: d.alergenos, timestamp: Date.now() }).then(_primero);
  const actualizarPlato = (d)   => _patch('platos', d.id, { nombre: d.nombre, descripcion: d.descripcion, precio: d.precio, ingredientes: d.ingredientes, alergenos: d.alergenos }).then(_primero);
  const eliminarPlato   = (id)  => _delete('platos', id);

  // ----------------------------------------------------------
  // FACTURAS
  // (la BD usa porcentaje_igic / cuota_igic en snake_case;
  //  el JS usa porcentajeIgic / cuotaIgic en camelCase)
  // ----------------------------------------------------------

  function _facturaDeBD(f) {
    if (!f) return null;
    const { porcentaje_igic, cuota_igic, ...resto } = f;
    return { ...resto, porcentajeIgic: porcentaje_igic, cuotaIgic: cuota_igic };
  }

  function _facturaParaBD(f) {
    const { porcentajeIgic, cuotaIgic, id, user_id, ...resto } = f;
    return { ...resto, porcentaje_igic: porcentajeIgic ?? 7, cuota_igic: cuotaIgic ?? 0 };
  }

  const obtenerFacturas   = ()    => _get('facturas', '?select=*&order=timestamp.desc').then(arr => (arr || []).map(_facturaDeBD));
  const obtenerFactura    = (id)  => _get('facturas', `?id=eq.${id}&select=*`).then(arr => _facturaDeBD(_primero(arr)));
  const guardarFactura    = (f)   => _post('facturas', _facturaParaBD(f)).then(r => _facturaDeBD(_primero(r)));
  const actualizarFactura = (f)   => _patch('facturas', f.id, _facturaParaBD(f)).then(r => _facturaDeBD(_primero(r)));
  const borrarFactura     = (id)  => _delete('facturas', id);

  async function siguienteNumeroFactura() {
    const anyo = new Date().getFullYear();
    // %25 = URL-encoded % (wildcard SQL LIKE)
    const res  = await _get('facturas', `?select=numero&numero=like.${anyo}-%25`);
    return `${anyo}-${String((res?.length || 0) + 1).padStart(4, '0')}`;
  }

  // ----------------------------------------------------------
  // INICIO: cargar sesión al arrancar el script
  // ----------------------------------------------------------
  _cargarSesion();

  return {
    // Auth
    isLoggedIn, login, logout, refrescarSesion,
    // Ingredientes
    obtenerIngredientes, obtenerIngrediente,
    guardarIngrediente, actualizarIngrediente, eliminarIngrediente,
    // Platos
    obtenerPlatos, obtenerPlato,
    guardarPlato, actualizarPlato, eliminarPlato,
    // Facturas
    obtenerFacturas, obtenerFactura,
    guardarFactura, actualizarFactura, borrarFactura,
    siguienteNumeroFactura
  };

})();
