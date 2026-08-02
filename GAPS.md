# GAPS — datos/endpoints que el front necesita y el contrato del App Backend no cubre

---

## ✅ B-06 — RESUELTO (front 0.28.0 + backend v2.25.0) — Reintento tras respuesta perdida COBRA DOS VECES

**Hallado el 2026-07-25** en la revisión adversaria del diff de Connect (no lo
introduce ese cambio: es preexistente). **Reportado al backend el 2026-07-25;
respondido, verificado por ellos contra base, plan acordado y ejecutado.**

**Cerrado el 2026-07-25.** Backend v2.25.0 (idempotencia en `POST /mesas`,
replay con el shape del 201, 409 sobre estados terminales, `claimed_by_me`) +
front 0.28.0 (clave estable derivada del contenido, congelamiento del intento
sin confirmar, timeout de 30s). Detalle del lado del front en el CHANGELOG.
**Falta la verificación del ciclo en vivo contra el backend desplegado** antes
de darlo por cerrado también de su lado.

`MesaScreen` genera `idempotency_key: newIdempotencyKey()` DENTRO de cada
llamada a pagar (`src/screens/MesaScreen.tsx`, en el payload de `doPay`), así
que un reintento NUNCA reusa la clave: la idempotencia del backend —que está
bien implementada— queda inalcanzable desde el front. El único camino que hoy
la ejerce es el retry-tras-refresh 401 de `http.ts`, que reenvía el mismo body.

Escenario (se pierde la RESPUESTA de un pago YA procesado — wifi del
restaurante, wifi→4G, tab suspendida por iOS; nuestro `fetch` no tiene
timeout, así que el cuelgue puede durar minutos):

1. El comensal toca Pagar; el backend cobra (o, en wallet, debita inline).
2. Se pierde la respuesta. El front muestra "No pudimos procesar el pago.
   Probá de nuevo.", rehabilita el botón y **no recarga la mesa** (es la única
   rama de error sin `reload()`).
3. El comensal reintenta → clave NUEVA → `findExistingAttempt` no encuentra
   nada → segundo cobro.

**Las DOS ramas de división cobran de nuevo** (la versión anterior de esta
entrada decía que `consumo` estaba a salvo: **era falso**):

- **`igual`**: el `SELECT … status='available' … FOR UPDATE SKIP LOCKED`
  saltea el slot ya tomado y agarra **el siguiente: la parte de OTRO
  comensal**. La mesa cuadra para el restaurante y llega a `fully_paid`
  normal; el damnificado es el último comensal, que recibe
  `no_slots_available` y se va creyendo que estaba cubierto.
- **`consumo` con FRACCIONES**: el claim propio en vuelo no es liberable
  (correcto, es el fix de B-05), pasa a `others`, y si queda espacio el
  reintento **crea una fracción nueva y la cobra**. Lo prueba el propio CI del
  backend: `tests/http.test.js:948-996` hace tres pagos de ⅓ del mismo ítem,
  mismo usuario, tres claves distintas → tres 201. `item_already_paid` solo
  frena con el ítem ENTERO ya pagado.

**Severidad por riel**: wallet es la peor (débito inline confirmado y sin
camino automático de reversa). Tarjeta plataforma = refund manual. Tarjeta
Connect = sale del balance del restaurante, con D1 re-abierta.

### Hallazgo hermano, MÁS GRAVE — `POST /mesas` (garantía) sin idempotencia

`createMesa` **no acepta `idempotency_key`** (verificado en el schema del
backend): el mismo accidente en la creación de mesa no tiene defensa posible
desde el front. El backend lo reprodujo y corrigió la severidad que habíamos
estimado: **no es doble hold, es doble CAPTURA** — la mesa fantasma se liquida
sola a los 30 minutos y la garantía cobra el total (en su prueba el wallet del
organizador bajó $1.000 reales), y además emite eventos al dashboard, así que
el restaurante ve **facturación inexistente**.

### Plan acordado con el backend (2026-07-25)

**Ellos entregan** (4.1 y 4.2 en el MISMO release, más el resto):
- `idempotency_key` en `POST /mesas`, misma mecánica que en pagar (aditivo).
- **409 explícito para attempts terminales** (`failed`/`cancelled`) y, para el
  resto, replay `200` con el **mismo shape que el 201** (`client_secret`,
  `requires_action`, `status`) + `gross_amount_cents` numérico.
- Arreglo del orden de `items` en el hash (ordenado por `item_id`, con test).
  Ojo: NO por el normalizador existente — hace `String()` sobre objetos, y ½ de
  A + ¼ de B hashearía igual que A y B enteros = cobro perdido.
