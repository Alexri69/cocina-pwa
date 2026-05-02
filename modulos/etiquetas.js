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

    try { await SB.guardarProducto({ ...producto }); }
    catch (e) { console.error('[Etiquetas] Error al guardar:', e); }

    _mostrarEtiqueta(producto);
    await _actualizarHistorial();
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
    try { await SB.guardarProducto({ ...estado.producto }); }
    catch (e) { console.error('[Etiquetas] Error al guardar:', e); }

    _mostrarEtiqueta(estado.producto);
    await _actualizarHistorial();
    // Asegurarse de que el historial esté visible para que el usuario pueda imprimir luego
    const secHist = document.getElementById('etq-seccion-historial');
    const btnHist = document.getElementById('etq-btn-historial');
    if (secHist) secHist.style.display = 'block';
    if (btnHist) btnHist.textContent = '▲ Ocultar historial';

    await VOZ.hablar('Producto registrado. ¿Deseas imprimir la etiqueta?');
    try {
      const r = await VOZ.escuchar();
      if (VOZ.detectarSiNo(r) === true) { await VOZ.hablar('Enviando a la impresora.'); await _imprimir(); }
    } catch { /* sin respuesta: no imprimir */ }
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

  async function _imprimir() {
    if (navigator.bluetooth) {
      try { await _imprimirBluetooth(estado.producto); return; }
      catch (e) { console.warn('[Impresora] Bluetooth falló, usando window.print:', e); }
    }
    window.print();
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
  // HISTORIAL
  // ----------------------------------------------------------

  let _historial = [];

  async function _actualizarHistorial() {
    const lista = document.getElementById('etq-lista-historial');
    if (!lista) return;
    const productos = await SB.obtenerProductos();
    _historial = productos;
    if (!productos.length) { lista.innerHTML = '<p class="texto-vacio">No hay productos registrados todavía.</p>'; return; }
    lista.innerHTML = productos.map((p, i) => {
      const c = VOZ.calcularColorCaducidad(p.fechaCaducidad);
      return `<div class="item-historial ${c}">
        <div><strong>${p.nombre}</strong> — Lote: ${p.lote}</div>
        <small>Caduca: ${VOZ.formatearFecha(p.fechaCaducidad)}</small>
        <div class="card-acciones" style="margin-top:6px">
          <button class="btn-mini btn-ver"   onclick="ModuloEtiquetas._verEtiqueta(${i})">👁 Ver</button>
          <button class="btn-mini btn-pagar" onclick="ModuloEtiquetas._imprimirEtiqueta(${i})">🖨 Imprimir</button>
          <button class="btn-mini btn-borrar" onclick="ModuloEtiquetas._borrarProducto(${i})">🗑</button>
        </div>
      </div>`;
    }).join('');
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
    window.print();
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

    // Historial toggle
    document.getElementById('etq-btn-historial')?.addEventListener('click', () => {
      const sec = document.getElementById('etq-seccion-historial');
      const btn = document.getElementById('etq-btn-historial');
      if (!sec) return;
      const visible = sec.style.display !== 'none';
      sec.style.display = visible ? 'none' : 'block';
      if (btn) btn.textContent = visible ? '▼ Ver historial' : '▲ Ocultar historial';
    });

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
