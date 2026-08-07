# GAPS — datos/endpoints que el front necesita y el contrato del App Backend no cubre

## Estado vigente de auditoría — 2026-08-04

Esta sección manda sobre las afirmaciones históricas del resto del archivo.
Las menciones antiguas a versiones "desplegadas", producción o verificaciones
en vivo son registro de su momento y **no acreditan el estado externo actual**.
La única fuente local de este cierre es App Backend
`330a645cf4ea12e0ac6fe1f397a956a3327666a8` (v2.32.0), espejada byte a byte en
`contract-mirror/` (68/68); no hubo push, deploy ni consulta a producción.

### Cierre del pago sin cuenta · espejado, sin gap abierto

El backend cerró `GET /mesas/:code`, `items/lock` y `pay` a sesión (401) y abrió
`POST /invitations/accept-link`. Este front lo espeja completo y **no le quedó
ningún hueco de contrato**: el circuito link → alta → canje → mesa cierra con lo
que el emisor publica.

Dos cosas que NO son gaps aunque lo parezcan, anotadas para que nadie las abra:

- **La pantalla de canje no puede mostrar nada de la mesa antes de canjear.** No
  falta un endpoint: `GET /mesas/:code` exige sesión y participación, y mostrarle
  el restaurante o el total a cualquiera con un link es justamente lo que el
  cierre saca de la mesa. Pedir un "preview público de mesa" sería reabrirlo.
- **El 403 no dice por qué.** Los cuatro motivos son indistinguibles a propósito.
  Pedir un campo `reason` sería pedir el oráculo que el contrato eliminó.

El frontend puede cerrar sus gates locales de calidad, pero el candidato sigue
**NO-GO de release/piloto** por estos bloqueos del ecosistema:

| Prioridad | Bloqueo vigente | Dueño / condición de cierre |
| --- | --- | --- |
| **P0** | Si Connect no está habilitado o el restaurante no tiene cuenta apta, `resolveChargeTarget()` puede devolver `null` y preservar el cargo plataforma/STP. Cambia merchant of record en vez de fallar cerrado. | App Backend + decisión de producto/dinero. El front no puede compensarlo ni usar wallet/STP como fallback. |
| ✅ ~~P0 contractual (G-11)~~ **CERRADO DE VERDAD (2026-08-07, v2.47.0 `aa28e84`, espejado en R3-A)** | El primer cierre (`7e45db0`) fue REFUTADO —cinco huecos; el peor: la wallet nativa se adjuntaba a Stripe antes de validarla—. `aa28e84` lo cierra en la causa: **elegibilidad verificada ANTES de cualquier mutación remota**, y la promesa **converge** (`card_save_intents` + sweep: si el guardado falla por timeout, la tarjeta aparece en el tick siguiente en vez de perderse). Cero campos nuevos: el consumo de `0d9c475` era correcto y ahora está respaldado. Reauditado leyendo el código espejado, no el anuncio. | — |
| **P1 (D1-E)** | No existe el flujo ratificado de disputas con devolución explícita de la comisión PayMe. | App Backend, con pruebas y observabilidad antes del release. |
| **P1 (D1-D)** | Los pagos tardíos quedan en revisión manual; faltan avisos siempre y el auto-refund ratificado para casos inequívocos de hasta MXN 2.000. | App Backend, sin ampliar la decisión ratificada. |
| **P1 privacidad** | Agregados de ítems y propinas pueden emitirse con cohorte uno; faltan `tables_count`, min-sample uniforme y retracción. | Contrato coordinado App Backend↔Dashboard Backend; nunca inventarlo en un front. |
| **P1 integridad de datos** | Si falta `restaurant_branches`, el emisor omite lifecycle/agregados sin cuarentena ni replay. | App Backend + gate operacional de cobertura de mapping al 100 %. |

**El apagado del wallet ya no es una promesa, y su autoridad ya no es del
front.** Estado al 2026-08-04:

- El riel saldo está apagado en real y en mock, **y quien lo declara apagado es
  el BACKEND**: `GET /api/config` publica `features.wallet_rail` desde v2.31.0 y
  este front lo lee (`src/api/walletRail.ts`). Ya no hay constante propia; la
  eliminamos para que nadie pueda leerla en vez de leer la capability.
- Falla cerrado: capability ausente, mal formada o red caída → riel APAGADO. Un
  campo con forma de permiso por cuenta/rol/restaurante lo apaga **y se
  denuncia**, porque la ratificación prohíbe ese permiso.
- `account_activity` viaja como campo SEPARADO y falla al revés —a conservar—:
  historial y estadísticas propias son card-only ratificado y esconderlas ante un
  fallo de red repetiría `07f0ba2`.
- El emisor dejó de mandar los cinco avisos del riel saldo (`5e210fd`). Este
  repo **no agregó ningún filtro de red** para taparlo: un test estructural falla
  si alguien lo agrega. Lo único que migra es el estado persistido de la demo.
- **Nada se borró:** `TopupScreen`, `TransferScreen`, los ocho métodos del riel y
  `payment_type: 'wallet'` siguen durmientes. Reactivar exige gate IFPE,
  auditoría y ratificación nueva — una orden, no una variable de entorno.

Apple Pay y Google Pay siguen siendo MUST post-auditoría para el primer pago
mediante hoja nativa, sin tarjeta previamente guardada y sin tipeo. Su `pm_`
efímero no sirve off-session ni reemplaza la tarjeta guardada del padre en
Cuentas Junior.

También continúa el STOP de registro PQ-2: el contrato técnico de fecha ya está
en el checkpoint y el espejo, pero D-03 todavía contradice el alta vigente
(teléfono/nombre/fecha/sin apellido vs email/password/apellido). La UI no usa
`registration_required` para elegir unilateralmente un modelo de registro.

**El bypass `?demo=1` ya no existe** (G-24, cerrado por eliminación el
2026-08-03). El párrafo que pedía sacarlo del control de la URL antes del piloto
quedó sin objeto y se elimina de acá: un texto que describe un estado que ya no
existe es una orden latente, y alguien iría a "arreglarlo" de nuevo.

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

