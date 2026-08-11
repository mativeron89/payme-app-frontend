#!/usr/bin/env bash
#
# Dispara el Deploy Hook de un proyecto de Vercel. Lo llama `ci.yml` al final,
# y sólo con todo en verde. El porqué está en `docs/DESPLIEGUE_GATEADO.md`.
#
#   uso:  publicar-vercel.sh <nombre> <url-del-hook>
#
# 🔴 POR QUÉ ES UN SCRIPT Y NO CUATRO LÍNEAS DENTRO DEL YAML.
# Un `run:` embebido no se puede correr en un mutante: la única forma de saber
# si corta sería pushear y romper producción a propósito. Acá afuera se le
# planta un servidor que contesta 500 y se acredita que el job cae. Un gate que
# nunca vio un rojo no está verificado.
#
# Condición 3 de la orden, la que más importa: **si el disparo falla, esto sale
# ≠0**. Un `curl` que devuelve error y no corta deja creyendo que se publicó.

# 🔴 EL INSTRUMENTO CALLADO SE CONFUNDE CON EL RESULTADO TRANQUILO.
# Tres veces el 2026-08-10, en tres repos:
#   · un `jq` que no matcheó y una salida vacía — «no apareció» leído como
#     «no corrió», sobre un paso que SÍ había corrido;
#   · un vigía cuya salida quedó en el buffer de Python: vivo y mudo;
#   · un `400` por payload roto y un `409` por gate, idénticos en una tabla.
# Lo que salvó en las tres fue buscar la CONFIRMACIÓN POSITIVA —el paso 11,
# el hash nuevo, el payload bien armado— en vez de leer la ausencia como
# respuesta. Por eso este script imprime SIEMPRE una línea con el código,
# también cuando sale bien.
#
# ══════════════════════════════════════════════════════════════════════════
# 🔴 CÓMO SE VERIFICA UN DESPLIEGUE QUE NO DEBE CAMBIAR NADA · 2026-08-10
#
# El caso concreto de la regla de arriba, y el que más cuesta ver: un push de
# sólo documentación. La predicción es que producción NO se mueve. Y entonces
# un artefacto quieto **es compatible con dos historias opuestas**:
#
#     se publicó y salió idéntico      ← lo que se espera
#     no se publicó nada               ← la compuerta falló en silencio
#
# **Un hash igual, solo, NO puede distinguirlas.** Hacen falta DOS mediciones
# independientes, y son afirmaciones distintas:
#
#     ¿OCURRIÓ?    el 201 de este script  +  `last-modified` del bundle servido
#     ¿CAMBIÓ?     sha256 del CUERPO, antes y después
#
# Medido así el 2026-08-10 en v0.74.3: hook a las 23:55:12, `last-modified`
# 23:55:23 —once segundos después, el deploy aterrizó— y los cuatro cuerpos
# byte-idénticos. Recién con las dos se puede decir «se publicó y no cambió».
#
# ⚠️ **Y se compara el sha256 del CUERPO, nunca el nombre del asset.** Un
# `index-XXXX.js` homónimo con contenido distinto pasa el chequeo flojo: el
# nombre lleva hash de contenido sólo mientras nadie sirva otra cosa bajo el
# mismo nombre, y eso es una suposición sobre el host, no una medición.
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

nombre="${1:?falta el nombre del proyecto}"
url="${2:-}"

# Fail-closed: sin secreto no se publica Y se avisa. La alternativa —saltear en
# silencio— es la que deja a alguien creyendo que salió.
if [ -z "$url" ]; then
  echo "🔴 $nombre: el secreto del Deploy Hook está vacío o no existe." >&2
  echo "   No se disparó nada. Cargalo en Settings → Secrets del repo." >&2
  exit 1
fi

# La URL NUNCA se imprime: es el secreto. Sólo el nombre y el código.
#
# `codigo=$(...)` en su propia línea a propósito: `local codigo=$(cmd)` o un
# `declare` en la misma línea se comen el exit code del comando.
codigo=""
if ! codigo=$(curl -sS -X POST \
  -o /dev/null -w '%{http_code}' \
  --max-time 30 --retry 2 --retry-connrefused --retry-delay 2 \
  "$url"); then
  echo "🔴 $nombre: el curl al Deploy Hook falló (red, DNS o timeout)." >&2
  exit 1
fi

case "$codigo" in
  2*)
    echo "✅ $nombre: despliegue disparado (HTTP $codigo)"
    ;;
  *)
    echo "🔴 $nombre: el Deploy Hook contestó HTTP $codigo — NO se publicó." >&2
    exit 1
    ;;
esac
