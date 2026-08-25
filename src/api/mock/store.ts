import { centsToDisplay, splitEqual } from '../../utils/money';
import type {
  ActiveStaff,
  AppNotification,
  DivisionSlot,
  Friend,
  Group,
  HistoryEntry,
  ItemStatus,
  MesaDetail,
  MesaStatus,
  OpenMesa,
  PaymentMethod,
  PendingInvitation,
  TransferListItem,
  User,
  WalletTransaction,
  WalletTxType,
} from '../types';

/**
 * Persona COMPLETA del mock, con el correo que `users` sí tiene en el backend.
 *
 * C3/C4 (v2.29) sacó `email` de la proyección de AMIGOS, no de la base: grupos
 * lo sigue devolviendo. El store guarda el dato y cada endpoint proyecta lo que
 * su contrato declara — igual que el backend. Si el mock lo borrara del todo,
 * mentiría en la otra dirección.
 */
export type MockPerson = Friend & { email: string };
import { MOCK_RESTAURANTS, MOCK_USER } from './seedData';

/**
 * Store persistido del mock: hace de "backend" con las MISMAS reglas del
 * contrato (garantía A-1, saldo retenido, locks, slots, expiración A-2).
 * El estado económico y su ledger idempotente se restauran juntos al recargar.
 * Identidades: 'user' (el logueado) · 'guest' (LEGACY, ver abajo) · 'other'
 *
 * ⚠️ `'guest'` ya NO la produce nadie. Antes del cierre del pago sin cuenta
 * (backend v2.32.0) la elegía la fachada cuando venía un `guestToken`; hoy la
 * fachada nunca recibe uno, porque quien entra por link se registra y canjea el
 * token por una inscripción. El tipo y sus ramas quedan durmientes e intactos.
 * (los demás comensales, simulados).
 */

export type MockIdentity = 'user' | 'guest';
type Owner = MockIdentity | 'other' | null;

/** v2.18: un reclamo fraccional vivo sobre un ítem (espeja mesa_item_claims). */
export interface MockClaim {
  who: Exclude<Owner, null>;
  fraction_bps: number;
  /** Fijado al pagar (la completadora ajusta); null mientras está locked. */
  amount_cents: number | null;
  status: 'locked' | 'paid';
}

interface MockItem {
  id: string;
  name: string;
  category: string;
  price_cents: number;
  quantity: number;
  status: ItemStatus;
  lockedBy: Owner;
  lock_expires_at: string | null;
  /** v2.18 (fracciones): tenencia por claims — la fuente de verdad. */
  claims: MockClaim[];
}

export interface MockSlot {
  slot_index: number;
  amount_cents: number;
  status: 'available' | 'claimed' | 'paid';
  claimedBy: Owner;
}

export interface MockMesa {
  id: string;
  code: string;
  restaurant: { id: string; name: string; category: string; address: string | null };
  total_cents: number;
  paid_amount_cents: number;
  tip_amount_cents: number;
  division_mode: 'consumo' | 'igual';
  expected_participants: number;
  status: MesaStatus;
  expires_at: string;
  items: MockItem[];
  slots: MockSlot[] | null;
  active_staff: ActiveStaff[];
  openedByUser: boolean;
  /** A-2: faltante capturado a la garantía al liquidar. */
  captured_shortfall_cents: number;
  guarantee_method: 'card' | 'wallet' | null;
  /**
   * G-36 (2026-08-06) · SÓLO en mesas del seed que cuentan la parte VIVA de
   * la demo: cómo relanzarlas cuando el reloj las dejó atrás. Los vencimientos
   * del seed son relativos a la PRIMERA carga y el estado persiste: a los
   * ~30-45 min de sesión la demo se pudría entera y sólo la curaba un reset
   * manual que nada sugería. Al hidratar, una mesa con esto puesto y NUNCA
   * TOCADA por el usuario vuelve a su estado sembrado con el reloj adelante.
   * Las tocadas y las creadas por el usuario no se reescriben JAMÁS, y
   * PA-1099 no lo lleva: su historia ES estar cerrada (A-2).
   */
  seedRelanzable?: { status: MesaStatus; expiraEnMs: number };
}

export interface MockIdemEntry {
  hash: string;
  response: unknown;
}

export interface MockState {
  user: User;
  balance_cents: number;
  held_balance_cents: number;
  clabe: string | null;
  paymentMethods: PaymentMethod[];
  friends: MockPerson[];
  /**
   * Personas que existen en PayMe y NO son mis amigas. Hace de tabla `users`
   * para que `mockAddFriend` pueda fallar en silencio como el backend real.
   */
  directory: MockPerson[];
  /**
   * OLA 3C: solicitudes de amistad pendientes. `direction` es desde MI punto de
   * vista — `incoming` me la mandaron, `outgoing` la mandé yo. El `id` es el de
   * la SOLICITUD, nunca el de la persona: en el backend confundirlos hacía que
   * aceptar diera 404 siempre.
   */
  friendRequests: Array<{
    id: string;
    direction: 'incoming' | 'outgoing';
    person: MockPerson;
    requested_at: string;
  }>;
  /** Ids de usuario que YO bloqueé. */
  blockedUserIds: string[];
  groups: Array<Group & { memberIds: string[] }>;
  mesas: MockMesa[];
  /** GET /account/history: pagos propios en mesas (pantalla Mesas). */
  history: HistoryEntry[];
  walletTx: WalletTransaction[];
  transfers: TransferListItem[];
  notifications: AppNotification[];
  pendingInvitations: PendingInvitation[];
  /**
   * CIERRE DEL PAGO SIN CUENTA · tokens de link emitidos → código de su mesa.
   *
   * Existe para que el mock **no sea permisivo**. Sin esto, `accept-link`
   * tendría que aceptar cualquier string, y el mock enseñaría que todo link
   * sirve: el 403 quedaría inverificable a mano. Es exactamente la forma en que
   * un mock permisivo ya le escondió un defecto vivo a este repo.
   *
   * En el backend el token nombra su mesa (`resolveLinkToken` → `mesa_id`).
   * Acá se replica esa propiedad, que es la que importa.
   */
  linkTokens: Record<string, string>;
  /**
   * Mesas a las que el usuario se sumó CANJEANDO un link (`accept-link`).
   * Espeja las filas de `mesa_participants` que crea el canje.
   *
   * **Límite declarado:** el mock NO usa esto como gate de lectura. El backend
   * sí exige participación (`requireMesaParticipant`), pero el mock ya dejaba
   * ver cualquier mesa sembrada desde antes de este cambio, y volverlo
   * fail-closed toca el acceso a TODAS las mesas de la demo. Es otro cambio —
   * el mismo criterio con el que el emisor no borró sus ramas de invitado en el
   * commit del cierre. Lo que esto sí acredita es que el canje INSCRIBE.
   */
  joinedMesaCodes: string[];
  /** Debe persistir junto a las mutaciones económicas para que reload no cobre de nuevo. */
  idempotency: Record<string, MockIdemEntry>;
}

