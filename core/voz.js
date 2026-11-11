// ============================================================
// core/voz.js — Síntesis de voz, reconocimiento y utilidades
// Compartido por todos los módulos que usen voz o necesiten
// formatear fechas / calcular caducidades.
// ============================================================

// Formatea un importe a 2 decimales de forma segura (null/undefined/'' → 0.00).
function dinero(n){ return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// ---- Botón "atrás" del móvil/navegador dentro de la app ----
// Cada formulario o vista secundaria abierta añade una entrada al historial;
// "atrás" la cierra en vez de salir de la app. Cambiar de módulo también se puede deshacer con "atrás".
const Navegacion = (() => {
  let _cerrar = null;        // función que cierra la vista secundaria abierta
  let _desdeAtras = false;   // la vista se está cerrando por el botón "atrás"
  let _ignorar = 0;          // popstate provocados por nosotros
  let _encima = null;        // ventana superpuesta (p. ej. la cámara) sobre la vista actual
  return {
    /** Una ventana superpuesta se ha abierto: «atrás» la cierra sin tocar la vista de debajo. */
    encima(cerrar) {
      _encima = cerrar;
      try { history.pushState({ ...(history.state || {}), sub: true }, ''); } catch {}
    },
    /** La ventana superpuesta se ha cerrado desde un botón de la app. */
    encimaCerrada() {
      if (!_encima) return;
      _encima = null;
      if (_desdeAtras) return;
      _ignorar++;
      try { history.back(); } catch { _ignorar--; }
    },
    /** Una vista secundaria (formulario, detalle…) se ha abierto. */
    abrir(cerrar) {
      if (_cerrar) { _cerrar = cerrar; return; }   // ya hay una abierta: solo se actualiza cómo cerrarla
      _cerrar = cerrar;
      try { history.pushState({ ...(history.state || {}), sub: true }, ''); } catch {}
    },
    /** La vista secundaria se ha cerrado desde un botón de la app. */
    cerrada() {
      if (!_cerrar) return;
      _cerrar = null;
      if (_desdeAtras) return;
      _ignorar++;
      try { history.back(); } catch { _ignorar--; }
    },
    /** Al cambiar de módulo se abandona la vista secundaria (sin tocar el historial). */
    olvidar() { _cerrar = null; },
    _alPulsarAtras(e) {
      if (_ignorar) { _ignorar--; return true; }
      if (_encima) {
        const f = _encima; _encima = null; _desdeAtras = true;
        try { f(); } finally { _desdeAtras = false; }
        return true;
      }
      if (_cerrar) {
        const f = _cerrar; _cerrar = null; _desdeAtras = true;
        try { f(); } finally { _desdeAtras = false; }
        return true;
      }
      return false;
    },
  };
})();

// Icono del sprite de index.html (Lucide). Ej.: icono('tag')
function icono(nombre, clase = ''){ return `<svg class="ic ${clase}" aria-hidden="true"><use href="#i-${nombre}"/></svg>`; }

// Primera letra en mayúscula ("martes, 10 de noviembre" → "Martes, 10 de noviembre")
function capitalizar(s){ s = String(s || ''); return s.charAt(0).toLocaleUpperCase('es') + s.slice(1); }

// Redondea un importe a céntimos (evita descuadres de 0,01 € en facturas).
// (toFixed(6) absorbe el error de coma flotante: 3 × 3,335 = 10,00499999… → 10,01)
// Redondeo "medio hacia fuera" también en negativos (facturas rectificativas): −2,675 → −2,68.
function r2(n){ const x = Number(n) || 0; return Math.sign(x) * Math.round(Number((Math.abs(x) * 100).toFixed(6))) / 100 || 0; }

// Aviso flotante no bloqueante. opciones: { tipo: 'ok'|'error'|'info', ms, accion: { texto, fn } }
function aviso(texto, opciones = {}) {
  const { tipo = 'info', ms = 4000, accion = null } = opciones;
  let cont = document.getElementById('avisos-cont');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'avisos-cont';
    cont.setAttribute('aria-live', 'polite');
    cont.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;gap:8px;width:min(92vw,440px);pointer-events:none';
    document.body.appendChild(cont);
  }
  const colores = { ok: '#1e7e46', error: '#b03a2e', info: '#2c3e50' };
  const el = document.createElement('div');
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.style.cssText = `background:${colores[tipo] || colores.info};color:#fff;padding:12px 14px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center;justify-content:space-between;font-size:.95rem;pointer-events:auto`;
  const span = document.createElement('span');
  span.textContent = texto;
  el.appendChild(span);
  const cerrar = () => el.remove();
  if (accion) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = accion.texto;
    b.style.cssText = 'background:#fff;color:#222;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer;white-space:nowrap';
    b.addEventListener('click', () => { cerrar(); accion.fn(); });
    el.appendChild(b);
  }
  cont.appendChild(el);
  if (ms > 0) setTimeout(cerrar, ms);
  return cerrar;
}

