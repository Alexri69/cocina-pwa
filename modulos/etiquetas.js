// ============================================================
// modulos/etiquetas.js — Etiquetado de recipientes abiertos
// Depende de: core/bd.js, core/voz.js
// Ofrece dos modos: flujo guiado por voz y formulario manual.
// ============================================================

const ModuloEtiquetas = (() => {

  const ALERGENOS = [
    'gluten','crustáceos','huevo','pescado','cacahuetes','soja','leche',
    'frutos de cáscara','apio','mostaza','granos de sésamo',
    'altramuces','moluscos','sulfitos'
  ];

  const PASOS = {
    INACTIVO:'INACTIVO', NOMBRE:'NOMBRE', LOTE:'LOTE', DIAS:'DIAS',
    ALERGENO:'ALERGENO', CONFIRMAR:'CONFIRMAR', GUARDADO:'GUARDADO'
  };

  let estado = {
    paso: PASOS.INACTIVO,
    indiceAlergeno: 0,
    cancelado: false,
    producto: {}
  };

  // ----------------------------------------------------------
  // CAMBIO DE MODO (VOZ / MANUAL)
  // ----------------------------------------------------------

  function _activarModo(modo) {
    document.querySelectorAll('.etq-modo-tab').forEach(b =>
      b.classList.toggle('activo', b.dataset.modo === modo)
    );
    document.getElementById('etq-panel-voz').style.display    = modo === 'voz'    ? 'block' : 'none';
    document.getElementById('etq-panel-manual').style.display = modo === 'manual' ? 'block' : 'none';
  }

  // ----------------------------------------------------------
  // MODO MANUAL
  // ----------------------------------------------------------

  function _renderAlergenos() {
    const cont = document.getElementById('etq-m-alergenos');
    if (!cont) return;
    cont.innerHTML = ALERGENOS.map((a, i) => `
      <label class="check-alergeno">
        <input type="checkbox" id="etq-m-al-${i}"> ${a}
      </label>`).join('');
  }

  function _setFechaAhora() {
    const el = document.getElementById('etq-m-apertura');
    if (!el) return;
    const ahora = new Date();
    // datetime-local necesita "YYYY-MM-DDTHH:MM"
    const pad = n => String(n).padStart(2, '0');
    el.value = `${ahora.getFullYear()}-${pad(ahora.getMonth()+1)}-${pad(ahora.getDate())}T${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`;
  }

  async function _generarManual() {
    const nombre = document.getElementById('etq-m-nombre').value.trim();
    const lote   = document.getElementById('etq-m-lote').value.trim();
    const dias   = parseInt(document.getElementById('etq-m-dias').value) || 0;
    const apert  = document.getElementById('etq-m-apertura').value;

    if (!nombre) { alert('El nombre del producto es obligatorio.'); return; }
    if (!lote)   { alert('El número de lote es obligatorio.');      return; }
    if (dias < 1){ alert('Los días de caducidad deben ser al menos 1.'); return; }

    const fechaApertura  = apert ? new Date(apert) : new Date();
    const fechaCaducidad = new Date(fechaApertura.getTime() + dias * 86400000);
    const alergenos      = ALERGENOS.filter((_, i) => document.getElementById(`etq-m-al-${i}`)?.checked);

    const producto = {
      nombre:         VOZ.capitalizarNombre(nombre),
      lote:           lote.toUpperCase().replace(/\s+/g, ''),
      diasCaducidad:  dias,
      fechaApertura:  fechaApertura.toISOString(),
      fechaCaducidad: fechaCaducidad.toISOString(),
      alergenos,
      timestamp: fechaApertura.getTime()
    };

    const msgEl = document.getElementById('etq-mensaje');
    const btn   = document.getElementById('etq-m-btn-generar');
    if (msgEl) { msgEl.textContent = '⏳ Guardando…'; msgEl.style.color = ''; }
    if (btn) btn.disabled = true;
    try {
      await SB.guardarProducto({ ...producto });
      if (msgEl) { msgEl.textContent = '✔ Guardado correctamente'; msgEl.style.color = '#27ae60'; }
    } catch (e) {
      console.error('[Etiquetas] Error al guardar:', e);
      if (msgEl) { msgEl.textContent = '❌ Error: ' + e.message; msgEl.style.color = '#e74c3c'; }
      alert('Error al guardar la etiqueta:\n' + e.message);
      if (btn) btn.disabled = false;
      return;
    } finally {
      if (btn) btn.disabled = false;
    }

    _mostrarEtiqueta(producto);
    _paginaActual = 0;
    await _actualizarHistorial();
    _revisarYAvisar();
  }

  function _cerrarPreview() {
    _ocultarEtiqueta();
    // Limpiar formulario manual para que esté listo para la siguiente etiqueta
    document.getElementById('etq-m-nombre').value = '';
    document.getElementById('etq-m-lote').value   = '';
    document.getElementById('etq-m-dias').value   = '';
    ALERGENOS.forEach((_, i) => {
      const ck = document.getElementById(`etq-m-al-${i}`);
      if (ck) ck.checked = false;
    });
    _setFechaAhora();
    const msgEl = document.getElementById('etq-mensaje');
    if (msgEl) { msgEl.textContent = 'Listo para la siguiente etiqueta.'; msgEl.style.color = ''; }
  }

  // ----------------------------------------------------------
  // FLUJO DE VOZ
  // ----------------------------------------------------------

  async function iniciarFlujo() {
    estado = {
      paso: PASOS.NOMBRE,
      indiceAlergeno: 0,
      cancelado: false,
      producto: { nombre:'', lote:'', diasCaducidad:0, fechaApertura:'', fechaCaducidad:'', alergenos:[], timestamp:0 }
    };
    _ocultarEtiqueta();
    _setRespuesta('');
    _setProgreso(0);
    await VOZ.hablar('Iniciando registro. ');
    await _despachar();
  }

  async function _despachar() {
    if (estado.cancelado) return;
    try {
      switch (estado.paso) {
        case PASOS.NOMBRE:    await _pasoNombre();    break;
        case PASOS.LOTE:      await _pasoLote();      break;
        case PASOS.DIAS:      await _pasoDias();      break;
        case PASOS.ALERGENO:  await _pasoAlergeno();  break;
        case PASOS.CONFIRMAR: await _pasoConfirmar(); break;
      }
    } catch (e) {
      console.error('[Etiquetas] Error:', e);
      await VOZ.hablar('Ha ocurrido un error. Por favor, inicia el proceso de nuevo.');
      _reiniciar();
    }
  }

  async function _pasoNombre() {
    await VOZ.hablar('¿Qué producto has abierto?');
    try {
      const r = await VOZ.escuchar();
      if (!r || r.length < 2) { await VOZ.hablar('No he entendido el nombre. ¿Puedes repetirlo?'); return _pasoNombre(); }
      estado.producto.nombre = VOZ.capitalizarNombre(r);
      estado.paso = PASOS.LOTE;
      await _despachar();
    } catch { await VOZ.hablar('No te he escuchado. ¿Cuál es el nombre del producto?'); await _pasoNombre(); }
  }

  async function _pasoLote() {
    await VOZ.hablar('¿Número de lote?');
    try {
      const r = await VOZ.escuchar();
      if (!r) { await VOZ.hablar('No he escuchado el lote. Por favor repítelo.'); return _pasoLote(); }
      estado.producto.lote = VOZ.limpiarLote(r);
      estado.paso = PASOS.DIAS;
      await _despachar();
    } catch { await VOZ.hablar('No he captado el lote. Por favor repite.'); await _pasoLote(); }
  }

  async function _pasoDias() {
    await VOZ.hablar('¿En cuántos días caduca una vez abierto?');
    try {
      const r = await VOZ.escuchar();
      const n = VOZ.palabrasANumero(r);
      if (!n || n <= 0 || !Number.isInteger(n)) {
        await VOZ.hablar('Necesito un número entero de días mayor que cero. Por ejemplo: tres, siete. ¿Cuántos días?');
        return _pasoDias();
      }
      estado.producto.diasCaducidad = n;
      estado.paso = PASOS.ALERGENO;
      estado.indiceAlergeno = 0;
      await _despachar();
    } catch { await VOZ.hablar('No he entendido los días. Di solo el número.'); await _pasoDias(); }
  }

  // Detecta qué alérgenos del listado oficial aparecen en el texto libre del usuario
  function _detectarAlergenos(texto) {
    const t = texto.toLowerCase();
    if (/ninguno|no (contiene|tiene)|sin alérgeno|libre/.test(t)) return [];

    const sinonimos = {
      'gluten':            ['gluten','trigo','cebada','avena','centeno','espelta'],
      'crustáceos':        ['crustáceo','crustaceo','marisco','gamba','langosta','cangrejo','langostino'],
      'huevo':             ['huevo'],
      'pescado':           ['pescado','atún','atun','salmón','salmon','bacalao','merluza','boquerón'],
      'cacahuetes':        ['cacahuete','maní','mani'],
      'soja':              ['soja','soya'],
      'leche':             ['leche','lácteo','lacteo','lactosa','mantequilla','queso','nata','yogur'],
      'frutos de cáscara': ['cáscara','cascara','nuez','nueces','almendra','avellana','pistacho','anacardo','piñón','castaña'],
      'apio':              ['apio'],
      'mostaza':           ['mostaza'],
      'granos de sésamo':  ['sésamo','sesamo','tahini'],
      'altramuces':        ['altramuz','altramuces'],
      'moluscos':          ['molusco','calamar','pulpo','mejillón','ostra','berberecho'],
      'sulfitos':          ['sulfito','sulfuroso','azufre'],
    };

    return ALERGENOS.filter(a => (sinonimos[a] || [a]).some(k => t.includes(k)));
  }

  async function _pasoAlergeno() {
    await VOZ.hablar('¿Qué alérgenos contiene? Di los que tiene, por ejemplo: gluten y leche. O di ninguno.');
    try {
      const r = await VOZ.escuchar();
      estado.producto.alergenos = _detectarAlergenos(r);
    } catch {
      await VOZ.hablar('No te he escuchado. ¿Qué alérgenos contiene?');
      return _pasoAlergeno();
    }
    await _confirmarAlergenos();
  }

  async function _confirmarAlergenos() {
    const lista   = estado.producto.alergenos;
    const resumen = lista.length
      ? `He anotado: ${lista.join(', ')}. ¿Falta alguno?`
      : 'Sin alérgenos anotados. ¿Falta alguno?';
    await VOZ.hablar(resumen);

    try {
      const r  = await VOZ.escuchar();
      const sn = VOZ.detectarSiNo(r);

      if (sn === true) {
        await VOZ.hablar('¿Cuál?');
        try {
          const r2     = await VOZ.escuchar();
          const nuevos = _detectarAlergenos(r2);
          if (nuevos.length) {
            nuevos.forEach(a => { if (!estado.producto.alergenos.includes(a)) estado.producto.alergenos.push(a); });
          } else {
            await VOZ.hablar('No he reconocido ese alérgeno. Prueba de nuevo.');
          }
        } catch {
          await VOZ.hablar('No te he escuchado.');
        }
        return _confirmarAlergenos(); // vuelve a confirmar sin reiniciar el proceso
      }

      // sn === false o null → dar por terminado
      estado.paso = PASOS.CONFIRMAR;
      _setProgreso(ALERGENOS.length);
      await _despachar();

    } catch {
      await VOZ.hablar('Responde sí si falta alguno, o no para continuar.');
      return _confirmarAlergenos();
    }
  }

  async function _pasoConfirmar() {
    const ahora = new Date();
    const cad   = new Date(ahora.getTime() + estado.producto.diasCaducidad * 86400000);
    estado.producto.fechaApertura  = ahora.toISOString();
    estado.producto.fechaCaducidad = cad.toISOString();
    estado.producto.timestamp      = ahora.getTime();

    const alVerb = estado.producto.alergenos.length
      ? 'contiene ' + estado.producto.alergenos.join(', ')
      : 'no contiene ningún alérgeno declarado';
    const loteVoz = estado.producto.lote.split('').join(' ');
    const resumen = `He entendido: ${estado.producto.nombre}, lote ${loteVoz}, `
      + `caduca en ${estado.producto.diasCaducidad} días, ${alVerb}. ¿Es correcto?`;

    await VOZ.hablar(resumen);
    try {
      const r  = await VOZ.escuchar();
      const sn = VOZ.detectarSiNo(r);
      if (sn === null) { await VOZ.hablar('Responde sí para confirmar o no para empezar de nuevo.'); return _pasoConfirmar(); }
      if (sn) await _finalizar();
      else    { await VOZ.hablar('De acuerdo, empecemos de nuevo.'); await iniciarFlujo(); }
    } catch { await VOZ.hablar('¿Es correcto? Sí o no.'); await _pasoConfirmar(); }
  }

  async function _finalizar() {
    estado.paso = PASOS.GUARDADO;
    let guardado = false;
    try {
      await SB.guardarProducto({ ...estado.producto });
      guardado = true;
    } catch (e) {
      console.error('[Etiquetas] Error al guardar:', e);
      const msgEl = document.getElementById('etq-mensaje');
      if (msgEl) { msgEl.textContent = '❌ Error al guardar: ' + e.message; msgEl.style.color = '#e74c3c'; }
      await VOZ.hablar('Error al guardar el producto. ' + (navigator.onLine ? 'Hay un problema con el servidor.' : 'Comprueba la conexión a internet.'));
    }

    _mostrarEtiqueta(estado.producto);

    if (guardado) {
      await _actualizarHistorial();
      _revisarYAvisar();
      await VOZ.hablar('Producto guardado. Puedes imprimir cuando quieras.');
    }

    _reiniciar();
  }

  // ----------------------------------------------------------
  // ETIQUETA: RENDER (compartido por voz y manual)
  // ----------------------------------------------------------

  function _mostrarEtiqueta(p) {
    const sec  = document.getElementById('etq-seccion-etiqueta');
    const prev = document.getElementById('etq-preview');
    if (!sec || !prev) return;

    const color = VOZ.calcularColorCaducidad(p.fechaCaducidad);
    const colorTexto = { verde:'✔ EN PLAZO', amarillo:'⚡ CONSUMIR PRONTO', rojo:'✖ CADUCADO' }[color];
    const alText = p.alergenos.length
      ? p.alergenos.map(a => a.toUpperCase()).join(' · ')
      : 'NINGUNO DECLARADO';

    prev.innerHTML = `
      <div class="etiqueta">
        <div class="etiqueta-nombre">${p.nombre.toUpperCase()}</div>
        <div class="etiqueta-lote">Lote: <strong>${p.lote}</strong></div>
        <div class="etiqueta-fecha">Abierto: ${VOZ.formatearFecha(p.fechaApertura)}</div>
        <div class="etiqueta-caducidad ${color}">
          ⏰ Caduca: ${VOZ.formatearFecha(p.fechaCaducidad)} — ${colorTexto}
        </div>
        <div class="etiqueta-alergenos">⚠ ALÉRGENOS: ${alText}</div>
        <div class="etiqueta-normativa">Reg. UE 1169/2011 · RD 126/2015</div>
      </div>`;
    sec.style.display = 'block';
    sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _ocultarEtiqueta() {
    const sec = document.getElementById('etq-seccion-etiqueta');
    if (sec) sec.style.display = 'none';
  }

  // ----------------------------------------------------------
  // IMPRESIÓN
  // ----------------------------------------------------------

  const _CSS_ETIQUETA = `
@page{size:62mm auto;margin:2mm}
body{margin:0;padding:2mm;font-family:Arial,sans-serif}
.etiqueta{width:58mm;border:2px solid #000;padding:3mm 4mm;font-size:8.5pt}
.etiqueta-nombre{font-size:12pt;font-weight:700;border-bottom:1px solid #000;padding-bottom:1mm;margin-bottom:2mm}
.etiqueta-lote,.etiqueta-fecha{margin:1mm 0}
.etiqueta-caducidad{padding:2mm 3mm;margin:2mm 0;border-radius:2px;font-weight:700;color:#fff;font-size:8pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.verde{background:#27ae60!important}.amarillo{background:#e67e22!important}.rojo{background:#e74c3c!important}
.etiqueta-alergenos{font-weight:700;font-size:8pt;margin-top:2mm}
.etiqueta-normativa{font-size:6.5pt;text-align:right;color:#888;margin-top:1mm}`;

  function _escribirVentanaImpresion(win) {
    const preview = document.getElementById('etq-preview');
    if (!preview?.innerHTML) { win.close(); return; }
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>${_CSS_ETIQUETA}</style></head><body>${preview.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 500);
  }

  function _abrirVentanaImpresion() {
    const preview = document.getElementById('etq-preview');
    if (!preview?.innerHTML) { alert('Primero genera una etiqueta.'); return; }
    const win = window.open('', '_blank', 'width=320,height=400');
    if (!win) { alert('El navegador bloqueó la ventana emergente.\nPermite ventanas emergentes para este sitio en la barra de direcciones.'); return; }
    _escribirVentanaImpresion(win);
  }

  async function _imprimir() {
    if (navigator.bluetooth) {
      try { await _imprimirBluetooth(estado.producto); return; }
      catch (e) { console.warn('[Impresora] Bluetooth falló, usando ventana emergente:', e); }
    }
    _abrirVentanaImpresion();
  }

  async function _imprimirBluetooth(p) {
    const SVC  = '000018f0-0000-1000-8000-00805f9b34fb';
    const CHAR = '00002af1-0000-1000-8000-00805f9b34fb';
    const dev  = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SVC] });
    const srv  = await dev.gatt.connect();
    const svc  = await srv.getPrimaryService(SVC);
    const chr  = await svc.getCharacteristic(CHAR);
    const data = _escPos(p);
    for (let i = 0; i < data.length; i += 512) {
      await chr.writeValueWithoutResponse(data.slice(i, i + 512));
      await new Promise(r => setTimeout(r, 50));
    }
  }

  function _escPos(p) {
    const E = 0x1B, G = 0x1D, LF = 0x0A, enc = new TextEncoder();
    const parts = [
      new Uint8Array([E, 0x40]),
      new Uint8Array([E, 0x21, 0x30]), enc.encode(p.nombre.toUpperCase() + '\n'),
      new Uint8Array([E, 0x21, 0x00]), enc.encode('----------------------------\n'),
      enc.encode('Lote: ' + p.lote + '\n'),
      enc.encode('Abierto: ' + VOZ.formatearFecha(p.fechaApertura) + '\n'),
      enc.encode('Caduca: ' + VOZ.formatearFecha(p.fechaCaducidad) + '\n'),
      new Uint8Array([E, 0x45, 0x01]),
      enc.encode((p.alergenos.length ? 'ALERG: ' + p.alergenos.join(', ').toUpperCase() : 'ALERG: NINGUNO') + '\n'),
      new Uint8Array([E, 0x45, 0x00]),
      enc.encode('Reg.UE 1169/2011\n'),
      new Uint8Array([LF, LF, G, 0x56, 0x01])
    ];
    const len = parts.reduce((s, p) => s + p.length, 0);
    const buf = new Uint8Array(len);
    let off = 0;
    for (const p of parts) { buf.set(p, off); off += p.length; }
    return buf;
  }

  // ----------------------------------------------------------
  // HISTORIAL — paginación, alertas y notificaciones
  // ----------------------------------------------------------

  const POR_PAGINA = 10;
  let _historial    = [];
  let _paginaActual = 0;

  async function _actualizarHistorial() {
    const lista     = document.getElementById('etq-lista-historial');
    const info      = document.getElementById('etq-historial-info');
    const pag       = document.getElementById('etq-paginacion');
    const pagInfo   = document.getElementById('etq-pag-info');
    const btnPrev   = document.getElementById('etq-pag-anterior');
    const btnNext   = document.getElementById('etq-pag-siguiente');
    if (!lista) return;

    const productos = await SB.obtenerProductos();
    _historial = productos;

    if (!productos.length) {
      lista.innerHTML = '<p class="texto-vacio">No hay productos registrados todavía.</p>';
      if (info) info.textContent = '';
      if (pag)  pag.style.display = 'none';
      _mostrarAlertasCaducidad([]);
      return;
    }

    if (info) info.textContent = `(${productos.length})`;
    _mostrarAlertasCaducidad(productos);

    const totalPag = Math.ceil(productos.length / POR_PAGINA);
    if (_paginaActual >= totalPag) _paginaActual = Math.max(0, totalPag - 1);

    const inicio = _paginaActual * POR_PAGINA;
    const pagina = productos.slice(inicio, inicio + POR_PAGINA);

    lista.innerHTML = pagina.map(p => {
      const idxGlobal = productos.indexOf(p);
      const c = VOZ.calcularColorCaducidad(p.fechaCaducidad);
      return `<div class="item-historial ${c}" role="listitem">
        <div><strong>${p.nombre}</strong> — Lote: ${p.lote}</div>
        <small>Caduca: ${VOZ.formatearFecha(p.fechaCaducidad)}</small>
        <div class="card-acciones" style="margin-top:6px">
          <button class="btn-mini btn-ver"    onclick="ModuloEtiquetas._verEtiqueta(${idxGlobal})">👁 Ver</button>
          <button class="btn-mini btn-pagar"  onclick="ModuloEtiquetas._imprimirEtiqueta(${idxGlobal})">🖨 Imprimir</button>
          <button class="btn-mini btn-borrar" onclick="ModuloEtiquetas._borrarProducto(${idxGlobal})">🗑</button>
        </div>
      </div>`;
    }).join('');

    if (totalPag > 1) {
      if (pag)     pag.style.display = 'flex';
      if (pagInfo) pagInfo.textContent = `Página ${_paginaActual + 1} de ${totalPag}`;
      if (btnPrev) btnPrev.disabled = _paginaActual === 0;
      if (btnNext) btnNext.disabled = _paginaActual === totalPag - 1;
    } else {
      if (pag) pag.style.display = 'none';
    }
  }

  function _mostrarAlertasCaducidad(productos) {
    const cont = document.getElementById('etq-alertas-caducidad');
    if (!cont) return;
    const caducados = productos.filter(p => VOZ.calcularColorCaducidad(p.fechaCaducidad) === 'rojo');
    const proximos  = productos.filter(p => VOZ.calcularColorCaducidad(p.fechaCaducidad) === 'amarillo');
    if (!caducados.length && !proximos.length) { cont.style.display = 'none'; cont.innerHTML = ''; return; }

    let html = '';
    if (caducados.length) {
      html += `<div class="item-historial rojo" style="margin:0 0 8px 0">
        ✖ <strong>${caducados.length} producto${caducados.length === 1 ? ' caducado' : 's caducados'}</strong>
      </div>`;
    }
    if (proximos.length) {
      html += `<div class="item-historial amarillo" style="margin:0">
        ⚡ <strong>${proximos.length} producto${proximos.length === 1 ? '' : 's'}</strong> a punto de caducar
      </div>`;
    }
    cont.innerHTML = html;
    cont.style.display = 'block';
  }

  // ----------------------------------------------------------
  // NOTIFICACIONES DEL NAVEGADOR
  // ----------------------------------------------------------

  let _avisadas       = new Set();          // ids ya avisados en esta sesión
  let _intervaloAvisos = null;

  function _actualizarBtnNotif() {
    const btn = document.getElementById('etq-btn-notificaciones');
    if (!btn) return;
    if (!('Notification' in window))               { btn.style.display = 'none'; return; }
    if (Notification.permission === 'granted')      btn.textContent = '🔔 Avisos activos';
    else if (Notification.permission === 'denied')  btn.textContent = '🔕 Avisos bloqueados';
    else                                            btn.textContent = '🔔 Activar avisos';
  }

  async function _activarNotificaciones() {
    if (!('Notification' in window)) { alert('Tu navegador no soporta notificaciones.'); return; }
    if (Notification.permission === 'granted') {
      _revisarYAvisar();
      return;
    }
    if (Notification.permission === 'denied') {
      alert('Has bloqueado las notificaciones. Reactívalas desde el icono del candado en la barra de direcciones.');
      return;
    }
    const r = await Notification.requestPermission();
    _actualizarBtnNotif();
    if (r === 'granted') {
      try {
        new Notification('Cocina · Avisos activados', {
          body: 'Te avisaremos cuando los productos estén a punto de caducar.',
          icon: 'iconos/icono-192.png'
        });
      } catch {}
      _revisarYAvisar();
      _iniciarRevisionPeriodica();
    }
  }

  async function _revisarYAvisar() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const productos = _historial.length ? _historial : await SB.obtenerProductos();

    productos.forEach(p => {
      const c = VOZ.calcularColorCaducidad(p.fechaCaducidad);
      if (c !== 'rojo' && c !== 'amarillo') return;
      const clave = p.id + '-' + c;
      if (_avisadas.has(clave)) return;
      _avisadas.add(clave);
      try {
        if (c === 'rojo') {
          new Notification('✖ Producto caducado', {
            body: `${p.nombre} (Lote ${p.lote}) caducó el ${VOZ.formatearFecha(p.fechaCaducidad)}`,
            icon: 'iconos/icono-192.png',
            tag:  'caducado-' + p.id,
            requireInteraction: true
          });
        } else {
          new Notification('⚡ A punto de caducar', {
            body: `${p.nombre} (Lote ${p.lote}) caduca el ${VOZ.formatearFecha(p.fechaCaducidad)}`,
            icon: 'iconos/icono-192.png',
            tag:  'proximo-' + p.id
          });
        }
      } catch (e) { console.warn('[Etiquetas] No se pudo crear notificación:', e); }
    });
  }

  function _iniciarRevisionPeriodica() {
    if (_intervaloAvisos) clearInterval(_intervaloAvisos);
    // Cada 30 min revisamos productos y avisamos si entran en rojo/amarillo
    _intervaloAvisos = setInterval(async () => {
      await _actualizarHistorial();   // refresca caducidades
      _revisarYAvisar();
    }, 30 * 60 * 1000);
  }

  async function _borrarProducto(idx) {
    const p = _historial[idx];
    if (!p) return;
    if (!confirm(`¿Eliminar "${p.nombre}" — Lote ${p.lote}?`)) return;
    await SB.eliminarProducto(p.id);
    await _actualizarHistorial();
  }

  function _verEtiqueta(idx) {
    const p = _historial[idx];
    if (!p) return;
    _mostrarEtiqueta(p);
    document.getElementById('etq-seccion-etiqueta')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function _imprimirEtiqueta(idx) {
    const p = _historial[idx];
    if (!p) return;
    _mostrarEtiqueta(p);
    await new Promise(r => setTimeout(r, 200));
    _abrirVentanaImpresion();
  }

  // ----------------------------------------------------------
  // UTILIDADES
  // ----------------------------------------------------------

  function _setRespuesta(txt) {
    const el = document.getElementById('etq-respuesta');
    if (el) el.textContent = txt;
  }

  function _setProgreso(actual) {
    const barra = document.getElementById('etq-progreso-barra');
    const texto  = document.getElementById('etq-progreso-texto');
    const total  = ALERGENOS.length;
    if (barra) barra.style.width = (actual / total * 100) + '%';
    if (texto) texto.textContent = actual > 0 ? `Alérgeno ${actual} de ${total}` : '';
    const cont = document.getElementById('etq-progreso-cont');
    if (cont) cont.setAttribute('aria-valuenow', actual);
  }

  function _reiniciar() {
    estado.paso = PASOS.INACTIVO;
    estado.cancelado = false;
    const btn = document.getElementById('etq-btn-nuevo');
    if (btn) btn.disabled = false;
  }

  // ----------------------------------------------------------
  // INICIALIZACIÓN
  // ----------------------------------------------------------

  async function init() {
    // Generar checkboxes de alérgenos para el modo manual
    _renderAlergenos();
    _setFechaAhora();

    // Historial
    await _actualizarHistorial();

    // Tabs de modo
    document.querySelectorAll('.etq-modo-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _activarModo(btn.dataset.modo);
        if (btn.dataset.modo === 'manual') _setFechaAhora();
      });
    });

    // Modo voz
    document.getElementById('etq-btn-nuevo')?.addEventListener('click', () => {
      if (estado.paso === PASOS.INACTIVO) iniciarFlujo();
    });
    document.getElementById('etq-btn-cancelar')?.addEventListener('click', () => {
      estado.cancelado = true;
      window.speechSynthesis.cancel();
      _reiniciar();
      _ocultarEtiqueta();
      _setRespuesta('');
      _setProgreso(0);
    });

    // Modo manual
    document.getElementById('etq-m-btn-generar')?.addEventListener('click', _generarManual);

    // Impresión
    document.getElementById('etq-btn-imprimir')?.addEventListener('click', _imprimir);
    document.getElementById('etq-btn-cerrar-preview')?.addEventListener('click', _cerrarPreview);

    // Paginación del historial
    document.getElementById('etq-pag-anterior')?.addEventListener('click', () => {
      if (_paginaActual > 0) { _paginaActual--; _actualizarHistorial(); }
    });
    document.getElementById('etq-pag-siguiente')?.addEventListener('click', () => {
      _paginaActual++;
      _actualizarHistorial();
    });

    // Notificaciones
    document.getElementById('etq-btn-notificaciones')?.addEventListener('click', _activarNotificaciones);
    _actualizarBtnNotif();
    if ('Notification' in window && Notification.permission === 'granted') {
      _revisarYAvisar();
      _iniciarRevisionPeriodica();
    }

    if (!VOZ.soportaVoz()) {
      const btn = document.getElementById('etq-btn-nuevo');
      if (btn) { btn.disabled = true; btn.textContent = '⚠ Voz no soportada (usa Chrome)'; }
      // Activar manual por defecto si no hay voz
      _activarModo('manual');
    }
  }

  async function verificarCaducidades() {
    const productos = await SB.obtenerProductos();
    return {
      caducados: productos.filter(p => VOZ.calcularColorCaducidad(p.fechaCaducidad) === 'rojo'),
      proximos:  productos.filter(p => VOZ.calcularColorCaducidad(p.fechaCaducidad) === 'amarillo'),
    };
  }

  return { init, verificarCaducidades, _verEtiqueta, _imprimirEtiqueta, _borrarProducto };

})();
