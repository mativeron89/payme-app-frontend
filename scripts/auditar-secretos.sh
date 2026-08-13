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
# Una CLABE, un token propio o una URL de hook con formato libre pasan. **La
# lista es un piso, no una garantía**, y cuando el diff toca config hay que
# leerlo igual.
#
# 🔴 Acá decía «por eso el `--paranoico` de abajo muestra TODAS las menciones».
# **Ese flag NO EXISTE.** Lo escribí describiendo algo que pensaba agregar y no
# agregué — la misma clase que este repo corrigió tres veces hoy: un comentario
# que promete una conducta que el código no tiene, y que se lee como si la
# tuviera. **Si algún día hace falta, se implementa; mientras tanto no se
# nombra.**
set -uo pipefail

BASE="${1:-origin/main}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 2

# 🔴 EL DETECTOR NO PUEDE SER SU PROPIO SUJETO, y lo aprendí en su primer uso.
#
# Este gate CORTÓ sobre el commit que lo introduce, por dos motivos que son la
# misma trampa: el script **nombra** `SECRETOS_DEMO_RAILWAY` porque tiene que
# detectarlo, y el CHANGELOG **cita** el literal de la fuga plantada para
# documentar cómo se acreditó.
#
# **Prohibir una cadena no distingue AFIRMAR de CITAR** — la tercera vez que
# aparece hoy en este repo, después de «sin gate» y del voseo.
#
# Se excluye SÓLO este archivo, por nombre, como hace `registroMexicano.test.ts`
# consigo mismo. **No se excluye el CHANGELOG**: un secreto real puede aterrizar
# ahí igual que en cualquier otro lado, así que el ejemplo se reescribe para que
# no tenga forma de valor.
diff_file="$(mktemp)"
trap 'rm -f "$diff_file"' EXIT
git diff "$BASE"..HEAD -- . ':(exclude)scripts/auditar-secretos.sh' > "$diff_file" 2>/dev/null || {
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
  'i:(^|[^A-Za-z0-9_'"'"'"-])[A-Za-z0-9_-]*(password|passwd|secret|token|api_?key)["'"'"']?\s*[:=]\s*["'"'"'][^"'"'"']{8,}'
  'https://api\.vercel\.com/v[0-9]+/integrations/deploy/[A-Za-z0-9_/-]{16,}'
  'postgres(ql)?://[^\s"'"'"']+:[^\s"'"'"']+@'
)

# ─── El límite izquierdo, y por qué mira la COMILLA y no el guion ───────────
#
# 🔴 CORREGIDO 2026-08-13. Antes el límite excluía **todo** identificador unido
# por `-`, para dejar pasar el ternario real de `LoginScreen.tsx:202`:
#
#     autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
#
# Ahí `password'` va seguido de ` : '` y de un literal largo, así que tiene la
# forma exacta de una asignación. Excluir el guion lo silenciaba — **y de paso
# silenciaba `db-password: "…"`, que es una de las dos formas más comunes de
# escribir una clave en configuración.** Una exención escrita para un caso tapó
# otro que no tenía nada que ver.
#
# El discriminador correcto no es el guion: es **de dónde sale la clave**. En el
# ternario, `current-password` es el contenido de un literal entre comillas; en
# `db-password:` es un identificador desnudo. Por eso el límite ahora excluye
# `'` y `"` —una comilla no puede abrir una clave— y en cambio ADMITE prefijos
# con `-` y `_`, que es lo que cierra los dos agujeros.
#
# La búsqueda de esta familia además es `i:` (insensible al caso): `DB_PASSWORD`
# es la forma canónica de una variable de entorno y `grep -E` distingue el caso.
#
# ─── La clave ENTRE COMILLAS · el único lugar donde desempata el VALOR ──────
#
# 🔴 CERRADO 2026-08-13. `"db-password": "…"` es **estructuralmente idéntico**
# al ternario de arriba: literal entre comillas terminado en `-password`,
# seguido de `:` y de otro literal. **Ninguna regla sobre el límite izquierdo
# puede separarlos**, y por eso quedó afuera de la corrección anterior.
#
# ⚠️ Y es el más peligroso de los tres, aunque se haya encontrado último: los
# otros dos son variantes de cómo se **nombra** una clave; **éste es la forma de
# un archivo de configuración JSON o YAML** — el objeto que alguien pega entero
# en un commit sin mirarlo.
#
# Se cierra con un segundo paso, y la restricción importante es DÓNDE aplica:
#
#   · clave DESNUDA   → se marca SIEMPRE, sin mirar el valor. Es lo que impide
#                       que `const password = 'current-password'` quede exento,
#                       cubierto por `auditarSecretos.test.ts:43`.
#   · clave CITADA    → sólo ahí desempata el valor: token de `autocomplete`
#                       contra literal arbitrario.
#
# 🔴 **Y el desempate es por COINCIDENCIA, no por línea** — de ahí el `-o`. Si
# eximiera la línea entera, bastaría un ternario de `autoComplete` para colar un
# JSON con la clave real en la misma línea. Es el mismo principio que ya fijaba
# el caso de `sk_live`, que no deja que un token benigno tape un secreto vecino.

