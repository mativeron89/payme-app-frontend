-- v2.62.0 · avatar privado del perfil propio.
-- Una sola versión vigente por usuario; bytes re-encodeados por el servicio.
-- No existe URL pública, digest de contenido ni vínculo con Stripe/outbox.
BEGIN;

CREATE TABLE IF NOT EXISTS user_avatars (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision      UUID NOT NULL UNIQUE,
  mime_type     VARCHAR(20) NOT NULL CHECK (mime_type='image/jpeg'),
  width         SMALLINT NOT NULL CHECK (width BETWEEN 1 AND 512),
  height        SMALLINT NOT NULL CHECK (height BETWEEN 1 AND 512),
  byte_size     INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 262144),
  image_bytes   BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_avatar_byte_size
    CHECK (octet_length(image_bytes)=byte_size)
);

COMMIT;
