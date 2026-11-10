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

  const ALERGENOS = [
    ['gluten','🌾'],['crustáceos','🦞'],['huevo','🥚'],['pescado','🐟'],['cacahuetes','🥜'],['soja','🌱'],['leche','🥛'],
    ['frutos de cáscara','🌰'],['apio','🌿'],['mostaza','🌼'],['granos de sésamo','🫘'],['altramuces','🌸'],['moluscos','🐚'],['sulfitos','🍷'],
  ];

  function _renderChecksAlergenos() {
    const cont = document.getElementById('beb-alergenos');
    if (!cont || cont.childElementCount) return;
    cont.innerHTML = ALERGENOS.map(([a, e], i) =>
      `<label class="check-alergeno"><input type="checkbox" id="beb-al-${i}" value="${a}"> ${e} ${a}</label>`).join('');
  }
  const _leerAlergenos = () => ALERGENOS.map(([a], i) => document.getElementById(`beb-al-${i}`)?.checked ? a : null).filter(Boolean);
  const _ponerAlergenos = (lista = []) => ALERGENOS.forEach(([a], i) => { const c = document.getElementById(`beb-al-${i}`); if (c) c.checked = lista.includes(a); });

  let _idEditando = null;
  let _bebidas    = [];
  let _costes     = new Map();   // id bebida → coste (solo propietario y encargado)

  // ----------------------------------------------------------
  // COSTE POR SERVICIO
  // ----------------------------------------------------------

  const _FORMATOS = ['700', '750', '1000', '1500', '5000', '20000', '30000', '50000'];
  function _leerCoste() {
    const sel = document.getElementById('beb-formato')?.value || '';
    const formato = sel === 'otro' ? Number(document.getElementById('beb-formato-otro')?.value) : Number(sel);
    const precio  = (document.getElementById('beb-compra')?.value || '').trim().replace(',', '.');
    return {
      precio_compra: precio === '' ? null : Number(precio),
      formato_ml: formato > 0 ? formato : null,
      racion_ml: formato > 0 ? Number(document.getElementById('beb-racion')?.value) || null : null,
    };
  }
  function _ponerCoste(c) {
    const f = c?.formato_ml ? String(c.formato_ml) : '';
    const sel = document.getElementById('beb-formato');
    if (sel) sel.value = !f ? '' : _FORMATOS.includes(f) ? f : 'otro';
    const otro = document.getElementById('beb-formato-otro');
    if (otro) otro.value = f && !_FORMATOS.includes(f) ? f : '';
    const precio = document.getElementById('beb-compra');
    if (precio) precio.value = c?.precio_compra ?? '';
    const racion = document.getElementById('beb-racion');
    if (racion) racion.value = c?.racion_ml ?? '';
    _actualizarCoste();
  }
  // Muestra/oculta campos y calcula coste por servicio y % sobre el precio de venta
  function _actualizarCoste() {
    const sel = document.getElementById('beb-formato')?.value || '';
    const otro = document.getElementById('beb-formato-otro');
    if (otro) otro.hidden = sel !== 'otro';
    const grupo = document.getElementById('beb-racion-grupo');
    if (grupo) grupo.hidden = !sel;
    const div = document.getElementById('beb-coste-resultado');
    if (!div || typeof ModuloMenu === 'undefined') return;
    const c = _leerCoste();
    const coste = ModuloMenu.costeBebida(c);
    if (coste == null) { div.innerHTML = ''; return; }
    if (c.formato_ml && !c.racion_ml) { div.innerHTML = '<span class="warn">Indica cuántos ml se sirven para calcular el coste por copa.</span>'; return; }
    const pvp = parseFloat(document.getElementById('beb-precio')?.value) || 0;
    const imp = ModuloMenu.impuestoCarta(), obj = ModuloMenu.objetivoCoste();
    const sinImp = pvp / (1 + imp / 100);
    const pct = sinImp > 0 ? coste / sinImp * 100 : null;
    const porEnvase = c.formato_ml && c.racion_ml ? ` · salen ${Math.floor(c.formato_ml / c.racion_ml)} por envase` : '';
    div.innerHTML = `Coste por servicio: <strong>${dinero(r2(coste))} €</strong>${porEnvase}` +
      (pct != null ? ` · <strong class="${ModuloMenu.nivelCoste(pct, obj)}">${ModuloMenu.pctTexto(pct)}</strong> del precio sin ${imp === 10 ? 'IVA' : 'IGIC'} · margen ${dinero(r2(sinImp - coste))} €` : '');
  }

  // Traducciones (carta QR)
  const _IDIOMAS = ['en', 'de'];
  function _ponerTraducciones(t = {}) {
    _IDIOMAS.forEach(l => {
      const n = document.getElementById('beb-tr-' + l + '-nombre'), d = document.getElementById('beb-tr-' + l + '-desc');
      if (n) n.value = t?.[l]?.nombre || '';
      if (d) d.value = t?.[l]?.descripcion || '';
    });
    const det = document.getElementById('beb-traducciones');
    if (det) det.open = _IDIOMAS.some(l => t?.[l]?.nombre);
  }
  const _leerTraducciones = () => Object.fromEntries(_IDIOMAS.map(l => [l, {
    nombre: document.getElementById('beb-tr-' + l + '-nombre')?.value || '',
    descripcion: document.getElementById('beb-tr-' + l + '-desc')?.value || '',
  }]));

  // ----------------------------------------------------------
  // VISTAS
  // ----------------------------------------------------------

  function _mostrarVista(v) {
    document.getElementById('beb-lista-vista').style.display = v === 'lista' ? 'block' : 'none';
    document.getElementById('beb-form-vista').style.display  = v === 'form'  ? 'block' : 'none';
    if (v === 'form') Navegacion.abrir(() => _resetForm()); else Navegacion.cerrada();
  }

  // ----------------------------------------------------------
  // LISTA
  // ----------------------------------------------------------

  async function _renderLista() {
    const lista = document.getElementById('beb-lista');
    if (!lista) return;
    lista.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      const [items, costes] = await Promise.all([SB.obtenerBebidas(), SB.obtenerCostes().catch(() => [])]);
      _bebidas = items || [];
      _costes = new Map((costes || []).filter(c => c.tipo === 'bebida').map(c => [c.id, c]));
      if (!items?.length) {
        lista.innerHTML = '<p class="texto-vacio">No hay bebidas. Añade la primera.</p>';
        return;
      }
      lista.innerHTML = items.map(b => {
        const cat = CATEGORIAS.find(c => c.valor === b.categoria);
        return `<div class="card-plato" data-id="${b.id}">
          <div class="card-plato-cabecera">
            <div class="card-plato-nombre">${_esc(b.nombre)}</div>
            <div class="card-plato-precio">${b.precio > 0 ? dinero(b.precio) + ' €' : ''}</div>
          </div>
          ${b.descripcion ? `<div class="card-plato-desc">${_esc(b.descripcion)}</div>` : ''}
          <div class="card-plato-ingredientes">${cat?.label ?? _esc(b.categoria)}</div>
          ${_htmlCoste(b)}
          <div class="badges-alergenos">${(b.alergenos || []).length
            ? b.alergenos.map(a => `<span class="badge-alergeno">${(ALERGENOS.find(x => x[0] === a) || [])[1] || ''} ${_esc(a)}</span>`).join('')
            : '<span class="badge-sin-alergenos">Sin alérgenos</span>'}</div>
          <div class="card-acciones">
            <button class="btn-mini btn-editar" onclick="ModuloBebidas.editarBebida('${b.id}')"><svg class="ic" aria-hidden="true"><use href="#i-pencil"/></svg> Editar</button>
            <button class="btn-mini btn-borrar" onclick="ModuloBebidas.borrarBebida('${b.id}')"><svg class="ic" aria-hidden="true"><use href="#i-trash-2"/></svg> Eliminar</button>
          </div>
        </div>`;
      }).join('');
    } catch (e) {
      lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${_esc(e.message)}</p>`;
    }
  }

  function _htmlCoste(b) {
    if (!SB.puedeGestionar() || typeof ModuloMenu === 'undefined') return '';
    const coste = ModuloMenu.costeBebida(_costes.get(b.id));
    if (coste == null) return '<div class="card-ing-precio sin">Sin precio de compra</div>';
    const imp = ModuloMenu.impuestoCarta(), sinImp = (Number(b.precio) || 0) / (1 + imp / 100);
    const pct = sinImp > 0 ? coste / sinImp * 100 : null;
    return `<div class="card-ing-precio">Coste ${dinero(r2(coste))} €${pct != null ? ` · <span class="esc-fila-pct ${ModuloMenu.nivelCoste(pct, ModuloMenu.objetivoCoste())}">${ModuloMenu.pctTexto(pct)}</span>` : ''}</div>`;
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
    _renderChecksAlergenos(); _ponerAlergenos(b.alergenos || []);
    if (!_costes.size && SB.puedeGestionar()) {
      try { _costes = new Map((await SB.obtenerCostes()).filter(c => c.tipo === 'bebida').map(c => [c.id, c])); } catch {}
    }
    _ponerCoste(_costes.get(id));
    _ponerTraducciones(b.traducciones || {});
    document.getElementById('beb-form-titulo').textContent = 'Editar bebida';
    _mostrarVista('form');
    document.getElementById('beb-nombre').focus();
  }

  async function borrarBebida(id) {
    const nombre = _bebidas.find(b => b.id === id)?.nombre || 'esta bebida';
    if (!confirm(`¿Eliminar la bebida "${nombre}"?`)) return;
    try {
      await SB.eliminarBebida(id);
      SB.eliminarCoste(id);
    } catch (e) {
      alert('Error al eliminar la bebida: ' + e.message);
    }
    await _renderLista();
  }

  function _nuevaBebidaForm() {
    _idEditando = null;
    document.getElementById('beb-nombre').value    = '';
    document.getElementById('beb-desc').value      = '';
    document.getElementById('beb-precio').value    = '';
    document.getElementById('beb-categoria').value = 'refresco';
    _renderChecksAlergenos(); _ponerAlergenos([]);
    _ponerCoste(null);
    _ponerTraducciones({});
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
        alergenos:   _leerAlergenos(),
        traducciones: _leerTraducciones(),
      };
      const coste = _leerCoste();
      if (coste.precio_compra != null && !(coste.precio_compra >= 0)) { alert('El precio de compra no es válido.'); return; }
      let id = _idEditando;
      if (_idEditando !== null) {
        await SB.actualizarBebida({ id: _idEditando, ...datos });
      } else {
        id = (await SB.guardarBebida(datos))?.id;
      }
      // El coste va aparte (solo lo ven propietario y encargado)
      if (id && SB.puedeGestionar() && (_costes.has(id) || coste.precio_compra != null)) {
        const fila = await SB.guardarCoste('bebida', id, coste);
        if (fila) _costes.set(id, fila);
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
    _renderChecksAlergenos();
    ['beb-compra', 'beb-formato', 'beb-formato-otro', 'beb-racion', 'beb-precio'].forEach(idc =>
      document.getElementById(idc)?.addEventListener(idc === 'beb-formato' ? 'change' : 'input', _actualizarCoste));
    // Al elegir «Vinos», sugerir sulfitos; «Cerveza», gluten (se pueden desmarcar)
    document.getElementById('beb-categoria')?.addEventListener('change', e => {
      if (_idEditando !== null) return;
      const sug = { vino: 'sulfitos', cerveza: 'gluten' }[e.target.value];
      if (sug) _ponerAlergenos([...new Set([..._leerAlergenos(), sug])]);
    });
    await _renderLista();
  }

  function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  return { init, editarBebida, borrarBebida, nuevaBebidaForm: _nuevaBebidaForm, cancelarBebidaForm: _resetForm };

})();