Nota vigente: A-1 y A-2 continúan dentro del flujo card-only. A-3 (SPEI),
wallet, topups y transferencias quedaron supersedidos para el MVP por el acta
ratificada del 2026-08-02; su historia se conserva dormida bajo el plan de
apagado ya ratificado y pendiente de implementación, no como trabajo de
producto (ver CLAUDE.md).

## G-29 — el progreso de subida del ticket · **NO es un gap de contrato**

Va acá arriba y **fuera de la tabla a propósito**: la tabla se lleva al dueño
del contrato, y esto **no se le pide a App Backend**. Es deuda del riel de red
de este front, y se resuelve adentro de este repo con orden propia.

**Qué pide el spec.** `SPEC_APP.md` §1.6 enumera el estado *subiendo* como
"progreso real, no spinner infinito".

**Por qué hoy no se puede.** `api.scanTicket()` arma un `FormData` y lo manda
por `httpRequest` (`src/api/index.ts`), que es **`fetch`**
(`src/api/http.ts:76`). **`fetch` no expone evento de progreso de subida.** La
única API del navegador que lo tiene es `XMLHttpRequest`.

**Por qué no se cambió de paso.** `httpRequest` es el mismo por el que pasan
`POST /mesas`, `POST /mesas/:code/pay` y los refunds. Cambiarle el transporte
—o abrirle una segunda implementación— por una barra de progreso es tocar el
riel del dinero para arreglar una animación. Eso necesita su propia orden, con
su propia verificación de idempotencia, timeout y refresh rotativo.

**Qué hace la pantalla mientras tanto.** Dice **"Subiendo la foto…"**, sin
porcentaje y sin barra, con `aria-busy` en el marco y `aria-live` en el texto.
**No se simula progreso**: una barra que avanza sin medir nada es peor que no
tenerla, porque la persona la cree y espera con un número que es mentira.

**Cómo se cerraría.** Una ruta de subida propia sobre `XMLHttpRequest`, aislada
del `httpRequest` monetario y usada **sólo** por el OCR, con su
`upload.onprogress`. Anotado 2026-08-05 desde §1.6.

---

