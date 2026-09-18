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
#
# ─── Excepción (b′) · prosa del CONTRATO ESPEJADO · 2026-09-18 (AF-17) ───────
#
# Addendum 1 de `APP-GOOGLE-CONTINUE-AF-17-20260918` (Bibliotecario, sha256
# `4e99730a…af00`). El contrato del dueño v2.92.0 documenta sus campos con
# notas en prosa —`"password": "la contraseña actual de la cuenta…"`— y eso es
# exactamente la forma «clave citada + literal de 8+». Este repo no puede
# editar `contract-mirror/`, y el dueño es PRIVADO mientras éste es PÚBLICO:
# eximir el espejo entero dejaría pasar acá un secreto real del dueño.
#
# Por eso la excepción es doblemente acotada y las dos condiciones son
# CONJUNTIVAS, sólo para las tres familias «clave entre comillas»
# (`CLAVE_CITADA`, `CLAVE_CITADA_ES`, `CLAVE_CITADA_COMPUESTA`):
#   ① la línea agregada es de un archivo bajo `contract-mirror/`, y
#   ② el VALOR es prosa: al menos cuatro tramos de espacio entre palabras
#      (cinco palabras o más).
# Un valor sin espacios —la forma de un token, un hash o una contraseña— sigue
# rojo también dentro del espejo. Fuera del espejo no cambia nada, y las demás
# familias (`PATRONES`, el archivo prohibido por nombre) no se tocan.
#
# 🔴 **COSTO DECLARADO:** una frase de cinco o más palabras usada como
# contraseña real, escrita como valor de una clave citada DENTRO del espejo, no
# se marcaría. Es lo que se paga por no bloquear la documentación del dueño.
#
# Cómo se sabe de qué archivo es cada línea: NO se parsea el diff aplanado.
# Los encabezados `+++ b/…` se pueden falsificar desde el contenido —una línea
# agregada que empieza con `++ b/` aparece en el diff como `+++ b/`—, así que
# se le pregunta a git con DOS diffs por pathspec: el del espejo y el resto. Su
# suma tiene que dar exactamente las líneas agregadas del diff completo; si no
# da, el script falla cerrado (exit 2).
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
espejo_file="$(mktemp)"
resto_file="$(mktemp)"
trap 'rm -f "$diff_file" "$espejo_file" "$resto_file"' EXIT
git diff "$BASE"..HEAD -- . ':(exclude)scripts/auditar-secretos.sh' > "$diff_file" 2>/dev/null || {
  echo "🔴 no pude calcular el diff contra $BASE" >&2; exit 2;
}
# (b′) · el mismo diff, partido por pathspec: espejo y resto.
git diff "$BASE"..HEAD -- 'contract-mirror/' > "$espejo_file" 2>/dev/null \
  && git diff "$BASE"..HEAD -- . ':(exclude)scripts/auditar-secretos.sh' ':(exclude)contract-mirror/' \
    > "$resto_file" 2>/dev/null || {
  echo "🔴 no pude partir el diff contra $BASE entre espejo y resto" >&2; exit 2;
}

# Control positivo: si el diff está vacío, esto no auditó nada y hay que decirlo
# en vez de cantar victoria. Un «cero hallazgos» sobre cero líneas no es cero
# hallazgos.
lineas=$(grep -c '^+' "$diff_file" || true)
if [ "${lineas:-0}" -eq 0 ]; then
  echo "⚠️  el diff contra $BASE no tiene líneas agregadas: NO se auditó nada."
  exit 0
fi
lineas_espejo=$(grep -c '^+' "$espejo_file" || true)
lineas_resto=$(grep -c '^+' "$resto_file" || true)
if [ $(( ${lineas_espejo:-0} + ${lineas_resto:-0} )) -ne "$lineas" ]; then
  echo "🔴 la partición espejo/resto no suma el diff completo ($lineas_espejo + $lineas_resto ≠ $lineas): no audito a ciegas" >&2
  exit 2
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
  'i:(^|[^A-Za-z0-9_'"'"'"-])[A-Za-z0-9_-]*(contrasena|contraseña|contraseÑa|secreto|credencial)[A-Za-z0-9_-]*["'"'"']?\s*[:=]\s*["'"'"'][^"'"'"']{8,}'
  'i:(^|[^A-Za-z0-9_'"'"'"-])[A-Za-z0-9_-]*((clave|llave)[_-]?(secreta|privada|admin|maestra|acceso|cifrado|api)|api[_-]?(clave|llave))[A-Za-z0-9_-]*["'"'"']?\s*[:=]\s*["'"'"'][^"'"'"']{8,}'
  'https://api\.vercel\.com/v[0-9]+/integrations/deploy/[A-Za-z0-9_/-]{16,}'
  'postgres(ql)?://[^\s"'"'"']+:[^\s"'"'"']+@'
)

