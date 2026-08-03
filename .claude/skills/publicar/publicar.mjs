#!/usr/bin/env node
/**
 * publicar.mjs — pushea y CONFIRMA contra la URL real que el cambio quedó
 * publicado en GitHub Pages.
 *
 * El problema que resuelve: hoy se pushea y se espera a ciegas 1-2 minutos sin
 * saber si el deploy salió. Si algo falla, el operario sigue usando la versión
 * vieja y nadie se entera.
 *
 * Qué hace:
 *   1. Si en lo que se va a pushear se tocó js/pdfParser.js, corre primero la
 *      regresión (skill diagnosticar-pdf). Si falla, NO pushea.
 *   2. git push
 *   3. Espera y verifica contra la URL real que cada archivo publicado sirve
 *      exactamente el contenido commiteado.
 *
 * Compara contra el BLOB COMMITEADO (git show), no contra el archivo del disco:
 * en Windows el working copy queda con CRLF y GitHub sirve LF, así que comparar
 * contra el disco daría diferencias falsas.
 *
 * Uso:
 *   node .claude/skills/publicar/publicar.mjs                 → push + verificar
 *   node .claude/skills/publicar/publicar.mjs --solo-verificar → no pushea
 *
 * Exit: 0 publicado y verificado · 1 no se pudo confirmar · 2 error de entorno.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const C = process.stdout.isTTY
  ? { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', d:'\x1b[2m', b:'\x1b[1m', x:'\x1b[0m' }
  : { r:'', g:'', y:'', d:'', b:'', x:'' };

const SOLO_VERIFICAR = process.argv.includes('--solo-verificar');
const ESPERA_MAX_S = 300;
const INTERVALO_S = 10;

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', ...opts }).trim();
}
function gitBuf(args) {
  return execFileSync('git', args, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
}
function fatal(msg) { console.error('\n' + C.r + msg + C.x + '\n'); process.exit(2); }
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const dormir = (s) => new Promise(r => setTimeout(r, s * 1000));

// ── Dónde vive el sitio ────────────────────────────────────────────────────
function urlDelSitio() {
  let remote;
  try { remote = git(['remote', 'get-url', 'origin']); }
  catch { fatal('No hay remote "origin". Esto necesita el repo con GitHub.'); }
  const m = remote.match(/github\.com[:/]+([^/]+)\/([^/.]+)(?:\.git)?/i);
  if (!m) fatal(`No pude interpretar el remote: ${remote}`);
  const [, owner, repo] = m;
  return { base: `https://${owner.toLowerCase()}.github.io/${repo}/`, owner, repo };
}

// ── Qué archivos de un rango son PUBLICABLES ───────────────────────────────
// Quedan afuera: dot-directories (Jekyll no las publica) y los .md, que Jekyll
// transforma a HTML y por eso no se pueden comparar byte a byte.
function esPublicable(p) {
  if (p.split('/').some(seg => seg.startsWith('.') || seg.startsWith('_'))) return false;
  if (p.toLowerCase().endsWith('.md')) return false;
  return true;
}

function archivosDelRango(desde, hasta) {
  const args = desde
    ? ['diff', '--name-status', `${desde}..${hasta}`]
    : ['show', '--name-status', '--format=', hasta];
  const out = git(args);
  const res = [];
  for (const l of out.split('\n')) {
    if (!l.trim()) continue;
    const [estado, ...resto] = l.split('\t');
    const p = resto[resto.length - 1];
    if (!p) continue;
    res.push({ estado: estado[0], path: p });
  }
  return res;
}

// ── Verificación contra la URL real ────────────────────────────────────────
// fetch() nativo (undici) deja un socket keep-alive pendiente que en Windows +
// Node 24 crashea el proceso al cerrar (UV_HANDLE_CLOSING assertion, src\win\async.c).
// agent:false con https.get fuerza un socket sin pool que cierra solo.
function bajar(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const sep = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}_v=${Date.now()}${Math.random().toString(36).slice(2)}`;
    const req = https.get(full, {
      agent: false,
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(bajar(new URL(res.headers.location, full).toString(), redirects - 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        resolve({ ok: false, status: res.statusCode });
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ ok: true, buf: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function verificar(base, sha, archivos) {
  const aVerificar = archivos.filter(a => a.estado !== 'D' && esPublicable(a.path));
  const borrados   = archivos.filter(a => a.estado === 'D');
  const noVerif    = archivos.filter(a => a.estado !== 'D' && !esPublicable(a.path));

  if (!aVerificar.length) {
    console.log(`${C.y}No hay archivos publicables en este cambio${C.x} — no hay nada que verificar en el sitio.`);
    if (noVerif.length) console.log(`${C.d}  (${noVerif.map(a => a.path).join(', ')} no se publican al sitio)${C.x}`);
    return { ok: true, verificados: 0 };
  }

  // Lo que DEBERÍA servir el sitio: el blob commiteado, no el archivo del disco.
  const esperado = new Map();
  for (const a of aVerificar) esperado.set(a.path, sha256(gitBuf(['show', `${sha}:${a.path}`])));

  console.log(`\nVerificando ${aVerificar.length} archivo${aVerificar.length > 1 ? 's' : ''} contra ${C.b}${base}${C.x}`);
  console.log(`${C.d}GitHub Pages suele tardar 1-2 minutos. Espero hasta ${ESPERA_MAX_S / 60} min.${C.x}\n`);

  const pendientes = new Set(aVerificar.map(a => a.path));
  const t0 = Date.now();
  let vuelta = 0;

  while (pendientes.size && (Date.now() - t0) / 1000 < ESPERA_MAX_S) {
    if (vuelta++) await dormir(INTERVALO_S);
    for (const p of [...pendientes]) {
      const r = await bajar(base + p);
      if (r.ok && sha256(r.buf) === esperado.get(p)) {
        pendientes.delete(p);
        const seg = Math.round((Date.now() - t0) / 1000);
        console.log(`  ${C.g}✓${C.x} ${p} ${C.d}(${seg}s)${C.x}`);
      }
    }
    if (pendientes.size) {
      const seg = Math.round((Date.now() - t0) / 1000);
      process.stdout.write(`  ${C.d}… faltan ${pendientes.size} (${seg}s)${C.x}\r`);
    }
  }

  if (borrados.length) console.log(`${C.d}  (${borrados.length} borrado/s, no se verifican)${C.x}`);
  if (noVerif.length) console.log(`${C.d}  (${noVerif.map(a => a.path).join(', ')} no se publican al sitio)${C.x}`);

  if (pendientes.size) {
    console.log(`\n${C.r}${C.b}NO PUDE CONFIRMAR la publicación${C.x} de:`);
    for (const p of pendientes) {
      const r = await bajar(base + p);
      const motivo = !r.ok ? `HTTP ${r.status}` : 'el sitio sirve un contenido distinto al commiteado';
      console.log(`  ${C.r}✗${C.x} ${p} ${C.d}— ${motivo}${C.x}`);
    }
    console.log(`\n${C.y}El push salió bien; lo que no se confirmó es el deploy.${C.x}`);
    console.log(`${C.d}Mirá el estado en https://github.com/${urlDelSitio().owner}/${urlDelSitio().repo}/actions${C.x}`);
    console.log(`${C.d}Puede ser un build de Pages demorado o caído. Reintentá con --solo-verificar.${C.x}`);
    return { ok: false, verificados: aVerificar.length - pendientes.size };
  }
  return { ok: true, verificados: aVerificar.length };
}

// ── Main ───────────────────────────────────────────────────────────────────
const { base } = urlDelSitio();
const rama = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const sucio = git(['status', '--porcelain']);

console.log('');
console.log(`${C.b}PUBLICAR${C.x} — ${base}`);
console.log(`${C.d}rama: ${rama}${C.x}`);

if (sucio && !SOLO_VERIFICAR) {
  console.log('');
  fatal(
    'Hay cambios sin commitear. Publicar solo sube lo commiteado, así que\n' +
    'quedarían afuera. Commiteá primero (o corré con --solo-verificar).\n\n' + sucio
  );
}

// Qué se va a pushear
let porPushear = [];
try { porPushear = git(['log', '--format=%h', `origin/${rama}..${rama}`]).split('\n').filter(Boolean); }
catch { porPushear = []; }

let desde = null, hasta = git(['rev-parse', 'HEAD']);
if (porPushear.length) {
  desde = git(['rev-parse', `origin/${rama}`]);
} else {
  // Nada pendiente: se verifica que el último commit ya esté vivo.
  desde = git(['rev-parse', 'HEAD~1']).length ? git(['rev-parse', 'HEAD~1']) : null;
}

if (!SOLO_VERIFICAR && porPushear.length) {
  // Si se tocó el parser, la regresión manda: no se publica un parser que cuenta mal.
  const tocados = archivosDelRango(desde, hasta).map(a => a.path);
  if (tocados.includes('js/pdfParser.js')) {
    console.log(`\n${C.b}Se tocó js/pdfParser.js — corro la regresión antes de publicar${C.x}`);
    try {
      execFileSync('node', ['.claude/skills/diagnosticar-pdf/diagnosticar.mjs'],
                   { cwd: REPO, stdio: 'inherit' });
    } catch {
      console.error(`\n${C.r}${C.b}La regresión falló. NO publico.${C.x}`);
      console.error(`${C.d}Arreglá el parser, o si estás seguro, pusheá a mano con git push.${C.x}\n`);
      process.exit(1);
    }
  }
  console.log(`\nPusheando ${porPushear.length} commit${porPushear.length > 1 ? 's' : ''}…`);
  try { execFileSync('git', ['push'], { cwd: REPO, stdio: 'inherit' }); }
  catch { fatal('Falló el push.'); }
} else if (SOLO_VERIFICAR) {
  console.log(`${C.d}modo solo verificar: no se pushea nada${C.x}`);
} else {
  console.log(`${C.d}nada pendiente de push — verifico que lo último ya esté publicado${C.x}`);
}

const archivos = archivosDelRango(desde, hasta);
const { ok, verificados } = await verificar(base, hasta, archivos);

console.log('');
if (ok && verificados === 0) {
  // Nada publicable: decirlo tal cual. Un "verificado" que no verificó nada es
  // justo la confirmación falsa que hace que el aviso deje de servir.
  console.log(`${C.b}NADA QUE PUBLICAR AL SITIO${C.x} — el cambio no toca archivos que se sirvan.`);
} else if (ok) {
  console.log(`${C.b}${C.g}PUBLICADO Y VERIFICADO${C.x} — el sitio ya sirve este cambio (${verificados} archivo${verificados > 1 ? 's' : ''}).`);
  console.log(`${C.d}En las tablets entra al reabrir la app con señal.${C.x}`);
} else {
  console.log(`${C.b}${C.r}SIN CONFIRMAR${C.x} — no des por publicado este cambio todavía.`);
}
console.log('');
process.exit(ok ? 0 : 1);
