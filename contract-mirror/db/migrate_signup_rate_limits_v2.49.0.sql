-- v2.49.0 · D-HOLD-1 · límite durable del alta F&F.
--
-- No persiste IP, email, token crudo ni digest individual. `key_digest` sólo
-- identifica uno de 64 shards fijos o el contador global. La PK hace que
-- múltiples procesos compartan el techo y limita la cardinalidad a 65 claves.

BEGIN;

CREATE TABLE IF NOT EXISTS signup_rate_limit_counters (
  scope       VARCHAR(64) NOT NULL,
  key_digest  CHAR(64) NOT NULL CHECK (key_digest ~ '^[0-9a-f]{64}$'),
  hits        INTEGER NOT NULL CHECK (hits > 0),
  reset_at    TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope,key_digest)
);

CREATE INDEX IF NOT EXISTS idx_signup_rate_limit_expiry
  ON signup_rate_limit_counters(reset_at);

COMMIT;
