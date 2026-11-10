// ============================================================
// modulos/config.js — Datos de la empresa, apariencia e impresora
// Persiste en localStorage (disponible offline sin tabla Supabase).
// ============================================================

const ModuloConfig = (() => {

  // Claves por restaurante: cada restaurante tiene su propia ficha, logo e impresora
  const _rid = () => (typeof SB !== 'undefined' && SB.restauranteId && SB.restauranteId()) || '';
  const _k   = base => _rid() ? `${base}_${_rid()}` : base;
  const CLAVE_EMP  = () => _k('cocina_empresa_config');
  const CLAVE_IMP  = () => _k('cocina_impresora_config');
  const CLAVE_LOGO = () => _k('cocina_logo');

  function obtenerConfig() {
    try { return JSON.parse(localStorage.getItem(CLAVE_EMP())) || {}; }
    catch { return {}; }
  }

  function obtenerConfigImpresora() {
    try { return JSON.parse(localStorage.getItem(CLAVE_IMP())) || {}; }
    catch { return {}; }
  }

  // --- Cabecera dinámica (nombre + logo) ---

  function _actualizarCabecera() {
    const cfg   = obtenerConfig();
    const titulo = document.getElementById('cabecera-titulo');
    if (titulo) titulo.textContent = cfg.razonSocial || SB.restauranteActivo()?.nombre || 'Cocina';

    const logo = localStorage.getItem(CLAVE_LOGO());
    const img  = document.getElementById('cabecera-logo-img');
    const emo  = document.getElementById('cabecera-logo-emoji');
    if (img && emo) {
      if (logo) { img.src = logo; img.style.display = ''; emo.style.display = 'none'; }
      else       { img.style.display = 'none'; emo.style.display = ''; }
    }
  }

  function _cargarLogoEnUI() {
    const logo    = localStorage.getItem(CLAVE_LOGO());
    const preview = document.getElementById('cfg-logo-preview');
    const quitar  = document.getElementById('cfg-logo-quitar');
    if (preview) { preview.src = logo || ''; preview.style.display = logo ? '' : 'none'; }
    if (quitar)  quitar.style.display = logo ? '' : 'none';
  }

  // Reduce el logo a un máximo de 400 px (PNG) antes de guardarlo: una foto de móvil
  // de varios MB llenaba el almacenamiento del navegador (≈5 MB) y rompía la app.
  function _reducirImagen(archivo, maxLado = 400) {
    return new Promise((ok, err) => {
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, maxLado / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width  = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); err(new Error('No se ha podido leer la imagen.')); };
      img.src = url;
    });
  }

  async function _subirLogo(archivo) {
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) { alert('Elige un archivo de imagen (PNG o JPG).'); return; }
    try {
      const dataUrl = await _reducirImagen(archivo);
      localStorage.setItem(CLAVE_LOGO(), dataUrl);
      _cargarLogoEnUI();
      _actualizarCabecera();
      _pushRemota();
      _mostrarMsg('cfg-msg', '✔ Logo guardado');
    } catch (e) {
      alert('No se ha podido guardar el logo: ' + (e.message || e));
    } finally {
      const inp = document.getElementById('cfg-logo-input');
      if (inp) inp.value = '';
    }
  }

  function _quitarLogo() {
    localStorage.removeItem(CLAVE_LOGO());
    _cargarLogoEnUI();
    _actualizarCabecera();
    _pushRemota();
  }

  // --- Empresa ---

  function _cargarEnFormulario() {
    const cfg = obtenerConfig();
    [
      ['cfg-razon',    cfg.razonSocial],
      ['cfg-nif',      cfg.nif],
      ['cfg-dir',      cfg.direccion],
      ['cfg-cp',       cfg.cp],
      ['cfg-ciudad',   cfg.ciudad],
      ['cfg-provincia',cfg.provincia],
      ['cfg-pais',     cfg.pais ?? 'España'],
      ['cfg-tel',      cfg.telefono],
      ['cfg-email',    cfg.email],
      ['cfg-web',      cfg.web],
      ['cfg-iban',     cfg.iban],
    ].forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && val != null) el.value = val;
    });
    const igic = document.getElementById('cfg-igic');
    if (igic) igic.value = cfg.igicDefault ?? 7;
    const reg = document.getElementById('cfg-regimen');
    if (reg && cfg.regimen) reg.value = cfg.regimen;
  }

  function _guardarDesdeFormulario() {
    const val  = id => document.getElementById(id)?.value.trim() ?? '';
    const datos = {
      razonSocial: val('cfg-razon'),
      nif:         val('cfg-nif'),
      direccion:   val('cfg-dir'),
      cp:          val('cfg-cp'),
      ciudad:      val('cfg-ciudad'),
      provincia:   val('cfg-provincia'),
      pais:        val('cfg-pais') || 'España',
      telefono:    val('cfg-tel'),
      email:       val('cfg-email'),
      web:         val('cfg-web'),
      iban:        val('cfg-iban'),
      regimen:     document.getElementById('cfg-regimen')?.value || 'igic',
      igicDefault: parseFloat(document.getElementById('cfg-igic')?.value) || 7,
    };
    const probl = [];
    if (!validarNif(datos.nif))     probl.push('NIF/CIF');
    if (!validarEmail(datos.email)) probl.push('email');
    if (!validarIban(datos.iban))   probl.push('IBAN');
    if (probl.length && !confirm(`Estos datos no parecen válidos: ${probl.join(', ')}.\n\n¿Guardar de todas formas?`)) return;

    // Se conservan otros ajustes guardados en la misma ficha (p. ej. el modo APPCC)
    localStorage.setItem(CLAVE_EMP(), JSON.stringify({ ...obtenerConfig(), ...datos }));
    _pushRemota();
    _mostrarMsg('cfg-msg', '✔ Guardado');
    _actualizarCabecera();

    const dashNombre = document.getElementById('dash-nombre-restaurante');
    if (dashNombre && datos.razonSocial) dashNombre.textContent = datos.razonSocial;
  }

  // --- Impresora ---

  function _cargarImpresora() {
    const cfg = obtenerConfigImpresora();
    const sel = id => document.getElementById(id);
    if (cfg.modelo   && sel('imp-modelo'))   sel('imp-modelo').value   = cfg.modelo;
    if (cfg.tamano   && sel('imp-tamano'))   sel('imp-tamano').value   = cfg.tamano;
    if (cfg.conexion && sel('imp-conexion')) sel('imp-conexion').value = cfg.conexion;
    if (cfg.ip       && sel('imp-ip'))       sel('imp-ip').value       = cfg.ip;
    if (cfg.puerto   && sel('imp-puerto'))   sel('imp-puerto').value   = cfg.puerto;
    _toggleConexion(cfg.conexion || 'sistema');
  }

  function _guardarImpresora() {
    const val = id => document.getElementById(id)?.value.trim() ?? '';
    const datos = {
      modelo:   val('imp-modelo'),
      tamano:   val('imp-tamano'),
      conexion: document.getElementById('imp-conexion')?.value || 'sistema',
      ip:       val('imp-ip'),
      puerto:   val('imp-puerto') || '9100',
    };
    localStorage.setItem(CLAVE_IMP(), JSON.stringify(datos));
    _pushRemota();
    _mostrarMsg('imp-msg', '✔ Guardado');
  }

  function _toggleConexion(val) {
    const show = val === 'wifi';
    const g1   = document.getElementById('imp-grupo-ip');
    const g2   = document.getElementById('imp-grupo-puerto');
    if (g1) g1.style.display = show ? '' : 'none';
    if (g2) g2.style.display = show ? '' : 'none';
  }

  function _testImpresora() {
    const cfg = obtenerConfigImpresora();
    if (cfg.conexion === 'wifi' && cfg.ip) {
      alert(`Conexión WiFi configurada:\nIP: ${cfg.ip}:${cfg.puerto || 9100}\n\nLa impresión real por IP requiere servidor local o driver de la impresora.`);
    } else if (cfg.conexion === 'bluetooth') {
      alert('Bluetooth: la conexión directa requiere HTTPS y Chrome/Edge con soporte Web Bluetooth.\n\nLa impresión de etiquetas se iniciará desde la pantalla de Etiquetas.');
    } else {
      window.print();
    }
  }

  // --- Backup ---

  async function _exportar() {
    const btn = document.getElementById('bkp-btn-exportar');
    if (btn) btn.disabled = true;
    try {
      const datos  = await SB.exportarTodo();
      const backup = {
        version: 1,
        fecha:   new Date().toISOString(),
        app:     'cocina-pwa',
        config: {
          empresa:   JSON.parse(localStorage.getItem(CLAVE_EMP())  || '{}'),
          impresora: JSON.parse(localStorage.getItem(CLAVE_IMP())  || '{}'),
        },
        datos,
      };
      _descargarJson(backup, `cocina-backup-${new Date().toISOString().slice(0, 10)}.json`);
      _mostrarMsg('bkp-msg', '✔ Copia descargada');
    } catch (e) {
      _mostrarMsg('bkp-msg', '✖ Error: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // «14 ingredientes, 2 platos…» a partir del número de registros de cada tipo
  const _NOMBRES_DATOS = [
    ['productos', 'etiqueta', 'etiquetas'], ['plantillas', 'producto habitual', 'productos habituales'],
    ['ingredientes', 'ingrediente', 'ingredientes'], ['platos', 'plato', 'platos'], ['bebidas', 'bebida', 'bebidas'],
    ['facturas', 'factura/presupuesto', 'facturas/presupuestos'], ['appcc_elementos', 'equipo o tarea APPCC', 'equipos y tareas APPCC'],
    ['appcc_registros', 'registro APPCC', 'registros APPCC'],
  ];
  function _resumenDatos(cuenta) {
    const partes = _NOMBRES_DATOS.filter(([k]) => cuenta[k] > 0).map(([k, uno, varios]) => `${cuenta[k]} ${cuenta[k] === 1 ? uno : varios}`);
    return partes.length ? partes.join(', ') : 'sin datos';
  }
  const _contar = datos => Object.fromEntries(_NOMBRES_DATOS.map(([k]) => [k, datos?.[k]?.length ?? 0]));
  const _fechaHora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); };

  /** Restaura una copia (archivo descargado o copia del servidor) en el restaurante activo. */
  async function _restaurarBackup(backup) {
    if (backup?.app !== 'cocina-pwa' || !backup.datos) {
      alert('El archivo no es una copia de seguridad válida de esta aplicación.');
      return false;
    }
    if (!confirm(`¿Restaurar la copia del ${_fechaHora(backup.fecha) || 'archivo'}?\n\nContiene: ${_resumenDatos(_contar(backup.datos))}.\n\n` +
                 'Lo que se borró se recupera y lo que se cambió vuelve a como estaba en la copia. ' +
                 'Lo creado después de la copia se conserva.')) return false;
    await SB.restaurarDatos(backup.datos);
    if (backup.config?.empresa && Object.keys(backup.config.empresa).length)     localStorage.setItem(CLAVE_EMP(), JSON.stringify(backup.config.empresa));
    if (backup.config?.impresora && Object.keys(backup.config.impresora).length) localStorage.setItem(CLAVE_IMP(), JSON.stringify(backup.config.impresora));
    _pushRemota();
    _cargarEnFormulario();
    _cargarImpresora();
    return true;
  }

  async function _importar(archivo) {
    if (!archivo) return;
    try {
      let backup;
      try { backup = JSON.parse(await archivo.text()); }
      catch { alert('El archivo no es una copia de seguridad válida de esta aplicación.'); return; }
      if (await _restaurarBackup(backup)) _mostrarMsg('bkp-msg', '✔ Datos restaurados correctamente');
    } catch (e) {
      _mostrarMsg('bkp-msg', '✖ Error al restaurar: ' + e.message);
    } finally {
      const inp = document.getElementById('bkp-input-archivo');
      if (inp) inp.value = '';
    }
  }

  // --- Copias automáticas en el servidor ---

  async function _renderCopias() {
    const cont = document.getElementById('bkp-copias');
    if (!cont || !SB.puedeGestionar()) return;
    cont.innerHTML = '<p class="texto-vacio">Cargando copias…</p>';
    let copias;
    try { copias = await SB.listarCopias(); }
    catch (e) {
      const msg = String(e?.message || '');
      cont.innerHTML = /copias_seguridad|PGRST205|404/.test(msg)
        ? '<p class="appcc-nota">Las copias automáticas se activarán en cuanto se actualice la base de datos. Mientras, usa «Descargar copia».</p>'
        : `<p class="appcc-nota">${navigator.onLine ? 'No se han podido cargar las copias.' : 'Sin conexión: las copias del servidor se ven cuando vuelva la red.'}</p>`;
      return;
    }
    if (!copias?.length) {
      cont.innerHTML = '<p class="appcc-nota">Aún no hay copias en el servidor. La primera se hará el próximo lunes, o pulsa «Hacer copia ahora».</p>';
      return;
    }
    cont.innerHTML = `<ul class="bkp-lista">${copias.map(c => `
      <li class="bkp-copia">
        <div class="bkp-copia-info">
          <strong>${esc(_fechaHora(c.creada))}</strong>
          <span class="bkp-copia-tipo">${c.origen === 'manual' ? 'Hecha a mano' : 'Automática'}</span>
          <small>${esc(_resumenDatos(c.resumen || {}))}</small>
        </div>
        <div class="bkp-copia-acciones">
          <button type="button" class="btn-mini" data-copia-descargar="${esc(c.id)}"><svg class="ic" aria-hidden="true"><use href="#i-download"/></svg> Descargar</button>
          <button type="button" class="btn-mini btn-editar" data-copia-restaurar="${esc(c.id)}"><svg class="ic" aria-hidden="true"><use href="#i-archive-restore"/></svg> Restaurar</button>
        </div>
      </li>`).join('')}</ul>`;
  }

  function _descargarJson(obj, nombre) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function _accionCopia(e) {
    const bDesc = e.target.closest('[data-copia-descargar]'), bRest = e.target.closest('[data-copia-restaurar]');
    const b = bDesc || bRest;
    if (!b) return;
    b.disabled = true;
    try {
      const copia = await SB.obtenerCopia(bDesc ? b.dataset.copiaDescargar : b.dataset.copiaRestaurar);
      if (!copia) throw new Error('No se ha encontrado la copia.');
      const backup = SB.copiaAFormatoArchivo(copia);
      if (bDesc) _descargarJson(backup, `cocina-copia-${String(copia.creada).slice(0, 10)}.json`);
      else if (await _restaurarBackup(backup)) aviso('✔ Copia restaurada.', { tipo: 'ok', ms: 3000 });
    } catch (err) {
      aviso('No se ha podido ' + (bDesc ? 'descargar' : 'restaurar') + ' la copia: ' + err.message, { tipo: 'error', ms: 6000 });
    } finally { b.disabled = false; }
  }

  async function _copiaAhora() {
    const btn = document.getElementById('bkp-btn-ahora');
    if (btn) btn.disabled = true;
    try {
      if (SB.pendientes() && navigator.onLine) await SB.flushOutbox();   // que entre lo hecho sin conexión
      await SB.crearCopiaAhora();
      aviso('✔ Copia guardada en el servidor.', { tipo: 'ok', ms: 2500 });
      await _renderCopias();
    } catch (e) {
      aviso('No se ha podido hacer la copia: ' + e.message, { tipo: 'error', ms: 6000 });
    } finally { if (btn) btn.disabled = false; }
  }

  // --- Sincronización con Supabase ---

  // Sube la config actual (de localStorage) a Supabase. Silencioso ante fallos/offline.
  function _pushRemota() {
    try {
      SB.guardarConfigRemota({
        empresa:   obtenerConfig(),
        impresora: obtenerConfigImpresora(),
        logo:      localStorage.getItem(CLAVE_LOGO()) || null,
      })?.catch(() => {});
    } catch { /* offline: se queda en local, se subirá al próximo guardado con conexión */ }
  }

  // Trae la config de Supabase y, si existe, hidrata localStorage + repinta.
  async function _hidratarRemota() {
    try {
      const r = await SB.obtenerConfigRemota();
      if (!r) return;
      if (r.empresa   && Object.keys(r.empresa).length)   localStorage.setItem(CLAVE_EMP(), JSON.stringify(r.empresa));
      if (r.impresora && Object.keys(r.impresora).length) localStorage.setItem(CLAVE_IMP(), JSON.stringify(r.impresora));
      try {
        if (r.logo) localStorage.setItem(CLAVE_LOGO(), r.logo);
        else        localStorage.removeItem(CLAVE_LOGO());
      } catch { /* logo antiguo demasiado grande para el almacenamiento local */ }
      _cargarEnFormulario();
      _cargarImpresora();
      _actualizarCabecera();
      _cargarLogoEnUI();
      const cfg = obtenerConfig();
      const dashNombre = document.getElementById('dash-nombre-restaurante');
      if (dashNombre) dashNombre.textContent = cfg.razonSocial || SB.restauranteActivo()?.nombre || 'Cocina';
    } catch { /* sin conexión: nos quedamos con lo de localStorage */ }
  }

  // --- Util ---

  function _mostrarMsg(id, texto) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = texto;
    setTimeout(() => { el.textContent = ''; }, 2500);
  }

  // --- Init ---

  async function init() {
    _cargarEnFormulario();
    _cargarImpresora();
    _actualizarCabecera();
    _cargarLogoEnUI();

    const cfg = obtenerConfig();
    const dashNombre = document.getElementById('dash-nombre-restaurante');
    if (dashNombre) dashNombre.textContent = cfg.razonSocial || SB.restauranteActivo()?.nombre || 'Cocina';

    document.getElementById('cfg-btn-guardar')  ?.addEventListener('click', _guardarDesdeFormulario);
    document.getElementById('imp-btn-guardar')  ?.addEventListener('click', _guardarImpresora);
    document.getElementById('imp-btn-test')     ?.addEventListener('click', _testImpresora);
    document.getElementById('imp-conexion')     ?.addEventListener('change', e => _toggleConexion(e.target.value));
    document.getElementById('bkp-btn-exportar') ?.addEventListener('click', _exportar);
    document.getElementById('bkp-input-archivo')?.addEventListener('change', e => _importar(e.target.files[0]));
    document.getElementById('bkp-btn-ahora')    ?.addEventListener('click', _copiaAhora);
    document.getElementById('bkp-copias')       ?.addEventListener('click', _accionCopia);
    document.getElementById('cfg-logo-input')   ?.addEventListener('change', e => _subirLogo(e.target.files[0]));
    document.getElementById('cfg-logo-quitar')  ?.addEventListener('click', _quitarLogo);
    document.getElementById('cfg-btn-logout')   ?.addEventListener('click', async () => {
      // Intentar subir antes lo pendiente: al cerrar sesión se borran los datos del dispositivo
      if (SB.pendientes() && navigator.onLine) await SB.flushOutbox();
      const pend = SB.pendientes();
      const msg = pend
        ? `⚠ Tienes ${pend} cambio(s) sin sincronizar (hechos sin conexión).\nSi cierras sesión ahora SE PERDERÁN.\n\n¿Cerrar sesión de todas formas?`
        : '¿Cerrar sesión?\n\nSe borrarán de este dispositivo los datos guardados (siguen a salvo en el servidor).';
      if (!confirm(msg)) return;
      SB.logout();
      SB.limpiarDatosLocales(); // que la siguiente persona que use el dispositivo no vea tus datos
      location.reload();
    });

    // Sincronizar con Supabase en segundo plano (trae la config de otros dispositivos)
    _hidratarRemota();
    _renderCopias();
  }

  /** Guarda un ajuste suelto en la ficha de empresa (se sincroniza con Supabase). */
  function guardarAjuste(clave, valor) {
    const cfg = obtenerConfig();
    cfg[clave] = valor;
    try { localStorage.setItem(CLAVE_EMP(), JSON.stringify(cfg)); } catch {}
    _pushRemota();
  }

  function obtenerLogo() {
    try { const l = localStorage.getItem(CLAVE_LOGO()); return l && l.startsWith('data:image/') ? l : null; } catch { return null; }
  }

  return { init, obtenerConfig, obtenerConfigImpresora, guardarAjuste, obtenerLogo, recargar: _hidratarRemota };

})();
