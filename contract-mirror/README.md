# contract-mirror — App Backend → App Frontend

Espejo **de solo lectura** del contrato que el App Frontend consume. La fuente
de verdad continúa siendo el código del App Backend; esta carpeta no se importa
desde `src/` y nunca se corrige a mano.

## Procedencia congelada

- Fecha del refresh: **2026-08-07** (R3-A).
- Fuente local: `../payme-app-backend`.
- Commit exacto: `5c8436c7d3bb5efc1b8b53c95340ec6690877a50` (el commit
  espejado).
- **Procedencia del CONTENIDO: `aa28e842fe0332a54c80231b241ff4d57100c7fa`**
  (v2.47.0 · G-11 cerrado de verdad), que es lo que declara el inventario
  autoritativo. Son dos preguntas distintas y por eso hay dos hashes: el
  inventario no puede contener su propio hash, y `5c8436c` —el commit que lo
  publica— no cambió ningún archivo del contrato.
- Rama fuente: `codex/audit-2026-08-02-app-backend`.

**71 archivos espejados** más este README de procedencia — uno más que el
refresh anterior: `db/migrate_card_save_intents_v2.47.0.sql`, la migración del
cierre real de G-11.

### 🔴 LA POBLACIÓN LA DECLARA EL DUEÑO, no este repo

Hasta R3-A la lista de archivos salía de un manifiesto que este repo generaba
**desde el propio espejo**: el inventariado se inventariaba a sí mismo, así que
una omisión coordinada —borrar un archivo y regenerar— pasaba en verde. Ahora
la fuente de la población es `scripts/mirror-inventory.json`, copia verbatim
del artefacto que publica App Backend (`contract/mirror-inventory.json`), con
su mapeo **`origen → destino` explícito**: **siete de los 71 se espejan
renombrados** (`services/settlement.js` → `docs/settlement.js.ref`,
`docs/history/*` y tres `CHANGELOG_*` → `docs/*`). Compararlos por convención
daría "ausente" a archivos que sí están.

El gate (`scripts/verificar-mirror.mjs`) responde **tres preguntas separadas**:

| Modo | Pregunta | Sin la fuente |
| --- | --- | --- |
| `--integridad` | ¿el espejo es fiel al INVENTARIO? | ✅ es lo único verificable — **y no se llama paridad** |
| `--paridad` | ¿la FUENTE respalda al inventario en el commit declarado? | ❌ exit 2 · NO CERTIFICADO |
| `--vigencia` | ¿el contenido sigue igual en HEAD? | ❌ exit 2 |

Separar **integridad** de **vigencia** es la lección que el dueño pagó
primero: su `--check` gritaba con cada commit posterior aunque ningún archivo
del contrato hubiera cambiado, *"y un gate que grita por lo que no es un
desvío se termina ignorando"*. Que el HEAD avance no es un desvío del espejo.

**Verificado el 2026-08-07:** integridad ✅ 71/71 · paridad ✅ contra
`aa28e84` · vigencia ✅ (HEAD del backend no movió nada de lo espejado).

### ✅ G-11 CERRADO DE VERDAD (v2.47.0) · y la provisionalidad se levanta

**Registrado el 2026-08-07, tras reauditar.** El cierre anterior (`7e45db0`,
v2.46.0) **fue refutado**: tenía cinco huecos, y el peor era que la wallet
nativa **se adjuntaba a Stripe ANTES de validarla** — *"rechazar después de
mutar no es rechazar"*, escribe el propio dueño. Este espejo consumía ese
hash, así que el consumo (`0d9c475`) quedó marcado PROVISIONAL.

**`aa28e84` (v2.47.0) lo cierra en serio, y lo verifiqué en el código
espejado, no en el anuncio:**

