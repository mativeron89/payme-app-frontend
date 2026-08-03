-- Lease fencing para el inbox de webhooks. Un worker recuperado no puede ser
-- pisado por el worker viejo que termina después del umbral de stale.
BEGIN;

ALTER TABLE processed_webhook_events
  ADD COLUMN IF NOT EXISTS processing_lease_id UUID;

UPDATE processed_webhook_events
   SET processing_lease_id = uuid_generate_v4()
 WHERE processing_lease_id IS NULL;

ALTER TABLE processed_webhook_events
  ALTER COLUMN processing_lease_id SET DEFAULT uuid_generate_v4(),
  ALTER COLUMN processing_lease_id SET NOT NULL;

-- Fence monetario durable del settlement. El snapshot queda sellado antes de
-- capturar/liberar la garantía y no se recalcula en retries posteriores.
ALTER TABLE mesas
  ADD COLUMN IF NOT EXISTS settlement_fenced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_snapshot_total_cents BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_snapshot_collected_cents BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_snapshot_tip_cents BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_snapshot_shortfall_cents BIGINT;

-- Backfill conservador para cierres previos al deploy: sólo se sella cuando la
-- identidad final total = cobrado + garantía ya está demostrada. Las filas con
-- drift quedan sin fence y el runtime las bloquea para revisión, sin mutarlas.
UPDATE mesas
   SET settlement_fenced_at=settled_at,
       settlement_snapshot_total_cents=total_cents,
       settlement_snapshot_collected_cents=paid_amount_cents,
       settlement_snapshot_tip_cents=tip_amount_cents,
       settlement_snapshot_shortfall_cents=captured_shortfall_cents
 WHERE settlement_fenced_at IS NULL
   AND settled_at IS NOT NULL
   AND status IN ('settled','dispersing','completed')
   AND total_cents BETWEEN 1 AND 9007199254740991
   AND paid_amount_cents BETWEEN 0 AND 9007199254740991
   AND tip_amount_cents BETWEEN 0 AND 9007199254740991
   AND captured_shortfall_cents BETWEEN 0 AND 9007199254740991
   AND total_cents = paid_amount_cents + captured_shortfall_cents;

UPDATE mesas
   SET settlement_snapshot_tip_cents=tip_amount_cents
 WHERE settlement_fenced_at IS NOT NULL
   AND settlement_snapshot_tip_cents IS NULL;

ALTER TABLE mesas DROP CONSTRAINT IF EXISTS chk_mesas_settlement_money_fence;
ALTER TABLE mesas
  ADD CONSTRAINT chk_mesas_settlement_money_fence
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
  );

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

-- Obligación exacta e idempotente para un cobro que llega después del fence.
-- Es evidencia/revisión D1-D; esta migración NO ejecuta refunds externos.
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
ALTER TABLE late_payment_obligations
  ADD COLUMN IF NOT EXISTS settlement_snapshot_tip_cents BIGINT;
UPDATE late_payment_obligations o
   SET settlement_snapshot_tip_cents=m.settlement_snapshot_tip_cents
  FROM mesas m
 WHERE m.id=o.mesa_id AND o.settlement_snapshot_tip_cents IS NULL;
ALTER TABLE late_payment_obligations
  ALTER COLUMN settlement_snapshot_tip_cents SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='chk_late_payment_snapshot_tip_safe'
       AND conrelid='late_payment_obligations'::regclass
  ) THEN
    ALTER TABLE late_payment_obligations
      ADD CONSTRAINT chk_late_payment_snapshot_tip_safe
      CHECK (settlement_snapshot_tip_cents BETWEEN 0 AND 9007199254740991);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_late_payment_obligations_review
  ON late_payment_obligations(detected_at, payment_attempt_id)
  WHERE status = 'manual_review';

-- Una respuesta positiva de registraOrden sólo acredita recepción por STP,
-- no el abono al restaurante. Se agrega `submitted` y se sella el request
-- exacto para impedir que un retry con la misma clave cambie dinero/destino.
ALTER TABLE dispersals
  ADD COLUMN IF NOT EXISTS stp_request_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS stp_request_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS stp_provider_mode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS stp_provider_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stp_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stp_confirmed_at TIMESTAMPTZ;

