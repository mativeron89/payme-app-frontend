BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_recovery_generation BIGINT NOT NULL DEFAULT 0
  CHECK (auth_recovery_generation >= 0);

CREATE TABLE IF NOT EXISTS auth_recovery_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  generation BIGINT NOT NULL CHECK (generation > 0),
  state VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','leased','delivered','superseded','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  dead_at TIMESTAMPTZ,
  UNIQUE (user_id,generation),
  CONSTRAINT chk_auth_recovery_delivery_state CHECK (
    (state='queued' AND user_id IS NOT NULL AND lease_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NULL AND superseded_at IS NULL AND dead_at IS NULL)
    OR (state='leased' AND user_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND delivered_at IS NULL AND superseded_at IS NULL AND dead_at IS NULL)
    OR (state='delivered' AND user_id IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NOT NULL AND superseded_at IS NULL AND dead_at IS NULL)
    OR (state='superseded' AND user_id IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NULL AND superseded_at IS NOT NULL AND dead_at IS NULL)
    OR (state='dead' AND user_id IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NULL AND superseded_at IS NULL AND dead_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_recovery_delivery_active_user
  ON auth_recovery_deliveries(user_id)
  WHERE state IN ('queued','leased');
CREATE INDEX IF NOT EXISTS idx_auth_recovery_delivery_runnable
  ON auth_recovery_deliveries(next_attempt_at,created_at)
  WHERE state='queued';
CREATE INDEX IF NOT EXISTS idx_auth_recovery_delivery_lease
  ON auth_recovery_deliveries(lease_expires_at)
  WHERE state='leased';
CREATE INDEX IF NOT EXISTS idx_auth_recovery_delivery_terminal_cleanup
  ON auth_recovery_deliveries(updated_at)
  WHERE state IN ('delivered','superseded','dead');

ALTER TABLE auth_recovery_tokens
  ADD COLUMN IF NOT EXISTS delivery_id UUID REFERENCES auth_recovery_deliveries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_attempt INTEGER CHECK (delivery_attempt BETWEEN 1 AND 5);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_recovery_token_delivery_attempt
  ON auth_recovery_tokens(delivery_id,delivery_attempt)
  WHERE delivery_id IS NOT NULL;

COMMIT;