- **La elegibilidad se verifica ANTES de cualquier mutación remota**
  (`services/savedCards.js`, "1) ELEGIBILIDAD ANTES DE CUALQUIER MUTACIÓN
  REMOTA"). El hueco refutado está cerrado en su causa, no en su síntoma.
- **La promesa CONVERGE**: la intención de guardar se registra en
  `card_save_intents` (migración nueva, `db/migrate_card_save_intents_v2.47.0.sql`
  — el archivo 71) y un sweep la resuelve. Si el guardado falla por timeout,
  **la tarjeta aparece en el tick siguiente en vez de perderse**.
- **Cero campos nuevos**: el contrato que este front consume no cambió de
  forma. El consumo de `0d9c475` sigue siendo correcto y ahora está
  respaldado de verdad.
- Sigue siendo **no-op para wallets** (`method !== 'card'` → rechazo
  terminal) y para guest, que es lo que el mock espeja.

🔴 **Límite declarado del mock:** el real puede guardar **eager o en el tick
siguiente**; el mock guarda siempre sincrónico tras el éxito. Es una
diferencia de MOMENTO, no de forma — el mock no puede modelar un Stripe que
falle sin inventar un disparador de fallas que este repo no tiene. Lo
observable para la UI (la tarjeta aparece en `GET /payment-methods`) coincide.

### Qué trajo el refresh a v2.46.0 · el primer intento de cierre de G-11 (refutado)

Cuatro archivos (`routes/mesas.js`, `routes/webhooks.js`,
`services/savedCards.js`, `docs/settlement.js.ref`) y **ningún campo ni
request nuevo: el cambio es de COMPORTAMIENTO.**

- `POST /mesas/:code/pay` (y la garantía de `POST /mesas`) con
  `save_payment_method: true` + tarjeta tipeada → **la tarjeta APARECE en
  `GET /payment-methods`** tras el éxito del cobro — guardado sync sin 3DS,
  o vía webhook de éxito con 3DS. Attach del **pm_ FUENTE** al Customer de
  PayMe (nunca el clon de la cuenta conectada), misma semántica que el vault
  `POST /payment-methods`. Best-effort: un fallo del guardado jamás rompe el
  cobro ya hecho.
- La guardada se reutiliza como siempre (`payment_method_id` → off_session,
  en cualquier restaurante). `save_payment_method` sigue siendo **no-op para
  guest** y para **wallets nativas** (que siguen 422).

### Qué trajo el refresh a v2.45.0 · tres archivos, todo aditivo

**El gate de admisión de la mesa muerta (ratificado por Mati el 2026-08-06)**
— la ventana que la auditoría de este front descubrió arreglando el mock:

1. **`utils/stateMachine.js` · `mesaViva()`**: UN predicado — viva =
   `open | partially_paid | fully_paid` — clasificación EXHAUSTIVA sobre la
   máquina de estados, con `fully_paid` viva A PROPÓSITO (decisión B: pagada
   entera pero no cerrada admite gente).
2. **`routes/invitations.js` · las dos puertas de entrar** contestan
   **`410 { error: 'mesa_not_joinable', mesa_status }`** cuando la mesa no
   está viva — código DISTINTO del `409 mesa_not_invitable` (crear) y del
   `410 invitation_expired`, porque el front necesita copys distintos. En
   `accept-link` el 410 sólo llega DESPUÉS del 403 opaco: revela estado de
   mesa únicamente a quien probó un token válido.
3. **`GET /invitations` MARCA, no filtra**: cada fila suma `mesa_joinable`
   (computado en JS con el MISMO `mesaViva()` — no en SQL, que sería una
   segunda expresión de la regla desincronizándose sola) y `mesa_status`
   para el copy. El front lee `mesa_joinable` DIRECTO, sin inferir.

`docs/settlement.js.ref` acompaña (el cierre toma el mismo lock que el gate:
la mesa no puede morir entre el chequeo y el INSERT del participante).

### Qué trajo este refresh · cinco archivos, ningún cambio que rompa

El backend fue de v2.34.4 a v2.42.0 y del espejo se movieron cinco archivos.
**Los dos cambios de contrato son ADITIVOS**: nada de lo que este front ya
consume cambió de forma.

1. **`routes/mesas.js` · `GET /mesas/open` cierra G-28.** La mesa abierta pasa a
   ser de **todos sus participantes**, no sólo de quien la abrió: `opener_user_id
   OR EXISTS(mesa_participants … status='active')`. **Mismo shape, más filas** —
   quien se sumó por un link deja de tener una mesa invisible mientras debe
   plata. El criterio de participante no es nuevo: es el que ya usaban
   `requireMesaParticipant` e `invitationAuthority`.
2. **`routes/account.js` · `GET /account/history` agrega `mesa_status`.** Clave
   nueva en cada renglón; las siete anteriores intactas. 🔴 **La granularidad NO
   cambió: sigue siendo UN RENGLÓN POR PAGO**, y el emisor lo fijó con test
   porque esa misma respuesta alimenta `PagosScreen`, que es superficie
   card-only ratificada. La agregación por mesa se queda en el front, donde
   `groupByMesa()` ya la hace. **No pedir que cambie.**
3. **`routes/config.js` + `services/walletRail.js` · el riel wallet se endurece,
   no se afloja.** `wallet_rail.enabled` dejó de ser un literal `false` y sale
   del servicio autoritativo, que **eliminó la env var `LEGACY_WALLET_ENABLED`**:
   ya no existe variable de entorno que reabra la creación de obligaciones
   nuevas. `account_activity: true` no se movió — historial y estadísticas
   propias siguen siendo card-only ratificado. Este front lo lee igual, en
   `src/api/walletRail.ts`, y sigue fallando cerrado.
4. **`docs/settlement.js.ref` · gate Connect tipado (OLA 4B)** en el camino de la
   garantía: una cuenta no apta falla cerrada en vez de degradar a plataforma.
   No cambia ningún shape que este front consuma.

### ORDEN 5 · el espejo NO quedó atrasado, y esto lo dice sin ambigüedad

El refresh se hizo contra `39c9f72` (v2.34.2) y el backend avanzó después a
`a79938e` (v2.34.4). **Ningún byte del espejo cambió**, y es verificable: entre
las dos versiones el backend tocó **sólo `package.json` y `tests/http.test.js`**
—dos arreglos de un flake de PQ-2—, y **ninguno de los dos está espejado**.

La verificación de ORDEN 5 contra `a79938e` dio **70 idénticos · 0 diferencias ·
0 sin fuente**, sin copiar nada.

**Por qué se actualiza igual la procedencia:** declararla en `39c9f72` mientras
los bytes corresponden también a `a79938e` hace creer que el espejo está
atrasado dos versiones — de hecho pasó, y motivó esta verificación. Un texto que
describe un estado que no es, es una orden latente. El hash apunta ahora al
commit contra el que la paridad está **verificada**, que es lo que la
procedencia debe significar.

**Límite declarado:** `contractMirror.test.ts` valida que el hash tenga 40
caracteres, **no** que sea el HEAD del backend — no puede, porque
`../payme-app-backend` está fuera de la raíz de Vite. Que la procedencia esté al
día se acredita corriendo el script, no con la suite.

Ese commit es un candidato **local** de auditoría. No se afirma push, CI remoto,
deploy, Railway, Stripe real ni producción. Las corridas de suite que el emisor
declara en sus mensajes de commit (588 tests / 35 suites) son **suyas y no se
verificaron desde este repo**; el backend permanece NO-GO técnico/de release por
los bloqueos que se enumeran abajo.

### 🔴 EL CONTEO HEREDADO ESTABA MAL, Y EL NÚMERO ERA LO DE MENOS

Los refreshes anteriores declararon **67/67** y **68/68**. Los dos números eran
falsos, y por el mismo motivo: el comando de enumeración usaba
`find . -type f | grep -v README.md` —**sin anclar**—, así que descartaba
silenciosamente **dos** archivos, no uno:

- `README.md`, este archivo, que es la única exclusión legítima;
- **`legal/README.md`, que es un archivo ESPEJADO con fuente real**
  (`payme-app-backend/legal/README.md`).

O sea que había un archivo del espejo que **nunca se verificó contra su fuente**
y que no entraba en ningún conteo. Que hoy resultara idéntico fue suerte, no
método. El error de conteo era el síntoma; el agujero de verificación era el
defecto.

**Enumeración correcta al 2026-08-04** _(histórico; el número vigente está
arriba)_: **70 archivos espejados en ese momento** más este
README de procedencia. Eran 69 antes de agregar `services/walletRail.js` en este
refresh — el 69 que midió la reauditoría era el número correcto de ese momento.

**Corregido con estructura, no con cuidado:** `contract-mirror.test.ts` enumera
el árbol y falla si el inventario cambia sin que se actualice este README, y
compara el número escrito acá contra el número real. Un conteo a mano es un
borrador; esto es un método.

**Límite declarado:** ese test **no** puede comparar byte a byte contra la
fuente, porque `../payme-app-backend` está fuera de la raíz de Vite. La paridad
byte a byte se verifica al refrescar, con el script que este README documenta, y
su resultado se registra abajo.

### Qué cambió en este refresh (`330a645` v2.32.0 → `39c9f72` v2.34.2)

Seis archivos difieren y **uno se agrega**:

- `routes/topup.js`, `routes/transfers.js`, `routes/spei-funding.js`,
  `routes/mesas.js` ← `679161d`: **el riel wallet ahora falla cerrado en el
  BACKEND**, con `410 feature_removed`. Ver abajo, porque refuta algo que este
  repo daba por cierto.
- `routes/auth.js` ← `679161d`: el alta **ya no acuña** una fila de wallet.
  Registrarse sigue funcionando: es card-only legítimo.
- `services/invitationAuthority.js` ← `a7027b7`: corrige por escrito que
  `resolveLinkToken` **no es** una extracción sino una **segunda copia** del
  predicado de autorización.
- `services/walletRail.js` — **agregado al espejo.** Es el gate central y define
  el cuerpo de error `410 feature_removed` que este front puede recibir.

### Qué había cambiado en el refresh anterior (`db48cf6`, v2.31.0)

**El cierre del pago sin cuenta.** Cuatro archivos, uno de ellos nuevo en el
espejo:

- `routes/invitations.js` ← `211fccd`: `POST /accept-link` deja de ser un 501 y
  canja el token por una INSCRIPCIÓN.
- `routes/mesas.js` ← `fc3f7cb`: `GET /:code`, `items/lock` y `pay` pasan de
  `guestOrAuth` a `requireAuth`. **Éste es el cierre.**
- `services/invitationAuthority.js` ← `211fccd`: `resolveLinkToken`, el
  predicado único de "este token autoriza entrar a esta mesa".
- `utils/tokens.js` — **agregado al espejo en este refresh.** No estaba y ahora
  hace falta: es el hash y la verificación del token que este front custodia a
  través del alta.

### Qué había cambiado en el refresh anterior (`e8a3faf` → `db48cf6`)

Sólo **dos** de los 67 archivos espejados difieren, los dos de OLA 5:

- `routes/config.js` ← `9d874c4`: `GET /api/config` publica
  `features.wallet_rail`, la capability **global y autoritativa** que hasta acá
  no existía. Ver abajo.
- `services/notifications.js` ← `5e210fd`: el emisor deja de crear cinco tipos
  de aviso del riel saldo, y agrega `friend_request_received` (OLA 3C).

Los otros 65 quedaron byte-idénticos, así que este refresh **no toca** ninguna
superficie de dinero, garantía, invitaciones ni schema.

## Reglas

1. El mirror se **refresca copiando**; no se parchea.
2. Todo archivo espejado, salvo este README, debe ser byte-idéntico a su fuente.
3. Si `src/` necesita un campo o endpoint inexistente, se registra en
   `../GAPS.md`; el front no inventa contrato ni lo simula en silencio.
4. Los archivos de `db/` y `services/` son evidencia para comprender autoridad,
   retries y estados; no convierten detalles internos en API pública.
5. Un hash local no acredita que esa versión esté publicada. La procedencia se
   actualiza recién al refrescar desde otro commit concreto.

## Qué se espeja

| Destino | Fuente | Motivo |
| --- | --- | --- |
| `routes/*.js` | todas las rutas del backend | paths, auth, errores y response shapes |
| `schemas/index.js` | schema Zod real | request bodies, límites y enums |
| `middleware/auth.js` | middleware real | Bearer, guest token y participación |
| `db/schema.sql`, `db/migrate_*.sql` | schema y migraciones | CHECKs, estados, columnas y unicidad |
| `services/connect.js` | gate Connect | cuenta conectada y merchant-of-record |
| `services/cardEligibility.js` | política de tarjeta | marca/funding/ownership fail-closed |
| `services/paymentIntentContract.js` | contrato Stripe durable | campos y evidencia de PaymentIntent |
| `services/paymentAttemptReconciler.js` | reconciliación | replays y estados ambiguos |
| `services/paymentMethodLifecycle.js`, `savedCards.js` | lifecycle de PM | attach/detach y tarjeta activa |
| `services/invitationAuthority.js` | autoridad social | actor, destinatario y token canónico |
| `services/itemClaims.js` | tenencia de consumos | locks, fracciones y casilleros |
| `services/topupProcessor.js` | contrato legacy de topup | replay mientras el wallet siga dormido |
| `services/consent.js` | PQ-1/PQ-2 | consentimiento y edad autoritativa |
| `utils/money.js`, `stateMachine.js`, `idempotency.js` | primitivas compartidas | centavos, FSM y hash de requests |
| `utils/tokens.js` | emisión y verificación de tokens de invitación | formato v2 vs legacy del token que el front conserva |
| `services/walletRail.js` | gate central del riel saldo | el `410 feature_removed` que el front puede recibir |
| `legal/README.md` | avisos legales | contexto; **estuvo espejado y sin verificar hasta ORDEN 3A** |
| `docs/settlement.js.ref` | `services/settlement.js` | referencia de cierre/garantía |

Los changelogs y READMEs históricos se conservan como contexto, no como estado
vigente. `docs/CHANGELOG_v2.28.8.md` describe el candidato fuente.

## Contrato vigente relevante

### Configuración y capacidades

`GET /api/config` publica la versión desde `package.json` y expone:

- `features.apple_pay: false`;
- `features.google_pay: false`;
- `features.stp_dispersal` sólo como capacidad de dispersión del restaurante;
- `features.ocr_real` desde el modo OCR;
- `features.wallet_rail` con `enabled` y `account_activity` (v2.31.0);
- `features.account_birth_date` con `supported`,
  `registration_required`, `write_once` y
  `adulthood_server_authoritative`.

Apple Pay y Google Pay están ratificados como MUST post-auditoría, pero este
commit no implementa una hoja nativa ni prueba física. `false` es la única
capacidad honesta hasta que eso exista.

#### 🔴 CORRECCIÓN · publicar la capability NO apagaba el riel

**Afirmación previa de este repo, REFUTADA (ORDEN 3A):** que con
`wallet_rail.enabled=false` en `/api/config` el riel quedaba apagado y la
autoridad quedaba del lado del backend.

**Publicar una capability hace autoritativa la DECLARACIÓN, no la EJECUCIÓN.**
Entre `9d874c4` (v2.31.0) y `679161d` (v2.33.0) el backend **seguía aceptando**
topups, transferencias, emisión de CLABE, garantía wallet y pago wallet, y el
alta **seguía acuñando una fila de dinero electrónico** por cada usuario nuevo.
La capability decía "apagado" mientras los endpoints funcionaban.

Desde `679161d` el gate existe de verdad: `services/walletRail.js`, gobernado
por `LEGACY_WALLET_ENABLED` (apagada por defecto, parsing estricto — un typo no
la deja encendida en silencio), y **siete entrypoints devuelven
`410 { error: 'feature_removed', code: 'feature_removed' }`**.

Consecuencia para este front, y es la que importa: **el apagado de la UI nunca
fue el gate de dinero, y no lo es ahora tampoco.** Lo que este repo lee es una
declaración para no ofrecer lo que no existe; quien impide una obligación wallet
nueva es el backend. Las dos capas son necesarias y ninguna sustituye a la otra.

#### `features.wallet_rail` — la capability que corrige un defecto de autoridad

Hasta v2.30.1 el riel saldo estaba apagado **porque este front lo apagaba** con
una constante propia. Eso contradecía la constitución, que manda la capability
**global y autoritativa del backend**: un deploy del front con otro valor lo
reencendía sin que el backend se enterara. Ahora existe, y el front la **lee**.

Lo que el emisor declara en `routes/config.js` y hay que respetar acá:

- `enabled` es **constante, no bandera**: no se lee de `process.env`, ni del
  usuario, ni del rol, ni del restaurante ni de la sucursal. Reactivar wallet es
  una orden nueva con IFPE y ratificación, jamás una variable de entorno.
- **Ausencia de la clave = backend previo a OLA 5**, y el consumidor debe leerla
  como **APAGADO**. Acá el fail-closed cae del lado seguro, y por eso —a
  diferencia de `account_birth_date`— no hay booleano `supported`.
- `account_activity` viaja **separado a propósito**: `GET /api/account/history` y
  `GET /api/account/stats` leen `payment_attempts`, **no** tablas de wallet, y la
  ratificación manda conservarlas. Es exactamente la superficie card-only que
  `07f0ba2` escondió en este repo por fundir los dos gates. El emisor tiene un
  test que falla si los dos valores vuelven a moverse juntos; este repo tiene el
  suyo (`walletRail.test.ts`).
- El emisor compara el juego de claves **CERRADO**, así que un campo nuevo tipo
  `enabled_for_restaurant` —justo el permiso por cuenta que la ratificación
  prohíbe— rompe su suite. Este repo aplica el mismo conjunto cerrado del lado
  del consumidor y **falla cerrado**, porque un backend distinto del espejado no
  es una hipótesis: es el caso normal de un deploy desincronizado.

### Autenticación y cuenta

- Registro y login devuelven access/refresh tokens; refresh rota la sesión y
  detecta reutilización.
- `birth_date` sigue gobernada por la capability de PQ-2; el servidor decide
  adultez y la fecha es write-once.
- Los decoders del front deben rechazar cualquier 2xx que no contenga el shape
  contractual completo; un 2xx malformado no es éxito.

### Mesas, garantía y pagos

- `POST /api/mesas` y `POST /api/mesas/:code/pay` exigen evidencia idempotente
  durable. El mismo intento conserva key, payload y `pm_`; un resultado
  ambiguo se reintenta exactamente, no se transforma en una operación nueva.
- Dinero viaja como centavos enteros seguros y bps; no se aceptan floats.
- Garantía y pago pueden responder `requires_action` con `client_secret` y
  `connected_account_id`; el front confirma 3DS en la cuenta indicada.
- Tarjetas guardadas y tipeadas verifican marca, funding, customer, cuenta y
  ownership. Attach/detach/pago/garantía comparten un lifecycle durable.

### Invitaciones

- La autoridad natural define una invitación pendiente por mesa, actor y
  destinatario/link. Retries equivalentes convergen aunque cambie la key.
- Tokens raw sólo se muestran cuando el contrato lo permite; aceptar, cancelar
  o inspeccionar nunca cruza actor.
- El front debe conservar los errores de conflicto como autoridad del servidor,
  no crear una invitación paralela.

### Cierre del pago sin cuenta (v2.32.0) — el contrato que este front espeja

`GET /mesas/:code`, `POST /mesas/:code/items/lock` y `POST /mesas/:code/pay`
**ya no aceptan invitado**. Sin sesión responden **`401`, no `403`**, y la
distinción es de producto, no de protocolo:

- **401** = *"necesitás cuenta"* → llevar al alta **conservando el token**;
- **403** = *"no sos de esta mesa"* → otra pantalla y otro mensaje.

Tratar el 401 como 403 manda a la gente a la pantalla equivocada justo en el
momento que el cierre viene a arreglar.

**`POST /api/invitations/accept-link`** · requiere sesión · body `{ token }`:

| Respuesta | Cuándo |
| --- | --- |
| `200 { joined, mesa_code }` | canjeado |
| `400 invitation_token_required` | sin token, o fuera de 8..200 caracteres |
| `401` | sin sesión |
| `403 invitation_link_not_valid` | inválido, vencido, cancelado **y** supersedido |
| `503 invitation_link_unavailable` | no se pudo **verificar** (falta el secreto de firma) |

**Los cuatro motivos del 403 son indistinguibles a propósito:** separarlos le
diría a un desconocido si una mesa existe. El front **no** debe inventar copy
que los distinga — misma doctrina que el 202 ciego de `POST /friends`.

**El 503 NO es un rechazo** y no se puede fundir con el 403: el emisor lo
declara explícitamente porque *"un 403 afirmaría que el token no sirve"*. Es
reintentable.

Propiedades del canje que el front asume y el mock replica: el link es
**MULTIUSO** (canjearlo no lo consume ni lo marca `accepted`), el canje es
**idempotente** (dos veces = una inscripción activa), y la atribución es por
`user_id`. **Las atribuciones legacy por `guest_token_hash` NO se heredan.**

`guestOrAuth` quedó con **cero call sites** en el backend; sus ramas de invitado
siguen en pie pero inalcanzables. Este repo hace lo mismo: `httpGuestRequest`,
los parámetros `guestToken` de la fachada y las ramas `isGuest` de `MesaScreen`
quedan durmientes e intactos.

#### 🔴 CORRECCIÓN · `resolveLinkToken` NO es una definición única

**Afirmación previa, del emisor y espejada acá, REFUTADA:** que el predicado
"este token autoriza entrar a esta mesa" quedaba con **una sola definición**.

Es falso y el propio emisor lo corrigió en `a7027b7`: `middleware/auth.js`
conserva su **segunda copia** del predicado, v2 y legacy, sin refactorizar. El
drift que aquel mensaje decía haber eliminado **sigue existiendo** — hoy en
código sin call sites, porque ninguna ruta usa `guestOrAuth`. Si alguien vuelve
a colgarlo de una ruta, reactiva un predicado de autorización **sin un solo
test**, porque los tests de invitado se movieron todos al servicio.

Para este front la consecuencia es acotada pero real: **no se puede razonar
sobre la semántica de un token leyendo sólo `resolveLinkToken`.** Los alias
legacy y la cadena de supersesión se resuelven ahí con reglas propias
(`source.expires_at` **y** `canonical.expires_at`, y la canónica vía
`COALESCE(source.superseded_by_id, source.id)`), que no son las mismas líneas
que las del middleware.

### OCR y staff

- OCR acepta un único archivo `image`, máximo 8 MiB, con MIME y magic bytes
  compatibles. Tipo inválido → 400; archivo grande → 413; multipart truncado →
  400. Multer está en 2.2.0.
- `GET /api/restaurants/:rid/staff` es administrativo: requiere sesión y rol
  manager/owner.
- `GET /api/restaurants/:rid/staff/active` continúa público para selección de
  propina y sólo devuelve `id`, `role` y `display_name`.

## Baseline de producto ratificado

### Wallet durmiente

El wallet no se elimina. El plan ratificado post-auditoría debe sacarlo de la
UI y hacerlo fallar cerrado por flags, conservando código, schema, rutas,
historia y tests. El front no debe usar wallet/STP/topup/transfer como fallback.
Reactivar requiere gate IFPE.

**Estado en el commit fuente (v2.31.0), corregido respecto del refresh anterior:**
el apagado **empezó** y son dos piezas, las dos verificables en este espejo:

1. `routes/config.js` publica `features.wallet_rail.enabled: false` — la
   autoridad del apagado, arriba.
2. `services/notifications.js` deja de crear cinco tipos del riel saldo:
   `topup_succeeded`, `topup_failed`, `topup_pending`, `transfer_received` y
   `transfer_sent`. El gate está en el servicio y **no** en los tres emisores,
   y devuelve `null` **antes de tocar la base** para no abortar la transacción
   de dinero que envuelve al llamador. Los llamadores quedan intactos y
   durmientes: **no se borró nada**.

**`tip_received` NO está suprimido, y es deliberado del emisor:** avisa a un
mesero —persona identificada— de plata acreditada a su nombre, que es obligación
legacy. Este front **no debe** filtrarlo por analogía.

Lo que sigue sin implementarse en el backend es el resto de OLA 5: el inventario
wallet y el apagado de las rutas/obligaciones legacy.

### Apple Pay y Google Pay

Son MUST y deben permitir el primer pago sin tarjeta previamente guardada,
mediante hoja nativa y cero tipeo. El `pm_` de wallet nativo es efímero: muere
con la hoja y no sirve para cargos off-session. Cuentas Junior necesita una
tarjeta guardada del padre; Apple/Google Pay no la reemplaza.

## Bloqueos que el front debe respetar

1. **P0 — Connect no falla cerrado.** `resolveChargeTarget()` puede retornar
   `null` cuando faltan flag/secreto/cuenta apta y el backend conserva el cargo
   de plataforma/STP. El MVP card-only no ratificó ese fallback.
2. **P0 contractual / P1 de implementación backend — `save_payment_method`
   bajo direct charges.** La intención se acepta y queda sellada, pero el direct
   charge omite `setup_future_usage`, customer y espejo de bóveda. Es P0 como
   gate de la promesa de UI y P1 como defecto técnico inventariado del backend.
3. **P1 — D1-E.** Falta el flujo de disputas con devolución explícita de la
   comisión PayMe.
4. **P1 — D1-D.** Faltan avisos y el auto-refund ratificado para pagos tardíos
   inequívocos de hasta MXN 2.000.
5. **P1 privacidad cross-repo.** Items y tips del outbox pueden salir con
   cohorte uno; faltan `tables_count`, min-sample uniforme y retracción.
6. **P1 integridad de agregados.** Sin mapping `restaurant_branches`, el emisor
   hace skip sin quarantine/replay.

Por estos puntos el App Frontend puede cerrar calidad local y espejo, pero no
queda autorizado a release/piloto.

## Verificación byte a byte

El refresh de **ORDEN 3A** comparó **70/70** archivos contra su fuente exacta en
`39c9f72`: **70 idénticos, 0 diferencias, 0 sin fuente**. Es la primera
verificación que incluye `legal/README.md`, que las anteriores descartaban sin
saberlo. El script enumera desde el árbol con `find`, aplica los mapeos
especiales de abajo y compara con `cmp`, contando por separado idénticos,
distintos y sin-fuente — así "no hay diferencias" no se confunde con "no
comparó nada". Los `docs/` se
comparan por su mapeo especial, no por path. Mapeos especiales:

- `contract-mirror/docs/settlement.js.ref` ↔
  `payme-app-backend/services/settlement.js`;
- `contract-mirror/docs/CHANGELOG_v2.28.8.md` ↔
  `payme-app-backend/CHANGELOG_v2.28.8.md`;
- `contract-mirror/docs/CHANGELOG_v2.11.md` ↔
  `payme-app-backend/docs/history/CHANGELOG_v2.11.md`;
- `contract-mirror/docs/CHANGELOG_v2.13.md` y
  `CHANGELOG_v2.14.md` ↔ sus pares en la raíz de `payme-app-backend/`;
- `contract-mirror/docs/README_v2.10_CONSOLIDADO.md` y
  `README_v2.5.2.md` ↔ sus pares en `payme-app-backend/docs/history/`;
- los demás paths se corresponden por nombre.

La única diferencia deliberada sin par fuente es este README de procedencia.
