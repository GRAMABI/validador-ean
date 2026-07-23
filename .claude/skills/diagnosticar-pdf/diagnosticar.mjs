#!/usr/bin/env node
/**
 * diagnosticar.mjs — regresión y diagnóstico del parser de envíos Full.
 *
 * SOLO LECTURA. No escribe nada: ni el catálogo, ni el código, ni los PDFs.
 *
 * IDEA CENTRAL: usa el PARSER REAL (js/pdfParser.js), no una reimplementación.
 * El archivo del repo se ejecuta tal cual y se llama a su API pública
 * PdfParser.parse() — la misma que usa app.js. Si mañana se toca el parser,
 * esto valida esa versión al instante. Una sola fuente de verdad.
 *
 * Y la verdad esperada sale de ADENTRO de cada PDF: el header trae
 * "Productos del envío: N | Total de unidades: M". Por eso no hace falta
 * ningún archivo de expectativas que se desincronice, ni guardar datos de
 * envíos en el repo.
 *
 * Uso:
 *   node .claude/skills/diagnosticar-pdf/diagnosticar.mjs            → regresión
 *   node .claude/skills/diagnosticar-pdf/diagnosticar.mjs <pdf>      → un PDF
 *
 * Exit: 0 todo OK · 1 alguna diferencia · 2 problema de entorno.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const PARSER = path.join(REPO, 'js', 'pdfParser.js');
const PDFDIR = path.join(REPO, '.pdfs-referencia');

const C = process.stdout.isTTY
  ? { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', d:'\x1b[2m', b:'\x1b[1m', x:'\x1b[0m' }
  : { r:'', g:'', y:'', d:'', b:'', x:'' };

function fatal(msg) { console.error('\n' + C.r + msg + C.x + '\n'); process.exit(2); }

// ── Entorno: pdf.js ────────────────────────────────────────────────────────
if (!fs.existsSync(PARSER)) fatal(`No encuentro ${path.relative(REPO, PARSER)}. ¿Estás parado en el repo del Validador?`);
const parserSrc = fs.readFileSync(PARSER, 'utf8');

// La versión que usa la app sale del propio parser (sus URLs de CDN).
const APP_PDFJS = (parserSrc.match(/pdfjs-dist@([\d.]+)/) || [])[1] || null;
const PARSER_VER = (parserSrc.match(/pdfParser\.js\s*—\s*(v[\w.]+)/) || [])[1] || '?';

let pdfjs;
try {
  pdfjs = createRequire(path.join(REPO, 'x.js'))('pdfjs-dist/legacy/build/pdf.js');
} catch {
  try {
    pdfjs = createRequire(path.join(HERE, 'x.js'))('pdfjs-dist/legacy/build/pdf.js');
  } catch {
    fatal(
      'Falta pdf.js. Instalalo una sola vez (node_modules/ está gitignoreado):\n\n' +
      `  npm install --no-save pdfjs-dist@${APP_PDFJS || '2.16.105'}\n\n` +
      'Tiene que ser esa versión: es la misma que usa la app, para que la\n' +
      'extracción de texto sea idéntica a la del navegador.'
    );
  }
}

// ── Shims: lo mínimo de navegador que el parser toca ───────────────────────
if (typeof globalThis.URL.createObjectURL !== 'function') globalThis.URL.createObjectURL = () => '';

// El parser pisa workerSrc con URLs de CDN — son sus 4 fallbacks para Android
// 11, y en Node ninguno puede cargar (intentaría require() de una URL). Fijamos
// el worker LOCAL e ignoramos esos writes. Se neutraliza SOLO *cómo se carga*
// pdf.js; la lógica de parseo y de conteo queda intacta y es la que se valida.
{
  let wsrc;
  try {
    const req = createRequire(path.join(REPO, 'x.js'));
    wsrc = req.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
  } catch {
    try { wsrc = createRequire(path.join(HERE, 'x.js')).resolve('pdfjs-dist/legacy/build/pdf.worker.js'); }
    catch { wsrc = ''; }
  }
  Object.defineProperty(pdfjs.GlobalWorkerOptions, 'workerSrc', {
    get: () => wsrc, set: () => {}, configurable: true,
  });
}

// Captura del texto EXACTO que el parser lee, página por página. Envolvemos
// getDocument en lugar de re-extraer por afuera, así el diagnóstico mira
// literalmente lo mismo que vio el parser.
let capturedPages = [];
const realGetDocument = pdfjs.getDocument.bind(pdfjs);
const getDocumentEspiado = (opts) => {
  const task = realGetDocument(opts);
  return new Proxy(task, {
    get(t, prop) {
      if (prop === 'promise') {
        return t.promise.then((pdf) => new Proxy(pdf, {
          get(d, p2) {
            if (p2 === 'getPage') {
              return async (n) => {
                const page = await d.getPage(n);
                const realGTC = page.getTextContent.bind(page);
                page.getTextContent = async (...a) => {
                  const c = await realGTC(...a);
                  capturedPages[n - 1] = c.items.map(i => i.str).join(' ');
                  return c;
                };
                return page;
              };
            }
            const v = d[p2];
            return typeof v === 'function' ? v.bind(d) : v;
          },
        }));
      }
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
};

// El módulo de pdf.js expone getDocument como getter de solo lectura, así que
// el espía se inyecta con un Proxy sobre el módulo, no asignando encima.
globalThis.pdfjsLib = new Proxy(pdfjs, {
  get: (t, prop) => (prop === 'getDocument' ? getDocumentEspiado : t[prop]),
});

// ── El parser REAL, ejecutado tal cual está en el repo ─────────────────────
vm.runInThisContext(parserSrc + '\n;globalThis.PdfParser = PdfParser;', { filename: PARSER });
const PdfParser = globalThis.PdfParser;

// ── Localizador (DIAGNÓSTICO, no es el conteo oficial) ─────────────────────
// Replica el troceo de parseEnviosFull() para poder decir EN QUÉ PÁGINA se
// desbalancean productos y cantidades. Se auto-verifica contra el parser real
// más abajo: si no coincide, se descarta en vez de mentir.
const TABLE_HEADER = /PRODUCTO\s+UNIDADES\s+(?:ETIQUETA\s*#?|IDENTIFICACI[OÓ]N)\s+INSTRUCCIONES\s+DE\s+PREPARACI[OÓ]N/gi;

function contarProductos(t) {
  if (!t) return 0;
  let n = 0;
  for (const b of t.split(/(?=Código\s*ML:)/i)) {
    if (!/^Código\s*ML:/i.test(b.trim())) continue;
    if (/SKU:\s*([A-Za-z0-9ÁÉÍÓÚÜÑ_\-./]+)/i.test(b)) n++;
  }
  return n;
}
function contarCantidades(t) {
  if (!t) return 0;
  let c = t.replace(/•[^•]*\./g, ' ').replace(/•[^•\d]*/g, ' ');
  return (c.match(/(?:^|\s)(\d{1,3})(?=\s|$)/g) || []).length;
}

