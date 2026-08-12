/**
 * api/types.ts — Tipos del contrato REAL del app backend (v2.13).
 * Fuente de verdad: contract-mirror/ (schemas/index.js + routes/*.js).
 * Regla: NO inventar campos. Cada tipo cita la ruta de la que sale.
 */

// ─── Auth (routes/auth.js) ─────────────────────────────────

/** Shape de `user` en register/login (v2.20) y GET /account/me. */
export interface User {
  id: string;
  payme_id: string;
  email: string;
  first_name: string;
  last_name: string;
  /** Solo en GET /account/me (G-02, v2.20). Nullable en el backend. */
  phone?: string | null;
  /** Solo en GET /account/me (G-02, v2.20). */
  created_at?: string;
}

/** Tokens comunes de auth. El refresh devuelve SOLO esto (sin `user`). */
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** POST /api/auth/login → 200 (G-02, v2.20: incluye `user`, mismo shape que register). */
export interface LoginResponse extends TokenPair {
  user: User;
}

/** POST /api/auth/register → 201 (mismo shape que login desde v2.20). */
export type RegisterResponse = LoginResponse;

/** GET /api/account/me → 200 (G-02, v2.20). */
export interface MeResponse {
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
    /**
     * OLA 5 (v2.31.0) · capability del riel saldo. **Sin tipar a propósito.**
     *
     * Tiparla como `{ enabled: boolean; account_activity: boolean }` haría que
     * el compilador afirme una forma que sólo se puede verificar en runtime: la
     * respuesta viene de un backend que puede ser de otra versión. `unknown`
     * obliga a pasar por `readWalletRail` (`walletRail.ts`), que valida el
     * conjunto CERRADO de claves y falla cerrado.
     *
     * Opcional porque su ausencia es contrato: backend previo a OLA 5 → riel
     * APAGADO.
     */
    wallet_rail?: unknown;
    /**
     * 🔴 `D-FF-2-BIS` · modo monetario global. **`unknown` A PROPÓSITO, Y ES
     * PERMANENTE — no un placeholder hasta espejar.**
     *
     * El espejo YA trajo la forma (`contract-mirror/services/moneyRail.js`,
     * commit `0ce21f4`): `{ mode, payments_enabled, real_money }`. **Y aun así
     * no se tipa.**
     *
     * ⚠️ **Porque el espejo declara lo que la FUENTE tiene, no lo que el
     * DESPLEGADO devuelve.** Tiparlo haría que el compilador avale una forma que
     * sólo el runtime puede confirmar, y después `readMoneyRail` estaría
     * validando algo que el tipo ya dio por cierto — o sea una validación que
     * nadie va a mantener.
     *
     * 🔴 **No es una precaución teórica: pasó el 2026-08-10.** El backend
     * desplegó `money_rail` en producción **tres días antes** de que su contrato
     * lo declarara. En esa ventana un tipo optimista habría afirmado una forma
     * que el espejo no tenía, y uno pesimista habría negado una que ya estaba
     * viva. `unknown` no afirma ninguna de las dos.
     *
     * Es exactamente el tratamiento de `wallet_rail`, y por el mismo motivo.
     *
     * **Se lee con `readMoneyRail` (`./moneyRail.ts`), que valida el conjunto
     * CERRADO de claves y falla cerrado sobre la SUPERFICIE DE TARJETA: si no se
     * determina `real_money`, no se ofrece escribir un número.**
     */
    money_rail?: unknown;
    /**
     * `ocr` · capability del lector de tickets (`services/ocrRail.js`, espejado
     * en `a8611ec`). **`unknown` por el mismo motivo que sus dos vecinos:** el
     * espejo declara lo que la FUENTE tiene, no lo que el DESPLEGADO devuelve.
     *
     * Publica `mode`, `credentials_present`, `accepted_mime_types` y
     * `provider_mime_types`. **Se lee con `readOcrRail` (`./ocrRail.ts`)**, que
     * construye el `accept` del selector de archivos desde el dueño del
     * contrato en vez de una lista escrita a mano — que ya se desincronizó una
     * vez y por eso el emisor publicó esto.
     */
    ocr?: unknown;
  };
}

/**
 * `POST /api/invitations/accept-link` (v2.32.0). Requiere sesión.
 *
 * `joined` viene siempre `true` en el 200 — el rechazo es un status, no un
 * booleano—, pero se decodifica igual: un 2xx malformado no acredita que la
 * inscripción haya ocurrido, y de eso depende que la persona pueda pagar.
 */
export interface AcceptInvitationLinkResponse {
  joined: true;
  mesa_code: string;
}