hallazgos=0
for entrada in "${PATRONES[@]}"; do
  # Un patrón prefijado con `i:` se busca SIN distinguir mayúsculas. El flag va
  # por patrón y no global a propósito: `AKIA[0-9A-Z]{16}` y los prefijos de
  # Stripe son sensibles al caso por definición, y aflojarlos agregaría ruido
  # sin cerrar nada. Una guarda que grita de más se apaga sola, y este archivo
  # ya documenta esa familia.
  flags=(-nE)
  p="$entrada"
  if [ "${p#i:}" != "$p" ]; then
    flags=(-nEi)
    p="${p#i:}"
  fi
  # Sólo líneas AGREGADAS: una ELIMINACIÓN de algo con forma de secreto es lo
  # contrario de un problema, y confundirlas ya pasó una vez con las URLs de
  # Google Fonts —nueve coincidencias, las nueve borrados—.
  # Quita sólo el marcador `+` del diff y aplica el patrón a la línea real.
  # Dejar el marcador dentro de `^\+.*` consume el inicio y vuelve inalcanzable
  # la alternativa `^` del patrón para asignaciones en columna cero.
  reales=$(grep '^+' "$diff_file" | cut -c2- | grep "${flags[@]}" -- "$p" || true)
  if [ -n "$reales" ]; then
    echo "🔴 VALOR con forma de secreto: /$p/" >&2
    printf '%s\n' "$reales" | head -3 | sed 's/^/     /' >&2
    hallazgos=$((hallazgos + 1))
  fi
done

# Clave ENTRE COMILLAS. `-o` extrae CADA coincidencia por separado para poder
# descartarlas una por una: eximir la línea entera dejaría que un ternario de
# `autoComplete` tape un JSON con la clave real escrito al lado.
CLAVE_CITADA='["'"'"'][A-Za-z0-9_-]*(password|passwd|secret|token|api_?key)["'"'"']\s*[:=]\s*["'"'"'][^"'"'"']{8,}'

# La lista de valores benignos se limita a los tokens de `autocomplete` que este
# repo USA —los dos de `LoginScreen.tsx:202`—. No se agregan otros «por si
# acaso»: cada entrada acá es una exención, y una exención sin un caso real que
# la exija es superficie regalada en la guarda de mayor consecuencia del repo.
VALOR_BENIGNO='[:=][[:space:]]*["'"'"'](current-password|new-password)$'

# ⚠️ COSTO IRREDUCIBLE DEL DESEMPATE, medido: `"db-password": "new-password"`
# —clave citada Y valor igual al token— NO se marca. Es lo que se paga por
# poder distinguir el ternario, y no hay regla que lo evite sin reabrirlo.
# Acotado por dos lados: la variante DESNUDA (`db-password: "new-password"`)
# sí se marca, porque ahí no hay exención; y usar literalmente `new-password`
# como contraseña real es la hipótesis menos probable de la familia.

citadas=$(grep '^+' "$diff_file" | cut -c2- | grep -oEi -- "$CLAVE_CITADA" \
  | grep -vEi -- "$VALOR_BENIGNO" || true)
if [ -n "$citadas" ]; then
  echo "🔴 VALOR con forma de secreto: clave entre comillas (JSON/YAML)" >&2
  printf '%s\n' "$citadas" | head -3 | sed 's/^/     /' >&2
  hallazgos=$((hallazgos + 1))
fi

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
