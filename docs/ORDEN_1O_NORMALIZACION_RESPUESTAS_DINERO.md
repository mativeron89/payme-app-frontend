# ORDEN 1O — normalización contractual de respuestas monetarias

Fecha inicial: 2026-08-02. Actualización de cierre: 2026-08-03. Alcance:
frontera de respuestas de App Frontend. El espejo fue refrescado por copia
desde App Backend `e8a3faf2f520b249cbe6001f14ef70230a405695` (v2.28.8):
67/67 archivos con fuente quedaron byte-idénticos. El README del espejo es
documentación propia y no tiene par en el backend. Esto es evidencia local;
no acredita push, deploy ni producción.

## Reglas de frontera

- Centavos: `number` sólo si es entero seguro; `string` sólo si es decimal
  canónico no negativo (`0` o `[1-9][0-9]*`) y cabe exactamente en
  `Number.MAX_SAFE_INTEGER`. No se usa coerción antes de validar.
- IDs de entidades monetarias son UUID canónicos; códigos de mesa, tipos,
  métodos y estados se validan contra enums cerrados del espejo.
- `amount_display` se deriva desde los centavos normalizados; nunca acredita
  un importe. Campos ausentes contractualmente no se inventan.
- Cualquier shape o binding inválido arroja `money_response_malformed` o
  `money_response_unbound`; el journal queda ambiguo y no hay navegación,
  3DS ni éxito local.

## Matriz de contrato, normalización y binding

| Endpoint | Forma real fresh | Forma real replay/consulta | Normalización aceptada | Binding y cierre seguro |
| --- | --- | --- | --- | --- |
| `POST /mesas` | `mesa` es fila `RETURNING`; `total_cents` BIGINT puede serializarse decimal. `guarantee` trae método/`open` o `requires_action`. `routes/mesas.js:106-111,185-195` | Idempotencia de alta no agrega un shape distinto publicado en esta ruta. | `total_cents` decimal → entero seguro; UUID/código/fechas/enums estrictos. | Igualdad exacta contra total, división, participantes y método solicitados; estado mesa↔garantía coherente. |
| `POST /mesas/:code/pay` | Fresh incluye `id`, gross, propina, riel y, en consumo, `items[]` con fracción+monto. La compatibilidad con una omisión histórica del tipo sólo se tolera ante una firma Stripe fresh completa (`client_secret`, `stripe_status`, `requires_action`). | `attemptReplayResponse` publica tip, tipo, gross, estado, `client_secret`/`requires_action`, cuenta Connect y `items[]` hidratados para consumo. | `tip_cents` y `tip_amount_cents` se normalizan a un valor único y deben coincidir si llegan ambos. El código wallet histórico exige tipo explícito; los campos Stripe neutros de replay se eliminan del DTO y cualquier firma accionable inconsistente se rechaza. | Consumo: set exacto de IDs, fracciones y montos; `items.amount + tip = gross`. Igualdad: `gross-tip` debe coincidir con un slot `available` o `claimed_by_me`, nunca uno ajeno. El preview jamás acredita. G-20 quedó resuelto en el checkpoint fuente. |
| `POST /topup/oxxo` | `{id,status:'processing',amount_cents,amount_display,voucher_reference,voucher_expires_at}`. `routes/topup.js:182-190` | Replay retorna fila con `method,amount_cents,status` y voucher sólo si ya existe. `routes/topup.js:23-30,116-118` | Centavos exactos; display local. Fresh se acredita por la firma completa de voucher; replay exige `method:'oxxo'`. Nunca se infiere el riel sólo por el endpoint invocado. | Un replay activo sin voucher lanza `money_response_unbound` dentro del callback protegido: el journal vuelve a `ambiguous` y reintenta la misma key; nunca queda en `sending` ni fabrica referencia. |
| `POST /topup/card` | `{id,status,amount_cents,amount_display}` más `requires_action:boolean` y secreto sólo cuando corresponde. `routes/topup.js:282-290` | Replay fila cruda con `method,amount_cents,status`, sin display ni `requires_action`. `routes/topup.js:23-30,211-212` | Fresh se acredita por `requires_action`; replay exige `method:'card'`. Nulos de columnas OXXO se eliminan y el display se deriva localmente. | Monto y riel exactos; un shape OXXO no puede cruzarse como tarjeta. `processing` sin evidencia terminal queda ambiguo y nunca anuncia saldo ni fabrica 3DS. |
| `GET /topup/:id` | — | Incluye `id,method,amount_cents,status` y display derivado. `routes/topup.js:294-305` | Centavos exactos, método/status enum cerrado, display local. | ID, monto y método deben igualar la expectativa del polling; mismatch queda ambiguo. |
| `POST /transfers` | Fresh incluye `id,amount_cents,concept,completed_at,to`. `routes/transfers.js:202-210` | Replay incluye `to_user_id` además de monto, concepto, `status` y `completed_at`. `routes/transfers.js:22-30,61-65` | BIGINT decimal → entero seguro; display local; UUID y estado cerrados. | Expectativa `{recipientUserId,paymeId}` desde `Friend`: fresh liga por `to.payme_id`; replay por `to_user_id` y exige `status='completed'`; ambos ligan monto, concepto y `completed_at`. G-21 queda resuelto. |

## Evidencia de pruebas

`src/api/moneyGuards.test.ts` fija las formas anteriores (incluidos BIGINT
string, nulos de replay y campos ausentes), centavo completador, exclusión de
slots ajenos, aliases de propina, separación wallet/Stripe, firmas cruzadas de
topup y binding fresh/replay de destinatario. Prueba mismatch de monto/tip/destinatario,
strings no canónicos, negativos, exponentes, enteros inseguros, métodos y
estados desconocidos. Las respuestas rechazadas no llegan a los call sites:
las fachadas de `src/api/index.ts` normalizan antes de resolver la promesa.
`src/api/mock/mockApi.idempotency.test.ts` verifica que OXXO reusa referencia
y que tarjeta no acredita saldo dos veces al repetir la misma key; un payload
distinto —incluido cambiar de OXXO a tarjeta— devuelve
`idempotency_conflict` bajo el namespace compartido, igual que el backend.

Los flujos wallet/topup/transfer se conservan como historia contractual, pero
quedan fuera del MVP por el plan ratificado de wallet durmiente. Este documento
no autoriza reactivarlos ni implementa su apagado post-auditoría.
