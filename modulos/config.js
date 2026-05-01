// ============================================================
// modulos/config.js — Datos de la empresa y ajustes globales
// Persiste en localStorage (disponible offline sin tabla Supabase).
// ============================================================

const ModuloConfig = (() => {

  const CLAVE = 'cocina_empresa_config';

  /** Devuelve el objeto de configuración guardado (o {} si no hay nada). */
  function obtenerConfig() {
    try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; }
    catch { return {}; }
  }

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
    ].forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && val != null) el.value = val;
    });
    const igic = document.getElementById('cfg-igic');
    if (igic) igic.value = cfg.igicDefault ?? 7;
  }

  function _guardarDesdeFormulario() {
    const val = id => document.getElementById(id)?.value.trim() ?? '';
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
      igicDefault: parseFloat(document.getElementById('cfg-igic')?.value) || 7,
    };
    localStorage.setItem(CLAVE, JSON.stringify(datos));
    const msg = document.getElementById('cfg-msg');
    if (msg) {
      msg.textContent = '✔ Guardado';
      setTimeout(() => { msg.textContent = ''; }, 2500);
    }
  }

  async function init() {
    _cargarEnFormulario();
    document.getElementById('cfg-btn-guardar')?.addEventListener('click', _guardarDesdeFormulario);
  }

  return { init, obtenerConfig };

})();
