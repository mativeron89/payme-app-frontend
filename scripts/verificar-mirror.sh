#!/bin/bash
# GATE DE PARIDAD DEL contract-mirror — sale ≠0 ante CUALQUIER desvío.
#
# Reescrito el 2026-08-07 (ORDEN 2-A.3). El verificador anterior REPORTABA
# diferencias y devolvía exit 0 — un gate que informa sin cortar sólo protege
# a quien ya sabe que no corta, y cualquier otro invocador (el CI, un hook,
# otra sesión) heredaba el falso verde. Además usaba una ruta absoluta local y
# enumeraba SÓLO el lado del mirror: un archivo borrado del mirror no era
# diferencia, era silencio — la misma familia que el gate de OpenAPI del
# dashboard.
#
# ## Diseño
#
# La POBLACIÓN la fija `scripts/mirror.manifest.sha256` (inventario
# independiente, versionado junto al VERIFICADOR — no dentro del espejo: el
# inventario no se inventaría a sí mismo—, regenerado sólo en un refresh
# verificado). Tres chequeos:
#
#   1. INTEGRIDAD  — cada entrada del manifiesto existe en el mirror y su
#                    sha256 coincide.
#   2. POBLACIÓN   — en AMBAS direcciones: manifiesto→mirror (faltante) y
#                    mirror→manifiesto (intruso).
#   3. FUENTE      — (modo completo) cada archivo idéntico al contenido del
#                    commit DECLARADO en README.md ("Commit exacto: `<40hex>`"),
#                    leído con `git show <hash>:<path>` del repo hermano. NO se
#                    compara contra el working tree: la procedencia es el hash.
#
# ## Modos — el que NO puede verificar FALLA, nunca aprueba
#
#   (sin flag)      integridad + población + fuente. Repo hermano ausente, hash
#                   ilegible o commit inexistente → exit 2. SIN green-skip.
#   --manifiesto    integridad + población (para CI, donde el repo hermano no
#                   existe). Manifiesto ausente → exit 2.
#   --generar-manifiesto
#                   reescribe MANIFEST.sha256 desde el estado actual. Sólo tras
#                   un refresh verificado en modo completo.
#
# Exit: 0 paridad · 1 discrepancias · 2 precondición imposible de verificar.
set -u
MANIFEST="$(cd "$(dirname "$0")" && pwd)/mirror.manifest.sha256"
cd "$(dirname "$0")/../contract-mirror" || exit 2

# Ruta del repo hermano RELATIVA al workspace, no absoluta a una máquina.
BE="${PAYME_APP_BACKEND_DIR:-../../payme-app-backend}"
MODO="${1:-completo}"

# Los docs/ no se corresponden por path; el mapa es el mismo de siempre.
mapa() { case "$1" in
    docs/settlement.js.ref) echo "services/settlement.js";;
    docs/CHANGELOG_v2.11.md) echo "docs/history/CHANGELOG_v2.11.md";;
    docs/README_v2.10_CONSOLIDADO.md) echo "docs/history/README_v2.10_CONSOLIDADO.md";;
    docs/README_v2.5.2.md) echo "docs/history/README_v2.5.2.md";;
    docs/*) echo "${1#docs/}";; *) echo "$1";; esac; }

# README.md (procedencia) queda fuera del inventario; el manifiesto vive en
# scripts/ A PROPÓSITO: el inventario no se inventaría a sí mismo, y el
# guardarraíl de contractMirror.test.ts (conteo del README vs archivos
# reales) sigue contando SOLO contrato espejado.
enumerar_mirror() {
  find . -type f | sed 's|^\./||' | grep -v -x "README.md" | sort
}

if [ "$MODO" = "--generar-manifiesto" ]; then
  : > "$MANIFEST"
  while read -r rel; do
    shasum -a 256 "$rel" >> "$MANIFEST"
  done < <(enumerar_mirror)
  echo "manifiesto regenerado: $(wc -l < "$MANIFEST" | tr -d ' ') entradas"
  exit 0
fi

if [ ! -f "$MANIFEST" ]; then
  echo "SIN MANIFIESTO: $MANIFEST no existe — no hay inventario contra el que verificar." >&2
  exit 2
fi

fallas=0

# 1 · INTEGRIDAD — shasum -c falla por archivo faltante o hash distinto.
if ! shasum -a 256 -c "$MANIFEST" --quiet; then
  fallas=1
fi

# 2 · POBLACIÓN, dirección mirror→manifiesto: un archivo que el inventario no
#     conoce es un intruso, no un detalle.
while read -r rel; do
  if ! grep -q -F "  $rel" "$MANIFEST"; then
    echo "INTRUSO (no está en el manifiesto): $rel" >&2
    fallas=1
  fi
done < <(enumerar_mirror)
# (La dirección manifiesto→mirror ya la cubre shasum -c: entrada sin archivo
#  falla como FAILED open or read.)

if [ "$MODO" = "--manifiesto" ]; then
  if [ "$fallas" -ne 0 ]; then echo "── PARIDAD ROTA (modo manifiesto)"; exit 1; fi
  echo "── paridad OK contra manifiesto: $(wc -l < "$MANIFEST" | tr -d ' ') archivos"
  exit 0
fi

# 3 · FUENTE en el commit DECLARADO. Si no se puede verificar, se FALLA.
if [ ! -d "$BE/.git" ] && [ ! -f "$BE/.git" ]; then
  echo "SIN FUENTE: no hay repo git en $BE — el modo completo no puede verificar. (CI: usar --manifiesto)" >&2
  exit 2
fi
HASH=$(grep -oE 'Commit exacto: `[0-9a-f]{40}`' README.md | grep -oE '[0-9a-f]{40}' | head -1)
if [ -z "$HASH" ]; then
  echo "SIN PROCEDENCIA: README.md no declara 'Commit exacto: \`<40 hex>\`'." >&2
  exit 2
fi
if ! git -C "$BE" cat-file -e "${HASH}^{commit}" 2>/dev/null; then
  echo "SIN COMMIT: $HASH no existe en $BE — traé el checkpoint declarado." >&2
  exit 2
fi

tot=0; ig=0
while read -r rel; do
  tot=$((tot+1))
  src="$(mapa "$rel")"
  if ! git -C "$BE" cat-file -e "${HASH}:${src}" 2>/dev/null; then
    echo "SIN FUENTE EN ${HASH:0:7}: $rel (→ $src)" >&2
    fallas=1
  elif git -C "$BE" show "${HASH}:${src}" | cmp -s - "$rel"; then
    ig=$((ig+1))
  else
    echo "DIFIERE del commit declarado: $rel (→ $src)" >&2
    fallas=1
  fi
done < <(enumerar_mirror)

echo "── espejados: $tot · idénticos al commit declarado: $ig · manifiesto: $(wc -l < "$MANIFEST" | tr -d ' ')"
if [ "$fallas" -ne 0 ]; then echo "── PARIDAD ROTA"; exit 1; fi
exit 0
