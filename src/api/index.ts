import {
  httpGuestRequest,
  httpLogin,
  httpLogout,
  httpRegister,
  httpRequest,
  setOnSessionExpired,
} from './http';
import * as mock from './mock/mockApi';
import { clearSession, loadSession, type StoredSession } from './storage';
import { confirmCardPayment } from './stripe';
import type {
  BalanceResponse,
  FractionRequest,
  ClabeResponse,
  CreateInvitationResponse,
  CreateMesaRequest,
  CreateMesaResponse,
  CreateTransferRequest,
  CreateTransferResponse,
  Friend,
  FriendsResponse,
  GroupDetailResponse,
  GroupsResponse,
  LockItemsResponse,
  MesaDetailResponse,
  NotificationsResponse,
  OcrResponse,
  OpenMesasResponse,
  PayMesaRequest,
  PayMesaResponse,
  PaymentMethodsResponse,
  PendingInvitationsResponse,
  RegisterRequest,
  StatsResponse,
  TopupCardResponse,
  TopupOxxoResponse,
  TransfersResponse,
  WalletTransactionsResponse,
  HistoryResponse,
} from './types';

/**
 * Fachada única de datos (mismo patrón que el dashboard frontend): las
 * pantallas importan SOLO de acá. VITE_MOCK=1 elige el adaptador mock con
 * los mismos shapes; pasar a backend real no toca ninguna vista.
 *
 * `guestToken`: si viene, la request va como invitado (sin sesión). En el
 * mock decide la identidad; en real usa X-Guest-Token.
 */

export const IS_MOCK: boolean = import.meta.env.VITE_MOCK === '1';

/**
 * Modo demo para grabar el video (aplicación YC): un bypass de cámara, nada
 * más. Se activa con `?demo=1` en la URL (ej. `.../live/?demo=1`; también se
 * lee si el flag viaja dentro del hash). Se evalúa UNA vez al cargar.
 *
 * SIN el flag la app se comporta EXACTAMENTE igual que hoy. NO toca el contrato
 * ni el happy-path: solo evita depender de `getUserMedia`/diálogo de archivo al
 * escanear (ver `CreateMesaFlow`) y saca del encuadre algún cartel/dato que
 * delata la maqueta. El pago sigue siendo Stripe real.
 */
function readDemoFlag(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('demo') === '1') return true;
  const hash = window.location.hash;
  const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return new URLSearchParams(q).get('demo') === '1';
}

export const IS_DEMO: boolean = readDemoFlag();

/**
 * Modo demo: PaymentMethod de test de Stripe (Visa 4242, siempre aprueba, sin
 * 3DS). Con `?demo=1` se manda como `stripe_payment_method_id` en garantía y
 * pago para NO depender del tipeo en el iframe de Stripe Elements durante la
 * grabación en navegador automatizado. Es un token público de test de Stripe;
 * jamás se usa sin el flag (el pago real sigue creando el `pm_` desde Elements).
 */
export const DEMO_PM_ID = 'pm_card_visa';

