-- v2.63.1 · cierra INSERT posteriores en las filas del snapshot de faltante.
--
-- Debe viajar en un archivo nuevo: v2.63.0 ya puede estar registrada en
-- schema_migrations y editarla en sitio dejaría bases existentes sin el guard.
-- Sólo el sellado inicial abre la válvula transaccional local.
BEGIN;

CREATE OR REPLACE FUNCTION guard_shortfall_row_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT'
     AND current_setting('payme.shortfall_row_insert',true)='on' THEN
    RETURN NEW;
  END IF;
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
  BEFORE INSERT OR UPDATE OR DELETE ON mesa_shortfall_snapshot_rows
  FOR EACH ROW EXECUTE FUNCTION guard_shortfall_row_immutable();

COMMIT;