function localizar(fullText, pageStarts) {
  TABLE_HEADER.lastIndex = 0;
  const cortes = [];
  let m;
  while ((m = TABLE_HEADER.exec(fullText)) !== null) cortes.push([m.index, m.index + m[0].length]);
  if (!cortes.length) return null;

  const chunks = [];
  chunks.push({ ini: 0, txt: fullText.slice(0, cortes[0][0]) });
  for (let i = 0; i < cortes.length; i++) {
    const ini = cortes[i][1];
    const fin = i + 1 < cortes.length ? cortes[i + 1][0] : fullText.length;
    chunks.push({ ini, txt: fullText.slice(ini, fin) });
  }

  const prods = [], qtys = [];
  chunks.forEach((ch, i) => {
    if (i === 0) { prods[0] = contarProductos(ch.txt); qtys[0] = null; return; }
    const firstMl = ch.txt.search(/Código\s*ML:/i);
    const qTxt = firstMl >= 0 ? ch.txt.slice(0, firstMl) : ch.txt;
    const pTxt = firstMl >= 0 ? ch.txt.slice(firstMl) : '';
    qtys[i] = contarCantidades(qTxt);
    prods[i] = contarProductos(pTxt);
  });

  const pagDe = (off) => {
    let p = 1;
    for (let i = 0; i < pageStarts.length; i++) if (off >= pageStarts[i]) p = i + 1;
    return p;
  };
  // Las cantidades del chunk i corresponden a los productos del chunk i-1.
  const filas = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!prods[i]) continue;
    // La página se toma de donde están los PRODUCTOS del chunk (su primer
    // "Código ML:"), no del arranque del chunk: ese cae justo después del
    // header de tabla, que todavía es la página anterior.
    const rel = chunks[i].txt.search(/Código\s*ML:/i);
    filas.push({
      pagina: pagDe(chunks[i].ini + (rel >= 0 ? rel : 0)),
      productos: prods[i],
      cantidades: i + 1 < chunks.length ? (qtys[i + 1] ?? 0) : 0,
    });
  }
  return {
    filas,
    totalProd: prods.reduce((s, v) => s + (v || 0), 0),
    totalQty: qtys.reduce((s, v) => s + (v || 0), 0),
  };
}

