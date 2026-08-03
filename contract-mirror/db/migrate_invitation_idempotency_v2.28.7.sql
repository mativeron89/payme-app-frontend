-- PayMe App Backend v2.28.7 — una autoridad canónica por invitación
--
-- Poblada e idempotente. Consolida duplicados pending sin invalidar tokens ya
-- compartidos: la fila perdedora conserva token/token_hash y apunta a la
-- autoridad canónica mediante superseded_by_id. El runtime valida el token
-- legacy contra esa autoridad.

BEGIN;

LOCK TABLE invitations IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS superseded_by_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'invitations'::regclass
       AND conname = 'fk_invitations_superseded_by'
  ) THEN
    ALTER TABLE invitations
      ADD CONSTRAINT fk_invitations_superseded_by
      FOREIGN KEY (superseded_by_id) REFERENCES invitations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'invitations'::regclass
       AND conname = 'chk_invitation_not_self_superseded'
  ) THEN
    ALTER TABLE invitations
      ADD CONSTRAINT chk_invitation_not_self_superseded
      CHECK (superseded_by_id IS NULL OR superseded_by_id <> id);
  END IF;
END $$;

-- Un índice parcial no puede usar NOW(); terminalizamos lo vencido bajo el
-- mismo lock antes de imponer unicidad sobre status='pending'.
UPDATE invitations
   SET status = 'expired'
 WHERE status = 'pending'
   AND expires_at <= clock_timestamp();

-- El runtime sólo permite invitar al opener. Un inviter histórico distinto no
-- se reasigna por inferencia porque hacerlo transferiría autoridad.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM invitations i
      JOIN mesas m ON m.id=i.mesa_id
     WHERE i.status='pending'
       AND i.superseded_by_id IS NULL
       AND i.inviter_user_id <> m.opener_user_id
  ) THEN
    RAISE EXCEPTION 'live invitation inviter is not mesa opener';
  END IF;
END $$;

-- Una invitación in-app viva sin destinatario no puede reconciliarse por
-- inferencia. Fallar la migración es más seguro que adjudicar autoridad.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM invitations
     WHERE invitation_type = 'in_app'
       AND status = 'pending'
       AND superseded_by_id IS NULL
       AND invited_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'live in_app invitation without invited_user_id';
  END IF;
END $$;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY mesa_id, inviter_user_id, invited_user_id
           ORDER BY expires_at DESC, created_at ASC, id ASC
         ) AS canonical_id,
         row_number() OVER (
           PARTITION BY mesa_id, inviter_user_id, invited_user_id
           ORDER BY expires_at DESC, created_at ASC, id ASC
         ) AS position
    FROM invitations
   WHERE invitation_type = 'in_app'
     AND status = 'pending'
     AND superseded_by_id IS NULL
)
UPDATE invitations loser
   SET status = 'cancelled',
       cancelled_at = COALESCE(loser.cancelled_at, clock_timestamp()),
       superseded_by_id = ranked.canonical_id
  FROM ranked
 WHERE loser.id = ranked.id
   AND ranked.position > 1;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY mesa_id, inviter_user_id
           ORDER BY expires_at DESC, created_at ASC, id ASC
         ) AS canonical_id,
         row_number() OVER (
           PARTITION BY mesa_id, inviter_user_id
           ORDER BY expires_at DESC, created_at ASC, id ASC
         ) AS position
    FROM invitations
   WHERE invitation_type = 'link'
     AND status = 'pending'
     AND superseded_by_id IS NULL
)
UPDATE invitations loser
   SET status = 'cancelled',
       cancelled_at = COALESCE(loser.cancelled_at, clock_timestamp()),
       superseded_by_id = ranked.canonical_id
  FROM ranked
 WHERE loser.id = ranked.id
   AND ranked.position > 1;

CREATE TABLE IF NOT EXISTS invitation_requests (
  inviter_user_id UUID NOT NULL REFERENCES users(id),
  mesa_id         UUID NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(100) NOT NULL,
  payload_hash    VARCHAR(64) NOT NULL,
  invitation_id   UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (inviter_user_id, mesa_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_invitation_requests_invitation
  ON invitation_requests(invitation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending_in_app
  ON invitations(mesa_id, inviter_user_id, invited_user_id)
  WHERE invitation_type = 'in_app' AND status = 'pending'
    AND superseded_by_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending_link
  ON invitations(mesa_id, inviter_user_id)
  WHERE invitation_type = 'link' AND status = 'pending'
    AND superseded_by_id IS NULL;

COMMIT;
