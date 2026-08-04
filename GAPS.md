# GAPS — datos/endpoints que el front necesita y el contrato del App Backend no cubre

## Estado vigente de auditoría — 2026-08-04

Esta sección manda sobre las afirmaciones históricas del resto del archivo.
Las menciones antiguas a versiones "desplegadas", producción o verificaciones
en vivo son registro de su momento y **no acreditan el estado externo actual**.
La única fuente local de este cierre es App Backend
`db48cf69422fb0edbeb633e883c14405174a549b` (v2.31.0), espejada byte a byte en
`contract-mirror/`; no hubo push, deploy ni consulta a producción.

El frontend puede cerrar sus gates locales de calidad, pero el candidato sigue
**NO-GO de release/piloto** por estos bloqueos del ecosistema:

| Prioridad | Bloqueo vigente | Dueño / condición de cierre |
| --- | --- | --- |
| **P0** | Si Connect no está habilitado o el restaurante no tiene cuenta apta, `resolveChargeTarget()` puede devolver `null` y preservar el cargo plataforma/STP. Cambia merchant of record en vez de fallar cerrado. | App Backend + decisión de producto/dinero. El front no puede compensarlo ni usar wallet/STP como fallback. |
| **P0 contractual (G-11)** | Bajo direct charges, el backend acepta y sella `save_payment_method` pero no ejecuta guardado futuro. La UI promete algo que el riel puede incumplir. | Contrato coordinado App Backend↔App Frontend; capability previa o flujo de bóveda/SetupIntent que falle cerrado. |
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

