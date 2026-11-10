// ============================================================
// modulos/pedidos.js — Proveedores y pedidos
//   · Proveedores: los gestionan propietario y encargado; todo el equipo los ve.
//   · Pedidos: cualquiera del equipo los prepara y los envía por WhatsApp o email.
//   · Al recibirlo, la dirección puede actualizar los precios de compra
//     (y con ellos los escandallos de la carta).
// Depende de: core/supabase.js, core/voz.js (esc, aviso, dinero, Navegacion)
// ============================================================

const ModuloPedidos = (() => {

  const UNIDADES = ['kg', 'g', 'l', 'ud', 'caja', 'docena', 'bandeja', 'saco', 'garrafa', 'barril'];
  const ESTADOS = { borrador: 'Borrador', enviado: 'Enviado', recibido: 'Recibido' };
  const $ = id => document.getElementById(id);

  let _proveedores = [], _pedidos = [], _ingredientes = [], _costes = new Map();
  let _vista = 'pedidos';            // pestaña: pedidos | proveedores
  let _pedidoEdit = null;            // pedido en el formulario (null = nuevo)
  let _provEdit = null;              // proveedor en el formulario
  let _lineas = [];                  // líneas del formulario de pedido

  // ----------------------------------------------------------
  // FUNCIONES PURAS (se prueban aparte)
  // ----------------------------------------------------------

  /** Número para wa.me: solo cifras con prefijo de país (España por defecto). '' si no vale. */
  function telefonoWhatsApp(tel) {
    let d = String(tel || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+')) d = d.slice(1);
    else if (d.startsWith('00')) d = d.slice(2);
    else if (/^[6789]\d{8}$/.test(d)) d = '34' + d;
    return /^\d{10,15}$/.test(d) ? d : '';
  }

  const _cant = n => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 3 });

  /** Texto del pedido para WhatsApp o email. */
  function textoPedido(p, { restaurante = '', contacto = '' } = {}) {
    const lineas = (p.lineas || []).filter(l => Number(l.cantidad) > 0 && String(l.nombre || '').trim());
    const entrega = p.entrega ? `\nEntrega: ${VOZ.formatearFechaSolo(p.entrega)}` : '';
    return [
      `Hola${contacto ? ' ' + contacto : ''}, pedido${restaurante ? ' de ' + restaurante : ''}:${entrega}`,
      '',
      ...lineas.map(l => `• ${_cant(l.cantidad)} ${l.unidad || 'ud'} de ${String(l.nombre).trim()}`),
      ...(p.notas ? ['', `Notas: ${p.notas}`] : []),
      '',
      'Gracias.',
    ].join('\n');
  }

  // ----------------------------------------------------------
  // DATOS
  // ----------------------------------------------------------

  async function _cargar() {
    const [provs, peds, ings, costes] = await Promise.all([
      SB.obtenerProveedores(), SB.obtenerPedidos(), SB.obtenerIngredientes().catch(() => []), SB.obtenerCostes().catch(() => []),
    ]);
    _proveedores = (provs || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    _pedidos = peds || [];
    _ingredientes = (ings || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    _costes = new Map((costes || []).filter(c => c.tipo === 'ingrediente').map(c => [c.id, c]));
  }
  const _prov = id => _proveedores.find(p => p.id === id);
  const _restaurante = () => {
    const cfg = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    return cfg.razonSocial || SB.restauranteActivo()?.nombre || '';
  };

  // ----------------------------------------------------------
  // VISTAS
  // ----------------------------------------------------------

  function _mostrar(cual) {
    ['ped-vista-lista', 'ped-vista-form', 'ped-vista-recibir', 'prov-vista-lista', 'prov-vista-form'].forEach(id => {
      const el = $(id); if (el) el.hidden = id !== cual;
    });
    if (cual === 'ped-vista-lista' || cual === 'prov-vista-lista') Navegacion.cerrada();
    else Navegacion.abrir(() => _irA(_vista));
    window.scrollTo(0, 0);
  }

  function _irA(vista) {
    _vista = vista;
    document.querySelectorAll('#modulo-pedidos .sub-tab[data-ped]').forEach(b => b.classList.toggle('activo', b.dataset.ped === vista));
    if (vista === 'proveedores') { _pintarProveedores(); _mostrar('prov-vista-lista'); }
    else { _pintarPedidos(); _mostrar('ped-vista-lista'); }
  }

  // ---------- Lista de pedidos ----------
  function _pintarPedidos() {
    const cont = $('ped-lista');
    if (!cont) return;
    if (!_pedidos.length) {
      cont.innerHTML = `<p class="texto-vacio">Aún no hay pedidos.${_proveedores.length ? '' : ' Empieza añadiendo tus proveedores en la pestaña «Proveedores».'}</p>`;
      return;
    }
    cont.innerHTML = _pedidos.map(p => {
      const n = (p.lineas || []).length;
      const f = new Date(p.fecha);
      return `<div class="card-plato ped-card" data-id="${esc(p.id)}">
        <div class="card-plato-cabecera">
          <div class="card-plato-nombre">${esc(p.proveedor_nombre || _prov(p.proveedor_id)?.nombre || 'Sin proveedor')}</div>
          <span class="ped-estado ${esc(p.estado)}">${ESTADOS[p.estado] || esc(p.estado)}</span>
        </div>
        <div class="card-plato-desc">${f.toLocaleDateString('es-ES')} · ${n} producto${n === 1 ? '' : 's'}${p.entrega ? ' · entrega ' + VOZ.formatearFechaSolo(p.entrega) : ''}${p.autor ? ' · ' + esc(p.autor) : ''}</div>
        <div class="ped-resumen">${esc((p.lineas || []).slice(0, 4).map(l => `${_cant(l.cantidad)} ${l.unidad} ${l.nombre}`).join(' · '))}${n > 4 ? '…' : ''}</div>
        <div class="card-acciones">
          ${p.estado !== 'recibido' ? `<button class="btn-mini btn-editar" type="button" data-pa="editar"><svg class="ic" aria-hidden="true"><use href="#i-pencil"/></svg> ${p.estado === 'borrador' ? 'Seguir' : 'Ver'}</button>` : ''}
          ${p.estado === 'enviado' ? `<button class="btn-mini btn-pagar" type="button" data-pa="recibir"><svg class="ic" aria-hidden="true"><use href="#i-package"/></svg> Recibido</button>` : ''}
          <button class="btn-mini" type="button" data-pa="repetir"><svg class="ic" aria-hidden="true"><use href="#i-copy"/></svg> Repetir</button>
          <button class="btn-mini btn-borrar" type="button" data-pa="borrar" aria-label="Eliminar pedido"><svg class="ic" aria-hidden="true"><use href="#i-trash-2"/></svg></button>
        </div>
      </div>`;
    }).join('');
  }

  // ---------- Formulario de pedido ----------
  function _abrirPedido(p = null, { copiar = false } = {}) {
    _pedidoEdit = copiar ? null : p;
    _lineas = p ? (p.lineas || []).map(l => ({ ...l })) : [];
    $('ped-form-titulo').textContent = !p || copiar ? 'Nuevo pedido' : `Pedido del ${new Date(p.fecha).toLocaleDateString('es-ES')}`;
    const sel = $('ped-proveedor');
    sel.innerHTML = '<option value="">— Elige proveedor —</option>' + _proveedores.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('') + '<option value="otro">Otro (escribir nombre)</option>';
    sel.value = p?.proveedor_id && _prov(p.proveedor_id) ? p.proveedor_id : (p ? 'otro' : (_proveedores.length === 1 ? _proveedores[0].id : ''));
    $('ped-proveedor-otro').value = p && !_prov(p.proveedor_id) ? (p.proveedor_nombre || '') : '';
    $('ped-entrega').value = copiar ? '' : (p?.entrega || '');
    $('ped-notas').value = p?.notas || '';
    _cambioProveedor(!p);
    _mostrar('ped-vista-form');
  }

  // Al elegir proveedor: sus ingredientes aparecen para poner cantidades
  function _cambioProveedor(rellenar = true) {
    const id = $('ped-proveedor').value;
    $('ped-proveedor-otro').hidden = id !== 'otro';
    if (rellenar) {
      const conCantidad = _lineas.filter(l => Number(l.cantidad) > 0);
      const suyos = _ingredientes.filter(i => i.proveedor_id && i.proveedor_id === id)
        .filter(i => !conCantidad.some(l => l.ingrediente_id === i.id))
        .map(i => ({ ingrediente_id: i.id, nombre: i.nombre, cantidad: '', unidad: _costes.get(i.id)?.unidad || 'kg' }));
      _lineas = [...conCantidad, ...suyos];
    }
    _pintarLineas();
  }

  function _pintarLineas() {
    const cont = $('ped-lineas');
    if (!_lineas.length) {
      cont.innerHTML = `<p class="texto-vacio" style="padding:8px 0">${$('ped-proveedor').value && $('ped-proveedor').value !== 'otro'
        ? 'Este proveedor no tiene ingredientes asignados. Añade productos abajo, o asígnaselos en Carta → Ingredientes.'
        : 'Añade los productos que quieres pedir.'}</p>`;
      return;
    }
    cont.innerHTML = _lineas.map((l, i) => `<div class="ped-linea${Number(l.cantidad) > 0 ? ' con' : ''}">
      ${l.ingrediente_id ? `<span class="ped-linea-nombre">${esc(l.nombre)}</span>`
        : `<input class="inp ped-linea-nombre" data-i="${i}" data-c="nombre" value="${esc(l.nombre)}" placeholder="Producto" aria-label="Producto">`}
      <input class="inp ped-linea-cant" type="number" inputmode="decimal" min="0" step="any" data-i="${i}" data-c="cantidad" value="${l.cantidad === '' ? '' : esc(l.cantidad)}" placeholder="0" aria-label="Cantidad de ${esc(l.nombre || 'producto')}">
      <select class="inp ped-linea-unidad" data-i="${i}" data-c="unidad" aria-label="Unidad">${UNIDADES.concat(UNIDADES.includes(l.unidad) ? [] : [l.unidad]).map(u => `<option${u === l.unidad ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
      <button type="button" class="btn-mini btn-borrar" data-quitar="${i}" aria-label="Quitar"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>
    </div>`).join('');
  }

  function _leerPedido(estado) {
    const sel = $('ped-proveedor').value;
    const prov = _prov(sel);
    return {
      ...(_pedidoEdit ? { id: _pedidoEdit.id } : {}),
      proveedor_id: prov ? prov.id : null,
      proveedor_nombre: prov ? prov.nombre : $('ped-proveedor-otro').value.trim(),
      entrega: $('ped-entrega').value || null,
      notas: $('ped-notas').value.trim(),
      estado: estado || _pedidoEdit?.estado || 'borrador',
      autor: _pedidoEdit?.autor || _miNombre,
      lineas: _lineas.filter(l => Number(l.cantidad) > 0 && String(l.nombre || '').trim()),
    };
  }

  async function _guardarPedido(estado) {
    const p = _leerPedido(estado);
    if (!p.proveedor_nombre) { alert('Elige el proveedor (o escribe su nombre).'); return null; }
    if (!p.lineas.length) { alert('Pon la cantidad de al menos un producto.'); return null; }
    const g = p.id ? await SB.actualizarPedido(p) : await SB.guardarPedido(p);
    _pedidoEdit = { ...p, ...(g || {}), id: g?.id || p.id };
    return _pedidoEdit;
  }

  async function _enviar(medio) {
    let p;
    try { p = await _guardarPedido(); } catch (e) { aviso('No se ha podido guardar el pedido: ' + e.message, { tipo: 'error', ms: 6000 }); return; }
    if (!p) return;
    const prov = _prov(p.proveedor_id);
    const texto = textoPedido(p, { restaurante: _restaurante(), contacto: prov?.contacto || '' });
    if (medio === 'whatsapp') {
      const tel = telefonoWhatsApp(prov?.telefono);
      window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    } else if (medio === 'email') {
      window.location.href = `mailto:${encodeURIComponent(prov?.email || '')}?subject=${encodeURIComponent('Pedido ' + _restaurante())}&body=${encodeURIComponent(texto)}`;
    } else {
      try { await navigator.clipboard.writeText(texto); aviso('📋 Pedido copiado: pégalo donde quieras.', { tipo: 'ok', ms: 2500 }); }
      catch { prompt('Copia el pedido:', texto); }
    }
    // Se da por enviado (si no se llegó a mandar, se puede volver a abrir y reenviar)
    try { await SB.cambiarEstadoPedido(p.id, 'enviado'); } catch {}
    await _recargar();
    _irA('pedidos');
  }

  // ---------- Recibir pedido ----------
  let _recibiendo = null;
  function _abrirRecibir(p) {
    _recibiendo = p;
    const gestion = SB.puedeGestionar();
    const conIng = (p.lineas || []).filter(l => l.ingrediente_id && _ingredientes.some(i => i.id === l.ingrediente_id));
    $('ped-recibir-titulo').textContent = `Recibir pedido de ${p.proveedor_nombre || 'proveedor'}`;
    $('ped-recibir-cuerpo').innerHTML = `
      <ul class="ped-recibir-lista">${(p.lineas || []).map(l => `<li>${_cant(l.cantidad)} ${esc(l.unidad)} · ${esc(l.nombre)}</li>`).join('')}</ul>
      ${gestion && conIng.length ? `<h4 class="ped-recibir-h">¿Han cambiado los precios? <small>(opcional: actualiza los escandallos)</small></h4>
        <div class="ped-precios">${conIng.map(l => {
          const c = _costes.get(l.ingrediente_id);
          return `<label class="ped-precio">
            <span>${esc(l.nombre)}<small>${c?.precio_compra != null ? 'ahora ' + dinero(c.precio_compra) + ' €/' + (c.unidad || 'kg') : 'sin precio'}</small></span>
            <span class="inp-con-unidad"><input class="inp" type="number" inputmode="decimal" min="0" step="0.01" data-precio="${esc(l.ingrediente_id)}" placeholder="${c?.precio_compra ?? ''}" aria-label="Precio nuevo de ${esc(l.nombre)}"><span>€/${esc(c?.unidad || 'kg')}</span></span>
          </label>`;
        }).join('')}</div>` : ''}
      <p class="appcc-nota">Recuerda registrar la recepción (temperatura y estado) en APPCC si es producto refrigerado o congelado.</p>`;
    _mostrar('ped-vista-recibir');
  }

  async function _confirmarRecibir() {
    const p = _recibiendo;
    if (!p) return;
    const btn = $('ped-recibir-ok'); btn.disabled = true;
    try {
      let cambiados = 0;
      for (const inp of document.querySelectorAll('#ped-recibir-cuerpo [data-precio]')) {
        const v = inp.value.trim().replace(',', '.');
        if (v === '') continue;
        const precio = Number(v);
        if (!(precio >= 0)) throw new Error('Hay un precio que no es válido.');
        const id = inp.dataset.precio, antes = _costes.get(id) || {};
        await SB.guardarCoste('ingrediente', id, { ...antes, precio_compra: precio });
        cambiados++;
      }
      await SB.cambiarEstadoPedido(p.id, 'recibido');
      aviso(`✔ Pedido recibido${cambiados ? ` · ${cambiados} precio${cambiados === 1 ? '' : 's'} actualizado${cambiados === 1 ? '' : 's'}` : ''}.`, { tipo: 'ok', ms: 3000 });
      await _recargar();
      _irA('pedidos');
    } catch (e) {
      aviso('No se ha podido guardar: ' + e.message, { tipo: 'error', ms: 6000 });
    } finally { btn.disabled = false; }
  }

  // ---------- Proveedores ----------
  function _pintarProveedores() {
    const cont = $('prov-lista');
    if (!cont) return;
    if (!_proveedores.length) { cont.innerHTML = '<p class="texto-vacio">No hay proveedores. Añade el primero.</p>'; return; }
    const gestion = SB.puedeGestionar();
    cont.innerHTML = _proveedores.map(p => {
      const nIng = _ingredientes.filter(i => i.proveedor_id === p.id).length;
      const tel = telefonoWhatsApp(p.telefono);
      return `<div class="card-plato" data-prov="${esc(p.id)}">
        <div class="card-plato-cabecera"><div class="card-plato-nombre">${esc(p.nombre)}</div></div>
        <div class="card-plato-desc">${[p.contacto, p.telefono, p.email].filter(Boolean).map(esc).join(' · ') || 'Sin datos de contacto'}</div>
        <div class="ped-resumen">${p.dias_reparto ? 'Reparte: ' + esc(p.dias_reparto) + ' · ' : ''}${nIng} ingrediente${nIng === 1 ? '' : 's'}</div>
        <div class="card-acciones">
          <button class="btn-mini btn-pagar" type="button" data-pv="pedido"><svg class="ic" aria-hidden="true"><use href="#i-package"/></svg> Hacer pedido</button>
          ${tel ? `<a class="btn-mini" href="tel:+${tel}"><svg class="ic" aria-hidden="true"><use href="#i-phone"/></svg> Llamar</a>` : ''}
          ${gestion ? `<button class="btn-mini btn-editar" type="button" data-pv="editar"><svg class="ic" aria-hidden="true"><use href="#i-pencil"/></svg> Editar</button>
          <button class="btn-mini btn-borrar" type="button" data-pv="borrar" aria-label="Eliminar proveedor"><svg class="ic" aria-hidden="true"><use href="#i-trash-2"/></svg></button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function _abrirProveedor(p = null) {
    _provEdit = p;
    $('prov-form-titulo').textContent = p ? 'Editar proveedor' : 'Nuevo proveedor';
    ['nombre', 'contacto', 'telefono', 'email', 'dias_reparto', 'notas'].forEach(c => { $('prov-' + c).value = p?.[c] || ''; });
    _mostrar('prov-vista-form');
    $('prov-nombre').focus();
  }

  async function _guardarProveedor() {
    const d = Object.fromEntries(['nombre', 'contacto', 'telefono', 'email', 'dias_reparto', 'notas'].map(c => [c, $('prov-' + c).value.trim()]));
    if (!d.nombre) { alert('El nombre del proveedor es obligatorio.'); return; }
    if (d.email && !validarEmail(d.email)) { alert('El email no parece válido.'); return; }
    const btn = $('prov-guardar'); btn.disabled = true;
    try {
      if (_provEdit) await SB.actualizarProveedor({ id: _provEdit.id, ...d });
      else await SB.guardarProveedor(d);
      await _recargar();
      _irA('proveedores');
    } catch (e) { aviso('No se ha podido guardar: ' + e.message, { tipo: 'error', ms: 6000 }); }
    finally { btn.disabled = false; }
  }

  // ----------------------------------------------------------
  // EVENTOS
  // ----------------------------------------------------------

  async function _recargar() {
    try { await _cargar(); } catch (e) { aviso('No se han podido cargar los pedidos: ' + e.message, { tipo: 'error', ms: 6000 }); }
  }

  let _miNombre = '';
  async function init() {
    document.querySelectorAll('#modulo-pedidos .sub-tab[data-ped]').forEach(b => b.addEventListener('click', () => _irA(b.dataset.ped)));
    $('ped-nuevo')?.addEventListener('click', () => _abrirPedido());
    $('prov-nuevo')?.addEventListener('click', () => _abrirProveedor());
    $('ped-proveedor')?.addEventListener('change', () => _cambioProveedor(true));
    $('ped-add-linea')?.addEventListener('click', () => {
      _lineas.push({ nombre: '', cantidad: '', unidad: 'kg' });
      _pintarLineas();
      document.querySelector('#ped-lineas .ped-linea:last-child input')?.focus();
    });
    $('ped-lineas')?.addEventListener('input', e => {
      const i = e.target.dataset.i, c = e.target.dataset.c;
      if (i == null || !c) return;
      _lineas[i][c] = e.target.value;
      if (c === 'cantidad') e.target.closest('.ped-linea')?.classList.toggle('con', Number(e.target.value) > 0);
    });
    $('ped-lineas')?.addEventListener('change', e => { const i = e.target.dataset.i; if (i != null && e.target.dataset.c === 'unidad') _lineas[i].unidad = e.target.value; });
    $('ped-lineas')?.addEventListener('click', e => { const b = e.target.closest('[data-quitar]'); if (b) { _lineas.splice(Number(b.dataset.quitar), 1); _pintarLineas(); } });
    $('ped-guardar')?.addEventListener('click', async () => {
      try { if (await _guardarPedido()) { aviso('✔ Pedido guardado.', { tipo: 'ok', ms: 2000 }); await _recargar(); _irA('pedidos'); } }
      catch (e) { aviso('No se ha podido guardar: ' + e.message, { tipo: 'error', ms: 6000 }); }
    });
    $('ped-whatsapp')?.addEventListener('click', () => _enviar('whatsapp'));
    $('ped-email')   ?.addEventListener('click', () => _enviar('email'));
    $('ped-copiar')  ?.addEventListener('click', () => _enviar('copiar'));
    $('ped-recibir-ok')?.addEventListener('click', _confirmarRecibir);
    document.querySelectorAll('[data-ped-volver]').forEach(b => b.addEventListener('click', () => _irA(_vista)));
    $('prov-guardar')?.addEventListener('click', _guardarProveedor);

    $('ped-lista')?.addEventListener('click', async e => {
      const b = e.target.closest('[data-pa]'); if (!b) return;
      const p = _pedidos.find(x => x.id === b.closest('[data-id]')?.dataset.id); if (!p) return;
      if (b.dataset.pa === 'editar') _abrirPedido(p);
      if (b.dataset.pa === 'repetir') _abrirPedido(p, { copiar: true });
      if (b.dataset.pa === 'recibir') _abrirRecibir(p);
      if (b.dataset.pa === 'borrar') {
        if (!confirm('¿Eliminar este pedido?')) return;
        try { await SB.eliminarPedido(p.id); await _recargar(); _pintarPedidos(); } catch (err) { aviso(err.message, { tipo: 'error' }); }
      }
    });
    $('prov-lista')?.addEventListener('click', async e => {
      const b = e.target.closest('[data-pv]'); if (!b) return;
      const p = _prov(b.closest('[data-prov]')?.dataset.prov); if (!p) return;
      if (b.dataset.pv === 'pedido') {
        _vista = 'pedidos';
        document.querySelectorAll('#modulo-pedidos .sub-tab[data-ped]').forEach(x => x.classList.toggle('activo', x.dataset.ped === 'pedidos'));
        _abrirPedido(null); $('ped-proveedor').value = p.id; _cambioProveedor(true); }
      if (b.dataset.pv === 'editar') _abrirProveedor(p);
      if (b.dataset.pv === 'borrar') {
        if (!confirm(`¿Eliminar el proveedor «${p.nombre}»?\n\nSus ingredientes y pedidos se conservan (quedan sin proveedor).`)) return;
        try { await SB.eliminarProveedor(p.id); await _recargar(); _pintarProveedores(); } catch (err) { aviso(err.message, { tipo: 'error' }); }
      }
    });

    try { _miNombre = await SB.miNombre(); } catch {}
    await _recargar();
    _irA('pedidos');
  }

  return { init, textoPedido, telefonoWhatsApp, recargar: async () => { await _recargar(); _irA(_vista); } };

})();
