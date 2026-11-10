#!/usr/bin/env node
// Genera el «sprite» de iconos (Lucide, licencia ISC) dentro de index.html.
// Los SVG originales están en iconos/lucide/*.svg. Para añadir uno:
//   1. Descarga https://cdn.jsdelivr.net/npm/lucide-static@1.55.0/icons/<nombre>.svg a iconos/lucide/
//   2. node scripts/iconos.js
//   3. Úsalo con <svg class="ic"><use href="#i-<nombre>"/></svg>  (o icono('<nombre>') desde JS)

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'iconos', 'lucide');
const INDEX = path.join(ROOT, 'index.html');
const INI = '<!-- ICONOS:INICIO (generado por scripts/iconos.js; no editar a mano) -->';
const FIN = '<!-- ICONOS:FIN -->';

const simbolos = fs.readdirSync(DIR).filter(f => f.endsWith('.svg')).sort().map(f => {
  const svg = fs.readFileSync(path.join(DIR, f), 'utf8');
  const interior = (svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/) || [])[1];
  if (!interior) throw new Error(`SVG sin contenido: ${f}`);
  const limpio = interior.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
  return `<symbol id="i-${f.replace(/\.svg$/, '')}" viewBox="0 0 24 24">${limpio}</symbol>`;
});

const bloque = `${INI}\n  <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">\n    ${simbolos.join('\n    ')}\n  </svg>\n  ${FIN}`;
let html = fs.readFileSync(INDEX, 'utf8');
if (html.includes(INI)) {
  html = html.replace(new RegExp(`${INI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${FIN}`), bloque);
} else {
  html = html.replace(/<body>\n?/, `<body>\n  ${bloque}\n`);
}
fs.writeFileSync(INDEX, html);
console.log(`✅ ${simbolos.length} iconos en index.html`);
