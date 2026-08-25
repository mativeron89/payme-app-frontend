-- v2.68.0 · complementos naturales ⅔ y ¾ para fracción DECLARADA.
--
-- La v2.67 abrió la columna con el set inicial. Esta migración NO reescribe
-- historia: reemplaza su CHECK de forma atómica y conserva NULL = no medido.
-- Los claims de consumo validan la SOLICITUD en FRACTION_VALUES; su columna DB
-- admite el bps efectivo 3334 que puede producir la tolerancia anti-tercios.
BEGIN;

ALTER TABLE payment_attempt_items
  DROP CONSTRAINT IF EXISTS chk_payment_attempt_items_declared_fraction;

ALTER TABLE payment_attempt_items
  ADD CONSTRAINT chk_payment_attempt_items_declared_fraction
  CHECK (
    declared_fraction_bps IS NULL
    OR declared_fraction_bps IN (2500, 3333, 5000, 6667, 7500, 10000)
  );

COMMIT;
