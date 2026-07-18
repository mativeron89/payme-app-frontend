-- ═══════════════════════════════════════════════════════════════════════════
-- PayMe Backend v2.9 (PASE3) — Migración ENDURECIDA: Cobro Garantizado + STP
-- PostgreSQL >= 14 · aplica sobre el schema v2.5.2
-- ═══════════════════════════════════════════════════════════════════════════
-- Reemplaza a migrate_garantia_v2.8.sql. ÚNICA diferencia funcional: el CHECK de
-- mesas.status ya NO asume el nombre 'mesas_status_check'. Un bloque DO busca y
-- elimina TODOS los CHECK de mesas que mencionen 'status' (sea cual sea su
-- nombre) y recién después agrega el nuevo. Así, si en tu base el constraint
-- tiene otro nombre, no queda uno viejo y restrictivo rechazando 'pending_auth'.
--
-- ⚠️ SIN VERIFICAR POR ENTORNO. Respaldo + staging antes de prod.
-- Repositorio destino: db/migrations/2026-06-08_garantia_v2.9.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── wallets: saldo reservado (congelar saldo del organizador — D2) ──
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS held_balance_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE wallets DROP CONSTRAINT IF EXISTS chk_wallets_held_balance;
ALTER TABLE wallets ADD CONSTRAINT chk_wallets_held_balance
  CHECK (held_balance_cents >= 0 AND held_balance_cents <= balance_cents);

-- ── mesas: autorización (hold) + settlement + dispersión ──
ALTER TABLE mesas
  ADD COLUMN IF NOT EXISTS guarantee_mode           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auth_method              VARCHAR(10),
  ADD COLUMN IF NOT EXISTS auth_payment_intent_id   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS auth_amount_cents        BIGINT,
  ADD COLUMN IF NOT EXISTS auth_held_balance_cents  BIGINT,
  ADD COLUMN IF NOT EXISTS captured_shortfall_cents BIGINT,
  ADD COLUMN IF NOT EXISTS settled_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispersed_at             TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mesas_auth_pi
  ON mesas(auth_payment_intent_id) WHERE auth_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mesas_settle_sweep
  ON mesas(status, expires_at) WHERE settled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mesas_disperse_sweep
  ON mesas(status) WHERE dispersed_at IS NULL;

-- ── mesas.status: ampliar valores permitidos (ROBUSTO al nombre del CHECK) ──
-- Elimina cualquier CHECK existente sobre mesas que mencione 'status', sin
-- importar su nombre, y luego agrega el definitivo.
DO $$
DECLARE
  c_name text;
BEGIN
  FOR c_name IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class      rel ON rel.oid = con.conrelid
      JOIN pg_namespace  nsp ON nsp.oid = rel.relnamespace
     WHERE rel.relname = 'mesas'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE mesas DROP CONSTRAINT %I', c_name);
    RAISE NOTICE 'mesas: drop CHECK %', c_name;
  END LOOP;
END $$;

ALTER TABLE mesas ADD CONSTRAINT mesas_status_check CHECK (status IN (
  -- previos (se conservan)
  'open','fully_paid','partially_paid','expired','cancelled','dispersed',
  -- nuevos del modelo de garantía
  'pending_auth','settling','settled','dispersing','completed','auth_failed'
));

-- ── dispersals: una dispersión por mesa (idempotencia) ──
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispersals_mesa ON dispersals(mesa_id);

COMMIT;

-- ⚠️ NOTA: si tuvieras OTRA columna en mesas cuyo nombre contenga 'status'
-- (no es el caso del schema base, que solo tiene 'status'), el ILIKE '%status%'
-- podría tomar su CHECK también. Verificá con \d mesas antes de correr.
--
-- ── Rollback (manual) ──
-- BEGIN;
--   DROP INDEX IF EXISTS uq_dispersals_mesa;
--   DROP INDEX IF EXISTS idx_mesas_disperse_sweep;
--   DROP INDEX IF EXISTS idx_mesas_settle_sweep;
--   DROP INDEX IF EXISTS idx_mesas_auth_pi;
--   ALTER TABLE mesas DROP CONSTRAINT IF EXISTS mesas_status_check;
--   ALTER TABLE mesas ADD CONSTRAINT mesas_status_check CHECK (status IN
--     ('open','fully_paid','partially_paid','expired','cancelled','dispersed'));
--   ALTER TABLE mesas
--     DROP COLUMN IF EXISTS guarantee_mode, DROP COLUMN IF EXISTS auth_method,
--     DROP COLUMN IF EXISTS auth_payment_intent_id, DROP COLUMN IF EXISTS auth_amount_cents,
--     DROP COLUMN IF EXISTS auth_held_balance_cents, DROP COLUMN IF EXISTS captured_shortfall_cents,
--     DROP COLUMN IF EXISTS settled_at, DROP COLUMN IF EXISTS dispersed_at;
--   ALTER TABLE wallets DROP CONSTRAINT IF EXISTS chk_wallets_held_balance;
--   ALTER TABLE wallets DROP COLUMN IF EXISTS held_balance_cents;
-- COMMIT;
