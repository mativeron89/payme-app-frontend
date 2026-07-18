# CHANGELOG — PayMe App Backend v2.11 (consolidado)

**Base:** v2.10 consolidado (Drive, 60 archivos, verificado byte-exacto).
**Fecha:** 2026-07-11. **Alcance:** primera auditoría con entorno de ejecución + cableado de los 5 parches pendientes + 14 fixes propios (A1–A14).
**Diff:** 13 archivos, +567/−62 líneas. Cambios quirúrgicos, sin dependencias nuevas, sin romper contratos públicos existentes (el único contrato que cambia es `POST /api/mesas`, que era exactamente lo que el parche §1 pedía).

---

## 🔴 P0 — plata real

### A1 · `services/paymentProcessor.js` — guard FINDING A (parche §5)
`processSuccessfulPayment` solo promueve a `fully_paid` desde `open`/`partially_paid`. Antes, un pago tardío sobre una mesa `settled` intentaba `settled→fully_paid` → FSM 409 → rollback del webhook → retry-loop de Stripe → **cobrado pero no registrado**.

### A2 · `services/settlement.js` — doble débito de garantía (path wallet)
La Fase 3 ahora **re-verifica `status='settling'` con `FOR UPDATE` dentro de su transacción** antes de tocar el wallet. Antes, dos `settleMesa` concurrentes (tick solapado / multi-instancia) debitaban el faltante **dos veces** del saldo del organizador: el `UPDATE ... WHERE status='settling'` de la segunda corrida fallaba silencioso, pero su débito ya estaba commiteado en la misma tx. (El path tarjeta lo salvaba la idempotency key de Stripe; el wallet no tenía nada.)

### A11 · `routes/webhooks.js` — rescate de `succeeded` tardío sobre `cancelled`/`failed`
`handleMesaPaymentSucceeded` tenía rescate para `cancelling` (la orden rara) pero **no** para `cancelled`/`failed` (la orden común: `cancelIntent` falla porque el PI ya cobró, el timer finaliza `cancelled`, y el webhook llega segundos después). Esa rama caía en `cancelled→succeeded` → FSM 409 → retry-loop → terminal con plata cobrada sin acreditar. Ahora:
- si **todos los items del attempt siguen `released`** → se re-toman (`released→locked`, FSM válido) y se procesa normal;
- si **alguien más tomó/pagó algún item** → el attempt queda `succeeded` **sin procesar** + `state_transitions('webhook_late_success_conflict')` + `logger.error('late_success_conflict_manual_review')` → cola de revisión manual, sin pisar a nadie.

---

## 🟠 P1

### A3 · `services/timer.js` — guard de reentrancia del tick
`tickOnce` con flag `tickRunning` + `finally`. Un sweep que tarde más que `TICK_MS` (30s; capturas Stripe + STP secuenciales) ya no se solapa con el siguiente — que era exactamente lo que habilitaba A2 en single-instance.

---

## 🟡 P2

### A4 · `services/settlement.js` — dispersal `retrying` huérfano
`disperseMesa` en el skip `already_dispersed` ahora sanea la fila de `dispersals` si quedó en `retrying`/`failed` → corta el loop no-op infinito del sweep(3) (nunca incrementaba `retry_count`).

### A5 · `routes/mesas.js` (wallet-pay) + `routes/transfers.js` — saldo retenido
Ambos paths de gasto calculan `available = balance_cents − held_balance_cents`. Antes chequeaban el balance total: el `CHECK chk_wallets_held_balance` salvaba la plata pero devolvía un **500** en vez de un **402**, y el usuario "veía" saldo que estaba congelado como garantía.

### A6 · `services/paymentProcessor.js` — pago tardío post-settle trazado
Nueva rama: si el pago aterriza con la mesa fuera de `open`/`partially_paid`/`fully_paid` → `logger.error('late_payment_after_settle')` con montos completos (la garantía ya pudo haber cubierto ese monto → posible sobre-cobro; revisión manual, primera etapa recomendada por FINDING_A_opcion1.md).

### A7 · `utils/logger.js` — masking real de datos financieros (reescrito)
`deepMask` ahora cumple el contrato de `tests/logger.test.js`: keys sensibles → `[REDACTED]` (subobjetos enteros incluidos), `email*`→`ma***@dominio`, `*clabe*`→`****7890`, `rfc*`→`VEMA***`, `*phone*`→`****5678`, valores `sk_*`→`sk_REDACTED` (y `whsec_*`). **Antes las CLABEs se logueaban crudas** en `walletFunding`/`spei-funding`. Export nombrado `deepMask` + alias `_deepMask` por compat.

