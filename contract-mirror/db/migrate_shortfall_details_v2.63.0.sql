-- v2.63.0 · snapshot privado del principal pendiente al settlement fence.
-- Forward-only: sin backfill ni recomputación de fences históricos.
BEGIN;

CREATE TABLE IF NOT EXISTS mesa_shortfall_snapshots (
  mesa_id                 UUID PRIMARY KEY REFERENCES mesas(id) ON DELETE RESTRICT,
  version                 SMALLINT NOT NULL DEFAULT 1 CHECK (version=1),
  state                   VARCHAR(20) NOT NULL CHECK (state IN ('sealed','unavailable')),
  settlement_fenced_at    TIMESTAMPTZ NOT NULL,
  closed_at               TIMESTAMPTZ,
  shortfall_cents         BIGINT NOT NULL
                          CHECK (shortfall_cents BETWEEN 0 AND 9007199254740991),
  attributed_cents        BIGINT NOT NULL
                          CHECK (attributed_cents BETWEEN 0 AND 9007199254740991),
  unassigned_cents        BIGINT NOT NULL
                          CHECK (unassigned_cents BETWEEN 0 AND 9007199254740991),
  rows_count              INTEGER NOT NULL CHECK (rows_count BETWEEN 0 AND 10000),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_shortfall_snapshot_reconciliation
    CHECK (attributed_cents + unassigned_cents = shortfall_cents),
  CONSTRAINT chk_shortfall_snapshot_unavailable
    CHECK (state <> 'unavailable'
      OR (attributed_cents=0 AND unassigned_cents=shortfall_cents
          AND rows_count=0 AND closed_at IS NULL))
);

CREATE TABLE IF NOT EXISTS mesa_shortfall_snapshot_rows (
  mesa_id         UUID NOT NULL REFERENCES mesa_shortfall_snapshots(mesa_id) ON DELETE CASCADE,
  ordinal         INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 9999),
  source_user_id  UUID REFERENCES users(id) ON DELETE RESTRICT,
  display_name    VARCHAR(201) NOT NULL CHECK (BTRIM(display_name) <> ''),
  due_cents       BIGINT NOT NULL CHECK (due_cents BETWEEN 1 AND 9007199254740991),
  anonymized_at   TIMESTAMPTZ,
  PRIMARY KEY (mesa_id,ordinal),
  CONSTRAINT chk_shortfall_row_anonymization CHECK (
    (source_user_id IS NOT NULL AND anonymized_at IS NULL)
    OR (source_user_id IS NULL AND anonymized_at IS NOT NULL
        AND display_name='Cuenta eliminada')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shortfall_row_user
  ON mesa_shortfall_snapshot_rows(mesa_id,source_user_id)
  WHERE source_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_shortfall_snapshot_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE'
     AND current_setting('payme.shortfall_close',true)='on'
     AND OLD.state='sealed' AND OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL
     AND ROW(OLD.mesa_id,OLD.version,OLD.state,OLD.settlement_fenced_at,
             OLD.shortfall_cents,OLD.attributed_cents,OLD.unassigned_cents,
             OLD.rows_count,OLD.created_at)
         IS NOT DISTINCT FROM
         ROW(NEW.mesa_id,NEW.version,NEW.state,NEW.settlement_fenced_at,
             NEW.shortfall_cents,NEW.attributed_cents,NEW.unassigned_cents,
             NEW.rows_count,NEW.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'shortfall_snapshot_immutable' USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_shortfall_snapshot_immutable ON mesa_shortfall_snapshots;
CREATE TRIGGER trg_shortfall_snapshot_immutable
  BEFORE UPDATE OR DELETE ON mesa_shortfall_snapshots
  FOR EACH ROW EXECUTE FUNCTION guard_shortfall_snapshot_immutable();

CREATE OR REPLACE FUNCTION guard_shortfall_row_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE'
     AND current_setting('payme.shortfall_anonymization',true)='on'
     AND OLD.source_user_id IS NOT NULL AND NEW.source_user_id IS NULL
     AND OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL
     AND NEW.display_name='Cuenta eliminada'
     AND ROW(OLD.mesa_id,OLD.ordinal,OLD.due_cents)
         IS NOT DISTINCT FROM ROW(NEW.mesa_id,NEW.ordinal,NEW.due_cents) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'shortfall_snapshot_row_immutable' USING ERRCODE='23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_shortfall_row_immutable ON mesa_shortfall_snapshot_rows;
CREATE TRIGGER trg_shortfall_row_immutable
  BEFORE UPDATE OR DELETE ON mesa_shortfall_snapshot_rows
  FOR EACH ROW EXECUTE FUNCTION guard_shortfall_row_immutable();

COMMIT;
