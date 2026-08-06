-- ═══════════════════════════════════════════════════════════════════════════
-- migrate_connect_garantia_v2.24.sql — Fase 3 del pivote Connect
-- Acta: ops/actas/[PAYME]_ACTA_2026-07-24_PIVOTE_STRIPE_CONNECT_TARJETA.md
--
-- DÓNDE VIVE EL HOLD DE GARANTÍA de cada mesa.
--
--   NULL   = cuenta plataforma de PayMe (todas las mesas anteriores al pivote,
--            y las de restaurantes sin cuenta conectada activa).
--   acct_… = el hold está en la cuenta conectada del restaurante.
--
-- Sin esta columna, la CAPTURA del faltante y la LIBERACIÓN del remanente le
-- pegarían a la cuenta equivocada: Stripe devuelve resource_missing, la captura
-- entra en el loop de reintentos del sweep y el restaurante NUNCA cobra el
-- faltante — o peor, el hold del comensal queda vivo hasta vencer a los 7 días.
--
-- Cambia además el SPLIT de liquidación: si el hold vive en la conectada, el
-- faltante capturado lo cobra el RESTAURANTE, así que NO se le dispersa otra
-- vez por STP (ver services/settlement.js, disperseMesa).
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE mesas
  ADD COLUMN IF NOT EXISTS auth_stripe_account_id VARCHAR(100),
  -- Comisión que PayMe cobró como application_fee al capturar el faltante
  -- (0 si el hold era de plataforma o si no hubo faltante). Auditable sin
  -- depender de la API de Stripe.
  ADD COLUMN IF NOT EXISTS auth_application_fee_cents BIGINT NOT NULL DEFAULT 0
    CHECK (auth_application_fee_cents >= 0),
  -- Comisión efectivamente cobrada al capturar el faltante. VA APARTE de la
  -- autorizada a propósito: la Fase 2 del settle es re-entrante (el sweep
  -- re-elige mesas 'settling' cada ~2 min), y si la base del prorrateo fuera
  -- también el destino de escritura, cada reintento partiría la comisión al
  -- medio — y como la idempotency key de la captura es fija, Stripe rechazaría
  -- por parámetros distintos y la mesa quedaría trabada en 'settling' PARA
  -- SIEMPRE: ni el faltante ni el riel de saldo llegarían nunca al restaurante.
  ADD COLUMN IF NOT EXISTS captured_application_fee_cents BIGINT NOT NULL DEFAULT 0
    CHECK (captured_application_fee_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_mesas_auth_connect
  ON mesas(auth_stripe_account_id) WHERE auth_stripe_account_id IS NOT NULL;
