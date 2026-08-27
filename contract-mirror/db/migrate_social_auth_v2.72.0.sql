-- v2.72.0 · APP-BE-SOCIAL-AUTH-01 · identidad externa neutral y recovery.
-- No persiste tokens crudos ni perfil de proveedor. La constraint diferida
-- permite crear user+binding en una tx, pero prohíbe confirmar una cuenta
-- activa/suspendida sin password ni binding activo.
BEGIN;

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS external_identity_bindings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          VARCHAR(32) NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  subject_namespace VARCHAR(255) NOT NULL CHECK (LENGTH(BTRIM(subject_namespace)) > 0),
  subject           VARCHAR(255) NOT NULL CHECK (LENGTH(BTRIM(subject)) > 0),
  status            VARCHAR(16) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','revoked')),
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_external_identity_subject UNIQUE (provider,subject_namespace,subject),
  CONSTRAINT uq_external_identity_user_provider UNIQUE (user_id,provider),
  CONSTRAINT chk_external_identity_revocation CHECK (
    (status='active' AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_external_identity_user_active
  ON external_identity_bindings(user_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS external_auth_credentials (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider        VARCHAR(32) NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  credential_hash CHAR(64) NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  purpose         VARCHAR(16) NOT NULL CHECK (purpose IN ('register','login','link')),
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ NOT NULL,
  UNIQUE (provider,credential_hash),
  CONSTRAINT chk_external_auth_credential_time CHECK (expires_at > consumed_at)
);

CREATE INDEX IF NOT EXISTS idx_external_auth_credentials_expiry
  ON external_auth_credentials(expires_at);

CREATE TABLE IF NOT EXISTS auth_recovery_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status       VARCHAR(16) NOT NULL DEFAULT 'issued'
               CHECK (status IN ('issued','consumed','cancelled')),
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT chk_auth_recovery_expiry CHECK (expires_at > issued_at),
  CONSTRAINT chk_auth_recovery_state CHECK (
    (status='issued' AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (status='consumed' AND consumed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='cancelled' AND consumed_at IS NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_auth_recovery_user_issued
  ON auth_recovery_tokens(user_id,expires_at) WHERE status='issued';

CREATE TABLE IF NOT EXISTS auth_recovery_rate_limits (
  scope       VARCHAR(16) NOT NULL CHECK (scope IN ('global','shard','user')),
  key_digest  CHAR(64) NOT NULL CHECK (key_digest ~ '^[0-9a-f]{64}$'),
  hits        INTEGER NOT NULL CHECK (hits > 0),
  reset_at    TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope,key_digest)
);

CREATE INDEX IF NOT EXISTS idx_auth_recovery_rate_expiry
  ON auth_recovery_rate_limits(reset_at);

CREATE TABLE IF NOT EXISTS external_auth_intents (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider   VARCHAR(32) NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  state_hash CHAR(64) NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  purpose    VARCHAR(16) NOT NULL CHECK (purpose IN ('register','login')),
  status     VARCHAR(16) NOT NULL DEFAULT 'issued'
             CHECK (status IN ('issued','consumed')),
  signup_invitation_token_hash CHAR(64),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  birth_date DATE,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT chk_external_auth_intent_expiry CHECK (expires_at > issued_at),
  CONSTRAINT chk_external_auth_intent_state CHECK (
    (status='issued' AND consumed_at IS NULL)
    OR (status='consumed' AND consumed_at IS NOT NULL)
  ),
  CONSTRAINT chk_external_auth_intent_context CHECK (
    (status='consumed' AND signup_invitation_token_hash IS NULL
      AND first_name IS NULL AND last_name IS NULL AND birth_date IS NULL)
    OR
    (status='issued' AND purpose='login' AND signup_invitation_token_hash IS NULL
      AND first_name IS NULL AND last_name IS NULL AND birth_date IS NULL)
    OR
    (status='issued' AND purpose='register'
      AND signup_invitation_token_hash ~ '^[0-9a-f]{64}$'
      AND LENGTH(BTRIM(first_name)) > 0 AND LENGTH(BTRIM(last_name)) > 0)
  )
);

ALTER TABLE external_auth_intents
  ADD COLUMN IF NOT EXISTS signup_invitation_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE external_auth_intents
  DROP CONSTRAINT IF EXISTS chk_external_auth_intent_context;
ALTER TABLE external_auth_intents
  ADD CONSTRAINT chk_external_auth_intent_context CHECK (
    (status='consumed' AND signup_invitation_token_hash IS NULL
      AND first_name IS NULL AND last_name IS NULL AND birth_date IS NULL)
    OR
    (status='issued' AND purpose='login' AND signup_invitation_token_hash IS NULL
      AND first_name IS NULL AND last_name IS NULL AND birth_date IS NULL)
    OR
    (status='issued' AND purpose='register'
      AND signup_invitation_token_hash ~ '^[0-9a-f]{64}$'
      AND LENGTH(BTRIM(first_name)) > 0 AND LENGTH(BTRIM(last_name)) > 0)
  );

CREATE INDEX IF NOT EXISTS idx_external_auth_intents_expiry
  ON external_auth_intents(expires_at) WHERE status='issued';

-- Excepción cerrada al invariante de autenticación: una cuenta sólo puede
-- quedar sin método cuando está suspendida por una transición explícita y
-- recuperable (deauth) o por una eliminación ya iniciada. Una suspensión
-- administrativa cualquiera NO abre esta puerta.
CREATE TABLE IF NOT EXISTS account_auth_suspensions (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider     VARCHAR(32) NOT NULL CHECK (provider='facebook'),
  reason       VARCHAR(32) NOT NULL
               CHECK (reason IN ('facebook_deauthorization','facebook_data_deletion')),
  status       VARCHAR(24) NOT NULL
               CHECK (status IN ('pending_recovery','pending_deletion','resolved')),
  suspended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_account_auth_suspension_state CHECK (
    (status IN ('pending_recovery','pending_deletion') AND resolved_at IS NULL)
    OR (status='resolved' AND resolved_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS facebook_data_deletion_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  subject_hash      CHAR(64) NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  confirmation_hash CHAR(64) NOT NULL UNIQUE CHECK (confirmation_hash ~ '^[0-9a-f]{64}$'),
  status            VARCHAR(32) NOT NULL
                    CHECK (status IN ('pending_quiescence','completed_no_data','completed')),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_facebook_deletion_state CHECK (
    (status='pending_quiescence' AND completed_at IS NULL)
    OR (status IN ('completed_no_data','completed') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_facebook_deletion_user
  ON facebook_data_deletion_requests(user_id,requested_at DESC)
  WHERE user_id IS NOT NULL;

-- Tombstone HMAC: cierra la carrera callback↔alta sin conservar el subject
-- Meta crudo. `deletion_suppressed` no se despeja por login ni registro.
CREATE TABLE IF NOT EXISTS external_identity_subject_controls (
  provider          VARCHAR(32) NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  subject_namespace VARCHAR(255) NOT NULL CHECK (LENGTH(BTRIM(subject_namespace)) > 0),
  subject_digest    CHAR(64) NOT NULL CHECK (subject_digest ~ '^[0-9a-f]{64}$'),
  status            VARCHAR(32) NOT NULL
                    CHECK (status IN ('remote_revoked','deletion_suppressed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider,subject_namespace,subject_digest)
);

CREATE OR REPLACE FUNCTION payme_assert_user_auth_method(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE current_user_row users%ROWTYPE;
BEGIN
  SELECT * INTO current_user_row FROM users WHERE id=p_user_id;
  IF NOT FOUND OR current_user_row.status='deleted' THEN RETURN; END IF;
  IF current_user_row.password_hash IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM external_identity_bindings
        WHERE user_id=p_user_id AND status='active'
     )
     AND NOT (
       current_user_row.status='suspended'
       AND EXISTS (
         SELECT 1 FROM account_auth_suspensions
          WHERE user_id=p_user_id
            AND status IN ('pending_recovery','pending_deletion')
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE='23514',
      CONSTRAINT='user_auth_method_required',
      MESSAGE='user_auth_method_required';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION payme_user_auth_method_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='users' THEN
    PERFORM payme_assert_user_auth_method(
      CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END
    );
  ELSE
    IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM payme_assert_user_auth_method(OLD.user_id);
    END IF;
    PERFORM payme_assert_user_auth_method(
      CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION payme_external_binding_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.user_id,NEW.provider,NEW.subject_namespace,NEW.subject)
     IS DISTINCT FROM
     ROW(OLD.user_id,OLD.provider,OLD.subject_namespace,OLD.subject) THEN
    RAISE EXCEPTION 'external_identity_binding_immutable' USING ERRCODE='23514';
  END IF;
  NEW.updated_at=NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_binding_immutable ON external_identity_bindings;
CREATE TRIGGER trg_external_binding_immutable
  BEFORE UPDATE ON external_identity_bindings
  FOR EACH ROW EXECUTE FUNCTION payme_external_binding_immutable();

DROP TRIGGER IF EXISTS trg_user_auth_method_users ON users;
CREATE CONSTRAINT TRIGGER trg_user_auth_method_users
  AFTER INSERT OR UPDATE OF password_hash,status ON users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payme_user_auth_method_trigger();

DROP TRIGGER IF EXISTS trg_user_auth_method_bindings ON external_identity_bindings;
CREATE CONSTRAINT TRIGGER trg_user_auth_method_bindings
  AFTER INSERT OR UPDATE OR DELETE ON external_identity_bindings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payme_user_auth_method_trigger();

DROP TRIGGER IF EXISTS trg_user_auth_method_suspensions ON account_auth_suspensions;
CREATE CONSTRAINT TRIGGER trg_user_auth_method_suspensions
  AFTER INSERT OR UPDATE OR DELETE ON account_auth_suspensions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payme_user_auth_method_trigger();

COMMIT;