# ─── Identificadores en ESPAÑOL · 2026-09-18 (AF-11), y por qué faltaban ────
#
# Hasta acá la familia de asignación sólo reconocía `password|passwd|secret|
# token|api_?key` — puro inglés. El equipo que nombra este repo escribe en
# español rioplatense, y `AF-09` midió con una sonda real que `contraseña`,
# `CONTRASENA`, `clave` y `CLAVE_SECRETA` con un valor literal largo **no se
# marcaban**. El repo es PÚBLICO: un secreto detrás de un nombre en español
# pasaba exactamente igual que si el patrón no existiera.
#
# Se agrega una SEGUNDA entrada a `PATRONES`, no se amplía la primera, y es a
# propósito: `contrasena|contraseña|contraseÑa|clave|secreto|llave|credencial`
# lleva `[A-Za-z0-9_-]*` DESPUÉS del grupo (prefijo, sufijo o palabra completa,
# como pide la orden), pero la entrada vieja en inglés queda BYTE A BYTE igual
# —sufijo únicamente— y es una decisión medida, no un descuido:
#
# 🔴 **La primera versión unificaba las dos familias en una sola entrada con
# prefijo para todos, inglés incluido, y se revirtió.** Correr el auditor
# contra el árbol COMPLETO del repo (`git diff <empty-tree>..HEAD`, no sólo el
# diff de esta orden) mostró el costo real: `"js-tokens": "^3.0.0 || ^4.0.0"`
# en `package-lock.json` —el nombre de un paquete real de npm, no un secreto—
# empezó a marcarse, porque `token` + el sufijo nuevo `[A-Za-z0-9_-]*` absorbe
# la `s` de `tokens`. Un lockfile lista cientos de nombres de paquete; sumarle
# prefijo/sufijo genérico a `token` (o a `password`/`secret`/`api_key`) es
# multiplicar la superficie de falsos positivos por cada dependencia futura
# que contenga esas letras en su nombre, no una vez: SIEMPRE. **Es la misma
# familia que este archivo ya nombra arriba —"una guarda que grita de más se
# apaga sola"— aplicada a un lockfile en vez de a un patrón de Stripe.**
#
# Las palabras en ESPAÑOL no tienen ese riesgo —ningún paquete de npm se llama
# `contrasena` o `credencial`— así que ahí el prefijo/sufijo se queda. `token`
# permanece con su cobertura vieja (sufijo y palabra completa, que ya lo
# cazaba); no gana prefijo, y por eso NO es parte de la segunda entrada aunque
# la orden lo liste junto a las palabras en español: pedía que las palabras
# NUEVAS funcionaran como prefijo/sufijo/palabra completa, y `token` no es
# nueva. Ampliarlo de todos modos habría sido cumplir la letra rompiendo el
# motivo por el que la guarda existe.
#
# 🔴 **`contrase[nñ]a` —clase de corchetes con la `ñ` adentro— se probó primero
# para la palabra en sí y se descartó.** Bajo `/usr/bin/grep` (BSD grep 2.6.0,
# el que corre este script de verdad — NO el `grep` de la sesión donde se
# desarrolló, que un shim del harness redirige a `ugrep` y que SÍ la
# matcheaba, escondiendo el defecto) una clase de corchetes con un carácter
# UTF-8 de 2 bytes (`ñ` = `0xC3 0xB1`) se compila como dos alternativas de UN
# byte cada una bajo locale `C` (la que tiene este script como subproceso de
# `bash`, sin `LANG` heredado): la clase consume sólo el primer byte de `ñ` y
# la letra `a` que sigue en el patrón ya no encuentra el segundo byte, así que
# `contraseña` real NUNCA matcheaba. Medido: `echo contraseña | grep -Ei
# 'contrase[nñ]a'` → sale 1 con `/usr/bin/grep`. La alternancia
# `contrasena|contraseña` compara cada alternativa como secuencia de bytes
# completa y matchea con cualquier grep, en cualquier locale. **La lección:
# cuando el patrón nuevo tiene un acento, hay que ejecutar el script real
# (`bash scripts/…`), nunca sólo `grep` suelto en esta sesión.**
#
# 🔴 **Y todavía faltaba la mayúscula CON tilde.** `-i` sí pliega
# `contrasena`↔`CONTRASENA` (ASCII puro), pero bajo `/usr/bin/grep` en locale
# `C` NO pliega `ñ`↔`Ñ`: medido, `echo CONTRASEÑA | grep -Ei 'contraseña'` →
# sale 1. Agregar sólo `contraseña` (minúscula) dejaba el mismo hueco que el
# hallazgo original de AF-09, con la letra cambiada. Se agrega la tercera
# alternativa literal `contraseÑa` (con la Ñ mayúscula exacta) en vez de
# confiar en que `-i` la resuelva sola.
#
# `secreto` (sin `?`, a propósito) es una alternativa NUEVA y separada de
# `secret`: `secret` ya vive en la entrada vieja sin prefijo/sufijo, así que
# no hace falta —ni conviene— repetirla acá con el riesgo de prefijo que este
# mismo párrafo acaba de descartar para el inglés.
#
# ─── `clave`/`llave` sólo en COMPUESTOS · 2026-09-18 (AF-14) ────────────────
#
# 🔴 **`clave` salió de la lista de arriba y no vuelve a entrar como palabra
# suelta.** AF-11 dejó medido (no supuesto) que `clave` es una palabra
# española tan común que también significa "lookup key" genérico, sin ninguna
# relación con seguridad: correr este mismo auditor contra el ÁRBOL COMPLETO
# (no sólo un diff) encontró **~20 coincidencias en 9 archivos** —claves de
# `localStorage`, la propiedad `clave` que elige el copy de propina, un UUID
# de fixture de test— y CERO eran un secreto real. Una guarda que marca eso
# es la misma familia que el propio script ya documenta arriba: "grita de más
# y se apaga sola". `llave` es sinónimo exacto de `clave` en este repo (ver
# `GAPS.md` y varios comentarios) y comparte el mismo riesgo, así que sale con
# ella.
#
# **Lo que NO se retira es la capacidad de detectar un secreto real nombrado
# con `clave`/`llave`.** Se reemplaza "palabra sola con prefijo/sufijo libre"
# por "compuesto con intención de secreto EXPLÍCITA": la palabra tiene que
# aparecer pegada (con o sin `_`/`-`/camelCase) a uno de
# `secreta|privada|admin|maestra|acceso|cifrado|api`, o al revés como
# `api_clave`/`api_llave` —el único orden invertido que la orden pide, porque
# `api_key`/`api_clave` es una convención de nombrado real en ambos sentidos
# y ninguno de los otros sufijos se usa así—. `clave_secreta`, `CLAVE-ADMIN`,
# `llaveMaestra` siguen marcando; `SIN_CLAVE`, `CLAVE_STORAGE`, `CLAVE_MODO`,
# la `clave` bien sola de `propinaRecibo.ts` y de `idioma.tsx` — ninguno tiene
# uno de esos sufijos pegado, así que ninguno marca.
#
# La lista de sufijos es la que pide la orden, ni más ni menos: no se agregan
# variantes de género (`cifrada`, `secreto` de `secreta`) ni sufijos nuevos
# "por si acaso" — es la misma regla que ya rige `VALOR_BENIGNO` más abajo,
# una exención (acá, una NO-exención) sin caso real que la exija es
# superficie regalada.
#
# 🔴 **Esta vez no hace falta la lección de portabilidad de AF-11.** Los ocho
# sufijos nuevos son ASCII puro —sin `ñ`, sin acentos— así que no hay clase de
# corchetes UTF-8 que compilar mal bajo `/usr/bin/grep` en locale `C`, y `-i`
# sí pliega mayúsculas ASCII sin el hueco que tuvo `Ñ`. Se ejecuta igual el
# script real (`bash scripts/…`, nunca `grep` suelto) para no dar nada por
# sentado, pero el resultado no depende de ese defecto puntual.

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
#
# Misma división que en `PATRONES` y el mismo motivo: `CLAVE_CITADA` (inglés)
# se queda sin prefijo/sufijo porque un lockfile cita nombres de paquete entre
# comillas — `"js-tokens": "^3.0.0 || ^4.0.0"` es EXACTAMENTE esta forma, clave
# citada + valor citado de 8+ — y `CLAVE_CITADA_ES` (español) sí lo lleva,
# porque ningún paquete de npm se llama `contrasena` o `credencial`.
CLAVE_CITADA='["'"'"'][A-Za-z0-9_-]*(password|passwd|secret|token|api_?key)["'"'"']\s*[:=]\s*["'"'"'][^"'"'"']{8,}'
CLAVE_CITADA_ES='["'"'"'][A-Za-z0-9_-]*(contrasena|contraseña|contraseÑa|secreto|credencial)[A-Za-z0-9_-]*["'"'"']\s*[:=]\s*["'"'"'][^"'"'"']{8,}'
# AF-14 · mismo recorte que en PATRONES: `clave`/`llave` sólo cuentan citadas
# si son un compuesto con intención de secreto, nunca la palabra sola.
CLAVE_CITADA_COMPUESTA='["'"'"'][A-Za-z0-9_-]*((clave|llave)[_-]?(secreta|privada|admin|maestra|acceso|cifrado|api)|api[_-]?(clave|llave))[A-Za-z0-9_-]*["'"'"']\s*[:=]\s*["'"'"'][^"'"'"']{8,}'

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

