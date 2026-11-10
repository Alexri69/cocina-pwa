// ============================================================
// modulos/lector-lote.js — Leer el nº de lote con la cámara
//   1. Código de barras GS1 (GS1-128, DataMatrix, QR o enlace GS1): el lote es el campo (10).
//      Lo lee el navegador (BarcodeDetector: Chrome en Android, macOS…) al instante y sin red.
//   2. Texto impreso («LOTE L2405», «L: 24-118»…): foto + reconocimiento de texto (Tesseract.js,
//      se descarga la primera vez que se usa, ~4 MB, y queda en la caché del navegador).
// La persona siempre elige o confirma el resultado; nunca se guarda nada sin revisar.
// Depende de: core/voz.js (esc, aviso), Navegacion
// ============================================================

const LectorLote = (() => {

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const $ = id => document.getElementById(id);

  let _stream = null, _detector = null, _timer = null, _destino = null, _worker = null, _abierto = false;

  // ----------------------------------------------------------
  // INTERPRETAR LO LEÍDO (funciones puras, se prueban aparte)
  // ----------------------------------------------------------

  // AI de longitud fija más habituales; el resto se leen hasta el separador FNC1 (carácter GS)
  const _AI_FIJOS = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };

  /** Campos de un código GS1 → { '01': '0841…', '10': 'L2405', '17': '261231' } o null si no es GS1. */
  function analizarGS1(bruto) {
    let s = String(bruto || '').trim();
    if (!s) return null;
    // Enlace GS1 Digital Link: https://…/01/08412345678905/10/L2405?17=261231
    const dl = s.match(/^https?:\/\/[^/]+(?:\/[^?#]*)?\/01\/(\d{14})(?:\/[^?#]*)?$/i) || s.match(/\/01\/(\d{8,14})/);
    if (/^https?:\/\//i.test(s)) {
      if (!dl) return null;
      const out = { '01': dl[1] };
      const lote = s.match(/\/10\/([^/?#]+)/);
      if (lote) out['10'] = decodeURIComponent(lote[1]);
      const cad = s.match(/[?&]17=(\d{6})/);
      if (cad) out['17'] = cad[1];
      return out;
    }
    s = s.replace(/^\][A-Za-z]\d/, '');                 // identificador de simbología (]C1, ]d2, ]Q3)
    // Texto legible con paréntesis: (01)08412345678905(10)L2405
    if (/^\(\d{2,4}\)/.test(s)) {
      const out = {};
      s.replace(/\((\d{2,4})\)([^(]*)/g, (_, ai, v) => { out[ai] = v.trim(); return ''; });
      return Object.keys(out).length ? out : null;
    }
    if (!/^\d{2}/.test(s)) return null;
    const out = {}; let i = 0;
    while (i < s.length) {
      if (s[i] === '\x1d') { i++; continue; }
      const ai2 = s.substr(i, 2), ai4 = s.substr(i, 4);
      if (_AI_FIJOS[ai2]) {
        const v = s.substr(i + 2, _AI_FIJOS[ai2]);
        if (v.length < _AI_FIJOS[ai2] || !/^\d+$/.test(v)) return null;
        out[ai2] = v; i += 2 + _AI_FIJOS[ai2]; continue;
      }
      if (/^3[1-6]\d\d$/.test(ai4)) { out[ai4] = s.substr(i + 4, 6); i += 10; continue; }  // pesos y medidas
      let largoAi = 0;
      if (/^(10|21|22|30|37|9\d)$/.test(ai2)) largoAi = 2;
      else if (/^(24[0-3]|25[0-4]|40[0-3]|41[0-7]|42[0-2])$/.test(s.substr(i, 3))) largoAi = 3;
      if (!largoAi) break;                               // AI desconocido: nos quedamos con lo leído
      const fin = s.indexOf('\x1d', i + largoAi);
      out[s.substr(i, largoAi)] = (fin < 0 ? s.slice(i + largoAi) : s.slice(i + largoAi, fin)).slice(0, 30);
      i = fin < 0 ? s.length : fin + 1;
    }
    return ('01' in out || '10' in out) ? out : null;
  }

  const _limpiar = t => String(t || '').toUpperCase().replace(/\s+/g, '').replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '').slice(0, 20);
  const _pareceFecha = t => /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(t) || /^\d{1,2}[/.\-]\d{4}$/.test(t);

  /** Posibles lotes en un texto reconocido, los más probables primero (máx. 5). */
  function candidatosLote(texto) {
    const t = String(texto || '').toUpperCase().replace(/[|]/g, 'I').replace(/[“”"']/g, '');
    const fuertes = [], debiles = [];
    const meter = (arr, v) => { v = _limpiar(v); if (v.length >= 2 && !_pareceFecha(v) && !fuertes.includes(v) && !debiles.includes(v)) arr.push(v); };
    // Tras una palabra clave: LOTE / LOT / BATCH / LOTTO / LOS / L:
    for (const m of t.matchAll(/\b(?:LOTE|LOT|BATCH|LOTTO|LOS|CHARGE)\b\s*(?:N[º°O]?\.?|#)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-/.]{1,19})/g)) meter(fuertes, m[1]);
    for (const m of t.matchAll(/(?:^|\s)L\s*[:.]\s*([A-Z0-9][A-Z0-9\-/.]{1,19})/g)) meter(fuertes, m[1]);
    // «L» pegada a números: L2405, L24118A
    for (const m of t.matchAll(/\b(L\d[A-Z0-9\-]{2,15})\b/g)) meter(fuertes, m[1]);
    // Sin palabra clave: códigos con letras y números (descarta fechas, precios y pesos)
    for (const m of t.matchAll(/\b([A-Z0-9][A-Z0-9\-/]{3,15})\b/g)) {
      const v = m[1];
      if (/\d/.test(v) && /[A-Z]/.test(v) && !/^\d+(G|KG|ML|CL|L|GR)$/.test(v) && !/^(CAD|CONS|E\d{3})/.test(v)) meter(debiles, v);
    }
    return [...fuertes, ...debiles].slice(0, 5);
  }

  // ----------------------------------------------------------
  // CÁMARA
  // ----------------------------------------------------------

  const disponible = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  function _estado(txt, tipo = '') {
    const el = $('lote-cam-estado');
    if (el) { el.textContent = txt; el.dataset.tipo = tipo; }
  }

  function _crearDialogo() {
    if ($('lote-cam')) return;
    const d = document.createElement('div');
    d.id = 'lote-cam';
    d.className = 'lote-cam';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', 'lote-cam-titulo');
    d.hidden = true;
    d.innerHTML = `<div class="lote-cam-caja">
      <div class="lote-cam-cab">
        <strong id="lote-cam-titulo">Leer el lote</strong>
        <button type="button" class="btn-mini" data-lc="cerrar" aria-label="Cerrar"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="lote-cam-visor">
        <video id="lote-cam-video" playsinline muted autoplay></video>
        <div class="lote-cam-guia" aria-hidden="true"></div>
      </div>
      <p id="lote-cam-estado" class="lote-cam-estado" aria-live="polite"></p>
      <div id="lote-cam-opciones" class="lote-cam-opciones"></div>
      <div class="lote-cam-acciones">
        <button type="button" class="btn btn-primario-sm" data-lc="foto"><svg class="ic" aria-hidden="true"><use href="#i-scan-line"/></svg> Leer texto</button>
        <button type="button" class="btn btn-secundario-sm" data-lc="cerrar">Escribirlo a mano</button>
      </div>
    </div>`;
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-lc]');
      if (e.target === d) { cerrar(); return; }
      if (!b) return;
      if (b.dataset.lc === 'cerrar') cerrar();
      if (b.dataset.lc === 'foto') _leerTexto();
      if (b.dataset.lc === 'usar') _usar(b.dataset.valor);
    });
    d.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
    document.body.appendChild(d);
  }

  /** Abre la cámara y escribe el lote elegido en el input `destino`. */
  async function abrir(destino) {
    if (!disponible()) { alert('Este navegador no puede usar la cámara. Escribe el lote a mano.'); return; }
    _destino = destino;
    _crearDialogo();
    const d = $('lote-cam');
    d.hidden = false;
    _abierto = true;
    $('lote-cam-opciones').innerHTML = '';
    if (typeof Navegacion !== 'undefined') Navegacion.encima(() => cerrar(true));
    _estado('Abriendo la cámara…');
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      _estado(e?.name === 'NotAllowedError'
        ? 'No hay permiso para usar la cámara. Actívalo en el candado de la barra de direcciones.'
        : 'No se ha podido abrir la cámara.', 'error');
      return;
    }
    if (!_abierto) { _pararCamara(); return; }
    const v = $('lote-cam-video');
    v.srcObject = _stream;
    try { await v.play(); } catch {}
    d.querySelector('[data-lc="foto"]')?.focus();
    await _iniciarCodigos();
  }

  async function _iniciarCodigos() {
    _detector = null;
    if ('BarcodeDetector' in window) {
      try {
        const soportados = await BarcodeDetector.getSupportedFormats();
        const quiero = ['code_128', 'data_matrix', 'qr_code', 'ean_13'].filter(f => soportados.includes(f));
        if (quiero.length) _detector = new BarcodeDetector({ formats: quiero });
      } catch { _detector = null; }
    }
    _estado(_detector
      ? 'Enfoca el código de barras o el texto del lote dentro del recuadro.'
      : 'Enfoca el texto del lote dentro del recuadro y pulsa «Leer texto».');
    if (_detector) _buscarCodigo();
  }

  let _avisoEan = false;
  function _buscarCodigo() {
    clearTimeout(_timer);
    if (!_abierto || !_detector) return;
    const v = $('lote-cam-video');
    _timer = setTimeout(async () => {
      try {
        if (v.readyState >= 2) {
          const codigos = await _detector.detect(v);
          for (const c of codigos) {
            const g = analizarGS1(c.rawValue);
            if (g?.['10']) { _usar(_limpiar(g['10']), 'código de barras'); return; }
            if (!_avisoEan && /^\d{8,14}$/.test(c.rawValue)) {
              _avisoEan = true;
              _estado('Ese código de barras es el del producto, no lleva el lote. Enfoca el texto del lote y pulsa «Leer texto».');
            }
          }
        }
      } catch { /* fotograma no válido: se sigue intentando */ }
      _buscarCodigo();
    }, 250);
  }

  function _cargarScript(src) {
    return new Promise((ok, mal) => {
      if (window.Tesseract) return ok();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => ok(); s.onerror = () => mal(new Error('No se ha podido descargar el lector de texto.'));
      document.head.appendChild(s);
    });
  }

  // Recorta lo que hay dentro del recuadro guía y lo prepara para el OCR (gris, más contraste)
  function _fotoRecuadro() {
    const v = $('lote-cam-video'), guia = document.querySelector('#lote-cam .lote-cam-guia');
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;
    const rv = v.getBoundingClientRect(), rg = guia.getBoundingClientRect();
    // El vídeo se muestra con object-fit: cover → calcular qué parte del fotograma se ve
    const k = Math.max(rv.width / vw, rv.height / vh);
    const ox = (vw * k - rv.width) / 2, oy = (vh * k - rv.height) / 2;
    const sx = Math.max(0, (rg.left - rv.left + ox) / k), sy = Math.max(0, (rg.top - rv.top + oy) / k);
    const sw = Math.min(vw - sx, rg.width / k), sh = Math.min(vh - sy, rg.height / k);
    const escala = Math.min(2, 1600 / sw);
    const c = document.createElement('canvas');
    c.width = Math.round(sw * escala); c.height = Math.round(sh * escala);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.filter = 'grayscale(1) contrast(1.6)';
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  async function _leerTexto() {
    if (!_stream) return;
    const btn = document.querySelector('#lote-cam [data-lc="foto"]');
    const foto = _fotoRecuadro();
    if (!foto) { _estado('La cámara aún no está lista. Espera un momento.', 'error'); return; }
    if (btn) btn.disabled = true;
    $('lote-cam-opciones').innerHTML = '';
    try {
      if (!_worker) {
        if (!navigator.onLine && !window.Tesseract) throw new Error('Para leer texto la primera vez hace falta conexión a internet.');
        _estado('Preparando el lector de texto (solo la primera vez, unos segundos)…');
        await _cargarScript(TESSERACT_URL);
        _worker = await window.Tesseract.createWorker('eng');
        await _worker.setParameters({ tessedit_pageseg_mode: '6' });   // bloque de texto
      }
      if (!_abierto) return;
      _estado('Leyendo…');
      const { data } = await _worker.recognize(foto);
      if (!_abierto) return;
      const cands = candidatosLote(data?.text || '');
      if (!cands.length) { _estado('No he encontrado ningún lote. Acerca más la cámara, que el texto ocupe el recuadro, y vuelve a probar.', 'error'); return; }
      _estado(cands.length === 1 ? '¿Es este el lote? Tócalo para usarlo.' : '¿Cuál es el lote? Toca el correcto.');
      $('lote-cam-opciones').innerHTML = cands.map(c =>
        `<button type="button" class="chip-lote" data-lc="usar" data-valor="${esc(c)}">${esc(c)}</button>`).join('');
      $('lote-cam-opciones').querySelector('button')?.focus();
    } catch (e) {
      _estado(e?.message || 'No se ha podido leer el texto.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function _usar(valor, origen) {
    if (!valor) return;
    if (_destino) {
      _destino.value = valor;
      _destino.dispatchEvent(new Event('input', { bubbles: true }));
    }
    cerrar();
    if (typeof aviso === 'function') aviso(`Lote ${valor}${origen ? ' (' + origen + ')' : ''}. Revísalo antes de guardar.`, { tipo: 'ok', ms: 3000 });
    _destino?.focus();
  }

  function _pararCamara() {
    clearTimeout(_timer);
    _stream?.getTracks().forEach(t => t.stop());
    _stream = null;
  }

  /** Cierra la cámara. desdeAtras = lo ha cerrado el botón «atrás» del navegador. */
  function cerrar(desdeAtras = false) {
    if (!_abierto) return;
    _abierto = false;
    _avisoEan = false;
    _pararCamara();
    const v = $('lote-cam-video');
    if (v) v.srcObject = null;
    const d = $('lote-cam');
    if (d) d.hidden = true;
    if (!desdeAtras && typeof Navegacion !== 'undefined') Navegacion.encimaCerrada();
  }

  return { abrir, cerrar, disponible, analizarGS1, candidatosLote };

})();
