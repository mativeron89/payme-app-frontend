-- PayMe App Backend v2.28.6 — snapshot durable de elegibilidad de tarjeta.
--
-- Versión 0 significa histórica/no verificada. Nunca se infiere elegibilidad
-- desde payment_methods.brand/type porque writers legacy convertían funding
-- desconocido en crédito. Sólo una verificación remota concluyente promueve a
-- versión 1 antes del primer hold/cargo.

BEGIN;

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS card_policy_version SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_verified_brand VARCHAR(20),
  ADD COLUMN IF NOT EXISTS card_verified_funding VARCHAR(20),
  ADD COLUMN IF NOT EXISTS card_verified_at TIMESTAMPTZ;

ALTER TABLE mesas
  ADD COLUMN IF NOT EXISTS auth_card_policy_version SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auth_card_brand VARCHAR(20),
  ADD COLUMN IF NOT EXISTS auth_card_funding VARCHAR(20),
  ADD COLUMN IF NOT EXISTS auth_card_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_charge_card_verified_at TIMESTAMPTZ;

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS card_policy_version SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_brand_snapshot VARCHAR(20),
  ADD COLUMN IF NOT EXISTS card_funding_snapshot VARCHAR(20),
  ADD COLUMN IF NOT EXISTS card_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS charge_card_verified_at TIMESTAMPTZ;

-- La migración todavía no fue publicada. Reemplazar explícitamente permite
-- recuperarse de una corrida local de una revisión anterior sin conservar un
-- constraint más débil con el mismo nombre.
ALTER TABLE payment_methods
  DROP CONSTRAINT IF EXISTS chk_payment_methods_card_policy_snapshot;
ALTER TABLE payment_methods
  ADD CONSTRAINT chk_payment_methods_card_policy_snapshot CHECK (
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
  ) NOT VALID;

ALTER TABLE mesas
  DROP CONSTRAINT IF EXISTS chk_mesas_auth_card_policy_snapshot;
ALTER TABLE mesas
  ADD CONSTRAINT chk_mesas_auth_card_policy_snapshot CHECK (
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
  ) NOT VALID;

ALTER TABLE payment_attempts
  DROP CONSTRAINT IF EXISTS chk_payment_attempts_card_policy_snapshot;
ALTER TABLE payment_attempts
  ADD CONSTRAINT chk_payment_attempts_card_policy_snapshot CHECK (
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
  ) NOT VALID;

ALTER TABLE payment_methods VALIDATE CONSTRAINT chk_payment_methods_card_policy_snapshot;
ALTER TABLE mesas VALIDATE CONSTRAINT chk_mesas_auth_card_policy_snapshot;
ALTER TABLE payment_attempts VALIDATE CONSTRAINT chk_payment_attempts_card_policy_snapshot;

-- El ID source sólo se define al INSERT: ningún UPDATE puede cambiarlo, ni
-- siquiera NULL -> ID. Promover v0 -> v1 exige que ya exista y lo conserva.
-- Desde v1 ni la versión ni la marca/funding/evidencia pueden reescribirse.
CREATE OR REPLACE FUNCTION payme_card_snapshot_payment_method_write_once()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stripe_payment_method_id IS DISTINCT FROM
     OLD.stripe_payment_method_id THEN
    RAISE EXCEPTION 'payment_method_card_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.card_policy_version = 1 AND (
       NEW.card_policy_version,
       NEW.stripe_payment_method_id,
       NEW.card_verified_brand,
       NEW.card_verified_funding,
       NEW.card_verified_at
     ) IS DISTINCT FROM (
       OLD.card_policy_version,
       OLD.stripe_payment_method_id,
       OLD.card_verified_brand,
       OLD.card_verified_funding,
       OLD.card_verified_at
     ) THEN
    RAISE EXCEPTION 'payment_method_card_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_methods_card_snapshot_write_once ON payment_methods;
CREATE TRIGGER trg_payment_methods_card_snapshot_write_once
BEFORE UPDATE ON payment_methods
FOR EACH ROW EXECUTE FUNCTION payme_card_snapshot_payment_method_write_once();