# (b′) · un VALOR en prosa: desde su comilla de apertura hasta el final de la
# coincidencia, cinco palabras o más. Anclado a `$`: el valor es lo último de
# cada coincidencia (`[^"']{8,}` no cruza comillas), así que la regla nunca
# puede empezar en la comilla de la CLAVE.
VALOR_PROSA='["'"'"'][[:space:]]*([^"'"'"'[:space:]]+[[:space:]]+){4}[^"'"'"'[:space:]][^"'"'"']*$'

# Coincidencias de una familia citada: todas las del resto, y del espejo sólo
# las que NO son prosa. Las dos condiciones de la excepción son conjuntivas:
# el archivo de la línea (①) lo decide la partición por pathspec, el valor (②)
# este filtro, y sólo se aplica al espejo.
citadas_de() {
  local patron="$1"
  { grep '^+' "$resto_file" | cut -c2- | grep -oEi -- "$patron" || true
    grep '^+' "$espejo_file" | cut -c2- | grep -oEi -- "$patron" | grep -vE -- "$VALOR_PROSA" || true
  } | grep -vEi -- "$VALOR_BENIGNO" || true
}

citadas=$(citadas_de "$CLAVE_CITADA")
if [ -n "$citadas" ]; then
  echo "🔴 VALOR con forma de secreto: clave entre comillas (JSON/YAML)" >&2
  printf '%s\n' "$citadas" | head -3 | sed 's/^/     /' >&2
  hallazgos=$((hallazgos + 1))
fi

citadas_es=$(citadas_de "$CLAVE_CITADA_ES")
if [ -n "$citadas_es" ]; then
  echo "🔴 VALOR con forma de secreto: clave en español entre comillas (JSON/YAML)" >&2
  printf '%s\n' "$citadas_es" | head -3 | sed 's/^/     /' >&2
  hallazgos=$((hallazgos + 1))
fi

citadas_clave_compuesta=$(citadas_de "$CLAVE_CITADA_COMPUESTA")
if [ -n "$citadas_clave_compuesta" ]; then
  echo "🔴 VALOR con forma de secreto: clave/llave compuesta entre comillas (JSON/YAML)" >&2
  printf '%s\n' "$citadas_clave_compuesta" | head -3 | sed 's/^/     /' >&2
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
