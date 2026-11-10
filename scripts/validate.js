#!/usr/bin/env node
// Validador de sintaxis previo al despliegue (PWA Cocina).
// Compila cada .js con vm.Script y cada <script> inline de los .html.
// Uso: node scripts/validate.js  → sale con código 1 si hay errores.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let errors = 0, jsFiles = 0, htmlBlocks = 0;
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');

function list(dir, exts, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) list(full, exts, acc);
    else if (exts.includes(path.extname(e.name).toLowerCase())) acc.push(full);
  }
  return acc;
}

// ── JS sueltos ──
for (const f of list(ROOT, ['.js'])) {
  if (rel(f).startsWith('scripts/')) continue;
  try { new vm.Script(fs.readFileSync(f, 'utf8')); jsFiles++; console.log(`✅ ${rel(f)}`); }
  catch (e) { errors++; console.error(`❌ ${rel(f)} — ${e.message}`); }
}

// ── <script> inline en HTML ──
const RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
for (const f of list(ROOT, ['.html'])) {
  const html = fs.readFileSync(f, 'utf8');
  let m, i = 0;
  while ((m = RE.exec(html))) {
    i++; htmlBlocks++;
    try { new vm.Script(m[1]); }
    catch (e) { errors++; console.error(`❌ ${rel(f)} <script> #${i} — ${e.message}`); }
  }
  console.log(`✅ ${rel(f)} (${i} bloque(s) inline)`);
}

// ── JSON / manifest ──
for (const f of list(ROOT, ['.json', '.webmanifest'])) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { errors++; console.error(`❌ ${rel(f)} — JSON inválido: ${e.message}`); }
}

// ── Service Worker: los archivos precacheados existen y sus ?v= coinciden con index.html ──
try {
  const sw    = fs.readFileSync(path.join(ROOT, 'trabajador.js'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const lista = (sw.match(/ARCHIVOS_A_CACHEAR\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
  const enSw  = [...lista.matchAll(/'([^']+)'/g)].map(m => m[1].replace(/^\.\//, ''));
  for (const a of enSw) {
    if (!fs.existsSync(path.join(ROOT, a.split('?')[0]))) { errors++; console.error(`❌ trabajador.js precachea "${a}", que no existe`); }
  }
  const enIndex = [...index.matchAll(/<script[^>]*\bsrc="(?!https?:)([^"]+)"/g)].map(m => m[1]);
  for (const s of enIndex) {
    if (!enSw.includes(s)) { errors++; console.error(`❌ index.html carga "${s}" pero trabajador.js no lo precachea (¿falta subir ?v= en los dos?)`); }
  }
  if (!/ARCHIVOS_A_CACHEAR/.test(sw)) throw new Error('sin lista');
  console.log(`✅ trabajador.js (${enSw.length} archivos precacheados, coherentes con index.html)`);
} catch (e) { errors++; console.error('❌ No se pudo comprobar el Service Worker: ' + e.message); }

console.log(`\n${jsFiles} JS · ${htmlBlocks} bloques HTML · ${errors} error(es)`);
if (errors) { console.error('🚫 Validación FALLIDA.'); process.exit(1); }
console.log('🎉 Todo correcto.');
