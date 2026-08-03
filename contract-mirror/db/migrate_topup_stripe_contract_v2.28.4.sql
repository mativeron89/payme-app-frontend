-- Snapshot durable del contrato Stripe de las cargas de saldo.
--
-- No se hace backfill: una carga histórica sin snapshot pudo haber llegado a
-- Stripe aunque la respuesta no se haya persistido. Inferir sus parámetros y
-- volver a crearla con otra idempotency key podría duplicar dinero.
BEGIN;

ALTER TABLE topups
  ADD COLUMN IF NOT EXISTS stripe_client_secret VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS stripe_contract_prepared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_customer_id_snapshot VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id_snapshot VARCHAR(100),
  ADD COLUMN IF NOT EXISTS billing_email_snapshot VARCHAR(255),
  ADD COLUMN IF NOT EXISTS billing_name_snapshot VARCHAR(200);

COMMIT;