// ─── Cuenta (routes/account.js) ────────────────────────────

/** GET /api/account/balance (G-03: no expone held_balance_cents). */
/** GET /api/account/balance (v2.21 suma retenido + disponible — G-03). */
export interface BalanceResponse {
  balance_cents: number;
  balance_display: string;
  /** Retenido en garantías wallet activas (G-03, v2.21). */
  held_balance_cents: number;
  held_balance_display: string;
  /** balance − held, computado server-side (misma resta que el 402). */
  available_cents: number;
  available_display: string;
  clabe: string | null;
  currency: string;
}

// ─── Restaurantes (routes/restaurants.js — G-01, v2.21) ────

/** Público de cara al comensal; espeja el shape de GET /mesas/:code → restaurant. */
export interface Restaurant {
  id: string;
  name: string;
  category: string;
  /** Nullable en la DB (verificado en vivo: el restaurante demo lo tiene NULL). */
  address: string | null;
}

/** GET /api/restaurants/:id → 200. 404 `restaurant_not_found` (también para no-active y uuid malformado). */
export interface RestaurantResponse {
  restaurant: Restaurant;
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

/**
 * Elemento de GET /api/account/history — **un pago propio**, no una mesa.
 *
 * 🔴 La granularidad es UN RENGLÓN POR PAGO y el emisor la fijó con test
 * (backend v2.42.0): esta misma respuesta alimenta `PagosScreen`, que es
 * superficie card-only ratificada. Dos pagos a la misma mesa son dos renglones,
 * y agruparlos es trabajo del front — `groupByMesa()` ya lo hace. No pedir que
 * el contrato agrupe.
 */
export interface HistoryEntry {
  id: string;
  amount_cents: number;
  date: string;
  mesa_code: string;
  /**
   * Aditivo en v2.42.0. Sin esto el front no podía saber si la mesa de un pago
   * sigue viva, y pintaba mesas abiertas bajo un encabezado de mes como si ya
   * hubieran terminado.
   */
  mesa_status: MesaStatus;
  restaurant: string;
  category: string;
}

export interface HistoryResponse {
  history: HistoryEntry[];
  limit: number;
  offset: number;
}

// ─── Mesas (routes/mesas.js) ───────────────────────────────

/**
 * Estados reales de mesa (`utils/stateMachine.js` — `TRANSITIONS.mesa`).
 *
 * 🔴 **`dispersed` FALTABA, y faltaba desde siempre** (encontrado en la ORDEN
 * 2-A, 2026-08-07). Es el terminal del flujo legacy sin garantía y está en la
 * FSM del dueño desde antes de este espejo; acá el union tenía once estados y
 * la máquina tiene doce. Nadie lo notó porque **ningún gate comparaba las dos
 * listas**: TypeScript no valida contra el backend, y un `status` que el tipo
 * no declara igual llega en runtime. El MVP card-only no crea mesas que lo
 * alcancen, pero una mesa histórica sí puede estar ahí — y desde v2.48.0 el
 * emisor lo clasifica explícitamente en `replayable`.
 *
 * Ahora hay gate: `mesaStatus.mirror.test.ts` compara este union contra las
 * claves de `TRANSITIONS.mesa` del espejo, en las dos direcciones.
 */
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
  | 'cancelled'
  /** Legacy: flujo viejo sin garantía. Terminal. */
  | 'dispersed';

/** El union de arriba, como valor — para verificarlo y para iterarlo. */
export const MESA_STATUSES: readonly MesaStatus[] = [
  'pending_auth', 'open', 'partially_paid', 'fully_paid', 'expired',
  'settling', 'settled', 'dispersing', 'completed', 'auth_failed',
  'cancelled', 'dispersed',
];

export type ItemStatus = 'available' | 'locked' | 'paid' | 'released';

// ─── Reconciliación de una creación (v2.47.0 · orden 1B del dueño) ─────────
//
// `GET /api/mesas/creations/:idempotency_key` — la evidencia EXACTA de una
// apertura ambigua, resuelta por `(opener_user_id, idempotency_key)`. Es la
// respuesta del dueño al P0 que este front contuvo: acreditar una creación
// por el NOMBRE del restaurante, y —peor— leer la ausencia en `/mesas/open`
// como prueba de que no existía, cuando una mesa en `pending_auth` no se
// lista ahí.
//
// 🔴 De SOLO LECTURA. El dueño NO reusó `mesaReplayResponse` porque ésa
// reconduce holds contra Stripe: *"consultar no puede mover un centavo"*.
// Diagnóstico y acción, separados.

/** Los `outcome` del contrato. Cualquier otro valor NO se interpreta. */
export type MesaCreationOutcome =
  /** No hay creación con esa clave para este opener. */
  | 'not_found'
  /** La mesa quedó en `pending_auth`: existe, con su hold sin autorizar. */
  | 'requires_action'
  | 'open'
  | 'partially_paid'
  /** `auth_failed | cancelled | expired`: la creación terminó y está muerta. */
  | 'terminal'
  /**
   * `fully_paid | settling | settled | dispersing | completed | dispersed`:
   * la mesa avanzó más allá de la apertura. Desde v2.48.0 el grupo es
   * EXHAUSTIVO y declarado — `dispersed` caía acá por descarte y sin test.
   */
  | 'replayable'
  /** La misma clave con OTRA intención económica. Llega SIN datos de mesa. */
  | 'payload_hash_conflict'
  /**
   * v2.48.0 · un estado de mesa que la matriz del emisor NO clasifica. **No
   * es un error: es el emisor negándose a inventar una etiqueta.** Nunca
   * libera el journal ni habilita acción — no saber no es saber que no.
   */
  | 'unknown';

/**
 * La matriz `status → outcome` del emisor (`routes/mesas.js`,
 * `CREACION_OUTCOMES`), replicada para **verificar coherencia**, no para
 * decidir: si el emisor dice `open` sobre una mesa `pending_auth`, la
 * respuesta se contradice y no acredita nada. Donde esta réplica no conoce el
 * estado, manda el emisor: es la autoridad sobre su propia máquina.
 */
export const MESA_CREATION_OUTCOME_BY_STATUS: Readonly<Record<MesaStatus, MesaCreationOutcome>> = {
  pending_auth: 'requires_action',
  open: 'open',
  partially_paid: 'partially_paid',
  auth_failed: 'terminal',
  cancelled: 'terminal',
  expired: 'terminal',
  fully_paid: 'replayable',
  settling: 'replayable',
  settled: 'replayable',
  dispersing: 'replayable',
  completed: 'replayable',
  dispersed: 'replayable',
};

/** Resultado ya decodificado. `mesa` es `null` en las ramas sin datos. */
export interface MesaCreationLookup {
  readonly found: boolean;
  readonly outcome: MesaCreationOutcome;
  /**
   * Lo dice el CONTRATO, no se deduce. `true` en `requires_action` (repetir el
   * POST reconduce el hold y devuelve `client_secret`) y también en el 404
   * `not_found` (si no hay nada creado, repetir con la misma clave crea por
   * primera vez, y si el 404 mintió, B-06 devuelve la mesa existente en vez de
   * abrir una segunda).
   */
  readonly retryWithSameKey: boolean;
  readonly mesa: {
    readonly code: string;
    readonly status: MesaStatus;
    /** ⚠️ El contrato lo manda como STRING (bigint del driver). Acá, entero. */
    readonly totalCents: number;
  } | null;
  readonly guarantee: {
    readonly method: string | null;
    readonly authorized: boolean;
  } | null;
}

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
  /** v2.18: 'paid' SOLO cuando el ítem está 100% pagado (fracciones). */
  status: ItemStatus;
  /** v2.18 (fracciones): bps disponibles del ítem (0..10000). */
  remaining_bps: number;
  /** v2.18 (fracciones): MI tenencia en bps (locked+paid). */
  my_bps: number;
  locked_by_me: boolean;
  lock_expires_at: string | null;
}

