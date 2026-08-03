-- ═══════════════════════════════════════════════════════════════════════════
-- migrate_connect_v2.22.sql — Fase 1 del pivote a Stripe Connect (direct charges)
-- Acta: ops/actas/[PAYME]_ACTA_2026-07-24_PIVOTE_STRIPE_CONNECT_TARJETA.md
--
-- Estado de la cuenta conectada de cada restaurante. NO toca dinero: solo
-- habilita el onboarding y el gate de "¿este restaurante puede cobrar?".
-- `restaurants.stripe_account_id` ya existía (columna muerta desde v2.5) —
-- acá empieza a usarse de verdad.
--
-- Idempotente: se puede correr más de una vez.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE restaurants
  -- Estado derivado de la cuenta conectada (lo escribe services/connect.js).
  --   none       — sin cuenta creada todavía
  --   pending    — creada, KYC incompleto (no puede cobrar)
  --   active     — charges_enabled + capability card_payments activa
  --   restricted — Stripe la deshabilitó por requisitos vencidos/en revisión
  --   disabled   — rechazada por Stripe (terminal)
  ADD COLUMN IF NOT EXISTS stripe_account_status VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (stripe_account_status IN ('none','pending','active','restricted','disabled')),

  -- Espejo crudo de los flags de Stripe. charges_enabled y payouts_enabled son
  -- INDEPENDIENTES: se puede cobrar sin poder pagar a la CLABE (la plata queda
  -- en el balance de la conectada). Se guardan por separado a propósito.
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_card_payments_status VARCHAR(20),

  -- requirements.currently_due / past_due / disabled_reason, para mostrar
  -- "qué le falta a este restaurante" sin volver a pegarle a Stripe.
  ADD COLUMN IF NOT EXISTS stripe_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Quién paga las comisiones de procesamiento de Stripe en los direct charges.
  -- Decisión de Mati (2026-07-24): 'account' — las paga el RESTAURANTE.
  -- Stripe congela esto al CREAR la cuenta y no se puede cambiar después; se
  -- guarda por restaurante para que un cambio futuro de política conviva con
  -- las cuentas viejas sin migración ni big-bang (los nuevos nacen con el modo
  -- nuevo, los viejos siguen como están).
  ADD COLUMN IF NOT EXISTS stripe_fees_payer VARCHAR(20) NOT NULL DEFAULT 'account'
    CHECK (stripe_fees_payer IN ('account','application')),

  ADD COLUMN IF NOT EXISTS stripe_onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_account_synced_at TIMESTAMPTZ;

-- Una cuenta conectada pertenece a UN solo restaurante. Parcial: los NULL
-- (restaurantes sin onboardear) no colisionan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurants_stripe_account
  ON restaurants(stripe_account_id) WHERE stripe_account_id IS NOT NULL;

-- Para el webhook Connect: buscar el restaurante por el acct_ del evento.
CREATE INDEX IF NOT EXISTS idx_restaurants_connect_status
  ON restaurants(stripe_account_status) WHERE stripe_account_id IS NOT NULL;
