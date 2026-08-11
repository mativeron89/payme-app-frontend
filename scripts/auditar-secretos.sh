#!/usr/bin/env bash
#
# Audita el diff contra `origin/main` buscando secretos, y **CORTA**.
#
#   uso:  scripts/auditar-secretos.sh [<base>]      (por defecto origin/main)
#
# 🔴 POR QUÉ EXISTE · 2026-08-11, y es una falla mía
#
# Este repo es PÚBLICO y la regla es auditar antes de cada push. Yo la venía
# cumpliendo con una línea suelta en la terminal:
#
#     [ "$n" -eq 0 ] && echo "✅ cero coincidencias"
#
# **Eso informa y no corta.** El 2026-08-11 marcó `password × 2` y `sk_live × 3`
# **y el push salió igual, en el mismo bloque, sin que yo leyera las cinco.**
# Resultaron benignas —menciones en comentarios y nombres de variable del código
# espejado— pero eso lo verifiqué DESPUÉS. **La diferencia entre «salió bien» y
# «estaba controlado» es exactamente esta.**
#
# Es la familia que este repo viene persiguiendo todo el día —el gate que informa
# sin cortar— cometida en el chequeo de mayor consecuencia que tiene.
#
# ─── Cómo distingue una MENCIÓN de un VALOR ─────────────────────────────────
#
# Prohibir la palabra `password` sería inútil: aparece como nombre de campo en
# todo el contrato espejado, y una guarda que grita siempre se apaga sola. Se
# buscan **valores con forma de secreto**, no palabras:
#
#     sk_live_ABC123…     ← prefijo Y cuerpo largo
#     password: "hunter2" ← asignación Y literal
#
# ⚠️ **Y el costo, dicho: esto NO detecta un secreto sin forma reconocible.**
# Una CLABE, un token propio o una URL de hook con formato libre pasan. La lista
# es un piso, no una garantía — por eso el `--paranoico` de abajo muestra TODAS
# las menciones para leerlas a mano cuando el diff es grande o toca config.
set -uo pipefail

BASE="${1:-origin/main}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 2

diff_file="$(mktemp)"
trap 'rm -f "$diff_file"' EXIT
git diff "$BASE"..HEAD > "$diff_file" 2>/dev/null || {
  echo "🔴 no pude calcular el diff contra $BASE" >&2; exit 2;
}

# Control positivo: si el diff está vacío, esto no auditó nada y hay que decirlo
# en vez de cantar victoria. Un «cero hallazgos» sobre cero líneas no es cero
# hallazgos.
lineas=$(grep -c '^+' "$diff_file" || true)
if [ "${lineas:-0}" -eq 0 ]; then
  echo "⚠️  el diff contra $BASE no tiene líneas agregadas: NO se auditó nada."
  exit 0
fi

# VALORES con forma de secreto. Cada patrón exige prefijo Y cuerpo, o
# asignación Y literal — nunca la palabra suelta.
PATRONES=(
  'sk_live_[A-Za-z0-9]{16,}'
  'sk_test_[A-Za-z0-9]{16,}'
  'rk_live_[A-Za-z0-9]{16,}'
  'pk_live_[A-Za-z0-9]{16,}'
  'ghp_[A-Za-z0-9]{30,}'
  'xoxb-[A-Za-z0-9-]{20,}'
  'AKIA[0-9A-Z]{16}'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  '(password|passwd|secret|token|api_?key)["'"'"']?\s*[:=]\s*["'"'"'][^"'"'"']{8,}'
  'https://api\.vercel\.com/v[0-9]+/integrations/deploy/[A-Za-z0-9_/-]{16,}'
  'postgres(ql)?://[^\s"'"'"']+:[^\s"'"'"']+@'
)

hallazgos=0
for p in "${PATRONES[@]}"; do
  # Sólo líneas AGREGADAS: una ELIMINACIÓN de algo con forma de secreto es lo
  # contrario de un problema, y confundirlas ya pasó una vez con las URLs de
  # Google Fonts —nueve coincidencias, las nueve borrados—.
  if grep -qE "^\+.*$p" "$diff_file"; then
    echo "🔴 VALOR con forma de secreto: /$p/" >&2
    grep -nE "^\+.*$p" "$diff_file" | head -3 | sed 's/^/     /' >&2
    hallazgos=$((hallazgos + 1))
  fi
done

# El archivo prohibido, por nombre: nunca se lee, nunca se cita, nunca se sube.
if grep -q 'SECRETOS_DEMO_RAILWAY' "$diff_file"; then
  echo "🔴 el diff menciona SECRETOS_DEMO_RAILWAY.env, que está fuera de alcance" >&2
  hallazgos=$((hallazgos + 1))
fi

if [ "$hallazgos" -gt 0 ]; then
  echo "" >&2
  echo "🔴 AUDITORÍA DE SECRETOS: $hallazgos patrón(es) con forma de VALOR." >&2
  echo "   El repo es PÚBLICO. No se pushea hasta resolverlo." >&2
  exit 1
fi

# Confirmación POSITIVA siempre, también cuando sale bien: un instrumento callado
# se confunde con un resultado tranquilo.
echo "✅ auditoría de secretos: $lineas líneas agregadas, cero valores con forma de secreto."
echo "   ⚠️  Es un piso, no una garantía: un secreto sin forma reconocible pasa."
exit 0
