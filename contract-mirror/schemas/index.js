/**
 * schemas/index.js v2.5.2
 *
 * Cambios vs v2.5.1:
 *   - P1 #4: `email` ahora es z.preprocess(trim+lowercase, …). Un email con
 *     espacios o casing distinto se normaliza ANTES de validar el formato.
 *     Esto significa que req.body.email YA llega normalizado a los handlers.
 */
'use strict';

const { z } = require('zod');

// v2.5.2 P1 #4: preprocess trim + lowercase antes de validar formato.
const email = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().email().max(255)
);

const paymeId  = z.string().regex(/^payme_[a-z]{2}_[a-z0-9]{4}$/);
const phone    = z.string().regex(/^\+?[0-9]{10,15}$/).optional();
const password = z.string().min(8).max(128);
const uuid     = z.string().uuid();
const positiveCents = z.number().int().nonnegative();
const strictPositive = z.number().int().positive();
const mesaCode = z.string().regex(/^[A-Z]{2}-\d{3,5}$/);
const stripePmId = z.string().regex(/^pm_[a-zA-Z0-9_]+$/);
const idempotencyKey = z.string().min(8).max(100);
const lockToken = z.string().min(8).max(100);

// AUTH
const register = z.object({
  email, phone, password,
  first_name: z.string().min(1).max(100),
  last_name:  z.string().min(1).max(100),
});
const login = z.object({ email, password });
const refreshToken = z.object({
  refresh_token: z.string().min(20).max(500),
});

// PAYMENT METHODS
const attachPaymentMethod = z.object({
  stripe_payment_method_id: z.string().min(5).max(100),
  set_as_default: z.boolean().optional(),
});
const setDefaultPaymentMethod = z.object({ payment_method_id: uuid });

// FRIENDS / GROUPS
const addFriend = z.object({
  email: email.optional(), payme_id: paymeId.optional(),
}).refine(d => d.email || d.payme_id, { message: 'email or payme_id required' });
const searchFriends = z.object({ q: z.string().min(1).max(100) });
const createGroup = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
});
const updateGroup = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(10).optional(),
});
const addGroupMember = z.object({ friend_user_id: uuid });

// INVITATIONS
const createInvitation = z.object({
  mesa_code: mesaCode.optional(),
  invited_user_id: uuid.optional(),
  invited_payme_id: paymeId.optional(),
  type: z.enum(['in_app', 'link']),
}).refine(d => d.type === 'link' || d.invited_user_id || d.invited_payme_id, {
  message: 'in_app invitation requires invited_user_id or invited_payme_id',
});

// MESAS
const createMesa = z.object({
  restaurant_id: uuid,
  total_cents: strictPositive,
  division_mode: z.enum(['consumo', 'igual']).default('consumo'),
  expected_participants: z.number().int().min(1).max(20).default(1),
  // v2.11 (parche §2 · garantía): el organizador garantiza el total al crear
  guarantee_method: z.enum(['card', 'wallet']),
  stripe_payment_method_id: z.string().min(1).max(100).optional(),
  // D4 (v2.16): garantía con tarjeta GUARDADA (uuid de payment_methods) y
  // opt-in para guardar la tarjeta tipeada (default false: el consentimiento
  // vive en la UI, el backend obedece).
  payment_method_id: uuid.optional(),
  save_payment_method: z.boolean().default(false),
  items: z.array(z.object({
    name: z.string().min(1).max(200),
    category: z.string().max(50).optional(),
    price_cents: positiveCents,
    quantity: z.number().int().positive().default(1),
  })).min(1),
}).refine(d => d.division_mode !== 'igual' || d.expected_participants >= 2, {
  message: 'igual requires expected_participants >= 2',
}).refine(d => d.guarantee_method !== 'card' || !!(d.stripe_payment_method_id || d.payment_method_id), {
  message: 'card guarantee requires stripe_payment_method_id or payment_method_id',
});

const lockItems = z.object({
  item_ids: z.array(uuid).min(1),
});

