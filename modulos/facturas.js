// ============================================================
// modulos/facturas.js — Gestión de facturas (Supabase)
// Depende de: core/supabase.js, core/voz.js
// IGIC: Impuesto General Indirecto Canario (Ley 20/1991)
// ============================================================

const ModuloFacturas = (() => {

  let _idFacturaActual = null;
  let _lineas = [];

  // ----------------------------------------------------------
  // VISTAS
  // ----------------------------------------------------------

  function _mostrarVista(cual) {
    ['fac-vista-lista', 'fac-vista-formulario', 'fac-vista-detalle'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === 'fac-vista-' + cual ? 'block' : 'none';
    });
  }

  // ----------------------------------------------------------
  // LISTA DE FACTURAS
  // ----------------------------------------------------------

  async function _renderLista() {
    const lista = document.getElementById('fac-lista');
    if (!lista) return;
    lista.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      const facturas = await SB.obtenerFacturas();
      if (!facturas?.length) { lista.innerHTML = '<p class="texto-vacio">No hay facturas todavía. Crea la primera.</p>'; return; }
      lista.innerHTML = facturas.map(f => {
        const cls  = f.pagada ? 'estado-pagada' : 'estado-pendiente';
        const etiq = f.pagada ? '✔ Pagada' : '⏳ Pendiente';
        return `<div class="card-factura" data-id="${f.id}">
          <div class="fac-card-cabecera">
            <div class="fac-card-numero">Factura ${f.numero}</div>
            <div class="badge-estado ${cls}">${etiq}</div>
          </div>
          <div class="fac-card-cliente">${_esc(f.cliente)}</div>
          <div class="fac-card-meta">
            <span>${VOZ.formatearFechaSolo(f.fecha)}</span>
            <strong>${f.total.toFixed(2)} €</strong>
          </div>
          <div class="card-acciones">
            <button class="btn-mini btn-ver"    onclick="ModuloFacturas.verFactura('${f.id}')">👁 Ver</button>
            <button class="btn-mini btn-editar" onclick="ModuloFacturas.editarFactura('${f.id}')">✏ Editar</button>
            <button class="btn-mini ${f.pagada ? 'btn-borrar' : 'btn-pagar'}"
                    onclick="ModuloFacturas.togglePagada('${f.id}',${f.pagada})">
              ${f.pagada ? '↩ Pendiente' : '✔ Pagada'}
            </button>
            <button class="btn-mini btn-borrar" onclick="ModuloFacturas.borrarFactura('${f.id}','${f.numero}')">🗑</button>
          </div>
        </div>`;
      }).join('');
    } catch (e) { lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${e.message}</p>`; }
  }

  // ----------------------------------------------------------
  // FORMULARIO
  // ----------------------------------------------------------

  async function _abrirFormulario(factura = null) {
    _idFacturaActual = factura ? factura.id : null;
    _lineas = factura ? JSON.parse(JSON.stringify(factura.lineas)) : [];

    document.getElementById('fac-form-titulo').textContent = factura ? `Editar Factura ${factura.numero}` : 'Nueva Factura';
    document.getElementById('fac-cliente').value   = factura?.cliente   || '';
    document.getElementById('fac-nif').value        = factura?.nif       || '';
    document.getElementById('fac-direccion').value  = factura?.direccion || '';
    document.getElementById('fac-fecha').value      = factura
      ? (typeof factura.fecha === 'string' ? factura.fecha.split('T')[0] : factura.fecha)
      : new Date().toISOString().split('T')[0];
    document.getElementById('fac-iva').value           = factura?.porcentajeIgic ?? 7;
    document.getElementById('fac-notas').value         = factura?.notas || '';
    document.getElementById('fac-irpf').value          = factura?.retencionIrpf ?? 0;
    document.getElementById('fac-forma-pago').value    = factura?.formaPago || 'efectivo';
    document.getElementById('fac-vencimiento').value   = factura?.vencimiento
      ? (typeof factura.vencimiento === 'string' ? factura.vencimiento.split('T')[0] : factura.vencimiento)
      : '';

    await _renderSelectorPlatos();
    _renderLineas();
    _mostrarVista('formulario');
    document.getElementById('fac-cliente').focus();
  }

  async function _renderSelectorPlatos() {
    const sel = document.getElementById('fac-selector-platos');
    if (!sel) return;
    try {
      const platos = await SB.obtenerPlatos();
      sel.innerHTML = '<option value="">— Importar plato de la carta —</option>'
        + (platos || []).map(p => `<option value="${p.id}" data-nombre="${_esc(p.nombre)}" data-precio="${p.precio}">${p.nombre}${p.precio > 0 ? ' (' + p.precio.toFixed(2) + ' €)' : ''}</option>`).join('');
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
    const subtotal   = _lineas.reduce((s, l) => s + (l.subtotal || 0), 0);
    const pIgic      = parseFloat(document.getElementById('fac-iva')?.value) || 0;
    const cuotaIgic  = subtotal * pIgic / 100;
    const pIrpf      = parseFloat(document.getElementById('fac-irpf')?.value) || 0;
    const cuotaIrpf  = subtotal * pIrpf / 100;
    const total      = subtotal + cuotaIgic - cuotaIrpf;

    const cfg    = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const impNom = cfg.regimen === 'iva' ? 'IVA' : 'IGIC';

    _setText('fac-subtotal',  subtotal.toFixed(2)  + ' €');
    _setText('fac-cuota-iva', cuotaIgic.toFixed(2) + ' €');
    _setText('fac-iva-label', `${impNom} (${pIgic}%)`);
    _setText('fac-irpf-label', `IRPF (−${pIrpf}%)`);
    _setText('fac-cuota-irpf', cuotaIrpf.toFixed(2) + ' €');
    _setText('fac-total',      total.toFixed(2)      + ' €');

    const filaIrpf = document.getElementById('fac-fila-irpf');
    if (filaIrpf) filaIrpf.style.display = pIrpf > 0 ? 'flex' : 'none';
  }

  async function _guardarFactura() {
    const cliente = document.getElementById('fac-cliente').value.trim();
    if (!cliente)       { alert('El nombre del cliente es obligatorio.'); return; }
    if (!_lineas.length){ alert('Añade al menos una línea a la factura.'); return; }

    const subtotal      = _lineas.reduce((s, l) => s + (l.subtotal || 0), 0);
    const porcentajeIgic= parseFloat(document.getElementById('fac-iva').value) || 0;
    const cuotaIgic     = subtotal * porcentajeIgic / 100;
    const retencionIrpf = parseFloat(document.getElementById('fac-irpf').value) || 0;
    const cuotaIrpf     = subtotal * retencionIrpf / 100;

    const datos = {
      numero:         _idFacturaActual ? (await SB.obtenerFactura(_idFacturaActual)).numero : await SB.siguienteNumeroFactura(),
      cliente,
      nif:            document.getElementById('fac-nif').value.trim(),
      direccion:      document.getElementById('fac-direccion').value.trim(),
      fecha:          document.getElementById('fac-fecha').value,
      lineas:         _lineas,
      subtotal,
      porcentajeIgic,
      cuotaIgic,
      retencionIrpf,
      cuotaIrpf,
      total:          subtotal + cuotaIgic - cuotaIrpf,
      pagada:         _idFacturaActual ? (await SB.obtenerFactura(_idFacturaActual)).pagada : false,
      notas:          document.getElementById('fac-notas').value.trim(),
      formaPago:      document.getElementById('fac-forma-pago').value || 'efectivo',
      vencimiento:    document.getElementById('fac-vencimiento').value || null,
    };

    if (_idFacturaActual !== null) {
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

    const irpfPct  = f.retencionIrpf || 0;
    const irpfAmt  = f.cuotaIrpf     || 0;
    const irpfHtml = irpfPct > 0
      ? `<div class="fac-fila-total"><span>Retención IRPF (${irpfPct}%):</span><span style="color:#c00">−${irpfAmt.toFixed(2)} €</span></div>`
      : '';

    const pagoLabels = { efectivo:'Efectivo', transferencia:'Transferencia bancaria', tarjeta:'Tarjeta', cheque:'Cheque' };
    const pagoLabel  = pagoLabels[f.formaPago] || '';
    const ibanHtml   = (f.formaPago === 'transferencia' && cfg.iban)
      ? `<br><strong>IBAN:</strong> ${_esc(cfg.iban)}`
      : '';
    const vencHtml   = f.vencimiento
      ? `<br><strong>Vencimiento:</strong> ${VOZ.formatearFechaSolo(f.vencimiento)}`
      : '';

    div.innerHTML = `
      <div class="factura-imprimible">
        <div class="fac-cabecera-print">
          <div class="fac-emisor">
            <strong class="fac-emisor-nombre">${_esc(emisorNombre)}</strong>
            ${emisorLineas ? `<div class="fac-emisor-datos">${emisorLineas}</div>` : ''}
          </div>
          <div class="fac-titulo-doc">
            <div class="fac-numero-grande">FACTURA</div>
            <div class="fac-meta-item"><span>Número:</span> ${_esc(f.numero)}</div>
            <div class="fac-meta-item"><span>Fecha:</span> ${VOZ.formatearFechaSolo(f.fecha)}</div>
            ${f.vencimiento ? `<div class="fac-meta-item"><span>Vencimiento:</span> ${VOZ.formatearFechaSolo(f.vencimiento)}</div>` : ''}
          </div>
        </div>

        <div class="fac-receptor">
          <div class="fac-receptor-titulo">Datos del cliente</div>
          <strong>${_esc(f.cliente)}</strong>
          ${f.nif       ? `<br>NIF/CIF: ${_esc(f.nif)}`    : ''}
          ${f.direccion ? `<br>${_esc(f.direccion)}`        : ''}
        </div>

        <table class="fac-tabla-lineas">
          <thead>
            <tr>
              <th>Concepto</th>
              <th class="td-num">Cant.</th>
              <th class="td-num">P. Unit.</th>
              <th class="td-num">Importe</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>

        <div class="fac-totales">
          <div class="fac-fila-total"><span>Base imponible:</span><span>${f.subtotal.toFixed(2)} €</span></div>
          <div class="fac-fila-total"><span>${impNom} (${f.porcentajeIgic}%):</span><span>${f.cuotaIgic.toFixed(2)} €</span></div>
          ${irpfHtml}
          <div class="fac-fila-total fac-total-final"><span>TOTAL A PAGAR:</span><span>${f.total.toFixed(2)} €</span></div>
        </div>

        ${pagoLabel ? `<div class="fac-pago"><strong>Forma de pago:</strong> ${_esc(pagoLabel)}${ibanHtml}${vencHtml}</div>` : ''}
        ${f.notas   ? `<div class="fac-notas">Notas: ${_esc(f.notas)}</div>` : ''}

        <div class="fac-pie-legal">
          Factura emitida conforme a la ${leyRef}.<br>
          Sujeto pasivo: ${_esc(emisorNombre)}${cfg.nif ? ' · NIF/CIF: ' + _esc(cfg.nif) : ''}
          ${f.pagada ? '<br><strong>✔ PAGADA</strong>' : ''}
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

  async function borrarFactura(id, numero) {
    if (!confirm(`¿Eliminar la factura ${numero}? Esta acción no se puede deshacer.`)) return;
    await SB.borrarFactura(id);
    await _renderLista();
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
    document.getElementById('fac-btn-nueva')?.addEventListener('click', () => _abrirFormulario());
    document.getElementById('fac-btn-guardar')?.addEventListener('click', _guardarFactura);
    document.getElementById('fac-btn-cancelar')?.addEventListener('click', async () => { _mostrarVista('lista'); await _renderLista(); });
    document.getElementById('fac-btn-volver')?.addEventListener('click', async () => { _mostrarVista('lista'); await _renderLista(); });
    document.getElementById('fac-btn-imprimir')?.addEventListener('click', () => window.print());
    document.getElementById('fac-btn-add-linea')?.addEventListener('click', () => _agregarLinea());
    document.getElementById('fac-selector-platos')?.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      if (!opt.value) return;
      _agregarLinea(opt.dataset.nombre, parseFloat(opt.dataset.precio) || 0, 1);
      e.target.value = '';
    });
    document.getElementById('fac-iva')?.addEventListener('input', _calcularTotales);
    document.getElementById('fac-irpf')?.addEventListener('change', _calcularTotales);
    await _renderLista();
    _mostrarVista('lista');
  }

  return {
    init, verFactura, editarFactura, togglePagada, borrarFactura,
    _actualizarLinea, _eliminarLinea
  };

})();
