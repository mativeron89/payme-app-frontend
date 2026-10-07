-- v2.166.0 · AB-UNIRSE-CODIGO · decisión 219 de Mati («Sí, aprobado (Recomendada)»): unirse a una mesa
-- escribiendo su código, con la aceptación del titular. ES LA ÚNICA MIGRACIÓN QUE D219 APRUEBA: una
-- tabla nueva y aditiva de solicitudes. No cambia ni borra datos ni columnas existentes.
--
-- Una fila por pedido de unirse:
--   · mesa_id y requester_user_id: a qué mesa y quién pide (el titular ve su nombre y su usuario);
--   · status: pending → accepted | rejected | cancelled | expired. Vence a los 15 minutos
--     (`expires_at`); el vencimiento es perezoso, bajo el lock de la mesa, como las invitaciones;
--   · decided_at y decided_by_user_id: cuándo y quién la cerró (el titular al aceptar o rechazar,
--     quien pidió al cancelar). Una vencida no tiene decisión.
-- Los intentos con un código equivocado NO se guardan: no hay un registro nuevo de comportamiento.
--
-- Índices:
--   · una sola pendiente por persona y mesa (único parcial);
--   · las pendientes de una mesa, para listarlas y contar las 10 del tope;
--   · los pedidos de una persona por fecha, para el tope durable de 5 por hora.
--
-- Recuperación: aditiva y sin rollback con DROP. Apagar la función es quitar las rutas; la tabla queda.
BEGIN;

CREATE TABLE IF NOT EXISTS mesa_join_requests (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  mesa_id             UUID         NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  requester_user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ  NOT NULL,
  decided_at          TIMESTAMPTZ,
  decided_by_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_mesa_join_requests_status
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  CONSTRAINT chk_mesa_join_requests_vigencia
    CHECK (expires_at > created_at),
  -- Pendiente o vencida: sin decisión. Aceptada, rechazada o cancelada: con su hora.
  CONSTRAINT chk_mesa_join_requests_decision
    CHECK ((status IN ('pending', 'expired')) = (decided_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mesa_join_requests_pendiente
  ON mesa_join_requests (mesa_id, requester_user_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_mesa_join_requests_mesa_pendientes
  ON mesa_join_requests (mesa_id, created_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_mesa_join_requests_requester
  ON mesa_join_requests (requester_user_id, created_at);

COMMIT;