-- La versión anterior clasificaba también timeout/red como `retrying` y
-- volvía la mesa a settled. Sin prueba sellada no sabemos si STP recibió la
-- orden: reenviar sería un posible pago doble. Lo mismo vale para processing,
-- failed, submitted/confirmed artificiales y sent no-cero sin prueba mock.
-- El único sent sin request demostrable es el sentinel local de Connect=0.
UPDATE dispersals
   SET status='manual_review', next_retry_at=NULL,
       failure_reason=LEFT(
         'legacy_stp_outcome_unknown:' || COALESCE(failure_reason, status),
         500
       ),
       updated_at=NOW()
 WHERE stp_request_hash IS NULL
   AND (
     status IN ('processing','retrying','failed','submitted','confirmed')
     OR (
       status='sent'
       AND NOT (
         amount_cents=0 AND fee_cents=0 AND net_cents=0
         AND failure_reason='liquidado_por_stripe_connect'
       )
     )
   );

ALTER TABLE dispersals DROP CONSTRAINT IF EXISTS dispersals_status_check;
ALTER TABLE dispersals
  ADD CONSTRAINT dispersals_status_check
  CHECK (status IN ('pending','processing','submitted','sent','confirmed',
                    'failed','retrying','manual_review'));

ALTER TABLE dispersals DROP CONSTRAINT IF EXISTS chk_dispersals_stp_provider_mode;
ALTER TABLE dispersals
  ADD CONSTRAINT chk_dispersals_stp_provider_mode
  CHECK (stp_provider_mode IS NULL OR stp_provider_mode IN ('mock','real'));

ALTER TABLE dispersals DROP CONSTRAINT IF EXISTS chk_dispersals_stp_request_snapshot;
ALTER TABLE dispersals
  ADD CONSTRAINT chk_dispersals_stp_request_snapshot
  CHECK (
    (stp_request_snapshot IS NULL AND stp_request_hash IS NULL
     AND stp_provider_mode IS NULL)
    OR
    (jsonb_typeof(stp_request_snapshot)='object'
     AND stp_request_hash ~ '^[0-9a-f]{64}$'
     AND stp_provider_mode IS NOT NULL)
  );

ALTER TABLE dispersals DROP CONSTRAINT IF EXISTS chk_dispersals_stp_inflight_proof;
ALTER TABLE dispersals
  ADD CONSTRAINT chk_dispersals_stp_inflight_proof
  CHECK (status NOT IN ('processing','retrying','failed')
         OR stp_request_hash IS NOT NULL);

ALTER TABLE dispersals DROP CONSTRAINT IF EXISTS chk_dispersals_stp_submitted_proof;
ALTER TABLE dispersals
  ADD CONSTRAINT chk_dispersals_stp_submitted_proof
  CHECK (status <> 'submitted'
         OR (stp_request_hash IS NOT NULL AND stp_provider_mode='real'
             AND stp_provider_id IS NOT NULL AND stp_submitted_at IS NOT NULL));

ALTER TABLE dispersals DROP CONSTRAINT IF EXISTS chk_dispersals_stp_sent_proof;
ALTER TABLE dispersals
  ADD CONSTRAINT chk_dispersals_stp_sent_proof
  CHECK (status <> 'sent'
         OR (amount_cents=0 AND fee_cents=0 AND net_cents=0
             AND failure_reason='liquidado_por_stripe_connect')
         OR (stp_request_hash IS NOT NULL AND stp_provider_mode='mock'
             AND stp_submitted_at IS NOT NULL));

ALTER TABLE dispersals DROP CONSTRAINT IF EXISTS chk_dispersals_stp_confirmed_proof;
ALTER TABLE dispersals
  ADD CONSTRAINT chk_dispersals_stp_confirmed_proof
  CHECK (status <> 'confirmed'
         OR (stp_request_hash IS NOT NULL AND stp_provider_mode='real'
             AND stp_provider_id IS NOT NULL AND stp_submitted_at IS NOT NULL
             AND stp_confirmed_at IS NOT NULL));

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
