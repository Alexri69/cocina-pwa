// ============================================================
// core/voz.js — Síntesis de voz, reconocimiento y utilidades
// Compartido por todos los módulos que usen voz o necesiten
// formatear fechas / calcular caducidades.
// ============================================================

// Formatea un importe a 2 decimales de forma segura (null/undefined/'' → 0.00).
function dinero(n){ return (Number(n) || 0).toFixed(2); }

// Escapa texto para insertarlo en HTML de forma segura (evita XSS con datos guardados).
function esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

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
  function escuchar(timeoutMs = 9000) {
    return new Promise((ok, err) => {
      if (!SpeechRecognition) {
        err(new Error('Reconocimiento de voz no soportado en este navegador.'));
        return;
      }
      const r = new SpeechRecognition();
      r.lang            = 'es-ES';
      r.interimResults  = false;
      r.maxAlternatives = 1;
      r.continuous      = true; // No se corta en pausas cortas

      let resuelto = false;

      const _ok  = (txt) => { if (resuelto) return; resuelto = true; clearTimeout(tOut); try { r.stop(); } catch {} ok(txt); };
      const _err = (e)   => { if (resuelto) return; resuelto = true; clearTimeout(tOut); try { r.stop(); } catch {} err(e); };

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
    const t = texto.toLowerCase().trim();
    const si = ['sí','si','yes','correcto','afirmativo','claro','tiene','contiene',
                 'efectivamente','por supuesto','sip','aja','ajá','así'];
    const no = ['no','nope','negativo','ninguno','tampoco','sin','nada','libre'];
    if (si.some(p => t.includes(p))) return true;
    if (no.some(p => t.includes(p))) return false;
    return null;
  }

  /** "salsa bearnesa" → "Salsa Bearnesa" */
  function capitalizarNombre(texto) {
    return texto.replace(/\b\w/g, l => l.toUpperCase());
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
    hablar, escuchar, soportaVoz,
    palabrasANumero, limpiarLote, detectarSiNo, capitalizarNombre,
    formatearFecha, formatearFechaSolo, calcularColorCaducidad
  };

})();
