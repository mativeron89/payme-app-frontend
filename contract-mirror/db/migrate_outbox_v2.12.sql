-- ═══════════════════════════════════════════════════════════════════════════
-- db/migrate_outbox_v2.12.sql — Outbox transaccional App→Dashboard · Etapa 1
-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotente (IF NOT EXISTS). Estilo: migrate_garantia_v2.9_hardened.sql.
--
-- Piezas:
--  1) restaurant_branches: mapping restaurant_id → branch_id del DASHBOARD.
--     Se siembra A MANO copiando los branch_id que el dashboard ya conoce.
--     1:1 por ahora (PK en restaurant_id lo fuerza). Si falta la fila, el
--     emisor NO rompe la operación de dominio: saltea el enqueue con
--     logger.error('outbox_missing_branch_mapping').
--  2) app_event_outbox: los eventos pendientes de publicar. El INSERT ocurre
--     SIEMPRE dentro de la MISMA transacción que la mutación de la mesa
--     (patrón outbox); el envío HTTP lo hace services/eventRelay.js.
--  3) mesas.last_emitted_sequence: contador monotónico por mesa
--     (source_sequence del contrato del dashboard).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS restaurant_branches (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id),
  branch_id     uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_event_outbox (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id        uuid NOT NULL UNIQUE,
  event_type      text NOT NULL,
  aggregate_type  text NOT NULL DEFAULT 'mesa',
  aggregate_id    uuid NOT NULL,               -- = mesa_id
  restaurant_id   uuid NOT NULL,
  branch_id       uuid NOT NULL,
  source_sequence bigint NOT NULL,
  payload         jsonb NOT NULL,              -- envelope COMPLETO, ya despersonalizado
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed','dead')),
  attempts        int  NOT NULL DEFAULT 0,
  last_error      varchar(500),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  -- Defensa extra de monotonía: dos eventos de la misma mesa jamás comparten
  -- secuencia (el UPDATE ... RETURNING de eventEmitter ya lo garantiza; esto
  -- es el cinturón además de los tiradores).
  CONSTRAINT uq_outbox_mesa_seq UNIQUE (aggregate_id, source_sequence)
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON app_event_outbox (status, next_attempt_at);

ALTER TABLE mesas
  ADD COLUMN IF NOT EXISTS last_emitted_sequence bigint NOT NULL DEFAULT 0;

COMMIT;
