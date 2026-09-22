-- AB-FRACCIONES-IGUAL (v2.124.0) · Decisión de Mati e9aa0450…: en «igual», la
-- selección informativa admite 1/k para k=1..20 (el máximo de comensales de
-- POST /mesas) más 2/3 y 3/4 históricos. Reemplaza el CHECK de v2.123.0.
-- No toca filas: las seis fracciones anteriores están dentro del conjunto nuevo.
-- Recuperación: volver al CHECK de v2.123.0 mientras no haya filas fuera de
-- (2500,3333,5000,6667,7500,10000); con esas filas, el ADD falla y no cambia nada.
BEGIN;
ALTER TABLE mesa_informative_selections DROP CONSTRAINT IF EXISTS informative_fraction_v2;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid='mesa_informative_selections'::regclass AND conname='informative_fraction_v3') THEN
    ALTER TABLE mesa_informative_selections ADD CONSTRAINT informative_fraction_v3 CHECK (declared_fraction_bps IN
      (10000,5000,3333,2500,2000,1666,1428,1250,1111,1000,909,833,769,714,666,625,588,555,526,500,6667,7500));
  END IF;
END $$;
-- Validación contra el DDL esperado, también en una segunda aplicación.
CREATE TEMP TABLE informative_fraction_expected (
  declared_fraction_bps INTEGER NOT NULL,
  CONSTRAINT informative_fraction_v3 CHECK (declared_fraction_bps IN
    (10000,5000,3333,2500,2000,1666,1428,1250,1111,1000,909,833,769,714,666,625,588,555,526,500,6667,7500))
) ON COMMIT DROP;
DO $$
DECLARE actual JSONB; expected JSONB;
BEGIN
  SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid)) INTO actual
    FROM pg_constraint WHERE conrelid='mesa_informative_selections'::regclass AND contype='c';
  SELECT jsonb_agg(pg_get_constraintdef(oid)) INTO expected
    FROM pg_constraint WHERE conrelid='informative_fraction_expected'::regclass AND contype='c';
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'informative_fraction_incompatible_check'; END IF;
END $$;
COMMIT;
