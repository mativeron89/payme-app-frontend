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

/** Tipos de wallet_transactions (schemas walletTxQuery). */
export type WalletTxType =
  | 'topup_oxxo'
  | 'topup_card'
  | 'topup_spei'
  | 'transfer_in'
  | 'transfer_out'
  | 'payment_mesa'
  | 'refund_mesa'
  | 'tip_received'
  | 'tip_payout'
  | 'adjustment_credit'
  | 'adjustment_debit';

/** Elemento de GET /api/account/wallet-transactions. */
export interface WalletTransaction {
  id: string;
  type: WalletTxType;
  amount_cents: number;
  amount_display: string;
  sign: 'credit' | 'debit';
  balance_after_cents: number;
  balance_after_display: string;
  related: { type: string; id: string } | null;
  description: string | null;
  metadata: unknown;
  date: string;
}

export interface WalletTransactionsResponse {
  transactions: WalletTransaction[];
  limit: number;
  offset: number;
}

/** Elemento de GET /api/account/history — un pago propio en una mesa. */
export interface HistoryEntry {
  id: string;
  amount_cents: number;
  date: string;
  mesa_code: string;
  restaurant: string;
  category: string;
}

export interface HistoryResponse {
  history: HistoryEntry[];
  limit: number;
  offset: number;
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

export type ItemStatus = 'available' | 'locked' | 'paid' | 'released';

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

/** Ítem dentro de GET /api/mesas/:code. */
export interface MesaItem {
  id: string;
  name: string;
  category: string;
  price_cents: number;
  quantity: number;
  status: ItemStatus;
  locked_by_me: boolean;
  lock_expires_at: string | null;
}

/** Slot de división igualitaria (GET /api/mesas/:code, division_slots). */
export interface DivisionSlot {
  slot_index: number;
  amount_cents: number;
  amount_display: string;
  status: 'available' | 'claimed' | 'paid';
}

/** Staff activo (GET /api/mesas/:code → active_staff). */
export interface ActiveStaff {
  id: string;
  display_name: string;
  role: string;
}

/** GET /api/mesas/:code → mesa. */
export interface MesaDetail {
  id: string;
  code: string;
  full_name: string;
  restaurant: { id: string; name: string; category: string; address: string | null };
  total_cents: number;
  total_display: string;
  paid_amount_cents: number;
  tip_amount_cents: number;
  /** D7 (v2.17): base partes-iguales de la propina — round(total ÷ N). */
  tip_base_cents: number;
  division_mode: 'consumo' | 'igual';
  expected_participants: number;
  status: MesaStatus;
  expires_at: string;
  items: MesaItem[];
  division_slots?: DivisionSlot[];
  active_staff: ActiveStaff[];
  my_role: 'opener' | 'participant' | 'guest' | null;
}

export interface MesaDetailResponse {
  mesa: MesaDetail;
}

/** POST /api/mesas — request (schemas.createMesa, A-1 + D4 v2.16). */
export interface CreateMesaRequest {
  restaurant_id: string;
  total_cents: number;
  division_mode: 'consumo' | 'igual';
  expected_participants: number;
  guarantee_method: 'card' | 'wallet';
  /** Tarjeta NUEVA: pm_… creado por Stripe Elements. */
  stripe_payment_method_id?: string;
  /** D4 (v2.16): tarjeta GUARDADA — uuid de payment_methods. */
  payment_method_id?: string;
  /** D4 (v2.16): guardar la tarjeta nueva tipeada (default false). */
  save_payment_method?: boolean;
  items: Array<{ name: string; category?: string; price_cents: number; quantity: number }>;
}

/** POST /api/mesas → 201 (garantía A-1). */
export interface CreateMesaResponse {
  mesa: {
    id: string;
    code: string;
    total_cents: number;
    division_mode: 'consumo' | 'igual';
    expected_participants: number;
    status: MesaStatus;
    expires_at: string;
    created_at: string;
  };
  guarantee: {
    method: 'card' | 'wallet';
    status: 'open' | 'requires_action';
    client_secret?: string;
  };
}

/** POST /api/mesas/:code/items/lock → 200. */
export interface LockItemsResponse {
  locked: string[];
  lock_token: string;
  lock_expires_at: string;
}

export type PaymentType = 'card' | 'apple_pay' | 'google_pay' | 'wallet';

/** POST /api/mesas/:code/pay — request (schemas.payMesa + D4 v2.16). */
export interface PayMesaRequest {
  /** Tarjeta GUARDADA: uuid de payment_methods. */
  payment_method_id?: string;
  /** Tarjeta NUEVA (pm_… de Elements) o wallets (apple/google). */
  stripe_payment_method_id?: string;
  /** D4 (v2.16): guardar la tarjeta nueva tipeada (default false). */
  save_payment_method?: boolean;
  payment_type: PaymentType;
  item_ids: string[];
  lock_tokens?: string[];
  /** D7 (v2.17): monto a mano. EXCLUYENTE con tip_bps (ambos → 400). */
  tip_cents?: number;
  /** D7 (v2.17): 0–10000 = 0–100% de tu parte (total ÷ N); computa el server. */
  tip_bps?: number;
  tip_to_staff_id?: string;
  idempotency_key: string;
}

/** POST /api/mesas/:code/pay → 201 (rama wallet o rama tarjeta). */
export interface PayMesaResponse {
  attempt: {
    id: string;
    gross_amount_cents: number;
    /** D7 (v2.17): la propina EXACTA computada por el server. */
    tip_cents?: number;
    gross_display?: string;
    client_secret?: string;
    status: string;
    stripe_status?: string;
    requires_action?: boolean;
    payment_type?: PaymentType;
  };
}

/** POST /api/mesas/:code/invitations (type 'link') → 201. */
export interface CreateInvitationResponse {
  invitation: {
    id: string;
    invitation_type: 'link' | 'in_app';
    status: string;
    expires_at: string;
    created_at: string;
  };
  link?: string;
}

// ─── OCR (routes/ocr.js) ───────────────────────────────────

/** POST /api/ocr → 200 (mock declarado: HAS_REAL_IMPL=false). */
export interface OcrResponse {
  items: Array<{ name: string; price_cents: number; quantity: number; category?: string }>;
  total_cents: number;
  mock: boolean;
}

// ─── Payment methods (routes/payment-methods.js) ───────────

/**
 * Elemento de GET /api/payment-methods — contrato D4 PUBLICADO (backend
 * v2.16.0, routes/payment-methods.js del mirror). `id` es el uuid interno
 * (lo aceptan la garantía y el pago como `payment_method_id`, y sigue siendo
 * el id de topup/default/delete); `stripe_payment_method_id` es el `pm_…`
 * (NOT NULL en la tabla). Cierra G-04/G-05.
 */
export interface PaymentMethod {
  id: string;
  stripe_payment_method_id: string;
  brand: string;
  bank_name: string | null;
  type: 'credit' | 'debit';
  last_four: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
  display: string;
}

export interface PaymentMethodsResponse {
  payment_methods: PaymentMethod[];
}

// ─── Topup (routes/topup.js + spei-funding.js) ─────────────

/** POST /api/topup/oxxo → 201. */
export interface TopupOxxoResponse {
  topup: {
    id: string;
    status: string;
    amount_cents: number;
    amount_display: string;
    voucher_reference: string;
    stripe_voucher_url: string | null;
    voucher_expires_at: string;
  };
}

/** POST /api/topup/card → 201. */
export interface TopupCardResponse {
  topup: {
    id: string;
    status: string;
    amount_cents: number;
    amount_display: string;
  };
  requires_action: boolean;
  client_secret?: string;
}

/** GET /api/wallet/clabe (A-3, abono SPEI). */
export interface ClabeResponse {
  clabe: string;
  banco: string;
  beneficiario: string;
  instrucciones: string;
}

// ─── Transfers (routes/transfers.js) ───────────────────────

export interface CreateTransferRequest {
  amount_cents: number;
  to_payme_id?: string;
  to_email?: string;
  to_user_id?: string;
  concept?: string;
  idempotency_key: string;
}

/** POST /api/transfers → 201. */
export interface CreateTransferResponse {
  transfer: {
    id: string;
    amount_cents: number;
    concept: string | null;
    completed_at: string;
    amount_display: string;
    to: { payme_id: string; full_name: string };
  };
}

/** Elemento de GET /api/transfers. */
export interface TransferListItem {
  id: string;
  amount_cents: number;
  amount_display: string;
  concept: string | null;
  status: string;
  completed_at: string | null;
  created_at: string;
  direction: 'sent' | 'received';
  counterparty_payme_id: string;
  counterparty_name: string;
}

export interface TransfersResponse {
  transfers: TransferListItem[];
}

// ─── Friends / Groups (routes/friends.js, groups.js) ───────

/** Elemento de GET /api/friends. */
export interface Friend {
  id: string;
  payme_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  added_at?: string;
}

export interface FriendsResponse {
  friends: Friend[];
}

/** Elemento de GET /api/groups. */
export interface Group {
  id: string;
  name: string;
  icon: string;
  created_at: string;
  member_count: number;
}

export interface GroupsResponse {
  groups: Group[];
}

/** GET /api/groups/:id. */
export interface GroupDetailResponse {
  group: { id: string; name: string; icon: string };
  members: Array<{ id: string; payme_id: string; first_name: string; last_name: string; email: string }>;
}

// ─── Notifications (routes/notifications.js) ───────────────

/** Elemento de GET /api/notifications. */
export interface AppNotification {
  id: string;
  type: string;
  title: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unread_count: number;
  limit: number;
  offset: number;
}

// ─── Invitations in-app (routes/invitations.js) ────────────

/** Elemento de GET /api/invitations (pendientes para mí). */
export interface PendingInvitation {
  id: string;
  mesa_id: string;
  invitation_type: 'in_app' | 'link';
  status: string;
  expires_at: string;
  created_at: string;
  mesa_code: string;
  restaurant_name: string;
  inviter_first_name: string;
  inviter_last_name: string;
  inviter_payme_id: string;
}

export interface PendingInvitationsResponse {
  invitations: PendingInvitation[];
}

// ─── Stats (routes/account.js → GET /stats) ────────────────

export interface StatsResponse {
  month: {
    spent_cents: number;
    spent_display: string;
    visits: number;
    avg_per_visit_cents: number;
    avg_per_visit_display: string;
  };
  top_restaurants: Array<{ name: string; visits: number }>;
  top_dish: { name: string; times: number } | null;
  favorite_category: string | null;
}

// ─── Errores (shape del error handler de server.js y rutas) ─

export interface ApiError {
  error: string;
  message?: string;
  [key: string]: unknown;
}