export interface Api {
  // auth
  login(email: string, password: string): Promise<StoredSession>;
  register(data: RegisterRequest): Promise<StoredSession>;
  logout(): Promise<void>;
  restoreSession(): StoredSession | null;
  onSessionExpired(cb: (() => void) | null): void;
  // cuenta
  getBalance(): Promise<BalanceResponse>;
  getWalletTransactions(): Promise<WalletTransactionsResponse>;
  /** Pagos propios en mesas (GET /account/history) — la pantalla Mesas. */
  getHistory(): Promise<HistoryResponse>;
  // mesas
  getOpenMesas(): Promise<OpenMesasResponse>;
  getMesa(code: string, guestToken?: string): Promise<MesaDetailResponse>;
  scanTicket(image?: Blob): Promise<OcrResponse>;
  createMesa(req: CreateMesaRequest): Promise<CreateMesaResponse>;
  /** Mock: simula la confirmación 3DS de la garantía. En T7: Stripe.js. */
  confirmGuarantee3ds(code: string, clientSecret: string): Promise<{ status: string }>;
  lockItems(code: string, items: FractionRequest[], guestToken?: string): Promise<LockItemsResponse>;
  payMesa(code: string, req: PayMesaRequest, guestToken?: string): Promise<PayMesaResponse>;
  createInvitation(code: string): Promise<CreateInvitationResponse>;
  // topup (A-3)
  topupOxxo(amountCents: number, idempotencyKey: string): Promise<TopupOxxoResponse>;
  topupCard(
    amountCents: number,
    paymentMethodId: string,
    idempotencyKey: string,
  ): Promise<TopupCardResponse>;
  getClabe(): Promise<ClabeResponse>;
  // transfers
  createTransfer(req: CreateTransferRequest): Promise<CreateTransferResponse>;
  listTransfers(): Promise<TransfersResponse>;
  // payment methods
  getPaymentMethods(): Promise<PaymentMethodsResponse>;
  setDefaultPaymentMethod(id: string): Promise<void>;
  removePaymentMethod(id: string): Promise<void>;
  /** POST /payment-methods/setup-intent → client_secret para Stripe Elements. */
  createSetupIntent(): Promise<{ client_secret: string }>;
  /** POST /payment-methods: registra el `pm_…` ya confirmado con Stripe. */
  attachPaymentMethod(stripePaymentMethodId: string, setAsDefault?: boolean): Promise<void>;
  // notificaciones e invitaciones in-app
  getNotifications(): Promise<NotificationsResponse>;
  getUnreadCount(): Promise<{ unread_count: number }>;
  markAllNotificationsRead(): Promise<void>;
  getPendingInvitations(): Promise<PendingInvitationsResponse>;
  acceptInvitation(id: string): Promise<{ accepted: boolean }>;
  // stats
  getStats(): Promise<StatsResponse>;
  // social
  getFriends(): Promise<FriendsResponse>;
  addFriend(query: { email?: string; payme_id?: string }): Promise<Friend>;
  removeFriend(friendId: string): Promise<void>;
  getGroups(): Promise<GroupsResponse>;
  getGroup(id: string): Promise<GroupDetailResponse>;
  createGroup(name: string, icon?: string): Promise<void>;
  addGroupMember(groupId: string, friendId: string): Promise<void>;
  removeGroupMember(groupId: string, friendId: string): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
}

