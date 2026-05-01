// ============================================================
// modulos/etiquetas.js — Módulo de etiquetado de recipientes
// Depende de: core/bd.js y core/voz.js
// Gestiona el flujo guiado por voz para registrar un producto
// abierto e imprimir su etiqueta de trazabilidad.
// ============================================================

const ModuloEtiquetas = (() => {

  // Los 14 alérgenos de declaración obligatoria (Reg. UE 1169/2011 Anexo II)
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

  async function _pasoAlergeno() {
    const nombre = ALERGENOS[estado.indiceAlergeno];
    await VOZ.hablar(`¿Contiene ${nombre}?`);
    try {
      const r  = await VOZ.escuchar();
      const sn = VOZ.detectarSiNo(r);
      if (sn === null) {
        await VOZ.hablar(`No he entendido. Responde sí o no. ¿Contiene ${nombre}?`);
        return _pasoAlergeno();
      }
      if (sn) estado.producto.alergenos.push(nombre);
      estado.indiceAlergeno++;
      _setProgreso(estado.indiceAlergeno);
      if (estado.indiceAlergeno >= ALERGENOS.length) estado.paso = PASOS.CONFIRMAR;
      await _despachar();
    } catch { await VOZ.hablar(`No he captado la respuesta. ¿Contiene ${nombre}? Sí o no.`); await _pasoAlergeno(); }
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
    try { await BD.guardarProducto({ ...estado.producto }); }
    catch (e) { console.error('[Etiquetas] Error al guardar:', e); }

    _mostrarEtiqueta(estado.producto);
    await _actualizarHistorial();
    await VOZ.hablar('Producto registrado. ¿Deseas imprimir la etiqueta?');
    try {
      const r = await VOZ.escuchar();
      if (VOZ.detectarSiNo(r) === true) { await VOZ.hablar('Enviando a la impresora.'); await _imprimir(); }
    } catch { /* sin respuesta: no imprimir */ }
    _reiniciar();
  }

  // ----------------------------------------------------------
  // ETIQUETA: RENDER
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

  async function _actualizarHistorial() {
    const lista = document.getElementById('etq-lista-historial');
    if (!lista) return;
    const productos = await BD.obtenerProductos();
    if (!productos.length) { lista.innerHTML = '<p class="texto-vacio">No hay productos registrados todavía.</p>'; return; }
    lista.innerHTML = productos.map(p => {
      const c = VOZ.calcularColorCaducidad(p.fechaCaducidad);
      return `<div class="item-historial ${c}">
        <strong>${p.nombre}</strong> — Lote: ${p.lote}<br>
        <small>Caduca: ${VOZ.formatearFecha(p.fechaCaducidad)}</small>
      </div>`;
    }).join('');
  }

  // ----------------------------------------------------------
  // UTILIDADES DE UI INTERNAS
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
  // INICIALIZACIÓN DEL MÓDULO
  // ----------------------------------------------------------

  async function init() {
    await _actualizarHistorial();

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

    document.getElementById('etq-btn-imprimir')?.addEventListener('click', _imprimir);

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
    }
  }

  return { init };

})();
