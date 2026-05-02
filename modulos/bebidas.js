// ============================================================
// modulos/bebidas.js — Carta de bebidas del restaurante
// Depende de: core/supabase.js
// ============================================================

const ModuloBebidas = (() => {

  const CATEGORIAS = [
    { valor: 'agua',     label: '💧 Agua' },
    { valor: 'refresco', label: '🥤 Refrescos' },
    { valor: 'cerveza',  label: '🍺 Cerveza' },
    { valor: 'vino',     label: '🍷 Vinos' },
    { valor: 'licor',    label: '🥃 Licores y combinados' },
    { valor: 'cafe',     label: '☕ Cafés e infusiones' },
    { valor: 'zumo',     label: '🍊 Zumos' },
    { valor: 'otro',     label: '🫗 Otros' },
  ];

  let _idEditando = null;

  // ----------------------------------------------------------
  // VISTAS
  // ----------------------------------------------------------

  function _mostrarVista(v) {
    document.getElementById('beb-lista-vista').style.display = v === 'lista' ? 'block' : 'none';
    document.getElementById('beb-form-vista').style.display  = v === 'form'  ? 'block' : 'none';
  }

  // ----------------------------------------------------------
  // LISTA
  // ----------------------------------------------------------

  async function _renderLista() {
    const lista = document.getElementById('beb-lista');
    if (!lista) return;
    lista.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      const items = await SB.obtenerBebidas();
      if (!items?.length) {
        lista.innerHTML = '<p class="texto-vacio">No hay bebidas. Añade la primera.</p>';
        return;
      }
      lista.innerHTML = items.map(b => {
        const cat = CATEGORIAS.find(c => c.valor === b.categoria);
        return `<div class="card-plato" data-id="${b.id}">
          <div class="card-plato-cabecera">
            <div class="card-plato-nombre">${_esc(b.nombre)}</div>
            <div class="card-plato-precio">${b.precio > 0 ? b.precio.toFixed(2) + ' €' : ''}</div>
          </div>
          ${b.descripcion ? `<div class="card-plato-desc">${_esc(b.descripcion)}</div>` : ''}
          <div class="card-plato-ingredientes">${cat?.label ?? b.categoria}</div>
          <div class="card-acciones">
            <button class="btn-mini btn-editar" onclick="ModuloBebidas.editarBebida('${b.id}')">✏ Editar</button>
            <button class="btn-mini btn-borrar" onclick="ModuloBebidas.borrarBebida('${b.id}','${b.nombre.replace(/'/g, "\\'")}')">🗑 Eliminar</button>
          </div>
        </div>`;
      }).join('');
    } catch (e) {
      lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${e.message}</p>`;
    }
  }

  // ----------------------------------------------------------
  // FORMULARIO
  // ----------------------------------------------------------

  async function editarBebida(id) {
    const b = await SB.obtenerBebida(id);
    if (!b) return;
    _idEditando = id;
    document.getElementById('beb-nombre').value    = b.nombre;
    document.getElementById('beb-desc').value      = b.descripcion || '';
    document.getElementById('beb-precio').value    = b.precio > 0 ? b.precio : '';
    document.getElementById('beb-categoria').value = b.categoria || 'otro';
    document.getElementById('beb-form-titulo').textContent = '✏ Editar Bebida';
    _mostrarVista('form');
    document.getElementById('beb-nombre').focus();
  }

  async function borrarBebida(id, nombre) {
    if (!confirm(`¿Eliminar la bebida "${nombre}"?`)) return;
    await SB.eliminarBebida(id);
    await _renderLista();
  }

  function _nuevaBebidaForm() {
    _idEditando = null;
    document.getElementById('beb-nombre').value    = '';
    document.getElementById('beb-desc').value      = '';
    document.getElementById('beb-precio').value    = '';
    document.getElementById('beb-categoria').value = 'refresco';
    document.getElementById('beb-form-titulo').textContent = 'Nueva Bebida';
    _mostrarVista('form');
    document.getElementById('beb-nombre').focus();
  }

  function _resetForm() {
    _idEditando = null;
    document.getElementById('beb-nombre').value    = '';
    document.getElementById('beb-desc').value      = '';
    document.getElementById('beb-precio').value    = '';
    document.getElementById('beb-categoria').value = 'refresco';
    document.getElementById('beb-form-titulo').textContent = 'Nueva Bebida';
    _mostrarVista('lista');
  }

  async function _guardarBebida() {
    const nombre = document.getElementById('beb-nombre').value.trim();
    if (!nombre) { alert('El nombre de la bebida es obligatorio.'); return; }
    const btn = document.getElementById('beb-btn-guardar');
    if (btn) btn.disabled = true;
    try {
      const datos = {
        nombre,
        descripcion: document.getElementById('beb-desc').value.trim(),
        precio:      parseFloat(document.getElementById('beb-precio').value) || 0,
        categoria:   document.getElementById('beb-categoria').value || 'otro',
      };
      if (_idEditando !== null) {
        await SB.actualizarBebida({ id: _idEditando, ...datos });
      } else {
        await SB.guardarBebida(datos);
      }
      _resetForm();
      await _renderLista();
    } catch (e) {
      alert('Error al guardar la bebida: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ----------------------------------------------------------
  // INICIALIZACIÓN
  // ----------------------------------------------------------

  async function init() {
    document.getElementById('beb-btn-volver') ?.addEventListener('click', _resetForm);
    document.getElementById('beb-btn-guardar')?.addEventListener('click', _guardarBebida);
    await _renderLista();
  }

  function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return { init, editarBebida, borrarBebida, nuevaBebidaForm: _nuevaBebidaForm };

})();