/** v2.18: pedido de fracción (valores válidos: 2500|3333|5000|10000). */
export interface FractionRequest {
  item_id: string;
  fraction_bps: number;
}

/** Slot de división igualitaria (GET /api/mesas/:code, division_slots). */
export interface DivisionSlot {
  slot_index: number;
  amount_cents: number;
  amount_display: string;
  status: 'available' | 'claimed' | 'paid';
  /**
   * v2.25 (B-06 §4.3): ¿este casillero es MÍO? Sin esto nadie podía detectar
   * el doble cobro. El backend solo lo marca sobre casilleros TOMADOS
   * (`claimed`/`paid`) y jamás expone de quién es el ajeno.
   */
  claimed_by_me?: boolean;
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
  /**
   * B-06 (v2.25, aditivo): sin esto, perder la respuesta de una mesa YA
   * creada y reintentar generaba una SEGUNDA mesa con una segunda garantía
   * — que se liquida sola a los 30 min y captura el total (doble cobro real),
   * además de emitir eventos de facturación inexistente al dashboard.
   */
  idempotency_key: string;
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
    /**
     * v2.24 (Stripe Connect): si el hold vive en la cuenta del restaurante,
     * el 3DS SOLO se confirma inicializando Stripe.js con `{ stripeAccount }`.
     * Ausente = hold de plataforma, como siempre.
     */
    connected_account_id?: string;
  };
}

