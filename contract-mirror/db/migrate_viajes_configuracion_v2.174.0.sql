-- v2.174.0 · AB-VIAJES-QUIEN-PAGO-Y-CONFIGURACION · decisión 255 de Mati: «Para guardar la foto y el color de cada viaje
-- hacen falta campos nuevos en la base. Sólo se agregan» → «Sí, lo apruebo (Recomendada)». Plan OK del Bibliotecario
-- (2026-10-10T01:29:23Z): `cargado_por` en esta misma migración, con las filas existentes completadas y SIN borrar el
-- UNIQUE viejo. Sólo agrega columnas, un índice y una tabla, todos de Viajes.
--
--   · viajes.color: una clave de la paleta fija del contrato (6 colores con contraste ≥ 4.5:1 contra blanco), o NULL
--     (el color por defecto de la app);
--   · viaje_tickets.cargado_por: quien cargó el ticket o el gasto. Hasta 2.173.2 quien cargaba era quien pagaba; desde
--     D255-6 se puede elegir a otro miembro como quien pagó. Las filas existentes se completan con quien pagó (es
--     exactamente quien las cargó). Queda NULLable a propósito: Railway migra al arrancar el deploy nuevo mientras la
--     instancia vieja todavía inserta sin la columna; el código nuevo lee COALESCE(cargado_por, pagado_por);
--   · el UNIQUE nuevo (viaje_id, cargado_por, idempotency_key): la idempotencia pasa a ser por quien carga. El viejo
--     (viaje_id, pagado_por, idempotency_key) se conserva;
--   · viaje_fotos: la foto del viaje, una por viaje, con los mismos límites que la foto de perfil (`user_avatars`):
--     JPEG re-codificado, hasta 512 px por lado y 256 KiB. Sin quién la subió. Se va con el viaje (CASCADE).
--
-- Repetible: todo es IF NOT EXISTS y el relleno sólo toca filas en NULL.
-- Recuperación: quitar la tabla viaje_fotos, el índice uq_viaje_tickets_cargado_idempotencia y las columnas
-- viaje_tickets.cargado_por y viajes.color. Ninguna otra tabla depende de ellas. No es un rollback automático.
BEGIN;

ALTER TABLE viajes ADD COLUMN IF NOT EXISTS color VARCHAR(20)
  CONSTRAINT chk_viajes_color CHECK (color IS NULL OR color IN ('azul', 'verde', 'violeta', 'rojo', 'naranja', 'turquesa'));

ALTER TABLE viaje_tickets ADD COLUMN IF NOT EXISTS cargado_por UUID REFERENCES users(id);

UPDATE viaje_tickets SET cargado_por = pagado_por WHERE cargado_por IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_viaje_tickets_cargado_idempotencia
  ON viaje_tickets (viaje_id, cargado_por, idempotency_key);

CREATE TABLE IF NOT EXISTS viaje_fotos (
  viaje_id     UUID          PRIMARY KEY REFERENCES viajes(id) ON DELETE CASCADE,
  revision     UUID          NOT NULL,
  mime_type    VARCHAR(20)   NOT NULL,
  width        SMALLINT      NOT NULL,
  height       SMALLINT      NOT NULL,
  byte_size    INTEGER       NOT NULL,
  image_bytes  BYTEA         NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_viaje_fotos_revision UNIQUE (revision),
  CONSTRAINT chk_viaje_fotos_mime CHECK (mime_type = 'image/jpeg'),
  CONSTRAINT chk_viaje_fotos_width CHECK (width BETWEEN 1 AND 512),
  CONSTRAINT chk_viaje_fotos_height CHECK (height BETWEEN 1 AND 512),
  CONSTRAINT chk_viaje_fotos_byte_size CHECK (byte_size BETWEEN 1 AND 262144),
  CONSTRAINT chk_viaje_fotos_bytes CHECK (octet_length(image_bytes) = byte_size)
);

COMMIT;