// Escapa texto para insertarlo en HTML de forma segura (evita XSS con datos guardados).
function esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── Validadores (devuelven true si está vacío → campos opcionales) ──────────
// Botón ± junto a los campos de temperatura: muchos teclados numéricos de Android no traen «−».
// Uso: <span class="inp-con-signo"><input type="number" …><button type="button" class="btn-signo" …>±</button></span>
const BOTON_SIGNO = '<button type="button" class="btn-signo" aria-label="Cambiar a negativo o positivo" title="Cambiar el signo (bajo cero)">±</button>';
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.btn-signo');
  if (!btn) return;
  const inp = btn.parentElement?.querySelector('input');
  if (!inp) return;
  const v = String(inp.value || '').trim();
  if (!v) { inp.focus(); aviso('Escribe primero la temperatura y luego pulsa ± para ponerla bajo cero.', { ms: 3500 }); return; }
  inp.value = v.startsWith('-') ? v.slice(1) : '-' + v;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
});

// Botón «Traducir automáticamente» en el formulario de plato o bebida (data-traducir="plato"|"beb").
// Rellena solo los campos de traducción vacíos; si ya estaban todos, los vuelve a traducir.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest?.('[data-traducir]');
  if (!btn) return;
  const p = btn.dataset.traducir;
  const nombre = (document.getElementById(p + '-nombre')?.value || '').trim();
  const desc = (document.getElementById(p + '-desc')?.value || '').trim();
  if (!nombre) { aviso('Escribe primero el nombre en español.', { ms: 3000 }); document.getElementById(p + '-nombre')?.focus(); return; }
  const campos = [];
  for (const l of SB.IDIOMAS_CARTA) {
    campos.push({ el: document.getElementById(`${p}-tr-${l}-nombre`), l, i: 0 });
    if (desc) campos.push({ el: document.getElementById(`${p}-tr-${l}-desc`), l, i: 1 });
  }
  const vacios = campos.filter(c => c.el && !c.el.value.trim());
  const aRellenar = vacios.length ? vacios : campos.filter(c => c.el);
  const texto = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Traduciendo…';
  try {
    const r = await SB.traducir([nombre, desc]);
    aRellenar.forEach(c => { c.el.value = r?.[c.l]?.[c.i] || c.el.value; });
    aviso('✔ Traducido. Revísalo antes de guardar.', { tipo: 'ok', ms: 3000 });
  } catch (x) {
    aviso(x.message || 'No se pudo traducir.', { tipo: 'error', ms: 6000 });
  } finally { btn.disabled = false; btn.innerHTML = texto; }
});

