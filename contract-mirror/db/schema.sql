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
CREATE TABLE users (
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
CREATE INDEX idx_users_payme_id ON users(payme_id);
CREATE INDEX idx_users_email    ON users(email);
CREATE UNIQUE INDEX uq_users_email_normalized
  ON users(email_normalized) WHERE email_normalized IS NOT NULL;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE wallets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_cents   BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  clabe           VARCHAR(18) UNIQUE,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE wallet_transactions (
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
CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX idx_wallet_tx_type ON wallet_transactions(type, created_at DESC);

-- ─── USER SESSIONS (v2.5.1 P1 #6 + v2.5.2 P2 #10 rotation) ─
CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti             VARCHAR(100) UNIQUE,
  refresh_token_hash      VARCHAR(255),
  prev_refresh_token_hash VARCHAR(255),  -- v2.5.2 P2 #10: reuse detection (1 nivel)
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
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, status);
CREATE INDEX idx_user_sessions_jti  ON user_sessions(jti) WHERE jti IS NOT NULL;
CREATE INDEX idx_user_sessions_refresh
  ON user_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX idx_user_sessions_prev_refresh
  ON user_sessions(prev_refresh_token_hash) WHERE prev_refresh_token_hash IS NOT NULL;
CREATE INDEX idx_user_sessions_expires
  ON user_sessions(expires_at) WHERE status = 'active';

-- ─── PAYMENT METHODS ──────────────────────────────────────
CREATE TABLE payment_methods (
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
                  CHECK (status IN ('attaching','active','expired','removed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payment_methods_user ON payment_methods(user_id, status);

-- ─── RESTAURANTS ──────────────────────────────────────────
CREATE TABLE restaurants (
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
CREATE TABLE mesas (
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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mesas_code       ON mesas(code);
CREATE INDEX idx_mesas_opener     ON mesas(opener_user_id, status);
CREATE INDEX idx_mesas_restaurant ON mesas(restaurant_id, status);
CREATE TRIGGER trg_mesas_updated BEFORE UPDATE ON mesas
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE mesa_participants (
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
CREATE UNIQUE INDEX uq_mesa_participants_user
  ON mesa_participants(mesa_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_mesa_participants_guest
  ON mesa_participants(mesa_id, guest_token) WHERE guest_token IS NOT NULL;
CREATE UNIQUE INDEX uq_mesa_participants_guest_hash
  ON mesa_participants(mesa_id, guest_token_hash) WHERE guest_token_hash IS NOT NULL;
CREATE INDEX idx_mesa_participants_user ON mesa_participants(user_id, status);

CREATE TABLE mesa_items (
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
CREATE INDEX idx_mesa_items_mesa     ON mesa_items(mesa_id, status);
CREATE INDEX idx_mesa_items_locker_user
  ON mesa_items(locked_by_user_id) WHERE locked_by_user_id IS NOT NULL;
CREATE INDEX idx_mesa_items_locker_guest
  ON mesa_items(locked_by_guest_token) WHERE locked_by_guest_token IS NOT NULL;
CREATE INDEX idx_mesa_items_locker_guest_hash
  ON mesa_items(locked_by_guest_token_hash) WHERE locked_by_guest_token_hash IS NOT NULL;
CREATE INDEX idx_mesa_items_lock_expires
  ON mesa_items(lock_expires_at) WHERE status = 'locked' AND lock_expires_at IS NOT NULL;

CREATE TABLE payment_attempts (
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
  stripe_payment_intent_id VARCHAR(100) UNIQUE,
  stripe_client_secret VARCHAR(255),
  idempotency_key VARCHAR(100) NOT NULL,
  idempotency_payload_hash VARCHAR(64),
  operation_type  VARCHAR(30) NOT NULL DEFAULT 'mesa_pay',
  status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','requires_action','processing','authorized',
                                    'succeeded','processed','failed','cancelled','cancelling','refunded')),
  payment_type    VARCHAR(20) DEFAULT 'card'
                  CHECK (payment_type IN ('card','apple_pay','google_pay','wallet')),
  failure_reason  VARCHAR(500),
  refunded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_payment_attempts_idem_user
  ON payment_attempts(user_id, mesa_id, operation_type, idempotency_key)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_payment_attempts_idem_guest
  ON payment_attempts(guest_token, mesa_id, operation_type, idempotency_key)
  WHERE guest_token IS NOT NULL;
CREATE UNIQUE INDEX uq_payment_attempts_idem_guest_hash
  ON payment_attempts(guest_token_hash, mesa_id, operation_type, idempotency_key)
  WHERE guest_token_hash IS NOT NULL;
CREATE INDEX idx_payment_attempts_mesa   ON payment_attempts(mesa_id, status);
CREATE INDEX idx_payment_attempts_user   ON payment_attempts(user_id, status, created_at DESC);
CREATE INDEX idx_payment_attempts_stripe ON payment_attempts(stripe_payment_intent_id);
CREATE TRIGGER trg_payment_attempts_updated BEFORE UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE mesa_items
  ADD CONSTRAINT fk_mesa_items_locked_by_attempt
  FOREIGN KEY (locked_by_attempt) REFERENCES payment_attempts(id) ON DELETE SET NULL;

CREATE TABLE payment_attempt_items (
  payment_attempt_id UUID NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  mesa_item_id    UUID NOT NULL REFERENCES mesa_items(id),
  PRIMARY KEY (payment_attempt_id, mesa_item_id)
);

CREATE TABLE mesa_division_slots (
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
CREATE INDEX idx_division_slots_status ON mesa_division_slots(mesa_id, status);

-- ─── processed_webhook_events ─────────────────────────────
CREATE TABLE processed_webhook_events (
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
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_processed_events_type
  ON processed_webhook_events(event_type, processing_started_at DESC);
CREATE INDEX idx_processed_events_stuck
  ON processed_webhook_events(processing_started_at) WHERE status = 'processing';
CREATE INDEX idx_processed_events_retryable
  ON processed_webhook_events(status, last_attempt_at)
  WHERE status IN ('retryable_no_local_record','failed_retryable');

-- ─── FRIENDS + GROUPS ─────────────────────────────────────
CREATE TABLE friendships (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'accepted'
                  CHECK (status IN ('pending','accepted','blocked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_friendship CHECK (user_id <> friend_user_id),
  UNIQUE (user_id, friend_user_id)
);
CREATE INDEX idx_friendships_user ON friendships(user_id, status);

CREATE TABLE friend_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  icon            VARCHAR(10) DEFAULT '👥',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE friend_group_members (
  group_id        UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  friend_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, friend_user_id)
);

-- ─── INVITATIONS ──────────────────────────────────────────
CREATE TABLE invitations (
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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invitations_mesa    ON invitations(mesa_id, status);
CREATE INDEX idx_invitations_invited ON invitations(invited_user_id, status);
CREATE INDEX idx_invitations_token   ON invitations(token) WHERE token IS NOT NULL;
CREATE UNIQUE INDEX uq_invitations_token_hash
  ON invitations(token_hash) WHERE token_hash IS NOT NULL;

-- ─── TOPUPS + TRANSFERS ───────────────────────────────────
CREATE TABLE topups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id),
  method          VARCHAR(20) NOT NULL CHECK (method IN ('oxxo','card','spei')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents       BIGINT NOT NULL DEFAULT 0,
  net_cents       BIGINT NOT NULL,
  stripe_payment_intent_id VARCHAR(100) UNIQUE,
  stripe_voucher_url VARCHAR(500),
  voucher_reference VARCHAR(100),
  voucher_expires_at TIMESTAMPTZ,
  payment_method_id UUID REFERENCES payment_methods(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','succeeded','failed','expired','cancelled')),
  failure_reason  VARCHAR(500),
  idempotency_key VARCHAR(100) NOT NULL,
  idempotency_payload_hash VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_topups_idem_user ON topups(user_id, idempotency_key);
CREATE INDEX idx_topups_user ON topups(user_id, status, created_at DESC);
CREATE INDEX idx_topups_stripe ON topups(stripe_payment_intent_id);
CREATE TRIGGER trg_topups_updated BEFORE UPDATE ON topups
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE transfers (
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
CREATE UNIQUE INDEX uq_transfers_idem ON transfers(from_user_id, idempotency_key);
CREATE INDEX idx_transfers_from ON transfers(from_user_id, created_at DESC);
CREATE INDEX idx_transfers_to   ON transfers(to_user_id,   created_at DESC);

-- ─── RESTAURANT STAFF + TIPS ─────────────────────────────
CREATE TABLE restaurant_staff (
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
CREATE INDEX idx_staff_restaurant ON restaurant_staff(restaurant_id, status);
CREATE INDEX idx_staff_user       ON restaurant_staff(user_id);

CREATE TABLE tip_distributions (
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
CREATE INDEX idx_tips_staff   ON tip_distributions(staff_id, status, created_at DESC);
CREATE INDEX idx_tips_attempt ON tip_distributions(payment_attempt_id);

CREATE TABLE tip_refund_reversals (
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
CREATE INDEX idx_tip_reversals_attempt ON tip_refund_reversals(payment_attempt_id);
CREATE INDEX idx_tip_reversals_review
  ON tip_refund_reversals(status) WHERE status = 'manual_review';

CREATE TABLE payment_refunds (
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
CREATE UNIQUE INDEX uq_payment_refunds_raw_event
  ON payment_refunds(raw_event_id) WHERE raw_event_id IS NOT NULL;
CREATE INDEX idx_payment_refunds_attempt ON payment_refunds(payment_attempt_id);
CREATE INDEX idx_payment_refunds_review
  ON payment_refunds(status, created_at DESC) WHERE status = 'pending_review';

-- ─── NOTIFICATIONS + PUSH + MISC ─────────────────────────
CREATE TABLE notifications (
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
CREATE INDEX idx_notif_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notif_push_pending
  ON notifications(created_at) WHERE pushed_at IS NULL;

CREATE TABLE push_devices (
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
CREATE INDEX idx_push_devices_user ON push_devices(user_id);

CREATE TABLE state_transitions (
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
CREATE INDEX idx_state_transitions_entity
  ON state_transitions(entity_type, entity_id, created_at DESC);

CREATE TABLE dispersals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mesa_id         UUID NOT NULL REFERENCES mesas(id),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
  amount_cents    BIGINT NOT NULL,
  fee_cents       BIGINT NOT NULL,
  net_cents       BIGINT NOT NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','sent','confirmed','failed','retrying','manual_review')),
  retry_count     SMALLINT NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  stp_clave_rastreo VARCHAR(100) UNIQUE,
  failure_reason  VARCHAR(500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dispersals_status ON dispersals(status, next_retry_at);
CREATE TRIGGER trg_dispersals_updated BEFORE UPDATE ON dispersals
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