let seq = 0;
export function mockId(prefix: string): string {
  seq += 1;
  return `${prefix}0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const STAFF: ActiveStaff[] = [
  { id: mockId('e'), display_name: 'Carlos', role: 'waiter' },
  { id: mockId('e'), display_name: 'Lupita', role: 'waiter' },
  { id: mockId('e'), display_name: 'Diego', role: 'bartender' },
];

function seedItems(): MockItem[] {
  const mk = (
    name: string,
    price: number,
    status: ItemStatus = 'available',
    lockedBy: Owner = null,
    quantity = 1,
  ): MockItem => ({
    id: mockId('d'),
    name,
    category: 'other',
    price_cents: price,
    quantity,
    status,
    lockedBy,
    lock_expires_at: status === 'locked' ? iso(10 * 60_000) : null,
    claims:
      status === 'paid'
        ? [{ who: lockedBy ?? 'other', fraction_bps: 10000, amount_cents: price * quantity, status: 'paid' }]
        : status === 'locked'
          ? [{ who: lockedBy ?? 'other', fraction_bps: 10000, amount_cents: null, status: 'locked' }]
          : [],
  });
  return [
    mk('Tagliatelle Bolognese', 19500),
    mk('Risotto ai Funghi', 22000),
    mk('Pizza Margherita', 18500, 'paid', 'other'),
    mk('Tiramisú', 7000, 'paid', 'other', 2),
    mk('Agua mineral', 4000, 'locked', 'other'),
    mk('Vino tinto (copa)', 6000),
  ];
}

/**
 * Ítems de la mesa IGUAL del seed (auditoría 2026-08-06, H-14): `items: []`
 * violaba el contrato — `POST /mesas` exige al menos un ítem
 * (`schemas/index.js:195`, `.min(1)` sin optional) — y modelaba un estado
 * IMPOSIBLE en producción, que esta noche hizo perder tiempo buscando un
 * atrape que en real no existe. Suman exactamente `igualTotal` (62000).
 */
function seedItemsIgual(menu: ReadonlyArray<readonly [string, number]>): MockItem[] {
  return menu.map(([name, price]) => ({
    id: mockId('d'),
    name,
    category: 'other',
    price_cents: price,
    quantity: 1,
    status: 'available',
    lockedBy: null,
    lock_expires_at: null,
    claims: [],
  }));
}

function seedMesas(): MockMesa[] {
  const parolaccia = MOCK_RESTAURANTS[0];
  const hanzo = MOCK_RESTAURANTS[1];
  const consumoItems = seedItems();
  const paid = consumoItems
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + i.price_cents * i.quantity, 0);

  const igualTotal = 62000;
  const igualParts = splitEqual(igualTotal, 4);
  const slots: MockSlot[] = igualParts.map((amount, idx) => ({
    slot_index: idx,
    amount_cents: amount,
    status: idx < 2 ? 'paid' : 'available',
    claimedBy: idx < 2 ? 'other' : null,
  }));

  return [
    {
      id: mockId('c'),
      code: 'PA-2847',
      restaurant: { id: parolaccia.id, name: parolaccia.name, category: parolaccia.category, address: parolaccia.address },
      total_cents: 84000,
      paid_amount_cents: paid,
      tip_amount_cents: 0,
      division_mode: 'consumo',
      expected_participants: 4,
      status: 'partially_paid',
      expires_at: iso(29 * 60_000),
      seedRelanzable: { status: 'partially_paid', expiraEnMs: 29 * 60_000 },
      items: consumoItems,
      slots: null,
      active_staff: STAFF,
      openedByUser: true,
      captured_shortfall_cents: 0,
      guarantee_method: 'card',
    },
    {
      id: mockId('c'),
      code: 'PA-3121',
      restaurant: { id: hanzo.id, name: hanzo.name, category: hanzo.category, address: hanzo.address },
      total_cents: igualTotal,
      paid_amount_cents: igualParts[0] + igualParts[1],
      tip_amount_cents: 0,
      division_mode: 'igual',
      expected_participants: 4,
      status: 'partially_paid',
      expires_at: iso(12 * 60_000),
      seedRelanzable: { status: 'partially_paid', expiraEnMs: 12 * 60_000 },
      items: seedItemsIgual([
        ['Omakase para dos', 26000],
        ['Sashimi mixto', 14000],
        ['Tempura de camarón', 12000],
        ['Sake (botella)', 10000],
      ]),
      slots,
      active_staff: STAFF,
      openedByUser: true,
      captured_shortfall_cents: 0,
      // OLA 5C (b): resembrada como TARJETA. Una mesa con garantía wallet
      // enseñaba un riel que no existe a quien usa el mock para entender el
      // producto — el mismo argumento por el que el mock replica la ceguera de
      // C2. El mock no es un registro histórico y no tiene obligaciones legacy
      // que preservar: ahí no hay plata de nadie.
      guarantee_method: 'card',
    },
    // Mesa de OTRO organizador (Sofía) — la invitación in-app pendiente apunta acá.
    {
      id: mockId('c'),
      code: 'PA-4520',
      restaurant: { id: hanzo.id, name: hanzo.name, category: hanzo.category, address: hanzo.address },
      total_cents: 96000,
      paid_amount_cents: 0,
      tip_amount_cents: 0,
      division_mode: 'igual',
      expected_participants: 3,
      status: 'open',
      expires_at: iso(26 * 60_000),
      seedRelanzable: { status: 'open', expiraEnMs: 26 * 60_000 },
      // Mismo defecto que tenía PA-3121: items:[] viola el .min(1) de
      // POST /mesas — un seed no modela estados imposibles. Suman 96000.
      items: seedItemsIgual([
        ['Barco de sushi (grande)', 42000],
        ['Ramen tonkotsu', 22000],
        ['Gyozas de cerdo', 18000],
        ['Té verde (tetera)', 14000],
      ]),
      slots: splitEqual(96000, 3).map((amount, idx) => ({
        slot_index: idx,
        amount_cents: amount,
        status: 'available' as const,
        claimedBy: null,
      })),
      active_staff: STAFF,
      openedByUser: false,
      captured_shortfall_cents: 0,
      guarantee_method: 'card',
    },
    // A-2 demo: mesa que expiró sin completarse; la garantía cubrió el faltante.
    // `completed` A PROPÓSITO (auditoría 2026-08-06): la pantalla A-2 rica
    // ("Se cerró por tiempo · Cubrió tu garantía $X") sólo se renderiza con el
    // único estado que ACREDITA cierre y dispersión — con `settled` cae en la
    // vaga honesta "Mesa liquidada", y el atajo de demo del Historial prometía
    // una historia que nunca mostraba. Venció hace una hora; en demo, el
    // proceso de cierre ya terminó.
    {
      id: mockId('c'),
      code: 'PA-1099',
      restaurant: { id: parolaccia.id, name: parolaccia.name, category: parolaccia.category, address: parolaccia.address },
      total_cents: 84000,
      paid_amount_cents: 63000,
      tip_amount_cents: 9000,
      division_mode: 'igual',
      expected_participants: 4,
      status: 'completed',
      expires_at: iso(-60 * 60_000),
      items: [],
      slots: splitEqual(84000, 4).map((amount, idx) => ({
        slot_index: idx,
        amount_cents: amount,
        status: idx < 3 ? 'paid' : 'available',
        claimedBy: idx < 3 ? 'other' : null,
      })),
      active_staff: STAFF,
      openedByUser: true,
      captured_shortfall_cents: 21000,
      // wallet (no card): el movimiento sembrado del faltante debita el saldo,
      // y con garantía de tarjeta el wallet no se toca. Así cierran los números.
      guarantee_method: 'wallet',
    },
  ];
}

/**
 * DURMIENTE (OLA 5C · b). El riel saldo está apagado, así que el mock ya no
 * siembra movimientos de saldo. La función NO se borra —la ratificación manda
 * conservar código, schema e historia— y por eso se exporta: sin eso el
 * compilador la marca como muerta y la única salida sería eliminarla, que es
 * justo lo que no hay que hacer.
 *
 * Se vuelve a conectar en `initialState` el día que exista gate IFPE,
 * ratificación nueva y una capability publicada por el BACKEND.
 */
export function seedWalletTx(): WalletTransaction[] {
  const mk = (
    type: WalletTxType,
    amount: number,
    after: number,
    description: string,
    daysAgo: number,
  ): WalletTransaction => ({
    id: mockId('f'),
    type,
    amount_cents: amount,
    amount_display: centsToDisplay(Math.abs(amount)),
    sign: amount >= 0 ? 'credit' : 'debit',
    balance_after_cents: after,
    balance_after_display: centsToDisplay(after),
    related: null,
    description,
    metadata: null,
    date: iso(-daysAgo * 24 * 60 * 60_000),
  });
  // Cadena de saldos coherente, del más nuevo al más viejo, cerrando en
  // balance_cents = 125000:
  //   3000 → +100000 = 103000 → +50000 = 153000 → −15000 = 138000
  //        → +8000 = 146000 → −21000 = 125000
  return [
    mk('payment_mesa', -21000, 125000, 'Faltante mesa PA-1099 (garantía)', 0),
    mk('transfer_in', 8000, 146000, 'Transferencia de Juan López', 0),
    mk('transfer_out', -15000, 138000, 'Transferencia a Sofía', 1),
    mk('topup_oxxo', 50000, 153000, 'Carga de saldo vía OXXO', 3),
    mk('topup_spei', 100000, 103000, 'Abono por SPEI', 6),
  ];
}

function seedFriends(): MockPerson[] {
  const mk = (payme: string, first: string, last: string): MockPerson => ({
    id: mockId('a'),
    payme_id: `payme_mx_${payme}`,
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`,
    // El mock conserva el correo como lo conserva `users` en el backend: lo que
    // C3/C4 sacó es la PROYECCIÓN en amigos, no el dato. Grupos sigue
    // devolviéndolo (contract-mirror/routes/groups.js), así que el store tiene
    // que poder alimentar las dos formas.
    email: `${payme}@mail.com`,
    added_at: iso(-30 * 24 * 60 * 60_000),
  });
  // 'leop': el formato del contrato exige 4 chars (schemas paymeId) — 'leo' lo violaba.
  return [mk('sofi', 'Sofía', 'Fernández'), mk('juan', 'Juan', 'López'), mk('maru', 'María', 'Ruiz'), mk('leop', 'Leo', 'Paz')];
}

