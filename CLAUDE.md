# Cocina — PWA de Gestión de Restaurante

PWA vainilla (HTML/CSS/JS, sin frameworks ni build) para cocinas profesionales: etiquetado de recipientes abiertos, registros sanitarios APPCC, carta (platos/ingredientes/alérgenos), bebidas y facturas/presupuestos. Cumple UE 1169/2011 y RD 126/2015.

- **Repo:** github.com/Alexri69/cocina-pwa · **Publicada en:** https://alexri69.github.io/cocina-pwa/ (GitHub Pages, se despliega al hacer push a `main`)
- **Backend:** Supabase (proyecto "Cocina-pw"), vía REST con `fetch` (sin SDK). Plan gratuito: se pausa por inactividad (ver `.github/workflows/supabase-keepalive.yml`).

## Stack
HTML5 · CSS3 · JS vainilla · Supabase (Auth + PostgREST + RLS) · Service Worker · Web Speech API (`es-ES`) · Web Bluetooth (ESC/POS) · jsPDF (local en `lib/`)

## Archivos clave
```
index.html / estilo.css / app.js / manifest.json / trabajador.js (Service Worker)
core/voz.js        — utilidades globales (dinero, r2, esc, aviso, validarNif/Email/Iban) + VOZ.*
core/supabase.js   — SB.*: auth, CRUD, caché offline, cola offline (outbox), numeración
modulos/auth.js · equipo.js · etiquetas.js · appcc.js · menu.js · bebidas.js · facturas.js · config.js · pedidos.js · jornada.js · lector-lote.js
lib/jspdf.umd.min.js — jsPDF 2.5.1 (local para que los PDF funcionen offline)
supabase-setup.sql — esquema COMPLETO e idempotente (7 tablas + RLS)
supabase/functions/recordatorio-caducidades — Edge Function de avisos push diarios
supabase/functions/traducir — Edge Function: traduce la carta ES→EN/DE con DeepL (secreto DEEPL_API_KEY; solo propietario/encargado). Sin clave devuelve codigo "sin_deepl" y el cliente usa MyMemory desde el navegador (~5.000 caracteres/día)
scripts/validate.js — validador (sintaxis + coherencia del precache del SW); lo ejecuta CI
```
**Orden de carga:** `lib/jspdf` → `core/voz.js` → `core/supabase.js` → `modulos/*.js` → `app.js`

## Restaurantes y equipo
- Los datos pertenecen a un **restaurante** (`restaurante_id`); `user_id` = quién creó la fila.
- `restaurantes`, `miembros` (rol `propietario` | `encargado` | `cocina` | `camarero`), `invitaciones` (código de 8 caracteres, 7 días, 1 uso).
- RPC: `crear_restaurante`, `crear_invitacion`, `unirse_con_codigo`, `salir_restaurante`. Trigger: siempre queda un propietario.
- RLS con `es_miembro(r)`, `rol_en(r)`, `puede_gestionar(r)`. Cocina: etiquetas, habituales, registros APPCC; lee carta/equipos/config; sin facturas. Camarero (v76): registros APPCC, fichar y leer carta; sin etiquetas, pedidos ni proveedores (`es_cocina(r)` en RLS; `data-no-camarero` en la UI; no recibe avisos de caducidad).
- Cliente: `SB.restauranteActivo()`; `_get` añade `restaurante_id=eq.<activo>` y `_post` lo inserta en las tablas de `_TABLAS_RESTAURANTE`. Caché `cocina_c_<rid>_<tabla>`; ficha/logo/impresora `cocina_*_<rid>`.
- Al entrar: `ModuloEquipo.iniciar()` (bienvenida si no hay restaurante; `?unirse=CODIGO` para invitaciones). UI por rol con `body[data-rol]` y `data-solo="gestion"`.

## Escandallos, rectificativas, lote con cámara y copias (v66)
- **Escandallos:** coste en la tabla privada `costes` (id = id del ingrediente o bebida; solo propietario/encargado): `precio_compra` € por `unidad` kg|l|ud y `merma` %; bebidas: `formato_ml` y `racion_ml` (`ModuloMenu.costeBebida`). La cocina no puede leer precios de compra; cada `platos.ingredientes[i].cantidad` en g/ml/ud por ración. Cálculo puro en `ModuloMenu.costeLinea/escandallo`. Pestaña «Escandallos» (solo gestión); objetivo de coste en la ficha (`objetivoCoste`, 30 % por defecto); impuesto de carta: IGIC 7 % o IVA 10 %.
- **Rectificativas:** `tipo='factura'`, serie propia `R-AAAA-NNNN`, columnas `rectifica_id/numero/fecha` y `motivo_rectificacion` (solo se envían si es rectificativa). Botón «Rectificar» en el detalle; al intentar borrar una factura que no es la última se ofrece rectificarla.
- **Lote con cámara:** `modulos/lector-lote.js` (`LectorLote`): BarcodeDetector para GS1 (campo 10) y Tesseract.js 5.1.1 desde jsDelivr para el texto (se descarga al primer uso). Siempre se confirma el valor. «Atrás» la cierra con `Navegacion.encima()`.
- **Copias:** tabla `copias_seguridad` (solo lectura para gestión); `crear_copias_semanales()` por pg_cron los lunes 03:00 UTC (8 automáticas + 5 manuales, sin duplicar si nada cambió); RPC `crear_copia_ahora(r)`. El archivo de copia incluye ahora APPCC.

