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
      if (!items?.length) { lista.innerHTML = '<p class="texto-vacio">No hay ingredientes. Añade el primero.</p>'; return; }
      lista.innerHTML = items.map(ing => {
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
    } catch (e) { lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${e.message}</p>`; }
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
    if (!todos?.length) { cont.innerHTML = '<p class="texto-vacio">Primero añade ingredientes en la pestaña "Ingredientes".</p>'; return; }
    cont.innerHTML = todos.map(ing => `
      <label class="check-ingrediente">
        <input type="checkbox" class="plato-ing-check" value="${ing.id}" data-nombre="${ing.nombre}">
        ${ing.nombre}
        ${ing.alergenos?.length ? '<small>(' + ing.alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return i?.emoji ?? a; }).join(' ') + ')</small>' : ''}
      </label>`).join('');
    cont.querySelectorAll('.plato-ing-check').forEach(cb => cb.addEventListener('change', _actualizarAlergenos_realtime));
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
      if (!platos?.length) { lista.innerHTML = '<p class="texto-vacio">No hay platos en la carta. Añade el primero.</p>'; return; }
      lista.innerHTML = platos.map(plato => {
        const badgesAl = plato.alergenos?.length
          ? plato.alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return `<span class="badge-alergeno" title="${a}">${i?.emoji ?? ''} ${a}</span>`; }).join('')
          : '<span class="badge-sin-alergenos">Sin alérgenos</span>';
        const ings = plato.ingredientes?.slice(0, 4).map(i => i.nombre).join(', ') + (plato.ingredientes?.length > 4 ? '…' : '');
        return `<div class="card-plato" data-id="${plato.id}">
          <div class="card-plato-cabecera">
            <div class="card-plato-nombre">${plato.nombre}</div>
            <div class="card-plato-precio">${plato.precio > 0 ? plato.precio.toFixed(2) + ' €' : ''}</div>
          </div>
          ${plato.descripcion ? `<div class="card-plato-desc">${plato.descripcion}</div>` : ''}
          <div class="card-plato-ingredientes">🥄 ${ings || 'Sin ingredientes asignados'}</div>
          <div class="badges-alergenos">${badgesAl}</div>
          <div class="card-acciones">
            <button class="btn-mini btn-editar" onclick="ModuloMenu.editarPlato('${plato.id}')">✏ Editar</button>
            <button class="btn-mini btn-borrar" onclick="ModuloMenu.borrarPlato('${plato.id}','${plato.nombre.replace(/'/g,"\\'")}');">🗑 Eliminar</button>
          </div>
        </div>`;
      }).join('');
    } catch (e) { lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${e.message}</p>`; }
  }

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
    document.getElementById('plato-btn-nuevo')  ?.addEventListener('click', _nuevoPlatoForm);
    document.getElementById('plato-btn-volver') ?.addEventListener('click', _resetFormPlato);
    document.getElementById('plato-btn-guardar')?.addEventListener('click', _guardarPlato);
    document.getElementById('ing-btn-nuevo')    ?.addEventListener('click', _nuevoIngredienteForm);
    document.getElementById('ing-btn-volver')   ?.addEventListener('click', _resetFormIngrediente);
    document.getElementById('ing-btn-guardar')  ?.addEventListener('click', _guardarIngrediente);
    _activarSubtab('platos');
    await _renderIngredientes();
    await _renderSelectorIngredientes();
    await _renderPlatos();
  }

  return { init, editarIngrediente, borrarIngrediente, editarPlato, borrarPlato };

})();
