#!/usr/bin/env bash
#
# Hace VISIBLE el conteo de `flaky` de Playwright en CI. NO bloquea nunca.
#
#   uso:  reportar-flaky.sh <ruta-del-json-de-playwright>
#
# 🔴 POR QUÉ EXISTE · orden del Bibliotecario, 2026-08-10
# `retries: 2` en CI hace que un test que falla y pasa al reintentar se reporte
# como «flaky» y la corrida salga 0. **La corrida queda verde y publica.**
#
#     la compuerta existe para impedir que se publique código ROTO
#     un test que pasa al reintentar NO es evidencia de código roto
#         → no debe bloquear
#     pero degradarse en silencio SÍ es un problema
#         → tiene que verse
#
# ⚠️ **LÍMITE, y va escrito porque es fácil leer de más:** esto hace que la
# degradación sea VISIBLE. **No hace que no ocurra.** Un `flaky > 0` se
# investiga; sigue publicando igual.
#
# 🔴 POR QUÉ ES UN SCRIPT Y NO UN `run:` EMBEBIDO — misma razón que
# `publicar-vercel.sh`: para poder correrlo en un mutante. Acá el modo de falla
# que importa es el INVERSO del de aquél: **este script no debe cortar JAMÁS.**
# Un paso de reporte que falla y tumba el job convertiría un informe en una
# compuerta, que es exactamente lo que no se pidió. Por eso sale 0 incluso con
# el JSON ausente, vacío o roto — y lo DICE en vez de callarse.
#
# NO lleva `set -e`: un `-e` acá podría cortar el job desde un paso de reporte.
set -uo pipefail

json="${1:-}"

# Todo camino imprime algo. Un paso de reporte mudo se confunde con un paso que
# no corrió — la regla que este repo viene persiguiendo todo el día.
if [ -z "$json" ] || [ ! -f "$json" ]; then
  echo "⚠️  reporte de flaky: no encontré '$json'."
  echo "    No bloqueo — pero el conteo de flaky de esta corrida NO se midió."
  exit 0
fi

flaky=$(node -e '
  try {
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const n = d && d.stats && d.stats.flaky;
    process.stdout.write(Number.isInteger(n) ? String(n) : "");
  } catch { process.stdout.write(""); }
' "$json" 2>/dev/null)

if [ -z "$flaky" ]; then
  echo "⚠️  reporte de flaky: '$json' no tiene un \`stats.flaky\` entero."
  echo "    No bloqueo — pero el conteo NO se midió."
  exit 0
fi

if [ "$flaky" -gt 0 ]; then
  # `::warning::` sale destacado en la UI de la corrida, no enterrado en el log.
  echo "::warning title=Playwright flaky::${flaky} test(s) pasaron sólo al reintentar. La corrida publica igual; investigar."
  echo "🟡 flaky: ${flaky} — pasaron al reintentar. NO bloquea, pero no es verde limpio."
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### 🟡 Playwright: ${flaky} flaky"
      echo ""
      echo "Pasaron sólo al reintentar (\`retries: 2\`). **La corrida publica igual.**"
      echo "Un flaky se investiga; no frena el deploy. Esto lo hace visible, no lo evita."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
else
  # Confirmación POSITIVA: «cero» dicho en voz alta ≠ silencio.
  echo "✅ flaky: 0 — ningún test necesitó reintento."
fi

exit 0
