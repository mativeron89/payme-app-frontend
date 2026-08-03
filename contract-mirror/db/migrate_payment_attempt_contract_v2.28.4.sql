-- Snapshot durable del contrato Stripe de un payment attempt.
-- Idempotente; no backfillea attempts históricos ni infiere riel.
BEGIN;

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS stripe_contract_prepared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_source_payment_method_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_charge_payment_method_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_customer_id_snapshot VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_used_saved_card BOOLEAN,
  ADD COLUMN IF NOT EXISTS stripe_save_payment_method BOOLEAN;

-- Los hashes históricos incluían la fuente Stripe. V2 representa sólo la
-- intención económica y deja que el snapshot durable fije la fuente. El
-- default 1 etiqueta filas existentes; las nuevas se insertan explícitamente
-- como v2 y el default final protege otros writers nuevos.
ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS idempotency_hash_version SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE payment_attempts
  ALTER COLUMN idempotency_hash_version SET DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_payment_attempts_idempotency_hash_version'
       AND conrelid = 'payment_attempts'::regclass
  ) THEN
    ALTER TABLE payment_attempts
      ADD CONSTRAINT chk_payment_attempts_idempotency_hash_version
      CHECK (idempotency_hash_version IN (1,2)) NOT VALID;
  END IF;
END $$;

ALTER TABLE payment_attempts
  VALIDATE CONSTRAINT chk_payment_attempts_idempotency_hash_version;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_payment_attempts_stripe_contract_snapshot'
       AND conrelid = 'payment_attempts'::regclass
  ) THEN
    ALTER TABLE payment_attempts
      ADD CONSTRAINT chk_payment_attempts_stripe_contract_snapshot
      CHECK (
        stripe_contract_prepared_at IS NULL
        OR (
          stripe_source_payment_method_id IS NOT NULL
          AND stripe_used_saved_card IS NOT NULL
          AND stripe_save_payment_method IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE payment_attempts
  VALIDATE CONSTRAINT chk_payment_attempts_stripe_contract_snapshot;

-- La garantía necesita el mismo snapshot de la fuente: clone/create comparten
-- idempotency keys por mesa y no pueden recibir otro pm_ en un retry.
ALTER TABLE mesas
  ADD COLUMN IF NOT EXISTS auth_source_payment_method_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS auth_charge_payment_method_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS auth_stripe_customer_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS auth_off_session BOOLEAN,
  ADD COLUMN IF NOT EXISTS auth_save_payment_method BOOLEAN;

COMMIT;
