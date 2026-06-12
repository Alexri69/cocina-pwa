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
    let res;
    try {
      res = await fetch(`${BASE}/rest/v1/${ruta}`, opciones);
    } catch (err) {
      throw new Error('Sin conexión o error de red. Comprueba tu conexión a internet.');
    }

    // Si el token expiró, intentamos refrescarlo una vez y reintentamos
    if (res.status === 401) {
      const ok = await refrescarSesion();
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
  const _CACHE_MAP  = { productos: _productoDeBD, facturas: _facturaDeBD };

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

  // Reintenta las escrituras pendientes (al volver la conexión / al iniciar).
  async function flushOutbox() {
    if (!navigator.onLine) return;
    const q = _outboxLeer();
    if (!q.length) return;
    const restantes = [];
    for (const op of q) {
      try {
        if (op.metodo === 'POST')
          await _req(`${op.tabla}?on_conflict=id`, { method: 'POST', headers: _cab({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(op.datos) });
        else if (op.metodo === 'PATCH')
          await _req(`${op.tabla}?id=eq.${op.id}`, { method: 'PATCH', headers: _cab({ 'Prefer': 'return=minimal' }), body: JSON.stringify(op.datos) });
        else if (op.metodo === 'DELETE')
          await _req(`${op.tabla}?id=eq.${op.id}`, { method: 'DELETE', headers: _cab({ 'Prefer': '' }) });
      } catch (e) {
        if (_esRed(e)) restantes.push(op); // sigue sin conexión → reintentar luego
        // otros errores (conflicto/validación) se descartan para no atascar la cola
      }
    }
    _outboxEscribir(restantes);
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
      if (cache !== null) return cache;
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
        if (ok) {
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
  // INGREDIENTES
  // ----------------------------------------------------------

  async function obtenerIngredientes() {
    try {
      const datos = await _get('ingredientes', '?select=*&order=timestamp.desc');
      _CACHE.guardar('ingredientes', datos);
      return datos;
    } catch (e) {
      const cache = _CACHE.leer('ingredientes');
      if (cache !== null) return cache;
      throw e;
    }
  }
  async function obtenerIngrediente(id) {
    try { return await _get('ingredientes', `?id=eq.${id}&select=*`).then(_primero); }
    catch (e) {
      const cache = _CACHE.leer('ingredientes');
      if (cache !== null) return cache.find(i => i.id === id) ?? null;
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
      if (cache !== null) return cache;
      throw e;
    }
  }
  async function obtenerPlato(id) {
    try { return await _get('platos', `?id=eq.${id}&select=*`).then(_primero); }
    catch (e) {
      const cache = _CACHE.leer('platos');
      if (cache !== null) return cache.find(p => p.id === id) ?? null;
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
      if (cache !== null) return cache;
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
      if (cache !== null) return cache;
      throw e;
    }
  }
  async function obtenerFactura(id) {
    try { return await _get('facturas', `?id=eq.${id}&select=*`).then(arr => _facturaDeBD(_primero(arr))); }
    catch (e) {
      const cacheF = _CACHE.leer('facturas')    || [];
      const cacheP = _CACHE.leer('presupuestos') || [];
      const found  = [...cacheF, ...cacheP].find(f => f.id === id);
      if (found) return found;
      throw e;
    }
  }
  const guardarFactura      = (f)  => _post('facturas', { ..._facturaParaBD(f), user_id: _uid() }).then(r => _facturaDeBD(_primero(r)));
  const actualizarFactura   = (f)  => _patch('facturas', f.id, _facturaParaBD(f)).then(r => _facturaDeBD(_primero(r)));
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

  async function siguienteNumeroFactura() {
    const anyo = new Date().getFullYear();
    const res  = await _get('facturas', `?select=numero&tipo=eq.factura&numero=like.${anyo}-%25`);
    return `${anyo}-${String(_maxSufijo(res) + 1).padStart(4, '0')}`;
  }

  async function siguienteNumeroPresupuesto() {
    const anyo = new Date().getFullYear();
    const res  = await _get('facturas', `?select=numero&tipo=eq.presupuesto&numero=like.PRES-${anyo}-%25`);
    return `PRES-${anyo}-${String(_maxSufijo(res) + 1).padStart(4, '0')}`;
  }

  // ----------------------------------------------------------
  // BACKUP — exportar todo / restaurar todo
  // ----------------------------------------------------------

  async function exportarTodo() {
    const [prods, ings, platos, bebidas, todasFac] = await Promise.all([
      _get('productos',    '?select=*&order=timestamp.desc'),
      _get('ingredientes', '?select=*&order=timestamp.desc'),
      _get('platos',       '?select=*&order=timestamp.desc'),
      _get('bebidas',      '?select=*&order=timestamp.desc'),
      _get('facturas',     '?select=*&order=timestamp.desc'),
    ]);
    const strip = arr => (arr || []).map(({ user_id, ...r }) => r);
    return {
      productos:    strip(prods).map(_productoDeBD),
      ingredientes: strip(ings),
      platos:       strip(platos),
      bebidas:      strip(bebidas),
      facturas:     strip(todasFac).map(_facturaDeBD),
    };
  }

  async function restaurarDatos({ productos = [], ingredientes = [], platos = [], bebidas = [], facturas = [] }) {
    const hdrs  = _cab({ 'Prefer': 'return=minimal,resolution=merge-duplicates' });
    const upsert = (tabla, arr) => arr.length
      ? _req(tabla, { method: 'POST', headers: hdrs, body: JSON.stringify(arr) })
      : Promise.resolve();

    // Facturas: convertir de camelCase a snake_case conservando el id original
    const facSnake = facturas.map(f => {
      const { id } = f;
      const conv   = _facturaParaBD(f);
      return id ? { id, ...conv } : conv;
    });

    await upsert('productos',    productos.map(_productoParaBD));
    await upsert('ingredientes', ingredientes);
    await upsert('platos',       platos);
    await upsert('bebidas',      bebidas);
    await upsert('facturas',     facSnake);
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
      if (cache !== null) return cache;
      throw e;
    }
  }
  async function obtenerBebida(id) {
    try { return await _get('bebidas', `?id=eq.${id}&select=*`).then(_primero); }
    catch (e) {
      const cache = _CACHE.leer('bebidas');
      if (cache !== null) return cache.find(b => b.id === id) ?? null;
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
  // INICIO: cargar sesión al arrancar el script
  // ----------------------------------------------------------
  _cargarSesion();

  return {
    // Auth
    isLoggedIn, login, signup, logout, refrescarSesion,
    // Productos (etiquetas)
    obtenerProductos, guardarProducto, actualizarProducto, eliminarProducto,
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
    flushOutbox, pendientes,
    // Facturas y Presupuestos
    obtenerFacturas, obtenerPresupuestos, obtenerFactura,
    guardarFactura, actualizarFactura, borrarFactura,
    siguienteNumeroFactura, siguienteNumeroPresupuesto
  };

})();
