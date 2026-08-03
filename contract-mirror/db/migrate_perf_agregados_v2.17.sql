-- ═══════════════════════════════════════════════════════════════════════════
-- db/migrate_perf_agregados_v2.17.sql — Robustez Etapa 2 (v2.17.1)
-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotente (IF NOT EXISTS). Única pieza: índice para el rango sargable de
-- POPULATION_SQL (aggregateEmitter). Sin él, cada settle escaneaba TODAS las
-- mesas históricas del restaurante para recalcular los agregados del día —
-- creciendo sin techo, dentro de la tx del dinero. Parcial sobre
-- settled_at IS NOT NULL: la población solo mira mesas liquidadas.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE INDEX IF NOT EXISTS idx_mesas_restaurant_created_settled
  ON mesas (restaurant_id, created_at)
  WHERE settled_at IS NOT NULL;

COMMIT;
