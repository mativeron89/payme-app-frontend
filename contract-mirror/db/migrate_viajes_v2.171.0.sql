-- v2.171.0 · AB-VIAJES · decisión 242 de Mati, pregunta 7: «Sí, la apruebo (Recomendada)». Viajes: los gastos
-- compartidos de un viaje. ES LA ÚNICA MIGRACIÓN QUE D242 APRUEBA: tablas nuevas y aditivas. No cambia ni borra
-- datos ni columnas existentes. PayMe no mueve dinero en Viajes: las transferencias se hacen desde el banco de
-- cada uno y acá sólo se marcan.
--
-- Siete tablas:
--   · viajes: nombre, fechas opcionales (D242-5), quién lo creó y su estado: abierto → esperando_pagos (se
--     cerró y quedan transferencias) → cerrado (todas pagadas). La clave de idempotencia es por quien crea;
--   · viaje_miembros: invitado → activo | rechazado; activo → salio (D242-2); rechazado o salio → invitado otra
--     vez (`invitado_en` es la última invitación). `id` es el identificador PÚBLICO del miembro: la API nunca
--     publica el id interno de la cuenta. El orden de los miembros es (created_at, user_id), no cambia al volver
--     a invitar y decide el centavo de más de un reparto y el desempate de las transferencias;
--   · viaje_tickets: quien lo cargó es quien lo pagó (regla 3 del diseño), la forma de dividir, el tipo de lugar
--     (lo elige quien carga), la huella del ticket (HMAC; nunca el RFC ni el folio en claro) y el id del recibo
--     del OCR, que carga un solo ticket;
--   · viaje_ticket_items: los renglones, en el orden del ticket;
--   · viaje_ticket_personas: la foto de los miembros activos al cargar el ticket (un miembro nuevo no hereda
--     tickets viejos), quién estuvo para «En partes iguales» (D242-6: todos marcados), quién ya eligió y, al
--     cerrar, lo que le toca a cada uno (congelado: el cierre no se recalcula después);
--   · viaje_selecciones: las porciones que eligió cada uno, con el dominio de la mesa (1/k para k=1..20 más 2/3 y
--     3/4, el mismo conjunto que `services/mesaPresentation.js` FRACCIONES_INFORMATIVAS);
--   · viaje_transferencias: las sugeridas al cerrar, congeladas. pendiente → marcada («Ya pagué») → pagada
--     («Recibí»); «No me llegó» y «Deshacer» la devuelven a pendiente (D242-1).
--
-- Las FK a users no borran en cascada: la cuenta no se borra físicamente, se anonimiza en el lugar y lo que
-- tiene montos se conserva (como las mesas). Las FK hijas sí: un viaje se lleva sus filas.
--
-- Recuperación (D242-7): quitar las tablas nuevas, en orden inverso (viaje_transferencias, viaje_selecciones,
-- viaje_ticket_personas, viaje_ticket_items, viaje_tickets, viaje_miembros, viajes). Ninguna tabla existente
-- depende de ellas. No es un rollback automático.
BEGIN;

CREATE TABLE IF NOT EXISTS viajes (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre           VARCHAR(80)   NOT NULL,
  fecha_desde      DATE,
  fecha_hasta      DATE,
  creado_por       UUID          NOT NULL REFERENCES users(id),
  estado           VARCHAR(20)   NOT NULL DEFAULT 'abierto',
  cerrado_por      UUID          REFERENCES users(id),
  cerrado_en       TIMESTAMPTZ,
  terminado_en     TIMESTAMPTZ,
  idempotency_key  VARCHAR(100)  NOT NULL,
  pedido_hash      CHAR(64)      NOT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_viajes_nombre CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 80),
  CONSTRAINT chk_viajes_estado CHECK (estado IN ('abierto', 'esperando_pagos', 'cerrado')),
  CONSTRAINT chk_viajes_fechas CHECK (fecha_desde IS NULL OR fecha_hasta IS NULL OR fecha_desde <= fecha_hasta),
  -- Abierto: sin cierre. Esperando pagos o cerrado: con quién y cuándo se cerró.
  CONSTRAINT chk_viajes_cierre CHECK ((estado = 'abierto') = (cerrado_en IS NULL)
                                      AND (cerrado_en IS NULL) = (cerrado_por IS NULL)),
  -- Cerrado: con la hora en que se pagó la última transferencia (o se cerró sin transferencias).
  CONSTRAINT chk_viajes_terminado CHECK ((estado = 'cerrado') = (terminado_en IS NOT NULL)),
  CONSTRAINT uq_viajes_idempotencia UNIQUE (creado_por, idempotency_key)
);

CREATE TABLE IF NOT EXISTS viaje_miembros (
  viaje_id       UUID          NOT NULL REFERENCES viajes(id) ON DELETE CASCADE,
  user_id        UUID          NOT NULL REFERENCES users(id),
  id             UUID          NOT NULL DEFAULT uuid_generate_v4(),
  estado         VARCHAR(20)   NOT NULL,
  invitado_por   UUID          REFERENCES users(id),
  invitado_en    TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  respondido_en  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (viaje_id, user_id),
  CONSTRAINT uq_viaje_miembros_id UNIQUE (id),
  CONSTRAINT chk_viaje_miembros_estado CHECK (estado IN ('invitado', 'activo', 'rechazado', 'salio'))
);

CREATE INDEX IF NOT EXISTS idx_viaje_miembros_user ON viaje_miembros (user_id, estado);

