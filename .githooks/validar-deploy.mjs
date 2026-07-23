#!/usr/bin/env node
/**
 * validar-deploy.mjs — Validación pre-deploy del Validador EAN.
 *
 * Corre desde el hook pre-commit. Valida SOLO el contenido "staged" (lo que
 * realmente entra en el commit), no el disco. Chequea:
 *   1. catalog_data.json (si está en el commit): JSON válido + estructura +
 *      no vacío/truncado + no caída silenciosa de volumen.
 *   2. Cada .js del commit: sintaxis (node --check).
 *   3. Cache del service worker (aviso, no bloquea).
 *
 * Códigos de salida:
 *   0  todo bien (o nada relevante que validar)
 *   1  la validación encontró un problema real  -> el hook bloquea el commit
 *   2  el validador no pudo correr              -> el hook deja pasar avisando
 *
 * Válvula de escape (solo para la caída de volumen del catálogo):
 *   VEAN_ALLOW_CATALOG_SHRINK=1 git commit ...
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Cuánto puede bajar la cantidad de SKUs de un commit al siguiente antes de
// bloquear. Un update normal agrega o quita pocos; una pérdida >10% (~400 SKUs
// sobre ~4.000) casi siempre es un merge accidental que se comió productos.
const MAX_DROP = 0.10;

const errores = [];   // bloquean (exit 1)
const avisos  = [];   // informan (no bloquean)

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || ''), err: (r.stderr || '') };
}

// Contenido de un archivo TAL COMO quedó staged (índice), no el del disco.
function contenidoStaged(path) {
  const r = git(['show', ':' + path]);
  return r.code === 0 ? r.out : null;
}
function contenidoHEAD(path) {
  const r = git(['show', 'HEAD:' + path]);
  return r.code === 0 ? r.out : null;
}

function lineaDe(texto, aguja) {
  const i = texto.indexOf(aguja);
  if (i < 0) return null;
  return texto.slice(0, i).split('\n').length;
}

// ── 1. CATÁLOGO ──────────────────────────────────────────────
function validarCatalogo() {
  const raw = contenidoStaged('catalog_data.json');
  if (raw == null) { avisos.push('No pude leer catalog_data.json staged (raro).'); return; }

  if (raw.trim() === '') {
    errores.push('CATÁLOGO — catalog_data.json está VACÍO.');
    return;
  }

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    // Ubicar línea/columna del error de parseo
    let donde = '';
    const m = /line (\d+) column (\d+)/.exec(e.message);
    if (m) donde = ` (línea ${m[1]}, columna ${m[2]})`;
    else {
      const p = /position (\d+)/.exec(e.message);
      if (p) {
        const pos = +p[1];
        const linea = raw.slice(0, pos).split('\n').length;
        donde = ` (línea ${linea})`;
      }
    }
    errores.push(`CATÁLOGO — catalog_data.json no es JSON válido${donde}:\n     ${e.message}`);
    return;
  }

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    errores.push('CATÁLOGO — catalog_data.json debería ser un objeto de SKUs y no lo es.');
    return;
  }

  const skus = Object.keys(obj);
  const n = skus.length;

  // No vacío / no truncado (piso absoluto)
  if (n < 50) {
    errores.push(`CATÁLOGO — solo ${n} SKUs. El catálogo real tiene ~4.000: parece truncado o mal generado.`);
    return; // sin sentido seguir con la estructura
  }

  // Estructura de cada SKU (reporta hasta 12 problemas con su línea)
  const problemas = [];
  for (const sku of skus) {
    if (problemas.length >= 12) break;
    const v = obj[sku];
    const ln = lineaDe(raw, `"${sku}":`);
    const loc = ln ? `Línea ${ln}` : `SKU "${sku}"`;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      problemas.push(`${loc}: "${sku}" no es un objeto {ean, desc, marca}.`); continue;
    }
    if (!('ean' in v))        problemas.push(`${loc}: "${sku}" no tiene el campo "ean".`);
    else if (typeof v.ean !== 'string') problemas.push(`${loc}: "${sku}" tiene "ean" que no es texto.`);
    else if (v.ean !== '' && !/^[0-9]+$/.test(v.ean)) problemas.push(`${loc}: "${sku}" tiene "ean" con caracteres no numéricos: "${v.ean}".`);
    if (!('desc' in v))       problemas.push(`${loc}: "${sku}" no tiene el campo "desc".`);
    else if (typeof v.desc !== 'string' || v.desc.trim() === '') problemas.push(`${loc}: "${sku}" tiene "desc" vacío.`);
    if (!('marca' in v))      problemas.push(`${loc}: "${sku}" no tiene el campo "marca".`);
    else if (typeof v.marca !== 'string' || v.marca.trim() === '') problemas.push(`${loc}: "${sku}" tiene "marca" vacío.`);
  }
  if (problemas.length) {
    errores.push('CATÁLOGO — problemas de estructura:\n     ' + problemas.join('\n     '));
  }

  // Caída de volumen (bloquea, con válvula de escape propia)
  const rawHead = contenidoHEAD('catalog_data.json');
  if (rawHead) {
    let nHead = 0;
    try { nHead = Object.keys(JSON.parse(rawHead)).length; } catch { nHead = 0; }
    if (nHead > 0 && n < nHead) {
      const drop = (nHead - n) / nHead;
      if (drop > MAX_DROP) {
        const pct = (drop * 100).toFixed(1);
        if (process.env.VEAN_ALLOW_CATALOG_SHRINK === '1') {
          avisos.push(`CATÁLOGO — baja de ${nHead} a ${n} SKUs (−${pct}%). Permitida por VEAN_ALLOW_CATALOG_SHRINK=1.`);
        } else {
          errores.push(
            `CATÁLOGO — el catálogo baja de ${nHead} a ${n} SKUs (−${pct}%, más del ${(MAX_DROP*100)}% permitido).\n` +
            `     Esto suele ser un merge accidental que borró productos.\n` +
            `     Si la baja es INTENCIONAL, repetí el commit con:\n` +
            `        VEAN_ALLOW_CATALOG_SHRINK=1 git commit ...\n` +
            `     (esa variable saltea SOLO este chequeo; el resto se sigue validando)`
          );
        }
      }
    }
  }
}

// ── 2. JAVASCRIPT ────────────────────────────────────────────
function validarJs(path) {
  const raw = contenidoStaged(path);
  if (raw == null) return;
  const tmp = join(tmpdir(), `vean-check-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  try {
    writeFileSync(tmp, raw);
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    if (r.status !== 0) {
      // node --check escribe algo tipo:  <tmp>:764  ...  SyntaxError: ...
      const err = (r.stderr || '').replace(new RegExp(tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), path);
      const linea = (new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)').exec(err) || [])[1];
      const msg = (/((?:Syntax|Reference|Type)Error:.*)/.exec(err) || [, 'error de sintaxis'])[1];
      errores.push(`JAVASCRIPT — ${path}${linea ? ':' + linea : ''}\n     ${msg}`);
    }
  } catch (e) {
    avisos.push(`No pude chequear ${path}: ${e.message}`);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

// ── 3. CACHE DEL SERVICE WORKER (aviso, no bloquea) ──────────
function cacheDe(texto) {
  const m = texto && /const CACHE\s*=\s*'([^']+)'/.exec(texto);
  return m ? m[1] : null;
}
function avisarCache(staged) {
  // Solo archivos de código/shell (NO el catálogo: se sirve network-first y no
  // necesita bump de cache — meterlo acá daría fricción falsa en cada update).
  const esShell = f => /\.(js|css|html|png)$/.test(f) && f !== 'catalog_data.json' && !f.startsWith('.githooks/');
  const cambiados = staged.filter(esShell);
  if (!cambiados.length) return;

  const swHead    = cacheDe(contenidoHEAD('sw.js'));
  const swStaged  = staged.includes('sw.js') ? cacheDe(contenidoStaged('sw.js')) : swHead;
  if (swHead && swStaged === swHead) {
    avisos.push(
      `CACHE — cambiaste ${cambiados.slice(0,5).join(', ')}${cambiados.length>5?'…':''} ` +
      `pero CACHE en sw.js sigue en '${swHead}'.\n` +
      `     No bloquea (los archivos propios se sirven network-first), pero conviene ` +
      `bumpearlo para que las tablets OFFLINE tomen el cambio.`
    );
  }
}

// ── MAIN ─────────────────────────────────────────────────────
function main() {
  const r = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  if (r.code !== 0) throw new Error('no pude listar los archivos staged: ' + r.err.trim());
  const staged = r.out.split('\n').map(s => s.trim()).filter(Boolean);

  const tocaCatalogo = staged.includes('catalog_data.json');
  const jsStaged = staged.filter(f => f.endsWith('.js') && !f.startsWith('.githooks/'));

  if (!tocaCatalogo && jsStaged.length === 0) {
    // README, CLAUDE.md, manifest, docs... nada que validar.
    avisarCache(staged); // por si tocó css/html/icon sin JS
    if (avisos.length) imprimir();
    else console.log('✓ Validación: nada que revisar en este commit.');
    process.exit(errores.length ? 1 : 0);
  }

  if (tocaCatalogo) validarCatalogo();
  for (const f of jsStaged) validarJs(f);
  avisarCache(staged);

  imprimir();
  process.exit(errores.length ? 1 : 0);
}

function imprimir() {
  if (avisos.length) {
    console.log('');
    for (const a of avisos) console.log('  ⚠️  ' + a);
  }
  if (errores.length) {
    console.log('');
    console.log('  ✗ VALIDACIÓN PRE-DEPLOY: ' + errores.length + ' problema(s). Commit BLOQUEADO.\n');
    for (const e of errores) console.log('  ✗ ' + e + '\n');
    console.log('  (Arreglá lo de arriba y volvé a commitear.)');
    console.log('');
  } else if (avisos.length) {
    console.log('');
    console.log('  ✓ Validación OK (con avisos). Commit permitido.');
    console.log('');
  } else {
    console.log('✓ Validación pre-deploy OK.');
  }
}

try {
  main();
} catch (e) {
  // Error INESPERADO del validador (no una validación fallida): que el hook
  // deje pasar el commit pero avise fuerte.
  console.error('validar-deploy.mjs se rompió: ' + (e && e.message ? e.message : e));
  process.exit(2);
}
