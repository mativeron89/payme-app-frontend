-- v2.49.0 · D-FF-1 · autoridad de invitaciones para ALTA de cuenta.
--
-- No confundir con `invitations`: aquella tabla autoriza entrar a una MESA y
-- presupone que la cuenta ya existe. Esta tabla es la compuerta de la cohorte
-- Friends & Family y por eso no referencia una mesa.
--
-- El token crudo jamás entra a PostgreSQL. Sólo se persiste SHA-256 hex. El
-- consumo se serializa con SELECT ... FOR UPDATE en routes/auth.js y se marca
-- dentro de la MISMA transacción que crea usuario + sesión.

BEGIN;

CREATE TABLE IF NOT EXISTS signup_invitations (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash           CHAR(64) NOT NULL UNIQUE
                       CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email_normalized     VARCHAR(255) NOT NULL
                       CHECK (email_normalized = LOWER(BTRIM(email_normalized))),
  cohort               VARCHAR(100) NOT NULL,
  issued_by_actor      VARCHAR(200) NOT NULL,
  authorization_ticket VARCHAR(200) NOT NULL,
  issued_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL,
  consumed_at          TIMESTAMPTZ,
  consumed_by_user_id  UUID REFERENCES users(id),
  CONSTRAINT chk_signup_invitation_expiry
    CHECK (expires_at > issued_at),
  CONSTRAINT chk_signup_invitation_consumption
    CHECK (
      (consumed_at IS NULL AND consumed_by_user_id IS NULL)
      OR
      (consumed_at IS NOT NULL AND consumed_by_user_id IS NOT NULL
       AND consumed_at >= issued_at)
    )
);

CREATE INDEX IF NOT EXISTS idx_signup_invitations_email
  ON signup_invitations (email_normalized, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_invitations_open
  ON signup_invitations (expires_at)
  WHERE consumed_at IS NULL;

COMMIT;
