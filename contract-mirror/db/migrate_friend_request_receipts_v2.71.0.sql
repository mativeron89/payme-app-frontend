-- v2.71.0 · G-25 · Recibos opacos de solicitudes de amistad salientes.
--
-- Una fila por INTENTO del solicitante, exista o no un destino real. No se
-- persiste el email/payme_id buscado ni un target_user_id. La FK opcional a la
-- solicitud real es una costura exclusivamente servidor para cancelarla.
--
-- Las solicitudes pending legacy reciben un recibo aleatorio con su fecha
-- original. La migración bloquea la tabla antes del NOT EXISTS: así dos runners
-- no duplican el backfill y el UUID publicado no deriva del friendship_id.

BEGIN;

CREATE TABLE IF NOT EXISTS friend_request_receipts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friendship_id     UUID REFERENCES friendships(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_friend_request_receipts_requester
  ON friend_request_receipts(requester_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_friend_request_receipts_friendship
  ON friend_request_receipts(friendship_id)
  WHERE friendship_id IS NOT NULL;

LOCK TABLE friendships IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE friend_request_receipts IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO friend_request_receipts (requester_user_id, friendship_id, created_at)
SELECT f.user_id,
       f.id,
       f.created_at
  FROM friendships f
 WHERE f.status='pending'
   AND NOT EXISTS (
     SELECT 1 FROM friend_request_receipts r
      WHERE r.friendship_id=f.id
        AND r.requester_user_id=f.user_id
   );

-- Toda pending legacy debe tener al menos un recibo del owner exacto. Un
-- binding incompatible no cuenta y hace fallar cerrado el upgrade.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM friendships f
     WHERE f.status='pending'
       AND NOT EXISTS (
         SELECT 1 FROM friend_request_receipts r
          WHERE r.friendship_id=f.id
            AND r.requester_user_id=f.user_id
       )
  ) THEN
    RAISE EXCEPTION 'friend_request_receipt_backfill_missing';
  END IF;
END $$;

COMMIT;
