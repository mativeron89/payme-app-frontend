-- ═══════════════════════════════════════════════════════════════════════════
-- migrate_consent_v2.26.sql — PQ-1: fundación de consentimiento
-- Acta: ops/actas/[PAYME]_ACTA_2026-07-24_GOBIERNO_DATOS_CONSUMO.md (rev. 4,
-- ratificada). Implementa D-06 (registro de consentimiento como prueba) y el
-- repositorio versionado de textos legales.
--
-- Bloquea PQ-3, PQ-4 y PQ-5. NO toca dinero ni el outbox.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0 · LA COLUMNA QUE HACE VERIFICABLE LA EDAD (D-03 / D-11) ─────────────
-- D-11 prohíbe dirigir campañas por perfilamiento a menores, NI con permiso de
-- los representantes legales. El gate de consentimiento falla CERRADO: sin edad
-- conocida NO se puede otorgar (ratificado por Mati, 2026-07-25).
--
-- Sin esta columna el gate bloquearía TODO otorgamiento para siempre, y el
-- criterio de aceptación de PQ-1 ("otorgar → revocar → otorgar deja tres
-- filas") sería IMPOSIBLE de cumplir. Se agrega nullable: RECOLECTARLA en el
-- registro es trabajo aparte del front (D-03, condición de lanzamiento), y
-- hasta entonces la edad sigue siendo desconocida y el gate sigue cerrado.
--
-- Entrada NEUTRA de fecha: se pide para PROTEGER a los menores (D-11), nunca
-- para segmentar (D-09).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_date DATE;

-- ─── 1.1 · TEXTOS LEGALES VERSIONADOS ──────────────────────────────────────
-- La fuente de verdad son los archivos de legal/ en git; esta tabla es su
-- proyección consultable. Un cambio de texto ABRE VERSIÓN NUEVA: una fila
-- vigente JAMÁS se edita, porque su hash es la prueba de qué leyó el titular.
CREATE TABLE IF NOT EXISTS legal_texts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind            VARCHAR(50) NOT NULL,
  version         VARCHAR(30) NOT NULL,
  body            TEXT NOT NULL,
  -- sha256 del CUERPO EXACTO que se sirve. La aceptación de PQ-1 es que, dado
  -- un consentimiento de hace meses, se recupere el texto y el hash coincida.
  hash            VARCHAR(64) NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to    TIMESTAMPTZ,               -- NULL = VIGENTE
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, version)
);

-- Una sola versión vigente por tipo de texto, garantizado por la base.
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_texts_vigente
  ON legal_texts(kind) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_texts_hash ON legal_texts(hash);

-- ─── 1.2 · CONSENTIMIENTOS: APPEND-ONLY ────────────────────────────────────
-- Cada acto del titular es una FILA NUEVA. Revocar no es un UPDATE: es un
-- evento 'revoked'. El estado vigente se deriva leyendo el último evento.
CREATE TABLE IF NOT EXISTS consent_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id),
  purpose_key     VARCHAR(50) NOT NULL,
  state           VARCHAR(10) NOT NULL CHECK (state IN ('granted','revoked')),
  -- Qué texto se le mostró EN EL MOMENTO DEL ACTO. Es la prueba.
  notice_kind     VARCHAR(50) NOT NULL,
  notice_version  VARCHAR(30) NOT NULL,
  notice_hash     VARCHAR(64) NOT NULL,
  channel         VARCHAR(30) NOT NULL,
  -- La IP va en claro (no hasheada como en user_sessions) porque acá es
  -- EVIDENCIA del acto de consentimiento, que es justamente lo que el acta
  -- pide conservar. Es el único lugar del repo donde se guarda así.
  ip              VARCHAR(45),
  user_agent      VARCHAR(500),
  app_version     VARCHAR(30),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Resuelve el estado vigente por (usuario, finalidad) en UNA lectura:
-- el índice ya viene ordenado, así que es un LIMIT 1 sobre el prefijo.
CREATE INDEX IF NOT EXISTS idx_consent_estado_vigente
  ON consent_events(user_id, purpose_key, created_at DESC);

-- ─── APPEND-ONLY, GARANTIZADO POR LA BASE ──────────────────────────────────
-- No alcanza con la convención: si el registro es la PRUEBA de que el titular
-- consintió, un UPDATE lo destruye sin dejar rastro. Se bloquea en el motor.
-- Válvula EXPLÍCITA para limpieza deliberada (harness de tests, y solo ahí):
--   SET LOCAL payme.consent_purge_ok = 'on';
-- Existe porque dos suites hacen TRUNCATE de `users` con CASCADE, que arrastra
-- esta tabla. El objetivo del bloqueo es el ACCIDENTE y el descuido de ops: un
-- borrado deliberado tiene que costar una línea visible en el código, no pasar
-- de largo. Sin la variable puesta, no hay forma de tocar una fila.
CREATE OR REPLACE FUNCTION trg_consent_append_only() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('payme.consent_purge_ok', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN RETURN NEW;
    ELSE RETURN NULL;   -- TRUNCATE: es de sentencia, el retorno se ignora
    END IF;
  END IF;
  RAISE EXCEPTION 'consent_events es APPEND-ONLY (D-06): revocar es INSERT de un evento nuevo, nunca UPDATE/DELETE/TRUNCATE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consent_no_update ON consent_events;
CREATE TRIGGER trg_consent_no_update
  BEFORE UPDATE OR DELETE ON consent_events
  FOR EACH ROW EXECUTE FUNCTION trg_consent_append_only();

-- TRUNCATE NO dispara triggers de fila: sin este segundo trigger, la tabla que
-- es LA PRUEBA del consentimiento se borraba entera con una sola sentencia, y
-- el repo ya tiene TRUNCATE vivos en suites de tests (integration*.test.js).
-- Un script de limpieza que sumara esta tabla a la lista la vaciaría en
-- silencio, dejando a PayMe sin cómo probar que alguien consintió.
DROP TRIGGER IF EXISTS trg_consent_no_truncate ON consent_events;
CREATE TRIGGER trg_consent_no_truncate
  BEFORE TRUNCATE ON consent_events
  FOR EACH STATEMENT EXECUTE FUNCTION trg_consent_append_only();