/**
 * Personas que EXISTEN en PayMe sin ser amigas mías.
 *
 * El mock no tenía tabla `users`: sólo existían mis amigos, así que
 * `mockAddFriend` inventaba una persona para cualquier texto que se tipeara y
 * la solicitud saliente aparecía SIEMPRE. Eso hacía invisible en la demo el
 * comportamiento real —el backend sólo inserta la fila si el destino existe y
 * está activo— y con él, el oráculo que ese comportamiento produce.
 *
 * Un mock que diverge del contrato hacia el lado permisivo convierte la
 * verificación manual en teatro: mirás la pantalla, funciona, y lo que mirabas
 * no era el sistema.
 */
function seedDirectory(): MockPerson[] {
  const mk = (payme: string, first: string, last: string): MockPerson => ({
    id: mockId('a'),
    payme_id: `payme_mx_${payme}`,
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`,
    email: `${payme}@mail.com`,
    // Sólo significa algo cuando la persona pasa a `friends`; ahí se pisa.
    added_at: '',
  });
  // Valentina es la misma que manda la solicitud entrante sembrada: agregarla
  // por correo debe disparar el camino RECÍPROCO del contrato (pedirle a quien
  // ya me pidió equivale a aceptar), que es el más difícil de ver a mano.
  return [mk('vale', 'Valentina', 'Ríos'), mk('nico', 'Nicolás', 'Salas')];
}

/**
 * Avisos del riel SALDO. **Durmiente: nada los llama.**
 *
 * OLA 5C(b) apagó saldo, movimientos y garantía wallet del mock con el criterio
 * de que la demo es un artefacto de enseñanza — y dejó afuera el inbox, que
 * seguía mostrando "Se acreditaron $500.00 a tu saldo PayMe" en `#/avisos`.
 * Se conservan acá, sin llamador, por la misma regla que `seedWalletTx`: el
 * riel se apaga, no se borra.
 *
 * ⚠️ NO confundir con la ola (d): allá el problema es que el BACKEND REAL sigue
 *    emitiendo `topup_succeeded` y `transfer_received`. Eso no se arregla desde
 *    acá y sigue frenado esperando al emisor.
 */
export function seedWalletNotifications(): AppNotification[] {
  return [
    {
      id: mockId('f'),
      type: 'transfer_received',
      title: null,
      body: 'Juan López te envió $80.00',
      payload: { amount_cents: 8000, sender_name: 'Juan López' },
      related_entity_type: 'transfer',
      related_entity_id: null,
      read_at: null,
      created_at: iso(-3 * 60 * 60_000),
    },
    {
      id: mockId('f'),
      type: 'topup_succeeded',
      title: null,
      body: 'Se acreditaron $500.00 a tu saldo PayMe',
      payload: { amount_cents: 50000, method: 'oxxo' },
      related_entity_type: 'topup',
      related_entity_id: null,
      read_at: iso(-2 * 24 * 60 * 60_000),
      created_at: iso(-3 * 24 * 60 * 60_000),
    },
  ];
}

/**
 * Tipos de aviso del riel saldo: sirven al apagado del MOCK y a su test de
 * recaída. **No es una lista nuestra: es la del emisor.**
 *
 * Espeja exactamente `WALLET_RAIL_TYPES` de
 * `contract-mirror/services/notifications.js`, donde App Backend dejó de
 * crearlos (`5e210fd`). Un test lee el espejo como texto y falla si los dos
 * juegos se separan — la lista a mano se había quedado corta justamente acá:
 * faltaba `topup_failed`, así que un estado persistido de la demo lo conservaba.
 *
 * ⚠️ `tip_received` NO está, y es deliberado del emisor: avisa a un mesero
 * —persona identificada— de plata acreditada a su nombre, que es obligación
 * legacy. Agregarlo acá por analogía sería ocultarle a alguien un movimiento
 * propio.
 */
export const WALLET_NOTIFICATION_TYPES = [
  'topup_succeeded', 'topup_failed', 'topup_pending',
  'transfer_received', 'transfer_sent',
] as const;

function seedNotifications(mesas: MockMesa[]): {
  notifications: AppNotification[];
  pendingInvitations: PendingInvitation[];
} {
  const invitedMesa = mesas.find((m) => m.code === 'PA-4520');
  const shortfallMesa = mesas.find((m) => m.code === 'PA-1099');
  const notifications: AppNotification[] = [
    // Acá vivían `transfer_received` y `topup_succeeded`. Se mudaron a
    // `seedWalletNotifications()`, durmiente: el riel saldo está apagado y el
    // inbox no es una excepción al apagado.
    {
      id: mockId('f'),
      type: 'mesa_shortfall_charged',
      title: null,
      body: 'Se cobró el faltante de la mesa ($210.00) a tu garantía.',
      payload: shortfallMesa ? {
        mesa_id: shortfallMesa.id,
        mesa_code: shortfallMesa.code,
        shortfall_cents: 21000,
        detail_available: true,
      } : { shortfall_cents: 21000 },
      related_entity_type: 'mesa',
      related_entity_id: shortfallMesa?.id ?? null,
      read_at: iso(-20 * 60 * 60_000),
      created_at: iso(-22 * 60 * 60_000),
    },
  ];
  const pendingInvitations: PendingInvitation[] = invitedMesa
    ? [
        {
          id: mockId('f'),
          mesa_id: invitedMesa.id,
          invitation_type: 'in_app',
          status: 'pending',
          // Atada al reloj de SU MESA, no a las 24 h del contrato (auditoría
          // 2026-08-06): con 24 h acá y la mesa muriendo a los ~26 min, la
          // tarjeta "Sumarme" sobrevivía HORAS a la mesa — éxito seguido de
          // "Mesa liquidada". Una invitación de demo no puede prometer más
          // vida que la mesa que invita. (Si el emisor debería atarlas también
          // en el riel real es pregunta de contrato, elevada.)
          expires_at: invitedMesa.expires_at,
          created_at: iso(-8 * 60_000),
          mesa_code: invitedMesa.code,
          restaurant_name: invitedMesa.restaurant.name,
          inviter_first_name: 'Sofía',
          inviter_last_name: 'Fernández',
          inviter_payme_id: 'payme_mx_sofi',
          // v2.45.0 · valores del momento del seed. El GET los RE-COMPUTA en
          // vivo con mesaViva(): esto es sólo el punto de partida.
          mesa_joinable: true,
          mesa_status: invitedMesa.status,
        },
      ]
    : [];
  return { notifications, pendingInvitations };
}

function seedState(): MockState {
  const friends = seedFriends();
  const directory = seedDirectory();
  const mesas = seedMesas();
  const { notifications, pendingInvitations } = seedNotifications(mesas);
  return {
    user: MOCK_USER,
    // Riel saldo apagado: el mock no siembra saldo. Los campos quedan en el
    // schema (durmiente), en cero.
    balance_cents: 0,
    held_balance_cents: 0,
    clabe: null,
    // D4 (contrato v2.16 publicado): id = uuid interno + stripe_payment_method_id
    // = pm_… . Dos tarjetas para que el selector de garantía/pago tenga qué elegir.
    paymentMethods: [
      {
        id: mockId('b'),
        stripe_payment_method_id: 'pm_mock_visa4532',
        brand: 'visa',
        bank_name: 'Santander',
        type: 'credit',
        last_four: '4532',
        exp_month: 8,
        exp_year: 2028,
        is_default: true,
        display: 'Santander · Crédito · •••• 4532',
      },
      {
        id: mockId('b'),
        stripe_payment_method_id: 'pm_mock_mc8821',
        brand: 'mastercard',
        bank_name: 'BBVA',
        type: 'debit',
        last_four: '8821',
        exp_month: 3,
        exp_year: 2027,
        is_default: false,
        display: 'BBVA · Débito · •••• 8821',
      },
    ],
    friends,
    directory,
    // Una solicitud entrante sembrada: sin esto la pantalla nueva arranca vacía
    // y no se puede ver el flujo de aceptar en la demo. La persona es LA MISMA
    // del directorio (mismo `id`), para que agregarla por correo dispare el
    // camino recíproco del contrato en vez de crear una segunda pendiente.
    friendRequests: [
      {
        id: mockId('f'),
        direction: 'incoming' as const,
        person: directory[0],
        requested_at: iso(-2 * 60 * 60_000),
      },
    ],
    blockedUserIds: [],
    groups: [
      {
        id: mockId('a'),
        name: 'Familia',
        icon: '👨‍👩‍👧',
        created_at: iso(-60 * 24 * 60 * 60_000),
        member_count: 2,
        memberIds: [friends[0].id, friends[3].id],
      },
      {
        id: mockId('a'),
        name: 'Trabajo',
        icon: '💼',
        created_at: iso(-20 * 24 * 60 * 60_000),
        member_count: 2,
        memberIds: [friends[1].id, friends[2].id],
      },
    ],
    mesas,
    // Historial de mesas pagadas (shape de GET /account/history): alimenta la
    // pantalla Mesas. mockPayMesa agrega una entrada por cada pago propio.
    history: [
      {
        id: mockId('h'),
        amount_cents: 22425,
        date: iso(-3 * 24 * 60 * 60_000),
        mesa_code: 'PA-8712',
        mesa_status: 'completed',
        restaurant: MOCK_RESTAURANTS[0].name,
        category: MOCK_RESTAURANTS[0].category,
      },
      {
        id: mockId('h'),
        amount_cents: 41800,
        date: iso(-9 * 24 * 60 * 60_000),
        mesa_code: 'PA-6603',
        mesa_status: 'completed',
        restaurant: MOCK_RESTAURANTS[1].name,
        category: MOCK_RESTAURANTS[1].category,
      },
      {
        id: mockId('h'),
        amount_cents: 15650,
        date: iso(-16 * 24 * 60 * 60_000),
        mesa_code: 'PA-5218',
        mesa_status: 'completed',
        restaurant: MOCK_RESTAURANTS[0].name,
        category: MOCK_RESTAURANTS[0].category,
      },
    ],
    // Sin riel saldo no hay movimientos de saldo que mostrar. El seed queda
    // en el árbol (durmiente); lo que se apaga es la siembra.
    walletTx: [],
    notifications,
    pendingInvitations,
    linkTokens: {},
    joinedMesaCodes: [],
    idempotency: {},
    transfers: [
      {
        id: mockId('f'),
        amount_cents: 8000,
        amount_display: centsToDisplay(8000),
        concept: 'Los tacos',
        status: 'completed',
        completed_at: iso(-3 * 60 * 60_000),
        created_at: iso(-3 * 60 * 60_000),
        direction: 'received',
        counterparty_payme_id: 'payme_mx_juan',
        counterparty_name: 'Juan López',
      },
      {
        id: mockId('f'),
        amount_cents: 15000,
        amount_display: centsToDisplay(15000),
        concept: 'Cine',
        status: 'completed',
        completed_at: iso(-24 * 60 * 60_000),
        created_at: iso(-24 * 60 * 60_000),
        direction: 'sent',
        counterparty_payme_id: 'payme_mx_sofi',
        counterparty_name: 'Sofía Fernández',
      },
    ],
  };
}

// ─── Persistencia de la demo ───────────────────────────────
// Sin esto, recargar la página borraba mesas creadas, pagos, saldo y amigos:
// el evaluador perdía todo su recorrido al refrescar.

const STORAGE_KEY = 'payme_mock_state_v1';

/**
 * G-36 · ¿el usuario tocó esta mesa? Lo tocado NO se reescribe jamás: un pago
 * propio, un canje, un casillero o un consumo reclamado son historia de la
 * persona, y relanzarle la mesa abajo sería el mock inventando pasado. Los
 * pagos del seed histórico usan códigos que no existen en `mesas` (PA-8712…),
 * así que cualquier fila de `history` con un código VIVO es del usuario.
 */
function tocadaPorElUsuario(st: MockState, mesa: MockMesa): boolean {
  // 'guest' cuenta como tocada: es LA MISMA PERSONA en el mismo teléfono —
  // el camino de quien entraba por link antes del cierre v2.32.0. Sus pagos
  // dejaron `claimedBy: 'guest'` y claims de 'guest', y NO escribieron fila de
  // `history` (mockApi excluye guest) ni `joinedMesaCodes`. Contar sólo 'user'
  // hacía parecer intactas mesas que la persona pagó.
  const mio = (quien: unknown) => quien === 'user' || quien === 'guest';
  const items = Array.isArray(mesa.items) ? mesa.items : [];
  const slots = Array.isArray(mesa.slots) ? mesa.slots : [];
  return (
    (Array.isArray(st.history) && st.history.some((h) => h?.mesa_code === mesa.code)) ||
    (Array.isArray(st.joinedMesaCodes) && st.joinedMesaCodes.includes(mesa.code)) ||
    slots.some((s) => mio(s?.claimedBy)) ||
    items.some(
      (i) => mio(i?.lockedBy) || (Array.isArray(i?.claims) && i.claims.some((c) => mio(c?.who))),
    )
  );
}

/**
 * G-36 · legacy (ORDEN 1-C·B, 2026-08-06) · IDENTIDAD RECONOCIBLE DEL SEED.
 *
 * Tabla EXPLÍCITA en vez de leer `seedMesas()`: la definición del seed cambió
 * entre versiones —`guarantee_method` de PA-3121 fue `wallet` y hoy es `card`,
 * los `items` de las mesas iguales fueron `[]`, el `status` de PA-1099 fue
 * `settled`— así que compararse contra el seed de HOY rechazaría justo a los
 * estados viejos que hay que rescatar. Acá se fija el subconjunto que **nunca
 * cambió en ninguna versión**, y un test lo mantiene alineado con el seed.
 *
 * `PA-1099` NO está: su historia ES estar cerrada (A-2), y pasa todos los
 * filtros de "intacta" porque nadie la toca nunca. Sin esta lista blanca,
 * cualquier migración razonable la revive y borra la pantalla de la garantía.
 */
const SEED_LEGACY_RELANZABLE: Record<
  string,
  {
    readonly status: MesaStatus;
    readonly expiraEnMs: number;
    readonly total_cents: number;
    readonly division_mode: 'consumo' | 'igual';
    readonly expected_participants: number;
    readonly restaurante: string;
    readonly openedByUser: boolean;
    /** El de HOY. Un legacy con `wallet` NO se migra: ver `migrarSeedLegacy`. */
    readonly guarantee_method: 'card' | 'wallet' | null;
    /** Lo que pagaron OTROS en el seed. Si subió, pagó el usuario. */
    readonly paid_amount_cents: number;
  }
> = {
  'PA-2847': {
    status: 'partially_paid',
    expiraEnMs: 29 * 60_000,
    total_cents: 84000,
    division_mode: 'consumo',
    expected_participants: 4,
    restaurante: 'La Parolaccia',
    openedByUser: true,
    guarantee_method: 'card',
    paid_amount_cents: 32500,
  },
  'PA-3121': {
    status: 'partially_paid',
    expiraEnMs: 12 * 60_000,
    total_cents: 62000,
    division_mode: 'igual',
    expected_participants: 4,
    restaurante: 'Hanzo Sushi',
    openedByUser: true,
    guarantee_method: 'card',
    paid_amount_cents: 31000,
  },
  'PA-4520': {
    status: 'open',
    expiraEnMs: 26 * 60_000,
    total_cents: 96000,
    division_mode: 'igual',
    expected_participants: 3,
    restaurante: 'Hanzo Sushi',
    openedByUser: false,
    guarantee_method: 'card',
    paid_amount_cents: 0,
  },
};

/** Sólo para el test que mantiene la tabla alineada con el seed vigente. */
export const SEED_LEGACY_CODES = Object.keys(SEED_LEGACY_RELANZABLE);
export function plantillaLegacy(code: string) {
  return SEED_LEGACY_RELANZABLE[code];
}

/**
 * G-36 · legacy · **le pone la marca a lo que es INEQUÍVOCAMENTE del seed y
 * nadie tocó.** Corre ANTES del relanzamiento y sólo sobre mesas SIN marca:
 * un estado persistido anterior a `67fc0de` no la tiene, y sin esto queda
 * podrido para siempre — que es justo el estado que hay en los dispositivos
 * existentes, incluido el teléfono de Mati.
 *
 * Nueve condiciones, cada una por un daño concreto y medido:
 *
 *  1. **Código en la lista blanca.** La firma sola no alcanza:
 *     `materializeDemoMesa` fabrica mesas con la firma EXACTA de PA-2847 para
 *     cualquier código, y el ticket del scan es el mismo — marcarlas por firma
 *     reescribiría mesas del usuario.
 *  2. **Código ÚNICO en el estado.** Los códigos nuevos salen de
 *     `PA-<1000..9999>` sin chequeo de unicidad, así que una mesa propia puede
 *     nacer literalmente "PA-2847". Si hay dos, no se puede acreditar cuál es
 *     cuál: no se migra ninguna.
 *  3. **Firma inmutable idéntica** (total, modo, comensales, restaurante,
 *     `openedByUser`). Distingue además la materializada (`false`) de PA-2847
 *     (`true`).
 *  4. **`paid_amount_cents` igual al del seed.** Es el único campo económico
 *     que el vencimiento NO ensucia y que un pago propio SIEMPRE mueve.
 *  5. **`guarantee_method` igual al de hoy (`card`).** Un legacy de PA-3121
 *     trae `wallet`, y relanzarla la haría vencer de nuevo cada sesión
 *     **debitando saldo cada vez** (`settleIfExpired`) hasta dejarlo negativo.
 *     No se migra: se conserva y se ofrece el reset.
 *  6. **Nadie la tocó** (`tocadaPorElUsuario`, ya con 'guest' adentro).
 *  7. **Si el seed le sembró una invitación, tiene que seguir ahí.** En legacy
 *     aceptar sólo la borraba del array sin dejar rastro: su ausencia es la
 *     única huella de que el usuario aceptó PA-4520.
 *  8. **La plantilla sale de la TABLA**, nunca del estado persistido — que
 *     está sucio por definición (`completed` + `expires_at` pasado). Derivarla
 *     de ahí grabaría una marca basura, y la marca se PERSISTE: quedaría el
 *     teléfono podrido *y* marcado, peor que hoy.
 *  9. **Nada de esto puede lanzar.** Todo `loadPersisted` vive en un
 *     `try/catch` que descarta el estado ENTERO: un `.length` sobre un
 *     `undefined` le borraría al usuario mesas, tarjetas, amigos e historial
 *     — un daño mucho mayor que el que esto viene a curar.
 */
function migrarSeedLegacy(st: MockState): void {
  const mesas = Array.isArray(st.mesas) ? st.mesas : [];
  const cuantas = new Map<string, number>();
  for (const m of mesas) {
    if (m && typeof m.code === 'string') cuantas.set(m.code, (cuantas.get(m.code) ?? 0) + 1);
  }
  const invitaciones = Array.isArray(st.pendingInvitations) ? st.pendingInvitations : [];

  for (const mesa of mesas) {
    if (!mesa || typeof mesa.code !== 'string') continue;
    if (mesa.seedRelanzable) continue; // ya migrada o nacida con la marca
    const plantilla = SEED_LEGACY_RELANZABLE[mesa.code];
    if (!plantilla) continue; // no es del seed relanzable (PA-1099 incluida)
    if ((cuantas.get(mesa.code) ?? 0) !== 1) continue; // código duplicado: ambiguo
    const firmaIgual =
      mesa.total_cents === plantilla.total_cents &&
      mesa.division_mode === plantilla.division_mode &&
      mesa.expected_participants === plantilla.expected_participants &&
      mesa.restaurant?.name === plantilla.restaurante &&
      mesa.openedByUser === plantilla.openedByUser &&
      mesa.guarantee_method === plantilla.guarantee_method &&
      mesa.paid_amount_cents === plantilla.paid_amount_cents;
    if (!firmaIgual) continue;
    if (tocadaPorElUsuario(st, mesa)) continue;
    // La invitación sembrada es parte de la historia de PA-4520: si no está,
    // el usuario la aceptó (en legacy eso no dejaba otro rastro).
    const sembradaParaEstaMesa = mesa.code === 'PA-4520';
    if (sembradaParaEstaMesa && !invitaciones.some((i) => i?.mesa_code === mesa.code)) continue;

    mesa.seedRelanzable = { status: plantilla.status, expiraEnMs: plantilla.expiraEnMs };
    // H-14: los legacy de las mesas IGUALES traen `items: []`, un estado que
    // `POST /mesas` prohíbe. Revivirlas con el ticket vacío resucitaría el
    // defecto; se backfillea sólo si está vacío, nunca se pisan ítems reales.
    if (plantilla.division_mode === 'igual' && (!Array.isArray(mesa.items) || mesa.items.length === 0)) {
      mesa.items = itemsIgualPara(mesa.code);
    }
  }
}

/** Los ítems del seed vigente para una mesa igual, o `[]` si no la conocemos. */
function itemsIgualPara(code: string): MockItem[] {
  if (code === 'PA-3121') {
    return seedItemsIgual([
      ['Omakase para dos', 26000],
      ['Sashimi mixto', 14000],
      ['Tempura de camarón', 12000],
      ['Sake (botella)', 10000],
    ]);
  }
  if (code === 'PA-4520') {
    return seedItemsIgual([
      ['Barco de sushi (grande)', 42000],
      ['Ramen tonkotsu', 22000],
      ['Gyozas de cerdo', 18000],
      ['Té verde (tetera)', 14000],
    ]);
  }
  return [];
}

/**
 * ¿Quedó demo del seed que NO se pudo rescatar? Es la mitad honesta de la
 * migración: lo que no se acredita intacto **se conserva**, y entonces hay que
 * poder ofrecer la salida en vez de dejar una demo muerta sin explicación.
 *
 * Verdadero cuando no queda NINGUNA mesa viva y hay al menos una del seed
 * muerta. Sólo lo consume la UI del mock.
 */
export function demoSeedIrrecuperable(): boolean {
  const mesas = Array.isArray(state.mesas) ? state.mesas : [];
  const hayViva = mesas.some((m) => m?.status === 'open' || m?.status === 'partially_paid');
  if (hayViva) return false;
  return mesas.some((m) => m && SEED_LEGACY_RELANZABLE[m.code] !== undefined);
}

/**
 * G-36 (2026-08-06, orden 2-A.4) · EL SEED QUE ENVEJECE SE RE-SIEMBRA SOLO.
 *
 * Corre UNA vez, al hidratar desde persistencia — nunca sobre un seed fresco
 * ni en caliente: relanzar con la app viva le cambiaría la mesa a alguien
 * mirándola. Sólo mesas con `seedRelanzable` (la parte viva de la demo) cuyo
 * reloj quedó atrás y que el usuario NUNCA tocó vuelven a su estado sembrado
 * con el vencimiento adelante. La invitación del seed viaja atada al reloj de
 * su mesa, como siempre. PA-1099 no se toca (su historia ES estar cerrada) y
 * las mesas del usuario tampoco (no llevan la marca).
 *
 * La expiración REAL sigue funcionando igual dentro de una sesión: esto no
 * congela relojes — los relanza entre sesiones, que es cuando la demo
 * aparecía podrida sin que nada lo explicara ni lo curara.
 */
function relanzarSeedVencido(st: MockState): void {
  const ahora = Date.now();
  for (const mesa of st.mesas) {
    if (!mesa.seedRelanzable) continue;
    if (new Date(mesa.expires_at).getTime() > ahora) continue; // reloj vigente
    if (tocadaPorElUsuario(st, mesa)) continue;
    mesa.status = mesa.seedRelanzable.status;
    mesa.expires_at = new Date(ahora + mesa.seedRelanzable.expiraEnMs).toISOString();
    mesa.captured_shortfall_cents = 0;
    for (const inv of st.pendingInvitations) {
      if (inv.mesa_code === mesa.code) inv.expires_at = mesa.expires_at;
    }
  }
}

function loadPersisted(): MockState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockState;
    // Validación mínima: si el shape no cierra, se descarta y se re-siembra.
    if (!parsed || !Array.isArray(parsed.mesas) || typeof parsed.balance_cents !== 'number') {
      return null;
    }
    // Migración 0.21 (fracciones): items persistidos sin `claims` — backfill
    // desde el estado legacy (paid entero = claim 10000 pagado).
    for (const mesa of parsed.mesas) {
      // Tolerante a propósito (ORDEN 1-C·B): esta migración iteraba
      // `mesa.items` a ciegas, y una sola fila podrida —`items` que no es
      // array, una mesa `null`— lanzaba y hacía que el `catch` de abajo
      // DESCARTARA EL ESTADO ENTERO: mesas, tarjetas, amigos, historial y
      // ledger de idempotencia, en silencio y sin aviso. Perder todo por una
      // fila mala es mucho peor que conservar la fila mala. Lo encontró el
      // test del estado legacy, no una lectura.
      if (!mesa || !Array.isArray(mesa.items)) continue;
      for (const it of mesa.items) {
        if (!Array.isArray(it.claims)) {
          it.claims =
            it.status === 'paid'
              ? [{ who: it.lockedBy ?? 'user', fraction_bps: 10000, amount_cents: it.price_cents * it.quantity, status: 'paid' }]
              : it.status === 'locked' && it.lockedBy
                ? [{ who: it.lockedBy, fraction_bps: 10000, amount_cents: null, status: 'locked' }]
                : [];
        }
      }
    }
    // Migración 0.14: los estados persistidos previos no tienen `history`
    // (pantalla Mesas). Se backfillea desde el seed para no romper ni mostrar
    // un historial vacío a quien ya venía usando la demo.
    if (!Array.isArray(parsed.history)) {
      parsed.history = seedState().history;
    }
    // Migración 0.25: el seed viejo traía 'payme_mx_leo' (3 chars), que viola
    // el formato del contrato — se renombra en estados persistidos.
    if (Array.isArray(parsed.friends)) {
      for (const f of parsed.friends) {
        if (f.payme_id === 'payme_mx_leo') f.payme_id = 'payme_mx_leop';
      }
    }
    // Auditoría 2026-08-02: el estado económico ya persistía, pero el ledger
    // idempotente era memoria de módulo. Un reload podía repetir una mutación.
    if (!parsed.idempotency || typeof parsed.idempotency !== 'object' || Array.isArray(parsed.idempotency)) {
      parsed.idempotency = {};
    }
    // OLA 3C: `friendRequests` y `blockedUserIds` nacieron después que el
    // storage. Un estado persistido de antes los trae `undefined` y la pantalla
    // de amigos reventaba al leerlos.
    // v2.32.0 · `linkTokens` nació con el cierre del pago sin cuenta. Un estado
    // persistido de antes lo trae `undefined`, y canjear reventaría al leerlo.
    if (!parsed.linkTokens || typeof parsed.linkTokens !== 'object' || Array.isArray(parsed.linkTokens)) {
      parsed.linkTokens = {};
    }
    if (!Array.isArray(parsed.joinedMesaCodes)) parsed.joinedMesaCodes = [];
    if (!Array.isArray(parsed.friendRequests)) parsed.friendRequests = [];
    if (!Array.isArray(parsed.blockedUserIds)) parsed.blockedUserIds = [];
    // El directorio de personas que existen sin ser amigas.
    if (!Array.isArray(parsed.directory)) parsed.directory = seedDirectory();
    // OLA 5C(b), corrección: sin esto el apagado del riel saldo no alcanzaba a
    // nadie que ya hubiera abierto la demo — los avisos de saldo viven en SU
    // localStorage, no en el seed, y seguirían visibles en `#/avisos`.
    if (Array.isArray(parsed.notifications)) {
      const durmientes: readonly string[] = WALLET_NOTIFICATION_TYPES;
      parsed.notifications = parsed.notifications.filter((n) => !durmientes.includes(n.type));
      // v0.143.1 · el seed mostraba la misma invitación dos veces: como
      // tarjeta pendiente accionable y como fila histórica del inbox. Se
      // retira únicamente la firma exacta de esa fila demo, también de los
      // estados ya persistidos; las notificaciones reales no se filtran en la
      // pantalla ni se cambia el contrato.
      parsed.notifications = parsed.notifications.filter((notification) => !(
        notification?.type === 'invitation_received'
        && notification?.body === 'Sofía Fernández te invitó a una mesa'
        && notification?.payload?.mesa_code === 'PA-4520'
        && notification?.payload?.inviter_name === 'Sofía Fernández'
      ));
      // v0.142.0 · el aviso histórico del seed traía sólo el monto. Ese
      // shape sigue mostrándose agregado, pero no puede abrir la ruta privada.
      // Se migra exclusivamente la fila demo acreditada contra su mesa cerrada;
      // ningún aviso ajeno se completa por inferencia.
      const shortfallMesa = Array.isArray(parsed.mesas)
        ? parsed.mesas.find((mesa) => mesa?.code === 'PA-1099'
          && mesa?.captured_shortfall_cents === 21000)
        : null;
      if (shortfallMesa) {
        parsed.notifications = parsed.notifications.map((notification) => (
          notification?.type === 'mesa_shortfall_charged'
          && notification?.body === 'Se cobró el faltante de la mesa ($210.00) a tu garantía.'
          && notification?.payload?.shortfall_cents === 21000
            ? {
                ...notification,
                payload: {
                  mesa_id: shortfallMesa.id,
                  mesa_code: shortfallMesa.code,
                  shortfall_cents: 21000,
                  detail_available: true,
                },
                related_entity_type: 'mesa',
                related_entity_id: shortfallMesa.id,
              }
            : notification
        ));
      }
    }
    if (!Array.isArray(parsed.pendingInvitations)) parsed.pendingInvitations = [];
    /**
     * G-36 · al final de las migraciones, con el estado ya saneado, y en un
     * `try/catch` PROPIO: el de afuera descarta el estado ENTERO —mesas,
     * tarjetas, amigos, historial, ledger— y un bug acá le costaría al usuario
     * mucho más de lo que esto viene a curar. Si algo sale mal, la demo queda
     * como estaba y "Reiniciar la demo" sigue siendo la salida.
     *
     * El orden importa: primero se le pone la marca a lo legacy que se puede
     * acreditar, y recién después se relanza lo vencido — así el rescate de
     * `67fc0de` alcanza también a los dispositivos que ya venían rotos.
     */
    try {
      migrarSeedLegacy(parsed);
      relanzarSeedVencido(parsed);
    } catch {
      /* La demo queda como estaba: conservar gana a arriesgar el estado. */
    }
    return parsed;
  } catch {
    return null;
  }
}

export const state: MockState = loadPersisted() ?? seedState();

let saveQueued = false;
/** Guarda el estado de la demo (agrupado en un microtask para no serializar de más). */
export function persist(): void {
  if (saveQueued) return;
  saveQueued = true;
  queueMicrotask(() => {
    saveQueued = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // cuota llena o modo privado: la demo sigue funcionando en memoria
    }
  });
}

