-- D1-A/B · refunds canónicos de direct charges bajo Stripe Connect.
--
-- Autoridad monetaria: una fila por Refund de Stripe. `charge.refunded` es
-- únicamente una señal de reconciliación; nunca autoriza efectos por sí sola.
-- Esta migración todavía no fue desplegada y reemplaza el diseño WIP anterior.
BEGIN;

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS connect_refund_fenced_at TIMESTAMPTZ;

-- D1-C ya exige distinguir la reversa que sale de una cuenta conectada. Es una
-- ampliación interna; E7 continúa retenido y esta migración no emite eventos.
ALTER TABLE payment_refunds
  DROP CONSTRAINT IF EXISTS payment_refunds_source_check;
ALTER TABLE payment_refunds
  ADD CONSTRAINT payment_refunds_source_check
  CHECK (source IN ('stripe','stripe_connect','wallet','manual'));

-- `fee_pending` evita declarar completo el refund local antes de confirmar la
-- devolución explícita de la application fee.
ALTER TABLE payment_refunds
  DROP CONSTRAINT IF EXISTS payment_refunds_status_check;
-- El default histórico decía `pending` aunque el CHECK vigente no lo admitía.
-- Bases antiguas pueden conservar filas creadas antes de ese CHECK: se llevan
-- al estado fail-closed, nunca a `processed` por inferencia.
UPDATE payment_refunds
   SET status='pending_review',
       reason=COALESCE(reason,'legacy_pending_status_migrated')
 WHERE status='pending';
ALTER TABLE payment_refunds
  ALTER COLUMN status SET DEFAULT 'pending_review';
ALTER TABLE payment_refunds
  ADD CONSTRAINT payment_refunds_status_check
  CHECK (status IN (
    'fee_pending','processed','pending_review','failed','ignored_duplicate'
  ));

-- Agregado serializable por Charge. Conserva snapshots originales; ningún
-- cálculo depende de fee_pct vivo ni del orden de webhooks.
CREATE TABLE IF NOT EXISTS connect_charge_refund_obligations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_type VARCHAR(30) NOT NULL
    CHECK (owner_type IN ('payment_attempt','captured_guarantee')),
  owner_id UUID NOT NULL,
  payment_attempt_id UUID REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  mesa_id UUID NOT NULL REFERENCES mesas(id) ON DELETE RESTRICT,
  first_raw_event_id VARCHAR(100) NOT NULL,
  last_raw_event_id VARCHAR(100) NOT NULL,
  stripe_account_id VARCHAR(100) NOT NULL,
  stripe_payment_intent_id VARCHAR(100) NOT NULL,
  stripe_charge_id VARCHAR(100) NOT NULL,
  stripe_application_fee_id VARCHAR(100),
  currency VARCHAR(3) NOT NULL DEFAULT 'mxn' CHECK (currency='mxn'),
  captured_amount_cents BIGINT NOT NULL
    CHECK (captured_amount_cents > 0 AND captured_amount_cents <= 9007199254740991),
  original_application_fee_cents BIGINT NOT NULL
    CHECK (original_application_fee_cents BETWEEN 0 AND 9007199254740991),
  original_commission_cents BIGINT NOT NULL
    CHECK (original_commission_cents BETWEEN 0 AND 9007199254740991),
  original_tip_cents BIGINT NOT NULL
    CHECK (original_tip_cents BETWEEN 0 AND 9007199254740991),
  cumulative_succeeded_refund_cents BIGINT NOT NULL DEFAULT 0
    CHECK (cumulative_succeeded_refund_cents BETWEEN 0 AND 9007199254740991),
  commission_target_cents BIGINT NOT NULL DEFAULT 0
    CHECK (commission_target_cents BETWEEN 0 AND 9007199254740991),
  commission_planned_cents BIGINT NOT NULL DEFAULT 0
    CHECK (commission_planned_cents BETWEEN 0 AND 9007199254740991),
  local_full_applied BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(30) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','manual_review')),
  last_error VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stripe_account_id, stripe_charge_id),
  CONSTRAINT chk_connect_refund_owner
    CHECK (
      (owner_type='payment_attempt' AND payment_attempt_id=owner_id)
      OR
      (owner_type='captured_guarantee' AND payment_attempt_id IS NULL AND mesa_id=owner_id)
    ),
  CONSTRAINT chk_connect_refund_fee_components
    CHECK (
      -- La propina viaja al restaurante en el direct charge. La application
      -- fee pertenece sólo a PayMe y por eso coincide con su comisión.
      original_application_fee_cents = original_commission_cents
    ),
  CONSTRAINT chk_connect_refund_aggregate_bounds
    CHECK (
      cumulative_succeeded_refund_cents <= captured_amount_cents
      AND commission_target_cents <= original_commission_cents
      AND commission_planned_cents <= commission_target_cents
    ),
  CONSTRAINT chk_connect_refund_obligation_terminal
    CHECK (
      (status='completed' AND completed_at IS NOT NULL)
      OR status<>'completed'
    )
);