- `claimed_by_me` en los slots del GET, y telemetría del segundo slot.
- **NO** hacen el guard rígido de un-slot-por-usuario (coincidimos: no cubre
  `consumo` fraccional, da falso positivo tras 3DS abandonado, y es decisión
  de producto sin acta — ver la pregunta abierta de abajo).

**✅ EL BACKEND YA DESPLEGÓ — v2.25.0, verificado en producción (2026-07-25).**
Detalles del contrato nuevo que la implementación del front DEBE respetar:
- `POST /mesas` acepta `idempotency_key` (opcional). Replay → `200 {mesa,
  guarantee, idempotent:true}`; payload distinto → `409 idempotency_conflict`.
- **Mesa muerta** (garantía fallida/cancelada/vencida) → `409
  idempotency_key_terminal`: rotar la clave y abrir mesa nueva.
- Si el 3DS quedó pendiente, **el replay SÍ devuelve `client_secret`** (no es
  de un solo uso — corrigieron su propia suposición).
- Si el proceso murió antes de colocar la garantía, el reintento **re-conduce
  el hold sobre la misma mesa** en vez de dejar la clave trabada.
- Replay de pagos: `failed`/`cancelled`/`cancelling` → `409
  idempotency_key_terminal`. El resto → `200` con el shape del 201
  (`client_secret`, `requires_action`, `tip_cents`, `payment_type`,
  `gross_amount_cents` numérico).
- ⚠️ **`refunded` NO da 409, a propósito**: ese pago SÍ se cobró, y un 409 nos
  haría rotar la clave y **re-cobrar un reembolso**. Llega como replay `200`
  con `status:'refunded'` → tratarlo por el status, nunca rotar.
- `items` ya no rompe por orden (igual los mandamos ordenados).
- `claimed_by_me` en `division_slots` (solo los propios, nunca de terceros) —
  habilita el selector de varias partes.

**PENDIENTE DEL FRONT (decisión de Mati en curso, no codear todavía):**

**Nosotros, RECIÉN CUANDO ELLOS DESPLIEGUEN** (orden acordado, no invertible):
- Par `(clave, pm_)` cacheado por intento y reusado en el reintento; rotación
  en fallos DEFINITIVOS (402, 502, 409, 3DS rechazado — donde el slot ya se
  liberó) y conservación SOLO ante error de red.
- Tabla de status del replay ANTES de tocar la clave.
- `items` ordenados por `item_id` (defensa en profundidad).
- `AbortController` con timeout ≥30s, `reload()` en la rama genérica, y la
  clave en `sessionStorage` (con `useRef` el bug vuelve si el usuario recarga).
- Mismo tratamiento en `TransferScreen` y `TopupScreen` (la transferencia es
  irreversible; el topup OXXO puede emitir dos vouchers válidos).
- Espejar la idempotencia en el mock, o el fix no es demostrable.

**Por qué NO se toca la clave antes:** hoy B-06 tapa el replay-sobre-terminal.
Reusar la clave sin el 4.2 cambiaría un doble cobro por un **comprobante de un
pago que nunca se cobró**. Ambos equipos coincidimos en convivir unos días con
B-06 (no hay usuarios reales) antes que abrir ese agujero.

### Pregunta de producto — RESUELTA CON ACTA (2026-07-25)

**¿Puede una persona pagar DOS partes de la mesa?** → **SÍ, y el producto DEBE
ofrecerlo.** Acta ratificada:
`ops/actas/[PAYME]_ACTA_2026-07-25_PAGAR_VARIAS_PARTES.md`.

Consecuencias para este bug:
- El guard "un usuario = un casillero" queda **vetado formalmente** (era la
  recomendación de §5 de nuestro reporte; ahora está ratificada).
- El acta confirma que **la idempotencia es el mecanismo correcto y
  suficiente**: distingue INTENCIÓN (llave nueva = quiero pagar otra parte)
  de ACCIDENTE (misma llave = reintento). Nuestro fix no necesita ningún
  límite adicional.
- La telemetría del segundo casillero (pedido 4.4) queda como **señal, no
  como bloqueo**.

El acta además habilita un tier de front (selector de casilleros, copy y
comprobante en plural) que **no se anticipa sin plan y OK de Mati**.

---


## 🟠 B-05 — v2.18.1: el re-lock del mismo dueño libera claims de un pago exitoso con webhook pendiente

**Hallado el 2026-07-23 verificando fracciones contra el backend vivo v2.18.1.**

Repro (mismo usuario, mesa consumo, ítem de $70.00): pagar ⅓ con tarjeta y,
INMEDIATAMENTE (sin esperar el webhook), volver a lockear el mismo ítem.