CREATE OR REPLACE FUNCTION payme_card_snapshot_mesa_write_once()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.auth_source_payment_method_id IS DISTINCT FROM
     OLD.auth_source_payment_method_id THEN
    RAISE EXCEPTION 'mesa_auth_card_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.auth_card_policy_version = 0
     AND NEW.auth_card_policy_version = 1
     AND (OLD.auth_source_payment_method_id IS NULL
          OR NEW.auth_source_payment_method_id IS DISTINCT FROM
             OLD.auth_source_payment_method_id) THEN
    RAISE EXCEPTION 'mesa_auth_card_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.auth_card_policy_version = 1 AND (
       NEW.auth_card_policy_version,
       NEW.auth_source_payment_method_id,
       NEW.auth_card_brand,
       NEW.auth_card_funding,
       NEW.auth_card_verified_at
     ) IS DISTINCT FROM (
       OLD.auth_card_policy_version,
       OLD.auth_source_payment_method_id,
       OLD.auth_card_brand,
       OLD.auth_card_funding,
       OLD.auth_card_verified_at
     ) THEN
    RAISE EXCEPTION 'mesa_auth_card_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  -- Única excepción: un charge legacy ya ligado bajo v0 puede completar su
  -- timestamp al promover, conservando exactamente el mismo ID.
  IF OLD.auth_card_policy_version = 0
     AND NEW.auth_card_policy_version = 0
     AND OLD.auth_charge_payment_method_id IS NULL
     AND OLD.auth_charge_card_verified_at IS NULL
     AND (NEW.auth_charge_payment_method_id IS NOT NULL
          OR NEW.auth_charge_card_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'mesa_charge_card_verification_immutable'
      USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'mesa_charge_card_verification_immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mesas_card_snapshot_write_once ON mesas;
CREATE TRIGGER trg_mesas_card_snapshot_write_once
BEFORE UPDATE ON mesas
FOR EACH ROW EXECUTE FUNCTION payme_card_snapshot_mesa_write_once();

CREATE OR REPLACE FUNCTION payme_card_snapshot_attempt_write_once()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stripe_source_payment_method_id IS DISTINCT FROM
     OLD.stripe_source_payment_method_id THEN
    RAISE EXCEPTION 'payment_attempt_card_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.card_policy_version = 0
     AND NEW.card_policy_version = 1
     AND (OLD.stripe_source_payment_method_id IS NULL
          OR NEW.stripe_source_payment_method_id IS DISTINCT FROM
             OLD.stripe_source_payment_method_id) THEN
    RAISE EXCEPTION 'payment_attempt_card_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.card_policy_version = 1 AND (
       NEW.card_policy_version,
       NEW.stripe_source_payment_method_id,
       NEW.card_brand_snapshot,
       NEW.card_funding_snapshot,
       NEW.card_verified_at
     ) IS DISTINCT FROM (
       OLD.card_policy_version,
       OLD.stripe_source_payment_method_id,
       OLD.card_brand_snapshot,
       OLD.card_funding_snapshot,
       OLD.card_verified_at
     ) THEN
    RAISE EXCEPTION 'payment_attempt_card_snapshot_immutable'
      USING ERRCODE = '23514';
  END IF;
  -- Misma promoción legacy segura que en mesas.
  IF OLD.card_policy_version = 0
     AND NEW.card_policy_version = 0
     AND OLD.stripe_charge_payment_method_id IS NULL
     AND OLD.charge_card_verified_at IS NULL
     AND (NEW.stripe_charge_payment_method_id IS NOT NULL
          OR NEW.charge_card_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'payment_attempt_charge_card_verification_immutable'
      USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'payment_attempt_charge_card_verification_immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_attempts_card_snapshot_write_once ON payment_attempts;
CREATE TRIGGER trg_payment_attempts_card_snapshot_write_once
BEFORE UPDATE ON payment_attempts
FOR EACH ROW EXECUTE FUNCTION payme_card_snapshot_attempt_write_once();

COMMIT;
