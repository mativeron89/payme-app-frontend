-- ═══════════════════════════════════════════════════════════════════════════
-- db/migrate_fracciones_v2.18.sql — Platos compartidos por FRACCIONES (v2.18)
-- ═══════════════════════════════════════════════════════════════════════════
-- Acta: ops/actas/[PAYME]_ACTA_2026-07-23_FRACCIONES_PLATOS_COMPARTIDOS.md
-- Idempotente (IF NOT EXISTS).
--
-- Piezas:
--  1) mesa_item_claims — LA fuente de verdad de tenencia de ítems (v2.18).
--     Una fila por reclamo (fracción o entero=10000 bps). El camino entero
--     TAMBIÉN migra acá: un solo modelo, una sola fuente de verdad.
--     Invariante: SUM(fraction_bps) de claims vivos (locked+paid) por ítem
--     <= 10000 — validado en código bajo el FOR UPDATE del ítem (mismo punto
--     de serialización de siempre). Las columnas locked_by_* de mesa_items
--     quedan VESTIGIALES (solo limpieza de filas legacy); mesa_items.status
--     pasa a ser reflejo: 'paid' SOLO con 10000 bps pagados.
--  2) payment_attempt_items gana fraction_bps y amount_cents (G-07 + recibo):
--     · consumo: fracción y monto reales cobrados.
--     · partes iguales: filas con ambos NULL = consumo DECLARADO (cobrado por
--       slot) — antes esos item_ids se descartaban y se perdía la información
--       de consumo, que es el negocio.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS mesa_item_claims (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mesa_id         UUID NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  mesa_item_id    UUID NOT NULL REFERENCES mesa_items(id) ON DELETE CASCADE,
  fraction_bps    INT NOT NULL CHECK (fraction_bps > 0 AND fraction_bps <= 10000),
  -- NULL hasta que un attempt lo precia; el monto queda FIJO al crear el attempt.
  amount_cents    BIGINT CHECK (amount_cents >= 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'locked'
                  CHECK (status IN ('locked','paid','released')),
  payment_attempt_id UUID REFERENCES payment_attempts(id),
  locked_by_user_id  UUID REFERENCES users(id),
  locked_by_guest_token_hash VARCHAR(64),
  lock_token      VARCHAR(100),
  lock_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_item_claims_item    ON mesa_item_claims(mesa_item_id, status);
CREATE INDEX IF NOT EXISTS idx_item_claims_attempt ON mesa_item_claims(payment_attempt_id)
  WHERE payment_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_claims_expiry  ON mesa_item_claims(lock_expires_at)
  WHERE status = 'locked' AND lock_expires_at IS NOT NULL;

ALTER TABLE payment_attempt_items
  ADD COLUMN IF NOT EXISTS fraction_bps INT CHECK (fraction_bps > 0 AND fraction_bps <= 10000),
  ADD COLUMN IF NOT EXISTS amount_cents BIGINT CHECK (amount_cents >= 0);

COMMIT;
