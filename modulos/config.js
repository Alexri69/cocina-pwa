// ============================================================
// modulos/config.js — Datos de la empresa, apariencia e impresora
// Persiste en localStorage (disponible offline sin tabla Supabase).
// ============================================================

const ModuloConfig = (() => {

  const CLAVE_EMP = 'cocina_empresa_config';
  const CLAVE_IMP = 'cocina_impresora_config';

  function obtenerConfig() {
    try { return JSON.parse(localStorage.getItem(CLAVE_EMP)) || {}; }
    catch { return {}; }
  }

  function obtenerConfigImpresora() {
    try { return JSON.parse(localStorage.getItem(CLAVE_IMP)) || {}; }
    catch { return {}; }
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

    // Actualizar nombre en el dashboard si existe
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

    // Mostrar nombre del restaurante en dashboard
    const cfg = obtenerConfig();
    if (cfg.razonSocial) {
      const dashNombre = document.getElementById('dash-nombre-restaurante');
      if (dashNombre) dashNombre.textContent = cfg.razonSocial;
    }

    document.getElementById('cfg-btn-guardar')?.addEventListener('click', _guardarDesdeFormulario);
    document.getElementById('imp-btn-guardar')?.addEventListener('click', _guardarImpresora);
    document.getElementById('imp-btn-test')?.addEventListener('click', _testImpresora);
    document.getElementById('imp-conexion')?.addEventListener('change', e => _toggleConexion(e.target.value));
  }

  return { init, obtenerConfig, obtenerConfigImpresora };

})();
