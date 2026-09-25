-- Decisión 34 de Mati (2026-09-24): preferencia por aviso, sólo correo. Sin PII: `type` es un
-- enum del catálogo de services/notifications.js y `email` un booleano. Sólo hay fila cuando la
-- persona cambió el valor; sin fila rige el default del catálogo. Reversible: DROP TABLE.
BEGIN;
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  email      BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, type)
);
COMMIT;
