// ============================================================
// modulos/cartaqr.js — Publicar la carta de alérgenos con un QR
// Panel en el módulo Carta (solo propietario / encargado).
// Depende de: core/supabase.js, core/voz.js (esc, aviso), lib/qrcode.min.js
// ============================================================

const ModuloCartaQR = (() => {

  const BASE_URL = new URL('carta.html', location.href.split('?')[0].replace(/[^/]*$/, '')).href;
  let _token = null;
  let _abierto = false;
  const $ = id => document.getElementById(id);

  const enlace = () => _token ? `${BASE_URL}?c=${_token}` : '';

  function _svgQR(texto, celda = 6) {
    if (typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M');
    q.addData(texto);
    q.make();
    return q.createSvgTag({ cellSize: celda, margin: 2, scalable: true });
  }

  function _render() {
    const cont = $('carta-qr');
    if (!cont) return;
    if (!SB.puedeGestionar()) { cont.innerHTML = ''; return; }
    const pub = !!_token;
    cont.innerHTML = `<div class="tarjeta carta-qr-tarjeta">
      <button type="button" class="carta-qr-cab" data-cq="abrir" aria-expanded="${_abierto}">
        <span>📱 <strong>Carta de alérgenos para clientes</strong></span>
        <span class="carta-qr-estado ${pub ? 'on' : 'off'}">${pub ? 'Publicada' : 'Sin publicar'}</span>
      </button>
      ${_abierto ? (pub ? `
        <div class="carta-qr-cuerpo">
          <div class="carta-qr-img" aria-label="Código QR de la carta">${_svgQR(enlace())}</div>
          <div class="carta-qr-info">
            <p>Los clientes escanean este código y ven vuestros platos y bebidas con sus alérgenos, y pueden filtrar (por ejemplo, <em>sin gluten</em>). Se actualiza sola al cambiar la carta.</p>
            <input class="inp carta-qr-enlace" readonly value="${esc(enlace())}" aria-label="Enlace de la carta pública">
            <div class="form-acciones">
              <a class="btn btn-primario-sm" href="${esc(enlace())}" target="_blank" rel="noopener">👁 Ver carta</a>
              <button class="btn btn-secundario-sm" type="button" data-cq="imprimir">🖨 Imprimir QR para mesas</button>
              <button class="btn btn-secundario-sm" type="button" data-cq="copiar">📋 Copiar enlace</button>
            </div>
            <div class="carta-qr-peligro">
              <button class="btn-mini" type="button" data-cq="renovar" title="El enlace y los QR impresos anteriores dejarán de funcionar">🔄 Cambiar enlace</button>
              <button class="btn-mini btn-borrar" type="button" data-cq="despublicar">Dejar de publicar</button>
            </div>
          </div>
        </div>` : `
        <div class="carta-qr-cuerpo carta-qr-vacia">
          <p>Publica la carta en un enlace con código QR para que los clientes consulten los <strong>alérgenos</strong> de cada plato y bebida desde el móvil (Reglamento UE 1169/2011).</p>
          <p class="appcc-nota">Solo se muestra nombre, descripción, precio y alérgenos. Revisa antes que todos los platos tengan sus ingredientes y las bebidas sus alérgenos.</p>
          <div class="form-acciones"><button class="btn btn-primario-sm" type="button" data-cq="publicar">📱 Publicar carta</button></div>
        </div>`) : ''}
    </div>`;
  }

  function _imprimir() {
    const act = SB.restauranteActivo();
    const cfg = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const nombre = cfg.razonSocial || act?.nombre || 'Carta';
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) { alert('El navegador bloqueó la ventana emergente.\nPermite ventanas emergentes para esta página.'); return; }
    const tarjeta = `<div class="t"><div class="n">${esc(nombre)}</div>${_svgQR(enlace(), 8)}<div class="c">Carta y alérgenos</div><div class="s">Escanea con la cámara del móvil</div></div>`;
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>QR carta — ${esc(nombre)}</title>
<style>
@page { size: A4; margin: 10mm; }
body { font-family: Arial, Helvetica, sans-serif; margin: 0; }
.hoja { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
.t { border: 1px dashed #999; border-radius: 4mm; padding: 6mm; text-align: center; page-break-inside: avoid; }
.t svg { width: 55mm; height: 55mm; }
.n { font-size: 15pt; font-weight: 700; margin-bottom: 3mm; }
.c { font-size: 13pt; font-weight: 700; margin-top: 2mm; }
.s { font-size: 9pt; color: #555; margin-top: 1mm; }
</style></head><body><div class="hoja">${tarjeta.repeat(4)}</div>
<script>setTimeout(function(){ window.print(); }, 300);<\/script></body></html>`);
    win.document.close();
  }

  async function _accion(b) {
    const a = b.dataset.cq;
    try {
      if (a === 'abrir') { _abierto = !_abierto; _render(); return; }
      if (a === 'publicar') { b.disabled = true; _token = await SB.publicarCarta(false); aviso('✔ Carta publicada.', { tipo: 'ok', ms: 2500 }); }
      if (a === 'renovar') {
        if (!confirm('¿Cambiar el enlace de la carta?\n\nEl enlace actual y los QR ya impresos dejarán de funcionar. Tendrás que imprimir los nuevos.')) return;
        _token = await SB.publicarCarta(true);
        aviso('✔ Enlace cambiado. Imprime los QR nuevos.', { tipo: 'ok', ms: 4000 });
      }
      if (a === 'despublicar') {
        if (!confirm('¿Dejar de publicar la carta?\n\nLos QR impresos dejarán de funcionar.')) return;
        await SB.despublicarCarta();
        _token = null;
      }
      if (a === 'copiar') {
        try { await navigator.clipboard.writeText(enlace()); aviso('📋 Enlace copiado.', { tipo: 'ok', ms: 2000 }); }
        catch { prompt('Copia el enlace:', enlace()); }
        return;
      }
      if (a === 'imprimir') { _imprimir(); return; }
      _render();
    } catch (e) {
      b.disabled = false;
      aviso(e.message || String(e), { tipo: 'error', ms: 6000 });
    }
  }

  async function init() {
    $('carta-qr')?.addEventListener('click', e => { const b = e.target.closest('[data-cq]'); if (b) _accion(b); });
    if (!SB.puedeGestionar()) return;
    try { _token = await SB.estadoCarta(); } catch { _token = null; }
    _render();
  }

  return { init };

})();
