# Cocina — PWA de Gestión de Restaurante

PWA vainilla (HTML/CSS/JS, sin frameworks ni build) para cocinas profesionales: etiquetado de recipientes abiertos, carta (platos/ingredientes/alérgenos), bebidas y facturas/presupuestos. Cumple UE 1169/2011 y RD 126/2015.

- **Repo:** github.com/Alexri69/cocina-pwa · **Publicada en:** https://alexri69.github.io/cocina-pwa/ (GitHub Pages, se despliega al hacer push a `main`)
- **Backend:** Supabase (proyecto "Cocina-pw"), vía REST con `fetch` (sin SDK). Plan gratuito: se pausa por inactividad (ver `.github/workflows/supabase-keepalive.yml`).

## Stack
HTML5 · CSS3 · JS vainilla · Supabase (Auth + PostgREST + RLS) · Service Worker · Web Speech API (`es-ES`) · Web Bluetooth (ESC/POS) · jsPDF (local en `lib/`)

## Archivos clave
```
index.html / estilo.css / app.js / manifest.json / trabajador.js (Service Worker)
core/voz.js        — utilidades globales (dinero, r2, esc, aviso, validarNif/Email/Iban) + VOZ.*
core/supabase.js   — SB.*: auth, CRUD, caché offline, cola offline (outbox), numeración
modulos/auth.js · etiquetas.js · menu.js · bebidas.js · facturas.js · config.js
lib/jspdf.umd.min.js — jsPDF 2.5.1 (local para que los PDF funcionen offline)
supabase-setup.sql — esquema COMPLETO e idempotente (7 tablas + RLS)
supabase/functions/recordatorio-caducidades — Edge Function de avisos push diarios
scripts/validate.js — validador (sintaxis + coherencia del precache del SW); lo ejecuta CI
```
**Orden de carga:** `lib/jspdf` → `core/voz.js` → `core/supabase.js` → `modulos/*.js` → `app.js`

## Tablas Supabase (todas con RLS "solo_propietario" por `user_id`)
`productos`, `ingredientes`, `platos`, `bebidas`, `facturas` (facturas y presupuestos, columna `tipo`), `config` (1 fila por usuario), `push_subscriptions`.
El JS usa camelCase y la BD snake_case: conversión en `_productoDeBD/_productoParaBD` y `_facturaDeBD/_facturaParaBD`.
Si se añade una columna nueva: añadirla a `supabase-setup.sql` (ADD COLUMN IF NOT EXISTS) y, si se envía desde el cliente antes de migrar, a `_COLUMNAS_NUEVAS` en `core/supabase.js`.

## Offline
- Lecturas: caché en localStorage (`cocina_c_<tabla>`), usada solo ante fallo de red.
- Escrituras sin red: cola `cocina_outbox` (se sincroniza al volver la red). Lo que el servidor rechace va a `cocina_outbox_errores` y se avisa al usuario.
- Sesión caducada sin red: se entra igual (`SB.tieneSesion()`); el token se renueva al volver la red.
- Numeración de facturas offline: se calcula con la caché local.

## Reglas de negocio
- Importes de factura redondeados a céntimos con `r2()` (base = Σ líneas; cuotas sobre la base; total = base + IGIC − IRPF).
- Facturas: numeración correlativa por año de la fecha (`AAAA-NNNN`, presupuestos `PRES-AAAA-NNNN`). Solo se puede borrar la última; editar una emitida pide confirmación (lo correcto es rectificativa).
- Régimen IGIC (Canarias, por defecto) o IVA, configurable en Configuración.

## Convenciones
- Código, comentarios y textos en español.
- Chrome/Edge (Firefox no tiene SpeechRecognition).
- Etiquetas: 62 mm Brother QL · Facturas: A4.
- Escapar SIEMPRE con `esc()`/`_esc()` cualquier dato al meterlo en `innerHTML`; en `onclick` pasar solo ids.
- **Al cambiar cualquier JS:** subir `?v=N` en `index.html` Y en `trabajador.js` (y `NOMBRE_CACHE`). `node scripts/validate.js` lo comprueba.

## Arrancar en local
```bash
cd "D:\Proyectos\Cocina" && python -m http.server 8765   # → http://localhost:8765 en Chrome
node scripts/validate.js                                  # antes de hacer push
```
