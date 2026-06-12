# Validador EAN — Gramabi S.R.L.

PWA instalable en Android para que los operarios de depósito de Gramabi validen códigos EAN durante la preparación de pedidos de e-commerce. Hospedada en GitHub Pages (`gramabi.github.io/validador-ean`).

## Stack

- HTML + CSS + JS vanilla (sin frameworks)
- Hosting: GitHub Pages
- Escáner: `html5-qrcode` + `BarcodeDetector` nativo (con fallback automático)
- PDF: `pdf.js` 2.16.105 desde unpkg (con fallback a cdnjs 3.x)
- Catálogo: `catalog_data.json` estático en la raíz
- Persistencia: `localStorage`
- Target principal: tablet Samsung SM-T510, Android 11, One UI 3.1

## Estructura del repo

```
validador-ean/
├── index.html
├── manifest.json
├── sw.js
├── catalog_data.json        ← catálogo SKU → {ean, desc, marca}
├── icon-192.png / icon-512.png
├── CLAUDE.md
├── css/app.css
└── js/
    ├── app.js               ← lógica principal (modo consolidado por SKU)
    ├── catalog.js           ← caché 24hs del catálogo en localStorage
    ├── pdfParser.js         ← parser multi-formato con 4 fallbacks
    └── scanner.js
```

## Lógica clave

**Modo consolidado por SKU** (cambio importante respecto al diseño original):

- La app agrupa TODOS los pedidos del día por marca → SKU único con cantidad total
- NO muestra al operario quién compró ni el número de pedido
- `buildSkuMap()` recorre pedidos y agrupa por SKU
- `renderOrdersList()` renderiza marca → SKU consolidado
- `openSku(sku)` abre la pantalla de escaneo de un SKU
- `onEanScannedSku(ean)` valida y acumula unidades, avanza por los pedidos internamente

**Formatos de PDF soportados** (en `pdfParser.js`):

| Formato | Detección | Notas |
|---|---|---|
| `zipnova` | "Lista de pickeo" / "Lista de preparación" | Zipnova |
| `gramabi` | "Orden #N - Paquete #N" | TiendaNube / Gramabi |
| `full` | "Envío#N" + "Listado de productos e instrucciones de preparación" | Mercado Libre Full (inbound). Soporta header "ETIQUETA #" y "IDENTIFICACIÓN" |
| `ml_uuid` | UUID `xxxxxxxx-xxxx-...` | Mercado Libre |
| `ml_numeric` | ID de 11+ dígitos | Mercado Libre |
| `ml` (default) | Otros ML alfanuméricos | Vía `parseMlUnified` |

## Reglas operativas para Claude Code

### Cuando me pasen un Excel para actualizar el catálogo

1. **Identificar el formato** del Excel:
   - **Formato Tienda Nube** (`Publicaciones EA EAN.xlsx`): hoja `Actualización de productos`, columnas `id_interno | descripcion | descripcion_variante | sku_madre | sku | gtin`. Datos desde la fila 3 (las 2 primeras son headers).
   - **Formato LARIX simple** (`Publicaciones LARIX EA EAN.xlsx`): hoja `Hoja1`, columnas `SKU | PRODUCTO | PROVEEDOR | COD PROVEEDOR | EAN`. Datos desde la fila 2.

2. **Para cada SKU del Excel**:
   - Limpiar EAN: solo dígitos, sin `.0` flotantes.
   - Limpiar descripción: collapse whitespace; si está toda en mayúsculas, pasar a Title Case.
   - Determinar marca:
     - Tienda Nube → extraer de la descripción contra la lista de marcas conocidas.
     - LARIX → usar la columna PROVEEDOR mapeada a marca canónica (ver tabla más abajo).
   - Si no se detecta marca, usar `"Otros"`.

3. **Merge contra el catálogo actual**:
   - Si el SKU YA existe: mantener `desc` y `marca` existentes (vienen del catálogo oficial). Si el catálogo no tenía EAN y el Excel sí, tomar el del Excel.
   - Si el SKU YA existe y los EAN difieren: **mantener el del catálogo** (Tienda Nube es la fuente oficial) y **reportar el conflicto** para que el usuario decida.
   - Si el SKU es NUEVO: agregarlo con todo del Excel.

4. **Reportar**:
   - Total de SKUs antes/después
   - Con EAN antes/después
   - SKUs nuevos agregados
   - Conflictos de EAN (con detalle SKU, EAN viejo, EAN nuevo, descripción)
   - Top 10 marcas de la distribución actual

5. **Guardar** `catalog_data.json` con `indent=2` y `ensure_ascii=False` (preservar tildes y ñ).

6. **Commit y push**:
   ```
   git add catalog_data.json
   git commit -m "Actualizar catálogo: +N SKUs (total: M)"
   git push
   ```

### Lista de marcas conocidas (para detector de Tienda Nube)

Normalización aplicada:
- `Lusqtoff` y `Lüsqtoff` → `Lüsqtoff`
- `Bta` → `BTA`
- `Gramo` y `GRAMO` → `Gramabi`
- `Rust Oleum` → `Rust-Oleum`
- `Deltaplus` → `Delta Plus`

