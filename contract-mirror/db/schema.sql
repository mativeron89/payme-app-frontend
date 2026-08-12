-- ═══════════════════════════════════════════════════════════
-- PayMe Backend v2.5.2 — SCHEMA FROM SCRATCH
-- PostgreSQL ≥14
--
-- USO: solo para DB VACÍA (primera instalación).
--   psql $DATABASE_URL -f db/schema.sql
--
-- Para upgrade desde una DB v2.5.0/v2.5.1 existente, NO uses este archivo.
-- Usá: db/migrate_v2.5.0_to_v2.5.2.sql
--
-- Este archivo crea el esquema completo y consolidado a v2.5.2, incluyendo:
--   - guest_token_hash en tablas operativas (P1 #2)
--   - prev_refresh_token_hash en user_sessions (P2 #10 refresh rotation)
--   - tip_refund_reversals, payment_refunds, user_sessions
--   - email_normalized, token_hash, etc.
-- ═══════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ─── USERS + WALLET ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payme_id        VARCHAR(50) UNIQUE NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  email_normalized VARCHAR(255),
  phone           VARCHAR(20) UNIQUE,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','deleted')),
  kyc_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (kyc_status IN ('pending','approved','rejected')),
  stripe_customer_id VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_payme_id ON users(payme_id);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_normalized
  ON users(email_normalized) WHERE email_normalized IS NOT NULL;
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS wallets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_cents   BIGINT NOT NULL DEFAULT 0
                  CONSTRAINT chk_wallets_balance_safe
                  CHECK (balance_cents >= 0 AND balance_cents <= 9007199254740991),
  clabe           VARCHAR(18) UNIQUE,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_wallets_updated ON wallets;
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id       UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  type            VARCHAR(30) NOT NULL
                  CHECK (type IN (
                    'topup_oxxo','topup_card','topup_spei',
                    'transfer_in','transfer_out',
                    'payment_mesa','refund_mesa',
                    'tip_received','tip_payout',
                    'adjustment_credit','adjustment_debit'
                  )),
  amount_cents    BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  related_entity_type VARCHAR(30),
  related_entity_id   UUID,
  description     VARCHAR(500),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions(type, created_at DESC);

-- ─── USER SESSIONS (v2.5.1 P1 #6 + v2.5.2 P2 #10 rotation) ─
CREATE TABLE IF NOT EXISTS user_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti             VARCHAR(100) UNIQUE,
  refresh_token_hash      VARCHAR(255),
  prev_refresh_token_hash VARCHAR(255),  -- v2.5.2 P2 #10: reuse detection (1 nivel)
  refresh_rotated_at TIMESTAMPTZ,
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
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_sessions_jti  ON user_sessions(jti) WHERE jti IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh
  ON user_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_prev_refresh
  ON user_sessions(prev_refresh_token_hash) WHERE prev_refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
  ON user_sessions(expires_at) WHERE status = 'active';

-- ─── SIGNUP INVITATIONS · D-FF-1 ──────────────────────────
-- Autoridad de ALTA (no confundir con invitaciones a mesa). El raw token jamás
-- se persiste; register bloquea la fila y la consume en la misma tx del user.
CREATE TABLE IF NOT EXISTS signup_invitations (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash           CHAR(64) NOT NULL UNIQUE
                       CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email_normalized     VARCHAR(255) NOT NULL
                       CHECK (email_normalized = LOWER(BTRIM(email_normalized))),
  cohort               VARCHAR(100) NOT NULL,
  issued_by_actor      VARCHAR(200) NOT NULL,
  authorization_ticket VARCHAR(200) NOT NULL,
  issued_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL,
  consumed_at          TIMESTAMPTZ,
  consumed_by_user_id  UUID REFERENCES users(id),
  CONSTRAINT chk_signup_invitation_expiry CHECK (expires_at > issued_at),
  CONSTRAINT chk_signup_invitation_consumption CHECK (
    (consumed_at IS NULL AND consumed_by_user_id IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_by_user_id IS NOT NULL
        AND consumed_at >= issued_at)
  )
);
CREATE INDEX IF NOT EXISTS idx_signup_invitations_email
  ON signup_invitations(email_normalized, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_invitations_open
  ON signup_invitations(expires_at) WHERE consumed_at IS NULL;

-- ─── DURABLE SIGNUP RATE LIMIT · D-HOLD-1 ───────────────
-- Sin IP/email/token crudo/digest individual: 64 shards fijos y global.
CREATE TABLE IF NOT EXISTS signup_rate_limit_counters (
  scope       VARCHAR(64) NOT NULL,
  key_digest  CHAR(64) NOT NULL CHECK (key_digest ~ '^[0-9a-f]{64}$'),
  hits        INTEGER NOT NULL CHECK (hits > 0),
  reset_at    TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope,key_digest)
);
CREATE INDEX IF NOT EXISTS idx_signup_rate_limit_expiry
  ON signup_rate_limit_counters(reset_at);

-- ─── PAYMENT METHODS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_methods (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_method_id VARCHAR(100) UNIQUE NOT NULL,
  brand           VARCHAR(20) NOT NULL
                  CHECK (brand IN ('visa','mastercard','amex','other')),
  bank_name       VARCHAR(100),
  type            VARCHAR(20) NOT NULL CHECK (type IN ('credit','debit')),
  last_four       VARCHAR(4) NOT NULL,
  exp_month       SMALLINT,
  exp_year        SMALLINT,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  status          VARCHAR(20) NOT NULL DEFAULT 'attaching'
                  CHECK (status IN ('attaching','active','detaching','expired','removed')),
  detach_lease_id UUID,
  detach_lease_expires_at TIMESTAMPTZ,
  card_policy_version SMALLINT NOT NULL DEFAULT 0,
  card_verified_brand VARCHAR(20),
  card_verified_funding VARCHAR(20),
  card_verified_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payment_methods_card_policy_snapshot CHECK (
    (card_policy_version=0
      AND card_verified_brand IS NULL
      AND card_verified_funding IS NULL
      AND card_verified_at IS NULL)
    OR
    (card_policy_version=1
      AND card_verified_brand IS NOT NULL
      AND card_verified_brand IN ('visa','mastercard','amex')
      AND card_verified_funding IS NOT NULL
      AND card_verified_funding IN ('credit','debit')
      AND card_verified_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_methods_one_default
  ON payment_methods(user_id) WHERE is_default AND status = 'active';

-- Los IDs source sólo se definen al INSERT: ningún UPDATE puede cambiarlos, ni
-- siquiera NULL -> ID. Una promoción v0 -> v1 conserva la identidad ya ligada.
CREATE OR REPLACE FUNCTION payme_card_snapshot_payment_method_write_once()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stripe_payment_method_id IS DISTINCT FROM
     OLD.stripe_payment_method_id THEN
    RAISE EXCEPTION 'payment_method_card_snapshot_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.card_policy_version = 1 AND (
       NEW.card_policy_version, NEW.stripe_payment_method_id,
       NEW.card_verified_brand, NEW.card_verified_funding, NEW.card_verified_at
     ) IS DISTINCT FROM (
       OLD.card_policy_version, OLD.stripe_payment_method_id,
       OLD.card_verified_brand, OLD.card_verified_funding, OLD.card_verified_at
     ) THEN
    RAISE EXCEPTION 'payment_method_card_snapshot_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payment_methods_card_snapshot_write_once ON payment_methods;
CREATE TRIGGER trg_payment_methods_card_snapshot_write_once
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION payme_card_snapshot_payment_method_write_once();

-- ─── RESTAURANTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(200) NOT NULL,
  rfc             VARCHAR(20),
  address         VARCHAR(500),
  category        VARCHAR(50) NOT NULL DEFAULT 'other'
                  CHECK (category IN ('italian','japanese','mexican','cafe','other')),
  fee_pct         NUMERIC(5,4) NOT NULL DEFAULT 0.0200 CHECK (fee_pct BETWEEN 0 AND 1),
  fixed_monthly_cents BIGINT NOT NULL DEFAULT 50000,
  stripe_account_id VARCHAR(100),
  clabe           VARCHAR(18),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','deleted')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── MESAS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mesas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            VARCHAR(20) UNIQUE NOT NULL,
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
  opener_user_id  UUID NOT NULL REFERENCES users(id),
  total_cents     BIGINT NOT NULL CHECK (total_cents >= 0),
  paid_amount_cents BIGINT NOT NULL DEFAULT 0,
  tip_amount_cents  BIGINT NOT NULL DEFAULT 0,
  expected_participants SMALLINT NOT NULL DEFAULT 1
                  CHECK (expected_participants > 0 AND expected_participants <= 20),
  division_mode   VARCHAR(20) NOT NULL DEFAULT 'consumo'
                  CHECK (division_mode IN ('consumo','igual')),
  status          VARCHAR(30) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','fully_paid','partially_paid','expired','cancelled','dispersed')),
  expires_at      TIMESTAMPTZ NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Foto monetaria sellada bajo lock antes del primer side effect externo de
  -- settlement. Una vez presente, un pago tardío no puede reabrir la foto.
  settlement_fenced_at TIMESTAMPTZ,
  settlement_snapshot_total_cents BIGINT,
  settlement_snapshot_collected_cents BIGINT,
  settlement_snapshot_tip_cents BIGINT,
  settlement_snapshot_shortfall_cents BIGINT,
  -- PM de plataforma sellado antes del primer side effect de garantía. La
  -- migración v2.28.4 lo agrega también a instalaciones existentes.
  auth_source_payment_method_id VARCHAR(100),
  auth_charge_payment_method_id VARCHAR(100),
  auth_stripe_customer_id VARCHAR(100),
  auth_off_session BOOLEAN,
  auth_save_payment_method BOOLEAN,
  auth_card_policy_version SMALLINT NOT NULL DEFAULT 0,
  auth_card_brand VARCHAR(20),
  auth_card_funding VARCHAR(20),
  auth_card_verified_at TIMESTAMPTZ,
  auth_charge_card_verified_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mesas_settlement_money_fence
    CHECK (
      (settlement_fenced_at IS NULL
       AND settlement_snapshot_total_cents IS NULL
       AND settlement_snapshot_collected_cents IS NULL
       AND settlement_snapshot_tip_cents IS NULL
       AND settlement_snapshot_shortfall_cents IS NULL)
      OR
      (settlement_fenced_at IS NOT NULL
       AND settlement_snapshot_total_cents BETWEEN 1 AND 9007199254740991
       AND settlement_snapshot_collected_cents BETWEEN 0 AND 9007199254740991
       AND settlement_snapshot_tip_cents BETWEEN 0 AND 9007199254740991
       AND settlement_snapshot_shortfall_cents BETWEEN 0 AND 9007199254740991
       AND settlement_snapshot_total_cents
           = settlement_snapshot_collected_cents + settlement_snapshot_shortfall_cents)
    ),
  CONSTRAINT chk_mesas_auth_card_policy_snapshot CHECK (
    (auth_card_policy_version=0
      AND auth_card_brand IS NULL
      AND auth_card_funding IS NULL
      AND auth_card_verified_at IS NULL
      AND auth_charge_card_verified_at IS NULL)
    OR
    (auth_card_policy_version=1
      AND auth_source_payment_method_id IS NOT NULL
      AND auth_card_brand IS NOT NULL
      AND auth_card_brand IN ('visa','mastercard','amex')
      AND auth_card_funding IS NOT NULL
      AND auth_card_funding IN ('credit','debit')
      AND auth_card_verified_at IS NOT NULL
      AND ((auth_charge_payment_method_id IS NULL
            AND auth_charge_card_verified_at IS NULL)
           OR (auth_charge_payment_method_id IS NOT NULL
               AND auth_charge_card_verified_at IS NOT NULL)))
  )
);
CREATE INDEX IF NOT EXISTS idx_mesas_code       ON mesas(code);
CREATE INDEX IF NOT EXISTS idx_mesas_opener     ON mesas(opener_user_id, status);
CREATE INDEX IF NOT EXISTS idx_mesas_restaurant ON mesas(restaurant_id, status);
DROP TRIGGER IF EXISTS trg_mesas_updated ON mesas;
CREATE TRIGGER trg_mesas_updated BEFORE UPDATE ON mesas
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE OR REPLACE FUNCTION payme_card_snapshot_mesa_write_once()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.auth_source_payment_method_id IS DISTINCT FROM
     OLD.auth_source_payment_method_id THEN
    RAISE EXCEPTION 'mesa_auth_card_snapshot_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.auth_card_policy_version = 0
     AND NEW.auth_card_policy_version = 1
     AND (OLD.auth_source_payment_method_id IS NULL
          OR NEW.auth_source_payment_method_id IS DISTINCT FROM
             OLD.auth_source_payment_method_id) THEN
    RAISE EXCEPTION 'mesa_auth_card_snapshot_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.auth_card_policy_version = 1 AND (
       NEW.auth_card_policy_version, NEW.auth_source_payment_method_id,
       NEW.auth_card_brand, NEW.auth_card_funding, NEW.auth_card_verified_at
     ) IS DISTINCT FROM (
       OLD.auth_card_policy_version, OLD.auth_source_payment_method_id,
       OLD.auth_card_brand, OLD.auth_card_funding, OLD.auth_card_verified_at
     ) THEN
    RAISE EXCEPTION 'mesa_auth_card_snapshot_immutable' USING ERRCODE='23514';
  END IF;
  -- Única excepción: un charge legacy ya ligado bajo v0 puede completar su
  -- timestamp al promover, conservando exactamente el mismo ID.
  IF OLD.auth_card_policy_version = 0
     AND NEW.auth_card_policy_version = 0
     AND OLD.auth_charge_payment_method_id IS NULL
     AND OLD.auth_charge_card_verified_at IS NULL
     AND (NEW.auth_charge_payment_method_id IS NOT NULL
          OR NEW.auth_charge_card_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'mesa_charge_card_verification_immutable' USING ERRCODE='23514';
  END IF;
  IF (OLD.auth_charge_payment_method_id IS NOT NULL
      OR OLD.auth_charge_card_verified_at IS NOT NULL)
     AND (NEW.auth_charge_payment_method_id, NEW.auth_charge_card_verified_at)
         IS DISTINCT FROM
         (OLD.auth_charge_payment_method_id, OLD.auth_charge_card_verified_at)
     AND NOT (
       OLD.auth_card_policy_version = 0
       AND NEW.auth_card_policy_version = 1
       AND OLD.auth_charge_payment_method_id IS NOT NULL
       AND OLD.auth_charge_card_verified_at IS NULL
       AND NEW.auth_charge_payment_method_id IS NOT DISTINCT FROM
           OLD.auth_charge_payment_method_id
       AND NEW.auth_charge_card_verified_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'mesa_charge_card_verification_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mesas_card_snapshot_write_once ON mesas;
CREATE TRIGGER trg_mesas_card_snapshot_write_once
  BEFORE UPDATE ON mesas
  FOR EACH ROW EXECUTE FUNCTION payme_card_snapshot_mesa_write_once();

CREATE OR REPLACE FUNCTION guard_mesas_settlement_fence_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.settlement_fenced_at IS NOT NULL
     AND ROW(
       OLD.settlement_fenced_at,
       OLD.settlement_snapshot_total_cents,
       OLD.settlement_snapshot_collected_cents,
       OLD.settlement_snapshot_tip_cents,
       OLD.settlement_snapshot_shortfall_cents
     ) IS DISTINCT FROM ROW(
       NEW.settlement_fenced_at,
       NEW.settlement_snapshot_total_cents,
       NEW.settlement_snapshot_collected_cents,
       NEW.settlement_snapshot_tip_cents,
       NEW.settlement_snapshot_shortfall_cents
     ) THEN
    RAISE EXCEPTION 'settlement_money_fence_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mesas_settlement_fence_immutable ON mesas;
CREATE TRIGGER trg_mesas_settlement_fence_immutable
  BEFORE UPDATE ON mesas
  FOR EACH ROW EXECUTE FUNCTION guard_mesas_settlement_fence_immutable();

CREATE TABLE IF NOT EXISTS mesa_participants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mesa_id         UUID NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_token     VARCHAR(100),
  guest_token_hash VARCHAR(64),
  role            VARCHAR(20) NOT NULL DEFAULT 'invited'
                  CHECK (role IN ('opener','invited','joined','guest')),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','active','left')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT participant_subject CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL OR guest_token_hash IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesa_participants_user
  ON mesa_participants(mesa_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesa_participants_guest
  ON mesa_participants(mesa_id, guest_token) WHERE guest_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesa_participants_guest_hash
  ON mesa_participants(mesa_id, guest_token_hash) WHERE guest_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mesa_participants_user ON mesa_participants(user_id, status);

CREATE TABLE IF NOT EXISTS mesa_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mesa_id         UUID NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  category        VARCHAR(50) DEFAULT 'other',
  price_cents     BIGINT NOT NULL CHECK (price_cents >= 0),
  quantity        SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','locked','paid','released','refunded')),
  locked_by_user_id     UUID REFERENCES users(id),
  locked_by_guest_token VARCHAR(100),
  locked_by_guest_token_hash VARCHAR(64),  -- v2.5.2 P1 #2
  lock_token            VARCHAR(100),
  lock_expires_at       TIMESTAMPTZ,
  locked_by_attempt     UUID,
  locked_at       TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mesa_items_mesa     ON mesa_items(mesa_id, status);
CREATE INDEX IF NOT EXISTS idx_mesa_items_locker_user
  ON mesa_items(locked_by_user_id) WHERE locked_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mesa_items_locker_guest
  ON mesa_items(locked_by_guest_token) WHERE locked_by_guest_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mesa_items_locker_guest_hash
  ON mesa_items(locked_by_guest_token_hash) WHERE locked_by_guest_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mesa_items_lock_expires
  ON mesa_items(lock_expires_at) WHERE status = 'locked' AND lock_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mesa_id         UUID NOT NULL REFERENCES mesas(id),
  user_id         UUID REFERENCES users(id),
  guest_token     VARCHAR(100),
  guest_token_hash VARCHAR(64),  -- v2.5.2 P1 #2
  payment_method_id UUID REFERENCES payment_methods(id),
  items_amount_cents BIGINT NOT NULL DEFAULT 0,
  tip_amount_cents   BIGINT NOT NULL DEFAULT 0,
  gross_amount_cents BIGINT NOT NULL DEFAULT 0,
  fee_amount_cents   BIGINT NOT NULL DEFAULT 0,
  net_amount_cents   BIGINT NOT NULL DEFAULT 0,
  -- División igual: identidad durable del casillero elegido antes de Stripe.
  -- NULL para consumo y para attempts legacy previos a esta columna.
  division_slot_index SMALLINT CHECK (division_slot_index >= 0),
  stripe_payment_intent_id VARCHAR(100) UNIQUE,
  stripe_client_secret VARCHAR(255),
  stripe_status     VARCHAR(40),
  -- Snapshot durable elegido ANTES de cualquier side effect Stripe. Permite
  -- reusar exactamente riel/PM tras timeout sin recalcular configuración viva.
  stripe_contract_prepared_at TIMESTAMPTZ,
  stripe_source_payment_method_id VARCHAR(100),
  stripe_charge_payment_method_id VARCHAR(100),
  stripe_customer_id_snapshot VARCHAR(100),
  stripe_used_saved_card BOOLEAN,
  stripe_save_payment_method BOOLEAN,
  card_policy_version SMALLINT NOT NULL DEFAULT 0,
  card_brand_snapshot VARCHAR(20),
  card_funding_snapshot VARCHAR(20),
  card_verified_at TIMESTAMPTZ,
  charge_card_verified_at TIMESTAMPTZ,
  idempotency_key VARCHAR(100) NOT NULL,
  idempotency_payload_hash VARCHAR(64),
  idempotency_hash_version SMALLINT NOT NULL DEFAULT 2
                  CHECK (idempotency_hash_version IN (1,2)),
  operation_type  VARCHAR(30) NOT NULL DEFAULT 'mesa_pay',
  status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','requires_action','processing','authorized',
                                    'succeeded','processed','failed','cancelled','cancelling','refunded')),
  payment_type    VARCHAR(20) DEFAULT 'card'
                  CHECK (payment_type IN ('card','apple_pay','google_pay','wallet')),
  -- Fence fail-closed: un full refund remoto observado antes de proyectar el
  -- éxito local impide acreditar mesa/notificaciones mientras D1 converge.
  connect_refund_fenced_at TIMESTAMPTZ,
  failure_reason  VARCHAR(500),
  refunded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS chk_payment_attempts_stripe_contract_snapshot;
ALTER TABLE payment_attempts
  ADD CONSTRAINT chk_payment_attempts_stripe_contract_snapshot
  CHECK (
    stripe_contract_prepared_at IS NULL
    OR (
      stripe_source_payment_method_id IS NOT NULL
      AND stripe_used_saved_card IS NOT NULL
      AND stripe_save_payment_method IS NOT NULL
    )
  );
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS chk_payment_attempts_card_policy_snapshot;
ALTER TABLE payment_attempts
  ADD CONSTRAINT chk_payment_attempts_card_policy_snapshot
  CHECK (
    (card_policy_version=0
      AND card_brand_snapshot IS NULL
      AND card_funding_snapshot IS NULL
      AND card_verified_at IS NULL
      AND charge_card_verified_at IS NULL)
    OR
    (card_policy_version=1
      AND stripe_source_payment_method_id IS NOT NULL
      AND card_brand_snapshot IS NOT NULL
      AND card_brand_snapshot IN ('visa','mastercard','amex')
      AND card_funding_snapshot IS NOT NULL
      AND card_funding_snapshot IN ('credit','debit')
      AND card_verified_at IS NOT NULL
      AND ((stripe_charge_payment_method_id IS NULL
            AND charge_card_verified_at IS NULL)
           OR (stripe_charge_payment_method_id IS NOT NULL
               AND charge_card_verified_at IS NOT NULL)))
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempts_idem_user
  ON payment_attempts(user_id, mesa_id, operation_type, idempotency_key)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempts_idem_guest
  ON payment_attempts(guest_token, mesa_id, operation_type, idempotency_key)
  WHERE guest_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempts_idem_guest_hash
  ON payment_attempts(guest_token_hash, mesa_id, operation_type, idempotency_key)
  WHERE guest_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_attempts_mesa   ON payment_attempts(mesa_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_user   ON payment_attempts(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_stripe ON payment_attempts(stripe_payment_intent_id);
DROP TRIGGER IF EXISTS trg_payment_attempts_updated ON payment_attempts;
CREATE TRIGGER trg_payment_attempts_updated BEFORE UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE OR REPLACE FUNCTION payme_card_snapshot_attempt_write_once()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stripe_source_payment_method_id IS DISTINCT FROM
     OLD.stripe_source_payment_method_id THEN
    RAISE EXCEPTION 'payment_attempt_card_snapshot_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.card_policy_version = 0
     AND NEW.card_policy_version = 1
     AND (OLD.stripe_source_payment_method_id IS NULL
          OR NEW.stripe_source_payment_method_id IS DISTINCT FROM
             OLD.stripe_source_payment_method_id) THEN
    RAISE EXCEPTION 'payment_attempt_card_snapshot_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.card_policy_version = 1 AND (
       NEW.card_policy_version, NEW.stripe_source_payment_method_id,
       NEW.card_brand_snapshot, NEW.card_funding_snapshot, NEW.card_verified_at
     ) IS DISTINCT FROM (
       OLD.card_policy_version, OLD.stripe_source_payment_method_id,
       OLD.card_brand_snapshot, OLD.card_funding_snapshot, OLD.card_verified_at
     ) THEN
    RAISE EXCEPTION 'payment_attempt_card_snapshot_immutable' USING ERRCODE='23514';
  END IF;
  -- Misma promoción legacy segura que en mesas.
  IF OLD.card_policy_version = 0
     AND NEW.card_policy_version = 0
     AND OLD.stripe_charge_payment_method_id IS NULL
     AND OLD.charge_card_verified_at IS NULL
     AND (NEW.stripe_charge_payment_method_id IS NOT NULL
          OR NEW.charge_card_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'payment_attempt_charge_card_verification_immutable' USING ERRCODE='23514';
  END IF;
  IF (OLD.stripe_charge_payment_method_id IS NOT NULL
      OR OLD.charge_card_verified_at IS NOT NULL)
     AND (NEW.stripe_charge_payment_method_id, NEW.charge_card_verified_at)
         IS DISTINCT FROM
         (OLD.stripe_charge_payment_method_id, OLD.charge_card_verified_at)
     AND NOT (
       OLD.card_policy_version = 0
       AND NEW.card_policy_version = 1
       AND OLD.stripe_charge_payment_method_id IS NOT NULL
       AND OLD.charge_card_verified_at IS NULL
       AND NEW.stripe_charge_payment_method_id IS NOT DISTINCT FROM
           OLD.stripe_charge_payment_method_id
       AND NEW.charge_card_verified_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'payment_attempt_charge_card_verification_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payment_attempts_card_snapshot_write_once ON payment_attempts;
CREATE TRIGGER trg_payment_attempts_card_snapshot_write_once
  BEFORE UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION payme_card_snapshot_attempt_write_once();

-- Un éxito Stripe observado después del fence no se acredita contra la mesa:
-- hacerlo sumaría el pago al hold ya capturado. La obligación conserva la
-- evidencia exacta para el tratamiento D1-D sin ejecutar un refund implícito.
CREATE TABLE IF NOT EXISTS late_payment_obligations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_attempt_id UUID NOT NULL UNIQUE
    REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  mesa_id UUID NOT NULL REFERENCES mesas(id) ON DELETE RESTRICT,
  payment_type VARCHAR(20) NOT NULL
    CHECK (payment_type IN ('card','apple_pay','google_pay','wallet')),
  rail VARCHAR(20) NOT NULL
    CHECK (rail IN ('connect_direct','platform_card','wallet')),
  stripe_payment_intent_id VARCHAR(100),
  stripe_account_id VARCHAR(100),
  items_amount_cents BIGINT NOT NULL CHECK (items_amount_cents >= 0),
  tip_amount_cents BIGINT NOT NULL CHECK (tip_amount_cents >= 0),
  gross_amount_cents BIGINT NOT NULL CHECK (gross_amount_cents > 0),
  settlement_fenced_at TIMESTAMPTZ NOT NULL,
  settlement_snapshot_collected_cents BIGINT NOT NULL
    CHECK (settlement_snapshot_collected_cents >= 0),
  settlement_snapshot_tip_cents BIGINT NOT NULL
    CHECK (settlement_snapshot_tip_cents >= 0),
  settlement_snapshot_shortfall_cents BIGINT NOT NULL
    CHECK (settlement_snapshot_shortfall_cents >= 0),
  policy_code VARCHAR(20) NOT NULL DEFAULT 'D1-D' CHECK (policy_code = 'D1-D'),
  status VARCHAR(20) NOT NULL DEFAULT 'manual_review'
    CHECK (status IN ('manual_review','resolved')),
  reason VARCHAR(200) NOT NULL,
  resolution VARCHAR(500),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT chk_late_payment_amounts
    CHECK (gross_amount_cents = items_amount_cents + tip_amount_cents),
  CONSTRAINT chk_late_payment_rail_binding
    CHECK (
      (rail = 'connect_direct'
       AND stripe_account_id IS NOT NULL AND stripe_payment_intent_id IS NOT NULL)
      OR (rail = 'platform_card'
          AND stripe_account_id IS NULL AND stripe_payment_intent_id IS NOT NULL)
      OR (rail = 'wallet'
          AND stripe_account_id IS NULL AND stripe_payment_intent_id IS NULL)
    ),
  CONSTRAINT chk_late_payment_resolution
    CHECK (
      (status = 'manual_review' AND resolved_at IS NULL)
      OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolution IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_late_payment_obligations_review
  ON late_payment_obligations(detected_at, payment_attempt_id)
  WHERE status = 'manual_review';

ALTER TABLE mesa_items DROP CONSTRAINT IF EXISTS fk_mesa_items_locked_by_attempt;
ALTER TABLE mesa_items
  ADD CONSTRAINT fk_mesa_items_locked_by_attempt
  FOREIGN KEY (locked_by_attempt) REFERENCES payment_attempts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS payment_attempt_items (
  payment_attempt_id UUID NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  mesa_item_id    UUID NOT NULL REFERENCES mesa_items(id),
  PRIMARY KEY (payment_attempt_id, mesa_item_id)
);

CREATE TABLE IF NOT EXISTS mesa_division_slots (
  mesa_id         UUID NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  slot_index      SMALLINT NOT NULL CHECK (slot_index >= 0),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents >= 0),
  claimed_by_attempt_id UUID REFERENCES payment_attempts(id) ON DELETE SET NULL,
  claimed_by_user_id    UUID REFERENCES users(id),
  claimed_by_guest_token VARCHAR(100),
  claimed_by_guest_token_hash VARCHAR(64),  -- v2.5.2 P1 #2
  claimed_at      TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','claimed','paid','released')),
  PRIMARY KEY (mesa_id, slot_index)
);
CREATE INDEX IF NOT EXISTS idx_division_slots_status ON mesa_division_slots(mesa_id, status);

ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS fk_payment_attempts_division_slot;
ALTER TABLE payment_attempts
  ADD CONSTRAINT fk_payment_attempts_division_slot
  FOREIGN KEY (mesa_id, division_slot_index)
  REFERENCES mesa_division_slots(mesa_id, slot_index)
  DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS idx_payment_attempts_division_slot
  ON payment_attempts(mesa_id, division_slot_index)
  WHERE division_slot_index IS NOT NULL;

-- ─── processed_webhook_events ─────────────────────────────
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id        VARCHAR(100) PRIMARY KEY,
  provider        VARCHAR(20) NOT NULL DEFAULT 'stripe',
  event_type      VARCHAR(100) NOT NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'processing'
                  CHECK (status IN ('processing','processed',
                                    'retryable_no_local_record',
                                    'failed_retryable','failed_terminal')),
  processing_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  failure_reason  VARCHAR(500),
  retry_count     SMALLINT NOT NULL DEFAULT 0,
  processing_lease_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_processed_events_type
  ON processed_webhook_events(event_type, processing_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_processed_events_stuck
  ON processed_webhook_events(processing_started_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_processed_events_retryable
  ON processed_webhook_events(status, last_attempt_at)
  WHERE status IN ('retryable_no_local_record','failed_retryable');

-- ─── FRIENDS + GROUPS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'accepted'
                  CHECK (status IN ('pending','accepted','blocked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_friendship CHECK (user_id <> friend_user_id),
  UNIQUE (user_id, friend_user_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id, status);

CREATE TABLE IF NOT EXISTS friend_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  icon            VARCHAR(10) DEFAULT '👥',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS friend_group_members (
  group_id        UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  friend_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, friend_user_id)
);

-- ─── INVITATIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invitations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mesa_id         UUID NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  inviter_user_id UUID NOT NULL REFERENCES users(id),
  invited_user_id UUID REFERENCES users(id),
  invited_payme_id VARCHAR(50),
  invitation_type VARCHAR(20) NOT NULL CHECK (invitation_type IN ('in_app','link')),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','cancelled','expired')),
  token           VARCHAR(100) UNIQUE,
  token_hash      VARCHAR(64),
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_by_id UUID,
  CONSTRAINT fk_invitations_superseded_by
    FOREIGN KEY (superseded_by_id) REFERENCES invitations(id) ON DELETE CASCADE,
  CONSTRAINT chk_invitation_not_self_superseded
    CHECK (superseded_by_id IS NULL OR superseded_by_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_invitations_mesa    ON invitations(mesa_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_invited ON invitations(invited_user_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_token   ON invitations(token) WHERE token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_token_hash
  ON invitations(token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending_in_app
  ON invitations(mesa_id, inviter_user_id, invited_user_id)
  WHERE invitation_type = 'in_app' AND status = 'pending'
    AND superseded_by_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending_link
  ON invitations(mesa_id, inviter_user_id)
  WHERE invitation_type = 'link' AND status = 'pending'
    AND superseded_by_id IS NULL;

-- Cada clave de request queda ligada a la autoridad canónica que produjo. Más
-- de una clave puede converger a la misma invitación sin perder detección de
-- reuse con otro payload.
CREATE TABLE IF NOT EXISTS invitation_requests (
  inviter_user_id UUID NOT NULL REFERENCES users(id),
  mesa_id         UUID NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(100) NOT NULL,
  payload_hash    VARCHAR(64) NOT NULL,
  invitation_id   UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (inviter_user_id, mesa_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_invitation_requests_invitation
  ON invitation_requests(invitation_id);

-- ─── TOPUPS + TRANSFERS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS topups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id),
  method          VARCHAR(20) NOT NULL CHECK (method IN ('oxxo','card','spei')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents       BIGINT NOT NULL DEFAULT 0,
  net_cents       BIGINT NOT NULL,
  stripe_payment_intent_id VARCHAR(100) UNIQUE,
  stripe_client_secret VARCHAR(255),
  stripe_voucher_url VARCHAR(500),
  voucher_reference VARCHAR(100),
  voucher_expires_at TIMESTAMPTZ,
  payment_method_id UUID REFERENCES payment_methods(id),
  stripe_contract_prepared_at TIMESTAMPTZ,
  stripe_customer_id_snapshot VARCHAR(100),
  stripe_payment_method_id_snapshot VARCHAR(100),
  stripe_status    VARCHAR(40),
  billing_email_snapshot VARCHAR(255),
  billing_name_snapshot VARCHAR(200),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','succeeded','failed','expired','cancelled')),
  failure_reason  VARCHAR(500),
  idempotency_key VARCHAR(100) NOT NULL,
  idempotency_payload_hash VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_topups_idem_user ON topups(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_topups_user ON topups(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topups_stripe ON topups(stripe_payment_intent_id);
DROP TRIGGER IF EXISTS trg_topups_updated ON topups;
CREATE TRIGGER trg_topups_updated BEFORE UPDATE ON topups
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS transfers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user_id    UUID NOT NULL REFERENCES users(id),
  to_user_id      UUID NOT NULL REFERENCES users(id),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  concept         VARCHAR(200),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','completed','failed','reversed')),
  failure_reason  VARCHAR(500),
  idempotency_key VARCHAR(100) NOT NULL,
  idempotency_payload_hash VARCHAR(64),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_transfer CHECK (from_user_id <> to_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transfers_idem ON transfers(from_user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_to   ON transfers(to_user_id,   created_at DESC);

-- ─── RESTAURANT STAFF + TIPS ─────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_staff (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            VARCHAR(30) NOT NULL DEFAULT 'waiter'
                  CHECK (role IN ('waiter','bartender','manager','host','runner','owner')),
  display_name    VARCHAR(100) NOT NULL,
  shift_status    VARCHAR(20) NOT NULL DEFAULT 'off'
                  CHECK (shift_status IN ('on','off','break')),
  hired_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at      TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','removed')),
  UNIQUE (restaurant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_restaurant ON restaurant_staff(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_staff_user       ON restaurant_staff(user_id);

CREATE TABLE IF NOT EXISTS tip_distributions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_attempt_id UUID NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  mesa_id         UUID NOT NULL REFERENCES mesas(id),
  staff_id        UUID REFERENCES restaurant_staff(id),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents >= 0),
  status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','credited','reversed','partially_reversed')),
  credited_at     TIMESTAMPTZ,
  reversed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tips_staff   ON tip_distributions(staff_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tips_attempt ON tip_distributions(payment_attempt_id);

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
CREATE INDEX IF NOT EXISTS idx_tip_reversals_attempt ON tip_refund_reversals(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_tip_reversals_review
  ON tip_refund_reversals(status) WHERE status = 'manual_review';

CREATE TABLE IF NOT EXISTS payment_refunds (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_attempt_id UUID NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  stripe_charge_id  VARCHAR(100),
  stripe_refund_id  VARCHAR(100),
  refund_type     VARCHAR(20) NOT NULL CHECK (refund_type IN ('full','partial')),
  source          VARCHAR(20) NOT NULL DEFAULT 'stripe'
                  CHECK (source IN ('stripe','stripe_connect','wallet','manual')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents >= 0),
  original_amount_cents BIGINT,
  status          VARCHAR(30) NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN ('fee_pending','processed','pending_review','failed','ignored_duplicate')),
  reason          VARCHAR(500),
  raw_event_id    VARCHAR(100),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refunds_raw_event
  ON payment_refunds(raw_event_id) WHERE raw_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_refunds_attempt ON payment_refunds(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_review
  ON payment_refunds(status, created_at DESC) WHERE status = 'pending_review';

-- ─── NOTIFICATIONS + PUSH + MISC ─────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(50) NOT NULL,
  title           VARCHAR(200) NOT NULL,
  body            VARCHAR(500),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_entity_type VARCHAR(30),
  related_entity_id   UUID,
  read_at         TIMESTAMPTZ,
  pushed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_push_pending
  ON notifications(created_at) WHERE pushed_at IS NULL;

CREATE TABLE IF NOT EXISTS push_devices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token           VARCHAR(500) NOT NULL,
  platform        VARCHAR(20) NOT NULL CHECK (platform IN ('ios','android','web')),
  device_id       VARCHAR(100),
  app_version     VARCHAR(20),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);

CREATE TABLE IF NOT EXISTS state_transitions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type     VARCHAR(30) NOT NULL,
  entity_id       UUID NOT NULL,
  from_state      VARCHAR(30),
  to_state        VARCHAR(30) NOT NULL,
  reason          VARCHAR(200),
  triggered_by    VARCHAR(30),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_state_transitions_entity
  ON state_transitions(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dispersals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mesa_id         UUID NOT NULL REFERENCES mesas(id),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
  amount_cents    BIGINT NOT NULL,
  fee_cents       BIGINT NOT NULL,
  net_cents       BIGINT NOT NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','submitted','sent','confirmed','failed','retrying','manual_review')),
  retry_count     SMALLINT NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  stp_clave_rastreo VARCHAR(100) UNIQUE,
  -- Payload monetario/destino sellado antes del primer request externo. Un
  -- retry por rechazo explícito reutiliza exactamente esta misma orden.
  stp_request_snapshot JSONB,
  stp_request_hash VARCHAR(64),
  stp_provider_mode VARCHAR(10)
                    CONSTRAINT chk_dispersals_stp_provider_mode
                    CHECK (stp_provider_mode IN ('mock','real')),
  stp_provider_id VARCHAR(100),
  stp_submitted_at TIMESTAMPTZ,
  stp_confirmed_at TIMESTAMPTZ,
  failure_reason  VARCHAR(500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_dispersals_stp_request_snapshot
    CHECK (
      (stp_request_snapshot IS NULL AND stp_request_hash IS NULL
       AND stp_provider_mode IS NULL)
      OR
      (jsonb_typeof(stp_request_snapshot)='object'
       AND stp_request_hash ~ '^[0-9a-f]{64}$'
       AND stp_provider_mode IS NOT NULL)
    ),
  CONSTRAINT chk_dispersals_stp_inflight_proof
    CHECK (status NOT IN ('processing','retrying','failed')
           OR stp_request_hash IS NOT NULL),
  CONSTRAINT chk_dispersals_stp_submitted_proof
    CHECK (status <> 'submitted'
           OR (stp_request_hash IS NOT NULL AND stp_provider_mode='real'
               AND stp_provider_id IS NOT NULL AND stp_submitted_at IS NOT NULL)),
  CONSTRAINT chk_dispersals_stp_sent_proof
    CHECK (status <> 'sent'
           OR (amount_cents=0 AND fee_cents=0 AND net_cents=0
               AND failure_reason='liquidado_por_stripe_connect')
           OR (stp_request_hash IS NOT NULL AND stp_provider_mode='mock'
               AND stp_submitted_at IS NOT NULL)),
  CONSTRAINT chk_dispersals_stp_confirmed_proof
    CHECK (status <> 'confirmed'
           OR (stp_request_hash IS NOT NULL AND stp_provider_mode='real'
               AND stp_provider_id IS NOT NULL AND stp_submitted_at IS NOT NULL
               AND stp_confirmed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_dispersals_status ON dispersals(status, next_retry_at);
DROP TRIGGER IF EXISTS trg_dispersals_updated ON dispersals;
CREATE TRIGGER trg_dispersals_updated BEFORE UPDATE ON dispersals
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE OR REPLACE FUNCTION guard_dispersal_stp_request_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stp_request_hash IS NOT NULL
     AND ROW(OLD.stp_request_snapshot, OLD.stp_request_hash, OLD.stp_provider_mode)
         IS DISTINCT FROM
         ROW(NEW.stp_request_snapshot, NEW.stp_request_hash, NEW.stp_provider_mode) THEN
    RAISE EXCEPTION 'dispersal_stp_request_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dispersal_stp_request_immutable ON dispersals;
CREATE TRIGGER trg_dispersal_stp_request_immutable
  BEFORE UPDATE ON dispersals
  FOR EACH ROW EXECUTE FUNCTION guard_dispersal_stp_request_immutable();

COMMIT;
