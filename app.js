// ============================================================
// app.js — Coordinador principal de la PWA Cocina
// ============================================================

// ---- Service Worker ----
if ('serviceWorker' in navigator) {
  // Si ya había un SW controlando la página, un SW nuevo = versión nueva de la app.
  // En vez de recargar a la fuerza (se perdería lo que se esté escribiendo), se avisa.
  const _habiaControlador = !!navigator.serviceWorker.controller;
  let _avisoVersionMostrado = false;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo !== 'SW_ACTUALIZADO' || !_habiaControlador || _avisoVersionMostrado) return;
    _avisoVersionMostrado = true;
    aviso('Hay una versión nueva de la app.', {
      ms: 0,
      accion: { texto: 'Actualizar', fn: () => location.reload() }
    });
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./trabajador.js')
      .catch(e => console.error('[App] SW error:', e));
  });
}

// ---- Tema claro / oscuro ----

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  localStorage.setItem('cocina_tema', tema);
  const btn = document.getElementById('btn-tema');
  if (btn) btn.innerHTML = icono(tema === 'oscuro' ? 'moon' : 'sun');
}

function _toggleTema() {
  const actual = document.documentElement.getAttribute('data-tema') || 'oscuro';
  aplicarTema(actual === 'oscuro' ? 'claro' : 'oscuro');
}

// ---- Navegación entre módulos ----

let _moduloActivo = null;

// Módulos que no ve el camarero (además de facturas, que es solo de gestión)
const _SIN_CAMARERO = ['etiquetas', 'pedidos', 'facturas'];

