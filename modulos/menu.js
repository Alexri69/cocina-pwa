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
  let _cantidades          = {};   // escandallo del formulario: id ingrediente → cantidad por ración
  let _costes              = new Map();   // id ingrediente → { precio_compra, unidad, merma } (solo dirección)
  let _costesBeb           = new Map();   // id bebida → { precio_compra, formato_ml, racion_ml }
  let _todasBebidas        = [];

  /** Ingredientes con su coste de compra (el coste está en una tabla privada de la dirección). */
  async function _ingredientesConCoste() {
    const [ings, costes] = await Promise.all([SB.obtenerIngredientes(), SB.obtenerCostes().catch(() => [])]);
    _costes = new Map((costes || []).filter(c => c.tipo === 'ingrediente').map(c => [c.id, c]));
    _costesBeb = new Map((costes || []).filter(c => c.tipo === 'bebida').map(c => [c.id, c]));
    return (ings || []).map(_conCoste);
  }
  const _conCoste = i => {
    const c = _costes.get(i.id);
    return { ...i, precio_compra: c?.precio_compra ?? null, unidad: c?.unidad || 'kg', merma: Number(c?.merma) || 0 };
  };

  // Traducciones del plato (carta QR en inglés y alemán)
  const _IDIOMAS = ['en', 'de'];
  function _ponerTraducciones(t = {}) {
    _IDIOMAS.forEach(l => {
      const n = document.getElementById('plato-tr-' + l + '-nombre'), d = document.getElementById('plato-tr-' + l + '-desc');
      if (n) n.value = t?.[l]?.nombre || '';
      if (d) d.value = t?.[l]?.descripcion || '';
    });
    const det = document.getElementById('plato-traducciones');
    if (det) det.open = _IDIOMAS.some(l => t?.[l]?.nombre);
  }
  const _leerTraducciones = () => Object.fromEntries(_IDIOMAS.map(l => [l, {
    nombre: document.getElementById('plato-tr-' + l + '-nombre')?.value || '',
    descripcion: document.getElementById('plato-tr-' + l + '-desc')?.value || '',
  }]));

  // Proveedores en el formulario de ingrediente
  async function _rellenarProveedores(seleccionado) {
    const sel = document.getElementById('ing-proveedor');
    if (!sel) return;
    let provs = [];
    try { provs = await SB.obtenerProveedores(); } catch {}
    sel.innerHTML = '<option value="">— Sin proveedor —</option>' +
      provs.map(p => `<option value="${_esc(p.id)}">${_esc(p.nombre)}</option>`).join('');
    sel.value = seleccionado || '';
  }

  // ----------------------------------------------------------
  // ESCANDALLOS (coste por ración)
  //   ingrediente: precio_compra € por kg | l | ud, merma % (lo que se pierde al limpiar o cocinar)
  //   plato.ingredientes[i].cantidad: g (kg), ml (l) o unidades (ud) por ración
  // ----------------------------------------------------------

  const UNIDAD_RACION = { kg: 'g', l: 'ml', ud: 'ud' };
  const _tienePrecio  = ing => ing && ing.precio_compra != null && ing.precio_compra !== '' && isFinite(Number(ing.precio_compra));

  /** Coste de una cantidad de ingrediente (null si falta el precio o la cantidad). */
  function costeLinea(ing, cantidad) {
    const c = Number(cantidad);
    if (!_tienePrecio(ing) || !(c > 0)) return null;
    const porUnidad   = (ing.unidad === 'ud') ? c : c / 1000;          // g → kg, ml → l
    const rendimiento = 1 - Math.min(95, Math.max(0, Number(ing.merma) || 0)) / 100;
    return porUnidad * Number(ing.precio_compra) / rendimiento;
  }

  /**
   * Coste de un servicio de bebida: precio del envase × ml por servicio ÷ ml del envase
   * (sin ml = se vende el envase entero: lata, botellín, botella de vino). null si no hay precio.
   */
  function costeBebida(c) {
    const precio = Number(c?.precio_compra);
    if (c?.precio_compra == null || c?.precio_compra === '' || !(precio >= 0)) return null;
    const formato = Number(c.formato_ml), racion = Number(c.racion_ml);
    return formato > 0 && racion > 0 ? precio * racion / formato : precio;
  }

  function _impuestoCarta() {
    const cfg = _datosEmpresa();
    return cfg.regimen === 'iva' ? 10 : 7;   // hostelería: IVA reducido 10 % · IGIC general 7 %
  }
  function _objetivoCoste() {
    const v = Number(_datosEmpresa().objetivoCoste);
    return v >= 5 && v <= 80 ? v : 30;
  }

  /**
   * Escandallo de un plato. pvp = precio de carta con impuestos.
   * Devuelve { coste, completo, faltan[], pvpSinImp, pct, margen, recomendado }.
   */
  function escandallo(lineas, ingredientes, pvp, { impuesto = 7, objetivo = 30 } = {}) {
    const porId = new Map((ingredientes || []).map(i => [i.id, i]));
    let coste = 0; const faltan = [];
    for (const l of (lineas || [])) {
      const ing = porId.get(l.id);
      const c   = costeLinea(ing, l.cantidad);
      if (c == null) faltan.push(ing?.nombre || l.nombre || '¿?');
      else coste += c;
    }
    coste = r2(coste);
    const pvpSinImp   = pvp > 0 ? pvp / (1 + impuesto / 100) : 0;
    const pct         = pvpSinImp > 0 && coste > 0 ? coste / pvpSinImp * 100 : null;
    const margen      = pvpSinImp > 0 ? r2(pvpSinImp - coste) : null;
    const recomendado = coste > 0 ? Math.ceil(coste / (objetivo / 100) * (1 + impuesto / 100) * 10) / 10 : null;
    return { coste, completo: !faltan.length && (lineas || []).length > 0, faltan, pvpSinImp: r2(pvpSinImp), pct, margen, recomendado };
  }

  // Estado respecto al objetivo: ok (dentro), warn (hasta 5 puntos por encima), err (más)
  const _nivel = (pct, objetivo) => pct == null ? '' : pct <= objetivo ? 'ok' : pct <= objetivo + 5 ? 'warn' : 'err';
  const _pct   = p => p == null ? '—' : p.toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' %';
  const _precioIng = ing => _tienePrecio(ing)
    ? `${dinero(ing.precio_compra)} €/${ing.unidad || 'kg'}${Number(ing.merma) > 0 ? ` · merma ${Number(ing.merma).toLocaleString('es-ES')} %` : ''}`
    : '';

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
    if (v === 'form') Navegacion.abrir(() => _resetFormPlato()); else Navegacion.cerrada();
  }

  function _mostrarVistaIngs(v) {
    document.getElementById('menu-ings-lista').style.display = v === 'lista' ? 'block' : 'none';
    document.getElementById('menu-ings-form').style.display  = v === 'form'  ? 'block' : 'none';
    if (v === 'form') Navegacion.abrir(() => _resetFormIngrediente()); else Navegacion.cerrada();
  }

  // ----------------------------------------------------------
  // SUBTABS
  // ----------------------------------------------------------

  function _activarSubtab(cual) {
    document.querySelectorAll('#modulo-menu .sub-tab').forEach(b => b.classList.remove('activo'));
    document.querySelector(`#modulo-menu .sub-tab[data-subtab="${cual}"]`)?.classList.add('activo');
    document.getElementById('menu-sub-ingredientes').style.display = cual === 'ingredientes' ? 'block' : 'none';
    document.getElementById('menu-sub-platos').style.display       = cual === 'platos'       ? 'block' : 'none';
    const subEsc = document.getElementById('menu-sub-escandallos');
    if (subEsc) subEsc.style.display = cual === 'escandallos' ? 'block' : 'none';
    _mostrarVistaPlatos('lista');
    _mostrarVistaIngs('lista');
    if (cual === 'escandallos') _renderEscandallos();
  }

  // ----------------------------------------------------------
  // PESTAÑA ESCANDALLOS: coste y margen de todos los platos
  // ----------------------------------------------------------

  async function _renderEscandallos() {
    const cont = document.getElementById('menu-escandallos');
    if (!cont) return;
    const inpObj = document.getElementById('esc-objetivo');
    if (inpObj && document.activeElement !== inpObj) inpObj.value = _objetivoCoste();
    cont.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      const [platos, ings, bebidas] = await Promise.all([SB.obtenerPlatos(), _ingredientesConCoste(), SB.obtenerBebidas().catch(() => [])]);
      _todosPlatos = (platos || []).slice().sort(_ordAlfa);
      _todosIngredientes = (ings || []).slice().sort(_ordAlfa);
      _todasBebidas = (bebidas || []).slice().sort(_ordAlfa);
    } catch (e) { cont.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${_esc(e.message)}</p>`; return; }

    if (!_todosPlatos.length && !_todasBebidas.length) { cont.innerHTML = '<p class="texto-vacio">Aún no hay platos ni bebidas en la carta.</p>'; return; }
    const objetivo = _objetivoCoste(), impuesto = _impuestoCarta();
    const filas = _todosPlatos.map(p => ({ p, e: escandallo(p.ingredientes, _todosIngredientes, Number(p.precio) || 0, { impuesto, objetivo }) }))
      // Primero los que más se comen el margen; al final los que no tienen datos
      .sort((a, b) => (b.e.pct ?? -1) - (a.e.pct ?? -1));
    const conCoste = filas.filter(f => f.e.pct != null);
    const media    = conCoste.length ? conCoste.reduce((s, f) => s + f.e.pct, 0) / conCoste.length : null;
    const altos    = conCoste.filter(f => f.e.pct > objetivo).length;
    const sinPrecio = _todosIngredientes.filter(i => !_tienePrecio(i)).length;

    cont.innerHTML = `
      <div class="esc-resumen">
        <div class="esc-dato"><span class="esc-dato-n">${conCoste.length}<small> / ${filas.length}</small></span><span class="esc-dato-t">platos con coste</span></div>
        <div class="esc-dato"><span class="esc-dato-n ${_nivel(media, objetivo)}">${_pct(media)}</span><span class="esc-dato-t">coste medio</span></div>
        <div class="esc-dato"><span class="esc-dato-n ${altos ? 'err' : 'ok'}">${altos}</span><span class="esc-dato-t">por encima del ${objetivo}&nbsp;%</span></div>
      </div>
      ${sinPrecio ? `<p class="esc-aviso"><svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg> ${sinPrecio} ingrediente${sinPrecio === 1 ? '' : 's'} sin precio de compra. <button type="button" class="btn-enlace" data-esc="ingredientes">Ponerles precio</button></p>` : ''}
      <div class="esc-lista">
        ${filas.map(({ p, e }) => {
          const nivel = _nivel(e.pct, objetivo);
          const detalle = !(p.ingredientes || []).length ? 'Sin ingredientes asignados'
            : e.faltan.length ? `Falta precio o cantidad: ${_esc(e.faltan.slice(0, 3).join(', '))}${e.faltan.length > 3 ? '…' : ''}`
            : !(Number(p.precio) > 0) ? 'Sin precio de venta'
            : `Margen ${dinero(e.margen)} € por ración`;
          return `<button type="button" class="esc-fila ${nivel}" data-esc-plato="${p.id}">
            <span class="esc-fila-nombre">${_esc(p.nombre)}<small>${detalle}</small></span>
            <span class="esc-fila-num"><small>Coste</small>${e.coste > 0 ? dinero(e.coste) + ' €' : '—'}</span>
            <span class="esc-fila-num"><small>PVP</small>${Number(p.precio) > 0 ? dinero(p.precio) + ' €' : '—'}</span>
            <span class="esc-fila-pct ${nivel}">${_pct(e.pct)}</span>
          </button>`;
        }).join('')}
      </div>
      ${_htmlBebidasEscandallo(objetivo, impuesto)}
      <p class="appcc-nota">% de coste = coste de la ración ÷ precio de carta sin ${impuesto === 10 ? 'IVA' : 'IGIC'} (${impuesto} %). Toca un plato o una bebida para ajustarlo.</p>`;
  }

  function _htmlBebidasEscandallo(objetivo, impuesto) {
    if (!_todasBebidas.length) return '';
    const filas = _todasBebidas.map(b => {
      const c = costeBebida(_costesBeb.get(b.id));
      const pvp = Number(b.precio) || 0, sinImp = pvp / (1 + impuesto / 100);
      const pct = c != null && sinImp > 0 ? c / sinImp * 100 : null;
      return { b, c, pct, margen: c != null && sinImp > 0 ? r2(sinImp - c) : null };
    }).sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1));
    return `<h3 class="esc-subtitulo">Bebidas</h3><div class="esc-lista">${filas.map(({ b, c, pct, margen }) => {
      const nivel = _nivel(pct, objetivo);
      const cb = _costesBeb.get(b.id);
      const servicio = cb?.formato_ml && cb?.racion_ml ? `${cb.racion_ml} ml de ${cb.formato_ml} ml` : 'envase entero';
      const detalle = c == null ? 'Sin precio de compra' : !(Number(b.precio) > 0) ? 'Sin precio de venta' : `Margen ${dinero(margen)} € · ${servicio}`;
      return `<button type="button" class="esc-fila ${nivel}" data-esc-bebida="${b.id}">
        <span class="esc-fila-nombre">${_esc(b.nombre)}<small>${detalle}</small></span>
        <span class="esc-fila-num"><small>Coste</small>${c != null ? dinero(r2(c)) + ' €' : '—'}</span>
        <span class="esc-fila-num"><small>PVP</small>${Number(b.precio) > 0 ? dinero(b.precio) + ' €' : '—'}</span>
        <span class="esc-fila-pct ${nivel}">${_pct(pct)}</span>
      </button>`;
    }).join('')}</div>`;
  }

  function _imprimirEscandallos() {
    const objetivo = _objetivoCoste(), impuesto = _impuestoCarta();
    const porId = new Map(_todosIngredientes.map(i => [i.id, i]));
    if (!_todosPlatos.length) { alert('No hay platos en la carta.'); return; }
    const win = window.open('', '_blank', 'width=900,height=900');
    if (!win) { alert('El navegador bloqueó la ventana emergente.\nPermite ventanas emergentes para esta página.'); return; }
    const emp = _datosEmpresa();
    const fichas = _todosPlatos.map(p => {
      const e = escandallo(p.ingredientes, _todosIngredientes, Number(p.precio) || 0, { impuesto, objetivo });
      const lineas = (p.ingredientes || []).map(l => {
        const ing = porId.get(l.id); const c = costeLinea(ing, l.cantidad);
        return `<tr><td>${_esc(ing?.nombre || l.nombre)}</td>
          <td class="n">${l.cantidad > 0 ? Number(l.cantidad).toLocaleString('es-ES') + ' ' + (UNIDAD_RACION[ing?.unidad] || 'g') : '—'}</td>
          <td class="n">${_tienePrecio(ing) ? dinero(ing.precio_compra) + ' €/' + (ing.unidad || 'kg') : '—'}</td>
          <td class="n">${Number(ing?.merma) > 0 ? Number(ing.merma).toLocaleString('es-ES') + ' %' : ''}</td>
          <td class="n">${c != null ? dinero(r2(c)) + ' €' : '—'}</td></tr>`;
      }).join('');
      return `<section class="ficha"><h2>${_esc(p.nombre)}</h2>
        <table><thead><tr><th>Ingrediente</th><th class="n">Cantidad</th><th class="n">Precio compra</th><th class="n">Merma</th><th class="n">Coste</th></tr></thead>
        <tbody>${lineas || '<tr><td colspan="5">Sin ingredientes</td></tr>'}</tbody></table>
        <div class="tot"><span>Coste ración: <b>${dinero(e.coste)} €</b></span><span>PVP: <b>${Number(p.precio) > 0 ? dinero(p.precio) + ' €' : '—'}</b></span>
        <span>% coste: <b>${_pct(e.pct)}</b></span><span>Margen: <b>${e.margen != null ? dinero(e.margen) + ' €' : '—'}</b></span>
        ${e.recomendado ? `<span>PVP para ${objetivo} %: <b>${dinero(e.recomendado)} €</b></span>` : ''}</div>
        ${e.faltan.length ? `<div class="falta">Falta precio o cantidad: ${_esc(e.faltan.join(', '))}</div>` : ''}</section>`;
    }).join('');
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Escandallos — ${_esc(emp.razonSocial || 'Carta')}</title>
<style>
@page { size: A4; margin: 14mm; }
body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 10pt; }
h1 { font-size: 16pt; margin: 0 0 2mm; } .sub { color: #666; margin-bottom: 6mm; }
.ficha { page-break-inside: avoid; border-bottom: 1px solid #ccc; padding: 3mm 0 4mm; }
h2 { font-size: 12pt; margin: 0 0 2mm; }
table { width: 100%; border-collapse: collapse; } th, td { padding: 1.2mm 2mm; border-bottom: 1px solid #eee; text-align: left; }
th { font-size: 8.5pt; color: #555; text-transform: uppercase; } .n { text-align: right; white-space: nowrap; }
.tot { display: flex; flex-wrap: wrap; gap: 6mm; margin-top: 2mm; } .falta { color: #b45309; margin-top: 1mm; font-size: 9pt; }
</style></head><body>
<h1>Escandallos · ${_esc(emp.razonSocial || 'Carta')}</h1>
<div class="sub">${new Date().toLocaleDateString('es-ES')} · Objetivo de coste ${objetivo} % · Precios de carta con ${impuesto === 10 ? 'IVA' : 'IGIC'} ${impuesto} %</div>
${fichas}
<script>setTimeout(function(){ window.print(); }, 400);<\/script></body></html>`);
    win.document.close();
  }

  // Bloque de escandallo dentro del formulario del plato (cantidades + coste en vivo)
  function _renderEscandalloForm() {
    const cont = document.getElementById('plato-escandallo');
    if (!cont) return;
    const marcados = [...document.querySelectorAll('.plato-ing-check:checked')].map(cb => cb.value);
    if (!marcados.length) { cont.innerHTML = '<p class="texto-vacio" style="padding:8px 0">Marca los ingredientes del plato para calcular su coste.</p>'; return; }
    const porId = new Map(_todosIngredientes.map(i => [i.id, i]));
    cont.innerHTML = `<div class="esc-form-lineas">${marcados.map(id => {
      const ing = porId.get(id);
      if (!ing) return '';
      const c = costeLinea(ing, _cantidades[id]);
      return `<div class="esc-form-linea">
        <span class="esc-form-nombre">${_esc(ing.nombre)}<small>${_tienePrecio(ing) ? _precioIng(ing) : '<span class="err">sin precio de compra</span>'}</small></span>
        <label class="esc-form-cant"><input type="number" class="inp" inputmode="decimal" min="0" step="any" data-cant="${id}" value="${_cantidades[id] ?? ''}" placeholder="0" aria-label="Cantidad de ${_esc(ing.nombre)} por ración"><span>${UNIDAD_RACION[ing.unidad] || 'g'}</span></label>
        <span class="esc-form-coste" data-coste="${id}">${c != null ? dinero(r2(c)) + ' €' : '—'}</span>
      </div>`;
    }).join('')}</div><div id="plato-escandallo-total"></div>`;
    _renderEscandalloTotal();
  }

  function _renderEscandalloTotal() {
    const div = document.getElementById('plato-escandallo-total');
    if (!div) return;
    const lineas = [...document.querySelectorAll('.plato-ing-check:checked')].map(cb => ({ id: cb.value, nombre: cb.dataset.nombre, cantidad: _cantidades[cb.value] }));
    const pvp = parseFloat(document.getElementById('plato-precio')?.value) || 0;
    const objetivo = _objetivoCoste(), impuesto = _impuestoCarta();
    const e = escandallo(lineas, _todosIngredientes, pvp, { impuesto, objetivo });
    const nivel = _nivel(e.pct, objetivo);
    div.innerHTML = `<div class="esc-form-total">
      <div><small>Coste por ración</small><strong>${dinero(e.coste)} €</strong></div>
      <div><small>% sobre PVP sin ${impuesto === 10 ? 'IVA' : 'IGIC'}</small><strong class="${nivel}">${_pct(e.pct)}</strong></div>
      <div><small>Margen</small><strong>${e.margen != null ? dinero(e.margen) + ' €' : '—'}</strong></div>
      <div><small>PVP para un ${objetivo} %</small><strong>${e.recomendado ? dinero(e.recomendado) + ' €' : '—'}</strong></div>
    </div>${e.faltan.length ? `<p class="esc-aviso">Falta precio o cantidad: ${_esc(e.faltan.join(', '))}. El coste no está completo.</p>` : ''}`;
  }

  // ----------------------------------------------------------
  // INGREDIENTES
  // ----------------------------------------------------------

  async function _renderIngredientes() {
    const lista = document.getElementById('menu-lista-ingredientes');
    if (!lista) return;
    lista.innerHTML = '<p class="texto-vacio">Cargando…</p>';
    try {
      const items = await _ingredientesConCoste();
      _todosIngredientes = (items || []).slice().sort(_ordAlfa);
      _pintarIngredientes();
    } catch (e) { lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${_esc(e.message)}</p>`; }
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
      lista.innerHTML = `<p class="texto-vacio">Ningún ingrediente coincide con "${_esc(_busquedaIng)}".</p>`;
      return;
    }
    lista.innerHTML = filtrados.map(ing => {
      const badges = ing.alergenos?.length
        ? ing.alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return `<span class="badge-alergeno" title="${_esc(a)}">${i?.emoji ?? ''} ${_esc(a)}</span>`; }).join('')
        : '<span class="badge-sin-alergenos">Sin alérgenos</span>';
      const precio = _precioIng(ing);
      return `<div class="card-ingrediente" data-id="${ing.id}">
        <div class="card-ing-info">
          <span class="card-ing-nombre">${_esc(ing.nombre)}</span>
          <span class="card-ing-precio${precio ? '' : ' sin'}" data-solo="gestion">${precio ? _esc(precio) : 'Sin precio de compra'}</span>
          <div class="badges-alergenos">${badges}</div>
        </div>
        <div class="card-acciones">
          <button class="btn-mini btn-editar" onclick="ModuloMenu.editarIngrediente('${ing.id}')" title="Editar"><svg class="ic" aria-hidden="true"><use href="#i-pencil"/></svg> Editar</button>
          <button class="btn-mini btn-borrar" onclick="ModuloMenu.borrarIngrediente('${ing.id}')" title="Eliminar"><svg class="ic" aria-hidden="true"><use href="#i-trash-2"/></svg> Eliminar</button>
        </div>
      </div>`;
    }).join('');
  }

  async function editarIngrediente(id) {
    const sinCoste = await SB.obtenerIngrediente(id);
    if (!sinCoste) return;
    const ing = _conCoste(sinCoste);
    _rellenarProveedores(ing.proveedor_id);
    _idIngredienteEditando = id;
    document.getElementById('ing-nombre').value = ing.nombre;
    _ponerCosteIng(ing);
    NOMBRES_ALERGENOS.forEach(nombre => {
      const cb = document.getElementById('ing-al-' + nombre.replace(/\s+/g, '-'));
      if (cb) cb.checked = ing.alergenos?.includes(nombre) ?? false;
    });
    document.getElementById('ing-form-titulo').textContent = 'Editar ingrediente';
    _activarSubtab('ingredientes');
    _mostrarVistaIngs('form');
    document.getElementById('ing-nombre').focus();
  }

  async function borrarIngrediente(id) {
    const nombre = _todosIngredientes.find(i => i.id === id)?.nombre || 'este ingrediente';
    if (!confirm(`¿Eliminar el ingrediente "${nombre}"?\nSe eliminará también de los platos que lo usen.`)) return;
    try {
      await SB.eliminarIngrediente(id);
      SB.eliminarCoste(id);
      const [platos, ings] = await Promise.all([SB.obtenerPlatos(), SB.obtenerIngredientes()]);
      const restantes = (ings || []).filter(i => i.id !== id);
      for (const plato of platos) {
        if (plato.ingredientes?.some(i => i.id === id)) {
          const ingsFiltrados = plato.ingredientes.filter(i => i.id !== id);
          const alergenos     = _alergenosDe(ingsFiltrados.map(i => i.id), restantes);
          await SB.actualizarPlato({ ...plato, ingredientes: ingsFiltrados, alergenos });
        }
      }
    } catch (e) {
      alert('Error al eliminar el ingrediente: ' + e.message);
    }
    await _renderIngredientes();
    await _renderSelectorIngredientes();
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
      const coste = _leerCosteIng();
      if (coste.error) { alert(coste.error); return; }
      const proveedorId = document.getElementById('ing-proveedor')?.value || null;
      if (_idIngredienteEditando !== null) {
        const idEd = _idIngredienteEditando;
        await SB.actualizarIngrediente({ id: idEd, nombre, alergenos, proveedor_id: proveedorId });
        await _guardarCosteIng(idEd, coste);
        const [platos, ings] = await Promise.all([SB.obtenerPlatos(), SB.obtenerIngredientes()]);
        // Asegurar que el cálculo usa los alérgenos recién guardados (aunque la caché vaya por detrás)
        const ingsAct = (ings || []).map(i => i.id === idEd ? { ...i, nombre, alergenos } : i);
        for (const plato of platos) {
          if (plato.ingredientes?.some(i => i.id === idEd)) {
            const ingsActualizados = plato.ingredientes.map(i => i.id === idEd ? { ...i, nombre } : i);
            const nuevosAl         = _alergenosDe(ingsActualizados.map(i => i.id), ingsAct);
            await SB.actualizarPlato({ ...plato, ingredientes: ingsActualizados, alergenos: nuevosAl });
          }
        }
      } else {
        const nuevo = await SB.guardarIngrediente({ nombre, alergenos, proveedor_id: proveedorId });
        await _guardarCosteIng(nuevo?.id, coste);
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

  // Campos de coste del formulario de ingrediente (solo propietario / encargado)
  function _ponerCosteIng(ing) {
    const p = document.getElementById('ing-precio'), u = document.getElementById('ing-unidad'), m = document.getElementById('ing-merma');
    if (p) p.value = _tienePrecio(ing) ? ing.precio_compra : '';
    if (u) u.value = ['kg', 'l', 'ud'].includes(ing?.unidad) ? ing.unidad : 'kg';
    if (m) m.value = Number(ing?.merma) > 0 ? ing.merma : '';
  }
  function _leerCosteIng() {
    const txtP = (document.getElementById('ing-precio')?.value || '').trim().replace(',', '.');
    const txtM = (document.getElementById('ing-merma')?.value || '').trim().replace(',', '.');
    const precio = txtP === '' ? null : Number(txtP);
    const merma  = txtM === '' ? 0 : Number(txtM);
    if (precio != null && !(precio >= 0)) return { error: 'El precio de compra no es válido.' };
    if (!(merma >= 0 && merma < 95))      return { error: 'La merma debe ser un porcentaje entre 0 y 95.' };
    return { precio_compra: precio, unidad: document.getElementById('ing-unidad')?.value || 'kg', merma };
  }

  async function _guardarCosteIng(id, coste) {
    if (!id || !SB.puedeGestionar()) return;
    const antes = _costes.get(id);
    const vacio = coste.precio_compra == null && !coste.merma && coste.unidad === 'kg';
    if (!antes && vacio) return;   // nada que guardar
    const fila = await SB.guardarCoste('ingrediente', id, coste);
    if (fila) _costes.set(id, fila);
  }

  function _nuevoIngredienteForm() {
    _idIngredienteEditando = null;
    _ponerCosteIng(null);
    _rellenarProveedores('');
    document.getElementById('ing-nombre').value = '';
    NOMBRES_ALERGENOS.forEach(a => { const cb = document.getElementById('ing-al-' + a.replace(/\s+/g, '-')); if (cb) cb.checked = false; });
    document.getElementById('ing-form-titulo').textContent = 'Nuevo Ingrediente';
    _mostrarVistaIngs('form');
    document.getElementById('ing-nombre').focus();
  }

  function _resetFormIngrediente() {
    _idIngredienteEditando = null;
    _ponerCosteIng(null);
    document.getElementById('ing-nombre').value = '';
    NOMBRES_ALERGENOS.forEach(a => { const cb = document.getElementById('ing-al-' + a.replace(/\s+/g, '-')); if (cb) cb.checked = false; });
    document.getElementById('ing-form-titulo').textContent = 'Nuevo Ingrediente';
    _mostrarVistaIngs('lista');
  }

  // ----------------------------------------------------------
  // PLATOS
  // ----------------------------------------------------------

  // Une los alérgenos de los ingredientes indicados (en el orden oficial de la lista)
  function _alergenosDe(idsIngredientes, ingredientes) {
    const porId = new Map((ingredientes || []).map(i => [i.id, i]));
    const conjunto = new Set();
    for (const id of idsIngredientes) porId.get(id)?.alergenos?.forEach(a => conjunto.add(a));
    return NOMBRES_ALERGENOS.filter(a => conjunto.has(a)).concat([...conjunto].filter(a => !NOMBRES_ALERGENOS.includes(a)));
  }

  // Antes hacía una petición al servidor por cada ingrediente; ahora una sola.
  async function _calcularAlergenos(idsIngredientes) {
    return _alergenosDe(idsIngredientes, await SB.obtenerIngredientes());
  }

  async function _renderSelectorIngredientes() {
    const cont = document.getElementById('plato-selector-ingredientes');
    if (!cont) return;
    const todos = await _ingredientesConCoste();
    _todosIngredientes = (todos || []).slice().sort(_ordAlfa);
    if (!_todosIngredientes.length) {
      cont.innerHTML = '<p class="texto-vacio">Primero añade ingredientes en la pestaña "Ingredientes".</p>';
      return;
    }
    cont.innerHTML = _todosIngredientes.map(ing => `
      <label class="check-ingrediente" data-nombre-busqueda="${_esc(ing.nombre.toLowerCase())}">
        <input type="checkbox" class="plato-ing-check" value="${ing.id}" data-nombre="${_esc(ing.nombre)}">
        ${_esc(ing.nombre)}
        ${ing.alergenos?.length ? '<small>(' + ing.alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return i?.emoji ?? a; }).join(' ') + ')</small>' : ''}
      </label>`).join('');
    cont.querySelectorAll('.plato-ing-check').forEach(cb => cb.addEventListener('change', () => { _actualizarAlergenos_realtime(); _renderEscandalloForm(); }));
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
    // Vista previa al marcar casillas: con los ingredientes ya cargados en memoria (sin red)
    const alergenos = _alergenosDe(ids, _todosIngredientes);
    const div       = document.getElementById('plato-alergenos-calculados');
    if (!div) return;
    div.innerHTML = alergenos.length
      ? alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return `<span class="badge-alergeno">${i?.emoji ?? ''} ${_esc(a)}</span>`; }).join('')
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
    } catch (e) { lista.innerHTML = `<p class="texto-vacio error-texto">Error al cargar: ${_esc(e.message)}</p>`; }
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
      lista.innerHTML = `<p class="texto-vacio">Ningún plato coincide con "${_esc(_busquedaPlato)}".</p>`;
      _actualizarBotonPdfSeleccion();
      return;
    }
    lista.innerHTML = filtrados.map(plato => {
      const badgesAl = plato.alergenos?.length
        ? plato.alergenos.map(a => { const i = ALERGENOS_INFO.find(x => x.nombre === a); return `<span class="badge-alergeno" title="${_esc(a)}">${i?.emoji ?? ''} ${_esc(a)}</span>`; }).join('')
        : '<span class="badge-sin-alergenos">Sin alérgenos</span>';
      const ings = _esc((plato.ingredientes || []).slice(0, 4).map(i => i.nombre).join(', ')) + (plato.ingredientes?.length > 4 ? '…' : '');
      const sel  = _platoSeleccionados.has(plato.id) ? 'checked' : '';
      return `<div class="card-plato" data-id="${plato.id}">
        <div class="card-plato-cabecera">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1">
            <input type="checkbox" class="plato-select" value="${plato.id}" ${sel} style="width:18px;height:18px">
            <span class="card-plato-nombre">${_esc(plato.nombre)}</span>
          </label>
          <div class="card-plato-precio">${plato.precio > 0 ? dinero(plato.precio) + ' €' : ''}</div>
        </div>
        ${plato.descripcion ? `<div class="card-plato-desc">${_esc(plato.descripcion)}</div>` : ''}
        <div class="card-plato-ingredientes"><svg class="ic" aria-hidden="true"><use href="#i-carrot"/></svg> ${ings || 'Sin ingredientes asignados'}</div>
        <div class="badges-alergenos">${badgesAl}</div>
        <div class="card-acciones">
          <button class="btn-mini btn-editar" onclick="ModuloMenu.editarPlato('${plato.id}')"><svg class="ic" aria-hidden="true"><use href="#i-pencil"/></svg> Editar</button>
          <button class="btn-mini btn-pagar"  onclick="ModuloMenu.imprimirPlato('${plato.id}')"><svg class="ic" aria-hidden="true"><use href="#i-file-text"/></svg> PDF</button>
          <button class="btn-mini btn-borrar" onclick="ModuloMenu.borrarPlato('${plato.id}')"><svg class="ic" aria-hidden="true"><use href="#i-trash-2"/></svg> Eliminar</button>
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
    btn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-file-text"/></svg> PDF de seleccionados (${n})`;
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
        ${plato.precio > 0 ? `<div class="precio">${dinero(plato.precio)} €</div>` : ''}
      </header>
      ${plato.descripcion ? `<p class="desc">${_esc(plato.descripcion)}</p>` : ''}
      <h3>Ingredientes</h3>
      ${ings}
      <h3>Alérgenos (Reg. UE 1169/2011)</h3>
      <div class="alergenos">${al}</div>
    </article>`;
  }

  function _datosEmpresa() {
    try {
      if (typeof ModuloConfig !== 'undefined' && ModuloConfig.obtenerConfig) {
        return ModuloConfig.obtenerConfig() || {};
      }
      return {};
    } catch { return {}; }
  }

  function _generarPdfPlatos(platos, subtitulo) {
    if (!platos?.length) { alert('No hay platos para generar el PDF.'); return; }
    const win = window.open('', '_blank', 'width=900,height=900');
    if (!win) { alert('El navegador bloqueó la ventana emergente.\nPermite ventanas emergentes para esta página.'); return; }

    const emp    = _datosEmpresa();
    const nombre = emp.razonSocial || 'Cocina';
    const dir    = [emp.direccion, emp.cp, emp.ciudad, emp.provincia].filter(Boolean).join(', ');
    const contacto = [emp.telefono, emp.email, emp.web].filter(Boolean).join(' · ');
    const fecha  = new Date().toLocaleDateString('es-ES');

    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${_esc(nombre)} — ${_esc(subtitulo)}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color:#222; margin:0; padding:0; }
.cabecera { text-align:center; border-bottom:2px solid #c0392b; padding-bottom:12px; margin-bottom:18px; }
.cabecera .restaurante { font-size:24pt; font-weight:700; color:#c0392b; letter-spacing:1px; margin:0 0 4px 0; }
.cabecera .datos-emp { font-size:8.5pt; color:#666; margin:2px 0; }
.cabecera h1 { margin:10px 0 2px 0; color:#222; font-size:16pt; font-weight:600; }
.cabecera .fecha { font-size:9pt; color:#888; }
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
  <div class="restaurante">${_esc(nombre)}</div>
  ${dir      ? `<div class="datos-emp">${_esc(dir)}</div>` : ''}
  ${contacto ? `<div class="datos-emp">${_esc(contacto)}</div>` : ''}
  <h1>${_esc(subtitulo)}</h1>
  <div class="fecha">${fecha} · ${platos.length} plato${platos.length === 1 ? '' : 's'}</div>
</div>
${platos.map(_platoToHtml).join('')}
<div class="pie">${_esc(nombre)} · Reg. UE 1169/2011 · RD 126/2015</div>
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
    _ponerTraducciones(plato.traducciones || {});
    const idsPlato = plato.ingredientes?.map(i => i.id) || [];
    _cantidades = Object.fromEntries((plato.ingredientes || []).filter(i => Number(i.cantidad) > 0).map(i => [i.id, Number(i.cantidad)]));
    document.querySelectorAll('.plato-ing-check').forEach(cb => { cb.checked = idsPlato.includes(cb.value); });
    await _actualizarAlergenos_realtime();
    _renderEscandalloForm();
    document.getElementById('plato-form-titulo').textContent = 'Editar plato';
    _activarSubtab('platos');
    _mostrarVistaPlatos('form');
    document.getElementById('plato-nombre').focus();
  }

  async function borrarPlato(id) {
    const nombre = _todosPlatos.find(p => p.id === id)?.nombre || 'este plato';
    if (!confirm(`¿Eliminar el plato "${nombre}" de la carta?`)) return;
    try {
      await SB.eliminarPlato(id);
      _platoSeleccionados.delete(id);
    } catch (e) {
      alert('Error al eliminar el plato: ' + e.message);
    }
    await _renderPlatos();
  }

  function _nuevoPlatoForm() {
    _idPlatoEditando = null;
    _cantidades = {};
    _ponerTraducciones({});
    document.getElementById('plato-nombre').value  = '';
    document.getElementById('plato-desc').value    = '';
    document.getElementById('plato-precio').value  = '';
    document.querySelectorAll('.plato-ing-check').forEach(cb => cb.checked = false);
    const div = document.getElementById('plato-alergenos-calculados');
    if (div) div.innerHTML = '<span class="badge-sin-alergenos">Ninguno</span>';
    _renderEscandalloForm();
    document.getElementById('plato-form-titulo').textContent = 'Nuevo Plato';
    _mostrarVistaPlatos('form');
    document.getElementById('plato-nombre').focus();
  }

  function _resetFormPlato() {
    _idPlatoEditando = null;
    _cantidades = {};
    _ponerTraducciones({});
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
      // La cantidad por ración (escandallo) va junto a cada ingrediente
      const ingredientes = checks.map(cb => ({ id: cb.value, nombre: cb.dataset.nombre, ...(_cantidades[cb.value] > 0 ? { cantidad: _cantidades[cb.value] } : {}) }));
      const alergenos    = await _calcularAlergenos(ingredientes.map(i => i.id));
      const datos        = { nombre, descripcion: desc, precio, ingredientes, alergenos, traducciones: _leerTraducciones() };
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

    // Escandallo en el formulario del plato: cantidades y precio de venta
    document.getElementById('plato-escandallo')?.addEventListener('input', e => {
      const id = e.target.dataset?.cant;
      if (!id) return;
      const v = Number(String(e.target.value).replace(',', '.'));
      if (v > 0) _cantidades[id] = v; else delete _cantidades[id];
      const c = costeLinea(_todosIngredientes.find(i => i.id === id), _cantidades[id]);
      const celda = document.querySelector(`#plato-escandallo [data-coste="${id}"]`);
      if (celda) celda.textContent = c != null ? dinero(r2(c)) + ' €' : '—';
      _renderEscandalloTotal();
    });
    document.getElementById('plato-precio')?.addEventListener('input', _renderEscandalloTotal);

    // Pestaña de escandallos
    document.getElementById('esc-objetivo')?.addEventListener('change', e => {
      const v = Math.round(Number(e.target.value));
      if (!(v >= 5 && v <= 80)) { e.target.value = _objetivoCoste(); alert('El objetivo debe estar entre 5 y 80 %.'); return; }
      ModuloConfig.guardarAjuste('objetivoCoste', v);
      _renderEscandallos();
    });
    document.getElementById('esc-imprimir')?.addEventListener('click', _imprimirEscandallos);
    document.getElementById('menu-escandallos')?.addEventListener('click', e => {
      const fila = e.target.closest('[data-esc-plato]');
      if (fila) { editarPlato(fila.dataset.escPlato); return; }
      const beb = e.target.closest('[data-esc-bebida]');
      if (beb) { navegarA('bebidas'); ModuloBebidas.editarBebida(beb.dataset.escBebida); return; }
      if (e.target.closest('[data-esc="ingredientes"]')) _activarSubtab('ingredientes');
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
    costeLinea, escandallo, costeBebida, nivelCoste: _nivel, pctTexto: _pct, impuestoCarta: _impuestoCarta, objetivoCoste: _objetivoCoste,
    nuevoIngredienteForm: _nuevoIngredienteForm,
    cancelarPlatoForm: _resetFormPlato,
    cancelarIngredienteForm: _resetFormIngrediente
  };

})();
