import {
  httpGuestRequest,
  httpLogin,
  httpLogout,
  httpPublicRequest,
  httpRegister,
  httpRequest,
  OCR_TIMEOUT_MS,
  setOnSessionExpired,
} from './http';
import * as mock from './mock/mockApi';
import { attachPaymentMethodResponse, invitationResponse, setupIntentResponse } from './contractResponses';
import { withPreparedMonetaryRequest, type MonetaryIntentHandle } from './idempotency';
import { guaranteeOutcome } from './paymentStatus';
import { invalidateSession, loadSession, type StoredSession } from './storage';
import { confirmCardPayment } from './stripe';
import { createMesaResponse, payMesaResponse, topupCardResponse, topupOxxoResponse, topupStatusResponse, transferResponse, type PayMesaExpectation, type TransferExpectation } from './moneyGuards';
import type {
  BalanceResponse,
  AttachPaymentMethodResponse,
  MeResponse,
  RestaurantResponse,
  FractionRequest,
  ClabeResponse,
  CreateInvitationResponse,
  CreateSetupIntentResponse,
  CreateMesaRequest,
  CreateMesaResponse,
  CreateTransferRequest,
  CreateTransferResponse,
  FriendRequestCreatedResponse,
  FriendRequestDirection,
  FriendRequestsResponse,
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
  TopupStatusResponse,
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
 * Estado preexistente: el riel nunca aparece en real y el mock conserva su
 * historia. El apagado también dentro del mock se ejecuta recién después de
 * esta auditoría, según el plan ratificado; no se anticipa acá.
 */
export const WALLET_RAIL_ENABLED: boolean = IS_MOCK;


/**
 * G-01 (v2.21): el restaurante llega por el QR de la mesa — `?r=<uuid>` en la
 * URL (query directa o dentro del hash, igual que el flag demo). Se evalúa UNA
 * vez al cargar; CreateMesaFlow lo resuelve contra GET /restaurants/:id.
 */
function readQrRestaurant(): string | null {
  if (typeof window === 'undefined') return null;
  const direct = new URLSearchParams(window.location.search).get('r');
  if (direct) return direct;
  const hash = window.location.hash;
  const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return new URLSearchParams(q).get('r');
}

export const QR_RESTAURANT_ID: string | null = readQrRestaurant();


/**
 * Apple Pay / Google Pay siguen apagados también en mock. Son un MUST
 * ratificado del MVP, pero la hoja nativa y sus pruebas físicas todavía no
 * están implementadas; un botón que manda un `pm_` de utilería no acredita
 * soporte.
 */
export const WALLET_PAY_ENABLED = false;

export interface Api {
  // auth
  login(email: string, password: string): Promise<StoredSession>;
  register(data: RegisterRequest): Promise<StoredSession>;
  logout(): Promise<void>;
  restoreSession(): StoredSession | null;
  onSessionExpired(cb: (() => void) | null): void;
  /** Perfil propio (G-02, v2.20) — hidrata sesiones persistidas sin `user`. */
  getMe(): Promise<MeResponse>;
  /** Resolver el uuid del QR de la mesa (G-01, v2.21). Público, 404 si no está activo. */
  getRestaurant(id: string): Promise<RestaurantResponse>;
  // cuenta
  getBalance(): Promise<BalanceResponse>;
  getWalletTransactions(): Promise<WalletTransactionsResponse>;
  /**
   * Pagos propios en mesas (GET /account/history). OJO: el backend pagina
   * con limit default 20 (máx 100) — para agregados (la torta de Cuenta)
   * pedir `from` + `limit`, no la primera página pelada.
   */
  getHistory(params?: { from?: string; to?: string; limit?: number }): Promise<HistoryResponse>;
  // mesas
  getOpenMesas(): Promise<OpenMesasResponse>;
  getMesa(code: string, guestToken?: string): Promise<MesaDetailResponse>;
  scanTicket(image?: Blob): Promise<OcrResponse>;
  createMesa(req: CreateMesaRequest, intent: MonetaryIntentHandle): Promise<CreateMesaResponse>;
  /** Mock: simula la confirmación 3DS de la garantía. En T7: Stripe.js. */
  /** @param connectedAccountId v2.24: si el hold vive en la cuenta del restaurante. */
  confirmGuarantee3ds(
    code: string,
    clientSecret: string,
    connectedAccountId?: string,
  ): Promise<{ status: string; outcome: 'success' | 'definitive' | 'ambiguous'; error?: string }>;
  lockItems(code: string, items: FractionRequest[], guestToken?: string): Promise<LockItemsResponse>;
  payMesa(code: string, req: PayMesaRequest, guestToken: string | undefined, expectation: PayMesaExpectation, intent: MonetaryIntentHandle): Promise<PayMesaResponse>;
  createInvitation(code: string, idempotencyKey: string): Promise<CreateInvitationResponse>;
  /** Invitación in-app a un amigo por payme_id (solo el organizador; el backend resuelve el uuid). */
  inviteFriend(code: string, paymeId: string, idempotencyKey: string): Promise<CreateInvitationResponse>;
  // topup (A-3)
  topupOxxo(amountCents: number, intent: MonetaryIntentHandle): Promise<TopupOxxoResponse>;
  topupCard(
    amountCents: number,
    paymentMethodId: string,
    intent: MonetaryIntentHandle,
  ): Promise<TopupCardResponse>;
  getTopup(id: string, expectedAmountCents: number, expectedMethod: 'oxxo' | 'card' | 'spei'): Promise<TopupStatusResponse>;
  getClabe(): Promise<ClabeResponse>;
  // transfers
  createTransfer(req: CreateTransferRequest, expectation: TransferExpectation, intent: MonetaryIntentHandle): Promise<CreateTransferResponse>;
  listTransfers(): Promise<TransfersResponse>;
  // payment methods
  getPaymentMethods(): Promise<PaymentMethodsResponse>;
  setDefaultPaymentMethod(id: string): Promise<void>;
  removePaymentMethod(id: string): Promise<void>;
  /** POST /payment-methods/setup-intent → client_secret para Stripe Elements. */
  createSetupIntent(idempotencyKey: string, expectedSession?: StoredSession): Promise<CreateSetupIntentResponse>;
  /** POST /payment-methods: registra el `pm_…` ya confirmado con Stripe. */
  attachPaymentMethod(stripePaymentMethodId: string, setAsDefault?: boolean, expectedSession?: StoredSession): Promise<AttachPaymentMethodResponse>;
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
  /**
   * C1/C2 (v2.29): ya NO crea amistad ni dice si la persona existe. Responde
   * 202 `{ requested: true }` en todos los casos. La UI no puede afirmar nada
   * sobre el destinatario.
   */
  addFriend(query: { email?: string; payme_id?: string }): Promise<FriendRequestCreatedResponse>;
  getFriendRequests(direction: FriendRequestDirection): Promise<FriendRequestsResponse>;
  acceptFriendRequest(requestId: string): Promise<void>;
  rejectFriendRequest(requestId: string): Promise<void>;
  cancelFriendRequest(requestId: string): Promise<void>;
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
  /** C5: puede dar 404 `friendship_not_found` si no había amistad. */
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
  getMe: () => httpRequest<MeResponse>('GET', '/account/me'),
  getRestaurant: (id) =>
    httpPublicRequest<RestaurantResponse>('GET', `/restaurants/${encodeURIComponent(id)}`),

  getBalance: () => httpRequest<BalanceResponse>('GET', '/account/balance'),
  getHistory: (params) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.limit) qs.set('limit', String(params.limit));
    const s = qs.toString();
    return httpRequest<HistoryResponse>('GET', `/account/history${s ? `?${s}` : ''}`);
  },
  getWalletTransactions: () =>
    httpRequest<WalletTransactionsResponse>('GET', '/account/wallet-transactions'),

  getOpenMesas: () => httpRequest<OpenMesasResponse>('GET', '/mesas/open'),
  getMesa: (code, guestToken) =>
    guestToken
      ? httpGuestRequest<MesaDetailResponse>('GET', `/mesas/${encodeURIComponent(code)}`, guestToken)
      : httpRequest<MesaDetailResponse>('GET', `/mesas/${encodeURIComponent(code)}`),
  async scanTicket(image) {
    // POST /api/ocr es multipart (campo `image`). Pasa por httpRequest para
    // compartir timeout, refresh rotativo y errores normalizados con el resto.
    if (!image || image.size <= 0 || image.size > 8 * 1024 * 1024) throw new Error('scanTicket requiere una imagen de hasta 8 MiB');
    const form = new FormData();
    form.append('image', image, 'ticket.jpg');
    return httpRequest<OcrResponse>('POST', '/ocr', form, undefined, OCR_TIMEOUT_MS);
  },
  createMesa: async (req, intent) =>
    withPreparedMonetaryRequest(
      'create_mesa',
      intent,
      req,
      undefined,
      async (session) => createMesaResponse(await httpRequest<unknown>('POST', '/mesas', req, session), req),
    ),
  /**
   * 3DS de la garantía: se confirma con Stripe.js y después se espera a que la
   * mesa pase a 'open'. Ese cambio lo hace el WEBHOOK
   * (payment_intent.amount_capturable_updated), no la respuesta de Stripe, así
   * que hay que sondear la mesa: sin esto el organizador seguiría a compartir
   * el link con la mesa todavía en 'pending_auth'.
   */
  async confirmGuarantee3ds(code, clientSecret, connectedAccountId) {
    try {
      const r = await confirmCardPayment(clientSecret, connectedAccountId);
      if (!r.ok) return { status: 'requires_action', outcome: r.definitive ? 'definitive' : 'ambiguous', error: r.error };
    } catch {
      return { status: 'requires_action', outcome: 'ambiguous', error: 'No pudimos confirmar la respuesta de tu banco.' };
    }
    // Stripe ya pudo autorizar. Un fallo de polling NO es un rechazo y no
    // habilita una segunda garantía: se conserva el journal para reconciliar.
    for (let i = 0; i < 10; i++) {
      try {
        const { mesa } = await httpRequest<MesaDetailResponse>(
          'GET',
          `/mesas/${encodeURIComponent(code)}`,
        );
        const outcome = guaranteeOutcome(mesa.status);
        if (outcome === 'success') return { status: mesa.status, outcome };
        if (outcome === 'definitive') {
          return { status: mesa.status, outcome, error: 'La garantía ya no está vigente.' };
        }
      } catch {
        return { status: 'pending_auth', outcome: 'ambiguous', error: 'Tu banco pudo haber autorizado la garantía; todavía la estamos verificando.' };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return { status: 'pending_auth', outcome: 'ambiguous', error: 'Tu banco pudo haber autorizado la garantía; todavía la estamos verificando.' };
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
  payMesa: async (code, req, guestToken, expectation, intent) =>
    withPreparedMonetaryRequest(
      `mesa_pay:${code}`,
      intent,
      req,
      guestToken,
      async (session) =>
        guestToken
          ? payMesaResponse(await httpGuestRequest<unknown>(
              'POST',
              `/mesas/${encodeURIComponent(code)}/pay`,
              guestToken,
              req,
            ), req, expectation)
          : payMesaResponse(await httpRequest<unknown>('POST', `/mesas/${encodeURIComponent(code)}/pay`, req, session), req, expectation),
    ),
  createInvitation: async (code, idempotencyKey) =>
    invitationResponse(await httpRequest<unknown>('POST', `/mesas/${encodeURIComponent(code)}/invitations`, {
      type: 'link',
      idempotency_key: idempotencyKey,
    }), 'link', code),
  inviteFriend: async (code, paymeId, idempotencyKey) =>
    invitationResponse(await httpRequest<unknown>('POST', `/mesas/${encodeURIComponent(code)}/invitations`, {
      type: 'in_app',
      invited_payme_id: paymeId,
      idempotency_key: idempotencyKey,
    }), 'in_app', code),

  topupOxxo: async (amountCents, intent) => {
    const req = { amount_cents: amountCents, idempotency_key: intent.key };
    return withPreparedMonetaryRequest(
      'topup_oxxo',
      intent,
      req,
      undefined,
      async (session) => topupOxxoResponse(await httpRequest<unknown>('POST', '/topup/oxxo', req, session), amountCents),
    );
  },
  topupCard: async (amountCents, paymentMethodId, intent) => {
    const req = {
      amount_cents: amountCents,
      payment_method_id: paymentMethodId,
      idempotency_key: intent.key,
    };
    return withPreparedMonetaryRequest(
      'topup_card',
      intent,
      req,
      undefined,
      async (session) => topupCardResponse(await httpRequest<unknown>('POST', '/topup/card', req, session), amountCents),
    );
  },
  getTopup: async (id, expectedAmountCents, expectedMethod) => {
    if (typeof expectedAmountCents !== 'number' || !Number.isSafeInteger(expectedAmountCents) || expectedAmountCents < 0) throw new Error('topup_expectation_required');
    return topupStatusResponse(await httpRequest<unknown>('GET', `/topup/${encodeURIComponent(id)}`), { id, amountCents: expectedAmountCents, method: expectedMethod });
  },
  getClabe: () => httpRequest<ClabeResponse>('GET', '/wallet/clabe'),

  createTransfer: async (req, expectation, intent) =>
    withPreparedMonetaryRequest(
      'transfer',
      intent,
      req,
      undefined,
      async (session) => transferResponse(await httpRequest<unknown>('POST', '/transfers', req, session), req, expectation),
    ),
  listTransfers: () => httpRequest<TransfersResponse>('GET', '/transfers'),

  getPaymentMethods: () => httpRequest<PaymentMethodsResponse>('GET', '/payment-methods'),
  setDefaultPaymentMethod: async (id) => {
    await httpRequest('PATCH', `/payment-methods/${encodeURIComponent(id)}/default`);
  },
  removePaymentMethod: async (id) => {
    await httpRequest('DELETE', `/payment-methods/${encodeURIComponent(id)}`);
  },
  createSetupIntent: async (idempotencyKey, expectedSession) =>
    setupIntentResponse(await httpRequest<unknown>(
      'POST',
      '/payment-methods/setup-intent',
      { idempotency_key: idempotencyKey },
      expectedSession,
    )),
  attachPaymentMethod: async (stripePaymentMethodId, setAsDefault, expectedSession) =>
    attachPaymentMethodResponse(await httpRequest<unknown>('POST', '/payment-methods', {
      stripe_payment_method_id: stripePaymentMethodId,
      ...(setAsDefault !== undefined && { set_as_default: setAsDefault }),
    }, expectedSession), stripePaymentMethodId),

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
  addFriend: (query) => httpRequest<FriendRequestCreatedResponse>('POST', '/friends', query),
  getFriendRequests: (direction) =>
    httpRequest<FriendRequestsResponse>('GET', `/friends/requests?direction=${direction}`),
  acceptFriendRequest: async (requestId) => {
    await httpRequest('POST', `/friends/requests/${encodeURIComponent(requestId)}/accept`);
  },
  rejectFriendRequest: async (requestId) => {
    await httpRequest('POST', `/friends/requests/${encodeURIComponent(requestId)}/reject`);
  },
  cancelFriendRequest: async (requestId) => {
    await httpRequest('DELETE', `/friends/requests/${encodeURIComponent(requestId)}`);
  },
  blockUser: async (userId) => {
    await httpRequest('POST', `/friends/${encodeURIComponent(userId)}/block`);
  },
  unblockUser: async (userId) => {
    await httpRequest('DELETE', `/friends/${encodeURIComponent(userId)}/block`);
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
    const origin = loadSession();
    await mock.mockLogout();
    if (origin) invalidateSession(origin);
  },
  restoreSession: () => loadSession(),
  onSessionExpired: () => undefined,
  getMe: () => mock.mockGetMe(),
  getRestaurant: (id) => mock.mockGetRestaurant(id),

  getBalance: () => mock.mockBalance(),
  getWalletTransactions: () => mock.mockWalletTransactions(),
  getHistory: (params) => mock.mockHistory(params),

  getOpenMesas: () => mock.mockOpenMesas(),
  getMesa: (code, guestToken) => mock.mockGetMesa(code, guestToken ? 'guest' : 'user'),
  scanTicket: () => mock.mockScanTicket(),
  createMesa: async (req, intent) =>
    withPreparedMonetaryRequest(
      'create_mesa',
      intent,
      req,
      undefined,
      async () => createMesaResponse(await mock.mockCreateMesa(req), req),
    ),
  async confirmGuarantee3ds(code) {
    const result = await mock.mockConfirmGuarantee3ds(code);
    return { ...result, outcome: result.status === 'open' ? 'success' as const : 'ambiguous' as const };
  },
  lockItems: (code, items, guestToken) => mock.mockLockItems(code, items, guestToken ? 'guest' : 'user'),
  payMesa: async (code, req, guestToken, expectation, intent) =>
    withPreparedMonetaryRequest(
      `mesa_pay:${code}`,
      intent,
      req,
      guestToken,
      async () => payMesaResponse(await mock.mockPayMesa(code, req, guestToken ? 'guest' : 'user'), req, expectation),
    ),
  createInvitation: async (code, idempotencyKey) => invitationResponse(await mock.mockCreateInvitation(code, idempotencyKey), 'link', code),
  inviteFriend: async (code, paymeId, idempotencyKey) => invitationResponse(await mock.mockInviteFriend(code, paymeId, idempotencyKey), 'in_app', code),

  topupOxxo: async (amountCents, intent) =>
    withPreparedMonetaryRequest(
      'topup_oxxo',
      intent,
      { amount_cents: amountCents, idempotency_key: intent.key },
      undefined,
      async () => topupOxxoResponse(await mock.mockTopupOxxo(amountCents, intent.key), amountCents),
    ),
  topupCard: async (amountCents, paymentMethodId, intent) =>
    withPreparedMonetaryRequest(
      'topup_card',
      intent,
      { amount_cents: amountCents, payment_method_id: paymentMethodId, idempotency_key: intent.key },
      undefined,
      async () => topupCardResponse(await mock.mockTopupCard(amountCents, paymentMethodId, intent.key), amountCents),
    ),
  getTopup: async () => { throw new Error('topup_reconciliation_unavailable_in_mock'); },
  getClabe: () => mock.mockGetClabe(),

  createTransfer: async (req, expectation, intent) =>
    withPreparedMonetaryRequest('transfer', intent, req, undefined, async () => transferResponse(await mock.mockCreateTransfer(req), req, expectation)),
  listTransfers: () => mock.mockListTransfers(),

  getPaymentMethods: () => mock.mockPaymentMethods(),
  setDefaultPaymentMethod: (id) => mock.mockSetDefaultPaymentMethod(id),
  removePaymentMethod: (id) => mock.mockRemovePaymentMethod(id),
  createSetupIntent: async (idempotencyKey) => setupIntentResponse(await mock.mockCreateSetupIntent(idempotencyKey)),
  attachPaymentMethod: async (pmId, setAsDefault) => attachPaymentMethodResponse(await mock.mockAttachPaymentMethod(pmId, setAsDefault), pmId),

  getNotifications: () => mock.mockNotifications(),
  getUnreadCount: () => mock.mockUnreadCount(),
  markAllNotificationsRead: () => mock.mockMarkAllNotificationsRead(),
  getPendingInvitations: () => mock.mockPendingInvitations(),
  acceptInvitation: (id) => mock.mockAcceptInvitation(id),

  getStats: () => mock.mockStats(),

  getFriends: () => mock.mockFriends(),
  addFriend: (query) => mock.mockAddFriend(query),
  getFriendRequests: (direction) => mock.mockFriendRequests(direction),
  acceptFriendRequest: (requestId) => mock.mockAcceptFriendRequest(requestId),
  rejectFriendRequest: (requestId) => mock.mockRejectFriendRequest(requestId),
  cancelFriendRequest: (requestId) => mock.mockCancelFriendRequest(requestId),
  blockUser: (userId) => mock.mockBlockUser(userId),
  unblockUser: (userId) => mock.mockUnblockUser(userId),
  removeFriend: (friendId) => mock.mockRemoveFriend(friendId),
  getGroups: () => mock.mockGroups(),
  getGroup: (id) => mock.mockGroupDetail(id),
  createGroup: (name, icon) => mock.mockCreateGroup(name, icon),
  addGroupMember: (groupId, friendId) => mock.mockAddGroupMember(groupId, friendId),
  removeGroupMember: (groupId, friendId) => mock.mockRemoveGroupMember(groupId, friendId),
  deleteGroup: (groupId) => mock.mockDeleteGroup(groupId),
};

export const api: Api = IS_MOCK ? mockApi : realApi;
