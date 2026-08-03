-- ═══════════════════════════════════════════════════════════════════════════
-- migrate_connect_charges_v2.23.sql — Fase 2 del pivote Connect (direct charges)
-- Acta: ops/actas/[PAYME]_ACTA_2026-07-24_PIVOTE_STRIPE_CONNECT_TARJETA.md
--
-- DÓNDE VIVE CADA PaymentIntent. Sin esta columna no hay forma de saber si un
-- PI está en la cuenta de PayMe o en la del restaurante, y las cancelaciones
-- (timer de attempts vencidos, cancelInFlightAttempts al liquidar) le pegarían
-- a la cuenta equivocada: Stripe devolvería resource_missing, el catch lo
-- degrada a warning, y el cobro quedaría VIVO en Stripe mientras local lo damos
-- por cancelado — un cobro fantasma al comensal.
--
--   NULL = cuenta plataforma de PayMe (todo lo anterior al pivote, wallet,
--          topups, y los restaurantes que todavía no tienen cuenta conectada).
--   acct_… = direct charge sobre la cuenta conectada de ese restaurante.
--
-- Es también la fuente de verdad del SPLIT de liquidación: lo que se dispersa
-- por STP es lo que NO liquidó por Stripe. Por eso el criterio es "dónde cayó
-- la plata", no "con qué método se pagó".
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(100),
  -- Comisión que PayMe cobró como application_fee en ESE cargo (0 en los pagos
  -- de plataforma, donde la comisión se descuenta recién en la dispersión).
  -- Se guarda para poder auditar el split sin depender de la API de Stripe.
  ADD COLUMN IF NOT EXISTS application_fee_cents BIGINT NOT NULL DEFAULT 0
    CHECK (application_fee_cents >= 0);

-- El settle y el timer filtran por esta columna al decidir contra qué cuenta
-- cancelar/capturar.
CREATE INDEX IF NOT EXISTS idx_payment_attempts_connect
  ON payment_attempts(stripe_account_id) WHERE stripe_account_id IS NOT NULL;