-- Estado actual de cada Refund canónico. Los estados del proveedor no se
-- fuerzan monotónicos: una regresión posterior a efectos queda manual_review.
CREATE TABLE IF NOT EXISTS connect_refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  refund_obligation_id UUID NOT NULL
    REFERENCES connect_charge_refund_obligations(id) ON DELETE RESTRICT,
  stripe_account_id VARCHAR(100) NOT NULL,
  stripe_refund_id VARCHAR(100) NOT NULL,
  stripe_charge_id VARCHAR(100) NOT NULL,
  stripe_payment_intent_id VARCHAR(100) NOT NULL,
  currency VARCHAR(3) NOT NULL CHECK (currency='mxn'),
  amount_cents BIGINT NOT NULL
    CHECK (amount_cents > 0 AND amount_cents <= 9007199254740991),
  provider_status VARCHAR(30) NOT NULL
    CHECK (provider_status IN (
      'pending','requires_action','succeeded','failed','canceled'
    )),
  provider_created_at TIMESTAMPTZ,
  provider_failure_reason VARCHAR(100),
  provider_pending_reason VARCHAR(100),
  latest_raw_event_id VARCHAR(100) NOT NULL,
  projection_status VARCHAR(30) NOT NULL
    CHECK (projection_status IN (
      'waiting_provider','ready','local_applied','fee_pending',
      'partial_policy_pending','completed','no_effect','manual_review'
    )),
  payment_refund_id UUID UNIQUE REFERENCES payment_refunds(id) ON DELETE RESTRICT,
  commission_target_cents BIGINT NOT NULL DEFAULT 0
    CHECK (commission_target_cents BETWEEN 0 AND 9007199254740991),
  commission_delta_cents BIGINT NOT NULL DEFAULT 0
    CHECK (commission_delta_cents BETWEEN 0 AND 9007199254740991),
  local_adjustment_cents BIGINT NOT NULL DEFAULT 0
    CHECK (local_adjustment_cents BETWEEN 0 AND 9007199254740991),
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  retry_count BIGINT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_attempt_at TIMESTAMPTZ,
  last_error VARCHAR(500),
  local_applied_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stripe_account_id, stripe_refund_id),
  CONSTRAINT chk_connect_refund_lease
    CHECK (
      (lease_id IS NULL AND lease_expires_at IS NULL)
      OR (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
    ),
  CONSTRAINT chk_connect_refund_terminal_time
    CHECK (
      (projection_status='completed' AND completed_at IS NOT NULL)
      OR projection_status<>'completed'
    )
);

DROP INDEX IF EXISTS idx_connect_refunds_work;
CREATE INDEX idx_connect_refunds_work
  ON connect_refunds(projection_status, last_attempt_at, created_at)
  WHERE projection_status IN ('waiting_provider','ready','local_applied','fee_pending');
CREATE INDEX IF NOT EXISTS idx_connect_refunds_obligation
  ON connect_refunds(refund_obligation_id, created_at, id);

