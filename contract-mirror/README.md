# contract-mirror — App Backend → App Frontend

Espejo **de solo lectura** del contrato que el App Frontend consume. La fuente
de verdad continúa siendo el código del App Backend; esta carpeta no se importa
desde `src/` y nunca se corrige a mano.

## Procedencia congelada

- Fecha del refresh: **2026-08-03**.
- Fuente local: `../payme-app-backend`.
- Commit exacto: `e8a3faf2f520b249cbe6001f14ef70230a405695`.
- Versión de `package.json`: **2.28.8**.
- Rama fuente: `codex/audit-2026-08-02-app-backend`.

Ese commit es un candidato **local** de auditoría. No se afirma push, CI remoto,
deploy, Railway, Stripe real ni producción. El backend registró dos corridas
locales de 30 suites y 549 tests, pero permanece NO-GO técnico/de release por
los bloqueos que se enumeran abajo.

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
- `features.account_birth_date` con `supported`,
  `registration_required`, `write_once` y
  `adulthood_server_authoritative`.

Apple Pay y Google Pay están ratificados como MUST post-auditoría, pero este
commit no implementa una hoja nativa ni prueba física. `false` es la única
capacidad honesta hasta que eso exista.

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
historia y tests. Ese apagado **todavía no está implementado** en el commit
fuente. El front no debe usar wallet/STP/topup/transfer como fallback. Reactivar
requiere gate IFPE.

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

El cierre comparó **67/67** archivos contra su fuente exacta, sin diferencias ni
fuentes ausentes. Mapeos especiales:

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
