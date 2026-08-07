-- ═══════════════════════════════════════════════════════════════════════════
-- migrate_card_save_intents_v2.47.0.sql
--
-- R1-A.2 — la INTENCIÓN de guardar la tarjeta se vuelve durable y convergente.
--
-- ─── QUÉ PROBLEMA RESUELVE ────────────────────────────────────────────────
--
-- G-11 (v2.46.0) guardaba best-effort: `savedCards` absorbía cualquier fallo y
-- devolvía `skipped`. Un pago exitoso con opt-in true podía PERDER el guardado
-- para siempre por un timeout de Stripe, y nadie se enteraba. La orden R1-A.2
-- exige que "la intención de guardado NO PUEDE PERDERSE SILENCIOSAMENTE" y que
-- exista recuperación idempotente ante error transitorio o caída entre el
-- éxito monetario y el guardado.
--
-- ─── QUÉ GUARDA: ESTADO, NADA MÁS ─────────────────────────────────────────
--
-- Deliberadamente NO copia user_id, source_payment_method_id ni customer: esos
-- HECHOS ya viven en `payment_attempts` / `mesas` y se re-derivan en cada
-- resolución. Copiarlos crearía una segunda fuente de verdad que se
-- desincroniza sola — exactamente el defecto que la ORDEN 1-A corrigió en el
-- listado de invitaciones. Acá vive el ESTADO de la intención y nada más.
--
-- ─── POR QUÉ NO ALCANZABA UNA COLUMNA EN LAS TABLAS EXISTENTES ────────────
--
-- Haría falta la misma columna (y su índice de backlog) en `payment_attempts`
-- y en `mesas`, con dos migraciones sobre tablas calientes del riel de dinero.
-- Una tabla aparte es aditiva, no toca ninguna tabla existente, y su rollback
-- es un DROP.
--
-- 🔴 ESTA TABLA NO ES LA AUTORIDAD DE "HAY QUE GUARDAR".
-- La autoridad es el estado monetario: un attempt succeeded/processed con
-- `stripe_save_payment_method=true`, o una mesa con hold autorizado y
-- `auth_save_payment_method=true`. El sweep DERIVA sus candidatos de ahí, no
-- de esta tabla — por eso un camino de éxito nuevo que nadie se acuerde de
-- cablear queda cubierto igual. Esta tabla sólo registra qué se hizo con cada
-- intención, para no repetir trabajo terminal y para poder observarla.
--
-- Reversible: DROP TABLE IF EXISTS card_save_intents;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS card_save_intents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'payment_attempt' | 'mesa_guarantee'. El par (tipo,id) referencia la fila
  -- de dinero que declaró el opt-in; de ahí se re-derivan usuario, fuente y
  -- customer en cada resolución.
  owner_type    varchar(32)  NOT NULL,
  owner_id      uuid         NOT NULL,
  -- pending          : falta resolver (o falló transitorio y hay que reintentar)
  -- saved            : la tarjeta quedó adjunta al Customer de PayMe y espejada
  -- rejected         : la fuente NO es elegible (wallet, marca no admitida…).
  --                    Terminal: reintentar no la vuelve elegible.
  -- manual_review    : conflicto de ownership u otro caso que no se resuelve
  --                    solo. Terminal para el sweep; lo mira una persona.
  status        varchar(24)  NOT NULL DEFAULT 'pending',
  attempts      integer      NOT NULL DEFAULT 0,
  last_error    varchar(300),
  next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  created_at    timestamptz  NOT NULL DEFAULT NOW(),
  updated_at    timestamptz  NOT NULL DEFAULT NOW(),
  resolved_at   timestamptz,
  CONSTRAINT chk_card_save_intents_owner_type
    CHECK (owner_type IN ('payment_attempt','mesa_guarantee')),
  CONSTRAINT chk_card_save_intents_status
    CHECK (status IN ('pending','saved','rejected','manual_review')),
  CONSTRAINT chk_card_save_intents_resolved
    CHECK ((status = 'pending') = (resolved_at IS NULL)),
  CONSTRAINT uq_card_save_intents_owner UNIQUE (owner_type, owner_id)
);

-- Backlog del sweep: sólo las pendientes vencidas. Parcial para que la tabla
-- pueda crecer con filas terminales sin engordar el índice.
CREATE INDEX IF NOT EXISTS idx_card_save_intents_backlog
  ON card_save_intents (next_attempt_at)
  WHERE status = 'pending';
