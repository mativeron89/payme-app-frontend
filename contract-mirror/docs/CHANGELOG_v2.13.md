# CHANGELOG — PayMe App Backend v2.13 (Outbox Etapa 1.5 · E6)

**Base:** v2.12.0 (repo GitHub `payme-app-backend`, CI verde). **Fecha:** 2026-07-12.
**Alcance:** Etapa 1.5 del outbox App→Dashboard, según decisiones de producto D1–D3 ratificadas (acta 2026-07-12).
**Diff:** 4 archivos tocados + este changelog. Cero dependencias nuevas, cero contratos rotos, cero cambios en flujos de dinero.

## E6 · `payment_secured` — CABLEADO
- Nuevo helper `services/eventEmitter.js → enqueuePaymentSecured(client, mesaId)`.
- Se emite en los MISMOS tres puntos que `table_opened` (el hold de garantía quedó autorizado), dentro de la misma transacción y con la secuencia inmediatamente siguiente:
  - `services/settlement.js → placeCardHold` (rama `requires_capture`)
  - `services/settlement.js → placeWalletHold`
  - `routes/webhooks.js → 3DS amount_capturable_updated`
- Monto: `mesas.auth_amount_cents` leído DESPUÉS del UPDATE del call-site — en el path 3DS el valor real vive en la fila (por el `COALESCE`), no en el parámetro del webhook. Por eso el helper lee la fila y los tres call-sites quedan idénticos de una línea.
- El dashboard ya lo procesa sin tocar nada (asiento `+secured_amount_cents` en su ledger + snapshot; test P3 preexistente). Un hold de $0/NULL emite igual — el guard P3-2 del dashboard (v1.0.7) evita asientos de $0.

## E7 · `payment_refunded` — ESPECIFICADO, SIN CABLEAR (corrección justificada al mapeo ratificado)
La regla D1 ratificada — *"el ledger del restaurante solo resta cuando SU plata cambia"* — aplicada al código real da:
- **Pre-settle:** `processRefund` deja el attempt en `'refunded'` (excluido de las sumas de E3) y decrementa `tip_amount_cents` de la mesa → el `table_charged` que sale al liquidar **ya es neto del refund**. Emitir además `payment_refunded` haría que el dashboard reste DOS veces (su `insertLedger` asienta `−refund_amount_cents`). → **No emitir.**
- **Post-settle:** PayMe absorbe (D1 statu quo) → la plata del restaurante no cambió → **sin evento** (queda en `late_payment_after_settle` / revisión manual, como hasta ahora).
- **Reservado para el objetivo futuro de D1** (neteo contra la próxima dispersión): ese será el momento y el monto correctos de `payment_refunded`. El handler del dashboard ya está listo para ese día. Mismo tratamiento que E5 (`table_voided`): especificado, receptor listo, sin trigger verdadero hoy. Documentado en el código (`services/eventEmitter.js`).

## Tests (`tests/outbox.test.js`)
- **Puros:** `secured_amount_cents` / `refund_amount_cents` pasan el guard de privacidad (sufijo `_cents`).
- **DB (gated por `DATABASE_URL_TEST`, corren en CI):**
  - E6 en la misma tx que `table_opened` → 2 filas, seq 1/2 en orden, payload exacto del contrato (`{ secured_amount_cents }`, sin PII).
  - E6 con `auth_amount_cents` NULL → `secured_amount_cents = 0` (borde documentado).

## Verificación local (entorno sin red, sin Postgres)
- `node --check`: 3/3 archivos fuente + suite de tests OK.
- Suite pura verde local; la suite DB la juzga el CI de GitHub con Postgres, como siempre.
