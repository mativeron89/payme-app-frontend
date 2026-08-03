-- v2.28.8 - indices para el fence durable del ciclo de vida de tarjetas.
--
-- Attach/detach busca obligaciones que todavia necesitan el PaymentMethod de
-- plataforma. Los indices son deliberadamente parciales: no agregan semantica
-- ni reescriben historia; solo evitan scans de mesas/attempts ya terminales.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_mesas_payment_method_lifecycle_fence
  ON mesas(auth_source_payment_method_id, created_at, id)
  WHERE auth_source_payment_method_id IS NOT NULL
    AND guarantee_mode = true
    AND status = 'pending_auth'
    AND auth_payment_intent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_attempts_payment_method_lifecycle_fence
  ON payment_attempts(stripe_source_payment_method_id, created_at, id)
  WHERE stripe_source_payment_method_id IS NOT NULL
    AND operation_type = 'mesa_pay'
    AND payment_type = 'card'
    AND status NOT IN ('processed','refunded','failed','cancelled')
    AND stripe_payment_intent_id IS NULL;

COMMIT;