Lista completa (case-insensitive, word-boundary match):
```
Lüsqtoff, Black & Decker, Rust-Oleum, Dowen Pagio, Garden Plus, Green Way,
Delta Plus, Generac, Ultracomb, Einhell, Truper, Yelmo, Piazza, Esab, Dogo,
Liquitech, Tyrolit, Gamma, Acindar, Conarco, Daewoo, Bahco, Gramabi, Genebre,
Daihatsu, Pretul, Decakila, Pluvius, Milwaukee, Ducasse, Merclin, Hydros,
Konan, Dyllu, Wanke, Bosch, Dewalt, Makita, Stanley, Pintumm, Sintex, Bremen,
Ferrum, Crossmaster, Peugeot, Foset, Eurosound, Irimo, Trabex, Kallay, Papaiz,
Bronzen, Hermex, Labor, Philco, Emblem, Eslingar, Evel, Total, Crom, Kwb,
BTA, Iron, Ruibal, Yoly Bell, Lalelu, Yani Toys, Crown Mustang, Ken Brown,
Rondi, Disney, Transformers, Pin y Pon, Cry Babies, Baby Shark, Santi, Astor,
Crown, Pet Box, First Steps, Andicar, Rivaplast, JYF Toys, Magic Makers,
Caffaro, Casita de Muñecas, First Rate, John & Mary, Trucco, Xalingo
```

### Mapeo PROVEEDOR → marca (para Excel LARIX simple)

```
RUIBAL             → Ruibal
YANI TOYS          → Yani Toys
ANDICAR            → Andicar
RIVAPLAST SA       → Rivaplast
LALELU SRL         → Lalelu
J Y F TOYS SRL     → JYF Toys
MAGIC MAKERS SA    → Magic Makers
CAFFARO            → Caffaro
CASITA DE MUÑECAS  → Casita de Muñecas
YOLY BELL          → Yoly Bell
FIRST RATE SA      → First Rate
JOHN & MARY        → John & Mary
TRUCCO             → Trucco
XALINGO            → Xalingo
```

### Cuando me pasen un PDF para diagnóstico o para extender el parser

1. Identificar formato (de los 6 soportados) o detectar uno nuevo.
2. Si es nuevo: extraer el texto con pdf.js o pdfplumber, mostrar la estructura, proponer la firma de detección + función de parsing.
3. Cualquier cambio en `pdfParser.js` debe:
   - Conservar los 4 niveles de fallback de carga del worker pdf.js (unpkg → cdnjs → blob → fake) — son críticos para Android 11.
   - Mantener el shape de salida que consume `buildSkuMap()` en `app.js`: array de orders con `{id, packId, ventaId, buyer, items, status, confirmedAt}` donde cada item es `{sku, qty, scanned, scannedEan, status, lastError}`.
   - Bumpear el header de versión `v20260610X` (incrementando la letra).
4. Antes de commitear, escribir un test rápido en Node que valide el parser contra el texto extraído del PDF y confirme conteo de productos y total de unidades.

### Cuando me pidan cambios en el código

- Editar los archivos directamente — no usar diffs, escribir el archivo completo.
- Preservar el estilo vanilla sin frameworks.
- Respetar el modo consolidado por SKU (NO volver al modo pedido-por-pedido).
- Si el cambio afecta el cache de la PWA (service worker `sw.js`), bumpear la versión del cache para forzar update en los dispositivos.
- Si el cambio afecta el manifest o permisos, mencionarlo explícitamente.

### Cuando me pasen un error reportado por un operario

- Asumir dispositivo Android 11, Chrome móvil.
- Considerar: permisos de cámara, linterna (no siempre disponible — limitación del browser), modo standalone vs Chrome directo (la barra de Chrome solo aparece en este último).
- Si la causa probable está en el código del repo, identificar archivo + línea + fix sugerido.

## Estilo de respuesta

- Español rioplatense, voseo.
- Concreto y operativo, sin postambles largos.
- Cuando entregues un archivo, dejá un link claro al archivo modificado.
- Antes de hacer commit, mostrar siempre el diff y pedir confirmación.
- Si hay tradeoffs, mencionarlos brevemente — no extenderse.

## Workflow del día a día

```
# Actualizar catálogo
claude "actualizá el catálogo con ~/Downloads/Publicaciones EA EAN.xlsx"

# Combinar dos Excel
claude "actualizá el catálogo con estos dos: ~/Downloads/Publicaciones EA EAN.xlsx y ~/Downloads/Publicaciones LARIX EA EAN.xlsx"

# Diagnosticar PDF
claude "diagnosticá por qué este PDF da cantidad=1 para todo: ~/Downloads/Inbound-XXXX.pdf"

# Cambio al código
claude "agregá al header de Pedidos del día el total de unidades pendientes"

# Deploy manual
git push  # GitHub Pages publica en 1-2 minutos
```
