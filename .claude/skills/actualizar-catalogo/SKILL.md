---
name: actualizar-catalogo
description: Actualizar catalog_data.json del Validador EAN desde un Excel de Tienda Nube o LARIX. Usar cuando el usuario pase uno o más .xlsx para actualizar el catálogo. Hace preview antes de escribir, backup automático, y nunca resuelve conflictos de EAN sola.
---

# Actualizar catálogo desde Excel

Skill para fusionar un Excel (Tienda Nube y/o LARIX) contra `catalog_data.json`.
El motor determinístico está en `merge.py` (mismo directorio). Seguí este flujo
al pie de la letra — el catálogo es el archivo más crítico del proyecto.

## Regla de oro

**Nunca escribas el catálogo sin mostrar antes el preview y esperar el OK
explícito del usuario.** El preview es donde el usuario decide. Escribir primero
y avisar después está prohibido.

## Flujo

1. **Identificá el/los Excel** que pasó el usuario (rutas .xlsx). Puede ser uno o
   varios (ej. Tienda Nube + LARIX juntos).

2. **Corré el PREVIEW** (sin `--write`), desde la raíz del repo:
   ```
   python .claude/skills/actualizar-catalogo/merge.py "<ruta1.xlsx>" ["<ruta2.xlsx>" ...]
   ```

3. **Si sale `FORMATO_DESCONOCIDO`** (código de salida 3): el Excel no es TN ni
   LARIX. Relevá al usuario lo que el script explicó (qué hojas/columnas encontró
   vs las esperadas). No se tocó nada. Parás acá.

4. **Mostrá el reporte tal cual** al usuario, y resaltá:
   - los **conflictos de EAN** (NO se aplican — los decide el usuario),
   - las **marcas dudosas** (se agregaron como `Otros`, para revisar después),
   - la línea de **validación del hook** (debe decir "pasa").
   **Esperá el OK.** No escribas todavía.

5. **Con el OK**, aplicá:
   ```
   python .claude/skills/actualizar-catalogo/merge.py "<ruta1.xlsx>" [...] --write
   ```
   Confirmá que escribió, y en qué `.backups/...` quedó el respaldo del anterior.
   Recordá que al commitear, el hook del #1 valida de nuevo (y va a pasar, porque
   el motor ya lo chequeó).

## Qué NO hacer

- **No resuelvas conflictos de EAN.** Si el usuario decide aplicar el EAN nuevo de
  un conflicto, eso es una edición manual puntual que él te indica, SKU por SKU.
- **No cambies la marca de un SKU que ya existe.** Se conserva la del catálogo.
- **No inventes marca** para un SKU nuevo cuya marca no se pudo determinar: va como
  `Otros` y a la lista de dudosas.
- **No toques `catalog_data.json` a mano** para "arreglar" algo del merge: si el
  motor no cubre un caso, avisá al usuario antes de improvisar.

## Notas

- El backup va a `.backups/` (gitignored + Jekyll lo ignora: nunca se commitea ni
  se publica). Se conservan los últimos 10; los viejos se borran solos.
- El motor aplica las reglas de CLAUDE.md: limpieza de EAN + dígito verificador,
  Title Case en descripciones, alias de marca, merge no destructivo (un campo
  vacío del Excel nunca borra un dato existente), `indent=2` con tildes/ñ.
- Marca por defecto: `Otros` (coincide con el catálogo y CLAUDE.md; el fallback
  `Varios` que quedó en app.js es un bug de display aparte, no lo uses).
