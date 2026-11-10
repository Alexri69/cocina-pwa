// ============================================================
// modulos/etiquetas.js — Etiquetado de recipientes abiertos
// Depende de: core/supabase.js, core/voz.js
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

  // Etiqueta que se está mostrando en la vista previa (la que se imprime)
  let _etiquetaActual = null;

  // Error especial para cortar el flujo de voz cuando el usuario pulsa Cancelar
  const CANCELADO = new Error('cancelado');
  function _comprobarCancelado() { if (estado.cancelado) throw CANCELADO; }

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

  // ----------------------------------------------------------
  // PRODUCTOS HABITUALES (plantillas: nombre + días + alérgenos)
  // ----------------------------------------------------------

  let _plantillas      = [];
  let _plantillaEnUso  = null;  // la elegida para la etiqueta en curso (para contar usos)
  let _gestionandoHab  = false;
  let _busquedaHab     = '';

  // Comparación tolerante: sin mayúsculas, tildes ni espacios sobrantes
  const _norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const _buscarPlantilla = nombre => _plantillas.find(p => _norm(p.nombre) === _norm(nombre)) || null;

  async function _cargarPlantillas() {
    try { _plantillas = await SB.obtenerPlantillas(); }
    catch (e) { console.warn('[Etiquetas] No se pudieron cargar los habituales:', e); _plantillas = _plantillas || []; }
    _renderPlantillas();
  }

  function _emojisAlergenos(lista) {
    const E = { 'gluten':'🌾','crustáceos':'🦞','huevo':'🥚','pescado':'🐟','cacahuetes':'🥜','soja':'🌱','leche':'🥛',
                'frutos de cáscara':'🌰','apio':'🌿','mostaza':'🌼','granos de sésamo':'🫘','altramuces':'🌸','moluscos':'🐚','sulfitos':'🍷' };
    return (lista || []).map(a => E[a] || '').join('');
  }

  function _renderPlantillas() {
    const cont    = document.getElementById('etq-habituales');
    const btnGest = document.getElementById('etq-hab-gestionar');
    const buscar  = document.getElementById('etq-hab-buscar');
    if (!cont) return;
    if (btnGest) {
      btnGest.style.display = _plantillas.length ? '' : 'none';
      btnGest.textContent   = _gestionandoHab ? '✔ Hecho' : '✏ Gestionar';
      btnGest.setAttribute('aria-pressed', String(_gestionandoHab));
    }
    if (buscar) buscar.style.display = _plantillas.length > 10 ? '' : 'none';
    if (!_plantillas.length) { _gestionandoHab = false; }
    cont.classList.toggle('gestionando', _gestionandoHab);

    if (!_plantillas.length) {
      cont.innerHTML = `<p class="etq-hab-vacio">Guarda aquí los productos que abres a menudo y etiquétalos en un toque.<br>
        Al crear una etiqueta en modo <strong>Manual</strong> marca <strong>⭐ Guardar como producto habitual</strong>, o pulsa ⭐ en el historial.</p>`;
      return;
    }
    const q = _norm(_busquedaHab);
    const lista = _plantillas.filter(p => !q || _norm(p.nombre).includes(q));
    if (!lista.length) { cont.innerHTML = `<p class="etq-hab-vacio">Ningún habitual coincide con "${esc(_busquedaHab)}".</p>`; return; }
    cont.innerHTML = lista.map(p => {
      const al = _emojisAlergenos(p.alergenos);
      const desc = `${p.nombre}, ${p.diasCaducidad} día${p.diasCaducidad === 1 ? '' : 's'}${p.alergenos?.length ? ', contiene ' + p.alergenos.join(', ') : ', sin alérgenos'}`;
      return `<button type="button" class="chip-habitual${_plantillaEnUso?.id === p.id ? ' activo' : ''}" role="listitem"
                data-id="${esc(p.id)}" title="${esc(desc)}" aria-label="${esc(_gestionandoHab ? 'Eliminar ' + p.nombre : 'Etiquetar ' + desc)}">
        <span>${esc(p.nombre)}</span>
        <span class="chip-dias">${p.diasCaducidad} d</span>
        ${al ? `<span class="chip-al" aria-hidden="true">${al}</span>` : ''}
        <span class="chip-borrar" aria-hidden="true">✕</span>
      </button>`;
    }).join('');
  }

  // Tocar un habitual: rellena el formulario manual y deja el cursor en el lote
  function _usarPlantilla(id) {
    const p = _plantillas.find(x => x.id === id);
    if (!p) return;
    _plantillaEnUso = p;
    _activarModo('manual');
    _ocultarEtiqueta();
    document.getElementById('etq-m-nombre').value = p.nombre;
    document.getElementById('etq-m-dias').value   = p.diasCaducidad;
    document.getElementById('etq-m-lote').value   = '';
    ALERGENOS.forEach((a, i) => { const ck = document.getElementById(`etq-m-al-${i}`); if (ck) ck.checked = (p.alergenos || []).includes(a); });
    const hab = document.getElementById('etq-m-habitual'); if (hab) hab.checked = false;
    _setFechaAhora();
    _renderPlantillas();
    const msgEl = document.getElementById('etq-mensaje');
    if (msgEl) { msgEl.textContent = `⭐ ${p.nombre}: escribe el lote y guarda.`; msgEl.style.color = ''; }
    const lote = document.getElementById('etq-m-lote');
    lote?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    lote?.focus();
  }

  async function _borrarPlantilla(id) {
    const p = _plantillas.find(x => x.id === id);
    if (!p || !confirm(`¿Quitar "${p.nombre}" de los productos habituales?\n\nLas etiquetas ya creadas no se borran.`)) return;
    try {
      await SB.eliminarPlantilla(id);
      _plantillas = _plantillas.filter(x => x.id !== id);
      if (_plantillaEnUso?.id === id) _plantillaEnUso = null;
      _renderPlantillas();
    } catch (e) { aviso('No se pudo quitar: ' + e.message, { tipo: 'error' }); }
  }

  // Crea el habitual o, si ya hay uno con ese nombre, actualiza sus días y alérgenos
  async function _guardarComoHabitual({ nombre, diasCaducidad, alergenos }, silencioso = false) {
    if (!nombre || !(diasCaducidad > 0)) return;
    const existente = _buscarPlantilla(nombre);
    try {
      if (existente) {
        const nueva = { ...existente, nombre: existente.nombre, diasCaducidad, alergenos: [...(alergenos || [])] };
        await SB.actualizarPlantilla(nueva);
        Object.assign(existente, nueva);
        if (!silencioso) aviso(`⭐ "${existente.nombre}" actualizado en habituales.`, { tipo: 'ok', ms: 2500 });
      } else {
        const creada = await SB.guardarPlantilla({ nombre: VOZ.capitalizarNombre(nombre.trim()), diasCaducidad, alergenos: [...(alergenos || [])], usos: 1 });
        if (creada) _plantillas.push(creada);
        if (!silencioso) aviso(`⭐ "${creada?.nombre || nombre}" guardado en habituales.`, { tipo: 'ok', ms: 2500 });
      }
      _plantillas.sort((a, b) => (b.usos || 0) - (a.usos || 0) || a.nombre.localeCompare(b.nombre, 'es'));
      _renderPlantillas();
    } catch (e) {
      aviso('No se pudo guardar como habitual: ' + e.message, { tipo: 'error' });
    }
  }

  // Suma un uso (los más usados salen primero). Silencioso: no es crítico.
  function _contarUso(nombre) {
    const p = _buscarPlantilla(nombre);
    if (!p) return;
    p.usos = (p.usos || 0) + 1;
    SB.actualizarPlantilla({ id: p.id, nombre: p.nombre, diasCaducidad: p.diasCaducidad, alergenos: p.alergenos, usos: p.usos }).catch(() => {});
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

    // Si viene de un habitual, se respeta su nombre tal cual está guardado
    const hab = _buscarPlantilla(nombre);
    const producto = {
      nombre:         hab ? hab.nombre : VOZ.capitalizarNombre(nombre),
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
    // Habituales: guardar/actualizar si se marcó la casilla; si no, contar el uso
    if (document.getElementById('etq-m-habitual')?.checked) {
      await _guardarComoHabitual(producto);
      document.getElementById('etq-m-habitual').checked = false;
    } else {
      _contarUso(producto.nombre);
    }
    _plantillaEnUso = null;
    _renderPlantillas();
    _paginaActual = 0;
    await _actualizarHistorial();
    _revisarYAvisar();
  }

  function _cerrarPreview() {
    _ocultarEtiqueta();
    _plantillaEnUso = null;
    _renderPlantillas();
    const hab = document.getElementById('etq-m-habitual'); if (hab) hab.checked = false;
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
      if (e === CANCELADO || estado.cancelado) return; // el usuario canceló: salir en silencio
      console.error('[Etiquetas] Error:', e);
      await VOZ.hablar('Ha ocurrido un error. Por favor, inicia el proceso de nuevo.');
      _reiniciar();
    }
  }

  // hablar/escuchar que se cortan en cuanto el usuario pulsa Cancelar
  async function _hablar(t) { _comprobarCancelado(); await VOZ.hablar(t); _comprobarCancelado(); }
  async function _escuchar() {
    _comprobarCancelado();
    try { return await VOZ.escuchar(); }
    finally { _comprobarCancelado(); }
  }

  async function _pasoNombre() {
    await _hablar('¿Qué producto has abierto?');
    let r;
    try { r = await _escuchar(); }
    catch (e) { if (e === CANCELADO) throw e; await _hablar('No te he escuchado. ¿Cuál es el nombre del producto?'); return _pasoNombre(); }
    if (!r || r.length < 2) { await _hablar('No he entendido el nombre. ¿Puedes repetirlo?'); return _pasoNombre(); }
    // ¿Es un producto habitual? Entonces ya sabemos días y alérgenos: solo falta el lote
    const hab = _buscarPlantilla(r);
    if (hab) {
      estado.producto.nombre        = hab.nombre;
      estado.producto.diasCaducidad = hab.diasCaducidad;
      estado.producto.alergenos     = [...(hab.alergenos || [])];
      estado.desdePlantilla = true;
      _setRespuesta(`⭐ ${hab.nombre} (habitual)`);
      await _hablar(`${hab.nombre}, producto habitual.`);
    } else {
      estado.producto.nombre = VOZ.capitalizarNombre(r);
    }
    estado.paso = PASOS.LOTE;
    await _despachar();
  }

  async function _pasoLote() {
    await _hablar('¿Número de lote?');
    let r;
    try { r = await _escuchar(); }
    catch (e) { if (e === CANCELADO) throw e; await _hablar('No he captado el lote. Por favor repite.'); return _pasoLote(); }
    if (!r) { await _hablar('No he escuchado el lote. Por favor repítelo.'); return _pasoLote(); }
    estado.producto.lote = VOZ.limpiarLote(r);
    estado.paso = estado.desdePlantilla ? PASOS.CONFIRMAR : PASOS.DIAS;
    await _despachar();
  }

  async function _pasoDias() {
    await _hablar('¿En cuántos días caduca una vez abierto?');
    let r;
    try { r = await _escuchar(); }
    catch (e) { if (e === CANCELADO) throw e; await _hablar('No he entendido los días. Di solo el número.'); return _pasoDias(); }
    const n = VOZ.palabrasANumero(r);
    if (!n || n <= 0 || !Number.isInteger(n)) {
      await _hablar('Necesito un número entero de días mayor que cero. Por ejemplo: tres, siete. ¿Cuántos días?');
      return _pasoDias();
    }
    estado.producto.diasCaducidad = n;
    estado.paso = PASOS.ALERGENO;
    estado.indiceAlergeno = 0;
    await _despachar();
  }

  // Detecta qué alérgenos del listado oficial aparecen en el texto libre del usuario.
  // Compara palabras completas (con plural opcional): antes "nata" saltaba con "natural".
  const _SINONIMOS = {
    'gluten':            ['gluten','trigo','cebada','avena','centeno','espelta','harina'],
    'crustáceos':        ['crustáceo','crustaceo','marisco','gamba','langosta','cangrejo','langostino','cigala','bogavante'],
    'huevo':             ['huevo','mayonesa'],
    'pescado':           ['pescado','atún','atun','salmón','salmon','bacalao','merluza','boquerón','boquerones','anchoa','sardina'],
    'cacahuetes':        ['cacahuete','maní','mani'],
    'soja':              ['soja','soya'],
    'leche':             ['leche','lácteo','lacteo','lactosa','mantequilla','queso','nata','yogur','yogures','crema'],
    'frutos de cáscara': ['cáscara','cascara','nuez','nueces','almendra','avellana','pistacho','anacardo','piñón','piñones','castaña','fruto seco','frutos secos'],
    'apio':              ['apio'],
    'mostaza':           ['mostaza'],
    'granos de sésamo':  ['sésamo','sesamo','tahini','ajonjolí'],
    'altramuces':        ['altramuz','altramuces'],
    'moluscos':          ['molusco','calamar','pulpo','mejillón','mejillon','mejillones','ostra','berberecho','almeja','sepia','choco'],
    'sulfitos':          ['sulfito','sulfuroso','azufre'],
  };
  const _L = 'a-záéíóúüñ';
  const _reAlergeno = Object.fromEntries(Object.entries(_SINONIMOS).map(([a, ks]) =>
    [a, new RegExp(`(?:^|[^${_L}])(?:${ks.join('|')})(?:s|es)?(?=$|[^${_L}])`, 'i')]));

  function _detectarAlergenos(texto) {
    const t = String(texto || '').toLowerCase();
    if (/\bninguno\b|\bno (contiene|tiene)\b|sin alérgeno|sin alergeno/.test(t)) return [];
    return ALERGENOS.filter(a => _reAlergeno[a]?.test(t));
  }

  async function _pasoAlergeno() {
    await _hablar('¿Qué alérgenos contiene? Di los que tiene, por ejemplo: gluten y leche. O di ninguno.');
    let r;
    try { r = await _escuchar(); }
    catch (e) { if (e === CANCELADO) throw e; await _hablar('No te he escuchado. ¿Qué alérgenos contiene?'); return _pasoAlergeno(); }
    estado.producto.alergenos = _detectarAlergenos(r);
    await _confirmarAlergenos();
  }

  async function _confirmarAlergenos() {
    const lista   = estado.producto.alergenos;
    const resumen = lista.length
      ? `He anotado: ${lista.join(', ')}. ¿Falta alguno?`
      : 'Sin alérgenos anotados. ¿Falta alguno?';
    await _hablar(resumen);

    let r;
    try { r = await _escuchar(); }
    catch (e) { if (e === CANCELADO) throw e; await _hablar('Responde sí si falta alguno, o no para continuar.'); return _confirmarAlergenos(); }
    const sn = VOZ.detectarSiNo(r);
    const directos = _detectarAlergenos(r);

    // "sí, falta el huevo" o directamente "huevo": se añade lo que diga
    if (sn === true || (sn === null && directos.length)) {
      let nuevos = directos;
      if (!nuevos.length) {
        await _hablar('¿Cuál?');
        try { nuevos = _detectarAlergenos(await _escuchar()); }
        catch (e) { if (e === CANCELADO) throw e; await _hablar('No te he escuchado.'); }
        if (!nuevos.length) await _hablar('No he reconocido ese alérgeno. Prueba de nuevo.');
      }
      nuevos.forEach(a => { if (!estado.producto.alergenos.includes(a)) estado.producto.alergenos.push(a); });
      return _confirmarAlergenos(); // vuelve a confirmar sin reiniciar el proceso
    }

    // sn === false o null → dar por terminado
    estado.paso = PASOS.CONFIRMAR;
    _setProgreso(ALERGENOS.length);
    await _despachar();
  }

  async function _pasoConfirmar() {
    _comprobarCancelado();
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

    await _hablar(resumen);
    let r;
    try { r = await _escuchar(); }
    catch (e) { if (e === CANCELADO) throw e; await _hablar('¿Es correcto? Sí o no.'); return _pasoConfirmar(); }
    const sn = VOZ.detectarSiNo(r);
    if (sn === null) { await _hablar('Responde sí para confirmar o no para empezar de nuevo.'); return _pasoConfirmar(); }
    if (sn) await _finalizar();
    else    { await _hablar('De acuerdo, empecemos de nuevo.'); await iniciarFlujo(); }
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
      _contarUso(estado.producto.nombre);
      _renderPlantillas();
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

    _etiquetaActual = p;
    prev.innerHTML = `
      <div class="etiqueta">
        <div class="etiqueta-nombre">${esc(p.nombre).toUpperCase()}</div>
        <div class="etiqueta-lote">Lote: <strong>${esc(p.lote)}</strong></div>
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
    _etiquetaActual = null;
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
    // Se imprime la etiqueta que está en pantalla (antes usaba la última hecha por voz)
    const p = _etiquetaActual;
    if (!p) { alert('Primero genera una etiqueta.'); return; }
    const imp = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfigImpresora() : {};
    // Bluetooth solo si está configurado así; si no, impresión normal del sistema
    if (imp.conexion === 'bluetooth' && navigator.bluetooth) {
      try { await _imprimirBluetooth(p); return; }
      catch (e) {
        if (e?.name === 'NotFoundError') return; // el usuario cerró el selector de dispositivos
        console.warn('[Impresora] Bluetooth falló, usando ventana emergente:', e);
      }
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
        <div><strong>${esc(p.nombre)}</strong> — Lote: ${esc(p.lote)}</div>
        <small>Caduca: ${VOZ.formatearFecha(p.fechaCaducidad)}</small>
        <div class="card-acciones" style="margin-top:6px">
          <button class="btn-mini btn-ver"    onclick="ModuloEtiquetas._verEtiqueta(${idxGlobal})">👁 Ver</button>
          <button class="btn-mini btn-pagar"  onclick="ModuloEtiquetas._imprimirEtiqueta(${idxGlobal})">🖨 Imprimir</button>
          ${_buscarPlantilla(p.nombre)
            ? `<span class="btn-mini" title="Ya es un producto habitual" aria-label="Ya es un producto habitual" style="cursor:default;color:var(--warn)">⭐</span>`
            : `<button class="btn-mini" title="Guardar como producto habitual" aria-label="Guardar ${esc(p.nombre)} como producto habitual" onclick="ModuloEtiquetas._habitualDesdeHistorial(${idxGlobal})">☆ Habitual</button>`}
          <button class="btn-mini btn-borrar" title="Eliminar" aria-label="Eliminar" onclick="ModuloEtiquetas._borrarProducto(${idxGlobal})">🗑</button>
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
      html += `<div class="item-historial rojo" style="margin:0 0 8px 0;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <span>✖ <strong>${caducados.length} producto${caducados.length === 1 ? ' caducado' : 's caducados'}</strong></span>
        <button type="button" class="btn-mini btn-borrar" onclick="ModuloEtiquetas.retirarCaducados()">🗑 Retirar caducados</button>
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

  // Avisos ya enviados (id + estado), guardados en el dispositivo para no repetirlos
  // cada vez que se abre la app. Se olvidan los de hace más de 30 días.
  const _CLAVE_AVISADAS = 'cocina_avisadas';
  function _leerAvisadas() {
    try {
      const obj = JSON.parse(localStorage.getItem(_CLAVE_AVISADAS)) || {};
      const limite = Date.now() - 30 * 86400000;
      return Object.fromEntries(Object.entries(obj).filter(([, t]) => t > limite));
    } catch { return {}; }
  }
  function _guardarAvisadas(obj) { try { localStorage.setItem(_CLAVE_AVISADAS, JSON.stringify(obj)); } catch {} }
  let _intervaloAvisos = null;

  // Interruptor propio de la app: una web no puede retirarse el permiso del navegador,
  // así que "desactivar" = marca local + baja del dispositivo en Supabase.
  const _CLAVE_OFF = 'cocina_avisos_off';
  function avisosActivos() {
    try {
      return 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem(_CLAVE_OFF) !== '1';
    } catch { return false; }
  }

  function _actualizarBtnNotif() {
    const btn = document.getElementById('etq-btn-notificaciones');
    if (!btn) return;
    if (!('Notification' in window))               { btn.style.display = 'none'; return; }
    const estado = Notification.permission === 'denied' ? 'bloqueados' : avisosActivos() ? 'activos' : 'desactivados';
    // Verde = activos · rojo = desactivados o bloqueados
    btn.classList.toggle('btn-notif-on',  estado === 'activos');
    btn.classList.toggle('btn-notif-off', estado !== 'activos');
    btn.textContent = estado === 'activos'    ? '🔔 Avisos activos'
                    : estado === 'bloqueados' ? '🔕 Avisos bloqueados'
                    :                           '🔕 Avisos desactivados';
    btn.title = estado === 'activos'    ? 'Pulsa para desactivar los avisos en este dispositivo'
              : estado === 'bloqueados' ? 'Bloqueados en el navegador: pulsa para ver cómo activarlos'
              :                           'Pulsa para activar los avisos de caducidad';
    btn.setAttribute('aria-label', btn.textContent + '. ' + btn.title);
    btn.setAttribute('aria-pressed', String(estado === 'activos'));
  }

  async function _clicBtnNotif() {
    if (avisosActivos()) {
      if (confirm('¿Desactivar los avisos de caducidad en este dispositivo?\n\nDejarás de recibir notificaciones aquí, también el aviso diario con la app cerrada.')) {
        await _desactivarNotificaciones();
      }
    } else {
      await _activarNotificaciones();
    }
  }

  async function _desactivarNotificaciones() {
    try { localStorage.setItem(_CLAVE_OFF, '1'); } catch {}
    if (_intervaloAvisos) { clearInterval(_intervaloAvisos); _intervaloAvisos = null; }
    // Dar de baja el dispositivo para que el aviso diario no le llegue
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        try { await SB.borrarPushSub(sub.endpoint); } catch (e) { console.warn('[Etiquetas] No se pudo borrar la suscripción en el servidor:', e); }
        await sub.unsubscribe();
      }
    } catch (e) { console.warn('[Etiquetas] Error al desactivar push:', e); }
    _actualizarBtnNotif();
    aviso('🔕 Avisos desactivados en este dispositivo.', { tipo: 'info' });
  }

  // Muestra una notificación (a través del Service Worker si se puede: es lo que
  // funciona también en Android y con la app instalada).
  async function _mostrarNotificacion(titulo, opciones) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) { await reg.showNotification(titulo, opciones); return true; }
    } catch {}
    try { new Notification(titulo, opciones); return true; } catch { return false; }
  }

  async function _activarNotificaciones() {
    if (!('Notification' in window)) { alert('Tu navegador no soporta notificaciones.'); return; }
    if (Notification.permission === 'denied') {
      alert('Las notificaciones están bloqueadas para esta página.\n\nPara activarlas: pulsa el icono a la izquierda de la dirección (candado o ajustes) → Notificaciones → Permitir, y recarga la página.');
      return;
    }
    if (Notification.permission !== 'granted') {
      const r = await Notification.requestPermission();
      _actualizarBtnNotif();
      if (r !== 'granted') { _actualizarBtnNotif(); aviso('No se han activado los avisos (permiso no concedido).', { tipo: 'error' }); return; }
    }
    try { localStorage.removeItem(_CLAVE_OFF); } catch {}
    _actualizarBtnNotif();

    // Registrar este dispositivo para los avisos diarios con la app cerrada
    try { if (typeof _suscribirPush === 'function') await _suscribirPush(); } catch {}

    // Notificación de prueba: confirma que el sistema operativo las deja pasar
    const ok = await _mostrarNotificacion('🔔 Cocina · Avisos activados', {
      body: 'Así te llegarán los avisos de productos caducados o a punto de caducar.',
      icon: 'iconos/icono-192.png',
      tag:  'cocina-prueba-' + Date.now() // etiqueta única: si no, Windows la sustituye en silencio
    });
    if (ok) aviso('✔ Avisos activados.', { tipo: 'ok', ms: 2500 });
    else    aviso('⚠ El navegador no ha podido mostrar la notificación. Revisa los ajustes de notificaciones del sistema.', { tipo: 'error', ms: 8000 });
    _revisarYAvisar();
    _iniciarRevisionPeriodica();
  }

  async function _revisarYAvisar() {
    if (!avisosActivos()) return;
    let productos = _historial;
    if (!productos.length) { try { productos = await SB.obtenerProductos(); } catch { return; } }

    // Solo productos que han cambiado de estado desde el último aviso
    const avisadas = _leerAvisadas();
    const nuevos = productos.filter(p => {
      const c = VOZ.calcularColorCaducidad(p.fechaCaducidad);
      return (c === 'rojo' || c === 'amarillo') && !avisadas[p.id + '-' + c];
    });
    if (!nuevos.length) return;

    const cad  = nuevos.filter(p => VOZ.calcularColorCaducidad(p.fechaCaducidad) === 'rojo');
    const prox = nuevos.filter(p => VOZ.calcularColorCaducidad(p.fechaCaducidad) === 'amarillo');
    const titulo = cad.length ? '✖ Productos caducados' : '⚡ Productos a punto de caducar';
    const nombres = nuevos.slice(0, 3).map(p => p.nombre).join(', ') + (nuevos.length > 3 ? `… (+${nuevos.length - 3})` : '');
    const partes = [];
    if (cad.length)  partes.push(`${cad.length} caducado${cad.length > 1 ? 's' : ''}`);
    if (prox.length) partes.push(`${prox.length} próximo${prox.length > 1 ? 's' : ''} a caducar`);

    // Una sola notificación resumen en vez de una por producto
    try {
      new Notification(titulo, {
        body: `${partes.join(' · ')}: ${nombres}`,
        icon: 'iconos/icono-192.png',
        tag:  'cocina-caducidad'
      });
    } catch (e) {
      // En Android las notificaciones deben salir del Service Worker
      try { (await navigator.serviceWorker?.ready)?.showNotification(titulo, { body: `${partes.join(' · ')}: ${nombres}`, icon: 'iconos/icono-192.png', tag: 'cocina-caducidad' }); }
      catch { console.warn('[Etiquetas] No se pudo crear notificación:', e); }
    }
    const ahora = Date.now();
    nuevos.forEach(p => { avisadas[p.id + '-' + VOZ.calcularColorCaducidad(p.fechaCaducidad)] = ahora; });
    _guardarAvisadas(avisadas);
  }

  // Elimina de una vez todos los productos ya caducados (se retiraron de la cámara)
  async function retirarCaducados() {
    const caducados = _historial.filter(p => VOZ.calcularColorCaducidad(p.fechaCaducidad) === 'rojo');
    if (!caducados.length) return;
    const lista = caducados.slice(0, 10).map(p => `• ${p.nombre} — Lote ${p.lote}`).join('\n') + (caducados.length > 10 ? `\n… y ${caducados.length - 10} más` : '');
    if (!confirm(`¿Retirar ${caducados.length} producto(s) caducado(s)?\n\n${lista}\n\nSe eliminarán del historial.`)) return;
    let fallos = 0;
    for (const p of caducados) {
      try { await SB.eliminarProducto(p.id); } catch { fallos++; }
    }
    await _actualizarHistorial();
    if (fallos) aviso(`No se pudieron eliminar ${fallos} producto(s). Inténtalo de nuevo.`, { tipo: 'error' });
    else        aviso(`✔ ${caducados.length} producto(s) retirados.`, { tipo: 'ok' });
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
    try {
      await SB.eliminarProducto(p.id);
    } catch (e) {
      aviso('No se pudo eliminar: ' + e.message, { tipo: 'error' });
      return;
    }
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
    await _imprimir();
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
    // OJO: no se toca estado.cancelado (antes se ponía a false aquí y por eso
    // Cancelar no detenía el flujo). iniciarFlujo() crea un estado nuevo.
    estado.paso = PASOS.INACTIVO;
    const btn = document.getElementById('etq-btn-nuevo');
    if (btn) btn.disabled = false;
  }

  // ----------------------------------------------------------
  // INICIALIZACIÓN
  // ----------------------------------------------------------

  async function _habitualDesdeHistorial(idx) {
    const p = _historial[idx];
    if (!p) return;
    await _guardarComoHabitual({ nombre: p.nombre, diasCaducidad: p.diasCaducidad, alergenos: p.alergenos });
    await _actualizarHistorial();
  }

  async function init() {
    // Generar checkboxes de alérgenos para el modo manual
    _renderAlergenos();
    _setFechaAhora();

    // Productos habituales (antes del historial: el historial marca cuáles ya lo son)
    document.getElementById('etq-habituales')?.addEventListener('click', e => {
      const chip = e.target.closest('.chip-habitual');
      if (!chip) return;
      if (_gestionandoHab) _borrarPlantilla(chip.dataset.id);
      else                 _usarPlantilla(chip.dataset.id);
    });
    document.getElementById('etq-hab-gestionar')?.addEventListener('click', () => {
      _gestionandoHab = !_gestionandoHab;
      _renderPlantillas();
    });
    document.getElementById('etq-hab-buscar')?.addEventListener('input', e => {
      _busquedaHab = e.target.value;
      _renderPlantillas();
    });
    // Enter en el lote = guardar (con un habitual elegido es lo único que falta)
    document.getElementById('etq-m-lote')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _generarManual(); }
    });
    await _cargarPlantillas();

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
      VOZ.cancelarEscucha();   // corta el micrófono al instante
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
    document.getElementById('etq-btn-notificaciones')?.addEventListener('click', _clicBtnNotif);
    _actualizarBtnNotif();
    // Si se cambia el permiso desde el candado del navegador, el botón cambia de color al momento
    try {
      navigator.permissions?.query({ name: 'notifications' }).then(st => { st.onchange = _actualizarBtnNotif; }).catch(() => {});
    } catch {}
    if (avisosActivos()) {
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

  return { init, verificarCaducidades, revisarYAvisar: _revisarYAvisar, avisosActivos, retirarCaducados, _verEtiqueta, _imprimirEtiqueta, _borrarProducto, _habitualDesdeHistorial };

})();
