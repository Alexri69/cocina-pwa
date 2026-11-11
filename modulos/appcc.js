// ============================================================
// modulos/appcc.js — Registros sanitarios (APPCC)
// Temperaturas de equipos de frío, limpieza, recepción de mercancía,
// aceite de fritura e informe mensual imprimible para la inspección.
// Depende de: core/supabase.js, core/voz.js (esc, aviso)
// ============================================================

const ModuloAppcc = (() => {

  const CLAVE_RESPONSABLE = 'cocina_appcc_responsable';
  const DIA = 86400000;

  // Límites orientativos de recepción por categoría (°C máximo admitido)
  const CATEGORIAS_RECEPCION = {
    refrigerado: { label: 'Refrigerado',  max: 4,   ayuda: '≤ 4 °C' },
    carne:       { label: 'Carne fresca', max: 7,   ayuda: '≤ 7 °C' },
    congelado:   { label: 'Congelado',    max: -15, ayuda: '≤ −18 °C (tolerancia −15 °C)' },
    ambiente:    { label: 'Ambiente',     max: null, ayuda: 'sin control de temperatura' },
  };

  const EJEMPLOS = [
    { tipo: 'temperatura', nombre: 'Cámara de refrigeración', zona: 'Cocina',  min: 0,    max: 4 },
    { tipo: 'temperatura', nombre: 'Nevera de partida',       zona: 'Cocina',  min: 0,    max: 4 },
    { tipo: 'temperatura', nombre: 'Congelador',              zona: 'Almacén', min: null, max: -18 },
    { tipo: 'freidora',    nombre: 'Freidora',                zona: 'Cocina',  min: null, max: 25 },
    { tipo: 'limpieza',    nombre: 'Superficies y tablas de corte', zona: 'Cocina',  frecuencia: 'diaria' },
    { tipo: 'limpieza',    nombre: 'Suelos',                        zona: 'Cocina',  frecuencia: 'diaria' },
    { tipo: 'limpieza',    nombre: 'Cámaras frigoríficas',          zona: 'Cocina',  frecuencia: 'semanal' },
    { tipo: 'limpieza',    nombre: 'Campana y filtros extractores', zona: 'Cocina',  frecuencia: 'semanal' },
    { tipo: 'limpieza',    nombre: 'Almacén y estanterías',         zona: 'Almacén', frecuencia: 'mensual' },
  ];

  const VISTAS = [
    ['hoy',         '<svg class="ic" aria-hidden="true"><use href="#i-list-checks"/></svg> Hoy'],
    ['temperatura', '<svg class="ic" aria-hidden="true"><use href="#i-thermometer"/></svg> Temperaturas'],
    ['limpieza',    '<svg class="ic" aria-hidden="true"><use href="#i-spray-can"/></svg> Limpieza'],
    ['recepcion',   '<svg class="ic" aria-hidden="true"><use href="#i-package"/></svg> Recepción'],
    ['freidora',    '<svg class="ic" aria-hidden="true"><use href="#i-droplets"/></svg> Aceite'],
    ['informe',     '<svg class="ic" aria-hidden="true"><use href="#i-file-text"/></svg> Informe'],
    ['ajustes',     '<svg class="ic" aria-hidden="true"><use href="#i-settings"/></svg> Equipos'],
  ];

  let _vista     = 'hoy';
  let _elementos = [];
  let _registros = [];   // últimos 40 días
  let _editando  = null; // elemento en edición (ajustes)

  // ----------------------------------------------------------
  // UTILIDADES
  // ----------------------------------------------------------

  const $ = id => document.getElementById(id);
  const inicioDia = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const hora  = iso => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const fecha = iso => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const num   = v => (v == null || v === '') ? null : Number(v);
  const fmt1  = v => (v == null ? '—' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 }));
  const unidad = tipo => tipo === 'freidora' ? '%' : '°C';

  function _responsable() { try { return localStorage.getItem(CLAVE_RESPONSABLE) || ''; } catch { return ''; } }

  function _exigirResponsable() {
    const r = ($('appcc-responsable')?.value || '').trim();
    if (!r) {
      aviso('Indica arriba quién hace el registro (responsable).', { tipo: 'error' });
      $('appcc-responsable')?.focus();
      return null;
    }
    try { localStorage.setItem(CLAVE_RESPONSABLE, r); } catch {}
    return r;
  }

  function _rangoTexto(el) {
    const u = unidad(el.tipo);
    const mn = num(el.min), mx = num(el.max);
    if (mn != null && mx != null) return `${fmt1(mn)} a ${fmt1(mx)} ${u}`;
    if (mx != null) return `≤ ${fmt1(mx)} ${u}`;
    if (mn != null) return `≥ ${fmt1(mn)} ${u}`;
    return 'sin límite';
  }

  function _enRango(el, v) {
    const mn = num(el.min), mx = num(el.max);
    return (mn == null || v >= mn) && (mx == null || v <= mx);
  }

  // ---- Frecuencias y modo de registro (cada restaurante según su plan APPCC) ----

  const FRECUENCIAS = {
    dos_al_dia: { label: '2 veces al día', veces: 2, dias: 0 },
    diaria:     { label: 'Diaria',         veces: 1, dias: 0 },
    semanal:    { label: 'Semanal',        veces: 1, dias: 7 },
    mensual:    { label: 'Mensual',        veces: 1, dias: 30 },
  };
  const _frec = el => FRECUENCIAS[el.frecuencia] || FRECUENCIAS.diaria;

  // 'completo' = se anota cada control · 'incidencias' = APPCC simplificado: solo lo que sale mal
  function modo() {
    try { return (typeof ModuloConfig !== 'undefined' && ModuloConfig.obtenerConfig().appccModo) || 'completo'; }
    catch { return 'completo'; }
  }
  const _porIncidencias = () => modo() === 'incidencias';
  // Propietario/encargado pueden configurar equipos y modo; la cocina solo registra
  const _gestiona = () => (typeof SB === 'undefined' || !SB.puedeGestionar) ? true : SB.puedeGestionar();

  // Registros del elemento dentro de su periodo actual (hoy, últimos 7 o 30 días)
  function _regsPeriodo(el) {
    const f = _frec(el);
    const desde = f.dias ? Date.now() - f.dias * DIA : inicioDia().getTime();
    return _registros.filter(r => r.elemento_id === el.id && new Date(r.fecha).getTime() >= desde);
  }
  /** Estado del control: { hechos, necesarios, cumplido, ultimo } */
  function _cumplimiento(el) {
    const regs = _regsPeriodo(el);
    const necesarios = _frec(el).veces;
    return { hechos: regs.length, necesarios, cumplido: regs.length >= necesarios, ultimo: regs[0] || null };
  }
  const _periodoLimpieza = el => _cumplimiento(el).cumplido ? _cumplimiento(el).ultimo : null;

  const _activos = tipo => _elementos.filter(e => e.tipo === tipo && e.activo !== false);
  const _periodicos = () => [..._activos('temperatura'), ..._activos('freidora'), ..._activos('limpieza')];

  /** Nº de controles pendientes (para el badge). En modo por incidencias no hay pendientes. */
  function pendientes() {
    if (_porIncidencias()) return 0;
    return _periodicos().reduce((n, el) => { const c = _cumplimiento(el); return n + Math.max(0, c.necesarios - c.hechos); }, 0);
  }

  function _actualizarBadge() {
    const n = pendientes();
    ['appcc-badge-nav', 'appcc-badge-bottom'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.textContent = n;
      el.style.display = n > 0 ? 'inline-block' : 'none';
    });
    const dash = $('dash-appcc-desc');
    if (dash) dash.textContent = !_elementos.length ? 'Temperaturas · Limpieza' : n ? `${n} control${n > 1 ? 'es' : ''} pendiente${n > 1 ? 's' : ''} hoy` : '✔ Todo registrado hoy';
  }

  // ----------------------------------------------------------
  // CARGA DE DATOS
  // ----------------------------------------------------------

  async function _cargar() {
    const desde = new Date(Date.now() - 40 * DIA).toISOString();
    const hasta = new Date(Date.now() + DIA).toISOString();
    const [els, regs] = await Promise.allSettled([SB.obtenerElementosAppcc(), SB.obtenerRegistrosAppcc(desde, hasta)]);
    if (els.status === 'fulfilled')  _elementos = els.value;  else console.warn('[APPCC] elementos:', els.reason);
    if (regs.status === 'fulfilled') _registros = regs.value; else console.warn('[APPCC] registros:', regs.reason);
    if (els.status === 'rejected' && regs.status === 'rejected') throw els.reason;
  }

  async function _guardarRegistro(reg) {
    const guardado = await SB.guardarRegistroAppcc(reg);
    _registros.unshift(guardado || reg);
    _actualizarBadge();
    return guardado;
  }

  // ----------------------------------------------------------
  // NAVEGACIÓN INTERNA
  // ----------------------------------------------------------

  function _irA(vista) {
    _vista = vista;
    document.querySelectorAll('#appcc-subnav .sub-tab').forEach(b => {
      const act = b.dataset.vista === vista;
      b.classList.toggle('activo', act);
      b.setAttribute('aria-selected', String(act));
    });
    _render();
  }

  function _render() {
    const cont = $('appcc-vista');
    if (!cont) return;
    const r = { hoy: _htmlHoy, temperatura: () => _htmlHistorial('temperatura'), freidora: () => _htmlHistorial('freidora'),
                limpieza: () => _htmlHistorial('limpieza'), recepcion: _htmlRecepcion, informe: _htmlInforme, ajustes: _htmlAjustes }[_vista];
    cont.innerHTML = r ? r() : '';
    if (_vista === 'ajustes') _prepararFormElemento();
    _actualizarBadge();
  }

  // ----------------------------------------------------------
  // VISTA: HOY (lista de control del día)
  // ----------------------------------------------------------

  function _htmlHoy() {
    if (!_elementos.length && !_gestiona()) {
      return `<div class="tarjeta appcc-vacio">
        <p><strong>Aún no hay equipos ni tareas de limpieza.</strong></p>
        <p>El propietario o el encargado del restaurante tiene que darlos de alta en APPCC → <svg class="ic" aria-hidden="true"><use href="#i-settings"/></svg> Equipos. Después aparecerán aquí para registrarlos.</p>
      </div>`;
    }
    if (!_elementos.length) {
      return `<div class="tarjeta appcc-vacio">
        <p><strong>Aún no hay equipos ni tareas de limpieza.</strong></p>
        <p>Añade tus cámaras, neveras, congeladores, freidoras y tareas de limpieza para llevar los registros que pide Sanidad.</p>
        <p><strong>¿Cómo lleva el restaurante el APPCC?</strong> (míralo en vuestro plan o pregúntalo al gestor)</p>
        ${_htmlSelectorModo()}
        <div class="form-acciones">
          <button class="btn btn-primario-sm" type="button" data-accion="ejemplos"><svg class="ic" aria-hidden="true"><use href="#i-sparkles"/></svg> Empezar con ejemplos</button>
          <button class="btn btn-secundario-sm" type="button" data-accion="ir-ajustes"><svg class="ic" aria-hidden="true"><use href="#i-settings"/></svg> Configurar a mano</button>
        </div>
      </div>`;
    }
    const incid = _porIncidencias();
    const total = _periodicos().reduce((n, el) => n + _frec(el).veces, 0);
    const pend  = pendientes();
    const hechos = total - pend;
    const pct = total ? Math.round(hechos / total * 100) : 100;
    const cuando = iso => fecha(iso) === fecha(new Date()) ? hora(iso) : `${fecha(iso)} ${hora(iso)}`;

    const bloqueEquipo = (el) => {
      const c = _cumplimiento(el);
      const ult = c.ultimo;
      const u = unidad(el.tipo);
      const veces = c.necesarios > 1 ? ` (${Math.min(c.hechos, c.necesarios)}/${c.necesarios})` : '';
      const estado = ult && c.cumplido
        ? `<span class="appcc-estado ${ult.correcto ? 'ok' : 'mal'}">${ult.correcto ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : '<svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg>'} ${fmt1(ult.valor)} ${u} · ${cuando(ult.fecha)}${ult.responsable ? ' · ' + esc(ult.responsable) : ''}${veces}</span>`
        : incid
          ? (ult ? `<span class="appcc-estado ${ult.correcto ? 'ok' : 'mal'}">${ult.correcto ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : '<svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg>'} ${fmt1(ult.valor)} ${u} · ${cuando(ult.fecha)}</span>` : `<span class="appcc-estado libre">Solo si hay incidencia</span>`)
          : `<span class="appcc-estado pend">Pendiente${veces}</span>`;
      const extraFreidora = el.tipo === 'freidora'
        ? `<label class="appcc-check"><input type="checkbox" data-cambio="${esc(el.id)}"> Aceite cambiado</label>` : '';
      return `<div class="appcc-item" data-id="${esc(el.id)}">
        <div class="appcc-item-cab">
          <div><strong>${esc(el.nombre)}</strong>${el.zona ? ` <small>· ${esc(el.zona)}</small>` : ''}
            <div class="appcc-rango">Rango: ${_rangoTexto(el)} · ${_frec(el).label}</div></div>
          ${estado}
        </div>
        <div class="appcc-item-form">
          ${el.tipo === 'freidora' ? '' : '<span class="inp-con-signo">'}<input class="inp appcc-valor" type="number" inputmode="decimal" step="0.1" placeholder="${el.tipo === 'freidora' ? '% polares' : '°C'}"
                 aria-label="${el.tipo === 'freidora' ? '% de compuestos polares' : 'Temperatura'} de ${esc(el.nombre)}" data-valor="${esc(el.id)}">${el.tipo === 'freidora' ? '' : BOTON_SIGNO + '</span>'}
          ${extraFreidora}
          <button class="btn btn-primario-sm" type="button" data-accion="registrar" data-id="${esc(el.id)}">${incid ? '<svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg> Anotar' : c.cumplido ? '<svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Otra lectura' : '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Registrar'}</button>
        </div>
        <div class="appcc-accion" data-accion-box="${esc(el.id)}" hidden>
          <label for="acc-${esc(el.id)}"><svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg> Fuera de rango: indica la acción correctora *</label>
          <textarea id="acc-${esc(el.id)}" class="inp" rows="2" placeholder="Ej.: Se revisa el cierre de la puerta, se trasladan los productos a otra cámara y se vuelve a medir en 1 h."></textarea>
        </div>
      </div>`;
    };

    const bloqueLimpieza = (el) => {
      const c = _cumplimiento(el);
      const hecho = c.cumplido ? c.ultimo : null;
      const veces = c.necesarios > 1 && !hecho ? ` (${c.hechos}/${c.necesarios})` : '';
      return `<div class="appcc-item appcc-limpieza ${hecho ? 'hecho' : ''}" data-id="${esc(el.id)}">
        <div class="appcc-item-cab">
          <div><strong>${esc(el.nombre)}</strong>${el.zona ? ` <small>· ${esc(el.zona)}</small>` : ''}
            <div class="appcc-rango">${_frec(el).label}</div></div>
          ${hecho
            ? `<span class="appcc-estado ok"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> ${fecha(hecho.fecha) === fecha(new Date()) ? 'Hoy' : fecha(hecho.fecha)} ${hora(hecho.fecha)}${hecho.responsable ? ' · ' + esc(hecho.responsable) : ''}</span>`
            : `<button class="btn btn-primario-sm" type="button" data-accion="limpieza" data-id="${esc(el.id)}"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Hecho${veces}</button>`}
        </div>
      </div>`;
    };

    const seccion = (titulo, lista, fn) => lista.length
      ? `<div class="tarjeta appcc-seccion"><div class="tarjeta-titulo">${titulo}</div>${lista.map(fn).join('')}</div>` : '';

    const resumen = incid
      ? `<div class="tarjeta appcc-resumen">
          <div class="appcc-resumen-txt">
            <strong><svg class="ic" aria-hidden="true"><use href="#i-notebook-pen"/></svg> Registro por incidencias</strong>
            <span>${capitalizar(new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
          </div>
          <p class="appcc-nota" style="margin:0">Solo hace falta anotar lo que salga mal (una temperatura fuera de rango, aceite pasado…), con su acción correctora. Puedes cambiar el modo en <svg class="ic" aria-hidden="true"><use href="#i-settings"/></svg> Equipos.</p>
        </div>`
      : `<div class="tarjeta appcc-resumen">
          <div class="appcc-resumen-txt">
            <strong>${pend ? `${pend} control${pend > 1 ? 'es' : ''} pendiente${pend > 1 ? 's' : ''}` : '✔ Todo registrado'}</strong>
            <span>${capitalizar(new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
          </div>
          <div class="appcc-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${hechos}" aria-label="Controles hechos">
            <div style="width:${pct}%"></div>
          </div>
        </div>`;

    return `
      ${resumen}
      ${seccion('<svg class="ic" aria-hidden="true"><use href="#i-thermometer"/></svg> Temperaturas de equipos', _activos('temperatura'), bloqueEquipo)}
      ${seccion('<svg class="ic" aria-hidden="true"><use href="#i-droplets"/></svg> Aceite de fritura', _activos('freidora'), bloqueEquipo)}
      ${seccion('<svg class="ic" aria-hidden="true"><use href="#i-spray-can"/></svg> Limpieza', _activos('limpieza'), bloqueLimpieza)}
      <p class="appcc-nota">La recepción de mercancía se registra en la pestaña <svg class="ic" aria-hidden="true"><use href="#i-package"/></svg> Recepción, cada vez que llega un pedido.</p>`;
  }

  async function _registrarLectura(id, boton) {
    const el = _elementos.find(e => e.id === id);
    if (!el) return;
    const inp = document.querySelector(`[data-valor="${CSS.escape(id)}"]`);
    const v = num(String(inp?.value ?? '').replace(',', '.'));
    if (v == null || !isFinite(v)) { aviso('Escribe el valor medido.', { tipo: 'error' }); inp?.focus(); return; }
    const responsable = _exigirResponsable();
    if (!responsable) return;

    const ok = _enRango(el, v);
    const caja = document.querySelector(`[data-accion-box="${CSS.escape(id)}"]`);
    const accion = (caja?.querySelector('textarea')?.value || '').trim();
    if (!ok && !accion) {
      // Fuera de rango: hace falta la acción correctora antes de guardar
      if (caja) { caja.hidden = false; caja.querySelector('textarea')?.focus(); }
      aviso(`${fmt1(v)} ${unidad(el.tipo)} está fuera de rango (${_rangoTexto(el)}). Anota la acción correctora y pulsa de nuevo.`, { tipo: 'error', ms: 7000 });
      if (boton) boton.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Guardar con acción correctora';
      return;
    }
    const cambio = el.tipo === 'freidora' && !!document.querySelector(`[data-cambio="${CSS.escape(id)}"]`)?.checked;
    if (boton) boton.disabled = true;
    try {
      await _guardarRegistro({
        tipo: el.tipo, elemento_id: el.id, elemento_nombre: el.nombre, valor: v, correcto: ok,
        accion_correctora: ok ? '' : accion, responsable, datos: el.tipo === 'freidora' ? { cambio_aceite: cambio } : {},
      });
      aviso(`✔ ${el.nombre}: ${fmt1(v)} ${unidad(el.tipo)} registrado.`, { tipo: ok ? 'ok' : 'info', ms: 2500 });
      _render();
    } catch (e) {
      aviso('No se pudo guardar: ' + e.message, { tipo: 'error' });
      if (boton) boton.disabled = false;
    }
  }

  async function _registrarLimpieza(id, boton) {
    const el = _elementos.find(e => e.id === id);
    if (!el) return;
    const responsable = _exigirResponsable();
    if (!responsable) return;
    if (boton) boton.disabled = true;
    try {
      await _guardarRegistro({ tipo: 'limpieza', elemento_id: el.id, elemento_nombre: el.nombre, correcto: true, responsable, datos: { zona: el.zona || '', frecuencia: el.frecuencia } });
      _render();
    } catch (e) {
      aviso('No se pudo guardar: ' + e.message, { tipo: 'error' });
      if (boton) boton.disabled = false;
    }
  }

  // ----------------------------------------------------------
  // VISTAS: HISTORIAL (temperaturas, aceite, limpieza)
  // ----------------------------------------------------------

  function _htmlFilaRegistro(r) {
    const borrable = Date.now() - new Date(r.fecha).getTime() < DIA;
    const d = r.datos || {};
    let detalle = '';
    if (r.tipo === 'temperatura') detalle = `${fmt1(r.valor)} °C`;
    if (r.tipo === 'freidora')    detalle = `${fmt1(r.valor)} % polares${d.cambio_aceite ? ' · <svg class="ic" aria-hidden="true"><use href="#i-refresh-cw"/></svg> aceite cambiado' : ''}`;
    if (r.tipo === 'limpieza')    detalle = 'Realizada';
    if (r.tipo === 'recepcion')   detalle = `${esc(d.proveedor || '')}${d.lote ? ' · Lote ' + esc(d.lote) : ''}${r.valor != null ? ' · ' + fmt1(r.valor) + ' °C' : ''} · ${d.aceptado === false ? '✖ Rechazada' : '✔ Aceptada'}`;
    const titulo = r.tipo === 'recepcion' ? (d.producto || 'Recepción') : r.elemento_nombre;
    return `<div class="appcc-reg ${r.correcto ? '' : 'mal'}">
      <div class="appcc-reg-cab">
        <span><strong>${esc(titulo || '')}</strong> — ${detalle}</span>
        <small>${fecha(r.fecha)} ${hora(r.fecha)}${r.responsable ? ' · ' + esc(r.responsable) : ''}</small>
      </div>
      ${r.accion_correctora ? `<div class="appcc-reg-accion"><svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg> Acción correctora: ${esc(r.accion_correctora)}</div>` : ''}
      ${borrable ? `<button class="btn-mini btn-borrar" type="button" data-accion="borrar-registro" data-id="${esc(r.id)}" aria-label="Eliminar registro (solo durante 24 h)" title="Se puede eliminar durante 24 h"><svg class="ic" aria-hidden="true"><use href="#i-trash-2"/></svg></button>` : ''}
    </div>`;
  }

  function _htmlHistorial(tipo) {
    const titulos = { temperatura: '<svg class="ic" aria-hidden="true"><use href="#i-thermometer"/></svg> Temperaturas', freidora: '<svg class="ic" aria-hidden="true"><use href="#i-droplets"/></svg> Aceite de fritura', limpieza: '<svg class="ic" aria-hidden="true"><use href="#i-spray-can"/></svg> Limpieza' };
    const lista = _registros.filter(r => r.tipo === tipo);
    const incid = lista.filter(r => !r.correcto).length;
    return `<div class="tarjeta">
      <div class="tarjeta-titulo">${titulos[tipo]} · últimos 40 días ${incid ? `<span class="appcc-incid">${incid} incidencia${incid > 1 ? 's' : ''}</span>` : ''}</div>
      ${lista.length ? lista.map(_htmlFilaRegistro).join('') : '<p class="texto-vacio">Sin registros todavía. Se apuntan desde la pestaña <svg class="ic" aria-hidden="true"><use href="#i-list-checks"/></svg> Hoy.</p>'}
      <p class="appcc-nota">Los registros solo se pueden eliminar durante las primeras 24 h (para corregir errores). Para meses anteriores usa <svg class="ic" aria-hidden="true"><use href="#i-file-text"/></svg> Informe.</p>
    </div>`;
  }

  // ----------------------------------------------------------
  // VISTA: RECEPCIÓN DE MERCANCÍA
  // ----------------------------------------------------------

  function _htmlRecepcion() {
    const opts = Object.entries(CATEGORIAS_RECEPCION).map(([k, c]) => `<option value="${k}">${c.label} (${c.ayuda})</option>`).join('');
    const lista = _registros.filter(r => r.tipo === 'recepcion');
    return `<div class="tarjeta">
      <div class="tarjeta-titulo"><svg class="ic" aria-hidden="true"><use href="#i-package"/></svg> Nueva recepción de mercancía</div>
      <div class="form-grid">
        <div class="form-grupo"><label for="rec-proveedor">Proveedor *</label><input id="rec-proveedor" class="inp" list="rec-proveedores" placeholder="Ej.: Frutas García"></div>
        <div class="form-grupo"><label for="rec-producto">Producto *</label><input id="rec-producto" class="inp" placeholder="Ej.: Pechuga de pollo"></div>
        <div class="form-grupo"><label for="rec-lote">Lote</label><input id="rec-lote" class="inp" placeholder="Ej.: L2405"></div>
        <div class="form-grupo"><label for="rec-categoria">Tipo de producto</label><select id="rec-categoria" class="inp">${opts}</select></div>
        <div class="form-grupo"><label for="rec-temp">Temperatura medida (°C)</label><span class="inp-con-signo"><input id="rec-temp" class="inp" type="number" inputmode="decimal" step="0.1" placeholder="Ej.: 3,5">${BOTON_SIGNO}</span></div>
        <div class="form-grupo form-grupo-full appcc-checks">
          <label class="appcc-check"><input type="checkbox" id="rec-envase" checked> Envase íntegro y limpio</label>
          <label class="appcc-check"><input type="checkbox" id="rec-etiquetado" checked> Etiquetado correcto (caducidad, lote, alérgenos)</label>
        </div>
        <div class="form-grupo form-grupo-full"><label for="rec-accion">Observaciones / acción correctora <small>(obligatorio si se rechaza o algo no está bien)</small></label>
          <textarea id="rec-accion" class="inp" rows="2" placeholder="Ej.: Llega a 9 °C, se rechaza y se devuelve al proveedor."></textarea></div>
      </div>
      <datalist id="rec-proveedores">${[...new Set(lista.map(r => r.datos?.proveedor).filter(Boolean))].map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="form-acciones">
        <button class="btn btn-primario-sm" type="button" data-accion="recepcion" data-aceptado="1"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Aceptar mercancía</button>
        <button class="btn btn-secundario-sm appcc-rechazar" type="button" data-accion="recepcion" data-aceptado="0"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg> Rechazar</button>
      </div>
    </div>
    <div class="tarjeta" style="margin-top:16px">
      <div class="tarjeta-titulo">Últimas recepciones</div>
      ${lista.length ? lista.map(_htmlFilaRegistro).join('') : '<p class="texto-vacio">Sin recepciones registradas.</p>'}
    </div>`;
  }

  async function _registrarRecepcion(aceptado, boton) {
    const val = id => ($(id)?.value || '').trim();
    const proveedor = val('rec-proveedor'), producto = val('rec-producto');
    if (!proveedor || !producto) { aviso('Indica el proveedor y el producto.', { tipo: 'error' }); (!proveedor ? $('rec-proveedor') : $('rec-producto'))?.focus(); return; }
    const responsable = _exigirResponsable();
    if (!responsable) return;
    const cat   = CATEGORIAS_RECEPCION[val('rec-categoria')] || CATEGORIAS_RECEPCION.ambiente;
    const temp  = num(val('rec-temp').replace(',', '.'));
    const envase = !!$('rec-envase')?.checked, etiq = !!$('rec-etiquetado')?.checked;
    const accion = val('rec-accion');
    const tempOk = cat.max == null || temp == null || temp <= cat.max;
    if (cat.max != null && temp == null) { aviso('Mide y escribe la temperatura del producto.', { tipo: 'error' }); $('rec-temp')?.focus(); return; }
    const correcto = aceptado && tempOk && envase && etiq;
    if (aceptado && !tempOk && !confirm(`La temperatura (${fmt1(temp)} °C) supera el límite para ${cat.label.toLowerCase()} (${cat.ayuda}).\n\n¿Aceptar la mercancía de todas formas?`)) return;
    if (!correcto && !accion) { aviso('Anota la acción correctora u observación (p. ej. "devuelto al proveedor").', { tipo: 'error', ms: 6000 }); $('rec-accion')?.focus(); return; }
    if (boton) boton.disabled = true;
    try {
      await _guardarRegistro({
        tipo: 'recepcion', elemento_nombre: proveedor, valor: temp, correcto, accion_correctora: accion, responsable,
        datos: { proveedor, producto, lote: val('rec-lote'), categoria: val('rec-categoria'), envase_ok: envase, etiquetado_ok: etiq, aceptado },
      });
      aviso(`✔ Recepción de ${producto} ${aceptado ? 'aceptada' : 'rechazada'}.`, { tipo: 'ok', ms: 2500 });
      _render();
    } catch (e) {
      aviso('No se pudo guardar: ' + e.message, { tipo: 'error' });
      if (boton) boton.disabled = false;
    }
  }

  // ----------------------------------------------------------
  // VISTA: INFORME MENSUAL
  // ----------------------------------------------------------

  function _htmlInforme() {
    const d = new Date();
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `<div class="tarjeta">
      <div class="tarjeta-titulo"><svg class="ic" aria-hidden="true"><use href="#i-file-text"/></svg> Informe mensual para la inspección</div>
      <div class="form-grid">
        <div class="form-grupo"><label for="inf-mes">Mes</label><input id="inf-mes" type="month" class="inp" value="${mes}" max="${mes}"></div>
        <div class="form-grupo"><label for="inf-tipo">Registros</label>
          <select id="inf-tipo" class="inp">
            <option value="todos">Todos</option>
            <option value="temperatura">Temperaturas</option>
            <option value="freidora">Aceite de fritura</option>
            <option value="limpieza">Limpieza</option>
            <option value="recepcion">Recepción de mercancía</option>
          </select></div>
      </div>
      <div class="form-acciones">
        <button class="btn btn-primario-sm" type="button" data-accion="informe"><svg class="ic" aria-hidden="true"><use href="#i-printer"/></svg> Generar informe</button>
      </div>
      <p class="appcc-nota">Se abre listo para imprimir o guardar como PDF (en el diálogo de impresión elige «Guardar como PDF»).</p>
    </div>`;
  }

  async function _generarInforme(boton) {
    const mes  = $('inf-mes')?.value;
    const tipo = $('inf-tipo')?.value || 'todos';
    if (!/^\d{4}-\d{2}$/.test(mes || '')) { aviso('Elige un mes.', { tipo: 'error' }); return; }
    const [a, m] = mes.split('-').map(Number);
    const desde = new Date(a, m - 1, 1), hasta = new Date(a, m, 1);
    // Abrir la ventana ya (si se abre tras esperar a la red, el navegador la bloquea)
    const win = window.open('', '_blank', 'width=1000,height=900');
    if (!win) { alert('El navegador bloqueó la ventana emergente.\nPermite ventanas emergentes para esta página.'); return; }
    win.document.write('<p style="font-family:Arial;padding:24px">Generando informe…</p>');
    if (boton) boton.disabled = true;
    let regs;
    try {
      regs = await SB.obtenerRegistrosAppcc(desde.toISOString(), hasta.toISOString());
    } catch (e) {
      win.close();
      aviso('No se pudo generar el informe: ' + e.message, { tipo: 'error' });
      return;
    } finally { if (boton) boton.disabled = false; }

    regs = regs.slice().sort((x, y) => new Date(x.fecha) - new Date(y.fecha));
    const cfg = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const nombreMes = desde.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    const diasMes = new Date(a, m, 0).getDate();
    const hoyN = (a === new Date().getFullYear() && m === new Date().getMonth() + 1) ? new Date().getDate() : diasMes;
    const E = s => esc(s ?? '');
    const estado = r => r.correcto ? '<span class="ok">Correcto</span>' : '<span class="mal">Incidencia</span>';

    // Días sin lectura por equipo (autocontrol)
    const huecos = (tipoEq) => _elementos.filter(e => e.tipo === tipoEq && e.activo !== false).map(e => {
      const dias = new Set(regs.filter(r => r.elemento_id === e.id).map(r => new Date(r.fecha).getDate()));
      // Contar solo desde que el equipo se dio de alta (no son "huecos" los días previos)
      const alta = new Date(Number(e.timestamp) || 0);
      if (alta >= hasta) return '';
      const primerDia = alta >= desde ? alta.getDate() : 1;
      const faltan = []; for (let dd = primerDia; dd <= hoyN; dd++) if (!dias.has(dd)) faltan.push(dd);
      return faltan.length ? `<li><strong>${E(e.nombre)}</strong>: sin registro los días ${faltan.join(', ')}</li>` : '';
    }).join('');

    const tabla = (titulo, cab, filas, extra = '') => `
      <section><h2>${titulo}</h2>
      ${filas.length ? `<table><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.join('')}</tbody></table>` : '<p class="vacio">Sin registros en este mes.</p>'}
      ${extra}</section>`;

    const del = t => regs.filter(r => r.tipo === t);
    const secciones = [];
    if (tipo === 'todos' || tipo === 'temperatura') {
      const h = _porIncidencias() ? '' : huecos('temperatura');
      secciones.push(tabla('Control de temperaturas de equipos', ['Fecha', 'Hora', 'Equipo', 'Temperatura', 'Límite', 'Estado', 'Acción correctora', 'Responsable'],
        del('temperatura').map(r => { const el = _elementos.find(e => e.id === r.elemento_id); return `<tr class="${r.correcto ? '' : 'fila-mal'}"><td>${fecha(r.fecha)}</td><td>${hora(r.fecha)}</td><td>${E(r.elemento_nombre)}</td><td class="n">${fmt1(r.valor)} °C</td><td>${el ? _rangoTexto(el) : '—'}</td><td>${estado(r)}</td><td>${E(r.accion_correctora)}</td><td>${E(r.responsable)}</td></tr>`; }),
        h ? `<div class="huecos"><strong>Días sin registro:</strong><ul>${h}</ul></div>` : ''));
    }
    if (tipo === 'todos' || tipo === 'freidora') {
      secciones.push(tabla('Control del aceite de fritura', ['Fecha', 'Hora', 'Freidora', '% compuestos polares', 'Cambio de aceite', 'Estado', 'Acción correctora', 'Responsable'],
        del('freidora').map(r => `<tr class="${r.correcto ? '' : 'fila-mal'}"><td>${fecha(r.fecha)}</td><td>${hora(r.fecha)}</td><td>${E(r.elemento_nombre)}</td><td class="n">${fmt1(r.valor)} %</td><td>${r.datos?.cambio_aceite ? 'Sí' : 'No'}</td><td>${estado(r)}</td><td>${E(r.accion_correctora)}</td><td>${E(r.responsable)}</td></tr>`)));
    }
    if (tipo === 'todos' || tipo === 'limpieza') {
      secciones.push(tabla('Registro de limpieza y desinfección', ['Fecha', 'Hora', 'Tarea', 'Zona', 'Frecuencia', 'Responsable'],
        del('limpieza').map(r => `<tr><td>${fecha(r.fecha)}</td><td>${hora(r.fecha)}</td><td>${E(r.elemento_nombre)}</td><td>${E(r.datos?.zona)}</td><td>${E(r.datos?.frecuencia)}</td><td>${E(r.responsable)}</td></tr>`)));
    }
    if (tipo === 'todos' || tipo === 'recepcion') {
      secciones.push(tabla('Recepción de mercancía', ['Fecha', 'Hora', 'Proveedor', 'Producto', 'Lote', 'Temp.', 'Envase', 'Etiquetado', 'Resultado', 'Observaciones', 'Responsable'],
        del('recepcion').map(r => { const d = r.datos || {}; return `<tr class="${r.correcto ? '' : 'fila-mal'}"><td>${fecha(r.fecha)}</td><td>${hora(r.fecha)}</td><td>${E(d.proveedor)}</td><td>${E(d.producto)}</td><td>${E(d.lote)}</td><td class="n">${r.valor != null ? fmt1(r.valor) + ' °C' : '—'}</td><td>${d.envase_ok ? 'Correcto' : 'Deficiente'}</td><td>${d.etiquetado_ok ? 'Correcto' : 'Deficiente'}</td><td>${d.aceptado === false ? '<span class="mal">Rechazada</span>' : 'Aceptada'}</td><td>${E(r.accion_correctora)}</td><td>${E(r.responsable)}</td></tr>`; })));
    }
    const incid = regs.filter(r => !r.correcto && (tipo === 'todos' || r.tipo === tipo)).length;
    const dir = [cfg.direccion, cfg.cp, cfg.ciudad, cfg.provincia].filter(Boolean).join(', ');

    win.document.open();
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>APPCC ${E(nombreMes)} — ${E(cfg.razonSocial || 'Cocina')}</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 9.5pt; margin: 0; }
header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
h1 { font-size: 15pt; margin: 0 0 2px; } h2 { font-size: 11.5pt; margin: 18px 0 6px; }
.emp { font-size: 9pt; color: #333; text-align: right; }
.resumen { font-size: 9.5pt; margin: 4px 0 8px; }
table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #999; padding: 3px 5px; text-align: left; vertical-align: top; }
th { background: #eee; font-size: 8.5pt; }
td.n { text-align: right; white-space: nowrap; }
.ok { color: #14532d; } .mal { color: #991b1b; font-weight: 700; }
.fila-mal td { background: #fef2f2; }
.vacio { color: #555; font-style: italic; }
.huecos { margin-top: 6px; font-size: 9pt; } .huecos ul { margin: 2px 0 0 18px; padding: 0; }
.firma { margin-top: 28px; display: flex; gap: 40px; font-size: 9.5pt; }
.firma div { flex: 1; border-top: 1px solid #111; padding-top: 4px; }
.pie { margin-top: 10px; font-size: 8pt; color: #555; }
.modo { margin-top: 4px; font-size: 9pt; color: #333; }
@media screen { body { padding: 16px; } }
</style></head><body>
<header>
  <div><h1>Registros de autocontrol (APPCC)</h1><div>${E(nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1))}${tipo !== 'todos' ? ' · ' + E($('inf-tipo')?.selectedOptions[0]?.textContent) : ''}</div>
    <div class="modo">${_porIncidencias() ? 'Sistema de registro <strong>por incidencias</strong> (APPCC simplificado): solo se anotan las desviaciones y sus acciones correctoras.' : 'Sistema de registro completo: se anota cada control según la frecuencia establecida.'}</div></div>
  <div class="emp"><strong>${E(cfg.razonSocial || 'Establecimiento')}</strong>${cfg.nif ? '<br>NIF/CIF: ' + E(cfg.nif) : ''}${dir ? '<br>' + E(dir) : ''}</div>
</header>
<div class="resumen">${regs.filter(r => tipo === 'todos' || r.tipo === tipo).length} registros · ${incid ? `<span class="mal">${incid} incidencia${incid > 1 ? 's' : ''} con acción correctora</span>` : 'sin incidencias'} · Generado el ${new Date().toLocaleString('es-ES')}</div>
${secciones.join('')}
<div class="firma"><div>Firma del responsable del autocontrol</div><div>Fecha de revisión</div></div>
<p class="pie">Reglamento (CE) 852/2004 relativo a la higiene de los productos alimenticios · Registro generado con Cocina.</p>
<script>setTimeout(function(){ window.print(); }, 400);<\/script>
</body></html>`);
    win.document.close();
  }

  // ----------------------------------------------------------
  // VISTA: EQUIPOS Y TAREAS (ajustes)
  // ----------------------------------------------------------

  function _htmlAjustes() {
    const grupo = (tipo, titulo) => {
      const lista = _elementos.filter(e => e.tipo === tipo);
      return `<div class="appcc-ajustes-grupo"><h3>${titulo}</h3>
        ${lista.length ? lista.map(e => `<div class="appcc-ajuste ${e.activo === false ? 'inactivo' : ''}">
          <span><strong>${esc(e.nombre)}</strong>${e.zona ? ' · ' + esc(e.zona) : ''}
            <small>${tipo === 'limpieza' ? '' : _rangoTexto(e) + ' · '}${_frec(e).label}${e.activo === false ? ' · desactivado' : ''}</small></span>
          <span class="card-acciones">
            <button class="btn-mini btn-editar" type="button" data-accion="editar-elemento" data-id="${esc(e.id)}"><svg class="ic" aria-hidden="true"><use href="#i-pencil"/></svg> Editar</button>
            <button class="btn-mini btn-borrar" type="button" data-accion="borrar-elemento" data-id="${esc(e.id)}" aria-label="Eliminar ${esc(e.nombre)}"><svg class="ic" aria-hidden="true"><use href="#i-trash-2"/></svg></button>
          </span></div>`).join('') : '<p class="texto-vacio">Ninguno.</p>'}
      </div>`;
    };
    return `<div class="tarjeta">
      <div class="tarjeta-titulo"><svg class="ic" aria-hidden="true"><use href="#i-clipboard"/></svg> Modo de registro</div>
      ${_htmlSelectorModo()}
    </div>
    <div class="tarjeta" style="margin-top:16px">
      <div class="tarjeta-titulo" id="appcc-el-titulo">${_editando ? '<svg class="ic" aria-hidden="true"><use href="#i-pencil"/></svg> Editar' : '<svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Añadir equipo o tarea'}</div>
      <div class="form-grid">
        <div class="form-grupo"><label for="el-tipo">Tipo</label>
          <select id="el-tipo" class="inp">
            <option value="temperatura">🌡 Equipo de frío (temperatura)</option>
            <option value="freidora">🍟 Freidora (aceite)</option>
            <option value="limpieza">🧽 Tarea de limpieza</option>
          </select></div>
        <div class="form-grupo"><label for="el-nombre">Nombre *</label><input id="el-nombre" class="inp" placeholder="Ej.: Cámara de pescado"></div>
        <div class="form-grupo"><label for="el-zona">Zona</label><input id="el-zona" class="inp" placeholder="Ej.: Cocina, Almacén, Barra"></div>
        <div class="form-grupo el-rango"><label for="el-min">Mínimo <span class="el-u">°C</span></label><span class="inp-con-signo"><input id="el-min" class="inp" type="number" inputmode="decimal" step="0.1" placeholder="Opcional">${BOTON_SIGNO}</span></div>
        <div class="form-grupo el-rango"><label for="el-max">Máximo <span class="el-u">°C</span></label><span class="inp-con-signo"><input id="el-max" class="inp" type="number" inputmode="decimal" step="0.1" placeholder="Ej.: 4">${BOTON_SIGNO}</span></div>
        <div class="form-grupo el-frec"><label for="el-frecuencia">Frecuencia</label>
          <select id="el-frecuencia" class="inp">${Object.entries(FRECUENCIAS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('')}</select></div>
        <div class="form-grupo"><label class="appcc-check" style="margin-top:26px"><input type="checkbox" id="el-activo" checked> Activo</label></div>
      </div>
      <div class="form-acciones">
        <button class="btn btn-primario-sm" type="button" data-accion="guardar-elemento"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Guardar</button>
        ${_editando ? '<button class="btn btn-secundario-sm" type="button" data-accion="cancelar-elemento"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg> Cancelar</button>' : ''}
        ${!_elementos.length ? '<button class="btn btn-secundario-sm" type="button" data-accion="ejemplos"><svg class="ic" aria-hidden="true"><use href="#i-sparkles"/></svg> Añadir ejemplos</button>' : ''}
      </div>
      <p class="appcc-nota">Referencias habituales: refrigeración 0 a 4 °C · congelación ≤ −18 °C · aceite de fritura ≤ 25 % de compuestos polares. Ajusta los rangos a tu plan APPCC.</p>
    </div>
    <div class="tarjeta" style="margin-top:16px">
      ${grupo('temperatura', '<svg class="ic" aria-hidden="true"><use href="#i-thermometer"/></svg> Equipos de frío')}
      ${grupo('freidora', '<svg class="ic" aria-hidden="true"><use href="#i-droplets"/></svg> Freidoras')}
      ${grupo('limpieza', '<svg class="ic" aria-hidden="true"><use href="#i-spray-can"/></svg> Tareas de limpieza')}
    </div>`;
  }

  function _htmlSelectorModo() {
    const m = modo();
    return `<div class="appcc-modos" role="radiogroup" aria-label="Modo de registro APPCC">
      <label class="appcc-modo ${m === 'completo' ? 'activo' : ''}"><input type="radio" name="appcc-modo" value="completo" ${m === 'completo' ? 'checked' : ''}>
        <span><strong>Registro completo</strong><small>Se anota cada control (temperaturas, aceite, limpieza) con su frecuencia. La app avisa de lo pendiente.</small></span></label>
      <label class="appcc-modo ${m === 'incidencias' ? 'activo' : ''}"><input type="radio" name="appcc-modo" value="incidencias" ${m === 'incidencias' ? 'checked' : ''}>
        <span><strong>Solo incidencias</strong><small>APPCC simplificado: solo se anota lo que sale mal y su acción correctora. Sin avisos de pendientes.</small></span></label>
    </div>`;
  }

  function _cambiarModo(valor) {
    if (valor !== 'completo' && valor !== 'incidencias') return;
    if (typeof ModuloConfig !== 'undefined' && ModuloConfig.guardarAjuste) ModuloConfig.guardarAjuste('appccModo', valor);
    aviso(valor === 'incidencias' ? '📝 Modo por incidencias activado.' : '✔ Modo de registro completo activado.', { tipo: 'ok', ms: 2500 });
    _render();
  }

  function _prepararFormElemento() {
    const e = _editando;
    if (e) {
      $('el-tipo').value = e.tipo; $('el-nombre').value = e.nombre; $('el-zona').value = e.zona || '';
      $('el-min').value = e.min ?? ''; $('el-max').value = e.max ?? ''; $('el-frecuencia').value = e.frecuencia || 'diaria';
      $('el-activo').checked = e.activo !== false;
    }
    _ajustarCamposTipo();
    $('el-tipo')?.addEventListener('change', _ajustarCamposTipo);
  }

  function _ajustarCamposTipo() {
    const t = $('el-tipo')?.value;
    document.querySelectorAll('.el-rango').forEach(x => x.style.display = t === 'limpieza' ? 'none' : '');
    document.querySelectorAll('.el-u').forEach(x => x.textContent = t === 'freidora' ? '% polares' : '°C');
    if (t === 'freidora' && !$('el-max').value && !_editando) $('el-max').value = 25;
    if (!_editando && $('el-frecuencia')) $('el-frecuencia').value = 'diaria';
  }

  async function _guardarElemento(boton) {
    const datos = {
      tipo: $('el-tipo').value, nombre: $('el-nombre').value.trim(), zona: $('el-zona').value.trim(),
      min: $('el-min').value, max: $('el-max').value, frecuencia: $('el-frecuencia').value, activo: $('el-activo').checked,
    };
    if (!datos.nombre) { aviso('Escribe un nombre.', { tipo: 'error' }); $('el-nombre').focus(); return; }
    if (datos.tipo === 'limpieza') { datos.min = null; datos.max = null; }
    else if (datos.min !== '' && datos.max !== '' && Number(datos.min) > Number(datos.max)) { aviso('El mínimo no puede ser mayor que el máximo.', { tipo: 'error' }); return; }
    if (boton) boton.disabled = true;
    try {
      if (_editando) {
        const act = await SB.actualizarElementoAppcc({ id: _editando.id, ...datos });
        Object.assign(_editando, act || datos);
      } else {
        const nuevo = await SB.guardarElementoAppcc({ ...datos, orden: _elementos.length });
        _elementos.push(nuevo || datos);
      }
      _editando = null;
      aviso('✔ Guardado.', { tipo: 'ok', ms: 2000 });
      _render();
    } catch (e) {
      aviso('No se pudo guardar: ' + e.message, { tipo: 'error' });
      if (boton) boton.disabled = false;
    }
  }

  async function _borrarElemento(id) {
    const e = _elementos.find(x => x.id === id);
    if (!e) return;
    if (!confirm(`¿Eliminar "${e.nombre}"?\n\nLos registros ya hechos se conservan (con su nombre). Si solo quieres dejar de controlarlo un tiempo, edítalo y desmarca «Activo».`)) return;
    try {
      await SB.eliminarElementoAppcc(id);
      _elementos = _elementos.filter(x => x.id !== id);
      if (_editando?.id === id) _editando = null;
      _render();
    } catch (err) { aviso('No se pudo eliminar: ' + err.message, { tipo: 'error' }); }
  }

  async function _crearEjemplos(boton) {
    if (boton) boton.disabled = true;
    try {
      for (const [i, e] of EJEMPLOS.entries()) {
        const nuevo = await SB.guardarElementoAppcc({ ...e, orden: i });
        _elementos.push(nuevo || e);
      }
      aviso('✔ Ejemplos añadidos. Revisa nombres y rangos en ⚙ Equipos.', { tipo: 'ok', ms: 5000 });
      _irA('hoy');
    } catch (e) {
      aviso('No se pudieron crear los ejemplos: ' + e.message, { tipo: 'error' });
      if (boton) boton.disabled = false;
    }
  }

  async function _borrarRegistro(id) {
    const r = _registros.find(x => x.id === id);
    if (!r) return;
    if (Date.now() - new Date(r.fecha).getTime() >= DIA) { aviso('Solo se pueden eliminar registros de las últimas 24 h.', { tipo: 'error' }); return; }
    if (!confirm(`¿Eliminar este registro de ${r.elemento_nombre || r.tipo} (${fecha(r.fecha)} ${hora(r.fecha)})?\n\nHazlo solo para corregir un error.`)) return;
    try {
      await SB.eliminarRegistroAppcc(id);
      _registros = _registros.filter(x => x.id !== id);
      _render();
    } catch (e) { aviso('No se pudo eliminar: ' + e.message, { tipo: 'error' }); }
  }

  // ----------------------------------------------------------
  // INICIALIZACIÓN
  // ----------------------------------------------------------

  async function init() {
    const nav = $('appcc-subnav');
    // El personal de cocina registra, pero no configura equipos ni el modo
    if (nav) nav.innerHTML = VISTAS.filter(([v]) => v !== 'ajustes' || _gestiona()).map(([v, t]) =>
      `<button class="sub-tab${v === _vista ? ' activo' : ''}" type="button" role="tab" aria-selected="${v === _vista}" data-vista="${v}">${t}</button>`).join('');
    nav?.addEventListener('click', e => { const b = e.target.closest('[data-vista]'); if (b) _irA(b.dataset.vista); });

    const resp = $('appcc-responsable');
    if (resp) {
      resp.value = _responsable();
      resp.addEventListener('change', () => { try { localStorage.setItem(CLAVE_RESPONSABLE, resp.value.trim()); } catch {} });
    }

    // Un único gestor de clics para toda la vista (los botones se repintan a menudo)
    $('appcc-vista')?.addEventListener('click', e => {
      const b = e.target.closest('[data-accion]');
      if (!b) return;
      const id = b.dataset.id;
      switch (b.dataset.accion) {
        case 'registrar':         _registrarLectura(id, b); break;
        case 'limpieza':          _registrarLimpieza(id, b); break;
        case 'recepcion':         _registrarRecepcion(b.dataset.aceptado === '1', b); break;
        case 'informe':           _generarInforme(b); break;
        case 'ejemplos':          _crearEjemplos(b); break;
        case 'ir-ajustes':        _irA('ajustes'); break;
        case 'guardar-elemento':  _guardarElemento(b); break;
        case 'cancelar-elemento': _editando = null; _render(); break;
        case 'editar-elemento':   _editando = _elementos.find(x => x.id === id) || null; _render(); $('el-nombre')?.focus(); break;
        case 'borrar-elemento':   _borrarElemento(id); break;
        case 'borrar-registro':   _borrarRegistro(id); break;
      }
    });
    $('appcc-vista')?.addEventListener('change', e => {
      if (e.target.name === 'appcc-modo') _cambiarModo(e.target.value);
    });
    // Enter en el campo de valor = registrar
    $('appcc-vista')?.addEventListener('keydown', e => {
      const inp = e.target.closest('[data-valor]');
      if (inp && e.key === 'Enter') { e.preventDefault(); _registrarLectura(inp.dataset.valor, document.querySelector(`[data-accion="registrar"][data-id="${CSS.escape(inp.dataset.valor)}"]`)); }
    });

    try { await _cargar(); }
    catch (e) { console.warn('[APPCC] No se pudieron cargar los registros:', e); }
    _render();
    // Al cambiar de día con la app abierta, refrescar la lista de "Hoy"
    setInterval(() => { if (_vista === 'hoy') _render(); else _actualizarBadge(); }, 5 * 60 * 1000);
  }

  return { init, pendientes };

})();
