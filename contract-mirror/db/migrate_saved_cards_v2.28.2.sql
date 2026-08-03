-- v2.28.2: máximo una tarjeta default ACTIVA por usuario.
-- Upgrade seguro: conserva la más antigua (created_at, id) y desmarca las
-- demás; no borra ni desadjunta tarjetas. Reejecutar es un no-op.
BEGIN;
LOCK TABLE payment_methods IN SHARE ROW EXCLUSIVE MODE;
-- El lock de tabla excluye inserciones/updates mientras se cambia la
-- constraint y se deduplican defaults: no existe una ventana entre ambos
-- pasos en la que un writer pueda reintroducir el estado inválido.
ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_status_check;
ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_status_check
  CHECK (status IN ('attaching','active','detaching','expired','removed'));
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS detach_lease_id UUID;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS detach_lease_expires_at TIMESTAMPTZ;
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rn
    FROM payment_methods
   WHERE status = 'active' AND is_default = true
)
UPDATE payment_methods p
   SET is_default = false
  FROM ranked r
 WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_methods_one_default
  ON payment_methods(user_id) WHERE is_default AND status = 'active';
COMMIT;
