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
const { esFechaCalendario, hoyEnMexico } = require('../utils/fechas');
const { banderaEstricta } = require('../utils/flags');

// v2.5.2 P1 #4: preprocess trim + lowercase antes de validar formato.
const email = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().email().max(255)
);

const paymeId  = z.string().regex(/^payme_[a-z]{2}_[a-z0-9]{4}$/);
// bcrypt procesa como máximo 72 BYTES, no caracteres. Aceptar más truncaría
// silenciosamente contraseñas Unicode distintas al mismo hash.
// Las credenciales nuevas no pueden exceder el límite en BYTES de bcrypt.
// Login conserva el contrato histórico (8..128 caracteres): bcrypt.compare
// sigue pudiendo verificar hashes heredados hechos con inputs largos.
const passwordNew = z.string().min(8).max(128)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, {
    message: 'password must be at most 72 UTF-8 bytes',
  });
const passwordLegacy = z.string().min(8).max(128);
const uuid     = z.string().uuid();
const safeInt = z.number().int().safe();
const positiveCents = safeInt.nonnegative();
const strictPositive = safeInt.positive();
const mesaCode = z.string().regex(/^[A-Z]{2}-\d{3,5}$/);
// El schema físico usa VARCHAR(100). Validar el mismo límite antes de llegar
// a Stripe/pg evita que dos rutas acepten contratos distintos para el mismo id.
const stripePmId = z.string().max(100).regex(/^pm_[a-zA-Z0-9_]+$/);
const idempotencyKey = z.string().min(8).max(100);
const lockToken = z.string().min(8).max(100);

// AUTH
/**
 * Fecha de nacimiento de calendario ('YYYY-MM-DD'), sin husos.
 *
 * D-03 la pide en el registro y D-11 la usa para proteger a menores. Entrada
 * NEUTRA de fecha — nunca una casilla "¿sos mayor de edad?".
 * Se valida contra el calendario de México, el mismo con el que después se
 * compara la edad: si se validara en UTC, una fecha de "hoy" cargada de noche
 * en México se rechazaría por futura.
 */
const birthDate = z.string()
  .refine(esFechaCalendario, { message: 'birth_date debe ser YYYY-MM-DD y una fecha real' })
  .refine((v) => v <= hoyEnMexico(), { message: 'birth_date no puede ser futura' })
  .refine((v) => v >= '1900-01-01', { message: 'birth_date fuera de rango' });

const registerBase = z.object({
  email,
  // ORDEN 1B (2026-08-10) · el teléfono DEJA DE PEDIRSE. El inventario de
  // datos personales lo midió: no tenía un solo consumidor lógico —el login
  // busca por email_normalized, la búsqueda de amigos por email/payme_id, el
  // alta de staff por email/payme_id—. Declarar en el aviso que guardábamos
  // un dato inútil era peor que no guardarlo. La COLUMNA `users.phone` se
  // conserva (hay filas históricas y borrarlas es otra decisión); lo que se
  // corta es la RECOLECCIÓN.
  password: passwordNew,
  // Nombre COMPLETO obligatorio (decisión de Mati, 2026-07-25).
  // `.trim()` antes de validar: con min(1) a secas, un solo espacio pasaba y el
  // "obligatorio" era decorativo. NO cambia en el modo de compatibilidad: el
  // front ya manda los dos campos desde siempre, así que exigirlos no rompe nada.
  first_name: z.string().trim().min(1).max(100),
  last_name:  z.string().trim().min(1).max(100),
});

/**
 * ESTADO FINAL RATIFICADO (Mati, 2026-07-25): birth_date OBLIGATORIA.
 *
 * ⚠️ Esto NO es lo que usa la ruta hoy. La ruta llama a `registerSchema()`, que
 * elige según el flag de rollout. Si venís a editar el contrato del registro,
 * mirá `registerSchema()` primero.
 */
const register = registerBase.extend({ birth_date: birthDate });

/**
 * MODO DE COMPATIBILIDAD (v2.28, gate de rollout de PQ-2).
 *
 * birth_date es OPCIONAL pero se valida igual de estricto cuando viene. Existe
 * porque no hay ningún orden de despliegue seguro entre este backend y el front:
 *   · backend nuevo primero  → el front v0.29.0 no manda la fecha → registro en 400.
 *   · front nuevo primero    → `z.object` no-strict DESCARTA la clave desconocida
 *     y el registro devuelve 201 creando una cuenta SIN fecha, en silencio.
 * Medido contra el schema de v2.26, no supuesto. Ver
 * docs/AUDITORIA_ROLLOUT_PQ2_2026-07-30.md.
 *
 * `.optional()` y NADA MÁS: sin `.default()`, sin fecha inventada. Una cuenta sin
 * fecha queda con birth_date NULL y el gate de menores la sigue bloqueando —
 * falla cerrado, que es la conducta ratificada (D-11).
 */
