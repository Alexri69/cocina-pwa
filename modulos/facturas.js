// ============================================================
// modulos/facturas.js — Facturas y Presupuestos (Supabase)
// Depende de: core/supabase.js, core/voz.js
// ============================================================

const ModuloFacturas = (() => {

  let _idFacturaActual  = null;
  let _lineas           = [];
  let _tipoVista        = 'factura';  // sub-tab: 'factura' | 'presupuesto' | 'bebidas'
  let _tipoActual       = 'factura';
  let _idBebidaEditando = null;

  // ----------------------------------------------------------
  // VISTAS
  // ----------------------------------------------------------

  function _mostrarVista(cual) {
    ['fac-vista-lista', 'fac-vista-formulario', 'fac-vista-detalle', 'fac-vista-bebidas'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === 'fac-vista-' + cual ? 'block' : 'none';
    });
  }

  // ----------------------------------------------------------
  // SUB-TABS
  // ----------------------------------------------------------

  function _actualizarSubTabs() {
    document.getElementById('fac-tab-facturas')    ?.classList.toggle('activo', _tipoVista === 'factura');
    document.getElementById('fac-tab-presupuestos')?.classList.toggle('activo', _tipoVista === 'presupuesto');
    document.getElementById('fac-tab-bebidas')     ?.classList.toggle('activo', _tipoVista === 'bebidas');
    const btnFac  = document.getElementById('fac-btn-nueva');
    const btnPres = document.getElementById('fac-btn-nuevo-pres');
    if (btnFac)  btnFac.style.display  = _tipoVista === 'factura'     ? '' : 'none';
    if (btnPres) btnPres.style.display = _tipoVista === 'presupuesto' ? '' : 'none';
  }

  // ----------------------------------------------------------
  // LISTA
  // ----------------------------------------------------------

  async function _renderLista() {
    const lista = document.getElementById('fac-lista');
    if (!lista) return;
    lista.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      const items = _tipoVista === 'presupuesto'
        ? await SB.obtenerPresupuestos()
        : await SB.obtenerFacturas();
      if (!items?.length) {
        lista.innerHTML = `<p class="texto-vacio">No hay ${_tipoVista === 'presupuesto' ? 'presupuestos' : 'facturas'} todavía.</p>`;
        return;
      }
      lista.innerHTML = items.map(f => _cardHtml(f)).join('');
    } catch (e) {
      lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${e.message}</p>`;
    }
  }

  function _cardHtml(f) {
    const esPres = f.tipo === 'presupuesto';
    let cls, etiq;
    if (esPres) {
      cls  = f.estadoPresupuesto === 'aceptado'  ? 'estado-pres-aceptado'
           : f.estadoPresupuesto === 'rechazado' ? 'estado-pres-rechazado'
           : 'estado-pendiente';
      etiq = f.estadoPresupuesto === 'aceptado'  ? '✔ Aceptado'
           : f.estadoPresupuesto === 'rechazado' ? '✕ Rechazado'
           : '⏳ Pendiente';
    } else {
      cls  = f.pagada ? 'estado-pagada' : 'estado-pendiente';
      etiq = f.pagada ? '✔ Pagada'      : '⏳ Pendiente';
    }
    return `<div class="card-factura" data-id="${f.id}">
      <div class="fac-card-cabecera">
        <div class="fac-card-numero">${_esc(f.numero)}</div>
        <div class="badge-estado ${cls}">${etiq}</div>
      </div>
      <div class="fac-card-cliente">${_esc(f.cliente)}</div>
      ${esPres && f.descripcionEvento ? `<div style="font-size:.8rem;color:var(--texto2);margin-bottom:2px">📅 ${_esc(f.descripcionEvento)}</div>` : ''}
      <div class="fac-card-meta">
        <span>${VOZ.formatearFechaSolo(f.fecha)}</span>
        <strong>${f.total.toFixed(2)} €</strong>
      </div>
      <div class="card-acciones">
        <button class="btn-mini btn-ver"    onclick="ModuloFacturas.verFactura('${f.id}')">👁 Ver</button>
        <button class="btn-mini btn-editar" onclick="ModuloFacturas.editarFactura('${f.id}')">✏ Editar</button>
        ${esPres
          ? (f.estadoPresupuesto !== 'aceptado'
              ? `<button class="btn-mini btn-pagar" onclick="ModuloFacturas.aceptarPresupuesto('${f.id}')">✔ Aceptar</button>`
              : '')
          : `<button class="btn-mini ${f.pagada ? 'btn-borrar' : 'btn-pagar'}"
                onclick="ModuloFacturas.togglePagada('${f.id}',${f.pagada})">
              ${f.pagada ? '↩ Pendiente' : '✔ Pagada'}
             </button>`
        }
        <button class="btn-mini btn-email" onclick="ModuloFacturas.compartirEmail('${f.id}')" title="Enviar por email">📧</button>
        <button class="btn-mini btn-wa"    onclick="ModuloFacturas.compartirWhatsApp('${f.id}')" title="Enviar por WhatsApp">💬</button>
        <button class="btn-mini btn-borrar" onclick="ModuloFacturas.borrarFactura('${f.id}','${f.numero}')">🗑</button>
      </div>
    </div>`;
  }

  // ----------------------------------------------------------
  // FORMULARIO
  // ----------------------------------------------------------

  async function _abrirFormulario(factura = null, tipo = 'factura') {
    _idFacturaActual = factura ? factura.id : null;
    _tipoActual      = factura ? (factura.tipo || 'factura') : tipo;
    _lineas          = factura ? JSON.parse(JSON.stringify(factura.lineas)) : [];

    const esPres = _tipoActual === 'presupuesto';

    document.getElementById('fac-form-titulo').textContent = factura
      ? `Editar ${esPres ? 'Presupuesto' : 'Factura'} ${factura.numero}`
      : (esPres ? 'Nuevo Presupuesto' : 'Nueva Factura');

    document.getElementById('fac-cliente').value         = factura?.cliente   || '';
    document.getElementById('fac-nif').value             = factura?.nif       || '';
    document.getElementById('fac-direccion').value       = factura?.direccion || '';
    document.getElementById('fac-fecha').value           = factura
      ? (typeof factura.fecha === 'string' ? factura.fecha.split('T')[0] : factura.fecha)
      : new Date().toISOString().split('T')[0];
    document.getElementById('fac-iva').value             = factura?.porcentajeIgic ?? 7;
    document.getElementById('fac-notas').value           = factura?.notas || '';
    document.getElementById('fac-irpf').value            = factura?.retencionIrpf ?? 0;
    document.getElementById('fac-forma-pago').value      = factura?.formaPago || 'efectivo';
    document.getElementById('fac-vencimiento').value     = factura?.vencimiento
      ? (typeof factura.vencimiento === 'string' ? factura.vencimiento.split('T')[0] : factura.vencimiento)
      : '';

    // Campos de evento (solo presupuestos)
    const grupoEvento = document.getElementById('fac-grupo-evento');
    if (grupoEvento) grupoEvento.style.display = esPres ? '' : 'none';
    if (esPres) {
      document.getElementById('fac-evento-desc').value       = factura?.descripcionEvento || '';
      document.getElementById('fac-evento-fecha').value      = factura?.fechaEvento
        ? (typeof factura.fechaEvento === 'string' ? factura.fechaEvento.split('T')[0] : factura.fechaEvento)
        : '';
      document.getElementById('fac-evento-comensales').value = factura?.comensales || '';
    }

    await _renderSelectorPlatos();
    _renderLineas();
    _mostrarVista('formulario');
    document.getElementById('fac-cliente').focus();
  }

  async function _renderSelectorPlatos() {
    const sel = document.getElementById('fac-selector-platos');
    if (!sel) return;
    try {
      const [platos, bebidas] = await Promise.all([SB.obtenerPlatos(), SB.obtenerBebidas()]);
      const optsPlatos  = (platos  || []).map(p => `<option value="${p.id}" data-nombre="${_esc(p.nombre)}" data-precio="${p.precio}">${p.nombre}${p.precio > 0 ? ' (' + p.precio.toFixed(2) + ' €)' : ''}</option>`).join('');
      const optsBebidas = (bebidas || []).map(b => `<option value="${b.id}" data-nombre="${_esc(b.nombre)}" data-precio="${b.precio}">${b.nombre}${b.precio > 0 ? ' (' + b.precio.toFixed(2) + ' €)' : ''}</option>`).join('');
      sel.innerHTML = '<option value="">— Importar plato o bebida —</option>'
        + (optsPlatos  ? `<optgroup label="🍽 Platos">${optsPlatos}</optgroup>`   : '')
        + (optsBebidas ? `<optgroup label="🥤 Bebidas">${optsBebidas}</optgroup>` : '');
    } catch { sel.innerHTML = '<option value="">— Sin conexión —</option>'; }
  }

  function _agregarLinea(nombre = '', precioUnitario = 0, cantidad = 1) {
    _lineas.push({ descripcion: nombre, cantidad, precioUnitario, subtotal: cantidad * precioUnitario });
    _renderLineas();
  }

  function _renderLineas() {
    const tbody = document.getElementById('fac-lineas-body');
    if (!tbody) return;
    if (!_lineas.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="texto-vacio">Sin líneas. Añade conceptos.</td></tr>';
      _calcularTotales();
      return;
    }
    tbody.innerHTML = _lineas.map((l, i) => `
      <tr>
        <td><input class="inp-linea inp-desc"   type="text"   value="${_esc(l.descripcion)}"   oninput="ModuloFacturas._actualizarLinea(${i},'descripcion',this.value)" placeholder="Concepto"></td>
        <td><input class="inp-linea inp-qty"    type="number" value="${l.cantidad}"             oninput="ModuloFacturas._actualizarLinea(${i},'cantidad',this.value)"    min="0.01" step="0.01"></td>
        <td><input class="inp-linea inp-precio" type="number" value="${l.precioUnitario || ''}" oninput="ModuloFacturas._actualizarLinea(${i},'precio',this.value)"      min="0"    step="0.01" placeholder="0.00"></td>
        <td class="linea-subtotal">${(l.subtotal || 0).toFixed(2)} €</td>
        <td><button class="btn-mini btn-borrar" onclick="ModuloFacturas._eliminarLinea(${i})" title="Eliminar">✕</button></td>
      </tr>`).join('');
    _calcularTotales();
  }

  function _actualizarLinea(idx, campo, valor) {
    if (campo === 'descripcion') { _lineas[idx].descripcion = valor; return; }
    if (campo === 'cantidad')    _lineas[idx].cantidad       = parseFloat(valor) || 0;
    if (campo === 'precio')      _lineas[idx].precioUnitario = parseFloat(valor) || 0;
    _lineas[idx].subtotal = _lineas[idx].cantidad * _lineas[idx].precioUnitario;
    const cel = document.querySelectorAll('#fac-lineas-body tr')[idx]?.querySelector('.linea-subtotal');
    if (cel) cel.textContent = _lineas[idx].subtotal.toFixed(2) + ' €';
    _calcularTotales();
  }

  function _eliminarLinea(idx) { _lineas.splice(idx, 1); _renderLineas(); }

  function _calcularTotales() {
    const subtotal  = _lineas.reduce((s, l) => s + (l.subtotal || 0), 0);
    const pIgic     = parseFloat(document.getElementById('fac-iva')?.value)  || 0;
    const cuotaIgic = subtotal * pIgic / 100;
    const pIrpf     = parseFloat(document.getElementById('fac-irpf')?.value) || 0;
    const cuotaIrpf = subtotal * pIrpf / 100;
    const total     = subtotal + cuotaIgic - cuotaIrpf;

    const cfg    = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const impNom = cfg.regimen === 'iva' ? 'IVA' : 'IGIC';

    _setText('fac-subtotal',   subtotal.toFixed(2)   + ' €');
    _setText('fac-cuota-iva',  cuotaIgic.toFixed(2)  + ' €');
    _setText('fac-iva-label',  `${impNom} (${pIgic}%)`);
    _setText('fac-irpf-label', `IRPF (−${pIrpf}%)`);
    _setText('fac-cuota-irpf', cuotaIrpf.toFixed(2)  + ' €');
    _setText('fac-total',      total.toFixed(2)       + ' €');

    const filaIrpf = document.getElementById('fac-fila-irpf');
    if (filaIrpf) filaIrpf.style.display = pIrpf > 0 ? 'flex' : 'none';
  }

  async function _guardarFactura() {
    const cliente = document.getElementById('fac-cliente').value.trim();
    if (!cliente)        { alert('El nombre del cliente es obligatorio.'); return; }
    if (!_lineas.length) { alert('Añade al menos una línea.'); return; }

    const subtotal       = _lineas.reduce((s, l) => s + (l.subtotal || 0), 0);
    const porcentajeIgic = parseFloat(document.getElementById('fac-iva').value)  || 0;
    const cuotaIgic      = subtotal * porcentajeIgic / 100;
    const retencionIrpf  = parseFloat(document.getElementById('fac-irpf').value) || 0;
    const cuotaIrpf      = subtotal * retencionIrpf / 100;
    const esPres         = _tipoActual === 'presupuesto';

    let existente = null;
    if (_idFacturaActual) existente = await SB.obtenerFactura(_idFacturaActual);

    const datos = {
      numero:            existente ? existente.numero
                       : esPres   ? await SB.siguienteNumeroPresupuesto()
                       :            await SB.siguienteNumeroFactura(),
      cliente,
      nif:               document.getElementById('fac-nif').value.trim(),
      direccion:         document.getElementById('fac-direccion').value.trim(),
      fecha:             document.getElementById('fac-fecha').value,
      lineas:            _lineas,
      subtotal,
      porcentajeIgic,
      cuotaIgic,
      retencionIrpf,
      cuotaIrpf,
      total:             subtotal + cuotaIgic - cuotaIrpf,
      pagada:            existente ? existente.pagada : false,
      notas:             document.getElementById('fac-notas').value.trim(),
      formaPago:         document.getElementById('fac-forma-pago').value || 'efectivo',
      vencimiento:       document.getElementById('fac-vencimiento').value || null,
      tipo:              _tipoActual,
      estadoPresupuesto: esPres ? (existente?.estadoPresupuesto || 'pendiente') : null,
      descripcionEvento: esPres ? (document.getElementById('fac-evento-desc')?.value.trim()  || '') : '',
      fechaEvento:       esPres ? (document.getElementById('fac-evento-fecha')?.value || null)      : null,
    };

    if (_idFacturaActual) {
      await SB.actualizarFactura({ id: _idFacturaActual, ...datos });
    } else {
      await SB.guardarFactura(datos);
    }

    _mostrarVista('lista');
    await _renderLista();
  }

  // ----------------------------------------------------------
  // DETALLE / IMPRESIÓN
  // ----------------------------------------------------------

  async function verFactura(id) {
    const f = await SB.obtenerFactura(id);
    if (!f) return;
    _idFacturaActual = id;
    _renderDetalle(f);
    _mostrarVista('detalle');
    const btnConv = document.getElementById('fac-btn-convertir');
    if (btnConv) btnConv.style.display = f.tipo === 'presupuesto' ? '' : 'none';
  }

  function _renderDetalle(f) {
    const div = document.getElementById('fac-detalle-contenido');
    if (!div) return;

    const cfg          = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const emisorNombre = cfg.razonSocial || 'MI RESTAURANTE';
    const regimen      = cfg.regimen || 'igic';
    const impNom       = regimen === 'iva' ? 'IVA' : 'IGIC';
    const leyRef       = regimen === 'iva'
      ? 'Ley 37/1992 del Impuesto sobre el Valor Añadido'
      : 'Ley 20/1991 del Impuesto General Indirecto Canario (IGIC)';
    const esPres       = f.tipo === 'presupuesto';

    const emisorLineas = [
      cfg.nif       ? `NIF/CIF: ${_esc(cfg.nif)}`   : null,
      cfg.direccion ? _esc(cfg.direccion)             : null,
      [cfg.cp, cfg.ciudad].filter(Boolean).join(' ') || null,
      cfg.provincia ? _esc(cfg.provincia)             : null,
      cfg.telefono  ? `Tel: ${_esc(cfg.telefono)}`   : null,
      cfg.email     ? _esc(cfg.email)                 : null,
    ].filter(Boolean).join('<br>');

    const filas = (f.lineas || []).map(l => `
      <tr>
        <td>${_esc(l.descripcion)}</td>
        <td class="td-num">${l.cantidad}</td>
        <td class="td-num">${(l.precioUnitario || 0).toFixed(2)} €</td>
        <td class="td-num">${(l.subtotal || 0).toFixed(2)} €</td>
      </tr>`).join('');

    const irpfHtml = (f.retencionIrpf || 0) > 0
      ? `<div class="fac-fila-total"><span>Retención IRPF (${f.retencionIrpf}%):</span><span style="color:#c00">−${(f.cuotaIrpf||0).toFixed(2)} €</span></div>`
      : '';

    const pagoLabels = { efectivo:'Efectivo', transferencia:'Transferencia bancaria', tarjeta:'Tarjeta', cheque:'Cheque' };
    const pagoLabel  = pagoLabels[f.formaPago] || '';
    const ibanHtml   = (f.formaPago === 'transferencia' && cfg.iban)
      ? `<br><strong>IBAN:</strong> ${_esc(cfg.iban)}` : '';

    const estadoColor = f.estadoPresupuesto === 'aceptado'  ? '#4ade80'
                      : f.estadoPresupuesto === 'rechazado' ? '#f87171' : '#fbbf24';
    const estadoTxt   = f.estadoPresupuesto === 'aceptado'  ? '✔ ACEPTADO'
                      : f.estadoPresupuesto === 'rechazado' ? '✕ RECHAZADO' : '⏳ PENDIENTE DE ACEPTACIÓN';

    const eventoHtml = esPres && f.descripcionEvento
      ? `<div class="fac-receptor" style="margin-top:12px">
           <div class="fac-receptor-titulo">Descripción del evento</div>
           <strong>${_esc(f.descripcionEvento)}</strong>
           ${f.fechaEvento ? `<br>Fecha del evento: <strong>${VOZ.formatearFechaSolo(f.fechaEvento)}</strong>` : ''}
         </div>`
      : '';

    div.innerHTML = `
      <div class="factura-imprimible">
        <div class="fac-cabecera-print">
          <div class="fac-emisor">
            <strong class="fac-emisor-nombre">${_esc(emisorNombre)}</strong>
            ${emisorLineas ? `<div class="fac-emisor-datos">${emisorLineas}</div>` : ''}
          </div>
          <div class="fac-titulo-doc">
            <div class="fac-numero-grande">${esPres ? 'PRESUPUESTO' : 'FACTURA'}</div>
            <div class="fac-meta-item"><span>Número:</span> ${_esc(f.numero)}</div>
            <div class="fac-meta-item"><span>Fecha:</span> ${VOZ.formatearFechaSolo(f.fecha)}</div>
            ${f.vencimiento ? `<div class="fac-meta-item"><span>${esPres ? 'Válido hasta:' : 'Vencimiento:'}</span> ${VOZ.formatearFechaSolo(f.vencimiento)}</div>` : ''}
          </div>
        </div>

        <div class="fac-receptor">
          <div class="fac-receptor-titulo">Datos del cliente</div>
          <strong>${_esc(f.cliente)}</strong>
          ${f.nif       ? `<br>NIF/CIF: ${_esc(f.nif)}`  : ''}
          ${f.direccion ? `<br>${_esc(f.direccion)}`      : ''}
        </div>

        ${eventoHtml}

        <table class="fac-tabla-lineas">
          <thead>
            <tr>
              <th>Concepto</th><th class="td-num">Cant.</th>
              <th class="td-num">P. Unit.</th><th class="td-num">Importe</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>

        <div class="fac-totales">
          <div class="fac-fila-total"><span>Base imponible:</span><span>${f.subtotal.toFixed(2)} €</span></div>
          <div class="fac-fila-total"><span>${impNom} (${f.porcentajeIgic}%):</span><span>${f.cuotaIgic.toFixed(2)} €</span></div>
          ${irpfHtml}
          <div class="fac-fila-total fac-total-final">
            <span>${esPres ? 'TOTAL ESTIMADO:' : 'TOTAL A PAGAR:'}</span>
            <span>${f.total.toFixed(2)} €</span>
          </div>
        </div>

        ${pagoLabel && !esPres ? `<div class="fac-pago"><strong>Forma de pago:</strong> ${_esc(pagoLabel)}${ibanHtml}</div>` : ''}
        ${f.notas ? `<div class="fac-notas">Notas: ${_esc(f.notas)}</div>` : ''}

        <div class="fac-pie-legal">
          ${esPres
            ? `Presupuesto sin valor contractual hasta su aceptación formal.<br>Emitido conforme a la ${leyRef}.`
            : `Factura emitida conforme a la ${leyRef}.<br>Sujeto pasivo: ${_esc(emisorNombre)}${cfg.nif ? ' · NIF/CIF: ' + _esc(cfg.nif) : ''}`
          }
          ${esPres
            ? `<br><span style="font-weight:700;color:${estadoColor}">${estadoTxt}</span>`
            : (f.pagada ? '<br><strong>✔ PAGADA</strong>' : '')
          }
        </div>
      </div>`;
  }

  async function editarFactura(id) {
    const f = await SB.obtenerFactura(id);
    if (f) await _abrirFormulario(f);
  }

  async function togglePagada(id, estabaPageada) {
    const f = await SB.obtenerFactura(id);
    if (!f) return;
    await SB.actualizarFactura({ ...f, pagada: !estabaPageada });
    await _renderLista();
  }

  async function aceptarPresupuesto(id) {
    const f = await SB.obtenerFactura(id);
    if (!f) return;
    await SB.actualizarFactura({ ...f, estadoPresupuesto: 'aceptado' });
    await _renderLista();
  }

  async function _convertirAFactura() {
    if (!_idFacturaActual) return;
    if (!confirm('¿Convertir este presupuesto en factura?\nSe creará una nueva factura con los mismos datos.')) return;
    const pres = await SB.obtenerFactura(_idFacturaActual);
    if (!pres) return;

    const numero = await SB.siguienteNumeroFactura();
    const { id: _i, user_id: _u, timestamp: _t, ...resto } = pres;
    const nuevaFac = await SB.guardarFactura({
      ...resto,
      numero,
      tipo:              'factura',
      estadoPresupuesto: null,
      pagada:            false,
      fecha:             new Date().toISOString().split('T')[0],
    });
    await SB.actualizarFactura({ ...pres, estadoPresupuesto: 'aceptado' });

    alert(`✔ Factura ${numero} creada correctamente.`);
    _tipoVista = 'factura';
    _actualizarSubTabs();
    await verFactura(nuevaFac.id);
  }

  async function borrarFactura(id, numero) {
    if (!confirm(`¿Eliminar "${numero}"? Esta acción no se puede deshacer.`)) return;
    await SB.borrarFactura(id);
    await _renderLista();
  }

  // ----------------------------------------------------------
  // GESTIÓN DE BEBIDAS (sub-pestaña dentro de Facturas)
  // ----------------------------------------------------------

  const _CATS_BEB = {
    agua:'💧 Agua', refresco:'🥤 Refrescos', cerveza:'🍺 Cerveza',
    vino:'🍷 Vinos', licor:'🥃 Licores', cafe:'☕ Cafés', zumo:'🍊 Zumos', otro:'🫗 Otros'
  };

  async function _renderListaBebidas() {
    const lista = document.getElementById('fac-beb-lista');
    if (!lista) return;
    lista.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      const items = await SB.obtenerBebidas();
      if (!items?.length) { lista.innerHTML = '<p class="texto-vacio">No hay bebidas. Añade la primera.</p>'; return; }
      lista.innerHTML = items.map(b => `
        <div class="card-plato" data-id="${b.id}">
          <div class="card-plato-cabecera">
            <div class="card-plato-nombre">${_esc(b.nombre)}</div>
            <div class="card-plato-precio">${b.precio > 0 ? b.precio.toFixed(2) + ' €' : ''}</div>
          </div>
          ${b.descripcion ? `<div class="card-plato-desc">${_esc(b.descripcion)}</div>` : ''}
          <div class="card-plato-ingredientes">${_CATS_BEB[b.categoria] ?? b.categoria}</div>
          <div class="card-acciones">
            <button class="btn-mini btn-editar" onclick="ModuloFacturas._editarBebida('${b.id}')">✏ Editar</button>
            <button class="btn-mini btn-borrar" onclick="ModuloFacturas._borrarBebida('${b.id}','${b.nombre.replace(/'/g,"\\'")}')">🗑 Eliminar</button>
          </div>
        </div>`).join('');
    } catch (e) { lista.innerHTML = `<p class="texto-vacio error-texto">Error: ${e.message}</p>`; }
  }

  async function _editarBebida(id) {
    const b = await SB.obtenerBebida(id);
    if (!b) return;
    _idBebidaEditando = id;
    document.getElementById('fac-beb-nombre').value    = b.nombre;
    document.getElementById('fac-beb-desc').value      = b.descripcion || '';
    document.getElementById('fac-beb-precio').value    = b.precio > 0 ? b.precio : '';
    document.getElementById('fac-beb-categoria').value = b.categoria || 'otro';
    document.getElementById('fac-beb-form-titulo').textContent = `Editar: ${b.nombre}`;
    document.getElementById('fac-beb-btn-guardar').textContent = '💾 Actualizar Bebida';
    document.getElementById('fac-beb-btn-cancelar').style.display = 'inline-flex';
    document.getElementById('fac-beb-nombre').focus();
  }

  async function _borrarBebida(id, nombre) {
    if (!confirm(`¿Eliminar la bebida "${nombre}"?`)) return;
    await SB.eliminarBebida(id);
    await _renderListaBebidas();
  }

  async function _guardarBebida() {
    const nombre = document.getElementById('fac-beb-nombre').value.trim();
    if (!nombre) { alert('El nombre es obligatorio.'); return; }
    const datos = {
      nombre,
      descripcion: document.getElementById('fac-beb-desc').value.trim(),
      precio:      parseFloat(document.getElementById('fac-beb-precio').value) || 0,
      categoria:   document.getElementById('fac-beb-categoria').value || 'otro',
    };
    if (_idBebidaEditando) {
      await SB.actualizarBebida({ id: _idBebidaEditando, ...datos });
    } else {
      await SB.guardarBebida(datos);
    }
    _resetFormBebida();
    await _renderListaBebidas();
    await _renderSelectorPlatos(); // refresca el selector en el formulario
  }

  function _resetFormBebida() {
    _idBebidaEditando = null;
    document.getElementById('fac-beb-nombre').value    = '';
    document.getElementById('fac-beb-desc').value      = '';
    document.getElementById('fac-beb-precio').value    = '';
    document.getElementById('fac-beb-categoria').value = 'refresco';
    document.getElementById('fac-beb-form-titulo').textContent = 'Añadir Bebida';
    document.getElementById('fac-beb-btn-guardar').textContent = '✔ Guardar Bebida';
    document.getElementById('fac-beb-btn-cancelar').style.display = 'none';
  }

  // ----------------------------------------------------------
  // COMPARTIR (Email / WhatsApp)
  // ----------------------------------------------------------

  function _textoFactura(f) {
    const cfg     = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const empresa = cfg.razonSocial || 'Mi Restaurante';
    const esPres  = f.tipo === 'presupuesto';
    const impNom  = (cfg.regimen || 'igic') === 'iva' ? 'IVA' : 'IGIC';
    const lineas  = (f.lineas || []).map(l =>
      `  ${l.descripcion} x${l.cantidad} — ${(l.subtotal || 0).toFixed(2)} €`).join('\n');
    const irpf    = (f.retencionIrpf || 0) > 0
      ? `\nRetención IRPF (${f.retencionIrpf}%): −${(f.cuotaIrpf || 0).toFixed(2)} €` : '';
    const venc    = f.vencimiento
      ? `\n${esPres ? 'Válido hasta' : 'Vencimiento'}: ${VOZ.formatearFechaSolo(f.vencimiento)}` : '';
    return { empresa, esPres, impNom, lineas, irpf, venc };
  }

  function _compartirEmail(f) {
    const { empresa, esPres, impNom, lineas, irpf, venc } = _textoFactura(f);
    const cfg    = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const asunto = `${esPres ? 'Presupuesto' : 'Factura'} ${f.numero} — ${empresa}`;
    const cuerpo = [
      `Estimado/a ${f.cliente},`,
      '',
      `Le enviamos ${esPres ? 'el presupuesto' : 'la factura'} nº ${f.numero} con fecha ${VOZ.formatearFechaSolo(f.fecha)}.`,
      '',
      'CONCEPTOS:',
      lineas,
      '',
      `Base imponible: ${f.subtotal.toFixed(2)} €`,
      `${impNom} (${f.porcentajeIgic}%): ${f.cuotaIgic.toFixed(2)} €`,
      irpf,
      `TOTAL: ${f.total.toFixed(2)} €`,
      venc,
      f.notas ? `\nNotas: ${f.notas}` : '',
      '',
      'Atentamente,',
      empresa,
      cfg.telefono ? `Tel: ${cfg.telefono}` : '',
      cfg.email    ? cfg.email : '',
    ].filter(l => l !== '').join('\n').replace(/\n{3,}/g, '\n\n').trim();

    window.location.href = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  }

  function _compartirWhatsApp(f) {
    const { empresa, esPres, impNom, lineas, irpf, venc } = _textoFactura(f);
    const msg = [
      `*${esPres ? 'PRESUPUESTO' : 'FACTURA'} ${f.numero}*`,
      `_${empresa}_`,
      '',
      `*Cliente:* ${f.cliente}`,
      `*Fecha:* ${VOZ.formatearFechaSolo(f.fecha)}`,
      '',
      lineas,
      '',
      `Base imponible: ${f.subtotal.toFixed(2)} €`,
      `${impNom} (${f.porcentajeIgic}%): ${f.cuotaIgic.toFixed(2)} €`,
      irpf,
      `*TOTAL: ${f.total.toFixed(2)} €*`,
      venc,
      f.notas ? `\n_Notas: ${f.notas}_` : '',
    ].filter(l => l !== '').join('\n').replace(/\n{3,}/g, '\n\n').trim();

    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }

  async function compartirEmail(id) {
    const f = await SB.obtenerFactura(id);
    if (f) _compartirEmail(f);
  }

  async function compartirWhatsApp(id) {
    const f = await SB.obtenerFactura(id);
    if (f) _compartirWhatsApp(f);
  }

  // ----------------------------------------------------------
  // UTILIDADES
  // ----------------------------------------------------------

  function _setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
  function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ----------------------------------------------------------
  // INICIALIZACIÓN
  // ----------------------------------------------------------

  async function init() {
    document.getElementById('fac-tab-facturas')?.addEventListener('click', async () => {
      _tipoVista = 'factura'; _actualizarSubTabs(); _mostrarVista('lista'); await _renderLista();
    });
    document.getElementById('fac-tab-presupuestos')?.addEventListener('click', async () => {
      _tipoVista = 'presupuesto'; _actualizarSubTabs(); _mostrarVista('lista'); await _renderLista();
    });
    document.getElementById('fac-tab-bebidas')?.addEventListener('click', async () => {
      _tipoVista = 'bebidas'; _actualizarSubTabs(); _resetFormBebida(); _mostrarVista('bebidas'); await _renderListaBebidas();
    });
    document.getElementById('fac-beb-btn-guardar') ?.addEventListener('click', _guardarBebida);
    document.getElementById('fac-beb-btn-cancelar')?.addEventListener('click', _resetFormBebida);

    document.getElementById('fac-btn-nueva')     ?.addEventListener('click', () => _abrirFormulario(null, 'factura'));
    document.getElementById('fac-btn-nuevo-pres') ?.addEventListener('click', () => _abrirFormulario(null, 'presupuesto'));
    document.getElementById('fac-btn-guardar')   ?.addEventListener('click', _guardarFactura);
    document.getElementById('fac-btn-cancelar')  ?.addEventListener('click', async () => { _mostrarVista('lista'); await _renderLista(); });
    document.getElementById('fac-btn-volver')    ?.addEventListener('click', async () => { _mostrarVista('lista'); await _renderLista(); });
    document.getElementById('fac-btn-imprimir')  ?.addEventListener('click', () => window.print());
    document.getElementById('fac-btn-convertir') ?.addEventListener('click', _convertirAFactura);
    document.getElementById('fac-btn-email')     ?.addEventListener('click', async () => { const f = await SB.obtenerFactura(_idFacturaActual); if (f) _compartirEmail(f); });
    document.getElementById('fac-btn-whatsapp')  ?.addEventListener('click', async () => { const f = await SB.obtenerFactura(_idFacturaActual); if (f) _compartirWhatsApp(f); });
    document.getElementById('fac-btn-add-linea') ?.addEventListener('click', () => _agregarLinea());
    document.getElementById('fac-selector-platos')?.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      if (!opt.value) return;
      _agregarLinea(opt.dataset.nombre, parseFloat(opt.dataset.precio) || 0, 1);
      e.target.value = '';
    });
    document.getElementById('fac-iva') ?.addEventListener('input',  _calcularTotales);
    document.getElementById('fac-irpf')?.addEventListener('change', _calcularTotales);

    _actualizarSubTabs();
    await _renderLista();
    _mostrarVista('lista');
  }

  return {
    init, verFactura, editarFactura, togglePagada, borrarFactura,
    aceptarPresupuesto, compartirEmail, compartirWhatsApp,
    _actualizarLinea, _eliminarLinea,
    _editarBebida, _borrarBebida
  };

})();