## Idiomas, pedidos y jornada (v68)
- **Carta en idiomas:** `platos.traducciones` / `bebidas.traducciones` = { en: { nombre, descripcion }, de: {…} }. La carta pública elige idioma (?l=en|de, el del móvil o el guardado) y traduce alérgenos y categorías.
- **Proveedores y pedidos** (`modulos/pedidos.js`): tablas `proveedores` (escribe la dirección, lee todo el equipo) y `pedidos` (todo el equipo). `ingredientes.proveedor_id`. Envío por WhatsApp/email; al recibir, la dirección puede actualizar precios (→ escandallos).
- **Registro de jornada** (`modulos/jornada.js`): tabla `fichajes` sin escritura directa; RPC `fichar(r)` (hora del servidor, alterna entrada/salida), `corregir_fichaje` y `crear_fichaje` (dirección, con motivo; guardan el historial en `correcciones`). Cada uno ve lo suyo; la dirección, todo. Las copias incluyen los fichajes pero no se restauran.

## Averías y plano del local (v77)
- **Averías:** `appcc_elementos.averiado_desde` (null = funciona). Interruptor «Funciona/Averiado» en APPCC → Hoy, para todo el equipo, vía RPC `marcar_averia(elemento, averiado, accion, responsable)` (pide acción correctora al apagarlo; necesita red). Deja un registro con `datos.averia = 'inicio'|'fin'` (no cuenta como lectura ni se puede borrar). Averiado ⇒ no pide lecturas ni cuenta como pendiente; en el informe sus días no son «sin registro».
- **Plano:** pestaña APPCC → Plano: cuadrado dividido en Cocina | Barra. `appcc_elementos.plano` = { x, y } en % (null = sin colocar); lo coloca la dirección (arrastrar / tocar), el resto solo lo ve. Color del equipo según su estado de hoy.

## Carta pública (QR)
- `carta.html?c=<token>` + `modulos/carta-publica.js`: página sin login; lee con la RPC `carta_publica(token)` (anon). Solo nombre, descripción, precio y alérgenos.
- `restaurantes.carta_token` (32 hex, null = no publicada). RPC `publicar_carta(r, renovar)` / `despublicar_carta(r)` (propietario/encargado). Panel en Carta: `modulos/cartaqr.js` (QR con `lib/qrcode.min.js`).
- `bebidas.alergenos` (los platos los calculan de sus ingredientes).

## Tablas Supabase (todas con RLS por restaurante)
`productos`, `plantillas_etiqueta` (productos habituales, nombre único por usuario), `appcc_elementos` (equipos de frío, freidoras, tareas de limpieza) y `appcc_registros` (lecturas/limpiezas/recepciones; snake_case también en el JS), `ingredientes`, `platos`, `bebidas`, `facturas` (facturas y presupuestos, columna `tipo`), `config` (1 fila por usuario), `push_subscriptions`.
Cambios de esquema: editar `supabase-setup.sql` y aplicarlo con la Management API (token en `.env`, nunca versionado).
El JS usa camelCase y la BD snake_case: conversión en `_productoDeBD/_productoParaBD` y `_facturaDeBD/_facturaParaBD`.
Si se añade una columna nueva: añadirla a `supabase-setup.sql` (ADD COLUMN IF NOT EXISTS) y, si se envía desde el cliente antes de migrar, a `_COLUMNAS_NUEVAS` en `core/supabase.js`.

## Offline
- Lecturas: caché en localStorage (`cocina_c_<tabla>`), usada solo ante fallo de red.
- Escrituras sin red: cola `cocina_outbox` (se sincroniza al volver la red). Lo que el servidor rechace va a `cocina_outbox_errores` y se avisa al usuario.
- Sesión caducada sin red: se entra igual (`SB.tieneSesion()`); el token se renueva al volver la red.
- Numeración de facturas offline: se calcula con la caché local.

## Reglas de negocio
- APPCC: cada restaurante elige modo (`appccModo` en la ficha de empresa: `completo` | `incidencias`) y frecuencia por equipo/tarea (`dos_al_dia` | `diaria` | `semanal` | `mensual`). Lectura fuera de rango o recepción rechazada ⇒ acción correctora obligatoria. Responsable obligatorio (se recuerda por dispositivo). Los registros solo se pueden borrar durante 24 h. Informe mensual imprimible (A4 apaisado) con días sin registro desde el alta de cada equipo.
- Importes de factura redondeados a céntimos con `r2()` (base = Σ líneas; cuotas sobre la base; total = base + IGIC − IRPF).
- Facturas: numeración correlativa por año de la fecha (`AAAA-NNNN`, presupuestos `PRES-AAAA-NNNN`). Solo se puede borrar la última; editar una emitida pide confirmación (lo correcto es rectificativa).
- Régimen IGIC (Canarias, por defecto) o IVA, configurable en Configuración.

## Convenciones
- Código, comentarios y textos en español.
- Chrome/Edge (Firefox no tiene SpeechRecognition).
- Etiquetas: 62 mm Brother QL · Facturas: A4.
- Escapar SIEMPRE con `esc()`/`_esc()` cualquier dato al meterlo en `innerHTML`; en `onclick` pasar solo ids.
- **Al cambiar cualquier JS o CSS:** subir `?v=N` en `index.html` Y en `trabajador.js` (y `NOMBRE_CACHE`). `node scripts/validate.js` lo comprueba.

## Arrancar en local
```bash
cd "D:\Proyectos\Cocina" && python -m http.server 8765   # → http://localhost:8765 en Chrome
node scripts/validate.js                                  # antes de hacer push
node scripts/iconos.js                                    # tras añadir un icono a iconos/lucide/
```
