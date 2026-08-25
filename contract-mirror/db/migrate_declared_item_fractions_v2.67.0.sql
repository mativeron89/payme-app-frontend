-- v2.67.0 · fracción DECLARADA por ítem en pagos por partes iguales.
--
-- `fraction_bps` conserva su significado histórico: fracción realmente
-- cobrada/tenida en modo consumo. Esta columna nueva es sólo la declaración
-- del comensal cuando el dinero se calcula por casillero. No hay backfill:
-- las filas históricas no permiten reconstruir una fracción sin inventarla.
BEGIN;

ALTER TABLE payment_attempt_items
  ADD COLUMN IF NOT EXISTS declared_fraction_bps INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_payment_attempt_items_declared_fraction'
       AND conrelid = 'payment_attempt_items'::regclass
  ) THEN
    ALTER TABLE payment_attempt_items
      ADD CONSTRAINT chk_payment_attempt_items_declared_fraction
      CHECK (
        declared_fraction_bps IS NULL
        OR declared_fraction_bps IN (2500, 3333, 5000, 10000)
      );
  END IF;
END;
$$;

COMMIT;
