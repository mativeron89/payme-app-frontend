-- v2.173.0 · AB-LINK-DE-INVITACION · decisión 252 de Mati: «En amigos, quiero agregar que se pueda invitar a alguien
-- que no tiene la app, como un código de referido […] ahora solo es el link que necesito que se genere y se pueda
-- compartir». Eligió «Quedan amigos directo (Recomendada)» y, para esta migración, «Sí, la apruebo (Recomendada)».
-- Tablas nuevas y aditivas: no cambia ni borra datos ni columnas existentes. Nada de puntos: ni saldos ni montos.
--
-- Dos tablas (plan OK del Bibliotecario, 2026-10-09T20:42:40Z: «OK dos tablas en la MISMA migración aditiva»):
--   · codigos_de_invitacion: el código del link personal de cada cuenta. Al azar (96 bits, 16 caracteres
--     base64url), sin datos de la persona. Uno VIGENTE por cuenta; revocar lo marca y emite otro. Se guarda tal
--     cual porque la cuenta tiene que poder ver su mismo link cada vez: no es una credencial, sólo hace que una
--     cuenta NUEVA quede amiga de quien la invitó;
--   · referidos: quién invitó a quién, cuándo y con qué código. Una cuenta nace referida una sola vez
--     (`invitado` UNIQUE): un link no puede crear dos amistades. Queda anotado para los puntos futuros, que
--     todavía no existen.
--
-- Las FK a users no borran en cascada: la cuenta no se borra físicamente, se anonimiza en el lugar. La
-- anonimización no se toca (plan OK): la fila de referido queda (dos ids y una fecha, sin datos personales) y el
-- código de una cuenta que no está activa deja de valer.
--
-- Recuperación: quitar las tablas nuevas, en orden inverso (referidos, codigos_de_invitacion). Ninguna tabla
-- existente depende de ellas. No es un rollback automático.
BEGIN;

CREATE TABLE IF NOT EXISTS codigos_de_invitacion (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID          NOT NULL REFERENCES users(id),
  code        VARCHAR(16)   NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  CONSTRAINT uq_codigos_de_invitacion_code UNIQUE (code),
  CONSTRAINT chk_codigos_de_invitacion_code CHECK (code ~ '^[A-Za-z0-9_-]{16}$'),
  CONSTRAINT chk_codigos_de_invitacion_revocado CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

-- Uno vigente por cuenta: el índice único parcial es el árbitro de dos pedidos simultáneos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_codigos_de_invitacion_vigente
  ON codigos_de_invitacion (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS referidos (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quien_invita  UUID          NOT NULL REFERENCES users(id),
  invitado      UUID          NOT NULL REFERENCES users(id),
  codigo_id     UUID          NOT NULL REFERENCES codigos_de_invitacion(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_referidos_invitado UNIQUE (invitado),
  CONSTRAINT chk_referidos_no_autoinvitacion CHECK (quien_invita <> invitado)
);

CREATE INDEX IF NOT EXISTS idx_referidos_quien_invita ON referidos (quien_invita, created_at);

COMMIT;
