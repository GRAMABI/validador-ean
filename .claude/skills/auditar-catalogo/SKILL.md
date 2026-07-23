---
name: auditar-catalogo
description: Auditar la calidad de datos del catálogo del Validador EAN (EANs compartidos entre productos distintos, marcas mal clasificadas, dígitos verificadores inválidos, SKUs sin EAN). Solo lectura, no corrige nada. Usar cuando el usuario quiera una revisión de salud del catálogo.
---

# Auditar catálogo (solo lectura)

Corré el auditor y mostrá el reporte tal cual:
```
python .claude/skills/auditar-catalogo/auditar.py
```

**Es SOLO LECTURA.** El script solo lee `catalog_data.json` (y `js/stock.js`
para la clasificación de empresa). No escribe ni corrige nada. No pide
confirmación porque no hay nada que aprobar.

## Cómo leer el reporte

Está priorizado. Al presentarlo, respetá estas distinciones (son el trabajo fino
del clasificador — no las borres):

- **🔴 P1 CONFIRMADO** — dos marcas reales distintas sobre el mismo código. Grave.
  Se corrige en **Tienda Nube** (planilla).
- **🟠 P1 DUDOSO** — misma marca, medida/capacidad distinta. *Capaz* distintos,
  *capaz* un SKU duplicado. Revisar con más ojo. Muchos son packs (P25/P50) que
  son el mismo producto.
- **🟠 P2 marca-fill** — mismo producto (variantes de color) con la marca sin
  completar en algunos SKUs. No es un código mal: se **asigna la marca** a los
  "Otros" en TN o el catálogo.
- **🟠 P2 empresa** — juguetería clasificada como GRAMABI. **OJO: esta es la
  única que se corrige en CÓDIGO** (`js/stock.js`, lista `MARCAS_LARIX`), que se
  **publica a las tablets** (pasa por el hook y un deploy). No es una planilla.
- **🟡 P3** — dígito verificador de EAN inválido (tipeo).
- **ℹ️ Informativo** — sin EAN, ruido de EANs compartidos (mismo producto
  repetido): no son errores, no hay que tocarlos.

No propongas "arreglar" nada automáticamente: el auditor solo reporta. La
corrección la decide y la hace el usuario, en el lugar que el reporte indica.