/** Reinicia la demo al estado sembrado (botón en Perfil). */
export function resetDemo(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

// ─── Helpers de dominio ────────────────────────────────────

export function availableBalance(): number {
  return state.balance_cents - state.held_balance_cents;
}

export function pushWalletTx(type: WalletTxType, amount: number, description: string): void {
  state.walletTx.unshift({
    id: mockId('f'),
    type,
    amount_cents: amount,
    amount_display: centsToDisplay(Math.abs(amount)),
    sign: amount >= 0 ? 'credit' : 'debit',
    balance_after_cents: state.balance_cents,
    balance_after_display: centsToDisplay(state.balance_cents),
    related: null,
    description,
    metadata: null,
    date: new Date().toISOString(),
  });
}

export function findMesa(code: string): MockMesa | null {
  return state.mesas.find((m) => m.code.toUpperCase() === code.toUpperCase()) ?? null;
}

/**
 * El estado del mock vive en el navegador, así que un link de invitación
 * abierto en OTRO teléfono no encontraría la mesa. Para que la demo funcione
 * al compartirla de verdad, cualquier código con formato válido se materializa
 * como una mesa abierta con el ticket de ejemplo.
 */
export function materializeDemoMesa(code: string): MockMesa | null {
  if (!/^[A-Z]{2}-\d{3,5}$/i.test(code)) return null;
  const restaurant = MOCK_RESTAURANTS[0];
  const items = seedItems();
  const paid = items
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + i.price_cents * i.quantity, 0);
  const mesa: MockMesa = {
    id: mockId('c'),
    code: code.toUpperCase(),
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      category: restaurant.category,
      address: restaurant.address,
    },
    total_cents: 84000,
    paid_amount_cents: paid,
    tip_amount_cents: 0,
    division_mode: 'consumo',
    expected_participants: 4,
    status: 'partially_paid',
    expires_at: iso(24 * 60_000),
    items,
    slots: null,
    active_staff: STAFF,
    openedByUser: false,
    captured_shortfall_cents: 0,
    guarantee_method: 'card',
  };
  state.mesas.unshift(mesa);
  return mesa;
}

