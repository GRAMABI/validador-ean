---
name: diagnosticar-pdf
description: Verificar que el parser de PDFs de envíos Full (Mercado Libre) cuenta bien las unidades. Corre una regresión sobre los PDFs de referencia, o diagnostica un PDF suelto que dé mal. Usar SIEMPRE después de tocar js/pdfParser.js, y cuando el usuario reporte que a un envío le faltan o le sobran unidades.
---

# Diagnóstico y regresión del parser Full (solo lectura)

## Regresión — el uso principal

Después de **cualquier** cambio en `js/pdfParser.js`, corré esto y mostrá la
salida tal cual:
```
node .claude/skills/diagnosticar-pdf/diagnosticar.mjs
```
Verifica todos los PDFs de `.pdfs-referencia/` de una. Sale `0` si está todo
bien y `1` si alguno no coincide, así que sirve como test de verdad.

## Un PDF suelto

Cuando el usuario reporta que a un envío le faltan unidades:
```
node .claude/skills/diagnosticar-pdf/diagnosticar.mjs "<ruta del PDF>"
```
Si el PDF resulta útil como caso de regresión, sugerí copiarlo a
`.pdfs-referencia/` — **no lo copies sin preguntar**.

## Cómo funciona (importante para no romperlo)

- **Usa el parser REAL.** Lee `js/pdfParser.js` del repo, lo ejecuta tal cual y
  llama a `PdfParser.parse()`, la misma API que usa `app.js`. **Nunca**
  reimplementes el conteo acá: si la skill contara por su cuenta, podría dar
  bien mientras la app da mal, que es justo lo que hay que evitar.
- **Lo esperado sale de adentro del PDF.** El header trae
  `Productos del envío: N | Total de unidades: M`. Por eso no hay archivo de
  expectativas que se desincronice, ni datos de envíos versionados.
- **Única concesión:** los 4 fallbacks del worker de pdf.js apuntan a CDNs y en
  Node ninguno carga, así que el script fija el worker local e ignora esos
  intentos. Se neutraliza *cómo se carga* pdf.js (infraestructura para Android
  11); la lógica de parseo y conteo queda intacta.
- **Solo lectura.** No escribe nada: ni el catálogo, ni el código, ni los PDFs.

## Cómo leer una falla

Cuando un envío da ✗, el reporte muestra tres cosas, en orden de confianza:

1. **El aviso del propio parser** (`Desalineación: N productos vs M cantidades`).
   Es el parser diciendo dónde se le rompió el apareo.
2. **Los SKUs que quedaron en `qty=1` por fallback.** Ahí se cortó el apareo
   producto↔cantidad.
3. **El desglose por página**, que señala con `← acá` la página donde hay
   productos sin su cantidad. Eso ubica la sección con el layout no contemplado:
   abrí esa página del PDF y mirá qué tiene distinto (típicamente instrucciones
   con números metidas en la columna UNIDADES).

El punto 3 es **diagnóstico, no es el conteo oficial** — el número siempre sale
del parser real. Se auto-verifica contra él en productos y cantidades; si no
coincide, se descarta solo y avisa, en vez de señalar una página equivocada.
Si aparece ese aviso, es que el troceo de `parseEnviosFull()` cambió y hay que
sincronizar `localizar()` en el script.

## Casos que no son fallas del parser

- `⚠ sin "Total de unidades" en el header` — el PDF no trae con qué comparar.
  No es un error: no se puede verificar y se cuenta aparte.
- `⚠ no es formato Full` — se saltea; la regresión es de Full.
- `⚠ no se pudo leer` — PDF roto; sigue con los demás.

## Requisitos

Necesita `pdfjs-dist@2.16.105` (la misma versión que la app, para que la
extracción de texto sea idéntica). Si falta, el script te da el comando exacto.
`node_modules/` y `.pdfs-referencia/` están gitignoreados.

Los PDFs de referencia viven **solo en la máquina del usuario** — son datos de
envíos reales y el repo es público. Si se pierden, se rebajan de Mercado Libre.
