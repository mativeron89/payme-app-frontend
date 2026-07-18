# PayMe Backend v2.5.2

Backend de la **app PayMe de usuarios** (pagos colaborativos en restaurantes, México). Node.js 18+ · Express · CommonJS · PostgreSQL 14+ · Stripe.

Iteración incremental sobre **v2.5.1** que cierra los 12 hallazgos de la ronda de review (1 P0, 8 P1, 3 P2). Sin reescrituras, sin TypeScript, sin cambios de arquitectura. No rompe endpoints ni tests existentes. El frontend comensal `preview (17).html` v8.4 queda intacto.

> **Build regenerado (limpio).** Incluye el fix de seguridad de migración `ON_ERROR_STOP` en los tres scripts `psql` de `package.json` (ver más abajo) y el ajuste de orden de `DATABASE_URL` en la suite de tests de DB.

---

## Cómo correr

```bash
npm install
cp .env.example .env        # completar secrets
npm start                   # arranca en :3000
npm test                    # unit + (DB si DATABASE_URL_TEST está seteada)
```

### Migraciones (P0 #1 — estrategia de 2 archivos)

A partir de v2.5.2 la migración está **separada** para evitar el bloqueante de correr índices sobre columnas que todavía no existen:

```bash
# DB VACÍA (primera instalación):
npm run migrate:fresh       # psql $DATABASE_URL -v ON_ERROR_STOP=1 -f db/schema.sql

# DB EXISTENTE (upgrade desde v2.5.0 o v2.5.1):
npm run migrate:upgrade     # psql $DATABASE_URL -v ON_ERROR_STOP=1 -f db/migrate_v2.5.0_to_v2.5.2.sql
```

`npm run migrate` apunta a **upgrade** por seguridad (lo más común en producción).

> ⚠️ **`-v ON_ERROR_STOP=1` es obligatorio.** Sin ese flag, psql **no aborta** ante un error: imprime el mensaje y sigue con la siguiente sentencia, terminando con exit 0. Eso anularía el preflight de la FASE 0 (el `RAISE EXCEPTION` está fuera del `BEGIN/COMMIT`, así que psql lo imprimiría y correría igual la migración) y haría que una migración fallida se reporte como exitosa. Los tres scripts npm ya lo incluyen; **si corrés psql a mano, pasalo siempre**.

