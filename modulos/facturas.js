// ============================================================
// modulos/facturas.js — Facturas y Presupuestos (Supabase)
// Depende de: core/supabase.js, core/voz.js
// ============================================================

const ModuloFacturas = (() => {

  let _idFacturaActual  = null;
  let _lineas           = [];
  let _tipoVista        = 'factura';  // sub-tab: 'factura' | 'presupuesto'
  let _tipoActual       = 'factura';

  // ----------------------------------------------------------
  // VISTAS
  // ----------------------------------------------------------

  function _mostrarVista(cual) {
    ['fac-vista-lista', 'fac-vista-formulario', 'fac-vista-detalle', 'fac-vista-informe'].forEach(id => {
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
        <strong>${dinero(f.total)} €</strong>
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
    _lineas          = factura ? JSON.parse(JSON.stringify(factura.lineas || [])) : [];

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
    div.innerHTML = _buildDetalleHTML(f);
  }

  function _buildDetalleHTML(f) {
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

    return `
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
          <div class="fac-fila-total"><span>Base imponible:</span><span>${dinero(f.subtotal)} €</span></div>
          <div class="fac-fila-total"><span>${impNom} (${f.porcentajeIgic}%):</span><span>${dinero(f.cuotaIgic)} €</span></div>
          ${irpfHtml}
          <div class="fac-fila-total fac-total-final">
            <span>${esPres ? 'TOTAL ESTIMADO:' : 'TOTAL A PAGAR:'}</span>
            <span>${dinero(f.total)} €</span>
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

  // ----------------------------------------------------------
  // GENERACIÓN DE PDF Y COMPARTIR COMO ARCHIVO
  // ----------------------------------------------------------

  function _nombreArchivoPdf(f) {
    const tipo = f.tipo === 'presupuesto' ? 'Presupuesto' : 'Factura';
    return `${tipo}_${f.numero}_${(f.cliente || '').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  }

  async function _generarPdfBlob(f) {
    const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDFCtor) throw new Error('La librería para crear PDFs aún no se ha cargado. Espera un momento e inténtalo de nuevo.');

    const cfg     = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const empresa = cfg.razonSocial || 'MI RESTAURANTE';
    const esPres  = f.tipo === 'presupuesto';
    const impNom  = (cfg.regimen || 'igic') === 'iva' ? 'IVA' : 'IGIC';
    const leyRef  = (cfg.regimen || 'igic') === 'iva'
      ? 'Ley 37/1992 del IVA' : 'Ley 20/1991 del IGIC (Canarias)';

    const doc = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const PAGINA_W = 210, PAGINA_H = 297;
    const ML = 15, MR = 15, MT = 18, MB = 20;
    const W = PAGINA_W - ML - MR;
    let y = MT;

    const setColor = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    const linea = (x1, y1, x2, y2, color, grosor) => {
      doc.setDrawColor(color[0], color[1], color[2]);
      doc.setLineWidth(grosor);
      doc.line(x1, y1, x2, y2);
    };
    const checkNuevaPagina = (alturaNecesaria) => {
      if (y + alturaNecesaria > PAGINA_H - MB) { doc.addPage(); y = MT; }
    };

    // ----- CABECERA: Empresa izquierda, doc derecha -----
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    setColor([20, 20, 30]);
    doc.text(empresa, ML, y);
    let yIzq = y + 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setColor([85, 85, 85]);
    const lineasEmpresa = [
      cfg.nif       ? `NIF/CIF: ${cfg.nif}` : null,
      cfg.direccion || null,
      [cfg.cp, cfg.ciudad].filter(Boolean).join(' ') || null,
      cfg.provincia || null,
      cfg.telefono  ? `Tel: ${cfg.telefono}` : null,
      cfg.email     || null,
      cfg.web       || null,
    ].filter(Boolean);
    lineasEmpresa.forEach(t => { doc.text(t, ML, yIzq); yIzq += 4; });

    // Documento (derecha)
    let yDer = y;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    setColor([192, 57, 43]);
    doc.text(esPres ? 'PRESUPUESTO' : 'FACTURA', PAGINA_W - MR, yDer, { align: 'right' });
    yDer += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    setColor([60, 60, 60]);
    doc.text(`Nº: ${f.numero}`, PAGINA_W - MR, yDer, { align: 'right' }); yDer += 5;
    doc.text(`Fecha: ${VOZ.formatearFechaSolo(f.fecha)}`, PAGINA_W - MR, yDer, { align: 'right' }); yDer += 5;
    if (f.vencimiento) {
      doc.text(`${esPres ? 'Válido hasta' : 'Vencimiento'}: ${VOZ.formatearFechaSolo(f.vencimiento)}`, PAGINA_W - MR, yDer, { align: 'right' });
      yDer += 5;
    }

    y = Math.max(yIzq, yDer) + 3;
    linea(ML, y, PAGINA_W - MR, y, [26, 26, 46], 0.7);
    y += 7;

    // ----- DATOS DEL CLIENTE -----
    const altoCliente = 16 + (f.direccion ? 4 : 0);
    doc.setFillColor(245, 245, 245);
    doc.rect(ML, y, W, altoCliente, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setColor([110, 110, 110]);
    doc.text('DATOS DEL CLIENTE', ML + 3, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setColor([20, 20, 20]);
    doc.text(f.cliente || '—', ML + 3, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setColor([70, 70, 70]);
    const extra = [f.nif ? `NIF/CIF: ${f.nif}` : null].filter(Boolean).join('  ·  ');
    if (extra) doc.text(extra, ML + 3, y + 14);
    if (f.direccion) doc.text(f.direccion, ML + 3, y + 18);
    y += altoCliente + 5;

    // Evento (presupuesto)
    if (esPres && f.descripcionEvento) {
      const ev = `Evento: ${f.descripcionEvento}` + (f.fechaEvento ? ` · ${VOZ.formatearFechaSolo(f.fechaEvento)}` : '');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      setColor([60, 60, 60]);
      const lineas = doc.splitTextToSize(ev, W);
      doc.text(lineas, ML, y);
      y += lineas.length * 4 + 3;
    }

    // ----- TABLA DE CONCEPTOS -----
    const headerH = 8;
    checkNuevaPagina(headerH + 10);
    doc.setFillColor(26, 26, 46);
    doc.rect(ML, y, W, headerH, 'F');
    setColor([255, 255, 255]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const colCantX = ML + W - 70;
    const colPrecX = ML + W - 45;
    const colImpX  = ML + W - 2;
    doc.text('Concepto', ML + 2, y + 5.5);
    doc.text('Cant.',    colCantX + 5,  y + 5.5, { align: 'right' });
    doc.text('P. Unit.', colPrecX + 5,  y + 5.5, { align: 'right' });
    doc.text('Importe',  colImpX,       y + 5.5, { align: 'right' });
    y += headerH;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    setColor([30, 30, 30]);
    for (const l of (f.lineas || [])) {
      const descLineas = doc.splitTextToSize(l.descripcion || '', colCantX - ML - 4);
      const rowH = Math.max(6, descLineas.length * 4.2 + 2);
      checkNuevaPagina(rowH + 30);
      doc.text(descLineas, ML + 2, y + 4);
      doc.text(String(l.cantidad || 0),                     colCantX + 5, y + 4, { align: 'right' });
      doc.text(`${(l.precioUnitario || 0).toFixed(2)} €`,    colPrecX + 5, y + 4, { align: 'right' });
      doc.text(`${(l.subtotal       || 0).toFixed(2)} €`,    colImpX,      y + 4, { align: 'right' });
      y += rowH;
      linea(ML, y, ML + W, y, [225, 225, 225], 0.2);
    }
    y += 5;

    // ----- TOTALES -----
    checkNuevaPagina(35);
    const totalsLabelX = ML + W - 60;
    const totalsValX   = ML + W;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    setColor([70, 70, 70]);
    doc.text('Base imponible:',                  totalsLabelX, y);
    doc.text(`${dinero(f.subtotal)} €`,       totalsValX,   y, { align: 'right' });
    y += 5;
    doc.text(`${impNom} (${f.porcentajeIgic}%):`, totalsLabelX, y);
    doc.text(`${dinero(f.cuotaIgic)} €`,       totalsValX,   y, { align: 'right' });
    y += 5;
    if ((f.retencionIrpf || 0) > 0) {
      setColor([192, 57, 43]);
      doc.text(`Retención IRPF (${f.retencionIrpf}%):`, totalsLabelX, y);
      doc.text(`-${(f.cuotaIrpf || 0).toFixed(2)} €`,   totalsValX,   y, { align: 'right' });
      y += 5;
    }
    linea(totalsLabelX, y, totalsValX, y, [26, 26, 46], 0.5);
    y += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    setColor([20, 20, 20]);
    doc.text(esPres ? 'TOTAL ESTIMADO:' : 'TOTAL A PAGAR:', totalsLabelX, y + 3);
    doc.text(`${dinero(f.total)} €`, totalsValX, y + 3, { align: 'right' });
    y += 12;

    // ----- FORMA DE PAGO -----
    if (!esPres && f.formaPago) {
      const labels = { efectivo: 'Efectivo', transferencia: 'Transferencia bancaria', tarjeta: 'Tarjeta', cheque: 'Cheque' };
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      setColor([20, 20, 20]);
      doc.text('Forma de pago: ', ML, y);
      doc.setFont('helvetica', 'normal');
      doc.text(labels[f.formaPago] || f.formaPago, ML + 32, y);
      y += 5;
      if (f.formaPago === 'transferencia' && cfg.iban) {
        doc.setFont('helvetica', 'bold');
        doc.text('IBAN: ', ML, y);
        doc.setFont('helvetica', 'normal');
        doc.text(cfg.iban, ML + 14, y);
        y += 5;
      }
      y += 2;
    }

    // ----- NOTAS -----
    if (f.notas) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      setColor([85, 85, 85]);
      const lineas = doc.splitTextToSize(`Notas: ${f.notas}`, W);
      checkNuevaPagina(lineas.length * 4 + 4);
      doc.text(lineas, ML, y);
      y += lineas.length * 4 + 4;
    }

    // ----- PIE LEGAL -----
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      linea(ML, PAGINA_H - 14, PAGINA_W - MR, PAGINA_H - 14, [200, 200, 200], 0.3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      setColor([130, 130, 130]);
      const pie = esPres
        ? `Presupuesto sin valor contractual hasta su aceptación formal. Emitido conforme a la ${leyRef}.`
        : `Factura emitida conforme a la ${leyRef}. Sujeto pasivo: ${empresa}${cfg.nif ? ' · NIF/CIF: ' + cfg.nif : ''}.`;
      const pieLineas = doc.splitTextToSize(pie, W);
      doc.text(pieLineas, ML, PAGINA_H - 10);
      doc.text(`Pág. ${p} / ${totalPages}`, PAGINA_W - MR, PAGINA_H - 6, { align: 'right' });
    }

    return doc.output('blob');
  }

  function _mostrarLoadingCompartir(mostrar) {
    let el = document.getElementById('fac-compartir-loading');
    if (mostrar) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'fac-compartir-loading';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;color:white;font-size:1.1rem;';
        el.innerHTML = '<div style="background:#222;padding:24px 36px;border-radius:8px;text-align:center"><div style="font-size:2rem;margin-bottom:8px">📄</div>Generando PDF…</div>';
        document.body.appendChild(el);
      }
    } else if (el) {
      el.remove();
    }
  }

  function _descargarBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function _compartirArchivo(f, opciones) {
    const { texto, asunto, urlFallback, app } = opciones;
    _mostrarLoadingCompartir(true);
    let blob;
    try {
      blob = await _generarPdfBlob(f);
    } catch (e) {
      _mostrarLoadingCompartir(false);
      alert('Error al generar el PDF:\n' + e.message);
      return;
    }
    _mostrarLoadingCompartir(false);

    const filename = _nombreArchivoPdf(f);
    const file     = new File([blob], filename, { type: 'application/pdf' });

    // 1) Web Share API con archivo (funciona en móvil y Chrome desktop reciente)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: asunto, text: texto });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;  // usuario canceló
        console.warn('[Facturas] Web Share falló, usando descarga:', err);
      }
    }

    // 2) Fallback: descargar PDF + abrir email/WhatsApp para que adjunte
    _descargarBlob(blob, filename);
    alert(`Se ha descargado "${filename}".\nAhora se abrirá ${app}. Adjunta el archivo descargado y envía el mensaje.`);
    window.open(urlFallback, '_blank');
  }

  async function _compartirEmail(f) {
    const { empresa, esPres } = _textoFactura(f);
    const cfg    = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const asunto = `${esPres ? 'Presupuesto' : 'Factura'} ${f.numero} — ${empresa}`;
    const texto  = [
      `Estimado/a ${f.cliente},`,
      '',
      `Le adjunto ${esPres ? 'el presupuesto' : 'la factura'} nº ${f.numero} con fecha ${VOZ.formatearFechaSolo(f.fecha)}.`,
      `Importe total: ${dinero(f.total)} €.`,
      '',
      'Atentamente,',
      empresa,
      cfg.telefono ? `Tel: ${cfg.telefono}` : '',
      cfg.email    ? cfg.email : '',
    ].filter(l => l !== '').join('\n').trim();
    const urlFallback = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`;
    await _compartirArchivo(f, { asunto, texto, urlFallback, app: 'tu cliente de correo' });
  }

  async function _compartirWhatsApp(f) {
    const { empresa, esPres } = _textoFactura(f);
    const tipoDoc = esPres ? 'presupuesto' : 'factura';
    const texto = `Hola ${f.cliente},\nTe adjunto el ${tipoDoc} ${f.numero} (${dinero(f.total)} €).\nUn saludo,\n${empresa}`;
    const urlFallback = 'https://wa.me/?text=' + encodeURIComponent(texto);
    await _compartirArchivo(f, { asunto: `${esPres ? 'Presupuesto' : 'Factura'} ${f.numero}`, texto, urlFallback, app: 'WhatsApp' });
  }

  async function compartirEmail(id) {
    const f = await SB.obtenerFactura(id);
    if (f) await _compartirEmail(f);
  }

  async function compartirWhatsApp(id) {
    const f = await SB.obtenerFactura(id);
    if (f) await _compartirWhatsApp(f);
  }

  // ----------------------------------------------------------
  // UTILIDADES
  // ----------------------------------------------------------

  function _setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
  function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ----------------------------------------------------------
  // INFORME FISCAL (resumen por trimestre del año seleccionado)
  // ----------------------------------------------------------

  let _infFacturas = [];   // cache de facturas para el informe
  let _infAnyo     = '';

  function _trimestre(fecha) { return Math.floor((parseInt((fecha || '').slice(5, 7), 10) - 1) / 3); } // 0..3

  async function _abrirInforme() {
    _mostrarVista('informe');
    const cont = document.getElementById('fac-informe-contenido');
    if (cont) cont.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      _infFacturas = await SB.obtenerFacturas(); // solo tipo=factura
    } catch (e) {
      if (cont) cont.innerHTML = `<p class="texto-vacio error-texto">Error: ${_esc(e.message)}</p>`;
      return;
    }
    const anyos = [...new Set(_infFacturas.map(f => (f.fecha || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    if (!anyos.length) anyos.push(String(new Date().getFullYear()));
    const sel = document.getElementById('fac-inf-anyo');
    if (sel) {
      sel.innerHTML = anyos.map(a => `<option value="${a}">${a}</option>`).join('');
      _infAnyo = anyos.includes(_infAnyo) ? _infAnyo : anyos[0];
      sel.value = _infAnyo;
    }
    _renderInforme();
  }

  function _renderInforme() {
    const cont = document.getElementById('fac-informe-contenido');
    if (!cont) return;
    const anyo = document.getElementById('fac-inf-anyo')?.value || _infAnyo;
    _infAnyo = anyo;
    const delAnyo = _infFacturas.filter(f => (f.fecha || '').startsWith(anyo));

    const acc = [0, 1, 2, 3].map(() => ({ base: 0, igic: 0, irpf: 0, total: 0, n: 0 }));
    let pagadas = 0, pendientes = 0;
    for (const f of delAnyo) {
      const a = acc[_trimestre(f.fecha)] || acc[0];
      a.base  += Number(f.subtotal)  || 0;
      a.igic  += Number(f.cuotaIgic) || 0;
      a.irpf  += Number(f.cuotaIrpf) || 0;
      a.total += Number(f.total)     || 0;
      a.n++;
      if (f.pagada) pagadas += Number(f.total) || 0; else pendientes += Number(f.total) || 0;
    }
    const tot = acc.reduce((t, a) => ({
      base: t.base + a.base, igic: t.igic + a.igic, irpf: t.irpf + a.irpf, total: t.total + a.total, n: t.n + a.n,
    }), { base: 0, igic: 0, irpf: 0, total: 0, n: 0 });

    const fila = (et, a) => `<tr>
      <td>${et}</td>
      <td style="text-align:center">${a.n}</td>
      <td style="text-align:right">${dinero(a.base)} €</td>
      <td style="text-align:right">${dinero(a.igic)} €</td>
      <td style="text-align:right">${a.irpf ? '−' + dinero(a.irpf) + ' €' : '—'}</td>
      <td style="text-align:right"><strong>${dinero(a.total)} €</strong></td>
    </tr>`;

    if (!delAnyo.length) {
      cont.innerHTML = `<p class="texto-vacio">No hay facturas en ${anyo}.</p>`;
      return;
    }
    cont.innerHTML = `
      <div class="tarjeta" style="overflow-x:auto">
        <table class="tabla-informe" style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left">Periodo</th><th>Nº</th>
            <th style="text-align:right">Base imponible</th>
            <th style="text-align:right">IGIC repercutido</th>
            <th style="text-align:right">IRPF retenido</th>
            <th style="text-align:right">Total facturado</th>
          </tr></thead>
          <tbody>
            ${[0,1,2,3].map(i => fila('Trimestre ' + (i + 1), acc[i])).join('')}
          </tbody>
          <tfoot><tr style="border-top:2px solid var(--borde,#444);font-weight:700">
            ${fila('TOTAL ' + anyo, tot).replace('<td>', '<td><strong>').replace('</td>', '</strong></td>')}
          </tr></tfoot>
        </table>
      </div>
      <div class="flexwrap" style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">
        <div class="tarjeta" style="flex:1;min-width:160px;text-align:center">
          <div style="font-size:.8rem;color:var(--texto2)">Cobrado</div>
          <div style="font-size:1.3rem;font-weight:700;color:var(--ok,#27ae60)">${dinero(pagadas)} €</div>
        </div>
        <div class="tarjeta" style="flex:1;min-width:160px;text-align:center">
          <div style="font-size:.8rem;color:var(--texto2)">Pendiente de cobro</div>
          <div style="font-size:1.3rem;font-weight:700;color:var(--am,#f39c12)">${dinero(pendientes)} €</div>
        </div>
      </div>
      <p style="font-size:.75rem;color:var(--texto2);margin-top:10px">Resumen orientativo de las facturas emitidas. No sustituye al asesoramiento fiscal.</p>`;
  }

  function _exportarInformeCsv() {
    const anyo = _infAnyo || String(new Date().getFullYear());
    const delAnyo = _infFacturas.filter(f => (f.fecha || '').startsWith(anyo))
      .sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const filas = [['Numero', 'Fecha', 'Cliente', 'NIF', 'Base', 'IGIC', 'IRPF', 'Total', 'Pagada']];
    for (const f of delAnyo) {
      filas.push([
        f.numero, f.fecha, (f.cliente || '').replace(/;/g, ','), f.nif || '',
        dinero(f.subtotal), dinero(f.cuotaIgic), dinero(f.cuotaIrpf), dinero(f.total), f.pagada ? 'Si' : 'No',
      ]);
    }
    const csv  = filas.map(r => r.join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `facturacion-${anyo}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

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

    document.getElementById('fac-btn-nueva')     ?.addEventListener('click', () => _abrirFormulario(null, 'factura'));
    document.getElementById('fac-btn-nuevo-pres') ?.addEventListener('click', () => _abrirFormulario(null, 'presupuesto'));
    document.getElementById('fac-btn-guardar')   ?.addEventListener('click', _guardarFactura);
    document.getElementById('fac-btn-cancelar')  ?.addEventListener('click', async () => { _mostrarVista('lista'); await _renderLista(); });
    document.getElementById('fac-btn-volver')    ?.addEventListener('click', async () => { _mostrarVista('lista'); await _renderLista(); });
    document.getElementById('fac-btn-informe')   ?.addEventListener('click', _abrirInforme);
    document.getElementById('fac-inf-volver')    ?.addEventListener('click', async () => { _mostrarVista('lista'); await _renderLista(); });
    document.getElementById('fac-inf-anyo')      ?.addEventListener('change', _renderInforme);
    document.getElementById('fac-inf-csv')       ?.addEventListener('click', _exportarInformeCsv);
    document.getElementById('fac-btn-imprimir')  ?.addEventListener('click', () => window.print());
    document.getElementById('fac-btn-convertir') ?.addEventListener('click', _convertirAFactura);
    document.getElementById('fac-btn-email')     ?.addEventListener('click', async () => { const f = await SB.obtenerFactura(_idFacturaActual); if (f) await _compartirEmail(f); });
    document.getElementById('fac-btn-whatsapp')  ?.addEventListener('click', async () => { const f = await SB.obtenerFactura(_idFacturaActual); if (f) await _compartirWhatsApp(f); });
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
    _actualizarLinea, _eliminarLinea
  };

})();
