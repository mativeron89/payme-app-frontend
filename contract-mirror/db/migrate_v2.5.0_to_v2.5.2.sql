-- ═══════════════════════════════════════════════════════════
-- PayMe Backend — MIGRACIÓN INCREMENTAL v2.5.0 → v2.5.2
-- PostgreSQL ≥14
--
-- USO: para DB EXISTENTE (v2.5.0 o v2.5.1). Idempotente.
--   psql $DATABASE_URL -f db/migrate_v2.5.0_to_v2.5.2.sql
--
-- Para DB vacía, usá db/schema.sql en su lugar.
--
-- ORDEN GARANTIZADO (P0 #1 — fix bloqueante):
--   FASE 0: preflight (email duplicates) — falla temprano con mensaje claro
--   FASE 1: ALTER TABLE ADD COLUMN IF NOT EXISTS  (TODAS las columnas)
--   FASE 2: CREATE TABLE IF NOT EXISTS            (tablas nuevas)
--   FASE 3: CREATE INDEX IF NOT EXISTS            (después de que las columnas existen)
--   FASE 4: CHECK constraints                      (drop + add)
--   FASE 5: backfill de datos
--
-- NINGÚN CREATE INDEX/CONSTRAINT corre sobre una columna que todavía
-- podría no existir, porque la FASE 1 ya las agregó.
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- FASE 0 — PREFLIGHT (P2 #11): duplicados legacy de email
-- ─────────────────────────────────────────────────────────
-- Si hay usuarios con el mismo LOWER(TRIM(email)), el UNIQUE index
-- sobre email_normalized fallaría. Detectamos y abortamos con mensaje
-- claro ANTES de tocar nada. NO resolvemos merges automáticamente.
DO $$
DECLARE
  dup_count INTEGER;
  dup_sample TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    SELECT COUNT(*), string_agg(email_norm, ', ')
      INTO dup_count, dup_sample
      FROM (
        SELECT LOWER(TRIM(email)) AS email_norm, COUNT(*) AS c
          FROM users
         GROUP BY 1
        HAVING COUNT(*) > 1
         LIMIT 10
      ) d;

    IF dup_count IS NOT NULL AND dup_count > 0 THEN
      RAISE EXCEPTION
        'MIGRATION_ABORTED: % email(s) duplicados por casing/espacios detectados (ej: %). '
        'Resolvé manualmente antes de migrar: revisá "SELECT LOWER(TRIM(email)), COUNT(*) '
        'FROM users GROUP BY 1 HAVING COUNT(*)>1". '
        'PayMe no hace merge automático de usuarios.',
        dup_count, dup_sample;
    END IF;
  END IF;
END $$;

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────
-- FASE 1 — ADD COLUMN IF NOT EXISTS (todas, antes de índices)
-- ─────────────────────────────────────────────────────────

-- users.email_normalized (v2.5.1 P1 #7)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_normalized VARCHAR(255);

-- invitations.token_hash (v2.5.1 P1 #8)
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);

-- mesa_participants.guest_token_hash (v2.5.1 P1 #8)
ALTER TABLE mesa_participants ADD COLUMN IF NOT EXISTS guest_token_hash VARCHAR(64);

-- processed_webhook_events.last_attempt_at (v2.5.1 P0 #4)
ALTER TABLE processed_webhook_events
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- v2.5.2 P1 #2 — guest_token_hash en tablas operativas
ALTER TABLE payment_attempts    ADD COLUMN IF NOT EXISTS guest_token_hash VARCHAR(64);
ALTER TABLE mesa_items          ADD COLUMN IF NOT EXISTS locked_by_guest_token_hash VARCHAR(64);
ALTER TABLE mesa_division_slots ADD COLUMN IF NOT EXISTS claimed_by_guest_token_hash VARCHAR(64);

-- ─────────────────────────────────────────────────────────
-- FASE 2 — CREATE TABLE IF NOT EXISTS (tablas nuevas)
-- ─────────────────────────────────────────────────────────

-- user_sessions (v2.5.1 P1 #6 + v2.5.2 P2 #10)
CREATE TABLE IF NOT EXISTS user_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti             VARCHAR(100) UNIQUE,
  refresh_token_hash      VARCHAR(255),
  prev_refresh_token_hash VARCHAR(255),
  user_agent      VARCHAR(500),
  ip_hash         VARCHAR(64),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','revoked','expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  revoked_reason  VARCHAR(100),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Si user_sessions ya existía (v2.5.1), agregar columnas nuevas v2.5.2:
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS prev_refresh_token_hash VARCHAR(255);
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(100);

CREATE TABLE IF NOT EXISTS tip_refund_reversals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tip_distribution_id UUID NOT NULL REFERENCES tip_distributions(id) ON DELETE CASCADE,
  payment_attempt_id  UUID NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  staff_user_id   UUID REFERENCES users(id),
  attempted_reverse_cents BIGINT NOT NULL CHECK (attempted_reverse_cents >= 0),
  reversed_cents      BIGINT NOT NULL DEFAULT 0 CHECK (reversed_cents >= 0),
  unrecovered_cents   BIGINT NOT NULL DEFAULT 0 CHECK (unrecovered_cents >= 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','full','partial','manual_review','skipped')),
  reason          VARCHAR(500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_refunds (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_attempt_id UUID NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  stripe_charge_id  VARCHAR(100),
  stripe_refund_id  VARCHAR(100),
  refund_type     VARCHAR(20) NOT NULL CHECK (refund_type IN ('full','partial')),
  source          VARCHAR(20) NOT NULL DEFAULT 'stripe'
                  CHECK (source IN ('stripe','wallet','manual')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents >= 0),
  original_amount_cents BIGINT,
  status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('processed','pending_review','failed','ignored_duplicate')),
  reason          VARCHAR(500),
  raw_event_id    VARCHAR(100),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────
-- FASE 3 — CREATE INDEX IF NOT EXISTS (columnas ya existen)
-- ─────────────────────────────────────────────────────────

-- users
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_normalized
  ON users(email_normalized) WHERE email_normalized IS NOT NULL;

-- invitations
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_token_hash
  ON invitations(token_hash) WHERE token_hash IS NOT NULL;

-- mesa_participants
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesa_participants_guest_hash
  ON mesa_participants(mesa_id, guest_token_hash) WHERE guest_token_hash IS NOT NULL;

-- payment_attempts (v2.5.2 P1 #2)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempts_idem_guest_hash
  ON payment_attempts(guest_token_hash, mesa_id, operation_type, idempotency_key)
  WHERE guest_token_hash IS NOT NULL;

-- mesa_items (v2.5.2 P1 #2)
CREATE INDEX IF NOT EXISTS idx_mesa_items_locker_guest_hash
  ON mesa_items(locked_by_guest_token_hash) WHERE locked_by_guest_token_hash IS NOT NULL;

-- processed_webhook_events
CREATE INDEX IF NOT EXISTS idx_processed_events_retryable
  ON processed_webhook_events(status, last_attempt_at)
  WHERE status IN ('retryable_no_local_record','failed_retryable');

-- user_sessions
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_sessions_jti  ON user_sessions(jti) WHERE jti IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh
  ON user_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_prev_refresh
  ON user_sessions(prev_refresh_token_hash) WHERE prev_refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
  ON user_sessions(expires_at) WHERE status = 'active';

-- tip_refund_reversals
CREATE INDEX IF NOT EXISTS idx_tip_reversals_attempt ON tip_refund_reversals(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_tip_reversals_review
  ON tip_refund_reversals(status) WHERE status = 'manual_review';

-- payment_refunds
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refunds_raw_event
  ON payment_refunds(raw_event_id) WHERE raw_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_refunds_attempt ON payment_refunds(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_review
  ON payment_refunds(status, created_at DESC) WHERE status = 'pending_review';

-- ─────────────────────────────────────────────────────────
-- FASE 4 — CHECK constraints (drop + add seguro)
-- ─────────────────────────────────────────────────────────
DO $$ BEGIN
  -- processed_webhook_events.status: nuevos estados (v2.5.1 P0 #4)
  ALTER TABLE processed_webhook_events DROP CONSTRAINT IF EXISTS processed_webhook_events_status_check;
  ALTER TABLE processed_webhook_events ADD CONSTRAINT processed_webhook_events_status_check
    CHECK (status IN ('processing','processed',
                      'retryable_no_local_record',
                      'failed_retryable','failed_terminal'));

  -- tip_distributions.status: agrega 'partially_reversed' (v2.5.1 P0 #1)
  ALTER TABLE tip_distributions DROP CONSTRAINT IF EXISTS tip_distributions_status_check;
  ALTER TABLE tip_distributions ADD CONSTRAINT tip_distributions_status_check
    CHECK (status IN ('pending','credited','reversed','partially_reversed'));
END $$;

-- ─────────────────────────────────────────────────────────
-- FASE 5 — backfill de datos
-- ─────────────────────────────────────────────────────────
-- email_normalized para usuarios legacy (el preflight ya garantizó no-dups)
UPDATE users SET email_normalized = LOWER(TRIM(email)) WHERE email_normalized IS NULL;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Validación post-migración (manual / informativa):
--   SELECT COUNT(*) FROM users WHERE email_normalized IS NULL;        -- debe ser 0
--   \d+ payment_attempts    -- debe tener guest_token_hash
--   \d+ mesa_items          -- debe tener locked_by_guest_token_hash
--   \d+ user_sessions       -- debe tener prev_refresh_token_hash
-- ═══════════════════════════════════════════════════════════
