# ORDEN 1O — normalización contractual de respuestas monetarias

Fecha: 2026-08-02. Alcance: frontera de respuestas de App Frontend. El
`contract-mirror/` se auditó en solo lectura y no fue modificado.

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
| `POST /mesas/:code/pay` tarjeta | Fresh incluye `id`, `gross_amount_cents`, `tip_cents`, secreto/estado/`requires_action`; omite `payment_type`. `routes/mesas.js:878-892` | Replay selecciona `id,status,stripe_client_secret,gross_amount_cents` y puede incluir cuenta Connect; omite tip/tipo. `routes/mesas.js:455-468,1055-1059` | BIGINT decimal → entero seguro; `payment_type` ausente es válido; si llega, debe coincidir. | Fresh: gross+tip exactos del request-bound expectation. Replay sin `tip_amount_cents`: fail-closed (G-20), sin inventar la propina ni confirmar 3DS. |
| `POST /topup/oxxo` | `{id,status,amount_cents,amount_display,voucher_*}`. `routes/topup.js:182-190` | Replay retorna la fila con `method,amount_cents,status` y voucher sólo si ya existe. `routes/topup.js:23-30,116-118` | Centavos exactos; display local; voucher opcional en replay. | Endpoint fija método fresh; replay debe coincidir si lo declara. Sin voucher para `processing`, se retiene journal y no se muestra referencia ficticia. |
| `POST /topup/card` | `{id,status,amount_cents,amount_display}` más `requires_action`/`client_secret`. `routes/topup.js:282-290` | Replay fila cruda con `method,amount_cents,status`, sin display ni `requires_action`. `routes/topup.js:23-30,211-212` | DTO único con método esperado, centavos y display local; `requires_action` permanece ausente si el contrato no lo envía. | Monto exacto; método verificable cuando aparece. Status `processing`/`requires_action` queda ambiguo, nunca anuncia saldo ni fabrica 3DS. |
| `GET /topup/:id` | — | Incluye `id,method,amount_cents,status` y display derivado. `routes/topup.js:294-305` | Centavos exactos, método/status enum cerrado, display local. | ID, monto y método deben igualar la expectativa del polling; mismatch queda ambiguo. |
| `POST /transfers` | Fresh incluye `id,amount_cents,concept,completed_at,to`. `routes/transfers.js:202-210` | Replay retorna fila sin `to` (`id,amount_cents,concept,status,completed_at`). `routes/transfers.js:22-30,61-65` | BIGINT decimal → entero seguro; display local; enums cerrados. | Fresh ata monto, concepto y `to.payme_id`. Replay sin destinatario queda fail-closed y journal retenido (G-21). |

## Evidencia de pruebas

`src/api/moneyGuards.test.ts` fija las formas anteriores (incluidos BIGINT
string y campos ausentes) y prueba mismatch de monto/tip/destinatario,
strings no canónicos, negativos, exponentes, enteros inseguros, métodos y
estados desconocidos. Las respuestas rechazadas no llegan a los call sites:
las fachadas de `src/api/index.ts` normalizan antes de resolver la promesa.
