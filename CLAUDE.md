# Cocina — PWA de Gestión de Restaurante

PWA vainilla (HTML/CSS/JS, sin frameworks) para cocinas profesionales. Tres módulos: etiquetado, carta y facturas. Cumple UE 1169/2011 y RD 126/2015.

## Stack
HTML5 · CSS3 · JS vainilla · Web Speech API (`es-ES`) · IndexedDB v2 · Service Worker · Web Bluetooth (ESC/POS)

## Archivos clave
```
index.html / estilo.css / app.js / manifest.json / trabajador.js
core/bd.js        — IndexedDB, namespace BD.*
core/voz.js       — TTS/STT/utils, namespace VOZ.*
modulos/etiquetas.js · menu.js · facturas.js
```
**Orden de carga:** `core/bd.js` → `core/voz.js` → `modulos/*.js` → `app.js`

## IndexedDB v2 — stores
- `productos` — nombre, lote, diasCaducidad, fechaApertura, fechaCaducidad, alergenos[], timestamp
- `ingredientes` — nombre, alergenos[], timestamp
- `platos` — nombre, descripcion, precio, ingredientes[{id,nombre}], alergenos[], timestamp
- `facturas` — numero, cliente, nif, fecha, lineas[], subtotal, porcentajeIva, cuotaIva, total, pagada, notas, timestamp

## APIs públicas

**BD.*** — `abrirBaseDeDatos()` (una vez en app.js), `guardar/obtener/actualizar/eliminar` por entidad, `siguienteNumeroFactura()` → "AAAA-NNNN"

**VOZ.*** — `hablar(texto)`, `escuchar()`, `soportaVoz()`, `palabrasANumero()`, `limpiarLote()`, `detectarSiNo()`, `capitalizarNombre()`, `formatearFecha/FechaSolo()`, `calcularColorCaducidad()`

**Navegación:** `navegarA('etiquetas'|'menu'|'facturas')` — persiste en sessionStorage

## Convenciones
- Código y comentarios en español
- Chrome/Edge únicamente (Firefox sin SpeechRecognition)
- Etiquetas: 62mm Brother QL · Facturas: A4 — ambos vía `@media print`

## Arrancar
```bash
npx serve "c:\Mis Proyectos\Restaurante"   # → http://localhost:3000 en Chrome
```