| # | Qué falta | Dónde impacta | Qué hace el front mientras tanto | Estado |
| --- | --- | --- | --- | --- |
| **G-36** | **No es un pedido de contrato: es deuda del riel de demo, anotada por orden del Bibliotecario (H-9 de la auditoría 2026-08-06).** Los vencimientos del seed son relativos a la PRIMERA carga (`iso(+12/26/29 min)`, `store.ts`) y el estado persiste en localStorage: a los ~30-45 min de sesión, todas las mesas abiertas del seed expiraron y la demo decae — le pasó al teléfono de Mati en plena noche de demos. | La demo larga: Inicio queda sin mesas, "Sumarme" desaparece (post-H-7) y el flujo sólo se recupera con **Más → Reiniciar la demo**. | "Reiniciar la demo" existe y cura todo, pero nada lo sugiere cuando el seed se pudrió. | ✅ **RESUELTO EN DOS TRAMOS — y sólo el segundo alcanza a los teléfonos que YA estaban rotos.** 🟢 **Tramo 1 (2026-08-07, orden 2-A.4) · entre sesiones, con seed NUEVO:** `relanzarSeedVencido()` corre AL HIDRATAR desde persistencia (nunca en caliente): las mesas con `seedRelanzable` —la parte viva de la demo— cuyo reloj quedó atrás y que el usuario NUNCA tocó vuelven a su estado sembrado con el vencimiento adelante, con la invitación atada al reloj de su mesa. Lo tocado (pago propio, canje, casillero o consumo reclamado) no se reescribe jamás; PA-1099 no lleva la marca (su historia ES estar cerrada); las mesas del usuario tampoco. La expiración real dentro de una sesión sigue intacta — se relanzan RELOJES entre sesiones, no se congelan. Acreditado con reloj controlado (`seedRelanzable.test.ts`: crear → +2 h → rehidratar → coherente) y mutante. 🟢 **Tramo 2 (2026-08-07, orden 1-C·B) · LEGACY MIGRADO:** un `localStorage` anterior a `67fc0de` no tiene la marca, y ése es justo el estado que ya estaba podrido en los dispositivos existentes. `migrarSeedLegacy()` se la pone **sólo a lo que se puede acreditar**: código en lista blanca (PA-1099 EXCLUIDA — su historia es estar cerrada), código único en el estado (los códigos nuevos salen del mismo rango y pueden colisionar), firma inmutable idéntica (total, modo, comensales, restaurante, `openedByUser`, `guarantee_method`), `paid_amount_cents` intacto, nadie la tocó (ahora **'guest' también cuenta**: es la misma persona), y la invitación sembrada todavía presente. La plantilla sale de una **tabla explícita**, nunca del estado persistido —que está sucio por definición— y un test la mantiene alineada con el seed. Todo corre en un `try/catch` propio: el de `loadPersisted` descarta el estado ENTERO. **Lo que no se acredita se CONSERVA**, y entonces Inicio ofrece la recuperación honesta ("Los datos de ejemplo de esta demo ya vencieron" + Reiniciar), sólo en mock. Acreditado con estado legacy real, reloj controlado y mutantes. |
| **G-35** | **No es un pedido de contrato: es deuda interna del router, anotada acá por orden del Bibliotecario para que no se pierda.** Una ruta desconocida escrita a mano (`#/saldo`, `#/zzz`) renderiza Inicio pero **deja el hash sucio** en la barra de direcciones; las rutas wallet retiradas sí normalizan a `#/home`. Medido en auditoría 2026-08-06. | Higiene de URL: un link compartido o guardado conserva un hash que no corresponde a nada. Cosmético. | Nada — el render es correcto (Inicio), sólo el hash queda sin normalizar. | **Deuda propia, sin dueño externo.** Tocar el router se decidió NO hacerlo durante la noche de auditoría. Queda para un barrido de router con sus tests. Anotado 2026-08-06. |
| **G-34** | **`GET /mesas/open` no trae ningún campo por-participante**: ni `my_paid_cents` ni `my_status` — es dato de mesa entera (verificado en `contract-mirror/routes/mesas.js:651`, la proyección no toca `mesa_participants` más que para autorizar). | El badge de la burbuja de Inicio (§1.1). Quien **ya pagó su parte** en una mesa `partially_paid` no puede leer un badge personal ("Ya pagaste, faltan otros"): el front no tiene con qué distinguirlo. | **Etiqueta genérica y honesta que describe a la MESA**: `partially_paid` → **"Pago en curso"** (`utils/labels.ts`, fuente única para burbuja y hoja de "+N mesas"). Corrección de honestidad del spec 2026-08-05: la etiqueta vieja "Falta pagar" se leía como deuda propia. **No se personaliza sin el dato** — fingir "ya pagaste" sin campo sería inventar un estado. | **Pedido aditivo al dueño del contrato (App Backend), CONDICIONADO:** recién cuando `/mesas/open` (o el detalle) publique el estado de pago DEL PARTICIPANTE corresponde una etiqueta personal real ("Ya pagaste, faltan otros" / "Te falta pagar"). La condición está escrita también en el spec §1.1. Hasta entonces, genérica-y-honesta gana a personal-y-falsa. Anotado 2026-08-06 desde la auditoría. |
| **G-33** | **El contrato no tiene un detalle de mesa CERRADA, y el que hoy funciona lo hace por coincidencia.** `GET /api/account/history` (`contract-mirror/routes/account.js:271`) devuelve el pago agregado por mesa —`amount_cents`, `date`, `restaurant`, `mesa_code`— y **no trae ítems**. `GET /mesas/:code` sí los trae y **no filtra por estado de la mesa** (`routes/mesas.js:613`), pero su autorización (`middleware/auth.js`, `requireMesaParticipant`) exige `mesa_participants.status = 'active'`: está construida sobre **participar ahora**, no sobre **haber participado**. El schema ya declara `'left'` (`db/schema.sql:368`) y el guard ya lo respeta; **nadie lo escribe todavía**. El acceso post-cierre existe por esa coincidencia, no por diseño. | Historial (§1.10). El spec pide un acordeón que despliega, en la fila de cada mesa cerrada, **sólo lo que consumió quien mira** — con fracciones prorrateadas (§1.5) y total propio. | **El acordeón no se implementa con datos reales.** No se arma sobre `GET /mesas/:code`: hoy anda y mañana lo apaga una función de producto normal —"dejar la mesa"— sin que nadie toque Historial. La lista de mesas cerradas SÍ se puede hacer entera con `/account/history`, incluida la franja horaria (`date` es timestamp completo, verificado). Si no hay confirmación a tiempo, la fila despliega el estado **desconocido** de `SISTEMA_DISENO.md` §5, nunca un mock que aparente funcionar. **Así quedó implementado (§1.10, 2026-08-05, v0.50.0):** el acordeón de `MesasScreen` despliega el desconocido con copy honesta; cuando el dueño del contrato conteste, ese acordeón es el único lugar a tocar. | **Pregunta al dueño del contrato (App Backend), y NO es aditiva:** ¿`GET /mesas/:code` post-cierre es uso soportado —y entonces la autorización debería mirar *haber participado*, no `status='active'`—, o hace falta un endpoint propio de detalle histórico proyectando sólo el consumo de quien pregunta? Va con la pregunta de retención elevada a Mati. Anotado 2026-08-05 desde §1.10. |
| **G-32** | 🔴 **El contrato no tiene invitaciones a grupo, y NO es un endpoint que falte: es otro modelo de producto.** Un grupo del contrato es **una etiqueta privada de UNA persona**, no una entidad compartida. `friend_groups` tiene `user_id` y `UNIQUE (user_id, name)` (`contract-mirror/db/schema.sql:683`); `GET /groups` filtra `WHERE g.user_id = $1` (`routes/groups.js:15`), así que **a quien agregás nunca se le avisa y el grupo no le aparece en su propio listado**; `POST /groups/:id/members` exige amistad aceptada e **inserta directo** con `201 {added:true}` (`:88`), sin dejar ningún estado pendiente que alguien pueda aceptar. Búsqueda de invitación de grupo en todo el espejo (`.js` y `.sql`, sin distinguir mayúsculas): **cero coincidencias**. | Solicitudes (§1.9). El spec pide adentro un **selector de pastilla Amigos / Grupos con su propio contador cada uno**, y filas *"Te invitó a {grupo}"* con **Aceptar** y **rechazar**, *"igual que el pedido de amistad, sin asimetría entre las dos listas"*. | **La pestaña sale con UNA lista —pedidos de amistad— y sin el selector.** No se construye la pastilla con el lado de Grupos vacío: un control cuyo segundo lado **no puede tener nada nunca** es exactamente la promesa vacía que el spec ya le negó al QR de Compartir (§1.7), a Cuentas Asociadas (§1.11) y a "Configuración" en `Más` — *una función real aparece cuando hay algo real detrás*. Tampoco se simula del lado del front: inventar una invitación que el emisor no emite es inventar contrato. | **Decisión de producto ANTES que pedido de contrato, y por eso no alcanza con un campo aditivo.** Que un grupo pase a ser compartido toca qué ES un grupo: tabla de invitaciones, estado de membresía, notificación al invitado y a quién le pertenece el grupo cuando lo integran varios. Requiere acta ratificada y después una orden coordinada App Backend↔App Frontend. **Mientras tanto el spec §1.9 tiene una mitad no implementable, y queda anotado ahí y acá.** Anotado 2026-08-05 desde §1.9. |
| **G-31** | **`GET /api/invitations` no dice de qué restaurante es la invitación, más allá del nombre.** La proyección es `id, mesa_id, invitation_type, status, expires_at, created_at, mesa_code, restaurant_name, inviter_*` (`contract-mirror/routes/invitations.js:22-36`): manda `r.name` y **ni `r.category` ni `r.id`**. Tampoco hay forma indirecta: `GET /restaurants/:id` es pública pero necesita el uuid, que la invitación no trae, y `GET /mesas/:code` exige ser participante — que es exactamente lo que todavía no sos cuando estás mirando la invitación. | Avisos (§1.8). El spec pide para la tarjeta de invitación un **"ícono de categoría del restaurante"**. | **Ícono genérico `store`, que no afirma ninguna cocina.** Antes había un **`sushi` hardcodeado**: eso no era un genérico, era decirle a la persona que el restaurante es japonés sin que nadie nos lo hubiera dicho. No se infiere del nombre —"Hanzo Sushi" es adivinar por subcadena y falla con cualquier nombre de fantasía— ni se pide `GET /restaurants/:id` sin uuid. | **Pedido al dueño del contrato (App Backend).** Campo aditivo: `restaurant_category` con el enum que ya existe en `restaurants.category` (`italian \| japanese \| mexican \| cafe \| other`), o el `restaurant_id` para resolverlo con el endpoint público que ya está. No cambia el shape. Anotado 2026-08-05 desde §1.8. |
| **G-30** | **El contrato NO expone quiénes están en una mesa, y es a propósito en todo salvo en un caso.** `mesa_participants` se INSERTA en tres lugares (`contract-mirror/routes/mesas.js:447`, `routes/invitations.js:102` y `:236`) y **no se SELECCIONA en ninguna respuesta**. `GET /mesas/:code` proyecta ítems, `division_slots`, `active_staff` y `my_role`, nada más: los slots ajenos van sin dueño —el comentario del propio contrato dice que "jamás expone de quién es el ajeno"— y `MesaItem` sólo trae `locked_by_me`. `GET /invitations` lista únicamente las **dirigidas al usuario actual** y **pendientes**, así que tampoco sirve para que el organizador vea a quién ya se le sumó. | Compartir (§1.7). El spec pide una pestaña **"Ya se sumaron"**: *"lista simple de quienes ya canjearon el link, mismo formato de fila que los contactos, sin botón de acción"*. Es una de las dos pestañas en burbuja de la pantalla; sin ella la pantalla no tiene el componente que el spec le pide. | **La pantalla no se implementa hasta resolverlo.** No se infiere de `division_slots` ni de los locks: eso listaría a quien **tomó algo**, que no es lo mismo que quien **se sumó**, y encima cruzaría la línea que el contrato cuida —los casilleros ajenos no tienen dueño visible—. Tampoco se arma con las invitaciones enviadas: quien entra por el link de WhatsApp nunca tuvo una fila de invitación in-app. | **Pedido al dueño del contrato (App Backend), y ojo que NO es sólo aditivo.** Listar participantes por nombre en una respuesta de mesa **es una decisión de privacidad**, no un campo más: hoy la mesa está construida para no decir quién es quién. La pregunta para el emisor es si el ORGANIZADOR —y sólo él, que ya es `my_role: 'opener'`— puede ver la lista de quienes canjearon, y con qué proyección (¿nombre de pila?, ¿`payme_id`?). Anotado 2026-08-05 desde §1.7. |
| **G-28** | ✅ **CERRADO POR EL EMISOR (backend v2.42.0, espejado el 2026-08-05).** `GET /api/mesas/open` ahora incluye las mesas donde el usuario es **participante activo** —`opener_user_id = $1 OR EXISTS(mesa_participants … status='active')`, `contract-mirror/routes/mesas.js:634-668`— con **el mismo shape y más filas**, que es exactamente lo que este gap pedía. El criterio no es nuevo: es el que ya usaban `requireMesaParticipant` e `invitationAuthority`. **El front no necesitó cambiar nada** salvo el mock, que reproducía el mismo filtro por `openedByUser` y por lo tanto el mismo defecto; ahora suma las mesas canjeadas por link, con test que muere si alguien vuelve al filtro viejo. Queda el texto original abajo, porque explica por qué esto importaba. ⌁ **Lo que sigue abierto es G-27**, que es otra cosa: el listado no dice cuánta gente hay en la mesa. ⌁ **Original:** **`GET /api/mesas/open` sólo lista las mesas que ABRISTE vos.** La query filtraba por `m.opener_user_id = $1` y es el **único** listado de mesas del contrato: `GET /mesas/:code` exige conocer el código y pasa por `requireMesaParticipant`. Entonces alguien que se sumó por un link —que es el circuito del momento mágico— **no tiene ninguna forma de encontrar la mesa en la que está** si pierde el link o cierra la app: su Inicio dice "No tenés mesas abiertas" mientras tiene una mesa abierta y plata por pagar. | Inicio (§1.1), donde la burbuja de la mesa es el objeto principal de la pantalla, y el historial (§1.10). Afecta al invitado, que es la mayoría de los comensales de cualquier mesa. | **Nada, y a propósito.** El front no puede inventar un listado que el contrato no expone, y adivinar códigos de mesa está fuera de discusión. La burbuja muestra el vacío real honesto —no dice "no hay", dice que no tenés mesas abiertas— pero el estado es correcto para el organizador y **engañoso para el invitado**, y eso no se arregla con copy. | **Pedido al dueño del contrato (App Backend).** Alcanza con ampliar la misma query a las mesas donde el usuario es participante (`mesa_participants`), que es el criterio que ya usa `requireMesaParticipant`; el shape no cambia. Anotado 2026-08-05 desde §1.1. |
| **G-27** | **`GET /api/mesas/open` no dice cuánta gente hay en la mesa.** La proyección devuelve `id, code, full_name, restaurant{name,category}, total_cents, paid_amount_cents, pct_paid, status, expires_at` (`contract-mirror/routes/mesas.js:597-607`): ni `expected_participants` —que existe en la tabla `mesas` y se usa en la creación (`:151`, `:406`)— ni un conteo real de participantes. | Inicio (§1.1). El spec pide textualmente la línea *"Mesa PA-2847 · 4 personas"* en la burbuja de la mesa abierta. | **La línea va sin el conteo: sólo "Mesa PA-2847".** No se infiere de `division_slots` ni de ningún otro lado — serían dos números distintos (los que el organizador declaró al dividir vs. los que efectivamente se sumaron) y el front no puede saber cuál quiso decir el spec. Un número inventado en la pantalla principal es peor que un dato de menos. | **Pedido al dueño del contrato (App Backend).** Campo aditivo en la proyección, sin cambiar el shape. **La decisión de fondo es del emisor:** si es `expected_participants` (los que se esperan) o el conteo de `mesa_participants` (los que están). Anotado 2026-08-05 desde §1.1. |
| **G-26** | **`OcrResponse` no trae ninguna señal por ítem de que el OCR no haya podido leerlo.** `POST /api/ocr` devuelve `{ items: [{name, price_cents, quantity, category?}], total_cents, mock }` (`contract-mirror/routes/ocr.js`, espejado en `src/api/types.ts:435`): no hay `confidence`, ni flag de no reconocido, ni marca de campo faltante. Un ítem que el proveedor leyó mal llega indistinguible de uno leído bien. | Ticket (§1.3). El spec pide una fila con borde punteado `--warning`, ícono de interrogación y placeholder *"¿Qué es esto?"* — el estado *desconocido* del sistema aplicado a una fila. | **No se implementa.** El spec lo deja además pendiente de ver en pantalla. El front NO lo infiere de `price_cents === 0` ni de un nombre vacío: serían heurísticas inventadas del lado del consumidor sobre un dato que el emisor no calificó, y pintarían de "no reconocido" ítems que el OCR sí leyó. Lo que sí existe hoy es el contraste del total impreso contra la suma de las filas, que detecta el agregado pero no señala cuál fila lo causó. | **Pedido al dueño del contrato (App Backend).** Alcanza con un campo aditivo y opcional por ítem — `confidence` numérico, o un booleano tipo `uncertain` — sin cambiar el shape existente. Anotado 2026-08-05 desde §1.3. |
| **G-25** | **`GET /api/friends/requests?direction=outgoing` delata si una cuenta existe, y con quién.** `POST /friends` está construido para NO decirlo: 202 idéntico en todos los casos, tiempo igualado con `pg_sleep`, `email` fuera de toda proyección y límite por usuario autenticado. Pero el backend sólo inserta la fila cuando el destino existe y está activo (`contract-mirror/routes/friends.js:136-151`), y el GET de salientes proyecta `payme_id, first_name, last_name` (`:206-232`). Entonces la pantalla siguiente entrega lo que el POST se negó a decir: **presencia/ausencia de la fila = la cuenta existe**, y encima con nombre y apellido reales de alguien que nunca aceptó nada. Con ~20 intentos/min por cuenta no es enumeración masiva, pero sí confirmación dirigida de un correo concreto + cosecha de PII. | Pantalla de amigos, sección "Enviadas". | **Mitigado del lado del front (2026-08-04), NO cerrado.** La vista saliente ya no lleva ningún campo de identidad: `outgoingRowView` proyecta `{requestId, requestedAt}` y la pantalla guarda ESO en su estado, así que la identidad se descarta en el borde de red y no puede pintarse. Además la lista dejó de recargarse justo después de enviar. **La señal presencia/ausencia sobrevive** — el contador sigue distinguiendo los dos casos — y eso no se puede cerrar del lado del consumidor sin inventar contrato. | **Pedido al dueño del contrato (App Backend).** Opciones para que decida el emisor: (a) que la solicitud saliente se cree SIEMPRE, exista o no el destino, y se descarte en silencio del lado del receptor; (b) que el GET de salientes devuelva la persona sólo cuando ya haya vínculo aceptado; (c) que la saliente se proyecte con un identificador opaco. Anotado 2026-08-04. |
| **G-24** | ✅ **CERRADO POR ELIMINACIÓN (2026-08-03).** El build `/live/` aceptaba `?demo=1` y sustituía Stripe Elements por el PaymentMethod público de test `pm_card_visa`, además de saltear la cámara OCR, y cualquier visitante podía activarlo desde la URL. | Garantía y pago con tarjeta del artefacto que apunta al backend configurado. | **El modo demo ya no existe.** Se eliminaron `IS_DEMO`, `DEMO_BUILD_ALLOWED`, `demoFlagInUrl`, `allowsDemoMode`, `DEMO_PM_ID`, la variable `VITE_ALLOW_DEMO` y las 21 ramas que colgaban de ellos en `CreateMesaFlow`, `MesaScreen` y `HomeScreen`. El **modo mock NO se tocó**: es el riel de desarrollo y conserva la historia wallet que el plan durmiente todavía no apaga. | **Cerrado.** El desbloqueo no fue técnico: la entrada anterior decía que conservarlo *"requiere coordinar cómo se conserva la demo"*, y esa coordinación quedó sin objeto cuando **Mati confirmó (2026-08-03) que la demo ya pasó y no se graba ninguna más**. Sin usuario, un flag que nadie va a volver a prender es superficie que alguien puede prender por error. Medición final de `pm_card_visa` en los tres builds: mock **0**, real **0**, real+`VITE_ALLOW_DEMO=1` **0** — el tercero es el que antes daba 1. G-24 pedía "ausentes **o** inaccesibles": quedan ausentes. Un test de regresión (`releaseGates.test.ts`) barre el árbol de fuentes y falla si alguien reintroduce un PaymentMethod de prueba por cualquier vía. |
| **G-23** | `npm audit` completo reporta vulnerabilidades transitivas de Vite/esbuild (1 moderada + 1 alta) y solo propone Vite 8, un major. `npm audit --omit=dev` devuelve **0**. | Toolchain/dev-server local; no hay evidencia de dependencia vulnerable dentro del bundle productivo. | No se hace upgrade major durante esta corrección funcional ni se presenta el hallazgo como vulnerabilidad de producción. | **Backlog de toolchain:** planificar Vite 8 por separado, revisar breaking changes y repetir test/typecheck/build. |
| **G-17** | El journal local anterior retenía para siempre la misma key terminal: evitaba al caller tardío, pero también impedía una segunda operación legítima ratificada. Además, indexar por familia hacía desaparecer un intento ambiguo al cerrar sesión y volver a entrar con el mismo principal. | Nueva mesa, pagos, cargas y transferencias multi-tab/relogin. | **Corregido y reauditado localmente 2026-08-03:** journal v5 indexado por principal estable+área y handle `{generation,key,lease}`. Solo una adquisición explícita abre la generación siguiente después de terminal; preparar/enviar/cerrar/limpiar exige generación y familia capturadas. Otra familia ve el bloqueo, pero no recibe payload/PM ni puede mutarlo; otro principal queda aislado. `ambiguous` conserva la key y `sending` solo vuelve a red mediante replay exacto del fingerprint. Un journal v3/v4 presente falla cerrado. | **CERRADO en seguridad local; sin cambio de contrato backend.** No se halló P0/P1 en la reauditoría adversarial. La reconciliación cross-family sigue siendo fail-closed/operativa hasta disponer de evidencia contractual exacta; el release general continúa NO-GO por otros gates. |
| **G-18** | El relevamiento anterior afirmaba que `GET /topup/:id` no publicaba método ni referencia; el contrato sí devuelve `id`, `method`, `amount_cents` y `status` (`contract-mirror/routes/topup.js:294-305`). | Reconciliación de topup con 3DS. | El front liga la consulta por id+método+monto y mantiene ambiguo cualquier mismatch. | **RESUELTO en ORDEN 1O:** no requiere cambio de backend. La recuperación de `client_secret` sigue separada en G-15. |
| **G-19** | Las versiones anteriores guardaban `payme_idem_*` y `payme_pending_*` en `sessionStorage` sin actor, familia, payload verificable ni referencia contractual de reconciliación. No se verificó si existen residuos en navegadores externos. | Upgrade con un hold/pago card-only o una obligación wallet legacy ambigua. | El front deja el residuo intacto y crea una cuarentena durable y opaca; no lo atribuye ni reenvía y no abre una operación nueva. La vía insegura queda cerrada localmente. | **P1 operativo/upgrade condicionado, no P0 de código:** inventariar exposición y definir reconciliación autenticada o runbook antes de liberar un área card-only afectada. Si se acredita cero residuo, puede no bloquear. Wallet legacy pasa al plan durmiente; nunca limpiar a ciegas. |
| **G-20** | `attemptReplayResponse` publica `tip_cents`, `payment_type`, gross, estado, campos Stripe y el recibo `items[]` hidratado desde `payment_attempt_items`. En igualdad no se inventa un ID de slot: tipo+tip+gross se contrastan con slots `available` o `claimed_by_me`. | Reintento perdido de un pago por consumo o igualdad. | El front valida consumo por set exacto de ítems/fracciones/montos e igualdad por montos elegibles; nunca acredita desde el preview. | **RESUELTO localmente** en App Backend `e8a3faf` y espejo 2026-08-03. No acredita publicación externa. |
| **G-21** | El relevamiento anterior omitió que `findExistingTransfer` ya selecciona `to_user_id` (`contract-mirror/routes/transfers.js:22-30`). `Friend.id` es el UUID de `users.id` (`routes/friends.js:18-30`). | Reintento de transferencia tras respuesta perdida. | Fresh se liga por `to.payme_id`; replay por `to_user_id`, y ambos por monto+concepto+finalización (`completed_at`; replay además `status='completed'`). | **RESUELTO en ORDEN 1O:** no requiere cambio de backend. |
| **G-22** | Las respuestas monetarias no ecoan una referencia opaca común derivada de la intención (p. ej. fingerprint/operation token); el front solo puede ligar los campos de negocio publicados. | Create mesa, pagos, topups y transferencias ante respuesta cruzada/corrupta con campos coincidentes. | Validación estructural máxima contra request+contexto; mismatch falla cerrado. Nunca se usa un preview como prueba. | **ORDEN 2 cross-repo:** evaluar un binding opaco no sensible, aditivo y uniforme; no bloquea el cierre de los NO-GO actuales. |
| **G-16** | Wallet/saldo, topups, P2P, CLABE, SPEI, STP y garantía/pago wallet están fuera del MVP; subsisten código/schema e historia con obligaciones legacy. | Rutas, botones, mock y workers históricos de wallet. | El build real ya lo oculta; el mock conserva la superficie histórica preexistente. Esta auditoría no anticipa el apagado ni borra código/schema/tests. | **Plan de apagado RATIFICADO, implementación post-auditoría:** flags, UI y endpoints fail-closed sin borrar historia ni obligaciones. Cualquier reactivación futura requiere gate IFPE; es NO-GO si una superficie wallet queda navegable en un candidato de release. |
| **G-15** | `GET /api/topup/:id` no siempre permite recuperar un `client_secret` vivo tras replay 3DS. | Solo topup tarjeta histórico, ya fuera del MVP. | Código y journal quedan dormidos/fail-closed; no se desarrolla reanudación nueva. | **Transferido al plan de apagado wallet:** no bloquea el MVP card-only y no autoriza reactivar topups. |
| **G-14** | El espejo anterior no reflejaba el checkpoint auditado de App Backend. | Reintentos, evidencia de pago propio, privacidad de invitaciones, lifecycle de tarjetas y paridad monetaria. | El espejo se refrescó por copia desde una fuente exacta; no contiene parches del frontend. | **RESUELTO localmente:** 67/67 archivos byte-idénticos contra App Backend `e8a3faf2f520b249cbe6001f14ef70230a405695`; procedencia en `contract-mirror/README.md`. No acredita push/deploy/producción. |
| **G-10** | **Pivote a Stripe Connect (2026-07-24): el contrato no expone el `statement_descriptor` del pago con tarjeta.** Con Connect, el merchant of record de un pago con tarjeta pasa a ser el restaurante, pero el descriptor exacto lo define la cuenta Connect y solo lo conoce el backend. | Comprobante del pago. | El nombre del restaurante proviene de `mesa.restaurant.name`; descriptor ausente degrada sin subtexto. | Pendiente contractual. |
| **G-13** | **🔴 PQ-2 / D-03 sigue BLOQUEADO por decisión, no por ausencia técnica.** App Backend `e8a3faf` acepta/persiste `birth_date`, ofrece `PATCH /api/account/me` write-once y publica fecha/estado/adultez; config, auth, account y consent están en el espejo final. Persiste la contradicción D-03: el alta técnica usa email/password y `last_name` obligatorio, mientras la decisión indica teléfono + nombre de pila + fecha y sin apellidos en capa 1. | PQ-2, consentimiento y registro. Consumir sólo la capability o `registration_required` elegiría unilateralmente un modelo de alta contradictorio. | **STOP aplicado:** ningún cambio de UI de registro ni interpretación de producto en esta auditoría. El refresh del mirror sí se hizo por copia, sin que eso autorice consumo. | Mati debe enmendar/reconciliar D-03. Después se diseña App Backend↔App Frontend en una orden separada; el checkpoint local no acredita release/producción. Actualizado 2026-08-03. |
| G-12 | Apple Pay y Google Pay tienen plan ratificado y son MUST del MVP card-only para permitir el primer pago sin tarjeta previa: producen un `pm_` efímero, no guardado y nunca off-session. Falta la integración real y su prueba física. App Backend `e8a3faf` publica ambas capabilities en `false` y el espejo final lo refleja. | Config y pantalla de pago en real y mock. | `WALLET_PAY_ENABLED=false` en ambos builds: ningún botón ni riel se presenta. | **MUST permanecer apagado / NO-GO si reaparece UI o capability true** hasta completar integración y pruebas iPhone/Safari + Android/Chrome. Implementación post-auditoría según el plan ratificado; el checkpoint local no acredita release/producción. |
| G-11 | En direct charges, el restaurante es merchant of record y el backend no cumple `save_payment_method`; el front no conoce ese riel antes del POST. Hoy garantía y pago muestran prendido **“Guardar esta tarjeta para la próxima”** y solo después del resultado avisan que no se guardó. | Flujo principal card-only: la UI promete una acción que puede incumplirse. | El aviso posterior evita silencio, pero no corrige el contrato ni la promesa previa. No se cambia unilateralmente mientras App Backend define el contrato final. | ✅ **CERRADO (2026-08-07, v2.47.0) — con una vuelta que vale registrar.** 🟡 El primer cierre (`7e45db0`, v2.46.0) fue **refutado** por auditoría externa: cinco huecos, el peor que la **wallet nativa se adjuntaba a Stripe ANTES de validarla** (*"rechazar después de mutar no es rechazar"*). Este front ya lo había consumido; el consumo NO se revirtió —espejó y consumió bien lo publicado— y quedó PROVISIONAL hasta el hash bueno. **`aa28e84` (v2.47.0) lo cierra en la causa** y agrega convergencia (`card_save_intents` + sweep): la promesa ya no se pierde por un timeout, se resuelve en el tick siguiente. Cero campos nuevos, así que el consumo del front sigue siendo el correcto. 🔴 **Límite declarado del mock:** guarda siempre sincrónico; el real puede hacerlo eager o en el tick siguiente — diferencia de MOMENTO, no de forma, y modelarla exigiría un disparador de fallas de Stripe que este repo no tiene. **Historia previa (2026-08-07, primer intento):** El dueño publicó `7e45db0` como cierre y este front lo consumió (orden 2-A.2); horas después una auditoría externa encontró **cinco huecos en ese mismo hash**, el peor: la **wallet nativa se adjuntaba a Stripe antes de validarla** (`attaches_remotos: 1`). App Backend reabrió G-11 con una migración nueva. **El consumo NO se revierte** —el espejo copió bien y el front consumió bien lo publicado; revertir borraría trabajo correcto en vez de corregir la base— **pero G-11 NO está cerrada**: queda un follow-up para cuando el dueño publique el hash definitivo, y el espejo está congelado hasta entonces. Lo que sigue describe lo que se consumó de `7e45db0`, no un cierre acreditado. · **CONSUMIDO (2026-08-07, orden 2-A.2).** Cero contrato nuevo: el cambio es de comportamiento — la tarjeta tipeada con `save_payment_method: true` APARECE en `GET /payment-methods` tras el éxito del cobro, también bajo direct charge (sync o webhook post-3DS); no-op para guest y wallets. En este front: el aviso posterior ("la tarjeta no se guarda… podés guardarla desde Cuenta") se retiró de garantía y pago — la advertencia que nunca corregía la promesa quedó sin objeto porque la promesa ahora se cumple; el checkbox SIGUE desmarcado (la decisión del default sobrevive al cierre: una promesa de oficio es una promesa que nadie pidió); el mock dejó de condicionar el guardado por `connectedAccountId` y coincide con el real (acreditado en `mockSavedCards.test.ts`: directo guarda tras éxito · wallets no-op · guest no-op · sin pedir no guarda); e2e primerizo con las tres direcciones. |
| G-09 | **Agregado mensual de gastos por categoría server-side** (nice-to-have): la torta de Cuenta (T-F1, 0.25.0) se computa en el front desde `GET /account/history` pidiendo el mes con `from` + `limit=100` (máximo del contrato). Con >100 pagos en un mes, trunca. Un `GET /account/stats` con breakdown por categoría lo resolvería exacto y barato. | Torta de gastos en Cuenta (feedback del hermano de Mati). | El paliativo actual (mes completo hasta 100 pagos) alcanza de sobra para el MVP. | Anotado 2026-07-24 (nice-to-have, sin urgencia) |
| G-01 | No hay endpoint para listar/buscar restaurantes, pero `POST /api/mesas` exige `restaurant_id` (uuid) y valida que exista y esté `active`. El OCR mock tampoco devuelve restaurante. | Abrir mesa (T2): sin un `restaurant_id` real no se puede crear mesa contra el backend. | En mock, el adaptador expone restaurantes de demo con uuids fijos. Para T7 (backend real) hace falta o un endpoint (`GET /api/restaurants`) o uuids seedeados conocidos. | **RESUELTO en backend v2.21.0 (2026-07-24) — front conectado en 0.24.0**: `GET /api/restaurants/:id` (público) → `{ restaurant: { id, name, category, address\|null } }`, 404 `restaurant_not_found` para inexistente/suspendido/uuid malformado; `GET /api/restaurants?q=` (público, solo active, limit 20, búsqueda literal). El front resuelve el restaurante por el QR de la mesa (`?r=<uuid>`, con `VITE_RESTAURANT_ID` como fallback demo), avisa ANTES de armar la mesa si el QR no corresponde, y el nombre dejó de hardcodearse en el deploy (`VITE_RESTAURANT_NAME` retirado). Verificado en vivo (200/404/404-malformado/búsqueda) y en mock (QR de Hanzo Sushi resuelto en el header). |
| G-02 | No hay endpoint de perfil propio (`GET /api/me` o similar). `POST /auth/register` devuelve `user`, pero `POST /auth/login` devuelve SOLO tokens — tras un login no hay forma de saber nombre, `payme_id` ni email del usuario. | Home ("Hola, Mati"), Perfil (T5), y cualquier pantalla que muestre identidad. | En mock no afecta. Contra backend real: persistir el `user` de register en localStorage es parche parcial (no sobrevive login en otro device). | **RESUELTO en backend v2.20.0 (2026-07-24) — front conectado en 0.23.0**: `GET /api/account/me` → `{ user: { id, payme_id, email, first_name, last_name, phone\|null, created_at } }` y el login ahora devuelve `user` (mismo shape que register; el refresh no — el endpoint cubre el restore). Verificado en vivo (200 con shape exacto, 401 `auth_required` sin token). El front borró el paliativo del email (`identity.ts` derivaba el nombre del local-part) e hidrata las sesiones persistidas pre-v2.20 con `GET /account/me` al restaurar. |
| G-03 | `GET /api/account/balance` devuelve `balance_cents` total pero no `held_balance_cents`. Con garantía wallet activa, el usuario "ve" saldo que no puede gastar (el backend calcula disponible = balance − held y devuelve 402). | Cuenta (T5) y pago con saldo (T4): el saldo mostrado puede no ser el gastable. | La UI dice "Tu saldo PayMe" (no "disponible") y maneja el `402 {available, required}`, que sí trae el disponible real. | **RESUELTO en backend v2.21.0 (2026-07-24) — front conectado en 0.24.0**: el balance suma `held_balance_cents/_display` y `available_cents/_display` (`available = balance − held` server-side; el `available` del 402 coincide). La card de Cuenta ahora dice **"Disponible $X"** + línea "🔒 Retenido en garantías: $Y" cuando hay hold; el ojito del Home y Transferir muestran el disponible. Verificado en mock (garantía wallet de $60 → Disponible $235 + Retenido $60 exactos) y en vivo (shape con los 6 campos). |
| **G-04** | **`POST /api/mesas` con `guarantee_method:'card'` exige `stripe_payment_method_id` (`pm_…`), pero `GET /api/payment-methods` NO expone ese campo** (solo el `id` uuid interno). No hay forma de garantizar una mesa con una tarjeta ya guardada. Nótese que `POST /:code/pay` sí acepta `payment_method_id` uuid — la asimetría parece un descuido. | **Bloquea el flujo principal de A-1 en T7**: el organizador tendría que tipear su tarjeta completa cada vez que abre una mesa, aunque ya la tenga guardada. | Con backend real, garantizar con tarjeta obliga a pasar por Stripe Elements y crear un `pm_` nuevo cada vez. Alternativa sin fricción: garantizar con **saldo** (wallet), que no necesita Stripe. | **RESUELTO en backend v2.16.0 (D4, 2026-07-22)**: `GET /payment-methods` ahora expone `stripe_payment_method_id` (pm_…) junto al `id` uuid, y la garantía acepta **`payment_method_id` (uuid) para tarjeta guardada** además de `stripe_payment_method_id` para tarjeta nueva. `save_payment_method` (default false) guarda la tarjeta tipeada desde la propia garantía o pago. Front conectado en v0.12.0 (selector en garantía y pago, checkbox guardar). Verificado contra el backend vivo. |
| **G-08** | **Platos COMPARTIDOS entre comensales (fracciones)** — decisión de producto pendiente de acta, pedida por Mati 2026-07-23: hoy un ítem lo toma UNA persona entera (lock exclusivo). Falta que 2+ comensales puedan tomar fracciones del mismo plato (1/2, 1/3…) y que la suma de fracciones cierre. Nota: seleccionar UNIDADES de un "×2" ya quedó resuelto en el front (0.20.0 expande cantidades en filas-unidad al crear la mesa, sin cambio de contrato) — este gap es SOLO la fracción de un mismo plato. | El caso real "compartimos la pizza": hoy uno de los dos la paga entera o nadie puede marcarla. | El front presentó a Mati dos opciones con recomendación (fracción declarada al pagar, cobro inmediato y garantía cubre faltantes — recomendada — vs división retroactiva al cierre de la mesa, que exige ajustes/refunds post-pago). Cuando haya acta y el backend publique el contrato (lock/pago fraccional), el front suma el control "compartir plato". | **RESUELTO — backend v2.18.1 EN VIVO y front conectado en 0.21.0**: lock/pay fraccionales (`items: [{item_id, fraction_bps}]`, 2500\|3333\|5000\|10000), `remaining_bps`/`my_bps` en el GET, montos server-side (nominal + la completadora ajusta + tolerancia <100 bps absorbe). E2E real: ⅓+⅓+⅓ de $70.00 = 23.33+23.33+23.34 exacto, ítem `paid` al 100%. UX en una línea con pills Entero·½·⅓·¼, hint "queda X" y preview replicando `fractionAmount`. Ver B-05 (anomalía de carrera hallada en la verificación). |
| **G-07** | **El backend NO persiste `item_ids` cuando la división es en partes iguales**: en `POST /:code/pay`, `payment_attempt_items` solo se escribe en la rama `consumo` (routes/mesas.js, rama `igual` toma un slot e ignora los ítems). El front (0.19.0, pedido de Mati) ahora EXIGE marcar lo consumido también en partes iguales y manda `item_ids` — el contrato los acepta pero se descartan. | **El modelo de negocio**: los agregados de consumo del dashboard (item_aggregate/association) pierden todos los datos de las mesas divididas en partes iguales. | El front ya captura y envía la selección; cuando el backend la persista (sin lockear ni cambiar montos: es informativa), los datos fluyen sin tocar el front. | **RESUELTO en backend v2.18.1** (junto con las fracciones): la rama igual ahora inserta `payment_attempt_items` con los `item_ids` que el front ya mandaba. Verificado en el código espejado (routes/mesas.js, rama legacy/igual). |
| G-05 | No hay endpoint para registrar tarjetas *guardadas* usables en la garantía: `POST /api/payment-methods` guarda el `pm_` en la DB pero, por G-04, ese `pm_` no vuelve a salir. | Igual que G-04. | Si se resuelve G-04 exponiendo `stripe_payment_method_id` en el GET, este gap se cierra solo. | **RESUELTO en backend v2.16.0** — se cerró junto con G-04, tal como estaba previsto. |
| G-06 | Dudas de contrato que el texto del acta D4 dejaba abiertas (ids de topup/default/delete si el `id` pasaba a `pm_…`; destino de `bank_name`/`type`/`display`). | Topup con tarjeta, gestión de tarjetas en Cuenta. | — | **RESUELTO de nacimiento por la publicación v2.16.0** (mismo día que se anotó): el backend mantuvo `id` uuid para `:id`/topup y conservó `bank_name`/`type`/`display`; el `pm_` viaja en un campo nuevo. Ninguna pantalla necesitó cambios de contrato. |
