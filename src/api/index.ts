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
import type {
  BalanceResponse,
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
  OcrResponse,
  OpenMesasResponse,
  PayMesaRequest,
  PayMesaResponse,
  PaymentMethodsResponse,
  RegisterRequest,
  TopupCardResponse,
  TopupOxxoResponse,
  TransfersResponse,
  WalletTransactionsResponse,
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
  // mesas
  getOpenMesas(): Promise<OpenMesasResponse>;
  getMesa(code: string, guestToken?: string): Promise<MesaDetailResponse>;
  scanTicket(image?: Blob): Promise<OcrResponse>;
  createMesa(req: CreateMesaRequest): Promise<CreateMesaResponse>;
  /** Mock: simula la confirmación 3DS de la garantía. En T7: Stripe.js. */
  confirmGuarantee3ds(code: string, clientSecret: string): Promise<{ status: string }>;
  lockItems(code: string, itemIds: string[], guestToken?: string): Promise<LockItemsResponse>;
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
  // social
  getFriends(): Promise<FriendsResponse>;
  addFriend(query: { email?: string; payme_id?: string }): Promise<Friend>;
  removeFriend(friendId: string): Promise<void>;
  getGroups(): Promise<GroupsResponse>;
  getGroup(id: string): Promise<GroupDetailResponse>;
  createGroup(name: string, icon?: string): Promise<void>;
  addGroupMember(groupId: string, friendId: string): Promise<void>;
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
  async confirmGuarantee3ds() {
    // T7: acá va stripe.confirmCardPayment(clientSecret) + poll de la mesa
    // hasta que el webhook amount_capturable_updated la abra.
    throw new Error('confirmGuarantee3ds real llega en T7 (Stripe.js)');
  },
  lockItems: (code, itemIds, guestToken) =>
    guestToken
      ? httpGuestRequest<LockItemsResponse>(
          'POST',
          `/mesas/${encodeURIComponent(code)}/items/lock`,
          guestToken,
          { item_ids: itemIds },
        )
      : httpRequest<LockItemsResponse>('POST', `/mesas/${encodeURIComponent(code)}/items/lock`, {
          item_ids: itemIds,
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

  getOpenMesas: () => mock.mockOpenMesas(),
  getMesa: (code, guestToken) => mock.mockGetMesa(code, guestToken ? 'guest' : 'user'),
  scanTicket: () => mock.mockScanTicket(),
  createMesa: (req) => mock.mockCreateMesa(req),
  confirmGuarantee3ds: (code) => mock.mockConfirmGuarantee3ds(code),
  lockItems: (code, itemIds, guestToken) =>
    mock.mockLockItems(code, itemIds, guestToken ? 'guest' : 'user'),
  payMesa: (code, req, guestToken) => mock.mockPayMesa(code, req, guestToken ? 'guest' : 'user'),
  createInvitation: (code) => mock.mockCreateInvitation(code),

  topupOxxo: (amountCents) => mock.mockTopupOxxo(amountCents),
  topupCard: (amountCents, paymentMethodId) => mock.mockTopupCard(amountCents, paymentMethodId),
  getClabe: () => mock.mockGetClabe(),

  createTransfer: (req) => mock.mockCreateTransfer(req),
  listTransfers: () => mock.mockListTransfers(),

  getPaymentMethods: () => mock.mockPaymentMethods(),

  getFriends: () => mock.mockFriends(),
  addFriend: (query) => mock.mockAddFriend(query),
  removeFriend: (friendId) => mock.mockRemoveFriend(friendId),
  getGroups: () => mock.mockGroups(),
  getGroup: (id) => mock.mockGroupDetail(id),
  createGroup: (name, icon) => mock.mockCreateGroup(name, icon),
  addGroupMember: (groupId, friendId) => mock.mockAddGroupMember(groupId, friendId),
};

export const api: Api = IS_MOCK ? mockApi : realApi;