/** UUID v4 del navegador — para idempotency_key (8–100 chars por schema). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

const realApi: Api = {
  login: (email, password) => httpLogin(email, password),
  register: (data) => httpRegister(data),
  logout: () => httpLogout(),
  restoreSession: () => loadSession(),
  onSessionExpired: (cb) => setOnSessionExpired(cb),

  getBalance: () => httpRequest<BalanceResponse>('GET', '/account/balance'),
  getHistory: () => httpRequest<HistoryResponse>('GET', '/account/history'),
  getWalletTransactions: () =>
    httpRequest<WalletTransactionsResponse>('GET', '/account/wallet-transactions'),

  getOpenMesas: () => httpRequest<OpenMesasResponse>('GET', '/mesas/open'),
  getMesa: (code, guestToken) =>
    guestToken
      ? httpGuestRequest<MesaDetailResponse>('GET', `/mesas/${encodeURIComponent(code)}`, guestToken)
      : httpRequest<MesaDetailResponse>('GET', `/mesas/${encodeURIComponent(code)}`),
  async scanTicket(image) {
    // POST /api/ocr es multipart (campo `image`); el backend responde el
    // ticket mock (HAS_REAL_IMPL=false).
    if (!image) throw new Error('scanTicket requiere imagen en modo real');
    const form = new FormData();
    form.append('image', image, 'ticket.jpg');
    const session = loadSession();
    const base = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/ocr`, {
      method: 'POST',
      headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error('ocr_failed');
    return (await res.json()) as OcrResponse;
  },
  createMesa: (req) => httpRequest<CreateMesaResponse>('POST', '/mesas', req),
  /**
   * 3DS de la garantía: se confirma con Stripe.js y después se espera a que la
   * mesa pase a 'open'. Ese cambio lo hace el WEBHOOK
   * (payment_intent.amount_capturable_updated), no la respuesta de Stripe, así
   * que hay que sondear la mesa: sin esto el organizador seguiría a compartir
   * el link con la mesa todavía en 'pending_auth'.
   */
  async confirmGuarantee3ds(code, clientSecret) {
    const r = await confirmCardPayment(clientSecret);
    if (!r.ok) throw new Error(r.error);
    for (let i = 0; i < 10; i++) {
      const { mesa } = await httpRequest<MesaDetailResponse>(
        'GET',
        `/mesas/${encodeURIComponent(code)}`,
      );
      if (mesa.status !== 'pending_auth') return { status: mesa.status };
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // El hold quedó autorizado en Stripe pero el webhook todavía no llegó.
    throw new Error('guarantee_pending_webhook');
  },
  lockItems: (code, items, guestToken) =>
    guestToken
      ? httpGuestRequest<LockItemsResponse>(
          'POST',
          `/mesas/${encodeURIComponent(code)}/items/lock`,
          guestToken,
          { items },
        )
      : httpRequest<LockItemsResponse>('POST', `/mesas/${encodeURIComponent(code)}/items/lock`, {
          items,
        }),
  payMesa: (code, req, guestToken) =>
    guestToken
      ? httpGuestRequest<PayMesaResponse>(
          'POST',
          `/mesas/${encodeURIComponent(code)}/pay`,
          guestToken,
          req,
        )
      : httpRequest<PayMesaResponse>('POST', `/mesas/${encodeURIComponent(code)}/pay`, req),
  createInvitation: (code) =>
    httpRequest<CreateInvitationResponse>('POST', `/mesas/${encodeURIComponent(code)}/invitations`, {
      type: 'link',
    }),

  topupOxxo: (amountCents, idempotencyKey) =>
    httpRequest<TopupOxxoResponse>('POST', '/topup/oxxo', {
      amount_cents: amountCents,
      idempotency_key: idempotencyKey,
    }),
  topupCard: (amountCents, paymentMethodId, idempotencyKey) =>
    httpRequest<TopupCardResponse>('POST', '/topup/card', {
      amount_cents: amountCents,
      payment_method_id: paymentMethodId,
      idempotency_key: idempotencyKey,
    }),
  getClabe: () => httpRequest<ClabeResponse>('GET', '/wallet/clabe'),

  createTransfer: (req) => httpRequest<CreateTransferResponse>('POST', '/transfers', req),
  listTransfers: () => httpRequest<TransfersResponse>('GET', '/transfers'),

  getPaymentMethods: () => httpRequest<PaymentMethodsResponse>('GET', '/payment-methods'),
  setDefaultPaymentMethod: async (id) => {
    await httpRequest('PATCH', `/payment-methods/${encodeURIComponent(id)}/default`);
  },
  removePaymentMethod: async (id) => {
    await httpRequest('DELETE', `/payment-methods/${encodeURIComponent(id)}`);
  },
  createSetupIntent: () =>
    httpRequest<{ client_secret: string }>('POST', '/payment-methods/setup-intent'),
  attachPaymentMethod: async (stripePaymentMethodId, setAsDefault) => {
    await httpRequest('POST', '/payment-methods', {
      stripe_payment_method_id: stripePaymentMethodId,
      ...(setAsDefault !== undefined && { set_as_default: setAsDefault }),
    });
  },

  getNotifications: () => httpRequest<NotificationsResponse>('GET', '/notifications'),
  getUnreadCount: () => httpRequest<{ unread_count: number }>('GET', '/notifications/unread-count'),
  markAllNotificationsRead: async () => {
    await httpRequest('PATCH', '/notifications/read-all');
  },
  getPendingInvitations: () => httpRequest<PendingInvitationsResponse>('GET', '/invitations'),
  acceptInvitation: (id) =>
    httpRequest<{ accepted: boolean }>('POST', `/invitations/${encodeURIComponent(id)}/accept`),

  getStats: () => httpRequest<StatsResponse>('GET', '/account/stats'),

  getFriends: () => httpRequest<FriendsResponse>('GET', '/friends'),
  addFriend: async (query) => {
    const r = await httpRequest<{ friend: Friend }>('POST', '/friends', query);
    return r.friend;
  },
  removeFriend: async (friendId) => {
    await httpRequest('DELETE', `/friends/${encodeURIComponent(friendId)}`);
  },
  getGroups: () => httpRequest<GroupsResponse>('GET', '/groups'),
  getGroup: (id) => httpRequest<GroupDetailResponse>('GET', `/groups/${encodeURIComponent(id)}`),
  createGroup: async (name, icon) => {
    await httpRequest('POST', '/groups', { name, icon });
  },
  addGroupMember: async (groupId, friendId) => {
    await httpRequest('POST', `/groups/${encodeURIComponent(groupId)}/members`, {
      friend_user_id: friendId,
    });
  },
  removeGroupMember: async (groupId, friendId) => {
    await httpRequest(
      'DELETE',
      `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(friendId)}`,
    );
  },
  deleteGroup: async (groupId) => {
    await httpRequest('DELETE', `/groups/${encodeURIComponent(groupId)}`);
  },
};