const registerCompat = registerBase.extend({ birth_date: birthDate.optional() });

/** Nombre de la bandera de rollout de PQ-2. Una sola definición del string. */
const FLAG_PQ2 = 'PQ2_BIRTH_DATE_REQUIRED';

/**
 * ¿birth_date ya es obligatoria en el registro?
 *
 * Se lee EN CADA REQUEST, no al cargar el módulo: así el flip no necesita commit,
 * build ni migración — alcanza con cambiar la configuración del servicio. (Sí
 * requiere reiniciar o redesplegar según la plataforma; eso NO está verificado
 * contra Railway.) Es deliberado: las dos caídas de producción de este repo
 * (v2.18.0 y el pivote Connect) fueron por orden de despliegue.
 *
 * Parsing ESTRICTO (`utils/flags.js`): `PQ2_BIRTH_DATE_REQUIRED=TRUE` explota en
 * vez de quedar apagada en silencio. Un typo que apaga sola la exigencia de la
 * fecha significa seguir creando cuentas sin edad verificable creyendo lo contrario.
 */
function birthDateRequeridaEnRegistro() {
  return banderaEstricta(FLAG_PQ2, false);
}

/** El schema que la ruta usa de verdad. */
function registerSchema() {
  return birthDateRequeridaEnRegistro() ? register : registerCompat;
}
const login = z.object({ email, password: passwordLegacy });
const refreshToken = z.object({
  refresh_token: z.string().min(20).max(500),
});

// PAYMENT METHODS
const attachPaymentMethod = z.object({
  stripe_payment_method_id: stripePmId,
  set_as_default: z.boolean().optional(),
});
const setupIntent = z.object({
  // Aditivo: los clientes nuevos identifican la intención. Si falta, la ruta
  // conserva el comportamiento legacy y crea el intent sin clave Stripe.
  idempotency_key: idempotencyKey.optional(),
}).default({});
const setDefaultPaymentMethod = z.object({ payment_method_id: uuid });
const uuidIdParam = z.object({ id: uuid });

// FRIENDS / GROUPS
const addFriend = z.object({
  email: email.optional(), payme_id: paymeId.optional(),
}).refine(d => d.email || d.payme_id, { message: 'email or payme_id required' });
const searchFriends = z.object({ q: z.string().min(1).max(100) });
// OLA 3C: entrantes = las que me mandaron; salientes = las que mandé.
const friendRequestsQuery = z.object({
  direction: z.enum(['incoming', 'outgoing']).default('incoming'),
});
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
  // Aditivo: clientes legacy siguen convergiendo por la unicidad natural. Los
  // nuevos mandan una clave opaca para poder reintentar una respuesta perdida.
  idempotency_key: idempotencyKey.optional(),
}).refine(d => d.type !== 'in_app'
  || [d.invited_user_id, d.invited_payme_id].some(Boolean), {
  message: 'in_app invitation requires a recipient',
});

// MESAS
const createMesa = z.object({
  // B-06: la garantía con tarjeta NO puede existir sin identidad durable. Si se
  // pierde la respuesta de Stripe, sólo esta clave permite reusar la misma mesa
  // y la misma key guarantee_<mesa>, evitando un segundo hold.
  idempotency_key: idempotencyKey.optional(),
  restaurant_id: uuid,
  total_cents: strictPositive,
  division_mode: z.enum(['consumo', 'igual']).default('consumo'),
  expected_participants: safeInt.min(1).max(20).default(1),
  // v2.11 (parche §2 · garantía): el organizador garantiza el total al crear
  guarantee_method: z.enum(['card', 'wallet']),
  stripe_payment_method_id: stripePmId.optional(),
  // D4 (v2.16): garantía con tarjeta GUARDADA (uuid de payment_methods) y
  // opt-in para guardar la tarjeta tipeada (default false: el consentimiento
  // vive en la UI, el backend obedece).
  payment_method_id: uuid.optional(),
  save_payment_method: z.boolean().default(false),
  // Límite operativo de request: protege CPU/DB; no cambia la capacidad de
  // participantes ni una política de producto. El esquema físico usa
  // SMALLINT para quantity, por eso el máximo es explícito.
  items: z.array(z.object({
    name: z.string().min(1).max(200),
    category: z.string().max(50).optional(),
    price_cents: positiveCents,
    quantity: safeInt.min(1).max(32767).default(1),
  })).min(1).max(100),
}).refine(d => d.division_mode !== 'igual' || d.expected_participants >= 2, {
  message: 'igual requires expected_participants >= 2',
}).refine(d => d.guarantee_method !== 'card' || !!d.idempotency_key, {
  message: 'card guarantee requires idempotency_key',
}).refine(d => {
  const sources = [d.stripe_payment_method_id, d.payment_method_id].filter(Boolean).length;
  return d.guarantee_method === 'card' ? sources === 1 : sources === 0;
}, {
  message: 'card guarantee requires exactly one payment source; wallet requires none',
});

