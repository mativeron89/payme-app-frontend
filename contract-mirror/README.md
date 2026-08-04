# contract-mirror — App Backend → App Frontend

Espejo **de solo lectura** del contrato que el App Frontend consume. La fuente
de verdad continúa siendo el código del App Backend; esta carpeta no se importa
desde `src/` y nunca se corrige a mano.

## Procedencia congelada

- Fecha del refresh: **2026-08-04** (segundo del día).
- Fuente local: `../payme-app-backend`.
- Commit exacto: `330a645cf4ea12e0ac6fe1f397a956a3327666a8`.
- Versión de `package.json`: **2.32.0**.
- Rama fuente: `codex/audit-2026-08-02-app-backend`.

Ese commit es un candidato **local** de auditoría. No se afirma push, CI remoto,
deploy, Railway, Stripe real ni producción. Las corridas de suite que el emisor
declara en sus mensajes de commit (588 tests / 35 suites) son **suyas y no se
verificaron desde este repo**; el backend permanece NO-GO técnico/de release por
los bloqueos que se enumeran abajo.

### Qué cambió respecto del refresh anterior (`db48cf6`, v2.31.0)

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

El segundo refresh del **2026-08-04** comparó **68/68** archivos contra su
fuente exacta en `330a645`, sin diferencias ni fuentes ausentes (67 del refresh
anterior más `utils/tokens.js`). Los `docs/` se
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
