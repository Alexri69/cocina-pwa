# Cocina — PWA de Gestión de Restaurante

PWA modular para cocinas profesionales con tres módulos:
Etiquetado de recipientes abiertos, Carta del restaurante y Facturas.
Cumple Reglamento UE 1169/2011 y RD 126/2015.

## Stack

- HTML5 + CSS3 + JavaScript vainilla (sin frameworks, sin build step)
- Web Speech API — idioma `es-ES`
- IndexedDB v2 — persistencia local compartida entre módulos
- Service Worker — offline completo
- Web Bluetooth API — impresión ESC/POS (etiquetas)

## Estructura de archivos

```
index.html              — Shell único con navegación de 3 pestañas
estilo.css              — Dark theme tablet-first, todos los módulos + @media print
app.js                  — Coordinador: abre BD, registra SW, gestiona navegación
manifest.json           — PWA standalone, landscape
trabajador.js           — Service Worker cache-first v2
core/
  bd.js                 — Toda la lógica IndexedDB (4 stores). Namespace: BD.*
  voz.js                — TTS, STT y utilidades. Namespace: VOZ.*
modulos/
  etiquetas.js          — Flujo de voz para etiquetado. Namespace: ModuloEtiquetas
  menu.js               — CRUD ingredientes + platos. Namespace: ModuloMenu
  facturas.js           — CRUD facturas. Namespace: ModuloFacturas
iconos/
  icono-192.png
  icono-512.png
generar-iconos.html     — Helper (ya ejecutado)
```

**Orden de carga en index.html (obligatorio):**
`core/bd.js` → `core/voz.js` → `modulos/*.js` → `app.js`

## IndexedDB — Esquema v2

| Store | Campos principales |
|---|---|
| `productos` | nombre, lote, diasCaducidad, fechaApertura, fechaCaducidad, alergenos[], timestamp |
| `ingredientes` | nombre, alergenos[], timestamp |
| `platos` | nombre, descripcion, precio, ingredientes[{id,nombre}], alergenos[], timestamp |
| `facturas` | numero, cliente, nif, fecha, lineas[], subtotal, porcentajeIva, cuotaIva, total, pagada, notas, timestamp |

Migración: v1→v2 añade ingredientes, platos y facturas sin tocar productos.

## core/bd.js — API pública (BD.*)

```js
BD.abrirBaseDeDatos()           // llamar UNA VEZ en app.js
BD.guardarProducto / obtenerProductos
BD.guardarIngrediente / actualizarIngrediente / eliminarIngrediente / obtenerIngredientes / obtenerIngrediente
BD.guardarPlato / actualizarPlato / eliminarPlato / obtenerPlatos / obtenerPlato
BD.guardarFactura / actualizarFactura / borrarFactura / obtenerFacturas / obtenerFactura
BD.siguienteNumeroFactura()     // genera "AAAA-NNNN"
```

## core/voz.js — API pública (VOZ.*)

```js
VOZ.hablar(texto)               // TTS, devuelve Promise
VOZ.escuchar()                  // STT, devuelve Promise con texto
VOZ.soportaVoz()                // true si Chrome/Edge
VOZ.palabrasANumero(texto)      // "tres" → 3
VOZ.limpiarLote(texto)          // "l dos cuatro" → "L24"
VOZ.detectarSiNo(texto)         // true / false / null
VOZ.capitalizarNombre(texto)
VOZ.formatearFecha(iso)         // "DD/MM/AAAA HH:MM"
VOZ.formatearFechaSolo(iso)     // "DD/MM/AAAA"
VOZ.calcularColorCaducidad(iso) // 'verde' / 'amarillo' / 'rojo'
```

## Navegación (app.js)

```js
navegarA('etiquetas' | 'menu' | 'facturas')
```
Persiste el módulo activo en `sessionStorage`.

## IDs del DOM por módulo

**Etiquetas:** `etq-btn-nuevo`, `etq-btn-cancelar`, `etq-btn-imprimir`, `etq-btn-historial`,
`etq-mensaje`, `etq-respuesta`, `etq-progreso-barra`, `etq-progreso-texto`, `etq-seccion-etiqueta`, `etq-preview`, `etq-lista-historial`

**Menú:** `menu-sub-platos`, `menu-sub-ingredientes`, `menu-lista-platos`, `menu-lista-ingredientes`,
`plato-nombre/desc/precio`, `plato-selector-ingredientes`, `plato-alergenos-calculados`,
`ing-nombre`, `ing-al-{nombre-con-guiones}`

**Facturas:** `fac-vista-lista/formulario/detalle`, `fac-lista`, `fac-cliente/nif/fecha/iva/direccion/notas`,
`fac-selector-platos`, `fac-lineas-body`, `fac-subtotal/cuota-iva/total`, `fac-detalle-contenido`

## Convenciones

- Todo el código comentado en español
- Sin frameworks, sin transpiladores
- Compatibilidad: Chrome y Edge (Firefox no soporta SpeechRecognition)
- Impresión etiquetas: 62mm (Brother QL) vía `@media print`
- Impresión facturas: A4 vía `@media print`

## Cómo arrancar

```bash
npx serve "c:\Mis Proyectos\Restaurante"
# → https://localhost:3000 en Chrome
```
