// ============================================================
// core/bd.js — Base de datos IndexedDB compartida (v2)
// Centraliza todas las operaciones de lectura y escritura.
// Todos los módulos (etiquetas, menú, facturas) usan este archivo.
// ============================================================

// Objeto global BD: namespace para todas las funciones de base de datos.
// Uso: await BD.guardarPlato({...}), await BD.obtenerFacturas(), etc.
const BD = (() => {

  const NOMBRE  = 'CocinaDB';
  const VERSION = 2; // v1 tenía solo 'productos'; v2 añade ingredientes, platos y facturas

  let _db = null; // Conexión activa reutilizada por todas las operaciones

  // ----------------------------------------------------------
  // APERTURA / MIGRACIÓN
  // ----------------------------------------------------------

  /**
   * Abre la base de datos y ejecuta migraciones si es necesario.
   * Debe llamarse UNA VEZ al arrancar la app (en app.js).
   */
  function abrirBaseDeDatos() {
    return new Promise((ok, err) => {
      const req = indexedDB.open(NOMBRE, VERSION);

      req.onupgradeneeded = (e) => {
        const db  = e.target.result;
        const old = e.oldVersion; // 0 = instalación nueva, 1 = actualización desde v1

        // ---- Store: productos (existía en v1) ----
        if (old < 1 && !db.objectStoreNames.contains('productos')) {
          const s = db.createObjectStore('productos', { keyPath: 'id', autoIncrement: true });
          s.createIndex('idx_timestamp', 'timestamp', { unique: false });
        }

        // ---- Nuevos stores en v2 ----
        if (old < 2) {
          // Ingredientes: nombre + array de alérgenos que contiene
          if (!db.objectStoreNames.contains('ingredientes')) {
            const s = db.createObjectStore('ingredientes', { keyPath: 'id', autoIncrement: true });
            s.createIndex('idx_nombre', 'nombre', { unique: false });
          }

          // Platos: nombre, descripción, precio, ingredientes[] y alérgenos calculados
          if (!db.objectStoreNames.contains('platos')) {
            const s = db.createObjectStore('platos', { keyPath: 'id', autoIncrement: true });
            s.createIndex('idx_nombre', 'nombre', { unique: false });
          }

          // Facturas: cabecera + líneas + totales
          if (!db.objectStoreNames.contains('facturas')) {
            const s = db.createObjectStore('facturas', { keyPath: 'id', autoIncrement: true });
            s.createIndex('idx_numero',    'numero',    { unique: false });
            s.createIndex('idx_timestamp', 'timestamp', { unique: false });
          }
        }
      };

      req.onsuccess = (e) => { _db = e.target.result; ok(_db); };
      req.onerror   = ()  => err(req.error);
    });
  }

  // ----------------------------------------------------------
  // UTILIDAD INTERNA: transacción genérica
  // ----------------------------------------------------------

  /** Devuelve una promesa con el resultado de la operación sobre el store. */
  function _run(store, modo, fn) {
    return new Promise((ok, err) => {
      const tx  = _db.transaction([store], modo);
      const obj = tx.objectStore(store);
      const req = fn(obj);
      req.onsuccess = () => ok(req.result);
      req.onerror   = () => err(req.error);
    });
  }

  /** Lee todos los registros de un store, del más reciente al más antiguo. */
  function _leerTodos(store, limite = 200) {
    return new Promise((ok, err) => {
      const tx    = _db.transaction([store], 'readonly');
      const obj   = tx.objectStore(store);
      // Si el store tiene índice timestamp lo usamos para ordenar; si no, openCursor normal
      const tiene = obj.indexNames.contains('idx_timestamp');
      const req   = tiene
        ? obj.index('idx_timestamp').openCursor(null, 'prev')
        : obj.openCursor(null, 'prev');
      const lista = [];
      req.onsuccess = (e) => {
        const c = e.target.result;
        if (c && lista.length < limite) { lista.push(c.value); c.continue(); }
        else ok(lista);
      };
      req.onerror = () => err(req.error);
    });
  }

  /** Lee un registro por su ID. */
  function _leerPorId(store, id) {
    return _run(store, 'readonly', (obj) => obj.get(id));
  }

  /** Inserta un registro. */
  function _insertar(store, dato) {
    return _run(store, 'readwrite', (obj) => obj.add(dato));
  }

  /** Actualiza un registro existente (debe incluir el campo 'id'). */
  function _actualizar(store, dato) {
    return _run(store, 'readwrite', (obj) => obj.put(dato));
  }

  /** Elimina un registro por su ID. */
  function _eliminar(store, id) {
    return _run(store, 'readwrite', (obj) => obj.delete(id));
  }

  // ----------------------------------------------------------
  // MÓDULO: PRODUCTOS (etiquetas de recipientes abiertos)
  // ----------------------------------------------------------

  const guardarProducto  = (p) => _insertar('productos', p);
  const obtenerProductos = ()  => _leerTodos('productos', 20);

  // ----------------------------------------------------------
  // MÓDULO: INGREDIENTES
  // ----------------------------------------------------------

  const guardarIngrediente   = (ing)     => _insertar('ingredientes', { ...ing, timestamp: Date.now() });
  const actualizarIngrediente= (ing)     => _actualizar('ingredientes', ing);
  const eliminarIngrediente  = (id)      => _eliminar('ingredientes', id);
  const obtenerIngredientes  = ()        => _leerTodos('ingredientes', 500);
  const obtenerIngrediente   = (id)      => _leerPorId('ingredientes', id);

  // ----------------------------------------------------------
  // MÓDULO: PLATOS (recetas/carta)
  // ----------------------------------------------------------

  const guardarPlato   = (plato) => _insertar('platos', { ...plato, timestamp: Date.now() });
  const actualizarPlato= (plato) => _actualizar('platos', plato);
  const eliminarPlato  = (id)    => _eliminar('platos', id);
  const obtenerPlatos  = ()      => _leerTodos('platos', 200);
  const obtenerPlato   = (id)    => _leerPorId('platos', id);

  // ----------------------------------------------------------
  // MÓDULO: FACTURAS
  // ----------------------------------------------------------

  const guardarFactura   = (f) => _insertar('facturas', { ...f, timestamp: Date.now() });
  const actualizarFactura= (f) => _actualizar('facturas', f);
  const obtenerFacturas  = ()  => _leerTodos('facturas', 200);
  const obtenerFactura   = (id)=> _leerPorId('facturas', id);

  /**
   * Genera el siguiente número de factura en formato AAAA-NNNN.
   * Cuenta las facturas del año en curso y añade 1.
   */
  async function siguienteNumeroFactura() {
    const todas  = await obtenerFacturas();
    const anyo   = new Date().getFullYear();
    const esteAnyo = todas.filter(f => f.numero && f.numero.startsWith(String(anyo)));
    const siguiente = esteAnyo.length + 1;
    return `${anyo}-${String(siguiente).padStart(4, '0')}`;
  }

  const borrarFactura = (id) => _eliminar('facturas', id);

  // ----------------------------------------------------------
  // API PÚBLICA
  // ----------------------------------------------------------
  return {
    abrirBaseDeDatos,
    // Productos
    guardarProducto, obtenerProductos,
    // Ingredientes
    guardarIngrediente, actualizarIngrediente, eliminarIngrediente,
    obtenerIngredientes, obtenerIngrediente,
    // Platos
    guardarPlato, actualizarPlato, eliminarPlato,
    obtenerPlatos, obtenerPlato,
    // Facturas
    guardarFactura, actualizarFactura, borrarFactura,
    obtenerFacturas, obtenerFactura,
    siguienteNumeroFactura
  };

})();
