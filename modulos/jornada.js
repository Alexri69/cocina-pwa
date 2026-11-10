// ============================================================
// modulos/jornada.js — Registro de jornada (fichar entrada y salida)
//   · Cada persona ficha desde su móvil; la hora la pone el servidor.
//   · Propietario y encargado ven el registro de todo el equipo, lo imprimen o
//     exportan, y pueden corregir o añadir fichajes indicando el motivo.
//   · Obligatorio (art. 34.9 del Estatuto de los Trabajadores): conservar 4 años.
// Depende de: core/supabase.js, core/voz.js (esc, aviso, Navegacion)
// ============================================================

const ModuloJornada = (() => {

  const $ = id => document.getElementById(id);
  let _abierto = null;          // mi fichaje abierto
  let _mes = '';                // 'AAAA-MM' que se está viendo
  let _misFichajes = [], _equipo = [], _miembros = [];
  let _reloj = null, _editando = null, _miNombre = '';

  // ----------------------------------------------------------
  // FUNCIONES PURAS (se prueban aparte)
  // ----------------------------------------------------------

  /** Milisegundos trabajados en un fichaje (si sigue abierto, hasta `ahora`). */
  const duracion = (f, ahora = Date.now()) => Math.max(0, (f.salida ? new Date(f.salida).getTime() : ahora) - new Date(f.entrada).getTime());

  /** «7 h 05 min» */
  function horasTexto(ms) {
    const min = Math.round(ms / 60000);
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
  }
  /** Horas decimales con coma (para CSV / informes): 7,08 */
  const horasDecimal = ms => (Math.round(ms / 36000) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** Resumen por persona: [{ user_id, nombre, dias, ms, abiertos, fichajes[] }], ordenado por nombre. */
  function resumenPorPersona(fichajes, ahora = Date.now()) {
    const porUser = new Map();
    for (const f of fichajes || []) {
      const r = porUser.get(f.user_id) || { user_id: f.user_id, nombre: f.nombre || 'Sin nombre', dias: new Set(), ms: 0, abiertos: 0, fichajes: [] };
      r.dias.add(_diaLocal(f.entrada));
      r.ms += duracion(f, ahora);
      if (!f.salida) r.abiertos++;
      r.fichajes.push(f);
      porUser.set(f.user_id, r);
    }
    return [...porUser.values()].map(r => ({ ...r, dias: r.dias.size }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  }
  const _diaLocal = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  /** Primer instante del mes y del siguiente (ISO), para 'AAAA-MM'. */
  function rangoMes(mes) {
    const [a, m] = mes.split('-').map(Number);
    return [new Date(a, m - 1, 1).toISOString(), new Date(a, m, 1).toISOString()];
  }

  const _hora = iso => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const _fecha = iso => new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const _mesActual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const _nombreMes = mes => { const [a, m] = mes.split('-').map(Number); return new Date(a, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); };
  // valor para <input type="datetime-local"> en hora local
  const _local = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  // ----------------------------------------------------------
  // FICHAR (tarjeta del inicio y del módulo)
  // ----------------------------------------------------------

  function _pintarEstado() {
    const html = _htmlEstado();
    ['dash-fichaje', 'jor-estado'].forEach(id => { const el = $(id); if (el) el.innerHTML = html; });
    clearInterval(_reloj);
    if (_abierto) _reloj = setInterval(() => {
      document.querySelectorAll('[data-jor-tiempo]').forEach(el => { el.textContent = horasTexto(duracion(_abierto)); });
    }, 30000);
  }

  function _htmlEstado() {
    const sinNombre = !_miNombre || _miNombre.includes('@');
    if (_abierto) {
      const largo = duracion(_abierto) > 14 * 3600000;
      return `<div class="fichaje ${largo ? 'largo' : 'dentro'}">
        <div class="fichaje-txt">
          <strong>Trabajando desde las ${_hora(_abierto.entrada)}</strong>
          <span><span data-jor-tiempo>${horasTexto(duracion(_abierto))}</span>${new Date(_abierto.entrada).toDateString() !== new Date().toDateString() ? ' · desde el ' + _fecha(_abierto.entrada) : ''}</span>
          ${largo ? '<small>¿Se te olvidó fichar la salida? Ficha ahora y pide al encargado que corrija la hora.</small>' : ''}
        </div>
        <button type="button" class="btn btn-fichar salida" data-fichar><svg class="ic" aria-hidden="true"><use href="#i-log-out"/></svg> Fichar salida</button>
      </div>`;
    }
    return `<div class="fichaje fuera">
      <div class="fichaje-txt"><strong>No has fichado</strong><span>Ficha al empezar tu turno.</span>
        ${sinNombre ? '<small>Pon tu nombre en Config → «Mi nombre en el equipo» para que salga en el registro.</small>' : ''}</div>
      <button type="button" class="btn btn-fichar entrada" data-fichar><svg class="ic" aria-hidden="true"><use href="#i-log-in"/></svg> Fichar entrada</button>
    </div>`;
  }

  let _fichando = false;
  async function _fichar(btn) {
    if (_fichando) return;
    _fichando = true;
    if (btn) btn.disabled = true;
    try {
      const f = await SB.fichar();
      _abierto = f && !f.salida ? f : null;
      aviso(f?.salida ? `✔ Salida a las ${_hora(f.salida)} · ${horasTexto(duracion(f))}` : `✔ Entrada a las ${_hora(f.entrada)}`, { tipo: 'ok', ms: 3500 });
      _pintarEstado();
      await _cargarMes();
    } catch (e) {
      aviso(e.message || 'No se ha podido fichar.', { tipo: 'error', ms: 6000 });
    } finally {
      _fichando = false;
      if (btn) btn.disabled = false;
    }
  }

  // ----------------------------------------------------------
  // MIS FICHAJES Y REGISTRO DEL EQUIPO
  // ----------------------------------------------------------

  async function _cargarMes() {
    const [desde, hasta] = rangoMes(_mes);
    try {
      _misFichajes = await SB.obtenerFichajes(desde, hasta, { soloMios: true });
      _equipo = SB.puedeGestionar() ? await SB.obtenerFichajes(desde, hasta) : [];
    } catch (e) {
      const c = $('jor-mios'); if (c) c.innerHTML = `<p class="texto-vacio">${navigator.onLine ? 'No se ha podido cargar el registro.' : 'Sin conexión.'}</p>`;
      return;
    }
    _pintarMios();
    _pintarEquipo();
  }

  function _filasFichajes(lista, { corregir = false } = {}) {
    if (!lista.length) return '<p class="texto-vacio">Sin fichajes este mes.</p>';
    return `<div class="jor-tabla" role="table">${lista.map(f => `
      <div class="jor-fila${f.salida ? '' : ' abierta'}" role="row">
        <span role="cell" class="jor-dia">${_fecha(f.entrada)}</span>
        <span role="cell" class="jor-horas">${_hora(f.entrada)} – ${f.salida ? _hora(f.salida) : '<em>abierto</em>'}</span>
        <span role="cell" class="jor-total">${horasTexto(duracion(f))}</span>
        <span role="cell" class="jor-marcas">${(f.correcciones || []).length ? `<span class="jor-corr" title="${esc((f.correcciones || []).map(c => c.motivo).join(' · '))}">${f.origen === 'manual' ? 'añadido' : 'corregido'}</span>` : ''}
          ${corregir ? `<button type="button" class="btn-mini" data-corregir="${esc(f.id)}" aria-label="Corregir fichaje del ${_fecha(f.entrada)}"><svg class="ic" aria-hidden="true"><use href="#i-pencil"/></svg></button>` : ''}</span>
      </div>`).join('')}</div>`;
  }

  function _pintarMios() {
    const c = $('jor-mios');
    if (!c) return;
    const total = _misFichajes.reduce((s, f) => s + duracion(f), 0);
    const dias = new Set(_misFichajes.map(f => _diaLocal(f.entrada))).size;
    c.innerHTML = `<p class="jor-total-mes"><strong>${horasTexto(total)}</strong> en ${dias} día${dias === 1 ? '' : 's'} · ${_nombreMes(_mes)}</p>
      ${_filasFichajes(_misFichajes.slice().reverse())}`;
  }

  function _pintarEquipo() {
    const c = $('jor-equipo');
    if (!c || !SB.puedeGestionar()) return;
    const res = resumenPorPersona(_equipo);
    if (!res.length) { c.innerHTML = `<p class="texto-vacio">Nadie ha fichado en ${_nombreMes(_mes)}.</p>`; return; }
    c.innerHTML = res.map(r => `
      <details class="jor-persona">
        <summary>
          <span class="jor-persona-nombre">${esc(r.nombre)}${r.abiertos ? ' <span class="jor-dentro">trabajando</span>' : ''}</span>
          <span class="jor-persona-datos">${r.dias} día${r.dias === 1 ? '' : 's'} · <strong>${horasTexto(r.ms)}</strong></span>
        </summary>
        ${_filasFichajes(r.fichajes.slice().reverse(), { corregir: true })}
      </details>`).join('');
  }

  // ---------- Corregir / añadir ----------
  async function _abrirEditor(f = null) {
    _editando = f;
    const ed = $('jor-editor');
    if (!f && !_miembros.length) { try { _miembros = await SB.obtenerMiembros(); } catch {} }
    $('jor-ed-titulo').textContent = f ? `Corregir fichaje de ${f.nombre}` : 'Añadir un fichaje olvidado';
    $('jor-ed-persona-grupo').hidden = !!f;
    $('jor-ed-persona').innerHTML = _miembros.map(m => `<option value="${esc(m.user_id)}">${esc(m.nombre || m.email || 'Sin nombre')}</option>`).join('');
    $('jor-ed-entrada').value = f ? _local(f.entrada) : '';
    $('jor-ed-salida').value = f ? _local(f.salida) : '';
    $('jor-ed-motivo').value = '';
    $('jor-ed-historial').innerHTML = f && (f.correcciones || []).length
      ? '<strong>Cambios anteriores:</strong><ul>' + f.correcciones.map(c => `<li>${new Date(c.cuando).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(c.quien || '')}: ${esc(c.motivo || '')}${c.entrada_antes ? ` (antes ${_hora(c.entrada_antes)}–${c.salida_antes ? _hora(c.salida_antes) : 'abierto'})` : ''}</li>`).join('') + '</ul>'
      : '';
    ed.hidden = false;
    Navegacion.encima(() => _cerrarEditor(true));
    $(f ? 'jor-ed-entrada' : 'jor-ed-persona').focus();
  }
  function _cerrarEditor(desdeAtras = false) {
    const ed = $('jor-editor');
    if (!ed || ed.hidden) return;
    ed.hidden = true;
    _editando = null;
    if (!desdeAtras) Navegacion.encimaCerrada();
  }
  async function _guardarEditor() {
    const ent = $('jor-ed-entrada').value, sal = $('jor-ed-salida').value, motivo = $('jor-ed-motivo').value.trim();
    if (!ent) { alert('Indica la hora de entrada.'); return; }
    if (!motivo) { alert('Indica el motivo (queda registrado junto al cambio).'); return; }
    const entrada = new Date(ent).toISOString(), salida = sal ? new Date(sal).toISOString() : null;
    if (salida && salida <= entrada) { alert('La salida tiene que ser posterior a la entrada.'); return; }
    const btn = $('jor-ed-guardar'); btn.disabled = true;
    try {
      if (_editando) await SB.corregirFichaje(_editando.id, entrada, salida, motivo);
      else await SB.crearFichaje($('jor-ed-persona').value, entrada, salida, motivo);
      aviso('✔ Registro actualizado.', { tipo: 'ok', ms: 2500 });
      _cerrarEditor();
      _abierto = await SB.miFichajeAbierto().catch(() => _abierto);
      _pintarEstado();
      await _cargarMes();
    } catch (e) { aviso(e.message, { tipo: 'error', ms: 6000 }); }
    finally { btn.disabled = false; }
  }

  // ---------- Imprimir y exportar ----------
  function _imprimir() {
    const res = resumenPorPersona(_equipo);
    if (!res.length) { alert('No hay fichajes en este mes.'); return; }
    const win = window.open('', '_blank', 'width=900,height=900');
    if (!win) { alert('El navegador bloqueó la ventana emergente.\nPermite ventanas emergentes para esta página.'); return; }
    const cfg = (typeof ModuloConfig !== 'undefined') ? ModuloConfig.obtenerConfig() : {};
    const empresa = cfg.razonSocial || SB.restauranteActivo()?.nombre || '';
    const paginas = res.map(r => `<section class="hoja">
      <h1>Registro de jornada · ${esc(_nombreMes(_mes))}</h1>
      <div class="datos"><div><b>Empresa:</b> ${esc(empresa)}${cfg.nif ? ' · NIF ' + esc(cfg.nif) : ''}</div><div><b>Trabajador/a:</b> ${esc(r.nombre)}</div></div>
      <table><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th class="n">Horas</th><th>Observaciones</th></tr></thead><tbody>
      ${r.fichajes.map(f => `<tr><td>${new Date(f.entrada).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
        <td>${_hora(f.entrada)}</td><td>${f.salida ? _hora(f.salida) : '—'}</td><td class="n">${horasDecimal(duracion(f))}</td>
        <td>${(f.correcciones || []).map(c => esc(c.motivo)).join('; ')}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3"><b>Total del mes</b> (${r.dias} días)</td><td class="n"><b>${horasDecimal(r.ms)}</b></td><td></td></tr></tfoot></table>
      <div class="firmas"><div>Firma de la empresa</div><div>Firma del trabajador/a</div></div>
      <p class="pie">Registro diario de jornada conforme al art. 34.9 del Estatuto de los Trabajadores. Se conserva durante cuatro años.</p>
    </section>`).join('');
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Registro de jornada ${esc(_mes)}</title>
<style>
@page { size: A4; margin: 14mm; }
body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 10pt; margin: 0; }
.hoja { page-break-after: always; } .hoja:last-child { page-break-after: auto; }
h1 { font-size: 14pt; margin: 0 0 3mm; } .datos { display: flex; justify-content: space-between; gap: 6mm; margin-bottom: 4mm; flex-wrap: wrap; }
table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #bbb; padding: 1.4mm 2mm; text-align: left; }
th { background: #f0f0f0; font-size: 9pt; } .n { text-align: right; white-space: nowrap; } tfoot td { background: #f7f7f7; }
.firmas { display: flex; justify-content: space-between; gap: 20mm; margin-top: 18mm; } .firmas div { flex: 1; border-top: 1px solid #333; padding-top: 2mm; font-size: 9pt; }
.pie { font-size: 8pt; color: #666; margin-top: 8mm; }
</style></head><body>${paginas}<script>setTimeout(function(){ window.print(); }, 400);<\/script></body></html>`);
    win.document.close();
  }

  function _csv() {
    if (!_equipo.length) { alert('No hay fichajes en este mes.'); return; }
    const filas = [['Trabajador', 'Fecha', 'Entrada', 'Salida', 'Horas', 'Origen', 'Correcciones']];
    for (const f of _equipo) filas.push([
      (f.nombre || '').replace(/;/g, ','), new Date(f.entrada).toLocaleDateString('es-ES'), _hora(f.entrada), f.salida ? _hora(f.salida) : '',
      horasDecimal(duracion(f)), f.origen, (f.correcciones || []).map(c => c.motivo).join(' / ').replace(/;/g, ','),
    ]);
    const blob = new Blob(['﻿' + filas.map(r => r.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `registro-jornada-${_mes}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ----------------------------------------------------------
  // INICIO
  // ----------------------------------------------------------

  async function init() {
    _mes = _mesActual();
    const inpMes = $('jor-mes');
    if (inpMes) { inpMes.value = _mes; inpMes.max = _mes; }
    // Fichar desde el inicio o desde el módulo
    document.addEventListener('click', e => { const b = e.target.closest('[data-fichar]'); if (b) _fichar(b); });
    inpMes?.addEventListener('change', () => { if (/^\d{4}-\d{2}$/.test(inpMes.value)) { _mes = inpMes.value; _cargarMes(); } });
    $('jor-imprimir')?.addEventListener('click', _imprimir);
    $('jor-csv')?.addEventListener('click', _csv);
    $('jor-anadir')?.addEventListener('click', () => _abrirEditor(null));
    $('jor-equipo')?.addEventListener('click', e => {
      const b = e.target.closest('[data-corregir]'); if (!b) return;
      const f = _equipo.find(x => x.id === b.dataset.corregir); if (f) _abrirEditor(f);
    });
    $('jor-ed-guardar')?.addEventListener('click', _guardarEditor);
    $('jor-ed-cancelar')?.addEventListener('click', () => _cerrarEditor());
    $('jor-editor')?.addEventListener('click', e => { if (e.target.id === 'jor-editor') _cerrarEditor(); });
    $('jor-editor')?.addEventListener('keydown', e => { if (e.key === 'Escape') _cerrarEditor(); });
    // Al volver a la app (desbloquear el móvil) se refresca el estado
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') return;
      try { _abierto = await SB.miFichajeAbierto(); _pintarEstado(); } catch {}
    });

    try { _miNombre = await SB.miNombre(); } catch {}
    try { _abierto = await SB.miFichajeAbierto(); } catch { _abierto = null; }
    _pintarEstado();
    await _cargarMes();
  }

  return { init, duracion, horasTexto, horasDecimal, resumenPorPersona, rangoMes };

})();
