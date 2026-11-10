// ============================================================
// modulos/equipo.js — Restaurantes y equipo
// · Elegir / crear restaurante al entrar (un dueño puede tener varios)
// · Unirse a un restaurante con un código de invitación
// · Gestionar el equipo: roles (propietario, encargado, cocina) e invitaciones
// Depende de: core/supabase.js, core/voz.js (esc, aviso)
// ============================================================

const ModuloEquipo = (() => {

  const ROLES = {
    propietario: { label: 'Propietario', desc: 'Todo, y gestiona el equipo y el restaurante' },
    encargado:   { label: 'Encargado',   desc: 'Todo excepto gestionar el equipo' },
    cocina:      { label: 'Cocina',      desc: 'Etiquetas, habituales y registros APPCC; consulta la carta' },
  };
  const APP_URL = 'https://alexri69.github.io/cocina-pwa/';

  let _lista = [];   // mis restaurantes [{ id, nombre, rol }]
  const $ = id => document.getElementById(id);

  // ----------------------------------------------------------
  // ARRANQUE: asegurar un restaurante activo
  // ----------------------------------------------------------

  /** Se llama tras iniciar sesión. Resuelve cuando hay un restaurante seleccionado. */
  async function iniciar() {
    try { _lista = await SB.misRestaurantes(); }
    catch (e) { console.warn('[Equipo] No se pudieron cargar los restaurantes:', e); _lista = []; }

    const activo = SB.restauranteActivo();
    const enLista = activo && _lista.find(r => r.id === activo.id);
    if (enLista) {
      SB.seleccionarRestaurante(enLista);           // refresca nombre y rol
    } else if (_lista.length) {
      SB.seleccionarRestaurante(_lista[0]);
    } else if (activo && !navigator.onLine) {
      // Sin conexión y sin lista en caché: seguimos con el último restaurante conocido
    } else {
      await _bienvenida();                           // primera vez: crear o unirse
    }
    await _invitacionDelEnlace();
    _migrarDatosLocales();
    _aplicarRol();
  }

  // Enlace de invitación (?unirse=CODIGO) abierto por alguien que ya tiene restaurante
  async function _invitacionDelEnlace() {
    const codigo = new URLSearchParams(location.search).get('unirse');
    if (!codigo || !navigator.onLine) return;
    _limpiarParamUrl();
    try {
      const rid = await SB.unirseConCodigo(codigo, '');
      _lista = await SB.misRestaurantes();
      const r = _lista.find(x => x.id === rid);
      if (r && r.id !== SB.restauranteId()) {
        SB.seleccionarRestaurante(r);
        aviso(`✔ Te has unido a "${r.nombre}".`, { tipo: 'ok', ms: 4000 });
      }
    } catch (e) {
      aviso('No se pudo usar la invitación: ' + (e.message || e), { tipo: 'error', ms: 7000 });
    }
  }

  function _aplicarRol() {
    const r = SB.rol() || 'cocina';
    document.body.dataset.rol = r;
    const btn = $('cabecera-cambiar-rest');
    if (btn) btn.style.display = _lista.length > 1 ? '' : 'none';
  }

  // Versiones anteriores guardaban la ficha de empresa, el logo y la impresora sin
  // restaurante: se copian al primer restaurante (y al servidor) para no perderlos.
  function _migrarDatosLocales() {
    const rid = SB.restauranteId();
    if (!rid) return;
    let copiado = false;
    for (const base of ['cocina_empresa_config', 'cocina_logo', 'cocina_impresora_config']) {
      try {
        const viejo = localStorage.getItem(base);
        if (viejo != null && localStorage.getItem(`${base}_${rid}`) == null) { localStorage.setItem(`${base}_${rid}`, viejo); copiado = true; }
        if (viejo != null) localStorage.removeItem(base);
      } catch {}
    }
    if (copiado && SB.puedeGestionar()) {
      // Subir la ficha al servidor para que la vea todo el equipo
      try {
        const empresa = JSON.parse(localStorage.getItem(`cocina_empresa_config_${rid}`) || '{}');
        SB.guardarConfigRemota({
          empresa, impresora: JSON.parse(localStorage.getItem(`cocina_impresora_config_${rid}`) || '{}'),
          logo: localStorage.getItem(`cocina_logo_${rid}`) || null,
        })?.catch(() => {});
        // Si el restaurante se creó con el nombre genérico, usar el de la ficha de empresa
        const act = SB.restauranteActivo();
        if (SB.esPropietario() && empresa.razonSocial && act?.nombre === 'Mi restaurante') {
          SB.renombrarRestaurante(empresa.razonSocial).catch(() => {});
        }
      } catch {}
    }
  }

  // ----------------------------------------------------------
  // BIENVENIDA (sin restaurante): crear uno o unirse con código
  // ----------------------------------------------------------

  function _bienvenida() {
    return new Promise(resolver => {
      const capa = document.createElement('div');
      capa.id = 'pantalla-restaurante';
      capa.className = 'pantalla-restaurante';
      capa.innerHTML = `
        <div class="login-caja equipo-bienvenida" role="dialog" aria-modal="true" aria-labelledby="bienv-titulo">
          <div class="login-titulo" id="bienv-titulo">🏪 Tu restaurante</div>
          <div class="login-subtitulo">Crea tu restaurante o únete al de tu equipo</div>
          <div class="equipo-opciones" role="tablist">
            <button type="button" class="sub-tab activo" data-op="crear" role="tab" aria-selected="true">＋ Crear restaurante</button>
            <button type="button" class="sub-tab" data-op="unirse" role="tab" aria-selected="false">🔑 Tengo un código</button>
          </div>
          <form id="bienv-crear" class="equipo-form">
            <label for="bienv-nombre">Nombre del restaurante</label>
            <input id="bienv-nombre" class="inp" maxlength="100" placeholder="Ej.: Restaurante El Puerto" required>
            <button class="btn btn-primario" type="submit">Crear y empezar</button>
            <small>Serás el propietario: podrás invitar a tu equipo y crear más restaurantes.</small>
          </form>
          <form id="bienv-unirse" class="equipo-form" hidden>
            <label for="bienv-codigo">Código de invitación</label>
            <input id="bienv-codigo" class="inp equipo-codigo-inp" maxlength="12" placeholder="Ej.: K7M2PQ9A" autocomplete="off" autocapitalize="characters" required>
            <label for="bienv-minombre">Tu nombre</label>
            <input id="bienv-minombre" class="inp" maxlength="60" placeholder="Ej.: Ana" autocomplete="name">
            <button class="btn btn-primario" type="submit">Unirme</button>
            <small>Pide el código al propietario o encargado del restaurante.</small>
          </form>
          <div class="login-error" id="bienv-error" role="alert"></div>
          <button type="button" class="equipo-salir" id="bienv-logout">Cerrar sesión</button>
        </div>`;
      document.body.appendChild(capa);
      const err = t => { $('bienv-error').textContent = t || ''; };
      const legacy = (() => { try { return JSON.parse(localStorage.getItem('cocina_empresa_config') || '{}').razonSocial || ''; } catch { return ''; } })();
      if (legacy) $('bienv-nombre').value = legacy;
      // Abrir con ?unirse=CODIGO (enlace de invitación)
      const codigoUrl = new URLSearchParams(location.search).get('unirse');

      const cambiar = op => {
        capa.querySelectorAll('[data-op]').forEach(b => { const a = b.dataset.op === op; b.classList.toggle('activo', a); b.setAttribute('aria-selected', String(a)); });
        $('bienv-crear').hidden = op !== 'crear';
        $('bienv-unirse').hidden = op !== 'unirse';
        err('');
        (op === 'crear' ? $('bienv-nombre') : $('bienv-codigo')).focus();
      };
      capa.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => cambiar(b.dataset.op)));
      if (codigoUrl) { cambiar('unirse'); $('bienv-codigo').value = codigoUrl.toUpperCase(); $('bienv-minombre').focus(); }
      else setTimeout(() => $('bienv-nombre').focus(), 50);

      const terminar = async (rid) => {
        _lista = await SB.misRestaurantes().catch(() => []);
        SB.seleccionarRestaurante(_lista.find(r => r.id === rid) || _lista[0]);
        capa.remove();
        _limpiarParamUrl();
        resolver();
      };
      const enviar = async (e, fn) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        err(''); btn.disabled = true;
        try { await terminar(await fn()); }
        catch (x) { err(x.message || String(x)); btn.disabled = false; }
      };
      $('bienv-crear').addEventListener('submit', e => enviar(e, () => {
        const n = $('bienv-nombre').value.trim();
        if (!n) throw new Error('Escribe el nombre del restaurante.');
        return SB.crearRestaurante(n);
      }));
      $('bienv-unirse').addEventListener('submit', e => enviar(e, () => {
        const c = $('bienv-codigo').value.trim();
        if (!c) throw new Error('Escribe el código de invitación.');
        return SB.unirseConCodigo(c, $('bienv-minombre').value.trim());
      }));
      $('bienv-logout').addEventListener('click', () => { SB.logout(); SB.limpiarDatosLocales(); location.reload(); });
    });
  }

  function _limpiarParamUrl() {
    const u = new URL(location.href);
    if (u.searchParams.has('unirse')) { u.searchParams.delete('unirse'); history.replaceState(null, '', u.toString()); }
  }

  // ----------------------------------------------------------
  // PANEL EN CONFIGURACIÓN
  // ----------------------------------------------------------

  async function renderPanel() {
    const cont = $('equipo-panel');
    if (!cont) return;
    const act = SB.restauranteActivo();
    if (!act) { cont.innerHTML = ''; return; }
    _aplicarRol(); // p. ej. mostrar el botón ⇄ de la cabecera al crear el segundo restaurante
    const prop = SB.esPropietario(), gest = SB.puedeGestionar();
    const otros = _lista.filter(r => r.id !== act.id);

    cont.innerHTML = `
      <div class="tarjeta">
        <div class="tarjeta-titulo">🏪 Restaurante y equipo</div>
        <div class="equipo-actual">
          <div>
            <div class="equipo-nombre" id="eq-nombre-txt">${esc(act.nombre)}</div>
            <span class="equipo-rol rol-${esc(act.rol)}">${esc(ROLES[act.rol]?.label || act.rol)}</span>
          </div>
          ${prop ? `<button class="btn-mini btn-editar" type="button" data-eq="renombrar">✏ Cambiar nombre</button>` : ''}
        </div>

        ${otros.length ? `<div class="equipo-bloque">
          <h3>Cambiar de restaurante</h3>
          <div class="equipo-lista-rest">
            ${otros.map(r => `<button type="button" class="equipo-rest" data-eq="cambiar" data-id="${esc(r.id)}">
              <span>${esc(r.nombre)}</span><small>${esc(ROLES[r.rol]?.label || r.rol)}</small></button>`).join('')}
          </div></div>` : ''}

        <div class="form-acciones">
          <button class="btn btn-secundario-sm" type="button" data-eq="crear">＋ Crear otro restaurante</button>
          <button class="btn btn-secundario-sm" type="button" data-eq="unirse">🔑 Unirme con un código</button>
        </div>

        ${gest ? `<div class="equipo-bloque">
          <h3>Equipo</h3>
          <div id="eq-miembros"><p class="texto-vacio">Cargando…</p></div>
        </div>
        <div class="equipo-bloque">
          <h3>Invitar a alguien</h3>
          <div class="equipo-invitar">
            <select id="eq-rol-inv" class="inp" aria-label="Rol de la persona invitada">
              <option value="cocina">Cocina — ${ROLES.cocina.desc}</option>
              ${prop ? `<option value="encargado">Encargado — ${ROLES.encargado.desc}</option>` : ''}
            </select>
            <button class="btn btn-primario-sm" type="button" data-eq="invitar">🔑 Generar código</button>
          </div>
          <div id="eq-codigo"></div>
          <div id="eq-invitaciones"></div>
        </div>` : ''}

        <div class="equipo-bloque">
          <h3>Mi nombre en el equipo</h3>
          <div class="equipo-invitar">
            <input id="eq-minombre" class="inp" maxlength="60" placeholder="Tu nombre" autocomplete="name">
            <button class="btn btn-secundario-sm" type="button" data-eq="minombre">✔ Guardar</button>
          </div>
        </div>

        <div class="equipo-peligro">
          <button class="btn-mini" type="button" data-eq="salir">🚪 Salir de este restaurante</button>
          ${prop ? `<button class="btn-mini btn-borrar" type="button" data-eq="eliminar">🗑 Eliminar restaurante</button>` : ''}
        </div>
      </div>`;

    if (gest) { _cargarMiembros(); _cargarInvitaciones(); }
  }

  async function _cargarMiembros() {
    const cont = $('eq-miembros');
    if (!cont) return;
    let miembros;
    try { miembros = await SB.obtenerMiembros(); }
    catch (e) { cont.innerHTML = `<p class="texto-vacio">${navigator.onLine ? 'No se pudo cargar el equipo.' : 'Sin conexión: el equipo se verá al volver la red.'}</p>`; return; }
    const yo = SB.userId(), prop = SB.esPropietario();
    const mi = miembros.find(m => m.user_id === yo);
    if (mi && $('eq-minombre')) $('eq-minombre').value = mi.nombre || '';
    cont.innerHTML = miembros.map(m => {
      const quien = m.nombre ? `${esc(m.nombre)} <small>${esc(m.email)}</small>` : esc(m.email || 'Sin email');
      const esYo = m.user_id === yo;
      const selector = prop && !esYo
        ? `<select class="inp eq-rol-sel" data-user="${esc(m.user_id)}" aria-label="Rol de ${esc(m.nombre || m.email)}">
            ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${m.rol === k ? 'selected' : ''}>${r.label}</option>`).join('')}
           </select>`
        : `<span class="equipo-rol rol-${esc(m.rol)}">${esc(ROLES[m.rol]?.label || m.rol)}</span>`;
      return `<div class="equipo-miembro">
        <span class="equipo-quien">${quien}${esYo ? ' <em>(tú)</em>' : ''}</span>
        <span class="card-acciones">${selector}
          ${prop && !esYo ? `<button class="btn-mini btn-borrar" type="button" data-eq="expulsar" data-user="${esc(m.user_id)}" aria-label="Quitar a ${esc(m.nombre || m.email)} del equipo">Quitar</button>` : ''}
        </span></div>`;
    }).join('');
  }

  async function _cargarInvitaciones() {
    const cont = $('eq-invitaciones');
    if (!cont) return;
    let inv = [];
    try { inv = (await SB.obtenerInvitaciones()).filter(i => i.usos < i.usos_max); } catch { return; }
    cont.innerHTML = inv.length ? `<div class="equipo-pendientes"><small>Códigos sin usar:</small>
      ${inv.map(i => `<span class="equipo-inv"><code>${esc(i.codigo)}</code> ${esc(ROLES[i.rol]?.label || i.rol)} · caduca ${new Date(i.expira_en).toLocaleDateString('es-ES')}
        <button class="btn-mini" type="button" data-eq="anular" data-codigo="${esc(i.codigo)}" aria-label="Anular código ${esc(i.codigo)}">✕</button></span>`).join('')}</div>` : '';
  }

  function _mostrarCodigo(codigo, rolInv) {
    const enlace = `${APP_URL}?unirse=${encodeURIComponent(codigo)}`;
    const act = SB.restauranteActivo();
    const texto = `Te invito al equipo de ${act?.nombre || 'nuestro restaurante'} en la app Cocina (${ROLES[rolInv]?.label || rolInv}).\n\n1. Abre ${enlace}\n2. Crea tu cuenta o inicia sesión\n3. Si te lo pide, escribe el código: ${codigo}\n\nEl código caduca en 7 días y solo sirve una vez.`;
    $('eq-codigo').innerHTML = `<div class="equipo-codigo">
      <div class="equipo-codigo-valor" aria-label="Código de invitación">${esc(codigo)}</div>
      <small>Válido 7 días · un solo uso · rol: ${esc(ROLES[rolInv]?.label || rolInv)}</small>
      <div class="form-acciones">
        <a class="btn btn-primario-sm" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">💬 Enviar por WhatsApp</a>
        <button class="btn btn-secundario-sm" type="button" data-eq="copiar">📋 Copiar invitación</button>
      </div></div>`;
    $('eq-codigo').dataset.texto = texto;
  }

  async function _accion(b) {
    const a = b.dataset.eq;
    try {
      if (a === 'cambiar') {
        const r = _lista.find(x => x.id === b.dataset.id);
        if (!r) return;
        if (SB.pendientes() && !confirm('Hay cambios sin sincronizar de este restaurante. Se enviarán cuando vuelva la conexión.\n\n¿Cambiar de restaurante igualmente?')) return;
        SB.seleccionarRestaurante(r);
        location.reload();
      }
      else if (a === 'crear') {
        const n = prompt('Nombre del nuevo restaurante:');
        if (!n?.trim()) return;
        const rid = await SB.crearRestaurante(n.trim());
        _lista = await SB.misRestaurantes();
        if (confirm(`✔ Restaurante "${n.trim()}" creado.\n\n¿Cambiar a él ahora?`)) { SB.seleccionarRestaurante(_lista.find(r => r.id === rid)); location.reload(); }
        else renderPanel();
      }
      else if (a === 'unirse') {
        const c = prompt('Código de invitación:');
        if (!c?.trim()) return;
        const rid = await SB.unirseConCodigo(c.trim(), '');
        _lista = await SB.misRestaurantes();
        const r = _lista.find(x => x.id === rid);
        if (r && confirm(`✔ Te has unido a "${r.nombre}".\n\n¿Cambiar a ese restaurante ahora?`)) { SB.seleccionarRestaurante(r); location.reload(); }
        else renderPanel();
      }
      else if (a === 'renombrar') {
        const act = SB.restauranteActivo();
        const n = prompt('Nuevo nombre del restaurante:', act?.nombre || '');
        if (!n?.trim() || n.trim() === act?.nombre) return;
        await SB.renombrarRestaurante(n.trim());
        _lista = _lista.map(r => r.id === act.id ? { ...r, nombre: n.trim() } : r);
        aviso('✔ Nombre cambiado.', { tipo: 'ok', ms: 2000 });
        renderPanel();
      }
      else if (a === 'invitar') {
        const rolInv = $('eq-rol-inv').value;
        b.disabled = true;
        const codigo = await SB.crearInvitacion(rolInv);
        b.disabled = false;
        _mostrarCodigo(codigo, rolInv);
        _cargarInvitaciones();
      }
      else if (a === 'copiar') {
        const t = $('eq-codigo')?.dataset.texto || '';
        try { await navigator.clipboard.writeText(t); aviso('📋 Invitación copiada.', { tipo: 'ok', ms: 2000 }); }
        catch { prompt('Copia la invitación:', t); }
      }
      else if (a === 'anular') {
        await SB.borrarInvitacion(b.dataset.codigo);
        _cargarInvitaciones();
      }
      else if (a === 'expulsar') {
        if (!confirm('¿Quitar a esta persona del equipo?\n\nDejará de ver los datos de este restaurante. Lo que haya registrado se conserva.')) return;
        await SB.expulsarMiembro(b.dataset.user);
        _cargarMiembros();
      }
      else if (a === 'minombre') {
        await SB.cambiarMiNombre($('eq-minombre').value.trim());
        aviso('✔ Nombre guardado.', { tipo: 'ok', ms: 2000 });
      }
      else if (a === 'salir') {
        const act = SB.restauranteActivo();
        if (!confirm(`¿Salir del equipo de "${act?.nombre}"?\n\nDejarás de ver sus datos. Para volver necesitarás un nuevo código.`)) return;
        await SB.salirRestaurante(act.id);
        SB.seleccionarRestaurante(null);
        location.reload();
      }
      else if (a === 'eliminar') {
        const act = SB.restauranteActivo();
        const escrito = prompt(`⚠ Esto ELIMINA "${act?.nombre}" y TODOS sus datos (etiquetas, APPCC, carta, facturas) para todo el equipo. No se puede deshacer.\n\nExporta antes una copia de seguridad.\n\nEscribe el nombre del restaurante para confirmar:`);
        if (escrito == null) return;
        if (escrito.trim() !== act.nombre) { alert('El nombre no coincide. No se ha eliminado nada.'); return; }
        await SB.eliminarRestaurante(act.id);
        SB.seleccionarRestaurante(null);
        location.reload();
      }
    } catch (e) {
      b.disabled = false;
      aviso(e.message || String(e), { tipo: 'error', ms: 6000 });
    }
  }

  function init() {
    const cont = $('equipo-panel');
    cont?.addEventListener('click', e => { const b = e.target.closest('[data-eq]'); if (b) _accion(b); });
    cont?.addEventListener('change', async e => {
      const sel = e.target.closest('.eq-rol-sel');
      if (!sel) return;
      try {
        await SB.cambiarRolMiembro(sel.dataset.user, sel.value);
        aviso('✔ Rol cambiado.', { tipo: 'ok', ms: 2000 });
      } catch (x) { aviso(x.message || String(x), { tipo: 'error', ms: 6000 }); }
      _cargarMiembros();
    });
    $('cabecera-cambiar-rest')?.addEventListener('click', () => {
      navegarA('config');
      $('equipo-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    renderPanel();
  }

  return { iniciar, init, renderPanel };

})();