/** Expiración perezosa + liquidación A-2: la garantía captura el faltante. */
export function settleIfExpired(mesa: MockMesa): void {
  const active = mesa.status === 'open' || mesa.status === 'partially_paid';
  if (!active || new Date(mesa.expires_at).getTime() > Date.now()) return;
  // `completed` A PROPÓSITO, y SÓLO en el mock (auditoría 2026-08-06): acá el
  // cierre por vencimiento ES el cierre completo — no hay dispersión pendiente
  // que esperar, porque no hay dispersión. Dejarlo en 'settled' no modelaba un
  // estado intermedio real: modelaba uno que en el mock nunca avanza, y la
  // pantalla A-2 rica ("Tu garantía cubrió $X") quedaba inalcanzable por el
  // camino vivo. En el riel real 'settled' es correcto y significa algo.
  mesa.status = 'completed';
  mesa.captured_shortfall_cents = Math.max(0, mesa.total_cents - mesa.paid_amount_cents);
  if (mesa.openedByUser && mesa.captured_shortfall_cents > 0) {
    if (mesa.guarantee_method === 'wallet') {
      state.held_balance_cents = Math.max(0, state.held_balance_cents - mesa.total_cents);
      state.balance_cents -= mesa.captured_shortfall_cents;
      pushWalletTx('payment_mesa', -mesa.captured_shortfall_cents, `Faltante mesa ${mesa.code} (garantía)`);
    }
    // guarantee card: la captura pega en la tarjeta, no en el wallet.
  }
}

