---
name: publicar
description: Pushear a GitHub Pages y confirmar contra la URL real que el cambio quedó efectivamente publicado en el sitio. Usar cuando el usuario quiera publicar cambios y saber con certeza que el deploy salió, en vez de pushear y esperar a ciegas.
---

# Publicar y verificar el deploy

```
node .claude/skills/publicar/publicar.mjs
```

Hace tres cosas, en orden:

1. Si en lo que se va a pushear se tocó `js/pdfParser.js`, corre **primero** la
   regresión (`diagnosticar-pdf`). Si falla, **no pushea**: un parser que cuenta
   mal en las tablets se traduce en mercadería faltante.
2. `git push`.
3. Espera y **verifica contra la URL real** que el sitio sirve exactamente el
   contenido commiteado, archivo por archivo. Hasta 5 minutos.

Sale `0` solo si se pudo confirmar. Si no, sale `1` y aclara que **el push salió
bien y lo que no se confirmó es el deploy** — son dos cosas distintas.

Para chequear el estado del sitio sin pushear nada:
```
node .claude/skills/publicar/publicar.mjs --solo-verificar
```

## Detalles que importan

- **Compara contra el blob commiteado** (`git show`), no contra el archivo del
  disco. En Windows el working copy queda con CRLF y GitHub sirve LF: comparando
  contra el disco, *todos* los archivos darían diferencia y el aviso sería
  siempre falso. Verificado: disco y commit difieren en todos los archivos.
- **No verifica lo que no se publica.** Las dot-directories (`.claude/`,
  `.githooks/`, `.backups/`, `.pdfs-referencia/`) y los `.md` (Jekyll los
  transforma) quedan afuera. Si el cambio no toca nada publicable, lo dice tal
  cual: *"nada que publicar al sitio"*, no un "verificado" que no verificó nada.
- **Exige el árbol limpio** antes de pushear: publicar solo sube lo commiteado,
  así que un cambio sin commitear quedaría afuera sin que se note.
- Cada request lleva cache-busting, para que no conteste el CDN con una copia
  vieja y dé un falso OK.

## Cómo presentar el resultado

Mostrá la salida tal cual. Si no se pudo confirmar, **no digas que está
publicado**: el operario seguiría usando la versión vieja sin enterarse. El
script ya indica dónde mirar el build de Pages y cómo reintentar.

Recordá que en las tablets el cambio entra **al reabrir la app con señal**.
