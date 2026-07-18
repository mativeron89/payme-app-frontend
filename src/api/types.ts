/**
 * api/types.ts — Tipos del contrato REAL del app backend (v2.13).
 * Fuente de verdad: contract-mirror/ (schemas/index.js + routes/*.js).
 * Regla: NO inventar campos. Cada tipo cita la ruta de la que sale.
 */

// ─── Auth (routes/auth.js) ─────────────────────────────────

/** Shape de `user` en POST /api/auth/register (register RETURNING). */
export interface User {
  id: string;
  payme_id: string;
  email: string;
  first_name: string;
  last_name: string;
}

/** POST /api/auth/login → 200 (OJO G-02: login NO devuelve user). */
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** POST /api/auth/register → 201. */
export interface RegisterResponse extends LoginResponse {
  user: User;
}

export interface RegisterRequest {
  email: string;
  phone?: string;
  password: string;
  first_name: string;
  last_name: string;
}

// ─── Config (routes/config.js) ─────────────────────────────

/** GET /api/config. */
export interface AppConfig {
  version: string;
  currency: string;
  stripe_publishable_key: string | undefined;
  mesa_hold_seconds: number;
  payment_hold_seconds: number;
  invitation_expiry_seconds: number;
  item_lock_seconds: number;
  features: {
    apple_pay: boolean;
    google_pay: boolean;
    stp_dispersal: boolean;
    ocr_real: boolean;
  };
}

// ─── Cuenta (routes/account.js) ────────────────────────────

/** GET /api/account/balance (G-03: no expone held_balance_cents). */
export interface BalanceResponse {
  balance_cents: number;
  balance_display: string;
  clabe: string | null;
  currency: string;
}

// ─── Mesas (routes/mesas.js) ───────────────────────────────

/** Estados reales de mesa (utils/stateMachine.js — TRANSITIONS.mesa). */
export type MesaStatus =
  | 'pending_auth'
  | 'open'
  | 'partially_paid'
  | 'fully_paid'
  | 'expired'
  | 'settling'
  | 'settled'
  | 'dispersing'
  | 'completed'
  | 'auth_failed'
  | 'cancelled';

/** Elemento de GET /api/mesas/open. */
export interface OpenMesa {
  id: string;
  code: string;
  full_name: string;
  restaurant: { name: string; category: string };
  total_cents: number;
  paid_amount_cents: number;
  pct_paid: number;
  status: MesaStatus;
  expires_at: string;
}

export interface OpenMesasResponse {
  mesas: OpenMesa[];
}

// ─── Errores (shape del error handler de server.js y rutas) ─

export interface ApiError {
  error: string;
  message?: string;
  [key: string]: unknown;
}