### A9 · `tests/garantia.test.js` + `tests/abono.test.js` — gate explícito
Ambas suites son scaffolds estilo Jest que requieren DB + `helpers/fixtures` inexistente; bajo `node --test` reventaban al cargar → `npm test` nunca pudo estar verde. Ahora: skip explícito y visible salvo `RUN_DB_TESTS=1`.

### A12/A12b · `routes/webhooks.js` — webhooks de topup fuera de orden
`handleTopupFailed` y la cancelación de topup ahora tienen guard `status IN ('pending','processing')` — un `failed`/`canceled` tardío ya no pisa un topup **acreditado**.

### A13 · `routes/webhooks.js` — refund de topup detectado
`charge.refunded` de un topup (no soportado en MVP: implicaría debitar wallet, quizás a negativo → decisión de producto) ahora se **detecta**, se traza con `logger.error('topup_refund_unhandled_manual_review')` y corta el retry-loop, en vez de morir en `retryable_no_local_record` × 10.

### A14 · `middleware/envValidation.js` — `STP_ABONO_SECRET` requerido en prod
Sin ese secreto, `/webhooks/stp` quedaba **abierto** en producción (acredita wallets).

---

## 🟢 P3

### A8 · `utils/userId.js` — alfabeto sin `1`
El comentario y el test exigían "sin `l` ni `1`"; el string incluía `1`. Detectado **por ejecución**.

### A10 · `package.json` — `migrate:fresh` completo
Ahora encadena `schema.sql && migrate:garantia && migrate:abono`. Antes un fresh install quedaba sin las columnas de garantía/abono. Versión → **2.11.0**.

---

## 🔧 Parches documentados cableados (garantía Modelo B end-to-end)

### §1 · `routes/mesas.js` — creación con garantía
La mesa nace `'pending_auth'` (+ fila de auditoría en `state_transitions`); `settlement.placeGuaranteeHold` corre **fuera de la tx**; respuesta: `201 {mesa, guarantee:{method,status,client_secret?}}` con `status: 'open' | 'requires_action'`, o `402 guarantee_failed` (D1: sin garantía la mesa no se activa).

### §2 · `schemas/index.js` — `createMesa`
`guarantee_method: 'card'|'wallet'` (requerido) + `stripe_payment_method_id` (requerido si `card`, vía refine).

### §3 · `routes/webhooks.js` — interceptor `guarantee_auth`
Los PIs con `metadata.kind==='guarantee_auth'` se manejan **antes** del routing normal (ya no ensucian `retryable_no_local_record`): `amount_capturable_updated` → mesa `pending_auth→open` (3DS ok, con transición FSM), `payment_failed` → `auth_failed`, `succeeded`/`canceled` → solo traza (captura/liberación del settle).

### §4 · `services/settlement.js` — Opción 1 (FINDING A)
Nueva Fase 1.5: `cancelInFlightAttempts` cancela los attempts `pending/requires_action/processing/authorized` de la mesa con el patrón 3 pasos del timer (`cancelling` con guard → `cancelIntent` tolerante → `cancelled` + liberar items/slots solo si sigue `cancelling`). Notifica `payment_failed` a cada pagador y `mesa_garantia_impagos` al organizador (tipo ya registrado en v2.10). Si Stripe ya cobró alguno, **A11 lo rescata**.

### §5 · = A1 (arriba).

### Extra · rastro de auditoría del FSM en settlement/dispersión
`settling`, `settled`, `dispersing`, `completed` y el fallback `dispersing→settled` ahora insertan su fila en `state_transitions` (best-effort, `try/catch` — nunca rompen el flujo de dinero). Cierra el gap documentado en el header de `utils/stateMachine.js`.

---

## ✔ Verificación ejecutada (este entorno: Node 22, sin red, sin Postgres, stub `pg`)
- `node --check`: **12/12** archivos modificados OK.
- Suites ejecutables: **61 tests → 59 pass / 0 fail / 2 skip explícitos** (garantía/abono gateadas). Antes de v2.11: 47/59 con 12 fallos.
- Juez final para las suites con DB (4 de integración + garantía/abono): **CI de GitHub** con Postgres.