const mockApi: Api = {
  login: (email, password) => mock.mockLogin(email, password),
  register: (data) => mock.mockRegister(data),
  async logout() {
    await mock.mockLogout();
    clearSession();
  },
  restoreSession: () => loadSession(),
  onSessionExpired: () => undefined,

  getBalance: () => mock.mockBalance(),
  getWalletTransactions: () => mock.mockWalletTransactions(),
  getHistory: () => mock.mockHistory(),

  getOpenMesas: () => mock.mockOpenMesas(),
  getMesa: (code, guestToken) => mock.mockGetMesa(code, guestToken ? 'guest' : 'user'),
  scanTicket: () => mock.mockScanTicket(),
  createMesa: (req) => mock.mockCreateMesa(req),
  confirmGuarantee3ds: (code) => mock.mockConfirmGuarantee3ds(code),
  lockItems: (code, items, guestToken) => mock.mockLockItems(code, items, guestToken ? 'guest' : 'user'),
  payMesa: (code, req, guestToken) => mock.mockPayMesa(code, req, guestToken ? 'guest' : 'user'),
  createInvitation: (code) => mock.mockCreateInvitation(code),

  topupOxxo: (amountCents) => mock.mockTopupOxxo(amountCents),
  topupCard: (amountCents, paymentMethodId) => mock.mockTopupCard(amountCents, paymentMethodId),
  getClabe: () => mock.mockGetClabe(),

  createTransfer: (req) => mock.mockCreateTransfer(req),
  listTransfers: () => mock.mockListTransfers(),

  getPaymentMethods: () => mock.mockPaymentMethods(),
  setDefaultPaymentMethod: (id) => mock.mockSetDefaultPaymentMethod(id),
  removePaymentMethod: (id) => mock.mockRemovePaymentMethod(id),
  createSetupIntent: () => mock.mockCreateSetupIntent(),
  attachPaymentMethod: (pmId, setAsDefault) => mock.mockAttachPaymentMethod(pmId, setAsDefault),

  getNotifications: () => mock.mockNotifications(),
  getUnreadCount: () => mock.mockUnreadCount(),
  markAllNotificationsRead: () => mock.mockMarkAllNotificationsRead(),
  getPendingInvitations: () => mock.mockPendingInvitations(),
  acceptInvitation: (id) => mock.mockAcceptInvitation(id),

  getStats: () => mock.mockStats(),

  getFriends: () => mock.mockFriends(),
  addFriend: (query) => mock.mockAddFriend(query),
  removeFriend: (friendId) => mock.mockRemoveFriend(friendId),
  getGroups: () => mock.mockGroups(),
  getGroup: (id) => mock.mockGroupDetail(id),
  createGroup: (name, icon) => mock.mockCreateGroup(name, icon),
  addGroupMember: (groupId, friendId) => mock.mockAddGroupMember(groupId, friendId),
  removeGroupMember: (groupId, friendId) => mock.mockRemoveGroupMember(groupId, friendId),
  deleteGroup: (groupId) => mock.mockDeleteGroup(groupId),
};

export const api: Api = IS_MOCK ? mockApi : realApi;