- Corrida A (sin pausas): el 2º y 3º `POST /pay` devolvieron **409** y el ítem
  quedó `status=paid` con `remaining_bps=6667` (⅓ pagado) — inconsistente.
- Corrida B (con pausas de 1.5s): ⅓+⅓+⅓ funcionó PERFECTO (2333+2333+2334,
  absorción incluida, `paid` al 100%). Pero un lock extra INMEDIATO sobre el
  ítem ya 100% pagado devolvió **200** (esperado 409 `fraction_not_available`)
  y el GET quedó `status=paid` con `remaining_bps=834`.

Lectura VERIFICADA contra el código real del backend (2026-07-23, HEAD ya en
v2.19.0 — `itemClaims.js` sin cambios desde v2.18: el bug sigue vigente).
**La causa es DOBLE**:

1. `acquire()` (itemClaims.js:117-122) libera los claims `locked` del dueño
   sin mirar `payment_attempt_id`: el camino tarjeta nunca marca `paid`
   inline (mesas.js:774-782 solo actualiza el attempt), así que un claim de
   un attempt YA `succeeded` con webhook pendiente sigue `locked` — y el
   re-lock lo libera y lo pisa.
2. Amplificador: al llegar el webhook, `markAttemptPaid` encuentra 0 claims
   `locked` y `processSuccessfulPayment` cae al fallback COMPAT pre-v2.18
   (paymentProcessor.js:56-86) que marca el ítem ENTERO `paid` vía
   `payment_attempt_items` → `status=paid` con `remaining_bps>0` y plata sin
   cobrar (la termina absorbiendo la garantía del organizador).

Con esa mecánica ambas corridas cuadran al bps (A: 6667 = 10000−3333 del
re-lock huérfano; B: 834 = 10000−6666−2500) y los 409 de la corrida A son
`item_already_paid`, no `fraction_not_available`. Hermanos del mismo patrón
detectados en la misma verificación: `releaseExpired` (itemClaims.js:82-89)
libera vencidos atados a attempt (el sweep del timer SÍ los excluye,
timer.js:169); el UPDATE de liberación no re-chequea `status='locked'`
(TOCTOU con `markAttemptPaid`, que muta claims sin el FOR UPDATE del ítem);
gemelo en `processRefund` (paymentProcessor.js:480-504, a auditar). Fix
recomendado: allowlist — liberable ⇔ `payment_attempt_id IS NULL` o attempt
en `('failed','cancelled')` — en `acquire` Y `releaseExpired`, + estrechar el
COMPAT (si el attempt tiene claims, alertar y NO marcar paid). Prompt
completo entregado a Mati el 2026-07-23 para la sesión del backend.

**Impacto front**: NO bloquea el flujo real (tras pagar se navega al
comprobante; nadie re-lockea lo recién pagado en segundos). El mock del front
implementa la semántica del acta (correcta). Post-fix el front NO cambia:
el `409 fraction_not_available` + `remaining_bps` ya se maneja desde 0.21.0.

**Estado: RESUELTO** en app-backend **v2.19.1** (2026-07-24). El fix es el
predicado allowlist recomendado, aplicado en `acquire` Y en `releaseExpired`
(tenencia comprometida = claim atado a attempt vivo, intocable; liberable
solo sin attempt o con attempt `failed`/`cancelled`), más el estrechamiento
de los fallbacks COMPAT a attempts genuinamente pre-v2.18. Los dos
escenarios de la repro quedaron como tests de integración permanentes en el
CI del backend, y los dos ítems corruptos de las corridas del 2026-07-23
(PA-2102 y PA-1202) fueron reparados en la base. **Verificado por el front
con e2e contra el vivo (2026-07-24, mesas PA-1386 y PA-7741, 11/11 verde):**

- Re-lock inmediato con ⅓ propio en vuelo → **200 con fracción ADICIONAL**;
  tras el webhook el ítem queda ⅓ `paid` + ⅓ `locked` (remaining 3334,
  `my_bps` 6666) y los pagos siguientes dan 201 — el ítem cierra `paid`
  exacto (23.33 + 23.33 + 23.34).
- Lock extra inmediato sobre ítem 100% comprometido → **409
  `fraction_not_available` con `remaining_bps: 0`**; tras el webhook el GET
  queda `paid` / remaining 0 / `my_bps` 10000.

Espejo refrescado a v2.19.1 (`services/itemClaims.js` con `isReleasable`).
El front no necesitó ningún cambio.

---

## 🟠 B-04 — `requireMesaParticipant` no seleccionaba `code` (ensuciaba ledger + Stripe)

