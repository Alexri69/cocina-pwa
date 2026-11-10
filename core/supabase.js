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

  // Extrae el 'sub' (user UUID) del payload de un JWT sin validar firma
  function _subDeJWT(token) {
    try {
      const b64url = (token || '').split('.')[1];
      if (!b64url) return null;
      const b64    = b64url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
      return JSON.parse(atob(padded)).sub ?? null;
    } catch { return null; }
  }

  function _cargarSesion() {
    if (_sesion) return;
    try { _sesion = JSON.parse(localStorage.getItem(CLAVE_SESION)); } catch { _sesion = null; }
    // Si la sesión guardada no tiene user_id, extraerlo del token
    if (_sesion && !_sesion.user_id) {
      const sub = _subDeJWT(_sesion.access_token);
      if (sub) { _sesion.user_id = sub; try { localStorage.setItem(CLAVE_SESION, JSON.stringify(_sesion)); } catch {} }
    }
  }

  function _guardarSesion(datos) {
    const userId = datos.user?.id ?? _subDeJWT(datos.access_token) ?? null;
    _sesion = {
      access_token:  datos.access_token,
      refresh_token: datos.refresh_token,
      expires_at:    Date.now() + (datos.expires_in || 3600) * 1000,
      user_id:       userId,
    };
    localStorage.setItem(CLAVE_SESION, JSON.stringify(_sesion));
  }

  function _uid() {
    _cargarSesion();
    return _sesion?.user_id ?? _subDeJWT(_sesion?.access_token) ?? null;
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
   * Registra un nuevo usuario con email y contraseña.
   * Devuelve true si quedó logado directamente (confirmación de email desactivada),
   * o false si Supabase envió un email de confirmación.
   */
  async function signup(email, password) {
    const res = await fetch(`${BASE}/auth/v1/signup`, {
      method:  'POST',
      headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || data.message || 'Error al registrarse');
    }
    if (data.access_token) {
      _guardarSesion(data);
      return true; // login automático (confirmación de email desactivada)
    }
    return false; // Supabase envió email de confirmación
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

  /** true si hay una sesión guardada (aunque el token haya caducado). Permite entrar sin conexión. */
  function tieneSesion() {
    _cargarSesion();
    return !!_sesion?.refresh_token;
  }

  /**
   * Intenta renovar el token de acceso usando el refresh_token.
   * Devuelve true si tuvo éxito, false si la sesión ya no es válida (hay que volver a logarse)
   * o null si no se pudo comprobar por falta de red (la sesión se conserva).
   */
  async function refrescarSesion() {
    _cargarSesion();
    if (!_sesion?.refresh_token) return false;
    let res;
    try {
      res = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
        method:  'POST',
        headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: _sesion.refresh_token })
      });
    } catch { return null; } // sin red: no sabemos si es válida → no la borramos
    if (res.status >= 500) return null; // fallo temporal del servidor
    if (!res.ok) { _sesion = null; localStorage.removeItem(CLAVE_SESION); return false; }
    _guardarSesion(await res.json());
    return true;
  }

  /** Cierra la sesión y borra del dispositivo los datos del usuario (caché, cola, empresa, logo). */
  function logout() {
    _sesion = null;
    localStorage.removeItem(CLAVE_SESION);
  }

  function limpiarDatosLocales() {
    const borrar = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cocina_') && k !== 'cocina_tema') borrar.push(k);
    }
    borrar.forEach(k => localStorage.removeItem(k));
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
    let res;
    try {
      res = await fetch(`${BASE}/rest/v1/${ruta}`, opciones);
    } catch (err) {
      throw new Error('Sin conexión o error de red. Comprueba tu conexión a internet.');
    }

    // Si el token expiró, intentamos refrescarlo una vez y reintentamos
    if (res.status === 401) {
      const ok = await refrescarSesion();
      if (ok === null) throw new Error('Sin conexión o error de red. Comprueba tu conexión a internet.');
      if (ok) {
        opciones.headers = { ...opciones.headers, 'Authorization': `Bearer ${_sesion.access_token}` };
        try {
          res = await fetch(`${BASE}/rest/v1/${ruta}`, opciones);
        } catch (err) {
          throw new Error('Sin conexión o error de red. Comprueba tu conexión a internet.');
        }
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

  // CRUD genérico (las escrituras se encolan si no hay conexión → outbox)
  const _get = (tabla, q = '') => _req(`${tabla}${q}`, { headers: _cab({ 'Prefer': '' }) });

  // INSERT: genera un id de cliente para poder reintentar offline sin duplicar.
  async function _post(tabla, datos) {
    if (!datos.id && typeof crypto !== 'undefined' && crypto.randomUUID) datos = { id: crypto.randomUUID(), ...datos };
    try {
      return await _req(tabla, { method: 'POST', headers: _cab(), body: JSON.stringify(datos) });
    } catch (e) {
      if (!_esRed(e)) throw e;
      _outboxAdd({ metodo: 'POST', tabla, datos });
      _aplicarACache(tabla, 'POST', datos.id, datos);
      return [datos]; // respuesta optimista (offline)
    }
  }

  async function _patch(tabla, id, d) {
    try {
      return await _req(`${tabla}?id=eq.${id}`, { method: 'PATCH', headers: _cab(), body: JSON.stringify(d) });
    } catch (e) {
      if (!_esRed(e)) throw e;
      _outboxAdd({ metodo: 'PATCH', tabla, id, datos: d });
      _aplicarACache(tabla, 'PATCH', id, { id, ...d });
      return [{ id, ...d }];
    }
  }

  async function _delete(tabla, id) {
    try {
      return await _req(`${tabla}?id=eq.${id}`, { method: 'DELETE', headers: _cab({ 'Prefer': '' }) });
    } catch (e) {
      if (!_esRed(e)) throw e;
      _outboxAdd({ metodo: 'DELETE', tabla, id });
      _aplicarACache(tabla, 'DELETE', id, null);
      return null;
    }
  }

  const _primero = (arr) => Array.isArray(arr) ? arr[0] ?? null : arr;

  // ----------------------------------------------------------
  // CACHÉ OFFLINE (localStorage, clave cocina_c_<tabla>)
  // ----------------------------------------------------------

  const _CACHE = {
    guardar: (k, v) => { try { localStorage.setItem('cocina_c_' + k, JSON.stringify(v)); } catch {} },
    leer:    (k)    => { try { return JSON.parse(localStorage.getItem('cocina_c_' + k)); } catch { return null; } }
  };

  // ----------------------------------------------------------
  // COLA DE ESCRITURA OFFLINE (outbox)
  // Si una escritura falla por falta de red, se guarda aquí y se aplica a la
  // caché local (UI optimista). flushOutbox() la reintenta al volver la conexión.
  // ----------------------------------------------------------

  const _OUTBOX_KEY = 'cocina_outbox';
  // Convierte filas en formato BD al formato de la caché (camelCase) al aplicarlas offline
  const _CACHE_MAP  = { productos: _productoDeBD, facturas: _facturaDeBD, plantillas_etiqueta: (p) => _plantillaDeBD(p) };

  function _esRed(e) {
    return !navigator.onLine || /sin conexión|conexion|\bred\b|failed to fetch|networkerror/i.test(e?.message || '');
  }
  function _outboxLeer()      { try { return JSON.parse(localStorage.getItem(_OUTBOX_KEY)) || []; } catch { return []; } }
  function _outboxEscribir(q) { try { localStorage.setItem(_OUTBOX_KEY, JSON.stringify(q)); } catch {} _avisarPendientes(); }
  function _outboxAdd(op)     { const q = _outboxLeer(); q.push(op); _outboxEscribir(q); }
  function pendientes()       { return _outboxLeer().length; }
  function _avisarPendientes(){ try { window.dispatchEvent(new CustomEvent('cocina:pendientes', { detail: pendientes() })); } catch {} }

  // Refleja la operación en la caché local para que la UI la muestre offline.
  function _aplicarACache(tabla, op, id, datos) {
    const claves = tabla === 'facturas'
      ? (op === 'DELETE' ? ['facturas', 'presupuestos'] : [datos?.tipo === 'presupuesto' ? 'presupuestos' : 'facturas'])
      : [tabla];
    for (const clave of claves) {
      let arr = _CACHE.leer(clave);
      if (!Array.isArray(arr)) continue;
      if (op === 'DELETE') {
        arr = arr.filter(r => r.id !== id);
      } else {
        const shaped = _CACHE_MAP[tabla] ? _CACHE_MAP[tabla](datos) : datos;
        const i = arr.findIndex(r => r.id === id);
        if (i >= 0) arr[i] = { ...arr[i], ...shaped }; else arr.unshift(shaped);
      }
      _CACHE.guardar(clave, arr);
    }
  }

  // Escrituras que el servidor rechazó (no por red). Se guardan para no perderlas en silencio.
  const _ERRORES_KEY = 'cocina_outbox_errores';
  function erroresSync()       { try { return JSON.parse(localStorage.getItem(_ERRORES_KEY)) || []; } catch { return []; } }
  function descartarErroresSync() { try { localStorage.removeItem(_ERRORES_KEY); } catch {} }

  let _sincronizando = false;
  // Reintenta las escrituras pendientes (al volver la conexión / al iniciar).
  async function flushOutbox() {
    if (!navigator.onLine || _sincronizando) return;
    const q = _outboxLeer();
    if (!q.length) return;
    _sincronizando = true;
    const restantes = [];
    const fallidas  = [];
    try {
      for (const op of q) {
        try {
          await _sinColumnasNuevas(op.datos, (datos) => {
            if (op.metodo === 'POST')
              return _req(`${op.tabla}?on_conflict=id`, { method: 'POST', headers: _cab({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(datos) });
            if (op.metodo === 'PATCH')
              return _req(`${op.tabla}?id=eq.${op.id}`, { method: 'PATCH', headers: _cab({ 'Prefer': 'return=minimal' }), body: JSON.stringify(datos) });
            return _req(`${op.tabla}?id=eq.${op.id}`, { method: 'DELETE', headers: _cab({ 'Prefer': '' }) });
          });
        } catch (e) {
          if (_esRed(e)) restantes.push(op); // sigue sin conexión → reintentar luego
          else fallidas.push({ ...op, error: String(e.message || e).slice(0, 300), fecha: new Date().toISOString() });
        }
      }
    } finally {
      _sincronizando = false;
    }
    _outboxEscribir(restantes);
    if (fallidas.length) {
      try { localStorage.setItem(_ERRORES_KEY, JSON.stringify([...erroresSync(), ...fallidas])); } catch {}
      try { window.dispatchEvent(new CustomEvent('cocina:errores-sync', { detail: fallidas })); } catch {}
    }
  }

  // Columnas añadidas en migraciones recientes: si la BD aún no las tiene,
  // se reintenta sin ellas en vez de fallar el guardado entero.
  const _COLUMNAS_NUEVAS = ['comensales'];
  async function _sinColumnasNuevas(datos, fn) {
    try {
      return await fn(datos);
    } catch (e) {
      const msg = String(e?.message || '');
      const col = _COLUMNAS_NUEVAS.find(c => datos && c in datos && msg.includes(`'${c}'`));
      if (!col) throw e;
      console.warn(`[SB] La columna "${col}" no existe aún en Supabase; ejecuta supabase-setup.sql. Guardando sin ella.`);
      const { [col]: _omit, ...resto } = datos;
      return fn(resto);
    }
  }

  if (typeof window !== 'undefined') window.addEventListener('online', () => flushOutbox());

  // ----------------------------------------------------------
  // PRODUCTOS (etiquetas de trazabilidad)
  // ----------------------------------------------------------

  function _productoDeBD(p) {
    if (!p) return null;
    const { dias_caducidad, fecha_apertura, fecha_caducidad, ...resto } = p;
    return { ...resto, diasCaducidad: dias_caducidad, fechaApertura: fecha_apertura, fechaCaducidad: fecha_caducidad };
  }

  function _productoParaBD(p) {
    const { diasCaducidad, fechaApertura, fechaCaducidad, id, user_id, ...resto } = p;
    return { ...resto, dias_caducidad: diasCaducidad, fecha_apertura: fechaApertura, fecha_caducidad: fechaCaducidad };
  }

  async function obtenerProductos() {
    try {
      const datos = await _get('productos', '?select=*&order=timestamp.desc').then(arr => (arr || []).map(_productoDeBD));
      _CACHE.guardar('productos', datos);
      return datos;
    } catch (e) {
      const cache = _CACHE.leer('productos');
      if (_esRed(e) && cache !== null) return cache;
      throw e;
    }
  }

  async function guardarProducto(p) {
    let uid = _uid();
    if (!uid) {
      await refrescarSesion();
      uid = _uid();
    }
    if (!uid) throw new Error('Sesión no válida. Cierra sesión y vuelve a entrar.');

    // Verificar contra Supabase que la sesión es realmente válida (auth.uid() != null)
    // Si /auth/v1/user falla con el token actual, el JWT no es de usuario real
    try {
      const r = await fetch(`${BASE}/auth/v1/user`, {
        headers: { 'apikey': ANON, 'Authorization': `Bearer ${_sesion.access_token}` }
      });
      if (!r.ok) {
        // Intentar refrescar y reintentar verificación
        const ok = await refrescarSesion();
        if (ok === null) {
          throw new Error('Sin conexión o error de red. Comprueba tu conexión a internet.');
        } else if (ok) {
          const r2 = await fetch(`${BASE}/auth/v1/user`, {
            headers: { 'apikey': ANON, 'Authorization': `Bearer ${_sesion.access_token}` }
          });
          if (!r2.ok) {
            logout();
            throw new Error('Tu sesión no es válida en el servidor. Acabamos de cerrarla — recarga la página e inicia sesión de nuevo.');
          }
          uid = _uid();
        } else {
          logout();
          throw new Error('Tu sesión ha expirado. Recarga la página e inicia sesión de nuevo.');
        }
      }
    } catch (err) {
      // Si el error es de red (no de validación), seguimos adelante para que cache/offline funcione
      if (err.message?.includes('sesión')) throw err;
      console.warn('[SB] No se pudo verificar la sesión (error de red):', err);
    }

    return _post('productos', { ..._productoParaBD(p), user_id: uid }).then(r => _productoDeBD(_primero(r)));
  }
  const actualizarProducto = (p)  => _patch('productos', p.id, _productoParaBD(p)).then(r => _productoDeBD(_primero(r)));
  const eliminarProducto   = (id) => _delete('productos', id);

  // ----------------------------------------------------------
  // PLANTILLAS DE ETIQUETA (productos habituales)
  // ----------------------------------------------------------

  function _plantillaDeBD(p) {
    if (!p) return null;
    // Solo se convierten las claves presentes: al aplicar un PATCH parcial a la caché
    // (p. ej. solo "usos") no hay que pisar el resto de campos.
    const { dias_caducidad, ...resto } = p;
    return 'dias_caducidad' in p ? { ...resto, diasCaducidad: dias_caducidad } : resto;
  }

  async function obtenerPlantillas() {
    try {
      const datos = await _get('plantillas_etiqueta', '?select=*&order=usos.desc,nombre.asc').then(arr => (arr || []).map(_plantillaDeBD));
      _CACHE.guardar('plantillas_etiqueta', datos);
      return datos;
    } catch (e) {
      const cache = _CACHE.leer('plantillas_etiqueta');
      if (_esRed(e) && cache !== null) return cache;
      throw e;
    }
  }
  const _plantillaParaBD = (p) => ({ nombre: p.nombre, dias_caducidad: p.diasCaducidad, alergenos: p.alergenos || [], ...(p.usos != null ? { usos: p.usos } : {}) });
  const guardarPlantilla    = (p)  => _post('plantillas_etiqueta', { ..._plantillaParaBD(p), usos: p.usos ?? 0, timestamp: Date.now(), user_id: _uid() }).then(r => _plantillaDeBD(_primero(r)));
  const actualizarPlantilla = (p)  => _patch('plantillas_etiqueta', p.id, _plantillaParaBD(p)).then(r => _plantillaDeBD(_primero(r)));
  const eliminarPlantilla   = (id) => _delete('plantillas_etiqueta', id);

  // ----------------------------------------------------------
  // APPCC (registros sanitarios). Formato = columnas de la BD (snake_case).
  // ----------------------------------------------------------

  async function obtenerElementosAppcc() {
    try {
      const datos = await _get('appcc_elementos', '?select=*&order=tipo.asc,orden.asc,nombre.asc');
      _CACHE.guardar('appcc_elementos', datos || []);
      return datos || [];
    } catch (e) {
      const cache = _CACHE.leer('appcc_elementos');
      if (_esRed(e) && cache !== null) return cache;
      throw e;
    }
  }
  const _elementoAppcc = (d) => ({
    tipo: d.tipo, nombre: d.nombre, zona: d.zona ?? '',
    min: d.min === '' || d.min == null ? null : Number(d.min),
    max: d.max === '' || d.max == null ? null : Number(d.max),
    frecuencia: d.frecuencia || 'diaria', activo: d.activo ?? true, orden: d.orden ?? 0,
  });
  const guardarElementoAppcc    = (d)  => _post('appcc_elementos', { ..._elementoAppcc(d), timestamp: Date.now(), user_id: _uid() }).then(_primero);
  const actualizarElementoAppcc = (d)  => _patch('appcc_elementos', d.id, _elementoAppcc(d)).then(_primero);
  const eliminarElementoAppcc   = (id) => _delete('appcc_elementos', id);

  /**
   * Registros entre dos fechas (ISO). Los de los últimos 40 días se guardan en
   * caché para trabajar sin conexión; los rangos más antiguos (informes) requieren red.
   */
  async function obtenerRegistrosAppcc(desde, hasta) {
    const q = `?select=*&fecha=gte.${encodeURIComponent(desde)}&fecha=lt.${encodeURIComponent(hasta)}&order=fecha.desc`;
    // Comparar como fechas (la BD devuelve "+00:00" y el cliente usa "Z")
    const t = x => new Date(x).getTime();
    const tDesde = t(desde), tHasta = t(hasta);
    const reciente = (Date.now() - tDesde) <= 40 * 86400000;
    try {
      const datos = await _get('appcc_registros', q);
      if (reciente) {
        // Fusionar con lo ya cacheado para no perder el resto del periodo
        const previo = (_CACHE.leer('appcc_registros') || []).filter(r => t(r.fecha) < tDesde || t(r.fecha) >= tHasta);
        const limite = Date.now() - 40 * 86400000;
        _CACHE.guardar('appcc_registros', [...(datos || []), ...previo].filter(r => t(r.fecha) >= limite));
      }
      return datos || [];
    } catch (e) {
      const cache = _CACHE.leer('appcc_registros');
      if (_esRed(e) && cache !== null) return cache.filter(r => t(r.fecha) >= tDesde && t(r.fecha) < tHasta).sort((a, b) => t(b.fecha) - t(a.fecha));
      throw e;
    }
  }
  const guardarRegistroAppcc  = (r)  => _post('appcc_registros', {
    tipo: r.tipo, elemento_id: r.elemento_id ?? null, elemento_nombre: r.elemento_nombre || '',
    fecha: r.fecha || new Date().toISOString(),
    valor: r.valor === '' || r.valor == null ? null : Number(r.valor),
    correcto: r.correcto !== false, accion_correctora: r.accion_correctora || '',
    responsable: r.responsable || '', datos: r.datos || {}, timestamp: Date.now(), user_id: _uid(),
  }).then(_primero);
  const eliminarRegistroAppcc = (id) => _delete('appcc_registros', id);

  // ----------------------------------------------------------
  // INGREDIENTES
  // ----------------------------------------------------------

  async function obtenerIngredientes() {
    try {
      const datos = await _get('ingredientes', '?select=*&order=timestamp.desc');
      _CACHE.guardar('ingredientes', datos);
      return datos;
    } catch (e) {
      const cache = _CACHE.leer('ingredientes');
      if (_esRed(e) && cache !== null) return cache;
      throw e;
    }
  }
  async function obtenerIngrediente(id) {
    try { return await _get('ingredientes', `?id=eq.${id}&select=*`).then(_primero); }
    catch (e) {
      const cache = _CACHE.leer('ingredientes');
      if (_esRed(e) && cache !== null) return cache.find(i => i.id === id) ?? null;
      throw e;
    }
  }
  const guardarIngrediente    = (d)   => _post('ingredientes', { nombre: d.nombre, alergenos: d.alergenos, timestamp: Date.now(), user_id: _uid() }).then(_primero);
  const actualizarIngrediente = (d)   => _patch('ingredientes', d.id, { nombre: d.nombre, alergenos: d.alergenos }).then(_primero);
  const eliminarIngrediente   = (id)  => _delete('ingredientes', id);

  // ----------------------------------------------------------
  // PLATOS
  // ----------------------------------------------------------

  async function obtenerPlatos() {
    try {
      const datos = await _get('platos', '?select=*&order=timestamp.desc');
      _CACHE.guardar('platos', datos);
      return datos;
    } catch (e) {
      const cache = _CACHE.leer('platos');
      if (_esRed(e) && cache !== null) return cache;
      throw e;
    }
  }
  async function obtenerPlato(id) {
    try { return await _get('platos', `?id=eq.${id}&select=*`).then(_primero); }
    catch (e) {
      const cache = _CACHE.leer('platos');
      if (_esRed(e) && cache !== null) return cache.find(p => p.id === id) ?? null;
      throw e;
    }
  }
  const guardarPlato    = (d)   => _post('platos', { nombre: d.nombre, descripcion: d.descripcion, precio: d.precio, ingredientes: d.ingredientes, alergenos: d.alergenos, timestamp: Date.now(), user_id: _uid() }).then(_primero);
  const actualizarPlato = (d)   => _patch('platos', d.id, { nombre: d.nombre, descripcion: d.descripcion, precio: d.precio, ingredientes: d.ingredientes, alergenos: d.alergenos }).then(_primero);
  const eliminarPlato   = (id)  => _delete('platos', id);

  // ----------------------------------------------------------
  // FACTURAS
  // (la BD usa porcentaje_igic / cuota_igic en snake_case;
  //  el JS usa porcentajeIgic / cuotaIgic en camelCase)
  // ----------------------------------------------------------

  function _facturaDeBD(f) {
    if (!f) return null;
    const { porcentaje_igic, cuota_igic, retencion_irpf, cuota_irpf, forma_pago,
            estado_presupuesto, descripcion_evento, fecha_evento, ...resto } = f;
    return {
      ...resto,
      porcentajeIgic:    porcentaje_igic,
      cuotaIgic:         cuota_igic,
      retencionIrpf:     retencion_irpf     ?? 0,
      cuotaIrpf:         cuota_irpf         ?? 0,
      formaPago:         forma_pago         ?? 'efectivo',
      estadoPresupuesto: estado_presupuesto ?? null,
      descripcionEvento: descripcion_evento ?? '',
      fechaEvento:       fecha_evento       ?? null,
    };
  }

  function _facturaParaBD(f) {
    const { porcentajeIgic, cuotaIgic, retencionIrpf, cuotaIrpf, formaPago,
            estadoPresupuesto, descripcionEvento, fechaEvento, id, user_id, ...resto } = f;
    return {
      ...resto,
      porcentaje_igic:    porcentajeIgic    ?? 7,
      cuota_igic:         cuotaIgic         ?? 0,
      retencion_irpf:     retencionIrpf     ?? 0,
      cuota_irpf:         cuotaIrpf         ?? 0,
      forma_pago:         formaPago         ?? 'efectivo',
      estado_presupuesto: estadoPresupuesto ?? null,
      descripcion_evento: descripcionEvento ?? '',
      fecha_evento:       fechaEvento       ?? null,
    };
  }

  async function obtenerFacturas() {
    try {
      const datos = await _get('facturas', '?select=*&tipo=eq.factura&order=timestamp.desc').then(arr => (arr || []).map(_facturaDeBD));
      _CACHE.guardar('facturas', datos);
      return datos;
    } catch (e) {
      const cache = _CACHE.leer('facturas');
      if (_esRed(e) && cache !== null) return cache;
      throw e;
    }
  }
  async function obtenerPresupuestos() {
    try {
      const datos = await _get('facturas', '?select=*&tipo=eq.presupuesto&order=timestamp.desc').then(arr => (arr || []).map(_facturaDeBD));
      _CACHE.guardar('presupuestos', datos);
      return datos;
    } catch (e) {
      const cache = _CACHE.leer('presupuestos');
      if (_esRed(e) && cache !== null) return cache;
      throw e;
    }
  }
  async function obtenerFactura(id) {
    try { return await _get('facturas', `?id=eq.${id}&select=*`).then(arr => _facturaDeBD(_primero(arr))); }
    catch (e) {
      const cacheF = _CACHE.leer('facturas')    || [];
      const cacheP = _CACHE.leer('presupuestos') || [];
      const found  = [...cacheF, ...cacheP].find(f => f.id === id);
      if (_esRed(e) && found) return found;
      throw e;
    }
  }
  const guardarFactura      = (f)  => _sinColumnasNuevas({ ..._facturaParaBD(f), user_id: _uid() }, d => _post('facturas', d)).then(r => _facturaDeBD(_primero(r)));
  const actualizarFactura   = (f)  => _sinColumnasNuevas(_facturaParaBD(f), d => _patch('facturas', f.id, d)).then(r => _facturaDeBD(_primero(r)));
  const borrarFactura       = (id) => _delete('facturas', id);

  // Devuelve el mayor sufijo numérico de una lista de números (p.ej. "2026-0007" → 7).
  // Usamos el MÁXIMO (no el conteo) para no reutilizar números si se borra una factura.
  function _maxSufijo(arr) {
    return (arr || []).reduce((m, r) => {
      const partes = String(r.numero || '').split('-');
      const n = parseInt(partes[partes.length - 1], 10);
      return isFinite(n) && n > m ? n : m;
    }, 0);
  }

  // Siguiente número correlativo. Sin conexión se calcula con la copia local
  // (que incluye lo creado offline), para poder seguir facturando.
  async function _siguienteNumero(tipo, prefijo, anyo) {
    const filtroLocal = arr => (arr || []).filter(r => String(r.numero || '').startsWith(prefijo));
    let enServidor = null;
    try {
      enServidor = await _get('facturas', `?select=numero&tipo=eq.${tipo}&numero=like.${prefijo}%25`);
    } catch (e) {
      if (!_esRed(e)) throw e;
    }
    const local = filtroLocal(_CACHE.leer(tipo === 'presupuesto' ? 'presupuestos' : 'facturas'));
    const max   = Math.max(_maxSufijo(enServidor || []), _maxSufijo(local));
    return `${prefijo}${String(max + 1).padStart(4, '0')}`;
  }

  // El año del número sigue al año de la fecha de la factura (no al año actual).
  const _anyoDe = (fecha) => (/^\d{4}/.test(fecha || '') ? fecha.slice(0, 4) : String(new Date().getFullYear()));
  const siguienteNumeroFactura     = (fecha) => { const a = _anyoDe(fecha); return _siguienteNumero('factura',     `${a}-`,      a); };
  const siguienteNumeroPresupuesto = (fecha) => { const a = _anyoDe(fecha); return _siguienteNumero('presupuesto', `PRES-${a}-`, a); };

  /** true si `numero` es la última factura de su serie (solo esa se puede borrar sin dejar huecos). */
  async function esUltimaFactura(numero) {
    const partes = String(numero || '').split('-');
    const prefijo = partes.slice(0, -1).join('-') + '-';
    const sig = await _siguienteNumero('factura', prefijo, partes[0]);
    const n   = parseInt(partes[partes.length - 1], 10);
    return parseInt(sig.split('-').pop(), 10) === n + 1;
  }

  // ----------------------------------------------------------
  // BACKUP — exportar todo / restaurar todo
  // ----------------------------------------------------------

  async function exportarTodo() {
    const [prods, ings, platos, bebidas, todasFac, plantillas] = await Promise.all([
      _get('productos',    '?select=*&order=timestamp.desc'),
      _get('ingredientes', '?select=*&order=timestamp.desc'),
      _get('platos',       '?select=*&order=timestamp.desc'),
      _get('bebidas',      '?select=*&order=timestamp.desc'),
      _get('facturas',     '?select=*&order=timestamp.desc'),
      _get('plantillas_etiqueta', '?select=*').catch(() => []),
    ]);
    const strip = arr => (arr || []).map(({ user_id, ...r }) => r);
    return {
      plantillas:   strip(plantillas),   // formato BD (snake_case)
      productos:    strip(prods).map(_productoDeBD),
      ingredientes: strip(ings),
      platos:       strip(platos),
      bebidas:      strip(bebidas),
      facturas:     strip(todasFac).map(_facturaDeBD),
    };
  }

  async function restaurarDatos({ productos = [], ingredientes = [], platos = [], bebidas = [], facturas = [], plantillas = [] }) {
    const uid = _uid();
    if (!uid) throw new Error('Sesión no válida. Vuelve a iniciar sesión.');
    const hdrs  = _cab({ 'Prefer': 'return=minimal,resolution=merge-duplicates' });
    // Se conserva el id original (así restaurar dos veces actualiza en vez de duplicar)
    // y se asigna el usuario actual (la copia no lleva user_id).
    const conId = (orig, conv) => ({ ...(orig.id ? { id: orig.id } : {}), ...conv, user_id: uid });
    const upsert = async (tabla, arr) => {
      if (!arr.length) return;
      // PostgREST exige que todas las filas de un lote tengan las mismas columnas
      const claves = [...new Set(arr.flatMap(o => Object.keys(o)))];
      const filas  = arr.map(o => Object.fromEntries(claves.map(k => [k, o[k] ?? null]).filter(([, v]) => v !== null)));
      const grupos = {};
      for (const f of filas) (grupos[Object.keys(f).sort().join(',')] ??= []).push(f);
      for (const g of Object.values(grupos)) {
        await _sinColumnasNuevas(g[0], async (primera) => {
          const sinCol = Object.keys(g[0]).filter(k => !(k in primera));
          const lote   = sinCol.length ? g.map(f => { const c = { ...f }; sinCol.forEach(k => delete c[k]); return c; }) : g;
          return _req(`${tabla}?on_conflict=id`, { method: 'POST', headers: hdrs, body: JSON.stringify(lote) });
        });
      }
    };

    await upsert('productos',    productos.map(p => conId(p, _productoParaBD(p))));
    await upsert('ingredientes', ingredientes.map(i => conId(i, i)));
    await upsert('platos',       platos.map(p => conId(p, p)));
    await upsert('bebidas',      bebidas.map(b => conId(b, b)));
    await upsert('facturas',     facturas.map(f => conId(f, _facturaParaBD(f))));
    // Habituales: si ya existe uno con el mismo nombre (otro id), se conserva el actual
    try { await upsert('plantillas_etiqueta', plantillas.map(p => conId(p, p))); }
    catch (e) { console.warn('[SB] Algunos productos habituales no se restauraron (nombre repetido):', e); }
  }

  // ----------------------------------------------------------
  // BEBIDAS
  // ----------------------------------------------------------

  async function obtenerBebidas() {
    try {
      const datos = await _get('bebidas', '?select=*&order=timestamp.desc');
      _CACHE.guardar('bebidas', datos);
      return datos;
    } catch (e) {
      const cache = _CACHE.leer('bebidas');
      if (_esRed(e) && cache !== null) return cache;
      throw e;
    }
  }
  async function obtenerBebida(id) {
    try { return await _get('bebidas', `?id=eq.${id}&select=*`).then(_primero); }
    catch (e) {
      const cache = _CACHE.leer('bebidas');
      if (_esRed(e) && cache !== null) return cache.find(b => b.id === id) ?? null;
      throw e;
    }
  }
  const guardarBebida    = (d)  => _post('bebidas', { nombre: d.nombre, descripcion: d.descripcion ?? '', precio: d.precio ?? 0, categoria: d.categoria ?? 'otro', timestamp: Date.now(), user_id: _uid() }).then(_primero);
  const actualizarBebida = (d)  => _patch('bebidas', d.id, { nombre: d.nombre, descripcion: d.descripcion ?? '', precio: d.precio ?? 0, categoria: d.categoria ?? 'otro' }).then(_primero);
  const eliminarBebida   = (id) => _delete('bebidas', id);

  // ----------------------------------------------------------
  // CONFIGURACIÓN (empresa + impresora + logo, 1 fila por usuario)
  // localStorage sigue siendo la copia local rápida/offline; esto la sincroniza.
  // ----------------------------------------------------------

  async function obtenerConfigRemota() {
    const uid = _uid();
    if (!uid) return null;
    try {
      const arr = await _get('config', `?user_id=eq.${uid}&select=empresa,impresora,logo`);
      return _primero(arr);
    } catch { return null; }
  }

  async function guardarConfigRemota({ empresa, impresora, logo }) {
    const uid = _uid();
    if (!uid) return;
    const payload = {
      user_id:    uid,
      empresa:    empresa   ?? {},
      impresora:  impresora ?? {},
      logo:       logo      ?? null,
      updated_at: new Date().toISOString(),
    };
    return _req('config?on_conflict=user_id', {
      method:  'POST',
      headers: _cab({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body:    JSON.stringify(payload),
    });
  }

  // ----------------------------------------------------------
  // PUSH (suscripción del navegador para avisos de caducidad)
  // ----------------------------------------------------------

  async function guardarPushSub(sub) {
    const uid = _uid();
    if (!uid || !sub) return;
    const j = sub.toJSON ? sub.toJSON() : sub;
    if (!j.keys) return;
    return _req('push_subscriptions?on_conflict=endpoint', {
      method:  'POST',
      headers: _cab({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body:    JSON.stringify({ user_id: uid, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }),
    });
  }

  /** Da de baja un dispositivo de los avisos diarios (borra su suscripción en Supabase). */
  async function borrarPushSub(endpoint) {
    if (!endpoint) return;
    return _req(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE', headers: _cab({ 'Prefer': '' }) });
  }

  // ----------------------------------------------------------
  // INICIO: cargar sesión al arrancar el script
  // ----------------------------------------------------------
  _cargarSesion();

  return {
    // Auth
    isLoggedIn, tieneSesion, login, signup, logout, refrescarSesion, limpiarDatosLocales,
    // Productos (etiquetas)
    obtenerProductos, guardarProducto, actualizarProducto, eliminarProducto,
    // Productos habituales (plantillas de etiqueta)
    obtenerPlantillas, guardarPlantilla, actualizarPlantilla, eliminarPlantilla,
    // APPCC
    obtenerElementosAppcc, guardarElementoAppcc, actualizarElementoAppcc, eliminarElementoAppcc,
    obtenerRegistrosAppcc, guardarRegistroAppcc, eliminarRegistroAppcc,
    // Ingredientes
    obtenerIngredientes, obtenerIngrediente,
    guardarIngrediente, actualizarIngrediente, eliminarIngrediente,
    // Platos
    obtenerPlatos, obtenerPlato,
    guardarPlato, actualizarPlato, eliminarPlato,
    // Bebidas
    obtenerBebidas, obtenerBebida,
    guardarBebida, actualizarBebida, eliminarBebida,
    // Backup
    exportarTodo, restaurarDatos,
    // Configuración sincronizada
    obtenerConfigRemota, guardarConfigRemota,
    // Cola de escritura offline
    flushOutbox, pendientes, erroresSync, descartarErroresSync,
    // Push (avisos de caducidad)
    guardarPushSub, borrarPushSub,
    // Facturas y Presupuestos
    obtenerFacturas, obtenerPresupuestos, obtenerFactura,
    guardarFactura, actualizarFactura, borrarFactura,
    siguienteNumeroFactura, siguienteNumeroPresupuesto, esUltimaFactura
  };

})();