| # | Qué falta | Dónde impacta | Qué hace el front mientras tanto | Estado |
| --- | --- | --- | --- | --- |
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
| G-11 | En direct charges, el restaurante es merchant of record y el backend no cumple `save_payment_method`; el front no conoce ese riel antes del POST. Hoy garantía y pago muestran prendido **“Guardar esta tarjeta para la próxima”** y solo después del resultado avisan que no se guardó. | Flujo principal card-only: la UI promete una acción que puede incumplirse. | El aviso posterior evita silencio, pero no corrige el contrato ni la promesa previa. No se cambia unilateralmente mientras App Backend define el contrato final. | **P0 contractual · NO-GO release:** resolver coordinadamente con un flujo de bóveda/SetupIntent o una capability fail-closed previa al pago. Requiere decisión cross-repo; no se inventa en este front. |
| G-09 | **Agregado mensual de gastos por categoría server-side** (nice-to-have): la torta de Cuenta (T-F1, 0.25.0) se computa en el front desde `GET /account/history` pidiendo el mes con `from` + `limit=100` (máximo del contrato). Con >100 pagos en un mes, trunca. Un `GET /account/stats` con breakdown por categoría lo resolvería exacto y barato. | Torta de gastos en Cuenta (feedback del hermano de Mati). | El paliativo actual (mes completo hasta 100 pagos) alcanza de sobra para el MVP. | Anotado 2026-07-24 (nice-to-have, sin urgencia) |
| G-01 | No hay endpoint para listar/buscar restaurantes, pero `POST /api/mesas` exige `restaurant_id` (uuid) y valida que exista y esté `active`. El OCR mock tampoco devuelve restaurante. | Abrir mesa (T2): sin un `restaurant_id` real no se puede crear mesa contra el backend. | En mock, el adaptador expone restaurantes de demo con uuids fijos. Para T7 (backend real) hace falta o un endpoint (`GET /api/restaurants`) o uuids seedeados conocidos. | **RESUELTO en backend v2.21.0 (2026-07-24) — front conectado en 0.24.0**: `GET /api/restaurants/:id` (público) → `{ restaurant: { id, name, category, address\|null } }`, 404 `restaurant_not_found` para inexistente/suspendido/uuid malformado; `GET /api/restaurants?q=` (público, solo active, limit 20, búsqueda literal). El front resuelve el restaurante por el QR de la mesa (`?r=<uuid>`, con `VITE_RESTAURANT_ID` como fallback demo), avisa ANTES de armar la mesa si el QR no corresponde, y el nombre dejó de hardcodearse en el deploy (`VITE_RESTAURANT_NAME` retirado). Verificado en vivo (200/404/404-malformado/búsqueda) y en mock (QR de Hanzo Sushi resuelto en el header). |
| G-02 | No hay endpoint de perfil propio (`GET /api/me` o similar). `POST /auth/register` devuelve `user`, pero `POST /auth/login` devuelve SOLO tokens — tras un login no hay forma de saber nombre, `payme_id` ni email del usuario. | Home ("Hola, Mati"), Perfil (T5), y cualquier pantalla que muestre identidad. | En mock no afecta. Contra backend real: persistir el `user` de register en localStorage es parche parcial (no sobrevive login en otro device). | **RESUELTO en backend v2.20.0 (2026-07-24) — front conectado en 0.23.0**: `GET /api/account/me` → `{ user: { id, payme_id, email, first_name, last_name, phone\|null, created_at } }` y el login ahora devuelve `user` (mismo shape que register; el refresh no — el endpoint cubre el restore). Verificado en vivo (200 con shape exacto, 401 `auth_required` sin token). El front borró el paliativo del email (`identity.ts` derivaba el nombre del local-part) e hidrata las sesiones persistidas pre-v2.20 con `GET /account/me` al restaurar. |
| G-03 | `GET /api/account/balance` devuelve `balance_cents` total pero no `held_balance_cents`. Con garantía wallet activa, el usuario "ve" saldo que no puede gastar (el backend calcula disponible = balance − held y devuelve 402). | Cuenta (T5) y pago con saldo (T4): el saldo mostrado puede no ser el gastable. | La UI dice "Tu saldo PayMe" (no "disponible") y maneja el `402 {available, required}`, que sí trae el disponible real. | **RESUELTO en backend v2.21.0 (2026-07-24) — front conectado en 0.24.0**: el balance suma `held_balance_cents/_display` y `available_cents/_display` (`available = balance − held` server-side; el `available` del 402 coincide). La card de Cuenta ahora dice **"Disponible $X"** + línea "🔒 Retenido en garantías: $Y" cuando hay hold; el ojito del Home y Transferir muestran el disponible. Verificado en mock (garantía wallet de $60 → Disponible $235 + Retenido $60 exactos) y en vivo (shape con los 6 campos). |
| **G-04** | **`POST /api/mesas` con `guarantee_method:'card'` exige `stripe_payment_method_id` (`pm_…`), pero `GET /api/payment-methods` NO expone ese campo** (solo el `id` uuid interno). No hay forma de garantizar una mesa con una tarjeta ya guardada. Nótese que `POST /:code/pay` sí acepta `payment_method_id` uuid — la asimetría parece un descuido. | **Bloquea el flujo principal de A-1 en T7**: el organizador tendría que tipear su tarjeta completa cada vez que abre una mesa, aunque ya la tenga guardada. | Con backend real, garantizar con tarjeta obliga a pasar por Stripe Elements y crear un `pm_` nuevo cada vez. Alternativa sin fricción: garantizar con **saldo** (wallet), que no necesita Stripe. | **RESUELTO en backend v2.16.0 (D4, 2026-07-22)**: `GET /payment-methods` ahora expone `stripe_payment_method_id` (pm_…) junto al `id` uuid, y la garantía acepta **`payment_method_id` (uuid) para tarjeta guardada** además de `stripe_payment_method_id` para tarjeta nueva. `save_payment_method` (default false) guarda la tarjeta tipeada desde la propia garantía o pago. Front conectado en v0.12.0 (selector en garantía y pago, checkbox guardar). Verificado contra el backend vivo. |
| **G-08** | **Platos COMPARTIDOS entre comensales (fracciones)** — decisión de producto pendiente de acta, pedida por Mati 2026-07-23: hoy un ítem lo toma UNA persona entera (lock exclusivo). Falta que 2+ comensales puedan tomar fracciones del mismo plato (1/2, 1/3…) y que la suma de fracciones cierre. Nota: seleccionar UNIDADES de un "×2" ya quedó resuelto en el front (0.20.0 expande cantidades en filas-unidad al crear la mesa, sin cambio de contrato) — este gap es SOLO la fracción de un mismo plato. | El caso real "compartimos la pizza": hoy uno de los dos la paga entera o nadie puede marcarla. | El front presentó a Mati dos opciones con recomendación (fracción declarada al pagar, cobro inmediato y garantía cubre faltantes — recomendada — vs división retroactiva al cierre de la mesa, que exige ajustes/refunds post-pago). Cuando haya acta y el backend publique el contrato (lock/pago fraccional), el front suma el control "compartir plato". | **RESUELTO — backend v2.18.1 EN VIVO y front conectado en 0.21.0**: lock/pay fraccionales (`items: [{item_id, fraction_bps}]`, 2500\|3333\|5000\|10000), `remaining_bps`/`my_bps` en el GET, montos server-side (nominal + la completadora ajusta + tolerancia <100 bps absorbe). E2E real: ⅓+⅓+⅓ de $70.00 = 23.33+23.33+23.34 exacto, ítem `paid` al 100%. UX en una línea con pills Entero·½·⅓·¼, hint "queda X" y preview replicando `fractionAmount`. Ver B-05 (anomalía de carrera hallada en la verificación). |
| **G-07** | **El backend NO persiste `item_ids` cuando la división es en partes iguales**: en `POST /:code/pay`, `payment_attempt_items` solo se escribe en la rama `consumo` (routes/mesas.js, rama `igual` toma un slot e ignora los ítems). El front (0.19.0, pedido de Mati) ahora EXIGE marcar lo consumido también en partes iguales y manda `item_ids` — el contrato los acepta pero se descartan. | **El modelo de negocio**: los agregados de consumo del dashboard (item_aggregate/association) pierden todos los datos de las mesas divididas en partes iguales. | El front ya captura y envía la selección; cuando el backend la persista (sin lockear ni cambiar montos: es informativa), los datos fluyen sin tocar el front. | **RESUELTO en backend v2.18.1** (junto con las fracciones): la rama igual ahora inserta `payment_attempt_items` con los `item_ids` que el front ya mandaba. Verificado en el código espejado (routes/mesas.js, rama legacy/igual). |
| G-05 | No hay endpoint para registrar tarjetas *guardadas* usables en la garantía: `POST /api/payment-methods` guarda el `pm_` en la DB pero, por G-04, ese `pm_` no vuelve a salir. | Igual que G-04. | Si se resuelve G-04 exponiendo `stripe_payment_method_id` en el GET, este gap se cierra solo. | **RESUELTO en backend v2.16.0** — se cerró junto con G-04, tal como estaba previsto. |
| G-06 | Dudas de contrato que el texto del acta D4 dejaba abiertas (ids de topup/default/delete si el `id` pasaba a `pm_…`; destino de `bank_name`/`type`/`display`). | Topup con tarjeta, gestión de tarjetas en Cuenta. | — | **RESUELTO de nacimiento por la publicación v2.16.0** (mismo día que se anotó): el backend mantuvo `id` uuid para `:id`/topup y conservó `bank_name`/`type`/`display`; el `pm_` viaja en un campo nuevo. Ninguna pantalla necesitó cambios de contrato. |