- `db/schema.sql` — esquema completo y consolidado a v2.5.2 (BEGIN/COMMIT, sin bloques incrementales). Solo para DB vacía.
- `db/migrate_v2.5.0_to_v2.5.2.sql` — incremental e idempotente. Orden garantizado en fases:
  - **FASE 0** preflight de emails duplicados (P2 #11): si hay colisiones por `LOWER(TRIM(email))` aborta con `RAISE EXCEPTION` y mensaje claro. No hace merge automático. *(Requiere `-v ON_ERROR_STOP=1` para abortar de verdad — incluido en los scripts npm.)*
  - **FASE 1** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — **todas** las columnas nuevas.
  - **FASE 2** `CREATE TABLE IF NOT EXISTS` (user_sessions, tip_refund_reversals, payment_refunds) + ALTERs para columnas v2.5.2 si la tabla ya existía.
  - **FASE 3** `CREATE INDEX IF NOT EXISTS` — recién acá, con las columnas garantizadas.
  - **FASE 4** CHECK constraints (drop + add).
  - **FASE 5** backfill de `email_normalized`.

#### Validar los dos escenarios

```bash
# 1) DB vacía:
createdb payme_fresh && psql payme_fresh -v ON_ERROR_STOP=1 -f db/schema.sql        # debe terminar sin error

# 2) DB v2.5.0 simulada → upgrade:
#    (restaurar un dump v2.5.0 en payme_upgrade, luego)
psql payme_upgrade -v ON_ERROR_STOP=1 -f db/migrate_v2.5.0_to_v2.5.2.sql            # idempotente: se puede correr 2 veces

# Verificación:
psql payme_upgrade -c "SELECT COUNT(*) FROM users WHERE email_normalized IS NULL;"   # 0
psql payme_upgrade -c "\d+ payment_attempts" | grep guest_token_hash
psql payme_upgrade -c "\d+ user_sessions"    | grep prev_refresh_token_hash
```

---

## Los 12 fixes de v2.5.2

| # | Sev | Fix | Archivos |
|---|-----|-----|----------|
| 1 | P0 | Migración incremental real: `schema.sql` (fresh) + `migrate_*.sql` (upgrade); todos los ADD COLUMN antes de cualquier índice | `db/schema.sql`, `db/migrate_v2.5.0_to_v2.5.2.sql`, `package.json` |
| 2 | P1 | Guest token hashing en tablas operativas (`payment_attempts`, `mesa_items`, `mesa_division_slots`); flows nuevos guardan solo hash | `db/*`, `routes/mesas.js`, `services/paymentProcessor.js` |
| 3 | P1 | Hash de idempotencia normaliza arrays no ordenados (`item_ids`, `slot_ids`) | `utils/idempotency.js` |
| 4 | P1 | Email normalizado vía `z.preprocess` (trim+lowercase) antes de validar | `schemas/index.js` |
| 5 | P1 | Reacquire de webhooks retryables atómico (`UPDATE … WHERE status IN (…) RETURNING`) | `routes/webhooks.js` |
| 6 | P1 | Partial refund posterior a full refund queda auditado (`ignored_duplicate` + `reason=partial_after_full_refund`) | `services/paymentProcessor.js` |
| 7 | P1 | `insertRefundLedger` valida `constraint === 'uq_payment_refunds_raw_event'`, no traga cualquier 23505 | `services/paymentProcessor.js` |
| 8 | P1 | OCR real mode: fail-fast al **startup** (no 501 en runtime) | `routes/ocr.js` |
| 9 | P2 | HEIC valida **major brand** (`heic/heix/hevc/hevx/mif1/msf1`), rechaza ISO-BMFF genérico | `routes/ocr.js` |
| 10 | P2 | Refresh token rotation **implementada** + reuse detection | `routes/auth.js`, `db/*` |
| 11 | P2 | Preflight de emails legacy duplicados en la migración | `db/migrate_v2.5.0_to_v2.5.2.sql` |
| 12 | P2 | `logger.deepMask` cubre `ip/raw_ip/x-forwarded-for/x-real-ip` | `utils/logger.js` |

---

## Decisiones técnicas tomadas

1. **P0 #1**: dos archivos en vez de uno. `npm run migrate` queda apuntando a `migrate:upgrade` (caso prod más frecuente); `migrate:fresh` para DB vacía. Los tres scripts incluyen `-v ON_ERROR_STOP=1`.

2. **P2 #10 — refresh rotation implementada (no solo documentada)**: cada `POST /refresh` genera un nuevo refresh token, mueve el hash anterior a `user_sessions.prev_refresh_token_hash` y devuelve el nuevo raw. **Reuse detection de 1 nivel**: si llega un token cuyo hash matchea `prev_refresh_token_hash` (el inmediatamente anterior, ya rotado), se interpreta como replay → la session se revoca (`status='revoked'`, `revoked_reason='refresh_reuse_detected'`) → 401. Cubre el caso típico de replay del token recién robado. Detección multinivel completa (cadena histórica) queda fuera de scope.

3. **P1 #6 — partial-after-full**: usa el estado existente `ignored_duplicate` + `reason='partial_after_full_refund'` en `payment_refunds`. No se agregó un enum nuevo al CHECK para no tocar la constraint. Idempotente vía `UNIQUE(raw_event_id)`.

4. **P1 #2 — guest hashing**: 3 columnas hash nuevas. En flows **nuevos** se guarda **solo** el hash (la columna raw queda `NULL`). Las queries de ownership e idempotencia validan por hash primero, con **fallback** a token crudo para filas legacy. El frontend no se ve afectado: nunca recibió estos tokens operativos (solo tiene su propio token de invitación, devuelto una vez en el `link`).

---

## Refresh token rotation — contrato

```
POST /api/auth/refresh  { refresh_token }
  → token actual válido:   200 { access_token, refresh_token (NUEVO), expires_in }
  → token ya rotado (prev): 401 { error: 'refresh_reuse_detected' }  + session revocada
  → token desconocido:      401 { error: 'invalid_refresh_token' }
  → session revocada/exp:   401 { error: 'session_revoked' | 'session_expired' }
```

El cliente **debe** reemplazar su refresh token con el devuelto en cada refresh. Un refresh viejo deja de funcionar inmediatamente.

> Nota de UX conocida (no bug): un cliente legítimo que reintente con el token viejo tras una respuesta perdida disparará `refresh_reuse_detected` y se le revocará la sesión. Es el tradeoff de la rotación estricta; se reevalúa en v2.5.3.

---

## Tests

```bash
npm test            # local: unit siempre; DB solo si DATABASE_URL_TEST
CI=true npm run test:ci   # CI: exige DATABASE_URL_TEST (si falta, exit 1)
DATABASE_URL_TEST=postgres://… npm test   # corre también la suite de DB
```

La suite de DB fija `DATABASE_URL = DATABASE_URL_TEST` **al tope del archivo** (antes de cualquier `require` de `db/pool`), así el `Pool` se instancia contra la base de prueba.

Cobertura v2.5.2 (`tests/integration-v2.5.2.test.js`):
- **Unit (sin DB)**: P1#3 (orden de arrays), P1#4 (email preprocess), P1#6 (rama partial-after-full con fake client), P1#7 (constraint check), P1#8 (fail-fast al require), P2#9 (HEIC brands), P2#12 (deepMask).
- **DB-gated**: P1#2 (columnas hash presentes), P1#5 (reacquire atómico no duplica), email UNIQUE por casing.

Los tests de v2.5.0/v2.5.1 (`integration*.test.js`, `money`, `stateMachine`, `userId`, `division-igualitaria`, `logger`) se mantienen y deben seguir pasando.

---

## Riesgos / pendientes para v2.5.3

- **OCR real sin proveedor**: `HAS_REAL_IMPL=false`. Mientras no se integre Google Vision / AWS Textract, `OCR_FEATURE_FLAG=real` aborta el arranque (intencional). Integrar proveedor real es trabajo de v2.5.3.
- **Partial refunds reales**: hoy un partial sobre un attempt no-refunded queda en `pending_review` (no se soporta el flujo de partial en el MVP). Falta un dashboard admin para resolver `payment_refunds.status='pending_review'` y `tip_refund_reversals.status='manual_review'`.
- **Webhooks `failed_terminal`**: no hay reintento administrativo ni alerta fuerte (PagerDuty/etc). Devuelven 200 a Stripe para cortar reintentos; quedan en DB para auditoría.
- **Reuse detection multinivel**: la detección actual es de 1 nivel (`prev_refresh_token_hash`). Una cadena histórica de tokens daría detección más profunda.
- **`last_seen_at` async**: se actualiza sin esperar; si falla, se loguea pero no bloquea (aceptable).

---

## Estructura

```
PayMe_Backend_v2.5.2/
├── server.js                         # v2.5.2 (rate limits por ruta)
├── package.json                      # migrate:fresh / migrate:upgrade (-v ON_ERROR_STOP=1)
├── db/
│   ├── schema.sql                    # NUEVO: fresh DB
│   ├── migrate_v2.5.0_to_v2.5.2.sql  # NUEVO: upgrade incremental
│   └── pool.js
├── middleware/   (auth.js, envValidation.js)
├── utils/        (idempotency.js*, logger.js*, money.js, stateMachine.js, tokens.js, userId.js)
├── schemas/      (index.js*)
├── services/     (paymentProcessor.js*, matching.js, notifications.js, stripe.js, stripe-oxxo.js, stp.js, timer.js)
├── routes/       (auth.js*, mesas.js*, webhooks.js*, ocr.js*, config.js*, account.js, payment-methods.js,
│                  friends.js, groups.js, invitations.js, notifications.js, staff.js, topup.js, transfers.js)
└── tests/        (integration-v2.5.2.test.js* + suites previas)

* = modificado/nuevo en v2.5.2
```
