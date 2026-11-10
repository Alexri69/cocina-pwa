// ============================================================
// modulos/carta-publica.js — Carta de alérgenos para clientes (carta.html?c=TOKEN)
// Página pública: no requiere cuenta. Lee los datos con la función carta_publica.
// ============================================================

(() => {
  const ALERGENOS = [
    ['gluten','🌾','Gluten'], ['crustáceos','🦞','Crustáceos'], ['huevo','🥚','Huevo'], ['pescado','🐟','Pescado'],
    ['cacahuetes','🥜','Cacahuetes'], ['soja','🌱','Soja'], ['leche','🥛','Leche / lactosa'], ['frutos de cáscara','🌰','Frutos de cáscara'],
    ['apio','🌿','Apio'], ['mostaza','🌼','Mostaza'], ['granos de sésamo','🫘','Sésamo'], ['altramuces','🌸','Altramuces'],
    ['moluscos','🐚','Moluscos'], ['sulfitos','🍷','Sulfitos'],
  ];
  const INFO = Object.fromEntries(ALERGENOS.map(([k, e, n]) => [k, { e, n }]));
  const CATEGORIAS = { agua: '💧 Agua', refresco: '🥤 Refrescos', cerveza: '🍺 Cerveza', vino: '🍷 Vinos', licor: '🥃 Licores y combinados', cafe: '☕ Cafés e infusiones', zumo: '🍊 Zumos', otro: '🫗 Otras bebidas' };

  const cont = document.getElementById('carta');
  const token = new URLSearchParams(location.search).get('c') || '';
  const excluir = new Set();   // alérgenos que el cliente quiere evitar
  let busqueda = '';
  let datos = null;

  const precio = p => Number(p) > 0 ? Number(p).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }) : '';
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function item(x) {
    const als = (x.alergenos || []).filter(a => INFO[a]);
    return `<article class="item">
      <div class="item-cab"><span class="item-nombre">${esc(x.nombre)}</span><span class="item-precio">${precio(x.precio)}</span></div>
      ${x.descripcion ? `<p class="item-desc">${esc(x.descripcion)}</p>` : ''}
      <div class="als" aria-label="Alérgenos">${als.length
        ? als.map(a => `<span class="al">${INFO[a].e} ${INFO[a].n}</span>`).join('')
        : '<span class="sin">✔ Sin alérgenos declarados</span>'}</div>
    </article>`;
  }

  const pasa = x => !(x.alergenos || []).some(a => excluir.has(a)) && (!busqueda || norm(x.nombre + ' ' + (x.descripcion || '')).includes(busqueda));

  function pintarListas() {
    const platos  = datos.platos.filter(pasa);
    const bebidas = datos.bebidas.filter(pasa);
    const ocultos = (datos.platos.length + datos.bebidas.length) - (platos.length + bebidas.length);
    const est = document.getElementById('estado-filtro');
    est.innerHTML = (excluir.size || busqueda)
      ? `Mostrando ${platos.length + bebidas.length} de ${datos.platos.length + datos.bebidas.length}${ocultos ? ` · ${ocultos} ocultos` : ''} <button type="button" id="quitar-filtros">Quitar filtros</button>`
      : '';
    document.getElementById('quitar-filtros')?.addEventListener('click', () => {
      excluir.clear(); busqueda = ''; document.getElementById('buscar').value = '';
      document.querySelectorAll('.filtro').forEach(b => b.setAttribute('aria-pressed', 'false'));
      pintarListas();
    });

    // Bebidas agrupadas por categoría
    const grupos = {};
    for (const b of bebidas) (grupos[b.categoria || 'otro'] ??= []).push(b);
    document.getElementById('listas').innerHTML =
      (datos.platos.length ? `<h2>Platos</h2>${platos.length ? platos.map(item).join('') : '<p class="vacio">Ningún plato cumple los filtros.</p>'}` : '') +
      (datos.bebidas.length ? `<h2>Bebidas</h2>${bebidas.length
        ? Object.keys(CATEGORIAS).filter(c => grupos[c]).concat(Object.keys(grupos).filter(c => !CATEGORIAS[c]))
            .map(c => `<h3>${esc(CATEGORIAS[c] || c)}</h3>${grupos[c].map(item).join('')}`).join('')
        : '<p class="vacio">Ninguna bebida cumple los filtros.</p>'}` : '');
  }

  function pintar() {
    document.title = `${datos.nombre} — Carta y alérgenos`;
    const presentes = new Set([...datos.platos, ...datos.bebidas].flatMap(x => x.alergenos || []));
    cont.innerHTML = `
      <header>
        ${datos.logo && /^data:image\//.test(datos.logo) ? `<img src="${datos.logo}" alt="">` : ''}
        <h1>${esc(datos.nombre)}</h1>
        <p class="sub">Carta y alérgenos${datos.direccion ? ' · ' + esc(datos.direccion) : ''}</p>
      </header>
      <div class="aviso"><strong>¿Tienes alguna alergia o intolerancia?</strong> Avisa al personal antes de pedir: pueden existir trazas por contaminación cruzada en cocina.</div>
      <input id="buscar" class="buscar" type="search" placeholder="Buscar plato o bebida…" aria-label="Buscar plato o bebida">
      ${presentes.size ? `<div class="filtro-tit" id="filtro-tit">Ocultar lo que contenga:</div>
      <div class="filtros" role="group" aria-labelledby="filtro-tit">
        ${ALERGENOS.filter(([k]) => presentes.has(k)).map(([k, e, n]) => `<button type="button" class="filtro" aria-pressed="false" data-al="${esc(k)}">${e} ${n}</button>`).join('')}
      </div>` : ''}
      <div class="estado-filtro" id="estado-filtro" aria-live="polite"></div>
      <div id="listas"></div>
      <footer>
        <p>Información sobre alérgenos conforme al Reglamento (UE) 1169/2011.</p>
        ${datos.telefono ? `<p>Teléfono: ${esc(datos.telefono)}</p>` : ''}
      </footer>`;
    document.querySelectorAll('.filtro').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.al;
      excluir.has(k) ? excluir.delete(k) : excluir.add(k);
      b.setAttribute('aria-pressed', String(excluir.has(k)));
      pintarListas();
    }));
    document.getElementById('buscar').addEventListener('input', e => { busqueda = norm(e.target.value.trim()); pintarListas(); });
    pintarListas();
  }

  (async () => {
    if (!/^[a-f0-9]{24,64}$/i.test(token)) {
      cont.innerHTML = '<p class="error">Este enlace de carta no es válido. Escanea de nuevo el código QR o pide la carta al personal.</p>';
      return;
    }
    try {
      datos = await SB.cartaPublica(token);
      if (!datos) { cont.innerHTML = '<p class="error">Esta carta ya no está disponible. Pide la carta al personal.</p>'; return; }
      datos.platos = datos.platos || []; datos.bebidas = datos.bebidas || [];
      if (!datos.platos.length && !datos.bebidas.length) { cont.innerHTML = `<header><h1>${esc(datos.nombre)}</h1></header><p class="vacio">La carta todavía está vacía.</p>`; return; }
      pintar();
    } catch (e) {
      cont.innerHTML = '<p class="error">No se ha podido cargar la carta. Comprueba la conexión e inténtalo de nuevo.</p>';
    }
  })();
})();
