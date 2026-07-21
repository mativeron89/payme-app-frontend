# contract-mirror/ — espejo de solo lectura del contrato del App Backend

**Procedencia:** copiado tal cual de `../payme-app-backend` **v2.14.3** (CI
verde). Fuente de verdad: el código real de ese repo. Este espejo existe para
que el front pueda consultar el contrato sin abrir el repo del backend en cada
sesión.

**Refrescado el 2026-07-20** desde v2.14.3 (venía congelado en v2.13.0 del
2026-07-18). Cambiaron: `middleware/auth.js`, `routes/invitations.js`,
`routes/mesas.js` y `docs/settlement.js.ref` (fixes v2.14.1/.2 de SQL contra
Postgres real + outbox Etapa 2); se agregaron `docs/CHANGELOG_v2.14.md` y las
migraciones de outbox. `schemas/index.js` NO cambió: el contrato de requests
sigue igual que en v2.13.

## Reglas

1. **SOLO LECTURA.** Nada de esta carpeta se edita, se "arregla" ni se importa
   desde `src/`. Si el contrato parece tener un problema, se anota en
   `../GAPS.md` y Mati lo lleva al dueño del contrato.
2. **Se refresca, no se parchea.** Cuando el backend cambie de versión, se
   vuelve a copiar desde `../payme-app-backend` y se actualiza la fecha y la
   versión de este README.
3. Lo que no está acá (ni en el repo del backend), **no existe**: no se
   inventan endpoints, campos ni shapes.

## Qué hay

