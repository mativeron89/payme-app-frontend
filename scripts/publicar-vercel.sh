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