const payMesa = z.object({
  payment_method_id: uuid.optional(),
  stripe_payment_method_id: stripePmId.optional(),
  // D4 (v2.16): opt-in para guardar la tarjeta tipeada al pagar (default false)
  save_payment_method: z.boolean().default(false),
  payment_type: z.enum(['card', 'apple_pay', 'google_pay', 'wallet']).default('card'),
  item_ids: z.array(uuid).default([]),
  lock_tokens: z.array(lockToken).optional(),
  tip_cents: positiveCents.default(0),
  // D7 (v2.17): propina por % sobre base partes-iguales (total÷N declarados).
  // 0..10000 bps = 0..100% de su parte (tope ratificado). La cuenta la hace el
  // SERVER. Excluyente con tip_cents (el monto a mano).
  tip_bps: z.number().int().min(0).max(10000).optional(),
  tip_to_staff_id: uuid.optional(),
  idempotency_key: idempotencyKey,
}).refine(d => {
  if (d.payment_type === 'wallet') return true;
  if (d.payment_type === 'apple_pay' || d.payment_type === 'google_pay') {
    return !!d.stripe_payment_method_id;
  }
  return !!(d.payment_method_id || d.stripe_payment_method_id);
}, { message: 'payment source required for non-wallet payment' })
.refine(d => d.tip_bps === undefined || !d.tip_cents, {
  message: 'tip_bps and tip_cents are mutually exclusive',
});

// TOPUPS
const TOPUP_MIN = 5000;
const TOPUP_MAX = 1_000_000;
const topupOxxo = z.object({
  amount_cents: strictPositive.refine(v => v >= TOPUP_MIN && v <= TOPUP_MAX, {
    message: `amount must be between ${TOPUP_MIN} and ${TOPUP_MAX} cents`,
  }),
  idempotency_key: idempotencyKey,
});
const topupCard = z.object({
  amount_cents: strictPositive.refine(v => v >= TOPUP_MIN && v <= TOPUP_MAX, {
    message: `amount must be between ${TOPUP_MIN} and ${TOPUP_MAX} cents`,
  }),
  payment_method_id: uuid,
  idempotency_key: idempotencyKey,
});

// TRANSFERS
const createTransfer = z.object({
  amount_cents: strictPositive,
  to_payme_id: paymeId.optional(),
  to_email: email.optional(),
  to_user_id: uuid.optional(),
  concept: z.string().max(200).optional(),
  idempotency_key: idempotencyKey,
}).refine(d => d.to_payme_id || d.to_email || d.to_user_id, {
  message: 'destination required',
});

// STAFF
const addStaff = z.object({
  payme_id: paymeId.optional(),
  email: email.optional(),
  display_name: z.string().min(1).max(100),
  role: z.enum(['waiter','bartender','manager','host','runner']).default('waiter'),
}).refine(d => d.payme_id || d.email, { message: 'payme_id or email required' });
const updateStaff = z.object({
  display_name: z.string().min(1).max(100).optional(),
  role: z.enum(['waiter','bartender','manager','host','runner']).optional(),
});
const setStaffShift = z.object({ shift_status: z.enum(['on','off','break']) });

// PUSH
const registerPushDevice = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(['ios','android','web']),
  device_id: z.string().max(100).optional(),
  app_version: z.string().max(20).optional(),
});

// QUERIES
const movementsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const historyQuery = z.object({
  category: z.enum(['italian','japanese','mexican','cafe','other']).optional(),
  from:  z.string().datetime().optional(),
  to:    z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const walletTxQuery = z.object({
  type: z.enum([
    'topup_oxxo','topup_card','topup_spei',
    'transfer_in','transfer_out',
    'payment_mesa','refund_mesa',
    'tip_received','tip_payout',
    'adjustment_credit','adjustment_debit',
  ]).optional(),
  from: z.string().datetime().optional(),
  to:   z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
const notificationsQuery = z.object({
  unread_only: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

function validateBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body);
    if (!r.success) {
      return res.status(400).json({
        error: 'validation_error',
        issues: r.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.body = r.data;
    next();
  };
}
function validateQuery(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.query);
    if (!r.success) {
      return res.status(400).json({
        error: 'validation_error',
        issues: r.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.validatedQuery = r.data;
    next();
  };
}

module.exports = {
  register, login, refreshToken,
  attachPaymentMethod, setDefaultPaymentMethod,
  addFriend, searchFriends,
  createGroup, updateGroup, addGroupMember,
  createInvitation,
  createMesa, payMesa, lockItems,
  topupOxxo, topupCard,
  createTransfer,
  addStaff, updateStaff, setStaffShift,
  registerPushDevice,
  movementsQuery, historyQuery, walletTxQuery, notificationsQuery,
  validateBody, validateQuery,
};
