// ============================================================
// modulos/menu.js — Carta del restaurante: ingredientes y platos
// Depende de: core/supabase.js
// ============================================================

const ModuloMenu = (() => {

  const ALERGENOS_INFO = [
    { nombre:'gluten',            emoji:'🌾' },
    { nombre:'crustáceos',        emoji:'🦞' },
    { nombre:'huevo',             emoji:'🥚' },
    { nombre:'pescado',           emoji:'🐟' },
    { nombre:'cacahuetes',        emoji:'🥜' },
    { nombre:'soja',              emoji:'🌱' },
    { nombre:'leche',             emoji:'🥛' },
    { nombre:'frutos de cáscara', emoji:'🌰' },
    { nombre:'apio',              emoji:'🌿' },
    { nombre:'mostaza',           emoji:'🌼' },
    { nombre:'granos de sésamo',  emoji:'🫘' },
    { nombre:'altramuces',        emoji:'🌸' },
    { nombre:'moluscos',          emoji:'🐚' },
    { nombre:'sulfitos',          emoji:'🍷' }
  ];
  const NOMBRES_ALERGENOS = ALERGENOS_INFO.map(a => a.nombre);

  let _idIngredienteEditando = null;
  let _idPlatoEditando       = null;

  // Cachés en memoria + estado de búsqueda y selección
  let _todosIngredientes = [];
  let _todosPlatos       = [];
  let _busquedaIng       = '';
  let _busquedaPlato     = '';
  let _busquedaSelectorIng = '';
  let _platoSeleccionados  = new Set();

  function _ordAlfa(a, b) {
    return (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' });
  }

  function _coincide(texto, query) {
    if (!query) return true;
    return (texto || '').toLowerCase().includes(query.toLowerCase());
  }

  // ----------------------------------------------------------
  // VISTAS
  // ----------------------------------------------------------

  function _mostrarVistaPlatos(v) {
    document.getElementById('menu-platos-lista').style.display = v === 'lista' ? 'block' : 'none';
    document.getElementById('menu-platos-form').style.display  = v === 'form'  ? 'block' : 'none';
  }

  function _mostrarVistaIngs(v) {
    document.getElementById('menu-ings-lista').style.display = v === 'lista' ? 'block' : 'none';
    document.getElementById('menu-ings-form').style.display  = v === 'form'  ? 'block' : 'none';
  }

  // ----------------------------------------------------------
  // SUBTABS
  // ----------------------------------------------------------

  function _activarSubtab(cual) {
    document.querySelectorAll('#modulo-menu .sub-tab').forEach(b => b.classList.remove('activo'));
    document.querySelector(`#modulo-menu .sub-tab[data-subtab="${cual}"]`)?.classList.add('activo');
    document.getElementById('menu-sub-ingredientes').style.display = cual === 'ingredientes' ? 'block' : 'none';
    document.getElementById('menu-sub-platos').style.display       = cual === 'platos'       ? 'block' : 'none';
    _mostrarVistaPlatos('lista');
    _mostrarVistaIngs('lista');
  }

  // ----------------------------------------------------------
  // INGREDIENTES
  // ----------------------------------------------------------

  async function _renderIngredientes() {
    const lista = document.getElementById('menu-lista-ingredientes');
    if (!lista) return;
    lista.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      const items = await SB.obtenerIngredientes();
      _todosIngredientes = (items || []).slice().sort(_ordAlfa);
      _pintarIngredientes();
    } catch (e) { lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${e.message}</p>`; }
  }

  function _pintarIngredientes() {
    const lista = document.getElementById('menu-lista-ingredientes');
    if (!lista) return;
    if (!_todosIngredientes.length) {
      lista.innerHTML = '<p class="texto-vacio">No hay ingredientes. Añade el primero.</p>';
      return;
    }
    const filtrados = _todosIngredientes.filter(i => _coincide(i.nombre, _busquedaIng));
    if (!filtrados.length) {
      lista.innerHTML = `<p class="texto-vacio">Ningún ingrediente coincide con "${_busquedaIng}".</p>`;
      return;
    }
    lista.innerHTML = filtrados.map(ing => {
      const badges = ing.alergenos?.length
        ? ing.alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return `<span class="badge-alergeno" title="${a}">${i?.emoji ?? ''} ${a}</span>`; }).join('')
        : '<span class="badge-sin-alergenos">Sin alérgenos</span>';
      return `<div class="card-ingrediente" data-id="${ing.id}">
        <div class="card-ing-info">
          <span class="card-ing-nombre">${ing.nombre}</span>
          <div class="badges-alergenos">${badges}</div>
        </div>
        <div class="card-acciones">
          <button class="btn-mini btn-editar" onclick="ModuloMenu.editarIngrediente('${ing.id}')" title="Editar">✏ Editar</button>
          <button class="btn-mini btn-borrar" onclick="ModuloMenu.borrarIngrediente('${ing.id}','${ing.nombre.replace(/'/g,"\\'")}');" title="Eliminar">🗑 Eliminar</button>
        </div>
      </div>`;
    }).join('');
  }

  async function editarIngrediente(id) {
    const ing = await SB.obtenerIngrediente(id);
    if (!ing) return;
    _idIngredienteEditando = id;
    document.getElementById('ing-nombre').value = ing.nombre;
    NOMBRES_ALERGENOS.forEach(nombre => {
      const cb = document.getElementById('ing-al-' + nombre.replace(/\s+/g, '-'));
      if (cb) cb.checked = ing.alergenos?.includes(nombre) ?? false;
    });
    document.getElementById('ing-form-titulo').textContent = '✏ Editar Ingrediente';
    _activarSubtab('ingredientes');
    _mostrarVistaIngs('form');
    document.getElementById('ing-nombre').focus();
  }

  async function borrarIngrediente(id, nombre) {
    if (!confirm(`¿Eliminar el ingrediente "${nombre}"?\nSe eliminará también de los platos que lo usen.`)) return;
    await SB.eliminarIngrediente(id);
    const platos = await SB.obtenerPlatos();
    for (const plato of platos) {
      if (plato.ingredientes?.some(i => i.id === id)) {
        const ingsFiltrados = plato.ingredientes.filter(i => i.id !== id);
        const alergenos     = await _calcularAlergenos(ingsFiltrados.map(i => i.id));
        await SB.actualizarPlato({ ...plato, ingredientes: ingsFiltrados, alergenos });
      }
    }
    await _renderIngredientes();
    await _renderPlatos();
  }

  async function _guardarIngrediente() {
    const nombre = document.getElementById('ing-nombre').value.trim();
    if (!nombre) { alert('El nombre del ingrediente es obligatorio.'); return; }
    const btn = document.getElementById('ing-btn-guardar');
    if (btn) btn.disabled = true;
    try {
      const alergenos = NOMBRES_ALERGENOS.filter(a => {
        const cb = document.getElementById('ing-al-' + a.replace(/\s+/g, '-'));
        return cb?.checked;
      });
      if (_idIngredienteEditando !== null) {
        await SB.actualizarIngrediente({ id: _idIngredienteEditando, nombre, alergenos });
        const platos = await SB.obtenerPlatos();
        for (const plato of platos) {
          if (plato.ingredientes?.some(i => i.id === _idIngredienteEditando)) {
            const ingsActualizados = plato.ingredientes.map(i => i.id === _idIngredienteEditando ? { ...i, nombre } : i);
            const nuevosAl         = await _calcularAlergenos(ingsActualizados.map(i => i.id));
            await SB.actualizarPlato({ ...plato, ingredientes: ingsActualizados, alergenos: nuevosAl });
          }
        }
      } else {
        await SB.guardarIngrediente({ nombre, alergenos });
      }
      _resetFormIngrediente();
      await _renderIngredientes();
      await _renderSelectorIngredientes();
    } catch (e) {
      alert('Error al guardar el ingrediente: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function _nuevoIngredienteForm() {
    _idIngredienteEditando = null;
    document.getElementById('ing-nombre').value = '';
    NOMBRES_ALERGENOS.forEach(a => { const cb = document.getElementById('ing-al-' + a.replace(/\s+/g, '-')); if (cb) cb.checked = false; });
    document.getElementById('ing-form-titulo').textContent = 'Nuevo Ingrediente';
    _mostrarVistaIngs('form');
    document.getElementById('ing-nombre').focus();
  }

  function _resetFormIngrediente() {
    _idIngredienteEditando = null;
    document.getElementById('ing-nombre').value = '';
    NOMBRES_ALERGENOS.forEach(a => { const cb = document.getElementById('ing-al-' + a.replace(/\s+/g, '-')); if (cb) cb.checked = false; });
    document.getElementById('ing-form-titulo').textContent = 'Nuevo Ingrediente';
    _mostrarVistaIngs('lista');
  }

  // ----------------------------------------------------------
  // PLATOS
  // ----------------------------------------------------------

  async function _calcularAlergenos(idsIngredientes) {
    const conjunto = new Set();
    for (const id of idsIngredientes) {
      const ing = await SB.obtenerIngrediente(id);
      if (ing) ing.alergenos?.forEach(a => conjunto.add(a));
    }
    return [...conjunto];
  }

  async function _renderSelectorIngredientes() {
    const cont = document.getElementById('plato-selector-ingredientes');
    if (!cont) return;
    const todos = await SB.obtenerIngredientes();
    _todosIngredientes = (todos || []).slice().sort(_ordAlfa);
    if (!_todosIngredientes.length) {
      cont.innerHTML = '<p class="texto-vacio">Primero añade ingredientes en la pestaña "Ingredientes".</p>';
      return;
    }
    cont.innerHTML = _todosIngredientes.map(ing => `
      <label class="check-ingrediente" data-nombre-busqueda="${ing.nombre.toLowerCase()}">
        <input type="checkbox" class="plato-ing-check" value="${ing.id}" data-nombre="${ing.nombre}">
        ${ing.nombre}
        ${ing.alergenos?.length ? '<small>(' + ing.alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return i?.emoji ?? a; }).join(' ') + ')</small>' : ''}
      </label>`).join('');
    cont.querySelectorAll('.plato-ing-check').forEach(cb => cb.addEventListener('change', _actualizarAlergenos_realtime));
    _filtrarSelectorIngredientes();
  }

  function _filtrarSelectorIngredientes() {
    const q = _busquedaSelectorIng.toLowerCase().trim();
    document.querySelectorAll('#plato-selector-ingredientes .check-ingrediente').forEach(label => {
      const nombre = label.dataset.nombreBusqueda || '';
      label.style.display = !q || nombre.includes(q) ? '' : 'none';
    });
  }

  async function _actualizarAlergenos_realtime() {
    const ids       = [...document.querySelectorAll('.plato-ing-check:checked')].map(cb => cb.value);
    const alergenos = await _calcularAlergenos(ids);
    const div       = document.getElementById('plato-alergenos-calculados');
    if (!div) return;
    div.innerHTML = alergenos.length
      ? alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return `<span class="badge-alergeno">${i?.emoji ?? ''} ${a}</span>`; }).join('')
      : '<span class="badge-sin-alergenos">Ninguno</span>';
  }

  async function _renderPlatos() {
    const lista = document.getElementById('menu-lista-platos');
    if (!lista) return;
    lista.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      const platos = await SB.obtenerPlatos();
      _todosPlatos = (platos || []).slice().sort(_ordAlfa);
      _pintarPlatos();
    } catch (e) { lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${e.message}</p>`; }
  }

  function _pintarPlatos() {
    const lista = document.getElementById('menu-lista-platos');
    if (!lista) return;
    if (!_todosPlatos.length) {
      lista.innerHTML = '<p class="texto-vacio">No hay platos en la carta. Añade el primero.</p>';
      _actualizarBotonPdfSeleccion();
      return;
    }
    const filtrados = _todosPlatos.filter(p => _coincide(p.nombre, _busquedaPlato));
    if (!filtrados.length) {
      lista.innerHTML = `<p class="texto-vacio">Ningún plato coincide con "${_busquedaPlato}".</p>`;
      _actualizarBotonPdfSeleccion();
      return;
    }
    lista.innerHTML = filtrados.map(plato => {
      const badgesAl = plato.alergenos?.length
        ? plato.alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return `<span class="badge-alergeno" title="${a}">${i?.emoji ?? ''} ${a}</span>`; }).join('')
        : '<span class="badge-sin-alergenos">Sin alérgenos</span>';
      const ings = plato.ingredientes?.slice(0, 4).map(i => i.nombre).join(', ') + (plato.ingredientes?.length > 4 ? '…' : '');
      const sel  = _platoSeleccionados.has(plato.id) ? 'checked' : '';
      return `<div class="card-plato" data-id="${plato.id}">
        <div class="card-plato-cabecera">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1">
            <input type="checkbox" class="plato-select" value="${plato.id}" ${sel} style="width:18px;height:18px">
            <span class="card-plato-nombre">${plato.nombre}</span>
          </label>
          <div class="card-plato-precio">${plato.precio > 0 ? plato.precio.toFixed(2) + ' €' : ''}</div>
        </div>
        ${plato.descripcion ? `<div class="card-plato-desc">${plato.descripcion}</div>` : ''}
        <div class="card-plato-ingredientes">🥄 ${ings || 'Sin ingredientes asignados'}</div>
        <div class="badges-alergenos">${badgesAl}</div>
        <div class="card-acciones">
          <button class="btn-mini btn-editar" onclick="ModuloMenu.editarPlato('${plato.id}')">✏ Editar</button>
          <button class="btn-mini btn-pagar"  onclick="ModuloMenu.imprimirPlato('${plato.id}')">📄 PDF</button>
          <button class="btn-mini btn-borrar" onclick="ModuloMenu.borrarPlato('${plato.id}','${plato.nombre.replace(/'/g,"\\'")}');">🗑 Eliminar</button>
        </div>
      </div>`;
    }).join('');

    // Listeners para los checkboxes de selección
    lista.querySelectorAll('.plato-select').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) _platoSeleccionados.add(cb.value);
        else            _platoSeleccionados.delete(cb.value);
        _actualizarBotonPdfSeleccion();
      });
    });
    _actualizarBotonPdfSeleccion();
  }

  function _actualizarBotonPdfSeleccion() {
    const btn = document.getElementById('plato-pdf-seleccion');
    if (!btn) return;
    const n = _platoSeleccionados.size;
    btn.textContent = `📄 PDF (${n})`;
    btn.disabled = n === 0;
  }

  // ----------------------------------------------------------
  // GENERACIÓN DE PDF
  // ----------------------------------------------------------

  function _platoToHtml(plato) {
    const ings = plato.ingredientes?.length
      ? '<ul class="lista-ings">' + plato.ingredientes.map(i => `<li>${_esc(i.nombre)}</li>`).join('') + '</ul>'
      : '<p class="vacio">Sin ingredientes asignados</p>';
    const al = plato.alergenos?.length
      ? plato.alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return `<span class="al">${i?.emoji ?? ''} ${_esc(a)}</span>`; }).join(' ')
      : '<span class="sin-al">Ninguno declarado</span>';
    return `<article class="plato-pdf">
      <header class="plato-pdf-cab">
        <h2>${_esc(plato.nombre)}</h2>
        ${plato.precio > 0 ? `<div class="precio">${plato.precio.toFixed(2)} €</div>` : ''}
      </header>
      ${plato.descripcion ? `<p class="desc">${_esc(plato.descripcion)}</p>` : ''}
      <h3>Ingredientes</h3>
      ${ings}
      <h3>Alérgenos (Reg. UE 1169/2011)</h3>
      <div class="alergenos">${al}</div>
    </article>`;
  }

  function _generarPdfPlatos(platos, titulo) {
    if (!platos?.length) { alert('No hay platos para generar el PDF.'); return; }
    const win = window.open('', '_blank', 'width=900,height=900');
    if (!win) { alert('El navegador bloqueó la ventana emergente.\nPermite ventanas emergentes para esta página.'); return; }
    const fecha = new Date().toLocaleDateString('es-ES');
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${_esc(titulo)}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color:#222; margin:0; padding:0; }
.cabecera { text-align:center; border-bottom:2px solid #c0392b; padding-bottom:10px; margin-bottom:18px; }
.cabecera h1 { margin:0 0 4px 0; color:#c0392b; font-size:22pt; }
.cabecera .fecha { font-size:9pt; color:#666; }
.plato-pdf { padding:14px 0; border-bottom:1px dashed #bbb; page-break-inside:avoid; }
.plato-pdf:last-child { border-bottom:none; }
.plato-pdf-cab { display:flex; justify-content:space-between; align-items:baseline; gap:14px; margin-bottom:6px; }
.plato-pdf-cab h2 { margin:0; font-size:15pt; color:#222; }
.plato-pdf-cab .precio { font-size:13pt; font-weight:700; color:#c0392b; white-space:nowrap; }
.plato-pdf .desc { font-style:italic; color:#555; margin:4px 0 10px 0; font-size:10.5pt; }
.plato-pdf h3 { font-size:10pt; color:#555; margin:10px 0 4px 0; text-transform:uppercase; letter-spacing:0.5px; }
.lista-ings { margin:0; padding-left:18px; column-count:2; column-gap:24px; font-size:10.5pt; }
.lista-ings li { margin:1px 0; break-inside:avoid; }
.alergenos { font-size:10pt; }
.al { display:inline-block; background:#fdecea; color:#c0392b; padding:2px 8px; border-radius:10px; margin:2px 4px 2px 0; }
.sin-al { color:#27ae60; font-weight:600; }
.vacio { color:#999; font-style:italic; font-size:10pt; }
.pie { text-align:center; font-size:8pt; color:#888; margin-top:24px; padding-top:8px; border-top:1px solid #ccc; }
</style></head><body>
<div class="cabecera">
  <h1>${_esc(titulo)}</h1>
  <div class="fecha">Generado el ${fecha} · ${platos.length} plato${platos.length === 1 ? '' : 's'}</div>
</div>
${platos.map(_platoToHtml).join('')}
<div class="pie">Reg. UE 1169/2011 · RD 126/2015</div>
</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 600);
  }

  function imprimirPlato(id) {
    const plato = _todosPlatos.find(p => p.id === id);
    if (!plato) { alert('No se ha encontrado el plato. Recarga la página.'); return; }
    _generarPdfPlatos([plato], plato.nombre);
  }

  function _generarPdfSeleccionados() {
    const platos = _todosPlatos.filter(p => _platoSeleccionados.has(p.id));
    if (!platos.length) { alert('Marca primero los platos que quieres incluir en el PDF.'); return; }
    _generarPdfPlatos(platos, platos.length === 1 ? platos[0].nombre : 'Selección de platos');
  }

  function _generarPdfTodos() {
    if (!_todosPlatos.length) { alert('No hay platos en la carta.'); return; }
    _generarPdfPlatos(_todosPlatos, 'Carta del Restaurante');
  }

  function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  async function editarPlato(id) {
    const plato = await SB.obtenerPlato(id);
    if (!plato) return;
    _idPlatoEditando = id;
    document.getElementById('plato-nombre').value = plato.nombre;
    document.getElementById('plato-desc').value   = plato.descripcion || '';
    document.getElementById('plato-precio').value = plato.precio > 0 ? plato.precio : '';
    const idsPlato = plato.ingredientes?.map(i => i.id) || [];
    document.querySelectorAll('.plato-ing-check').forEach(cb => { cb.checked = idsPlato.includes(cb.value); });
    await _actualizarAlergenos_realtime();
    document.getElementById('plato-form-titulo').textContent = '✏ Editar Plato';
    _activarSubtab('platos');
    _mostrarVistaPlatos('form');
    document.getElementById('plato-nombre').focus();
  }

  async function borrarPlato(id, nombre) {
    if (!confirm(`¿Eliminar el plato "${nombre}" de la carta?`)) return;
    await SB.eliminarPlato(id);
    await _renderPlatos();
  }

  function _nuevoPlatoForm() {
    _idPlatoEditando = null;
    document.getElementById('plato-nombre').value  = '';
    document.getElementById('plato-desc').value    = '';
    document.getElementById('plato-precio').value  = '';
    document.querySelectorAll('.plato-ing-check').forEach(cb => cb.checked = false);
    const div = document.getElementById('plato-alergenos-calculados');
    if (div) div.innerHTML = '<span class="badge-sin-alergenos">Ninguno</span>';
    document.getElementById('plato-form-titulo').textContent = 'Nuevo Plato';
    _mostrarVistaPlatos('form');
    document.getElementById('plato-nombre').focus();
  }

  function _resetFormPlato() {
    _idPlatoEditando = null;
    document.getElementById('plato-nombre').value  = '';
    document.getElementById('plato-desc').value    = '';
    document.getElementById('plato-precio').value  = '';
    document.querySelectorAll('.plato-ing-check').forEach(cb => cb.checked = false);
    const div = document.getElementById('plato-alergenos-calculados');
    if (div) div.innerHTML = '<span class="badge-sin-alergenos">Ninguno</span>';
    document.getElementById('plato-form-titulo').textContent = 'Nuevo Plato';
    _mostrarVistaPlatos('lista');
  }

  async function _guardarPlato() {
    const nombre = document.getElementById('plato-nombre').value.trim();
    if (!nombre) { alert('El nombre del plato es obligatorio.'); return; }
    const btn = document.getElementById('plato-btn-guardar');
    if (btn) btn.disabled = true;
    try {
      const desc         = document.getElementById('plato-desc').value.trim();
      const precio       = parseFloat(document.getElementById('plato-precio').value) || 0;
      const checks       = [...document.querySelectorAll('.plato-ing-check:checked')];
      const ingredientes = checks.map(cb => ({ id: cb.value, nombre: cb.dataset.nombre }));
      const alergenos    = await _calcularAlergenos(ingredientes.map(i => i.id));
      const datos        = { nombre, descripcion: desc, precio, ingredientes, alergenos };
      if (_idPlatoEditando !== null) {
        await SB.actualizarPlato({ id: _idPlatoEditando, ...datos });
      } else {
        await SB.guardarPlato(datos);
      }
      _resetFormPlato();
      await _renderPlatos();
    } catch (e) {
      alert('Error al guardar el plato: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ----------------------------------------------------------
  // INICIALIZACIÓN
  // ----------------------------------------------------------

  async function init() {
    document.querySelectorAll('#modulo-menu .sub-tab').forEach(btn => {
      btn.addEventListener('click', () => _activarSubtab(btn.dataset.subtab));
    });
    document.getElementById('plato-btn-volver') ?.addEventListener('click', _resetFormPlato);
    document.getElementById('plato-btn-guardar')?.addEventListener('click', _guardarPlato);
    document.getElementById('ing-btn-volver')   ?.addEventListener('click', _resetFormIngrediente);
    document.getElementById('ing-btn-guardar')  ?.addEventListener('click', _guardarIngrediente);

    // Buscadores
    document.getElementById('ing-buscador')?.addEventListener('input', e => {
      _busquedaIng = e.target.value;
      _pintarIngredientes();
    });
    document.getElementById('plato-buscador')?.addEventListener('input', e => {
      _busquedaPlato = e.target.value;
      _pintarPlatos();
    });
    document.getElementById('plato-selector-buscador')?.addEventListener('input', e => {
      _busquedaSelectorIng = e.target.value;
      _filtrarSelectorIngredientes();
    });

    // Botones de PDF
    document.getElementById('plato-pdf-seleccion')?.addEventListener('click', _generarPdfSeleccionados);
    document.getElementById('plato-pdf-todos')    ?.addEventListener('click', _generarPdfTodos);

    _activarSubtab('platos');
    await _renderIngredientes();
    await _renderSelectorIngredientes();
    await _renderPlatos();
  }

  return {
    init,
    editarIngrediente, borrarIngrediente,
    editarPlato, borrarPlato, imprimirPlato,
    nuevoPlatoForm: _nuevoPlatoForm,
    nuevoIngredienteForm: _nuevoIngredienteForm,
    cancelarPlatoForm: _resetFormPlato,
    cancelarIngredienteForm: _resetFormIngrediente
  };

})();