/** POST /api/mesas/:code/items/lock → 200. */
export interface LockItemsResponse {
  locked: string[];
  /** v2.18: lo efectivamente reclamado (la tolerancia puede ajustar bps). */
  claims: FractionRequest[];
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
  /** Legacy (enteros) — en "partes iguales" viaja esto (ahora se persiste, G-07). */
  item_ids?: string[];
  /** v2.18 (consumo): fracciones por ítem. EXCLUYENTE con item_ids. */
  items?: FractionRequest[];
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
  /**
   * v2.25 (B-06): `true` cuando la respuesta es un REPLAY de la misma clave
   * de idempotencia — el cobro ya había ocurrido y NO se cobró de nuevo.
   */
  idempotent?: boolean;
  attempt: {
    id: string;
    gross_amount_cents: number;
    /** D7 (v2.17): la propina EXACTA computada por el server. */
    tip_cents?: number;
    /** v2.18: recibo de fracciones cobradas (solo consumo). */
    items?: Array<{ item_id: string; fraction_bps: number; amount_cents: number }>;
    gross_display?: string;
    /** El replay unificado puede serializar `null`; el guard lo elimina. */
    client_secret?: string | null;
    /**
     * Solo en el REPLAY idempotente: ahí el backend devuelve la fila cruda del
     * attempt, donde el secreto se llama así y no viene `requires_action`
     * (se deriva de `status`). Ver `findExistingAttempt` en el espejo.
     */
    stripe_client_secret?: string | null;
    status: string;
    stripe_status?: string;
    requires_action?: boolean;
    payment_type?: PaymentType;
    /**
     * v2.24 (Stripe Connect · direct charge): el PaymentIntent vive en la
     * cuenta del restaurante, así que el 3DS se confirma con Stripe.js
     * inicializado con `{ stripeAccount: connected_account_id }`. Viene
     * también en el replay idempotente. Ausente = cargo de plataforma.
     *
     * OJO (contrato v2.24): en este riel el backend IGNORA
     * `save_payment_method` — guardar la tarjeta ahí la dejaría en la bóveda
     * del restaurante. El cobro es normal; la tarjeta no queda guardada.
     */
    connected_account_id?: string;
    /**
     * G-10 (pivote a Stripe Connect, 2026-07-24): en pagos con TARJETA el
     * merchant of record es el RESTAURANTE. Este es el descriptor que el
     * comensal ve en el resumen de su tarjeta — lo define la cuenta Connect
     * del restaurante, así que solo el backend lo conoce.
     *
     * TODAVÍA NO ESTÁ EN EL CONTRATO (backend v2.21.0 no lo expone): forma
     * acordada con Mati, hoy solo la sirve el mock. En real llega
     * `undefined` y la UI degrada sin el sub-texto — el "Cobrado por" sale
     * igual del `restaurant.name`, que sí es contrato.
     */
    statement_descriptor?: string | null;
  };
}