Hallado el 2026-07-19 al verificar el fix v2.14.1. **Estaba tapado por B-01**:
como el endpoint nunca respondía, nadie vio que la fila venía incompleta.

`middleware/auth.js` → `requireMesaParticipant` usaba `code` en el `WHERE` pero
**no lo seleccionaba** — ni en la consulta con JOIN ni en el fallback. Como
`req.mesa.code` quedaba `undefined`, se filtraba a TODO lo que lo consuma aguas
abajo (todo eso lee `const mesa = req.mesa`):

| Superficie | Qué quedaba roto |
| --- | --- |
| `GET /api/mesas/:code` | respuesta sin la clave `code`; `full_name: "Mesa undefined - …"` |
| `POST /:code/pay` | `wallet_transactions.description = "Pago mesa undefined"` — texto del ledger |
| `POST /:code/pay` | metadata `mesa_code: "undefined"` en el PaymentIntent de Stripe — traza de conciliación |

**Alcance real: solo TEXTO de traza.** Nunca tocó montos, ni el `balance_cents`,
ni la idempotencia, ni ningún cálculo de dinero — únicamente ensuciaba con
"undefined" la descripción del movimiento y la metadata de Stripe. No hubo plata
en riesgo en ningún momento.

Corroboración de que era un olvido y no criterio: el otro endpoint del mismo
archivo, `GET /mesas/open`, **sí** hacía `SELECT m.id, m.code, …`.

**Estado: RESUELTO** en v2.14.2 (`ef1006c`). El backend agregó `m.code` al
`SELECT` con JOIN (`auth.js:151`) y `code` al fallback (`auth.js:162`).
Re-verificado por el front el 2026-07-20 contra el backend real v2.14.3:

```
GET /api/mesas/PA-8859  →  code="PA-8859", full_name="Mesa PA-8859 - La Parolaccia"
wallet_transactions.description (tras un pago real)  →  "Pago mesa PA-8859"   (se acabó el "undefined")
```

**Estado del front:** ya no dependía de esto (la pantalla de mesa usa el código
de la ruta, que es más correcto igual). No hizo falta ningún parche.

---

## 🔴 B-01 — BUG BLOQUEANTE del backend (no es un gap: es un defecto)

**Hallado el 2026-07-19 durante T7, corriendo el backend v2.14.0 real contra
PostgreSQL 18. Reproducible al 100%.**

`middleware/auth.js` → `requireMesaParticipant` (línea ~147) ejecuta:

```sql
SELECT id, restaurant_id, opener_user_id, total_cents, paid_amount_cents,
       tip_amount_cents, division_mode, expected_participants,
       status, expires_at, metadata, fee_pct
  FROM mesas m
  LEFT JOIN restaurants r ON r.id = m.restaurant_id
 WHERE m.code = $1
```

`id`, `status` y `created_at` existen en **ambas** tablas, así que Postgres
aborta con `42702: column reference "id" is ambiguous`. La consulta **lanza**
(no devuelve 0 filas), por lo que el fallback sin JOIN de las líneas
siguientes es inalcanzable y el `catch` responde `500 mesa_check_failed`.

**Alcance — los tres endpoints del núcleo del producto quedan caídos:**

| Endpoint | Qué rompe |
| --- | --- |
| `GET /api/mesas/:code` | Nadie puede **abrir el detalle de una mesa** |
| `POST /api/mesas/:code/items/lock` | Nadie puede **reservar sus consumos** |
| `POST /api/mesas/:code/pay` | **NADIE PUEDE PAGAR** |

Crear la mesa y garantizarla sí funciona (`POST /api/mesas` no usa ese
middleware), así que el dinero se retiene pero después no se puede cobrar.

**Arreglo (verificado contra la base, NO aplicado — ese repo es de solo
lectura y esto merece acta):** calificar las columnas.

```sql
SELECT m.id, m.restaurant_id, m.opener_user_id, m.total_cents, m.paid_amount_cents,
       m.tip_amount_cents, m.division_mode, m.expected_participants,
       m.status, m.expires_at, m.metadata, r.fee_pct
  FROM mesas m
  LEFT JOIN restaurants r ON r.id = m.restaurant_id
 WHERE m.code = $1
```

**Por qué el CI no lo detecta:** las suites que tocan base están gateadas por
`DATABASE_URL_TEST`/`RUN_DB_TESTS` y varias están en skip declarado, así que
este camino nunca se ejerció contra un Postgres real.

