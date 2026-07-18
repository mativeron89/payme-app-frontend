-- ════════════════════════════════════════════════════════════
-- PayMe Backend v2.8 — Migración: Abono SPEI a la wallet del usuario
-- PostgreSQL >= 14 · aplica sobre el schema v2.5.2 (después de migrate_garantia_v2.8.sql)
-- ════════════════════════════════════════════════════════════
-- ⚠️ SIN VERIFICAR POR ENTORNO. Respaldo + staging antes de prod.
--
-- YA EXISTE en el schema base (NO se toca):
--   · wallets.clabe VARCHAR(18) UNIQUE   (slot para la CLABE virtual por usuario)
--   · topups.method admite 'spei'
--   · wallet_transactions.type admite 'topup_spei'
--
-- Esta migración solo agrega: dedup de depósitos entrantes + secuencia para CLABEs.
-- Repositorio destino: db/migrations/2026-06-07_abono_spei_v2.8.sql
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── topups: referencia externa para idempotencia del abono entrante ──
-- (guarda la claveRastreo del SPEI recibido; un depósito = un topup)
ALTER TABLE topups ADD COLUMN IF NOT EXISTS external_ref VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_topups_external_ref
  ON topups(external_ref) WHERE external_ref IS NOT NULL;

-- ⚠️ Verificar que topups.stripe_payment_intent_id sea NULLABLE:
--    los topups por SPEI (STP, no Stripe) NO tienen PaymentIntent.
--    Si fuese NOT NULL, correr:  ALTER TABLE topups ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

-- ── secuencia para construir CLABEs virtuales determinísticas ──
CREATE SEQUENCE IF NOT EXISTS clabe_seq START 1;

COMMIT;

-- ── Rollback (manual) ──────────────────────────────────────────
-- BEGIN;
--   DROP SEQUENCE IF EXISTS clabe_seq;
--   DROP INDEX IF EXISTS uq_topups_external_ref;
--   ALTER TABLE topups DROP COLUMN IF EXISTS external_ref;
-- COMMIT;