-- Evidencia firmada, append-only. Un charge.refunded puede no apuntar a un
-- Refund concreto; los eventos refund.* sí quedan vinculados.
CREATE TABLE IF NOT EXISTS connect_charge_refund_events (
  raw_event_id VARCHAR(100) PRIMARY KEY,
  refund_obligation_id UUID
    REFERENCES connect_charge_refund_obligations(id) ON DELETE RESTRICT,
  connect_refund_id UUID REFERENCES connect_refunds(id) ON DELETE RESTRICT,
  event_type VARCHAR(40) NOT NULL
    CHECK (event_type IN (
      'refund.created','refund.updated','refund.failed','charge.refunded',
      'provider_reconciliation'
    )),
  stripe_account_id VARCHAR(100) NOT NULL,
  stripe_refund_id VARCHAR(100),
  stripe_charge_id VARCHAR(100) NOT NULL,
  provider_status_snapshot VARCHAR(30),
  observed_amount_cents BIGINT
    CHECK (observed_amount_cents IS NULL OR observed_amount_cents >= 0),
  observed_cumulative_refunded_cents BIGINT
    CHECK (
      observed_cumulative_refunded_cents IS NULL
      OR observed_cumulative_refunded_cents >= 0
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_connect_refund_event_shape
    CHECK (
      (event_type='charge.refunded' AND connect_refund_id IS NULL
        AND stripe_refund_id IS NULL)
      OR
      (event_type<>'charge.refunded' AND connect_refund_id IS NOT NULL
        AND stripe_refund_id IS NOT NULL)
  )
);

-- Cuarentena durable para direct charges históricos o contratos locales que
-- no pueden interpretarse bajo D1 vigente. No normaliza fee+tip, no toca
-- wallets y evita que el inbox reintente para siempre sin evidencia local.
CREATE TABLE IF NOT EXISTS connect_refund_quarantine_events (
  raw_event_id VARCHAR(100) PRIMARY KEY,
  event_type VARCHAR(40) NOT NULL
    CHECK (event_type IN (
      'refund.created','refund.updated','refund.failed','provider_reconciliation'
    )),
  stripe_account_id VARCHAR(100) NOT NULL,
  stripe_refund_id VARCHAR(100) NOT NULL,
  stripe_charge_id VARCHAR(100) NOT NULL,
  stripe_payment_intent_id VARCHAR(100) NOT NULL,
  currency VARCHAR(3) NOT NULL CHECK (currency='mxn'),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  signed_provider_status VARCHAR(30) NOT NULL,
  observed_provider_status VARCHAR(30) NOT NULL,
  reason_code VARCHAR(100) NOT NULL,
  reason_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status VARCHAR(30) NOT NULL DEFAULT 'manual_review'
    CHECK (review_status='manual_review'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_connect_refund_quarantine_inventory
  ON connect_refund_quarantine_events(
    review_status,reason_code,stripe_account_id,stripe_refund_id
  );

CREATE OR REPLACE FUNCTION reject_connect_refund_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'connect_refund_event_immutable' USING ERRCODE='23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_connect_refund_event_immutable
  ON connect_charge_refund_events;
CREATE TRIGGER trg_connect_refund_event_immutable
  BEFORE UPDATE OR DELETE ON connect_charge_refund_events
  FOR EACH ROW EXECUTE FUNCTION reject_connect_refund_event_mutation();

DROP TRIGGER IF EXISTS trg_connect_refund_quarantine_immutable
  ON connect_refund_quarantine_events;
CREATE TRIGGER trg_connect_refund_quarantine_immutable
  BEFORE UPDATE OR DELETE ON connect_refund_quarantine_events
  FOR EACH ROW EXECUTE FUNCTION reject_connect_refund_event_mutation();

-- Un plan por Refund canónico, pero muchos planes por Charge/attempt. El monto
-- es siempre explícito; nunca se usa refund_application_fee=true.
CREATE TABLE IF NOT EXISTS connect_application_fee_refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  refund_obligation_id UUID NOT NULL
    REFERENCES connect_charge_refund_obligations(id) ON DELETE RESTRICT,
  connect_refund_id UUID NOT NULL UNIQUE
    REFERENCES connect_refunds(id) ON DELETE RESTRICT,
  payment_refund_id UUID UNIQUE REFERENCES payment_refunds(id) ON DELETE RESTRICT,
  owner_type VARCHAR(30) NOT NULL
    CHECK (owner_type IN ('payment_attempt','captured_guarantee')),
  owner_id UUID NOT NULL,
  payment_attempt_id UUID REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  mesa_id UUID NOT NULL REFERENCES mesas(id) ON DELETE RESTRICT,
  raw_event_id VARCHAR(100) NOT NULL,
  stripe_account_id VARCHAR(100) NOT NULL,
  stripe_payment_intent_id VARCHAR(100) NOT NULL,
  stripe_charge_id VARCHAR(100) NOT NULL,
  stripe_refund_id VARCHAR(100) NOT NULL,
  stripe_application_fee_id VARCHAR(100),
  stripe_application_fee_refund_id VARCHAR(100) UNIQUE,
  currency VARCHAR(3) NOT NULL DEFAULT 'mxn' CHECK (currency='mxn'),
  charge_amount_cents BIGINT NOT NULL CHECK (charge_amount_cents > 0),
  restaurant_items_cents BIGINT NOT NULL CHECK (restaurant_items_cents >= 0),
  original_application_fee_cents BIGINT NOT NULL
    CHECK (original_application_fee_cents >= 0),
  original_commission_cents BIGINT NOT NULL
    CHECK (original_commission_cents >= 0),
  commission_target_cents BIGINT NOT NULL
    CHECK (commission_target_cents >= 0),
  commission_refund_cents BIGINT NOT NULL
    CHECK (commission_refund_cents >= 0),
  original_tip_cents BIGINT NOT NULL CHECK (original_tip_cents >= 0),
  tip_recovered_cents BIGINT NOT NULL DEFAULT 0
    CHECK (tip_recovered_cents >= 0),
  tip_unrecovered_cents BIGINT NOT NULL DEFAULT 0
    CHECK (tip_unrecovered_cents >= 0),
  tip_never_disbursed_cents BIGINT NOT NULL DEFAULT 0
    CHECK (tip_never_disbursed_cents >= 0),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  cumulative_succeeded_refund_cents BIGINT NOT NULL
    CHECK (cumulative_succeeded_refund_cents > 0),
  settlement_timing VARCHAR(20) NOT NULL
    CHECK (settlement_timing IN ('pre_settle','post_settle')),
  mesa_settled_at_snapshot TIMESTAMPTZ,
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitting','succeeded','manual_review')),
  retry_count BIGINT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_attempt_at TIMESTAMPTZ,
  last_error VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_connect_fee_refund_owner
    CHECK (
      (owner_type='payment_attempt' AND payment_attempt_id=owner_id
        AND payment_refund_id IS NOT NULL)
      OR
      (owner_type='captured_guarantee' AND payment_attempt_id IS NULL
        AND payment_refund_id IS NULL AND mesa_id=owner_id)
    ),
  CONSTRAINT chk_connect_fee_refund_components
    CHECK (
      original_application_fee_cents = original_commission_cents
      AND commission_target_cents <= original_commission_cents
      AND commission_refund_cents <= commission_target_cents
      -- Campos conservados por compatibilidad del WIP no desplegado: bajo el
      -- contrato vigente ningún refund Connect toca una wallet de propinas.
      AND tip_recovered_cents = 0
      AND tip_unrecovered_cents = 0
      AND tip_never_disbursed_cents = 0
      AND amount_cents = commission_refund_cents
    ),
  CONSTRAINT chk_connect_fee_refund_provider_binding
    CHECK (amount_cents=0 OR stripe_application_fee_id IS NOT NULL),
  CONSTRAINT chk_connect_fee_refund_settlement_snapshot
    CHECK (
      (settlement_timing='pre_settle' AND mesa_settled_at_snapshot IS NULL)
      OR (settlement_timing='post_settle' AND mesa_settled_at_snapshot IS NOT NULL)
    ),
  CONSTRAINT chk_connect_fee_refund_terminal
    CHECK (
      (status='succeeded' AND processed_at IS NOT NULL
        AND (amount_cents=0 OR stripe_application_fee_refund_id IS NOT NULL))
      OR status<>'succeeded'
    )
);

CREATE INDEX IF NOT EXISTS idx_connect_fee_refunds_pending
  ON connect_application_fee_refunds(status, created_at)
  WHERE status IN ('pending','submitting','manual_review');
CREATE INDEX IF NOT EXISTS idx_connect_fee_refunds_charge
  ON connect_application_fee_refunds(stripe_account_id, stripe_charge_id, created_at);

COMMIT;