// v2.18 (fracciones): reclamo de una fracción de un ítem. Valores ratificados:
// ¼ | ⅓ | ½ | entero. El server valida contra lo disponible y computa montos.
const { FRACTION_VALUES } = require('../services/itemClaims');
const fractionItem = z.object({
  item_id: uuid,
  fraction_bps: safeInt
    .refine((v) => FRACTION_VALUES.includes(v), {
      message: `fraction_bps must be one of ${FRACTION_VALUES.join('|')}`,
    })
    .default(10000),
});

const lockItems = z.object({
  item_ids: z.array(uuid).min(1).optional(),          // legacy: enteros
  items: z.array(fractionItem).min(1).optional(),     // v2.18: fracciones
}).refine((d) => !!d.item_ids !== !!d.items, {
  message: 'exactly one of item_ids or items is required',
});

const payMesa = z.object({
  payment_method_id: uuid.optional(),
  stripe_payment_method_id: stripePmId.optional(),
  // D4 (v2.16): opt-in para guardar la tarjeta tipeada al pagar (default false)
  save_payment_method: z.boolean().default(false),
  payment_type: z.enum(['card', 'apple_pay', 'google_pay', 'wallet']).default('card'),
  item_ids: z.array(uuid).max(100).default([]),
  // v2.18 (fracciones): excluyente con item_ids (que sigue = enteros)
  items: z.array(fractionItem).min(1).max(100).optional(),
  lock_tokens: z.array(lockToken).max(100).optional(),
  tip_cents: positiveCents.default(0),
  // D7 (v2.17): propina por % sobre base partes-iguales (total÷N declarados).
  // 0..10000 bps = 0..100% de su parte (tope ratificado). La cuenta la hace el
  // SERVER. Excluyente con tip_cents (el monto a mano).
  tip_bps: safeInt.min(0).max(10000).optional(),
  tip_to_staff_id: uuid.optional(),
  idempotency_key: idempotencyKey,
}).refine(d => {
  const sources = [d.payment_method_id, d.stripe_payment_method_id].filter(Boolean).length;
  if (d.payment_type === 'wallet') return sources === 0;
  if (d.payment_type === 'apple_pay' || d.payment_type === 'google_pay') {
    return !!d.stripe_payment_method_id && !d.payment_method_id;
  }
  return sources === 1;
}, { message: 'exactly one payment source is required for card; wallet requires none' })
.refine(d => d.tip_bps === undefined || !d.tip_cents, {
  message: 'tip_bps and tip_cents are mutually exclusive',
}).refine(d => !(d.items && d.item_ids.length > 0), {
  message: 'items and item_ids are mutually exclusive',
});

// PERFIL
const updateMe = z.object({
  birth_date: birthDate,
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
}).refine(d => [d.to_payme_id, d.to_email, d.to_user_id].filter(Boolean).length === 1, {
  message: 'exactly one destination is required',
});

// STAFF
// ⚠️ CONTRATO: `email` se retiró y `payme_id` pasó a ser OBLIGATORIO. El alta
// de personal por correo era un oráculo correo→identidad (ver routes/staff.js).
// Un request que mande `email` recibe 400: Zod descarta la clave no declarada
// y `payme_id` ausente falla la validación. App Frontend espeja este cambio.
const addStaff = z.object({
  payme_id: paymeId,
  display_name: z.string().min(1).max(100),
  role: z.enum(['waiter','bartender','manager','host','runner']).default('waiter'),
});
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
const queryBoolean = z.preprocess((value) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}, z.boolean());
const notificationsQuery = z.object({
  unread_only: queryBoolean.default(false),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
// G-01 (v2.21): búsqueda pública de restaurantes; limit fijo server-side (20).
const restaurantSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
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
function validateParams(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.params);
    if (!r.success) {
      return res.status(400).json({
        error: 'validation_error',
        issues: r.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.params = r.data;
    next();
  };
}

module.exports = {
  register, registerCompat, registerSchema, birthDateRequeridaEnRegistro,
  login, refreshToken, updateMe,
  attachPaymentMethod, setupIntent, setDefaultPaymentMethod, uuidIdParam,
  addFriend, searchFriends, friendRequestsQuery,
  createGroup, updateGroup, addGroupMember,
  createInvitation,
  createMesa, payMesa, lockItems,
  topupOxxo, topupCard,
  createTransfer,
  addStaff, updateStaff, setStaffShift,
  registerPushDevice,
  movementsQuery, historyQuery, walletTxQuery, notificationsQuery,
  restaurantSearchQuery,
  validateBody, validateQuery, validateParams,
};