function navegarA(id, { historial = true } = {}) {
  if (typeof SB !== 'undefined' && SB.rol() === 'camarero' && _SIN_CAMARERO.includes(id)) id = 'dashboard';
  if (historial && _moduloActivo && id !== _moduloActivo) {
    Navegacion.olvidar();
    try { history.pushState({ m: id }, ''); } catch {}
  }
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
  if (btnTema) btnTema.innerHTML = icono(temaActual === 'oscuro' ? 'moon' : 'sun');

  // Autenticar (bloquea hasta que el login sea correcto)
  await ModuloAuth.init();

  // Restaurante activo (crear o unirse si es la primera vez). Los datos van por restaurante.
  await ModuloEquipo.iniciar();

  // Sincronizar escrituras que quedaran pendientes de una sesión offline anterior
  SB.flushOutbox();

  // Navegar al módulo correcto inmediatamente para evitar parpadeo
  // Acceso directo del icono (manifest shortcuts): ?m=etiquetas|facturas|…
  const _mParam = new URLSearchParams(location.search).get('m');
  let _destino = _mParam || sessionStorage.getItem('moduloActivo') || 'dashboard';
  if (_destino === 'facturas' && !SB.puedeGestionar()) _destino = 'dashboard';
  try { history.replaceState({ m: _destino }, ''); } catch {}
  navegarA(_destino, { historial: false });
  // Botón "atrás": primero cierra el formulario abierto; si no hay, vuelve al módulo anterior
  window.addEventListener('popstate', (e) => {
    if (Navegacion._alPulsarAtras(e)) return;
    navegarA(e.state?.m || 'dashboard', { historial: false });
  });

  // Inicializar módulos en paralelo (son independientes). Si uno falla, el resto arranca igual.
  const modulos = { ModuloConfig, ModuloEquipo, ModuloEtiquetas, ModuloAppcc, ModuloMenu, ModuloBebidas, ModuloCartaQR, ModuloPedidos, ModuloJornada };
  // El camarero no usa etiquetas ni pedidos
  if (SB.rol() === 'camarero') { delete modulos.ModuloEtiquetas; delete modulos.ModuloPedidos; }
  // Facturas solo para propietario y encargado
  if (SB.puedeGestionar()) modulos.ModuloFacturas = ModuloFacturas;
  const res = await Promise.allSettled(Object.values(modulos).map(m => m.init()));
  res.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[App] Error iniciando ${Object.keys(modulos)[i]}:`, r.reason);
      aviso('Algunos datos no se han podido cargar: ' + (r.reason?.message || r.reason), { tipo: 'error', ms: 7000 });
    }
  });

  // Cambios guardados sin conexión que el servidor rechazó al sincronizar
  _avisarErroresSync();

  // Estado de conexión inicial
  _actualizarBannerOffline();

  // Comprobar caducidades y mostrar alertas
  await _comprobarCaducidades();

  // Botón de tema en cabecera
  document.getElementById('btn-tema')?.addEventListener('click', _toggleTema);

  // Búsqueda global
  document.getElementById('btn-buscar')    ?.addEventListener('click', _abrirBusqueda);
  document.getElementById('busqueda-cerrar')?.addEventListener('click', _cerrarBusqueda);
  document.getElementById('busqueda-overlay')?.addEventListener('click', e => { if (e.target.id === 'busqueda-overlay') _cerrarBusqueda(); });
  document.getElementById('busqueda-inp')  ?.addEventListener('input', e => _ejecutarBusqueda(e.target.value));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _cerrarBusqueda(); });

  // Pestañas de navegación (header + barra inferior móvil)
  document.querySelectorAll('.nav-tab, .nav-bottom-tab').forEach(btn => {
    btn.addEventListener('click', () => navegarA(btn.dataset.modulo));
  });
});

// ---- Banner offline + indicador de conexión ----

function _actualizarBannerOffline() {
  const pend   = (typeof SB !== 'undefined' && SB.pendientes) ? SB.pendientes() : 0;
  const banner = document.getElementById('offline-banner');
  if (banner) banner.style.display = (navigator.onLine && !pend) ? 'none' : 'block';

  const dot = document.getElementById('ind-conexion');
  if (dot) {
    dot.classList.toggle('online',  navigator.onLine);
    dot.classList.toggle('offline', !navigator.onLine);
    dot.title       = navigator.onLine
      ? (pend ? `Conectado · ${pend} cambio(s) sincronizando…` : 'Conectado')
      : (pend ? `Sin conexión · ${pend} cambio(s) en cola` : 'Sin conexión');
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', dot.title);
    dot.textContent = '●';
  }
}

window.addEventListener('online',  _actualizarBannerOffline);
window.addEventListener('offline', _actualizarBannerOffline);
// El outbox avisa de cambios pendientes (al encolar o al sincronizar)
window.addEventListener('cocina:pendientes', _actualizarBannerOffline);
window.addEventListener('cocina:errores-sync', () => _avisarErroresSync());

// ---- Cambios que no se pudieron sincronizar ----

function _describirOp(op) {
  const nombres = { productos: 'Etiqueta', ingredientes: 'Ingrediente', platos: 'Plato', bebidas: 'Bebida', facturas: 'Factura/presupuesto' };
  const accion  = { POST: 'crear', PATCH: 'modificar', DELETE: 'eliminar' }[op.metodo] || op.metodo;
  const que     = op.datos?.nombre || op.datos?.numero || op.datos?.cliente || op.id || '';
  return `${nombres[op.tabla] || op.tabla} (${accion}) ${que}`.trim();
}

function _avisarErroresSync() {
  const errores = SB.erroresSync();
  if (!errores.length) return;
  aviso(`${errores.length} cambio(s) hechos sin conexión no se pudieron guardar en el servidor.`, {
    tipo: 'error', ms: 0,
    accion: {
      texto: 'Ver',
      fn: () => {
        const lista = errores.map(e => '• ' + _describirOp(e) + '\n   Motivo: ' + e.error).join('\n');
        if (confirm(`Estos cambios no se guardaron:\n\n${lista}\n\nRevísalos y vuelve a hacerlos si hace falta.\n\n¿Quitar este aviso?`)) {
          SB.descartarErroresSync();
        } else {
          _avisarErroresSync();
        }
      }
    }
  });
}

// ---- Búsqueda global ----

function _abrirBusqueda() {
  const ov = document.getElementById('busqueda-overlay');
  if (ov) { ov.style.display = 'flex'; document.getElementById('busqueda-inp')?.focus(); }
}

function _cerrarBusqueda() {
  const ov = document.getElementById('busqueda-overlay');
  if (ov) { ov.style.display = 'none'; document.getElementById('busqueda-inp').value = ''; }
  document.getElementById('busqueda-resultados').innerHTML = '';
}

async function _ejecutarBusqueda(q) {
  const res = document.getElementById('busqueda-resultados');
  if (!res) return;
  q = q.trim().toLowerCase();
  if (!q) { res.innerHTML = ''; return; }

  try {
    const [platos, bebidas, ings] = await Promise.all([
      SB.obtenerPlatos(), SB.obtenerBebidas(), SB.obtenerIngredientes()
    ]);

    const _item = (icono, tipo, accion, i) =>
      `<div class="busq-item" onclick="${accion}">
        <span>${icono}</span>
        <span>${esc(i.nombre)}${i.precio > 0 ? ' · ' + dinero(i.precio) + ' €' : ''}</span>
        <span class="busq-tipo">${tipo}</span>
      </div>`;

    const filtrar = (arr, icono, tipo, accionFn) =>
      (arr || []).filter(i => i.nombre.toLowerCase().includes(q))
        .map(i => _item(icono, tipo, accionFn(i), i)).join('');

    const html = filtrar(platos,  '<svg class="ic" aria-hidden="true"><use href="#i-utensils"/></svg>', 'Plato',       i => `navegarA('menu');ModuloMenu.editarPlato('${i.id}');_cerrarBusqueda()`)
               + filtrar(bebidas, '<svg class="ic" aria-hidden="true"><use href="#i-cup-soda"/></svg>', 'Bebida',      i => `navegarA('bebidas');ModuloBebidas.editarBebida('${i.id}');_cerrarBusqueda()`)
               + filtrar(ings,    '<svg class="ic" aria-hidden="true"><use href="#i-carrot"/></svg>', 'Ingrediente', i => `navegarA('menu');ModuloMenu.editarIngrediente('${i.id}');_cerrarBusqueda()`);

    res.innerHTML = html || '<p style="padding:16px;color:var(--texto2);text-align:center">Sin resultados para "' + esc(q) + '"</p>';
  } catch (e) {
    res.innerHTML = '<p style="padding:16px;color:var(--err)">Error al buscar</p>';
  }
}

// ---- Push (avisos de caducidad con la app cerrada) ----

const VAPID_PUBLIC = 'BKoaTqsQojA_4KBvSSzp-niYxJCzn1XA8kxM_1lL0NjWstWSx-POT315ma3J1Fv6FjFzBpyVWz6jlrBvBrr0KWQ';

function _b64ToU8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const s   = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const a = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i);
  return a;
}

// Devuelve true si el dispositivo quedó registrado en Supabase para recibir avisos.
async function _suscribirPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToU8(VAPID_PUBLIC) });
    await SB.guardarPushSub(sub);
    return true;
  } catch (e) { console.warn('[App] No se pudo suscribir a push:', e); return false; }
}

// ---- Alertas de caducidad ----

async function _comprobarCaducidades() {
  // Si ya hay permiso, registra este dispositivo para recibir avisos aunque la app esté cerrada
  // (salvo que el usuario los haya desactivado con el botón de Etiquetas)
  if (ModuloEtiquetas.avisosActivos()) _suscribirPush();
  try {
    const { caducados, proximos } = await ModuloEtiquetas.verificarCaducidades();
    const total = caducados.length + proximos.length;

    _actualizarBadgeEtiquetas(total);
    _renderAlertasDashboard(caducados, proximos);

    // Pedir permiso solo la primera vez (si aún no se ha decidido) y nunca si se desactivaron
    if (total > 0 && 'Notification' in window && Notification.permission === 'default') {
      if (await Notification.requestPermission() === 'granted') _suscribirPush();
    }
    // Un único aviso resumen y solo de productos nuevos (no se repite en cada apertura)
    if (total > 0) ModuloEtiquetas.revisarYAvisar();
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
      `<div class="dash-alerta-item rojo"><svg class="ic ic-err" aria-hidden="true"><use href="#i-circle-x"/></svg><span><strong>${esc(p.nombre)}</strong> · Lote ${esc(p.lote)} · <em>caducado</em></span></div>`),
    ...proximos.map(p =>
      `<div class="dash-alerta-item amarillo"><svg class="ic ic-warn" aria-hidden="true"><use href="#i-clock-alert"/></svg><span><strong>${esc(p.nombre)}</strong> · Lote ${esc(p.lote)} · caduca el ${VOZ.formatearFechaSolo(p.fechaCaducidad)}</span></div>`),
  ].join('');
  cont.style.display = 'block';
}
