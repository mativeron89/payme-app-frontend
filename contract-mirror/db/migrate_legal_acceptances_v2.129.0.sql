-- v2.129.0 · AB1 · paquete legal 3.0.0 · constancia de aceptación (decisión 45 de Mati).
--
-- Una fila por aceptación: quién, qué versiones y huellas del Aviso de Privacidad
-- y de los Términos de Uso, la declaración «18 años o más» (decisiones 39 y 44)
-- y en qué acto (alta por correo, alta con Google, «Continuar con Google», o la
-- puerta de quien ya tenía cuenta). Sin IP ni user agent, igual que las demás
-- constancias del repo.
--
-- APPEND-ONLY, como consent_events (migrate_consent_v2.26.sql:86-111): es la
-- prueba de qué aceptó cada titular. Aceptar de nuevo es un INSERT, nunca un
-- UPDATE. Misma válvula explícita (payme.consent_purge_ok) para el harness que
-- hace TRUNCATE de users con CASCADE.
--
-- Reversible con DROP TABLE mientras esté vacía (decisión 45). No toca filas.
BEGIN;

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id),
  action              TEXT NOT NULL,
  aviso_version       VARCHAR(30) NOT NULL,
  aviso_hash          VARCHAR(64) NOT NULL,
  terminos_version    VARCHAR(30) NOT NULL,
  terminos_hash       VARCHAR(64) NOT NULL,
  declara_mayor_edad  BOOLEAN NOT NULL,
  accepted_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_legal_acceptance_action CHECK (action IN (
    'registro_correo', 'registro_google', 'registro_google_continuar', 'aceptacion_existente')),
  CONSTRAINT chk_legal_acceptance_aviso_hash CHECK (aviso_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_legal_acceptance_terminos_hash CHECK (terminos_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_legal_acceptance_mayor_edad CHECK (declara_mayor_edad)
);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user
  ON legal_acceptances (user_id, accepted_at DESC);

CREATE OR REPLACE FUNCTION trg_legal_acceptances_append_only() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('payme.consent_purge_ok', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN RETURN NEW;
    ELSE RETURN NULL;
    END IF;
  END IF;
  RAISE EXCEPTION 'legal_acceptances es APPEND-ONLY: aceptar de nuevo es INSERT, nunca UPDATE/DELETE/TRUNCATE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_legal_acceptances_no_update ON legal_acceptances;
CREATE TRIGGER trg_legal_acceptances_no_update
  BEFORE UPDATE OR DELETE ON legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION trg_legal_acceptances_append_only();

DROP TRIGGER IF EXISTS trg_legal_acceptances_no_truncate ON legal_acceptances;
CREATE TRIGGER trg_legal_acceptances_no_truncate
  BEFORE TRUNCATE ON legal_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION trg_legal_acceptances_append_only();

COMMIT;