export function toOpenMesa(m: MockMesa): OpenMesa {
  return {
    id: m.id,
    code: m.code,
    full_name: `Mesa ${m.code} - ${m.restaurant.name}`,
    restaurant: { name: m.restaurant.name, category: m.restaurant.category },
    total_cents: m.total_cents,
    paid_amount_cents: m.paid_amount_cents,
    pct_paid: m.total_cents > 0 ? Math.round((m.paid_amount_cents / m.total_cents) * 100) : 0,
    status: m.status,
    expires_at: m.expires_at,
  };
}

export function toMesaDetail(m: MockMesa, identity: MockIdentity): MesaDetail {
  const slots: DivisionSlot[] | undefined = m.slots
    ? m.slots.map((s) => ({
        slot_index: s.slot_index,
        amount_cents: s.amount_cents,
        amount_display: centsToDisplay(s.amount_cents),
        status: s.status,
        // v2.25 §4.3: solo sobre casilleros TOMADOS y solo si son míos —
        // uno liberado puede conservar rastros del dueño anterior.
        claimed_by_me:
          (s.status === 'claimed' || s.status === 'paid') && s.claimedBy === identity,
      }))
    : undefined;
  return {
    id: m.id,
    code: m.code,
    full_name: `Mesa ${m.code} - ${m.restaurant.name}`,
    restaurant: m.restaurant,
    total_cents: m.total_cents,
    total_display: centsToDisplay(m.total_cents),
    paid_amount_cents: m.paid_amount_cents,
    // D7 (v2.17): misma cuenta que routes/mesas.js:271 del backend.
    tip_base_cents: Math.round(m.total_cents / (m.expected_participants || 1)),
    tip_amount_cents: m.tip_amount_cents,
    division_mode: m.division_mode,
    expected_participants: m.expected_participants,
    status: m.status,
    expires_at: m.expires_at,
    items: m.items.map((i) => {
      const taken = takenBps(i);
      const mine = myBps(i, identity);
      return {
        id: i.id,
        name: i.name,
        category: i.category,
        price_cents: i.price_cents,
        quantity: i.quantity,
        status: i.status,
        remaining_bps: Math.max(0, 10000 - taken),
        my_bps: mine,
        locked_by_me: mine > 0,
        lock_expires_at: i.lock_expires_at,
      };
    }),
    ...(slots && { division_slots: slots }),
    active_staff: m.active_staff,
    my_role: identity === 'guest' ? 'guest' : m.openedByUser ? 'opener' : 'participant',
  };
}

/** v2.18: bps tomados (locked+paid) de un ítem. */
export function takenBps(i: MockItem): number {
  return i.claims.reduce((s, c) => s + c.fraction_bps, 0);
}

/** v2.18: MI tenencia (locked+paid) en bps. */
export function myBps(i: MockItem, who: MockIdentity): number {
  return i.claims.filter((c) => c.who === who).reduce((s, c) => s + c.fraction_bps, 0);
}

/** Estados en los que la mesa acepta locks/pagos (routes/mesas.js). */
export function mesaPayable(m: MockMesa): boolean {
  return m.status === 'open' || m.status === 'partially_paid';
}

export function markMesaPaid(m: MockMesa, itemsAmount: number): void {
  m.paid_amount_cents += itemsAmount;
  if (m.paid_amount_cents >= m.total_cents) {
    m.status = 'fully_paid';
  } else if (m.status === 'open') {
    m.status = 'partially_paid';
  }
}