| Carpeta | Contenido | Para qué lo usa el front |
| --- | --- | --- |
| `schemas/index.js` | Schemas Zod de TODOS los request bodies/queries | Tipos de requests, validaciones, límites (topup min $50/max $10.000, etc.) |
| `routes/*.js` | Las 16 rutas Express (los response shapes viven acá) | Endpoints exactos, códigos de error, shapes de respuesta |
| `middleware/auth.js` | `requireAuth` / `guestOrAuth` / `requireMesaParticipant` | Contrato de auth: `Bearer` JWT, guest por `?t=` o `X-Guest-Token` |
| `utils/money.js` | Helpers de dinero en centavos | **Se replica EXACTO en `src/utils/money.ts`** (regla dura #5) |
| `utils/stateMachine.js` | FSM de mesa / payment_attempt / mesa_item | Estados válidos que la UI tiene que representar |
| `db/schema.sql` + migraciones (garantía, abono, outbox v2.12, outbox Etapa 2 v2.14) | Columnas y CHECKs reales | Referencia de campos cuando una ruta devuelve `SELECT *` |
| `docs/` | READMEs v2.10/v2.5.2, CHANGELOGs v2.11/v2.13/**v2.14**, `settlement.js.ref` | Cómo levantar el backend local, modo mock STP, modelo de garantía |

**Seed:** el backend NO tiene seed (verificado 2026-07-18). Los datos de demo
salen del adaptador mock del front (`VITE_MOCK=1`).

## Resumen del contrato (verificado contra el código, no contra la maqueta)

### Base y auth
- Base: `http://localhost:3000` · prefijo `/api` · CORS por `FRONTEND_ORIGIN`.
- `POST /api/auth/register` `{email, phone?, password, first_name, last_name}` → `201 {user, access_token, refresh_token, expires_in}`
- `POST /api/auth/login` `{email, password}` → `{access_token, refresh_token, expires_in}`
- `POST /api/auth/refresh` `{refresh_token}` → **rota** el refresh token (el cliente DEBE reemplazarlo; reuso del viejo = sesión revocada, 401 `refresh_reuse_detected`).
- `POST /api/auth/logout` (Bearer) → `{revoked}`
- Guest: sin login, con `?t=<token>` en query o header `X-Guest-Token` (solo rutas de mesa con `guestOrAuth`).

### Config
- `GET /api/config` → `{version, currency, stripe_publishable_key, mesa_hold_seconds, payment_hold_seconds, invitation_expiry_seconds, item_lock_seconds, features}`
- `GET /api/config/stripe-key` → `{publishable_key}`

### Mesas (núcleo)
- `POST /api/mesas` (auth) — **A-1**: exige `guarantee_method: 'card'|'wallet'` (+ `stripe_payment_method_id` si card). Valida `sum(items) === total_cents`. Respuestas:
  - `201 {mesa:{...status:'open'|'pending_auth'}, guarantee:{method, status:'open'|'requires_action', client_secret?}}` — `requires_action` = 3DS: el front confirma el `client_secret` con Stripe.js y la mesa pasa a `open` vía webhook.
  - `402 {error:'guarantee_failed', reason, available?, required?}` — sin garantía no hay mesa (D1).
- `GET /api/mesas/open` (auth) → `{mesas:[{id, code, full_name, restaurant, total_cents, paid_amount_cents, pct_paid, status, expires_at}]}`
- `GET /api/mesas/:code` (guestOrAuth + participante) → `{mesa:{..., items:[{id, name, category, price_cents, quantity, status, locked_by_me, lock_expires_at}], division_slots?, active_staff, my_role}}`
- `POST /api/mesas/:code/items/lock` `{item_ids}` → `{locked, lock_token, lock_expires_at}` · 409 `item_already_locked`
- `POST /api/mesas/:code/pay` `{payment_method_id?|stripe_payment_method_id?, payment_type:'card'|'apple_pay'|'google_pay'|'wallet', item_ids, lock_tokens?, tip_cents, tip_to_staff_id?, idempotency_key}` →
  - wallet: `201 {attempt:{id, gross_amount_cents, gross_display, status:'processed', payment_type}}` · `402 insufficient_funds {available, required}` (descuenta el saldo retenido) · guest+wallet: `401 wallet_requires_auth`
  - tarjeta: `201 {attempt:{id, gross_amount_cents, client_secret, status, stripe_status, requires_action}}`
  - división `igual`: sin `item_ids`, el pago reclama un slot (`409 no_slots_available`).
- `POST /api/mesas/:code/invitations` (solo opener) `{type:'link'|'in_app', invited_user_id?/invited_payme_id?}` → `201 {invitation, link?}` — el `link` (`/mesa/:code?t=<raw>`) se devuelve UNA sola vez.

### Estados que la UI representa (FSM real)
- Mesa: `pending_auth → open → partially_paid → fully_paid → settling → settled → dispersing → completed`, más `expired`, `auth_failed`, `cancelled`.
- Pago: `pending → requires_action|processing → succeeded → processed` (más `failed/cancelled/refunded`).
- Ítem: `available → locked → paid|released`.
- **A-2**: si la mesa expira sin completarse, la garantía del organizador captura el faltante (`captured_shortfall_cents`; notificación `mesa_shortfall_charged`). El restaurante SIEMPRE cobra el total. La pantalla de expirada dice "tu garantía cubrió $X" — nunca "no se cobra a nadie".

### Cuenta / wallet
- `GET /api/account/balance` → `{balance_cents, balance_display, clabe, currency}` (ojo: no expone `held_balance_cents` — el disponible real puede ser menor si hay garantía wallet activa).
- `GET /api/account/movements` (+`/:id`), `GET /api/account/wallet-transactions` (tipos: `topup_oxxo|topup_card|topup_spei|transfer_in|transfer_out|payment_mesa|refund_mesa|tip_received|tip_payout|adjustment_credit|adjustment_debit`), `GET /api/account/history`, `GET /api/account/stats`.

### Topup — **A-3: tres vías**
- `POST /api/topup/oxxo` `{amount_cents (5000–1000000), idempotency_key}` → `201 {topup:{..., voucher_reference, stripe_voucher_url, voucher_expires_at}}`
- `POST /api/topup/card` `{amount_cents, payment_method_id, idempotency_key}` → `201 {topup, requires_action, client_secret?}`
- SPEI: `GET /api/wallet/clabe` → `{clabe, banco:'STP', beneficiario:'PayMe', instrucciones}` (CLABE virtual; el abono se acredita por webhook STP).
- `GET /api/topup` y `GET /api/topup/:id` para estado.

### Tarjetas
- `POST /api/payment-methods/setup-intent` → `{setup_intent_id, client_secret}` (Stripe Elements para agregar tarjeta sin cobrar; crea el customer lazy).
- `GET /api/payment-methods` → `{payment_methods:[{id, brand, bank_name, type, last_four, exp_month, exp_year, is_default, display}]}`
- `POST /api/payment-methods` `{stripe_payment_method_id, set_as_default?}` · `DELETE /:id` · `PATCH /:id/default`

### Social
- Friends: `GET /`, `POST /` (`{email | payme_id}`), `GET /search?q=`, `DELETE /:friendId`.
- Groups: CRUD `/api/groups` + `/:id/members` (miembros deben ser amigos).
- Transfers: `POST /api/transfers` `{amount_cents, to_payme_id|to_email|to_user_id, concept?, idempotency_key}` → `201 {transfer}` · `402 insufficient_funds`; `GET /` y `/:id`.
- Invitations (in_app): `GET /api/invitations`, `POST /:id/accept`, `POST /:id/cancel`.

### Otros
- Notifications: `GET /api/notifications` (`unread_only`), `/unread-count`, `PATCH /:id/read`, `PATCH /read-all`, `DELETE /:id`, push-devices.
- OCR: `POST /api/ocr` (multipart `image`, 8MB, jpeg/png/webp/heic) → `{items, total_cents, mock:true}` — **mock declarado**, devuelve ticket de ejemplo.
- Staff: `GET /api/restaurants/:rid/staff/active` (para elegir mozo de propina; también viene en `GET /mesas/:code` como `active_staff`). Propinas propias: `GET /api/me/staff-earnings`.
- Salud: `GET /health` (sin `/api`).

### Idempotencia (regla transversal)
`pay`, `topup/*` y `transfers` exigen `idempotency_key` (8–100 chars) generado por el cliente. Misma key + mismo payload → respuesta idempotente; misma key + payload distinto → `409 idempotency_conflict`. El front genera una key por intento de pago (p.ej. UUID) y la **reusa en reintentos** del mismo intento.

### Modo demo local
Backend local: `npm start` en `../payme-app-backend` (puerto 3000; requiere Postgres 14+ y `npm run migrate:fresh`). `STP_API_KEY=mock-development-key` activa el mock STP incorporado (dispersión y abono SPEI simulados de punta a punta). Stripe en test mode. OCR siempre mock (`HAS_REAL_IMPL=false`).