CREATE TABLE IF NOT EXISTS viaje_tickets (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  viaje_id         UUID          NOT NULL REFERENCES viajes(id) ON DELETE CASCADE,
  pagado_por       UUID          NOT NULL REFERENCES users(id),
  forma            VARCHAR(10)   NOT NULL,
  tipo_lugar       VARCHAR(12)   NOT NULL,
  lugar            VARCHAR(120),
  fecha_ticket     DATE,
  hora_ticket      TIME,
  monto_cents      BIGINT        NOT NULL,
  huella           VARCHAR(43),
  recibo_jti       VARCHAR(22)   NOT NULL,
  idempotency_key  VARCHAR(100)  NOT NULL,
  pedido_hash      CHAR(64)      NOT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_viaje_tickets_forma CHECK (forma IN ('consumo', 'iguales', 'total')),
  CONSTRAINT chk_viaje_tickets_tipo CHECK (tipo_lugar IN ('restaurante', 'bar', 'cafe', 'super', 'otro')),
  CONSTRAINT chk_viaje_tickets_monto CHECK (monto_cents > 0),
  CONSTRAINT chk_viaje_tickets_hora CHECK (hora_ticket IS NULL OR fecha_ticket IS NOT NULL),
  -- Un recibo del OCR carga un solo ticket, en cualquier viaje.
  CONSTRAINT uq_viaje_tickets_recibo UNIQUE (recibo_jti),
  CONSTRAINT uq_viaje_tickets_idempotencia UNIQUE (viaje_id, pagado_por, idempotency_key)
);

-- Un mismo ticket (la misma huella) no se carga dos veces en un viaje. Sin huella, sólo vale el recibo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_viaje_tickets_huella ON viaje_tickets (viaje_id, huella) WHERE huella IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_viaje_tickets_viaje ON viaje_tickets (viaje_id, created_at);

CREATE TABLE IF NOT EXISTS viaje_ticket_items (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id    UUID          NOT NULL REFERENCES viaje_tickets(id) ON DELETE CASCADE,
  orden        SMALLINT      NOT NULL,
  nombre       VARCHAR(200)  NOT NULL,
  price_cents  BIGINT        NOT NULL,
  quantity     INTEGER       NOT NULL,
  CONSTRAINT chk_viaje_ticket_items_precio CHECK (price_cents >= 0),
  CONSTRAINT chk_viaje_ticket_items_cantidad CHECK (quantity BETWEEN 1 AND 32767),
  CONSTRAINT uq_viaje_ticket_items_orden UNIQUE (ticket_id, orden)
);

CREATE TABLE IF NOT EXISTS viaje_ticket_personas (
  ticket_id            UUID          NOT NULL REFERENCES viaje_tickets(id) ON DELETE CASCADE,
  user_id              UUID          NOT NULL REFERENCES users(id),
  orden                SMALLINT      NOT NULL,
  presente             BOOLEAN       NOT NULL DEFAULT true,
  listo_en             TIMESTAMPTZ,
  consumo_final_cents  BIGINT,
  asignado_cierre_cents BIGINT,
  PRIMARY KEY (ticket_id, user_id),
  -- Al cerrar se congelan los dos, o ninguno.
  CONSTRAINT chk_viaje_ticket_personas_cierre CHECK ((consumo_final_cents IS NULL) = (asignado_cierre_cents IS NULL)),
  CONSTRAINT chk_viaje_ticket_personas_montos CHECK (consumo_final_cents IS NULL
    OR (consumo_final_cents >= 0 AND asignado_cierre_cents >= 0 AND asignado_cierre_cents <= consumo_final_cents))
);

CREATE INDEX IF NOT EXISTS idx_viaje_ticket_personas_user ON viaje_ticket_personas (user_id);

CREATE TABLE IF NOT EXISTS viaje_selecciones (
  item_id       UUID          NOT NULL REFERENCES viaje_ticket_items(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES users(id),
  fraction_bps  INTEGER       NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (item_id, user_id),
  CONSTRAINT chk_viaje_selecciones_fraccion CHECK (fraction_bps IN (500, 526, 555, 588, 625, 666, 714, 769, 833,
    909, 1000, 1111, 1250, 1428, 1666, 2000, 2500, 3333, 5000, 6667, 7500, 10000))
);

CREATE INDEX IF NOT EXISTS idx_viaje_selecciones_user ON viaje_selecciones (user_id);

CREATE TABLE IF NOT EXISTS viaje_transferencias (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  viaje_id     UUID          NOT NULL REFERENCES viajes(id) ON DELETE CASCADE,
  orden        SMALLINT      NOT NULL,
  de_user      UUID          NOT NULL REFERENCES users(id),
  a_user       UUID          NOT NULL REFERENCES users(id),
  monto_cents  BIGINT        NOT NULL,
  estado       VARCHAR(12)   NOT NULL DEFAULT 'pendiente',
  marcada_en   TIMESTAMPTZ,
  pagada_en    TIMESTAMPTZ,
  CONSTRAINT chk_viaje_transferencias_monto CHECK (monto_cents > 0),
  CONSTRAINT chk_viaje_transferencias_partes CHECK (de_user <> a_user),
  CONSTRAINT chk_viaje_transferencias_estado CHECK (estado IN ('pendiente', 'marcada', 'pagada')),
  CONSTRAINT chk_viaje_transferencias_marcas CHECK ((estado = 'pendiente') = (marcada_en IS NULL AND pagada_en IS NULL)
    AND (estado = 'pagada') = (pagada_en IS NOT NULL)),
  CONSTRAINT uq_viaje_transferencias_orden UNIQUE (viaje_id, orden)
);

COMMIT;
