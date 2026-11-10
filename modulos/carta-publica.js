// ============================================================
// modulos/carta-publica.js — Carta de alérgenos para clientes (carta.html?c=TOKEN)
// Página pública: no requiere cuenta. Lee los datos con la función carta_publica.
// Idiomas: español, inglés y alemán (?l=en|de, o el idioma del móvil). Los nombres y
// descripciones salen de plato.traducciones; si faltan, se muestran en español.
// ============================================================

(() => {
  const IDIOMAS = { es: 'Español', en: 'English', de: 'Deutsch' };
  const BANDERAS = { es: '🇪🇸', en: '🇬🇧', de: '🇩🇪' };

  // Clave interna (como se guarda en la BD) → emoji y nombre en cada idioma
  const ALERGENOS = [
    ['gluten', '🌾', 'Gluten', 'Gluten', 'Gluten'],
    ['crustáceos', '🦞', 'Crustáceos', 'Crustaceans', 'Krebstiere'],
    ['huevo', '🥚', 'Huevo', 'Egg', 'Ei'],
    ['pescado', '🐟', 'Pescado', 'Fish', 'Fisch'],
    ['cacahuetes', '🥜', 'Cacahuetes', 'Peanuts', 'Erdnüsse'],
    ['soja', '🌱', 'Soja', 'Soy', 'Soja'],
    ['leche', '🥛', 'Leche / lactosa', 'Milk / lactose', 'Milch / Laktose'],
    ['frutos de cáscara', '🌰', 'Frutos de cáscara', 'Tree nuts', 'Schalenfrüchte'],
    ['apio', '🌿', 'Apio', 'Celery', 'Sellerie'],
    ['mostaza', '🌼', 'Mostaza', 'Mustard', 'Senf'],
    ['granos de sésamo', '🫘', 'Sésamo', 'Sesame', 'Sesam'],
    ['altramuces', '🌸', 'Altramuces', 'Lupin', 'Lupinen'],
    ['moluscos', '🐚', 'Moluscos', 'Molluscs', 'Weichtiere'],
    ['sulfitos', '🍷', 'Sulfitos', 'Sulphites', 'Sulfite'],
  ];
  const COL = { es: 2, en: 3, de: 4 };
  const INFO = Object.fromEntries(ALERGENOS.map(a => [a[0], a]));

  const CATEGORIAS = {
    agua:     ['💧', 'Agua', 'Water', 'Wasser'],
    refresco: ['🥤', 'Refrescos', 'Soft drinks', 'Erfrischungsgetränke'],
    cerveza:  ['🍺', 'Cerveza', 'Beer', 'Bier'],
    vino:     ['🍷', 'Vinos', 'Wines', 'Weine'],
    licor:    ['🥃', 'Licores y combinados', 'Spirits & mixed drinks', 'Spirituosen & Longdrinks'],
    cafe:     ['☕', 'Cafés e infusiones', 'Coffee & tea', 'Kaffee & Tee'],
    zumo:     ['🍊', 'Zumos', 'Juices', 'Säfte'],
    otro:     ['🫗', 'Otras bebidas', 'Other drinks', 'Weitere Getränke'],
  };
  const CAT_COL = { es: 1, en: 2, de: 3 };

  const T = {
    es: { sub: 'Carta y alérgenos', avisoT: '¿Tienes alguna alergia o intolerancia?', aviso: 'Avisa al personal antes de pedir: pueden existir trazas por contaminación cruzada en cocina.',
          buscar: 'Buscar plato o bebida…', ocultar: 'Ocultar lo que contenga:', platos: 'Platos', bebidas: 'Bebidas', sinAl: 'Sin alérgenos declarados',
          mostrando: (n, t) => `Mostrando ${n} de ${t}`, ocultos: n => `${n} ocultos`, quitar: 'Quitar filtros', ningunPlato: 'Ningún plato cumple los filtros.',
          ningunaBebida: 'Ninguna bebida cumple los filtros.', pie: 'Información sobre alérgenos conforme al Reglamento (UE) 1169/2011.', tel: 'Teléfono',
          enEsp: '', vacia: 'La carta todavía está vacía.', idioma: 'Idioma', alergenos: 'Alérgenos' },
    en: { sub: 'Menu & allergens', avisoT: 'Do you have an allergy or intolerance?', aviso: 'Please tell our staff before ordering: traces may be present due to cross-contamination in the kitchen.',
          buscar: 'Search dish or drink…', ocultar: 'Hide anything containing:', platos: 'Dishes', bebidas: 'Drinks', sinAl: 'No declared allergens',
          mostrando: (n, t) => `Showing ${n} of ${t}`, ocultos: n => `${n} hidden`, quitar: 'Clear filters', ningunPlato: 'No dish matches the filters.',
          ningunaBebida: 'No drink matches the filters.', pie: 'Allergen information in accordance with Regulation (EU) No 1169/2011.', tel: 'Phone',
          enEsp: 'Some names are only available in Spanish.', vacia: 'The menu is still empty.', idioma: 'Language', alergenos: 'Allergens' },
    de: { sub: 'Speisekarte & Allergene', avisoT: 'Haben Sie eine Allergie oder Unverträglichkeit?', aviso: 'Bitte informieren Sie unser Personal vor der Bestellung: Spuren durch Kreuzkontamination in der Küche sind möglich.',
          buscar: 'Gericht oder Getränk suchen…', ocultar: 'Ausblenden, was enthält:', platos: 'Gerichte', bebidas: 'Getränke', sinAl: 'Keine deklarierten Allergene',
          mostrando: (n, t) => `${n} von ${t} angezeigt`, ocultos: n => `${n} ausgeblendet`, quitar: 'Filter entfernen', ningunPlato: 'Kein Gericht entspricht den Filtern.',
          ningunaBebida: 'Kein Getränk entspricht den Filtern.', pie: 'Allergeninformationen gemäß Verordnung (EU) Nr. 1169/2011.', tel: 'Telefon',
          enEsp: 'Einige Namen sind nur auf Spanisch verfügbar.', vacia: 'Die Speisekarte ist noch leer.', idioma: 'Sprache', alergenos: 'Allergene' },
  };

  const cont = document.getElementById('carta');
  const params = new URLSearchParams(location.search);
  const token = params.get('c') || '';
  const excluir = new Set();   // alérgenos que el cliente quiere evitar
  let busqueda = '';
  let datos = null;

  function _idiomaInicial() {
    const guardado = (() => { try { return localStorage.getItem('carta_idioma'); } catch { return null; } })();
    const pedido = params.get('l') || guardado || (navigator.language || 'es').slice(0, 2).toLowerCase();
    return IDIOMAS[pedido] ? pedido : 'es';
  }
  let idioma = _idiomaInicial();
  const t = () => T[idioma];
  const LOCALE = { es: 'es-ES', en: 'en-GB', de: 'de-DE' };

  const precio = p => Number(p) > 0 ? Number(p).toLocaleString(LOCALE[idioma], { style: 'currency', currency: 'EUR' }) : '';
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nombreAl = k => INFO[k]?.[COL[idioma]] || k;
  // Texto del plato en el idioma elegido (si no hay traducción, en español)
  const txt = (x, campo) => (idioma !== 'es' && x.traducciones?.[idioma]?.[campo]) || x[campo] || '';
  const traducido = x => idioma === 'es' || !!x.traducciones?.[idioma]?.nombre;

  function item(x) {
    const als = (x.alergenos || []).filter(a => INFO[a]);
    const desc = txt(x, 'descripcion');
    return `<article class="item">
      <div class="item-cab"><span class="item-nombre"${traducido(x) ? '' : ' lang="es"'}>${esc(txt(x, 'nombre'))}</span><span class="item-precio">${precio(x.precio)}</span></div>
      ${desc ? `<p class="item-desc"${idioma !== 'es' && !x.traducciones?.[idioma]?.descripcion ? ' lang="es"' : ''}>${esc(desc)}</p>` : ''}
      <div class="als" aria-label="${t().alergenos}">${als.length
        ? als.map(a => `<span class="al">${INFO[a][1]} ${esc(nombreAl(a))}</span>`).join('')
        : `<span class="sin">✔ ${t().sinAl}</span>`}</div>
    </article>`;
  }

  // La búsqueda mira el nombre en el idioma elegido y también en español
  const pasa = x => !(x.alergenos || []).some(a => excluir.has(a)) &&
    (!busqueda || norm([x.nombre, x.descripcion, txt(x, 'nombre'), txt(x, 'descripcion')].join(' ')).includes(busqueda));

  function pintarListas() {
    const platos  = datos.platos.filter(pasa);
    const bebidas = datos.bebidas.filter(pasa);
    const total   = datos.platos.length + datos.bebidas.length;
    const ocultos = total - (platos.length + bebidas.length);
    const est = document.getElementById('estado-filtro');
    est.innerHTML = (excluir.size || busqueda)
      ? `${t().mostrando(platos.length + bebidas.length, total)}${ocultos ? ` · ${t().ocultos(ocultos)}` : ''} <button type="button" id="quitar-filtros">${t().quitar}</button>`
      : '';
    document.getElementById('quitar-filtros')?.addEventListener('click', () => {
      excluir.clear(); busqueda = ''; document.getElementById('buscar').value = '';
      document.querySelectorAll('.filtro').forEach(b => b.setAttribute('aria-pressed', 'false'));
      pintarListas();
    });

    const porNombre = (a, b) => txt(a, 'nombre').localeCompare(txt(b, 'nombre'), LOCALE[idioma], { sensitivity: 'base' });
    const grupos = {};
    for (const b of bebidas) (grupos[b.categoria || 'otro'] ??= []).push(b);
    const catNombre = c => CATEGORIAS[c] ? `${CATEGORIAS[c][0]} ${CATEGORIAS[c][CAT_COL[idioma]]}` : c;
    document.getElementById('listas').innerHTML =
      (datos.platos.length ? `<h2>${t().platos}</h2>${platos.length ? platos.slice().sort(porNombre).map(item).join('') : `<p class="vacio">${t().ningunPlato}</p>`}` : '') +
      (datos.bebidas.length ? `<h2>${t().bebidas}</h2>${bebidas.length
        ? Object.keys(CATEGORIAS).filter(c => grupos[c]).concat(Object.keys(grupos).filter(c => !CATEGORIAS[c]))
            .map(c => `<h3>${esc(catNombre(c))}</h3>${grupos[c].slice().sort(porNombre).map(item).join('')}`).join('')
        : `<p class="vacio">${t().ningunaBebida}</p>`}` : '');
  }

  function pintar() {
    document.documentElement.lang = idioma;
    document.title = `${datos.nombre} — ${t().sub}`;
    const presentes = new Set([...datos.platos, ...datos.bebidas].flatMap(x => x.alergenos || []));
    const faltanTraducciones = idioma !== 'es' && [...datos.platos, ...datos.bebidas].some(x => !traducido(x));
    cont.innerHTML = `
      <nav class="idiomas" aria-label="${t().idioma}">
        ${Object.keys(IDIOMAS).map(l => `<button type="button" class="idioma" data-l="${l}" lang="${l}" aria-pressed="${l === idioma}">${BANDERAS[l]} ${IDIOMAS[l]}</button>`).join('')}
      </nav>
      <header>
        ${datos.logo && /^data:image\//.test(datos.logo) ? `<img src="${datos.logo}" alt="">` : ''}
        <h1>${esc(datos.nombre)}</h1>
        <p class="sub">${t().sub}${datos.direccion ? ' · ' + esc(datos.direccion) : ''}</p>
      </header>
      <div class="aviso"><strong>${t().avisoT}</strong> ${t().aviso}</div>
      ${faltanTraducciones ? `<p class="nota-idioma">${t().enEsp}</p>` : ''}
      <input id="buscar" class="buscar" type="search" placeholder="${t().buscar}" aria-label="${t().buscar}">
      ${presentes.size ? `<div class="filtro-tit" id="filtro-tit">${t().ocultar}</div>
      <div class="filtros" role="group" aria-labelledby="filtro-tit">
        ${ALERGENOS.filter(([k]) => presentes.has(k)).map(a => `<button type="button" class="filtro" aria-pressed="${excluir.has(a[0])}" data-al="${esc(a[0])}">${a[1]} ${esc(a[COL[idioma]])}</button>`).join('')}
      </div>` : ''}
      <div class="estado-filtro" id="estado-filtro" aria-live="polite"></div>
      <div id="listas"></div>
      <footer>
        <p>${t().pie}</p>
        ${datos.telefono ? `<p>${t().tel}: ${esc(datos.telefono)}</p>` : ''}
      </footer>`;
    document.querySelectorAll('.filtro').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.al;
      excluir.has(k) ? excluir.delete(k) : excluir.add(k);
      b.setAttribute('aria-pressed', String(excluir.has(k)));
      pintarListas();
    }));
    document.querySelectorAll('.idioma').forEach(b => b.addEventListener('click', () => {
      idioma = b.dataset.l;
      try { localStorage.setItem('carta_idioma', idioma); } catch {}
      const q = document.getElementById('buscar')?.value || '';
      pintar();
      const inp = document.getElementById('buscar');
      if (inp) inp.value = q;
      document.querySelector(`.idioma[data-l="${idioma}"]`)?.focus();
    }));
    document.getElementById('buscar').addEventListener('input', e => { busqueda = norm(e.target.value.trim()); pintarListas(); });
    pintarListas();
  }

  (async () => {
    if (!/^[a-f0-9]{24,64}$/i.test(token)) {
      cont.innerHTML = '<p class="error">Este enlace de carta no es válido. Escanea de nuevo el código QR o pide la carta al personal.<br><span lang="en">This menu link is not valid. Please scan the QR code again.</span></p>';
      return;
    }
    try {
      datos = await SB.cartaPublica(token);
      if (!datos) { cont.innerHTML = '<p class="error">Esta carta ya no está disponible. Pide la carta al personal.<br><span lang="en">This menu is no longer available.</span></p>'; return; }
      datos.platos = datos.platos || []; datos.bebidas = datos.bebidas || [];
      if (!datos.platos.length && !datos.bebidas.length) { cont.innerHTML = `<header><h1>${esc(datos.nombre)}</h1></header><p class="vacio">${t().vacia}</p>`; return; }
      pintar();
    } catch (e) {
      cont.innerHTML = '<p class="error">No se ha podido cargar la carta. Comprueba la conexión e inténtalo de nuevo.<br><span lang="en">The menu could not be loaded. Please check your connection.</span></p>';
    }
  })();
})();
