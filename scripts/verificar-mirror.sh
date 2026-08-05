#!/bin/bash
# MÉTODO DE CONTEO Y PARIDAD DEL contract-mirror
#
# 1. Enumera con `find . -type f` desde dentro del espejo. NO se filtra por
#    nombre: el 67/68 heredado salía de `grep -v README.md` SIN ANCLAR, que
#    descartaba en silencio `legal/README.md` — un archivo espejado con fuente
#    real. La herramienta estaba mal, no el espejo.
# 2. Excluye UNA sola ruta, comparada COMPLETA: `./README.md` (procedencia).
# 3. Mapea los `docs/`, que no se corresponden por path.
# 4. Compara con `cmp` y cuenta por SEPARADO idénticos, distintos y sin-fuente,
#    para que "0 diferencias" no se confunda con "no comparó nada".
cd "$(dirname "$0")/../contract-mirror"
BE=/Users/matiasveron/Desktop/PayMe/payme-app-backend
mapa() { case "$1" in
    docs/settlement.js.ref) echo "services/settlement.js";;
    docs/CHANGELOG_v2.11.md) echo "docs/history/CHANGELOG_v2.11.md";;
    docs/README_v2.10_CONSOLIDADO.md) echo "docs/history/README_v2.10_CONSOLIDADO.md";;
    docs/README_v2.5.2.md) echo "docs/history/README_v2.5.2.md";;
    docs/*) echo "${1#docs/}";; *) echo "$1";; esac; }
tot=0; ig=0; di=0; sf=0
while read -r f; do
  rel="${f#./}"; [ "$rel" = "README.md" ] && continue
  tot=$((tot+1)); src="$BE/$(mapa "$rel")"
  if [ ! -f "$src" ]; then echo "SIN FUENTE: $rel"; sf=$((sf+1))
  elif cmp -s "$f" "$src"; then ig=$((ig+1))
  else echo "DIFIERE:    $rel"; di=$((di+1)); fi
done < <(find . -type f | sort)
echo "── espejados: $tot · idénticos: $ig · difieren: $di · sin fuente: $sf"
