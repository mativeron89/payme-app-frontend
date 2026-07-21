-- ═══════════════════════════════════════════════════════════════════════════
-- db/migrate_outbox_etapa2_v2.14.sql — Outbox App→Dashboard · Etapa 2
-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotente (IF NOT EXISTS). Estilo: migrate_outbox_v2.12.sql.
--
-- Única pieza: secuencia monotónica POR BRANCH para los eventos de agregados
-- (item_aggregate_updated / item_association_updated / tip_aggregate_updated,
-- acta 2026-07-18). Esos eventos NO pertenecen a una mesa (envelope sin
-- mesa_id), así que no pueden usar mesas.last_emitted_sequence: van al outbox
-- con aggregate_type='branch_aggregate' y aggregate_id = branch_id, y este
-- contador satisface el UNIQUE (aggregate_id, source_sequence) existente con
-- el mismo patrón UPDATE ... RETURNING dentro de la tx de dominio.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE restaurant_branches
  ADD COLUMN IF NOT EXISTS last_emitted_sequence bigint NOT NULL DEFAULT 0;

COMMIT;
