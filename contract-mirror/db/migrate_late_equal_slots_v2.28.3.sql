-- v2.28.3: vínculo durable attempt → casillero de división igual.
-- Idempotente y seguro para upgrades: las filas legacy quedan NULL y el
-- rescate tardío las manda a revisión manual, nunca adivina otro casillero.
BEGIN;

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS division_slot_index SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_attempts_division_slot_index'
  ) THEN
    ALTER TABLE payment_attempts
      ADD CONSTRAINT chk_payment_attempts_division_slot_index
      CHECK (division_slot_index IS NULL OR division_slot_index >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_attempts_division_slot'
  ) THEN
    ALTER TABLE payment_attempts
      ADD CONSTRAINT fk_payment_attempts_division_slot
      FOREIGN KEY (mesa_id, division_slot_index)
      REFERENCES mesa_division_slots(mesa_id, slot_index)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_division_slot
  ON payment_attempts(mesa_id, division_slot_index)
  WHERE division_slot_index IS NOT NULL;

COMMIT;