function validarEmail(v){
  if(!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
}
// NIF/NIE/CIF español con dígito de control.
function validarNif(v){
  if(!v) return true;
  v = String(v).toUpperCase().replace(/[\s.\-]/g, '');
  const L = 'TRWAGMYFPDXBNJZSQVHLCKE';
  if (/^[0-9]{8}[A-Z]$/.test(v)) return v[8] === L[parseInt(v.slice(0,8),10) % 23];            // DNI
  if (/^[XYZ][0-9]{7}[A-Z]$/.test(v)) {                                                          // NIE
    const n = ({ X:'0', Y:'1', Z:'2' }[v[0]]) + v.slice(1,8);
    return v[8] === L[parseInt(n,10) % 23];
  }
  if (/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(v)) {                                          // CIF
    const dig = v.slice(1,8); let par = 0, non = 0;
    for (let i = 0; i < 7; i++) { const d = +dig[i]; if (i % 2 === 0) { const x = d*2; non += x > 9 ? x-9 : x; } else { par += d; } }
    const ctrl = (10 - ((par+non) % 10)) % 10;
    return v[8] === String(ctrl) || v[8] === 'JABCDEFGHI'[ctrl];
  }
  return false;
}
// IBAN: formato + checksum mód-97.
function validarIban(v){
  if(!v) return true;
  v = String(v).toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  const re  = v.slice(4) + v.slice(0,4);
  const num = re.replace(/[A-Z]/g, c => (c.charCodeAt(0) - 55).toString());
  let rem = 0;
  for (let i = 0; i < num.length; i++) rem = (rem * 10 + (num.charCodeAt(i) - 48)) % 97;
  return rem === 1;
}

const VOZ = (() => {

  // Soporte del navegador (Chrome usa el prefijo webkit)
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ----------------------------------------------------------
  // SÍNTESIS DE VOZ (Text-to-Speech)
  // ----------------------------------------------------------

  /**
   * La app habla en voz alta el texto recibido.
   * Cancela cualquier locución anterior para evitar solapamiento.
   * Devuelve una Promise que resuelve cuando termina de hablar.
   */
  function hablar(texto) {
    return new Promise((ok) => {
      window.speechSynthesis.cancel();
      const u    = new SpeechSynthesisUtterance(texto);
      u.lang     = 'es-ES';
      u.rate     = 0.92;  // Algo más lento para entornos ruidosos
      u.pitch    = 1.0;
      u.volume   = 1.0;
      u.onend    = ok;
      u.onerror  = ok; // Si falla la voz seguimos igualmente
      window.speechSynthesis.speak(u);
    });
  }

  // ----------------------------------------------------------
  // RECONOCIMIENTO DE VOZ (Speech-to-Text)
  // ----------------------------------------------------------

  /**
   * Escucha al usuario y devuelve lo que dice como texto en minúsculas.
   * Devuelve una Promise que:
   *   - Resuelve con el texto reconocido.
   *   - Rechaza si hay error o silencio prolongado.
   */
  let _cancelarActual = null; // corta la escucha en curso (botón Cancelar)

  function cancelarEscucha() { if (_cancelarActual) _cancelarActual(); }

  function escuchar(timeoutMs = 9000) {
    return new Promise((ok, err) => {
      if (!SpeechRecognition) {
        err(new Error('Reconocimiento de voz no soportado en este navegador.'));
        return;
      }
      const r = new SpeechRecognition();
      _cancelarActual = () => _err(new Error('cancelado'));
      r.lang            = 'es-ES';
      r.interimResults  = false;
      r.maxAlternatives = 1;
      r.continuous      = true; // No se corta en pausas cortas

      let resuelto = false;

      const _fin = () => { resuelto = true; clearTimeout(tOut); _cancelarActual = null; try { r.stop(); } catch {} };
      function _ok(txt) { if (resuelto) return; _fin(); ok(txt); }
      function _err(e)  { if (resuelto) return; _fin(); err(e); }

      // Tiempo máximo de espera por si no llega ningún resultado
      const tOut = setTimeout(() => _err(new Error('timeout')), timeoutMs);

      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            _ok(e.results[i][0].transcript.trim().toLowerCase());
            return;
          }
        }
      };

      r.onerror = (e) => {
        if (e.error === 'no-speech') return; // ignorar silencio, seguir esperando
        _err(new Error(e.error));
      };

      r.start();
    });
  }

  /** Devuelve true si el navegador soporta reconocimiento de voz. */
  function soportaVoz() { return !!SpeechRecognition; }

  // ----------------------------------------------------------
  // UTILIDADES DE PROCESAMIENTO DE VOZ
  // ----------------------------------------------------------

  /**
   * Convierte palabras numéricas en español a entero.
   * "tres" → 3 | "veinticinco" → 25 | "7" → 7 | null si no reconoce.
   */
  function palabrasANumero(texto) {
    const n = parseInt(texto.trim(), 10);
    if (!isNaN(n)) return n;

    const mapa = {
      'cero':0,'uno':1,'una':1,'dos':2,'tres':3,'cuatro':4,'cinco':5,
      'seis':6,'siete':7,'ocho':8,'nueve':9,'diez':10,'once':11,'doce':12,
      'trece':13,'catorce':14,'quince':15,'dieciséis':16,'dieciseis':16,
      'diecisiete':17,'dieciocho':18,'diecinueve':19,'veinte':20,
      'veintiuno':21,'veintidós':22,'veintidos':22,'veintitrés':23,
      'veintitres':23,'veinticuatro':24,'veinticinco':25,'veintiséis':26,
      'veintisiete':27,'veintiocho':28,'veintinueve':29,
      'treinta':30,'cuarenta':40,'cincuenta':50,'sesenta':60,
      'setenta':70,'ochenta':80,'noventa':90,'cien':100
    };

    const t = texto.trim().toLowerCase();
    if (mapa[t] !== undefined) return mapa[t];

    // "treinta y dos" → 32
    const m = t.match(/^(treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa) y (\w+)$/);
    if (m && mapa[m[1]] !== undefined && mapa[m[2]] !== undefined) return mapa[m[1]] + mapa[m[2]];

    // Buscar la primera palabra numérica dentro de una frase más larga
    for (const p of t.split(/\s+/)) {
      if (mapa[p] !== undefined) return mapa[p];
      const x = parseInt(p, 10);
      if (!isNaN(x)) return x;
    }
    return null;
  }

  /**
   * Normaliza el número de lote:
   * convierte dígitos verbales a cifras, quita espacios y pasa a mayúsculas.
   * Ej: "l dos cuatro cero cinco" → "L2405"
   */
  function limpiarLote(texto) {
    const mapaD = {
      'cero':'0','uno':'1','una':'1','dos':'2','tres':'3','cuatro':'4',
      'cinco':'5','seis':'6','siete':'7','ocho':'8','nueve':'9'
    };
    let r = texto.toLowerCase();
    for (const [p, d] of Object.entries(mapaD)) {
      r = r.replace(new RegExp('\\b' + p + '\\b', 'g'), d);
    }
    return r.replace(/\s+/g, '').toUpperCase();
  }

  /**
   * Interpreta "sí/no" en una respuesta de voz.
   * Devuelve true, false o null (ambiguo → repetir pregunta).
   */
  function detectarSiNo(texto) {
    // Se compara por palabras completas: antes "sin" o "así" contaban como "sí".
    const palabras = String(texto || '').toLowerCase().split(/[^a-záéíóúüñ]+/).filter(Boolean);
    const SI = new Set(['sí','si','yes','correcto','afirmativo','claro','tiene','contiene',
                        'efectivamente','supuesto','sip','aja','ajá','vale','exacto']);
    const NO = new Set(['no','nope','negativo','ninguno','ninguna','tampoco','sin','nada','libre','incorrecto']);
    // Gana la primera palabra que sea claramente sí o no ("no, está bien" → no)
    for (const p of palabras) {
      if (NO.has(p)) return false;
      if (SI.has(p)) return true;
    }
    return null;
  }

  /** "salsa bearnesa" → "Salsa Bearnesa" · "caldo de pollo" → "Caldo de Pollo" (artículos y preposiciones en minúscula) */
  const _MINUSCULAS = new Set(['de','del','la','las','el','los','y','e','o','u','a','al','en','con','sin','para','por','al']);
  function capitalizarNombre(texto) {
    return String(texto || '').trim().split(/\s+/).map((p, i) => {
      if (i > 0 && _MINUSCULAS.has(p.toLowerCase())) return p.toLowerCase();
      return p.charAt(0).toLocaleUpperCase('es') + p.slice(1);
    }).join(' ');
  }

  // ----------------------------------------------------------
  // UTILIDADES DE FECHA Y CADUCIDAD
  // ----------------------------------------------------------

  /**
   * Formatea un string ISO como "DD/MM/AAAA HH:MM".
   */
  function formatearFecha(iso) {
    return new Date(iso).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  /**
   * Formatea solo la fecha (sin hora): "DD/MM/AAAA".
   */
  function formatearFechaSolo(iso) {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  /**
   * Devuelve la clase CSS de color según días hasta la caducidad:
   *   'verde' → más de 2 días | 'amarillo' → ≤2 días | 'rojo' → caducado
   */
  function calcularColorCaducidad(iso) {
    const dias = (new Date(iso) - new Date()) / 86400000;
    if (dias < 0)  return 'rojo';
    if (dias <= 2) return 'amarillo';
    return 'verde';
  }

  // ----------------------------------------------------------
  // API PÚBLICA
  // ----------------------------------------------------------
  return {
    hablar, escuchar, cancelarEscucha, soportaVoz,
    palabrasANumero, limpiarLote, detectarSiNo, capitalizarNombre,
    formatearFecha, formatearFechaSolo, calcularColorCaducidad
  };

})();