// ── Un PDF ─────────────────────────────────────────────────────────────────
async function analizar(file) {
  const nombre = path.basename(file);
  const res = { nombre, estado: 'error', detalle: '' };

  let buf;
  try { buf = fs.readFileSync(file); }
  catch (e) { res.detalle = 'no se pudo leer el archivo: ' + e.message; return res; }

  capturedPages = [];
  const logs = [];
  const realConsole = globalThis.console;
  globalThis.console = {
    ...realConsole,
    log:  (...a) => logs.push(a.join(' ')),
    warn: (...a) => logs.push(a.join(' ')),
    error:(...a) => logs.push(a.join(' ')),
  };

  let orders;
  try {
    orders = await PdfParser.parse({
      name: nombre,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    });
  } catch (e) {
    globalThis.console = realConsole;
    res.estado = 'ilegible';
    res.detalle = e.message;
    return res;
  } finally {
    globalThis.console = realConsole;
  }
  res.logs = logs;

  // Texto tal cual lo vio el parser + offsets de página.
  let fullText = '', pageStarts = [];
  for (const p of capturedPages) { pageStarts.push(fullText.length); fullText += (p || '') + '\n'; }
  res.paginas = capturedPages.length;

  const formato = (logs.find(l => /Formato detectado/i.test(l)) || '').split(':').pop().trim();
  res.formato = formato || '?';
  if (formato && formato !== 'full') { res.estado = 'no-full'; return res; }

  // Verdad esperada: del propio PDF.
  const mU = fullText.match(/Total\s+de\s+unidades:\s*(\d+)/i);
  const mP = fullText.match(/Productos\s+del\s+env[íi]o:\s*(\d+)/i);
  res.envio = (fullText.match(/Envío\s*#(\d+)/i) || [])[1] || '?';

  const items = orders.flatMap(o => o.items || []);
  res.skus = items.length;
  res.unidades = items.reduce((s, it) => s + it.qty, 0);

  if (!mU) { res.estado = 'sin-header'; return res; }
  res.espUnidades = parseInt(mU[1], 10);
  res.espSkus = mP ? parseInt(mP[1], 10) : null;

  const okU = res.unidades === res.espUnidades;
  const okS = res.espSkus === null || res.skus === res.espSkus;
  res.estado = (okU && okS) ? 'ok' : 'falla';

  if (res.estado === 'falla') {
    // 1) El aviso del propio parser.
    res.desalineacion = logs.find(l => /Desalineaci[oó]n/i.test(l)) || null;
    const md = res.desalineacion && res.desalineacion.match(/(\d+)\s*productos\s*vs\s*(\d+)\s*cantidades/i);
    // 2) Los ítems que cayeron al fallback qty=1 (índice >= cantidades leídas).
    if (md) {
      const leidas = parseInt(md[2], 10);
      res.fallback = items.slice(leidas).map(it => it.sku);
    }
    // 3) Dónde se desbalancea, por página. Se auto-verifica contra el parser
    //    real en LOS DOS ejes: productos Y cantidades. Si el localizador no
    //    reproduce exactamente lo que contó el parser, quedó desincronizado
    //    (típico si se tocó el troceo o el regex de cantidades) y se descarta:
    //    mejor no decir nada que señalar la página equivocada.
    const qtysParser = md ? parseInt(md[2], 10) : res.skus;
    const loc = localizar(fullText, pageStarts);
    if (loc && loc.totalProd === res.skus && loc.totalQty === qtysParser) res.loc = loc;
    else res.locDescartado = true;
  }
  return res;
}

// ── Salida ─────────────────────────────────────────────────────────────────
function linea(r) {
  const n = r.envio ? ('#' + r.envio).padEnd(11) : r.nombre.slice(0, 11).padEnd(11);
  switch (r.estado) {
    case 'ok':
      return `  ${C.g}✓${C.x} ${n} ${String(r.skus).padStart(3)} SKUs ${String(r.unidades).padStart(5)} u.`;
    case 'falla': {
      const du = r.unidades - r.espUnidades;
      const ds = r.espSkus !== null ? r.skus - r.espSkus : 0;
      const p = [];
      if (ds) p.push(`SKUs ${r.skus}/${r.espSkus}`);
      p.push(`${r.unidades}/${r.espUnidades} u. (${du > 0 ? '+' : ''}${du})`);
      return `  ${C.r}✗${C.x} ${n} ${C.r}${p.join('  ')}${C.x}`;
    }
    case 'sin-header':
      return `  ${C.y}⚠${C.x} ${n} ${C.d}sin "Total de unidades" en el header — no verificable (parseó ${r.skus} SKUs, ${r.unidades} u.)${C.x}`;
    case 'no-full':
      return `  ${C.y}⚠${C.x} ${r.nombre.slice(0, 11).padEnd(11)} ${C.d}no es formato Full (detectado: ${r.formato}) — salteado${C.x}`;
    case 'ilegible':
      return `  ${C.y}⚠${C.x} ${r.nombre.slice(0, 11).padEnd(11)} ${C.d}no se pudo leer: ${r.detalle}${C.x}`;
    default:
      return `  ${C.y}⚠${C.x} ${r.nombre.slice(0, 11).padEnd(11)} ${C.d}${r.detalle}${C.x}`;
  }
}

function detalle(r) {
  const L = [];
  L.push('');
  L.push(`${C.b}${C.r}── Envío #${r.envio} — se pierde la cuenta ──${C.x}`);
  L.push(`  archivo: ${r.nombre}  (${r.paginas} páginas)`);
  L.push(`  esperado (header del PDF): ${r.espSkus ?? '?'} SKUs, ${r.espUnidades} unidades`);
  L.push(`  parseado (parser real):    ${r.skus} SKUs, ${r.unidades} unidades`);
  if (r.desalineacion) L.push(`\n  ${C.y}El parser avisó:${C.x} ${r.desalineacion.replace(/^\[PDF Full\]\s*/, '')}`);
  if (r.fallback && r.fallback.length) {
    L.push(`\n  ${C.y}SKUs que quedaron en qty=1 por fallback${C.x} (acá se cortó el apareo):`);
    L.push('    ' + r.fallback.slice(0, 12).join(', ') + (r.fallback.length > 12 ? `, … (+${r.fallback.length - 12})` : ''));
  }
  if (r.loc) {
    L.push(`\n  ${C.d}Desglose por página (diagnóstico para ubicar la sección,${C.x}`);
    L.push(`  ${C.d}NO es el conteo oficial — ese sale del parser real):${C.x}`);
    L.push(`    ${'página'.padEnd(8)}${'productos'.padStart(10)}${'cantidades'.padStart(12)}`);
    for (const f of r.loc.filas) {
      const mal = f.productos !== f.cantidades;
      const marca = mal ? `  ${C.r}← acá${C.x}` : '';
      L.push(`    ${String(f.pagina).padEnd(8)}${String(f.productos).padStart(10)}${String(f.cantidades).padStart(12)}${marca}`);
    }
    L.push(`\n  ${C.d}Mirá en esa página qué tiene distinto (instrucciones raras en la${C.x}`);
    L.push(`  ${C.d}columna UNIDADES, un layout nuevo): ese es el caso no contemplado.${C.x}`);
  } else if (r.locDescartado) {
    L.push(`\n  ${C.d}(El localizador por página no coincide con el parser real, así que${C.x}`);
    L.push(`  ${C.d}lo descarto en vez de señalar una página equivocada. Si el troceo${C.x}`);
    L.push(`  ${C.d}de parseEnviosFull() cambió, hay que sincronizar este script.)${C.x}`);
  }
  return L.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────
const arg = process.argv[2];
let files;
if (arg) {
  if (!fs.existsSync(arg)) fatal(`No existe: ${arg}`);
  files = [path.resolve(arg)];
} else {
  if (!fs.existsSync(PDFDIR)) {
    fatal(
      'No existe la carpeta .pdfs-referencia/\n\n' +
      'Creala y dejá ahí los PDFs "Inbound-XXXX-preparation-instructions.pdf":\n\n' +
      '  mkdir .pdfs-referencia\n\n' +
      'Está gitignoreada y arranca con punto, así que no se commitea ni se\n' +
      'publica al sitio. Cada PDF trae adentro su propio total esperado.'
    );
  }
  files = fs.readdirSync(PDFDIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort()
             .map(f => path.join(PDFDIR, f));
  if (!files.length) fatal('.pdfs-referencia/ está vacía. Dejá ahí los PDFs de envíos Full.');
}

const mismaVer = APP_PDFJS === pdfjs.version;
console.log('');
console.log(`${C.b}DIAGNÓSTICO DEL PARSER FULL${C.x} — ${files.length} PDF${files.length > 1 ? 's' : ''}`);
console.log(`${C.d}parser: js/pdfParser.js (${PARSER_VER}) · pdf.js ${pdfjs.version}` +
            `${mismaVer ? ' (igual que la app)' : C.y + ' ⚠ la app usa ' + APP_PDFJS + C.d}${C.x}`);
console.log(`${C.d}esperado = el header de cada PDF. Solo lectura: no se escribe nada.${C.x}`);
console.log('');

const res = [];
for (const f of files) res.push(await analizar(f));
for (const r of res) console.log(linea(r));

for (const r of res) if (r.estado === 'falla') console.log(detalle(r));

const ok = res.filter(r => r.estado === 'ok').length;
const mal = res.filter(r => r.estado === 'falla').length;
const otros = res.length - ok - mal;
console.log('');
if (mal) console.log(`${C.b}${C.r}RESULTADO: ${ok}/${ok + mal} OK — ${mal} FALLA${mal > 1 ? 'N' : ''}${C.x}` +
                     (otros ? `${C.d} (+${otros} no verificable${otros > 1 ? 's' : ''})${C.x}` : ''));
else console.log(`${C.b}${C.g}RESULTADO: ${ok}/${ok} OK${C.x}` +
                 (otros ? `${C.d} (+${otros} no verificable${otros > 1 ? 's' : ''})${C.x}` : ''));
console.log('');
process.exit(mal ? 1 : 0);