/** POST /api/mesas/:code/invitations (type 'link') → 201. */
export interface CreateInvitationResponse {
  /** `true` cuando el backend replaya la invitación creada con la misma key. */
  idempotent?: boolean;
  invitation: {
    id: string;
    invitation_type: 'link' | 'in_app';
    /** El replay de la misma key puede devolver la autoridad ya vencida. */
    status: 'pending' | 'expired';
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

/** POST /api/payment-methods/setup-intent → 200. */
export interface CreateSetupIntentResponse {
  setup_intent_id: string;
  client_secret: string;
}

/** POST /api/payment-methods → 201 fresh / 200 replay en e8a3faf. */
export type AttachedPaymentMethod = PaymentMethod;

export interface AttachPaymentMethodResponse {
  payment_method: AttachedPaymentMethod;
  /** El `pm_` ya estaba adjunto; no se creó una segunda tarjeta local. */
  idempotent?: boolean;
}

// ─── Topup (routes/topup.js + spei-funding.js) ─────────────

/** POST /api/topup/oxxo → 201. */
export interface TopupOxxoResponse {
  idempotent?: boolean;
  topup: {
    id: string;
    /** Se normaliza desde el BIGINT/shape real del endpoint. */
    method: 'oxxo';
    status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled';
    amount_cents: number;
    amount_display: string;
    /** Sólo un replay terminal puede omitirlo; uno activo falla en el guard. */
    voucher_reference?: string;
    stripe_voucher_url?: string | null;
    voucher_expires_at?: string;
  };
}

/** POST /api/topup/card → 201. */
export interface TopupCardResponse {
  idempotent?: boolean;
  topup: {
    id: string;
    method: 'card';
    status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled';
    amount_cents: number;
    amount_display: string;
  };
  /** Ausente en replay: no se inventa false ni se promete un 3DS. */
  requires_action?: boolean;
  client_secret?: string;
}
/** GET /api/topup/:id → estado de reconciliación de la carga. */
export interface TopupStatusResponse { topup: { id: string; method: 'oxxo' | 'card' | 'spei'; status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled'; amount_cents: number; amount_display: string }; }

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

interface TransferResponseBase {
  id: string;
  amount_cents: number;
  concept: string | null;
  completed_at: string;
  amount_display: string;
}

/** POST /api/transfers: fresh liga por `to`; replay liga por `to_user_id`. */
export type CreateTransferResponse =
  | {
      idempotent?: false;
      transfer: TransferResponseBase & {
        to: { payme_id: string; full_name: string };
        status?: 'completed';
      };
    }
  | {
      /** El backend devolvió el envío YA hecho; no ejecutó otro movimiento. */
      idempotent: true;
      transfer: TransferResponseBase & {
        to_user_id: string;
        status: 'completed';
      };
    };

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
/**
 * Persona en el dominio social (OLA 3C · backend v2.29.0, `persona()` de
 * routes/friends.js).
 *
 * **C3/C4: `email` SALIÓ del contrato**, tanto de la proyección como del
 * criterio de búsqueda. Buscar por substring de correo era una forma barata de
 * confirmarlo carácter a carácter. No se repone del lado del front.
 */
export interface Friend {
  id: string;
  payme_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  /** Solo en GET /friends: `responded_at` de la amistad, o `created_at`. */
  added_at?: string;
}

export interface FriendsResponse {
  friends: Friend[];
}

/** GET /api/friends/search → 200. Busca SOLO entre amigos propios. */
export interface FriendSearchResponse {
  results: Friend[];
}

/**
 * C1/C2 · `POST /api/friends` ya no crea una amistad: crea una INTENCIÓN.
 *
 * Responde **202 `{ requested: true }` SIEMPRE** — la persona no existe,
 * existe, ya es amiga, ya tiene tu solicitud, o te bloqueó. El emisor no puede
 * distinguir ninguno de esos casos. Esa ceguera es el punto: antes un 404
 * `user_not_found` convertía al endpoint en un oráculo para descubrir quién
 * tiene cuenta probando correos.
 *
 * Consecuencia para la UI: **no se puede decir "no encontramos a esa
 * persona"**, porque el front no lo sabe. El estado real de las solicitudes
 * propias se ve en `GET /friends/requests?direction=outgoing`.
 */
export interface FriendRequestCreatedResponse {
  requested: true;
}

export type FriendRequestDirection = 'incoming' | 'outgoing';

/**
 * Elemento de `GET /api/friends/requests`.
 *
 * ⚠️ `id` es el de la SOLICITUD y la persona va anidada en `user`. Están
 * separados a propósito: en el backend, seleccionar `f.id` junto a `u.id`
 * devolvía dos columnas `id` y el driver conservaba la última, así que aceptar
 * fallaba con 404 siempre. No volver a mezclarlos de este lado.
 */
export interface FriendRequest {
  id: string;
  user: Friend;
  requested_at: string;
}

export interface FriendRequestsResponse {
  direction: FriendRequestDirection;
  requests: FriendRequest[];
}

export interface FriendRequestAcceptedResponse { accepted: true }
export interface FriendRequestRejectedResponse { rejected: true }
export interface FriendRequestCancelledResponse { cancelled: true }
export interface FriendBlockedResponse { blocked: true }
export interface FriendUnblockedResponse { unblocked: true }
/** C5: `DELETE /friends/:id` ahora da 404 `friendship_not_found` si no había. */
export interface FriendRemovedResponse { removed: true }

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
  /**
   * v2.45.0 (gate de admisión) · el listado MARCA, no filtra: una invitación
   * cuya mesa murió sigue viniendo, con esto en false, para mostrarla apagada
   * ("Esta mesa ya cerró") en vez de desaparecerla. Se lee DIRECTO — el
   * emisor lo computa con el MISMO `mesaViva()` que gatea las dos puertas de
   * entrar; inferirlo acá sería una segunda expresión de la regla
   * desincronizándose sola.
   */
  mesa_joinable: boolean;
  /** v2.45.0 · estado VIVO de la mesa, para el copy. */
  mesa_status: MesaStatus;
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
