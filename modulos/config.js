// ============================================================
// modulos/config.js — Datos de la empresa, apariencia e impresora
// Persiste en localStorage (disponible offline sin tabla Supabase).
// ============================================================

const ModuloConfig = (() => {

  const CLAVE_EMP  = 'cocina_empresa_config';
  const CLAVE_IMP  = 'cocina_impresora_config';
  const CLAVE_LOGO = 'cocina_logo';

  function obtenerConfig() {
    try { return JSON.parse(localStorage.getItem(CLAVE_EMP)) || {}; }
    catch { return {}; }
  }

  function obtenerConfigImpresora() {
    try { return JSON.parse(localStorage.getItem(CLAVE_IMP)) || {}; }
    catch { return {}; }
  }

  // --- Cabecera dinámica (nombre + logo) ---

  function _actualizarCabecera() {
    const cfg   = obtenerConfig();
    const titulo = document.getElementById('cabecera-titulo');
    if (titulo) titulo.textContent = cfg.razonSocial || 'Cocina';

    const logo = localStorage.getItem(CLAVE_LOGO);
    const img  = document.getElementById('cabecera-logo-img');
    const emo  = document.getElementById('cabecera-logo-emoji');
    if (img && emo) {
      if (logo) { img.src = logo; img.style.display = ''; emo.style.display = 'none'; }
      else       { img.style.display = 'none'; emo.style.display = ''; }
    }
  }

  function _cargarLogoEnUI() {
    const logo    = localStorage.getItem(CLAVE_LOGO);
    const preview = document.getElementById('cfg-logo-preview');
    const quitar  = document.getElementById('cfg-logo-quitar');
    if (preview) { preview.src = logo || ''; preview.style.display = logo ? '' : 'none'; }
    if (quitar)  quitar.style.display = logo ? '' : 'none';
  }

  function _subirLogo(archivo) {
    if (!archivo) return;
    const reader = new FileReader();
    reader.onload = e => {
      localStorage.setItem(CLAVE_LOGO, e.target.result);
      _cargarLogoEnUI();
      _actualizarCabecera();
    };
    reader.readAsDataURL(archivo);
  }

  function _quitarLogo() {
    localStorage.removeItem(CLAVE_LOGO);
    _cargarLogoEnUI();
    _actualizarCabecera();
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
    localStorage.setItem(CLAVE_EMP, JSON.stringify(datos));
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
    localStorage.setItem(CLAVE_IMP, JSON.stringify(datos));
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
          empresa:   JSON.parse(localStorage.getItem(CLAVE_EMP)  || '{}'),
          impresora: JSON.parse(localStorage.getItem(CLAVE_IMP)  || '{}'),
        },
        datos,
      };
      const blob     = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      const fechaStr = new Date().toISOString().slice(0, 10);
      a.href         = url;
      a.download     = `cocina-backup-${fechaStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      _mostrarMsg('bkp-msg', '✔ Copia descargada');
    } catch (e) {
      _mostrarMsg('bkp-msg', '✖ Error: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function _importar(archivo) {
    if (!archivo) return;
    const btn = document.getElementById('bkp-btn-importar');
    if (btn) btn.disabled = true;
    try {
      const texto  = await archivo.text();
      const backup = JSON.parse(texto);

      if (backup.app !== 'cocina-pwa' || !backup.datos) {
        alert('El archivo no es una copia de seguridad válida de esta aplicación.');
        return;
      }

      const resumen = [
        `${backup.datos.ingredientes?.length ?? 0} ingredientes`,
        `${backup.datos.platos?.length ?? 0} platos`,
        `${backup.datos.bebidas?.length ?? 0} bebidas`,
        `${backup.datos.facturas?.length ?? 0} facturas/presupuestos`,
      ].join(', ');

      if (!confirm(`¿Restaurar copia del ${backup.fecha?.slice(0,10)}?\n\nContiene: ${resumen}.\n\nLos registros existentes con el mismo ID se actualizarán. Los nuevos se añadirán.`)) return;

      await SB.restaurarDatos(backup.datos);

      if (backup.config?.empresa)   localStorage.setItem(CLAVE_EMP, JSON.stringify(backup.config.empresa));
      if (backup.config?.impresora) localStorage.setItem(CLAVE_IMP, JSON.stringify(backup.config.impresora));

      _cargarEnFormulario();
      _cargarImpresora();
      _mostrarMsg('bkp-msg', '✔ Datos restaurados correctamente');
    } catch (e) {
      _mostrarMsg('bkp-msg', '✖ Error al restaurar: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
      const inp = document.getElementById('bkp-input-archivo');
      if (inp) inp.value = '';
    }
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
    if (dashNombre && cfg.razonSocial) dashNombre.textContent = cfg.razonSocial;

    document.getElementById('cfg-btn-guardar')  ?.addEventListener('click', _guardarDesdeFormulario);
    document.getElementById('imp-btn-guardar')  ?.addEventListener('click', _guardarImpresora);
    document.getElementById('imp-btn-test')     ?.addEventListener('click', _testImpresora);
    document.getElementById('imp-conexion')     ?.addEventListener('change', e => _toggleConexion(e.target.value));
    document.getElementById('bkp-btn-exportar') ?.addEventListener('click', _exportar);
    document.getElementById('bkp-input-archivo')?.addEventListener('change', e => _importar(e.target.files[0]));
    document.getElementById('cfg-logo-input')   ?.addEventListener('change', e => _subirLogo(e.target.files[0]));
    document.getElementById('cfg-logo-quitar')  ?.addEventListener('click', _quitarLogo);
    document.getElementById('cfg-btn-logout')   ?.addEventListener('click', () => {
      if (confirm('¿Cerrar sesión?')) { SB.logout(); location.reload(); }
    });
  }

  return { init, obtenerConfig, obtenerConfigImpresora };

})();