**Estado: RESUELTO** en v2.14.1 (`1a4a7a0`, CI verde). Verificado por el front
el 2026-07-19 contra el backend real: `GET /mesas/:code` 200, `items/lock` 200,
`/pay` 201. El backend sumó `tests/sql-runtime.test.js`, que ejecuta estas
consultas contra el Postgres del CI en cada push.

---

## 🔴 B-02 y B-03 — `ON CONFLICT` contra un índice único PARCIAL

Hallados por el equipo del backend al barrer la capa SQL a partir de B-01.
**Los verifiqué de forma independiente contra Postgres 18 el 2026-07-19.**

`uq_mesa_participants_user` es un índice único **parcial**:

```
CREATE UNIQUE INDEX uq_mesa_participants_user
    ON mesa_participants (mesa_id, user_id) WHERE (user_id IS NOT NULL)
```

Postgres exige repetir ese predicado en el `ON CONFLICT`; sin él no puede
inferir el árbitro y aborta con `42P10` — **falla siempre, haya o no
conflicto** (es error de planificación, no de ejecución).

| # | Dónde | Endpoint que rompe | ¿Afecta a este front? |
| --- | --- | --- | --- |
| **B-02** | `routes/invitations.js:71` (`DO UPDATE`) | `POST /api/invitations/:id/accept` → 500 | **Sí**: aceptar una invitación in-app desde la pantalla de Avisos |
| **B-03** | `routes/mesas.js:721` (`DO NOTHING`) | `POST /api/mesas/:code/invitations` con `type:'in_app'` → 500 | **No hoy**: el front solo genera invitaciones `type:'link'`, que no pasan por ese `ON CONFLICT`. Bloquearía "invitar por PayMe ID" cuando se construya |

Verificación propia: `GET /api/invitations` responde 200 con los datos
completos; `POST /:id/accept` responde `500 {"error":"42P10"}`. Repitiendo el
predicado (`ON CONFLICT (mesa_id, user_id) WHERE user_id IS NOT NULL`) el
INSERT funciona.

**Estado: RESUELTOS** en v2.14.1. Verificado por el front:
`POST /invitations/:id/accept` → `200 {"accepted":true}`. No hizo falta ningún
parche del lado del front (se decidió a propósito no meter workarounds).

---

Regla del repo: acá se ANOTA, no se implementa ni se mockea en silencio.
Cada gap se lleva al dueño del contrato (`payme-app-backend`, vía Mati), que
decide si y cuándo entra. Cuando se resuelva, se actualiza este archivo y la
UI.

Nota: los deltas A-1 (garantía), A-2 (semántica de expiración) y A-3 (SPEI)
NO son gaps — ya están resueltos en el backend v2.13 y son trabajo de
primera clase de este front (ver CLAUDE.md).

