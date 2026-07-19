import { centsToDisplay, splitEqual } from '../../utils/money';
import type {
  ActiveStaff,
  AppNotification,
  DivisionSlot,
  Friend,
  Group,
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
import { MOCK_RESTAURANTS, MOCK_USER } from './seedData';

/**
 * Store en memoria del mock: hace de "backend" con las MISMAS reglas del
 * contrato (garantía A-1, saldo retenido, locks, slots, expiración A-2).
 * Se resetea al recargar la página — suficiente para la demo.
 * Identidades: 'user' (el logueado) · 'guest' (entró por link) · 'other'
 * (los demás comensales, simulados).
 */

export type MockIdentity = 'user' | 'guest';
type Owner = MockIdentity | 'other' | null;

interface MockItem {
  id: string;
  name: string;
  category: string;
  price_cents: number;
  quantity: number;
  status: ItemStatus;
  lockedBy: Owner;
  lock_expires_at: string | null;
}

interface MockSlot {
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
}

interface MockState {
  user: User;
  balance_cents: number;
  held_balance_cents: number;
  clabe: string | null;
  paymentMethods: PaymentMethod[];
  friends: Friend[];
  groups: Array<Group & { memberIds: string[] }>;
  mesas: MockMesa[];
  walletTx: WalletTransaction[];
  transfers: TransferListItem[];
  notifications: AppNotification[];
  pendingInvitations: PendingInvitation[];
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
      items: [],
      slots,
      active_staff: STAFF,
      openedByUser: true,
      captured_shortfall_cents: 0,
      guarantee_method: 'wallet',
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
      items: [],
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
    {
      id: mockId('c'),
      code: 'PA-1099',
      restaurant: { id: parolaccia.id, name: parolaccia.name, category: parolaccia.category, address: parolaccia.address },
      total_cents: 84000,
      paid_amount_cents: 63000,
      tip_amount_cents: 9000,
      division_mode: 'igual',
      expected_participants: 4,
      status: 'settled',
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

function seedWalletTx(): WalletTransaction[] {
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

function seedFriends(): Friend[] {
  const mk = (payme: string, first: string, last: string): Friend => ({
    id: mockId('a'),
    payme_id: `payme_mx_${payme}`,
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`,
    email: `${payme}@mail.com`,
    added_at: iso(-30 * 24 * 60 * 60_000),
  });
  return [mk('sofi', 'Sofía', 'Fernández'), mk('juan', 'Juan', 'López'), mk('maru', 'María', 'Ruiz'), mk('leo', 'Leo', 'Paz')];
}

function seedNotifications(mesas: MockMesa[]): {
  notifications: AppNotification[];
  pendingInvitations: PendingInvitation[];
} {
  const invitedMesa = mesas.find((m) => m.code === 'PA-4520');
  const notifications: AppNotification[] = [
    {
      id: mockId('f'),
      type: 'invitation_received',
      title: null,
      body: 'Sofía Fernández te invitó a una mesa',
      payload: { mesa_code: 'PA-4520', inviter_name: 'Sofía Fernández' },
      related_entity_type: 'invitation',
      related_entity_id: null,
      read_at: null,
      created_at: iso(-8 * 60_000),
    },
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
    {
      id: mockId('f'),
      type: 'mesa_shortfall_charged',
      title: null,
      body: 'Se cobró el faltante de la mesa ($210.00) a tu garantía.',
      payload: { shortfall_cents: 21000 },
      related_entity_type: 'mesa',
      related_entity_id: null,
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
          expires_at: iso(24 * 60 * 60_000),
          created_at: iso(-8 * 60_000),
          mesa_code: invitedMesa.code,
          restaurant_name: invitedMesa.restaurant.name,
          inviter_first_name: 'Sofía',
          inviter_last_name: 'Fernández',
          inviter_payme_id: 'payme_mx_sofi',
        },
      ]
    : [];
  return { notifications, pendingInvitations };
}

function seedState(): MockState {
  const friends = seedFriends();
  const mesas = seedMesas();
  const { notifications, pendingInvitations } = seedNotifications(mesas);
  return {
    user: MOCK_USER,
    balance_cents: 125000,
    held_balance_cents: 0,
    clabe: null,
    paymentMethods: [
      {
        id: mockId('b'),
        brand: 'visa',
        bank_name: 'Santander',
        type: 'credit',
        last_four: '4532',
        exp_month: 8,
        exp_year: 2028,
        is_default: true,
        display: 'Santander · Crédito · •••• 4532',
      },
    ],
    friends,
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
    walletTx: seedWalletTx(),
    notifications,
    pendingInvitations,
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

function loadPersisted(): MockState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockState;
    // Validación mínima: si el shape no cierra, se descarta y se re-siembra.
    if (!parsed || !Array.isArray(parsed.mesas) || typeof parsed.balance_cents !== 'number') {
      return null;
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
  mesa.status = 'settled';
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
    tip_amount_cents: m.tip_amount_cents,
    division_mode: m.division_mode,
    expected_participants: m.expected_participants,
    status: m.status,
    expires_at: m.expires_at,
    items: m.items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      price_cents: i.price_cents,
      quantity: i.quantity,
      status: i.status,
      locked_by_me: i.status === 'locked' && i.lockedBy === identity,
      lock_expires_at: i.lock_expires_at,
    })),
    ...(slots && { division_slots: slots }),
    active_staff: m.active_staff,
    my_role: identity === 'guest' ? 'guest' : m.openedByUser ? 'opener' : 'participant',
  };
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
