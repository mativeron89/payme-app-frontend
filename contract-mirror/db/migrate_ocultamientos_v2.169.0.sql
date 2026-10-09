-- v2.169.0 · AB-OCULTAR-MESAS · decisión 238 de Mati («Sí, la apruebo (Recomendada)»): cada persona puede
-- borrar de SU app una mesa terminada (y, si quiere, su historial) o un pago suelto. Es OCULTAR por persona,
-- nunca borrar: ES LA ÚNICA MIGRACIÓN QUE D238 APRUEBA, «una tabla (o dos)» nuevas y aditivas. No cambia ni
-- borra datos ni columnas existentes; las mesas y los pagos siguen enteros para los demás participantes,
-- el agente, OPS, el outbox, la contabilidad y la garantía.
--
-- Son dos tablas porque una mesa y un pago tienen claves distintas; una sola obligaría a un CHECK de un solo
-- destino con índices parciales.
--   · mesas_ocultas: «esta persona ocultó esta mesa»; include_history = también los pagos que hizo en ella
--     (el alcance es la mesa, no una lista de ids: cubre también un intento que se cobre después);
--   · pagos_ocultos: «esta persona ocultó este pago».
-- Las dos con fecha. Deshacer es borrar la fila de preferencia; nunca un dato.
--
-- FK con ON DELETE CASCADE, como las preferencias propias (notification_preferences v2.128.0). La cuenta no se
-- borra físicamente (se anonimiza en el lugar), así que la baja borra las filas propias con un DELETE explícito
-- en services/accountAnonymization.js. Índices: alcanza la PK, porque todo filtro es «esta persona y esta mesa
-- o este pago».
--
-- Recuperación: aditiva y sin rollback con DROP. Apagar la función es quitar las rutas; las tablas quedan.
BEGIN;

CREATE TABLE IF NOT EXISTS mesas_ocultas (
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mesa_id          UUID         NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  include_history  BOOLEAN      NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, mesa_id)
);

CREATE TABLE IF NOT EXISTS pagos_ocultos (
  user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_attempt_id  UUID         NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, payment_attempt_id)
);

COMMIT;