| # | Qué falta | Dónde impacta | Qué hace el front mientras tanto | Estado |
| --- | --- | --- | --- | --- |
| **G-15** | `GET /api/topup/:id` existe para reconciliar estados, pero un replay `requires_action` puede no traer `client_secret`: el front recupera el estado, pero no puede reconstruir el desafío 3DS sin una forma contractual de recuperar ese secreto vivo. | Topup con tarjeta y 3DS/reintentos B-06. | Hace polling por id y conserva el journal; si no hay evidencia terminal, bloquea una nueva carga con copy honesta. | **Pendiente ORDEN 2A:** App Backend debe ratificar recuperación segura de `client_secret` o semántica alternativa de reanudación. Corregido en auditoría 2026-08-02. |
| **G-14** | `contract-mirror/routes/mesas.js` no refleja el contrato B-06 vigente: `idempotency_key_terminal`, replay terminal y `claimed_by_me`. | Reintentos y evidencia de pago propio. | El Front consume el comportamiento desde el Backend real contrastado en auditoría; no se modifica el espejo unilateralmente. | **Pendiente ORDEN 2C:** refrescar espejo desde Backend final con procedencia. |
| **G-10** | **Pivote a Stripe Connect (2026-07-24): el contrato no expone el `statement_descriptor` del pago con tarjeta.** Con Connect, el merchant of record de un pago con tarjeta pasa a ser el restaurante, pero el descriptor exacto lo define la cuenta Connect y solo lo conoce el backend. | Comprobante del pago. | El nombre del restaurante proviene de `mesa.restaurant.name`; descriptor ausente degrada sin subtexto. | Pendiente contractual. |
| **G-13** | **🔴 PQ-2 / D-03 BLOQUEADO: no hay por dónde escribir `birth_date`.** `POST /auth/register` (schema `register`) acepta SOLO email, phone, password, first_name, last_name — `birth_date` no está, y como `validateBody` hace `req.body = r.data` sobre un `z.object` no-strict, **mandarla devuelve 201 y la descarta en SILENCIO**. Barrido completo del backend: las 7 rutas de `account.js` son GET; ningún PATCH/PUT del repo toca `users`; los `UPDATE users` del código vivo solo escriben `stripe_customer_id` y `email_normalized`; el único `INSERT INTO users` es el de register, con lista de columnas explícita sin `birth_date`. Las únicas escrituras son SQL directo en `tests/consent.test.js`. Además **`last_name` es `z.string().min(1)` → OBLIGATORIO**, y D-03 pide registro sin apellido. | **Todo el workstream de datos.** Sin fecha, `POST /account/consents/perfilado_campanas/grant` devuelve **403 `age_verification_required` para el 100% de los usuarios** (D-11 falla cerrado, a propósito) → la pantalla de consentimiento no se puede construir tampoco. | **Nada.** No se codea la pantalla: mostrar un campo cuya respuesta el backend tira a la basura sería mentirle al comensal, y el fallo sería INVISIBLE (mock verde porque `mockRegister` hace spread del body; real 201). Tampoco sirve mandar un relleno en `last_name`: se renderiza en `PerfilScreen.tsx:18,20` (título y semilla de las iniciales) y `GroupsScreen.tsx:73,76` — se vería la basura en pantalla. | **Pedido (3 piezas + 2 preguntas, todo en el mismo release):** (1) un **endpoint para escribirla después del alta** (p. ej. `PATCH /api/account/me`) — sin esto, las cuentas YA creadas quedan bloqueadas para siempre, porque su registro ya pasó; (2) `birth_date` opcional en `POST /auth/register`, formato calendario `YYYY-MM-DD` por regex (**no** `z.string().datetime()`); (3) `last_name` opcional — **no hace falta migración**: la columna es NOT NULL pero alcanza `.optional().default('')` en el schema. Preguntas: ¿la fecha es **write-once**? (si es editable, un menor la cambia y saltea el gate); ¿`GET /account/me` puede devolver `birth_date` o un `birth_date_set`, para que el front sepa si preguntarla? Anotado 2026-07-25 · **bloqueante de PQ-2, PQ-4 y de la pantalla de consentimiento**. |
| G-12 | **`features.apple_pay` / `features.google_pay` de `GET /api/config` están HARDCODEADOS en `true`** (`routes/config.js`, líneas del objeto `features`), a diferencia de sus vecinos `stp_dispersal` y `ocr_real`, que sí leen `process.env`. El backend afirma dos capacidades que no cumple: esos `payment_type` son legales en el schema, pero el refine exige `stripe_payment_method_id` y no hay integración con la Payment Request API de Stripe, así que un pago con Apple/Google Pay devuelve **400**. El archivo no se toca desde v2.11 (el backend va por v2.26.0), su propio `version` dice `2.5.2` y no hay ningún test que lo cubra. | Pantalla de pago de mesa (`MesaScreen`) en la app real. | Se ocultan por build (`WALLET_PAY_ENABLED` en `src/api/index.ts`: encendido en la demo, apagado en cualquier build real). **Sin borrar código**: el `PaymentType`, la etiqueta del comprobante y el bloque del mock quedan intactos. Decisión de Mati 2026-07-25. | **Pedido**: que `apple_pay`/`google_pay` pasen a leer entorno (o queden en `false`) hasta que exista la integración, para que el interruptor viva en el contrato y no en nuestro build. **OJO: NO es un flip de variable en Railway — son literales en el código, así que bajarlos es release + deploy del backend que mueve dinero.** Por eso va como seguimiento **post-27/07** (freeze hasta el 28/07) y **no bloquea nada**: el ocultamiento ya está resuelto del lado del front. Anotado 2026-07-25. |
| G-11 | **No hay forma de saber ANTES de pagar si el riel de tarjeta es DIRECTO** (Stripe Connect, backend v2.24): cuando el restaurante tiene cuenta conectada, el backend IGNORA `save_payment_method` (guardar la tarjeta ahí la dejaría en la bóveda del restaurante — verificado en `routes/mesas.js` rama `wantsSave && connectTarget` y en `services/settlement.js` `savePm && target`). El front solo se entera al RECIBIR la respuesta, por el `connected_account_id`. | El checkbox **"Guardar esta tarjeta para la próxima"** (garantía y pago) se muestra prendido y puede no cumplirse. | Paliativo honesto ya implementado (0.27.0): si se pidió guardar y la respuesta trae `connected_account_id`, un toast avisa que esta vez no quedó guardada. | **Pedido**: una señal PRE-pago del riel — p. ej. `card_rail: 'direct' \| 'platform'` (o `saves_cards: boolean`) en `GET /mesas/:code` y/o `GET /restaurants/:id`. Con eso el front oculta el checkbox en vez de prometer algo que no va a pasar. Anotado 2026-07-25 · no bloqueante (el cobro funciona igual). |
| G-09 | **Agregado mensual de gastos por categoría server-side** (nice-to-have): la torta de Cuenta (T-F1, 0.25.0) se computa en el front desde `GET /account/history` pidiendo el mes con `from` + `limit=100` (máximo del contrato). Con >100 pagos en un mes, trunca. Un `GET /account/stats` con breakdown por categoría lo resolvería exacto y barato. | Torta de gastos en Cuenta (feedback del hermano de Mati). | El paliativo actual (mes completo hasta 100 pagos) alcanza de sobra para el MVP. | Anotado 2026-07-24 (nice-to-have, sin urgencia) |
| G-01 | No hay endpoint para listar/buscar restaurantes, pero `POST /api/mesas` exige `restaurant_id` (uuid) y valida que exista y esté `active`. El OCR mock tampoco devuelve restaurante. | Abrir mesa (T2): sin un `restaurant_id` real no se puede crear mesa contra el backend. | En mock, el adaptador expone restaurantes de demo con uuids fijos. Para T7 (backend real) hace falta o un endpoint (`GET /api/restaurants`) o uuids seedeados conocidos. | **RESUELTO en backend v2.21.0 (2026-07-24) — front conectado en 0.24.0**: `GET /api/restaurants/:id` (público) → `{ restaurant: { id, name, category, address\|null } }`, 404 `restaurant_not_found` para inexistente/suspendido/uuid malformado; `GET /api/restaurants?q=` (público, solo active, limit 20, búsqueda literal). El front resuelve el restaurante por el QR de la mesa (`?r=<uuid>`, con `VITE_RESTAURANT_ID` como fallback demo), avisa ANTES de armar la mesa si el QR no corresponde, y el nombre dejó de hardcodearse en el deploy (`VITE_RESTAURANT_NAME` retirado). Verificado en vivo (200/404/404-malformado/búsqueda) y en mock (QR de Hanzo Sushi resuelto en el header). |
| G-02 | No hay endpoint de perfil propio (`GET /api/me` o similar). `POST /auth/register` devuelve `user`, pero `POST /auth/login` devuelve SOLO tokens — tras un login no hay forma de saber nombre, `payme_id` ni email del usuario. | Home ("Hola, Mati"), Perfil (T5), y cualquier pantalla que muestre identidad. | En mock no afecta. Contra backend real: persistir el `user` de register en localStorage es parche parcial (no sobrevive login en otro device). | **RESUELTO en backend v2.20.0 (2026-07-24) — front conectado en 0.23.0**: `GET /api/account/me` → `{ user: { id, payme_id, email, first_name, last_name, phone\|null, created_at } }` y el login ahora devuelve `user` (mismo shape que register; el refresh no — el endpoint cubre el restore). Verificado en vivo (200 con shape exacto, 401 `auth_required` sin token). El front borró el paliativo del email (`identity.ts` derivaba el nombre del local-part) e hidrata las sesiones persistidas pre-v2.20 con `GET /account/me` al restaurar. |
| G-03 | `GET /api/account/balance` devuelve `balance_cents` total pero no `held_balance_cents`. Con garantía wallet activa, el usuario "ve" saldo que no puede gastar (el backend calcula disponible = balance − held y devuelve 402). | Cuenta (T5) y pago con saldo (T4): el saldo mostrado puede no ser el gastable. | La UI dice "Tu saldo PayMe" (no "disponible") y maneja el `402 {available, required}`, que sí trae el disponible real. | **RESUELTO en backend v2.21.0 (2026-07-24) — front conectado en 0.24.0**: el balance suma `held_balance_cents/_display` y `available_cents/_display` (`available = balance − held` server-side; el `available` del 402 coincide). La card de Cuenta ahora dice **"Disponible $X"** + línea "🔒 Retenido en garantías: $Y" cuando hay hold; el ojito del Home y Transferir muestran el disponible. Verificado en mock (garantía wallet de $60 → Disponible $235 + Retenido $60 exactos) y en vivo (shape con los 6 campos). |
| **G-04** | **`POST /api/mesas` con `guarantee_method:'card'` exige `stripe_payment_method_id` (`pm_…`), pero `GET /api/payment-methods` NO expone ese campo** (solo el `id` uuid interno). No hay forma de garantizar una mesa con una tarjeta ya guardada. Nótese que `POST /:code/pay` sí acepta `payment_method_id` uuid — la asimetría parece un descuido. | **Bloquea el flujo principal de A-1 en T7**: el organizador tendría que tipear su tarjeta completa cada vez que abre una mesa, aunque ya la tenga guardada. | Con backend real, garantizar con tarjeta obliga a pasar por Stripe Elements y crear un `pm_` nuevo cada vez. Alternativa sin fricción: garantizar con **saldo** (wallet), que no necesita Stripe. | **RESUELTO en backend v2.16.0 (D4, 2026-07-22)**: `GET /payment-methods` ahora expone `stripe_payment_method_id` (pm_…) junto al `id` uuid, y la garantía acepta **`payment_method_id` (uuid) para tarjeta guardada** además de `stripe_payment_method_id` para tarjeta nueva. `save_payment_method` (default false) guarda la tarjeta tipeada desde la propia garantía o pago. Front conectado en v0.12.0 (selector en garantía y pago, checkbox guardar). Verificado contra el backend vivo. |
| **G-08** | **Platos COMPARTIDOS entre comensales (fracciones)** — decisión de producto pendiente de acta, pedida por Mati 2026-07-23: hoy un ítem lo toma UNA persona entera (lock exclusivo). Falta que 2+ comensales puedan tomar fracciones del mismo plato (1/2, 1/3…) y que la suma de fracciones cierre. Nota: seleccionar UNIDADES de un "×2" ya quedó resuelto en el front (0.20.0 expande cantidades en filas-unidad al crear la mesa, sin cambio de contrato) — este gap es SOLO la fracción de un mismo plato. | El caso real "compartimos la pizza": hoy uno de los dos la paga entera o nadie puede marcarla. | El front presentó a Mati dos opciones con recomendación (fracción declarada al pagar, cobro inmediato y garantía cubre faltantes — recomendada — vs división retroactiva al cierre de la mesa, que exige ajustes/refunds post-pago). Cuando haya acta y el backend publique el contrato (lock/pago fraccional), el front suma el control "compartir plato". | **RESUELTO — backend v2.18.1 EN VIVO y front conectado en 0.21.0**: lock/pay fraccionales (`items: [{item_id, fraction_bps}]`, 2500\|3333\|5000\|10000), `remaining_bps`/`my_bps` en el GET, montos server-side (nominal + la completadora ajusta + tolerancia <100 bps absorbe). E2E real: ⅓+⅓+⅓ de $70.00 = 23.33+23.33+23.34 exacto, ítem `paid` al 100%. UX en una línea con pills Entero·½·⅓·¼, hint "queda X" y preview replicando `fractionAmount`. Ver B-05 (anomalía de carrera hallada en la verificación). |
| **G-07** | **El backend NO persiste `item_ids` cuando la división es en partes iguales**: en `POST /:code/pay`, `payment_attempt_items` solo se escribe en la rama `consumo` (routes/mesas.js, rama `igual` toma un slot e ignora los ítems). El front (0.19.0, pedido de Mati) ahora EXIGE marcar lo consumido también en partes iguales y manda `item_ids` — el contrato los acepta pero se descartan. | **El modelo de negocio**: los agregados de consumo del dashboard (item_aggregate/association) pierden todos los datos de las mesas divididas en partes iguales. | El front ya captura y envía la selección; cuando el backend la persista (sin lockear ni cambiar montos: es informativa), los datos fluyen sin tocar el front. | **RESUELTO en backend v2.18.1** (junto con las fracciones): la rama igual ahora inserta `payment_attempt_items` con los `item_ids` que el front ya mandaba. Verificado en el código espejado (routes/mesas.js, rama legacy/igual). |
| G-05 | No hay endpoint para registrar tarjetas *guardadas* usables en la garantía: `POST /api/payment-methods` guarda el `pm_` en la DB pero, por G-04, ese `pm_` no vuelve a salir. | Igual que G-04. | Si se resuelve G-04 exponiendo `stripe_payment_method_id` en el GET, este gap se cierra solo. | **RESUELTO en backend v2.16.0** — se cerró junto con G-04, tal como estaba previsto. |
| G-06 | Dudas de contrato que el texto del acta D4 dejaba abiertas (ids de topup/default/delete si el `id` pasaba a `pm_…`; destino de `bank_name`/`type`/`display`). | Topup con tarjeta, gestión de tarjetas en Cuenta. | — | **RESUELTO de nacimiento por la publicación v2.16.0** (mismo día que se anotó): el backend mantuvo `id` uuid para `:id`/topup y conservó `bank_name`/`type`/`display`; el `pm_` viaja en un campo nuevo. Ninguna pantalla necesitó cambios de contrato. |
