import {
  httpGoogleContinue,
  httpGuestRequest,
  httpLogin,
  httpLogout,
  httpNoContentRequest,
  httpOcrUploadRequest,
  httpPrivateAvatarRequest,
  httpPrivateJsonRequest,
  httpPrivateJsonMutationRequest,
  httpPublicRequest,
  httpRegister,
  httpRequest,
  httpRequestWithHeaders,
  httpSocialSession,
  invalidateSessionSerialized,
  runWithSessionStateLock,
  setOnLegalAcceptanceRequired,
  setOnSessionExpired,
  type UploadProgress,
} from './http';
import * as mock from './mock/mockApi';
import {
  acceptInvitationLinkResponse,
  acceptInvitationResponse,
  attachPaymentMethodResponse,
  friendRequestCancelledResponse,
  friendRequestCreatedResponse,
  friendRequestsResponse,
  invitationResponse,
  informativeSelectionResponse,
  legalAcceptanceResponse,
  legalTextResponse,
  mesaCreationResponse,
  ocrResponse,
  setupIntentResponse,
} from './contractResponses';
import { decodeMisMesas, type PaginaMisMesas } from './misMesas';
import { decodeSoltarConsumo, type ConsumoSoltado } from './soltarConsumo';
import { decodeMesaCerrada, type MesaCerrada } from './cerrarMesa';
import { decodeParticipantes, type Participante } from './participantes';
import { decodeTusRestaurantes, type TusRestaurantes } from './tusRestaurantes';
import {
  decodeFriendAvatarNotice,
  type FriendAvatarNoticeAcknowledgement,
  type FriendAvatarNoticeState,
} from './friendAvatarNotice';
import { decodeNotificationPreferences } from './notificationPreferences';
import { rutaConPeriodo, type ClavePeriodo } from './periodoEstadisticas';
import { decodePlatos, type PlatosDelPeriodo } from './platos';
import { decodeEvolucion, type Evolucion } from './evolucion';
import { decodeMomentos, type MomentosDelPeriodo } from './momentos';
import { decodeIngredientes, type IngredientesDelPeriodo } from './ingredientes';
import { extractApiError } from './errors';
import {
  assertProfileIdentityEnabled,
  assertShortfallDetailEnabled,
} from './privateFeatures';
import {
  decodeProfileAvatarResponse,
  decodeProfileIdentityResponse,
  validateAvatarInput,
  type PrivateAvatarBlob,
} from './profileIdentity';
import { decodeShortfallDetailResponse, type ShortfallDetail } from './shortfallDetail';
import { decodeMovementDetailResponse } from './movementDetail';
import { decodeRestaurantResolution } from './restaurantResolution';
import { withPreparedMonetaryRequest, type MonetaryIntentHandle } from './idempotency';
import { guaranteeOutcome } from './paymentStatus';
import { loadSession, type SessionStateWitness, type StoredSession } from './storage';
import { decodeFacebookStartResponse } from './facebookAuthFlow';
import {
  decodeGoogleLinkResponse,
  decodeLinkedProvidersResponse,
  socialAuthSnapshot,
  type GoogleContinueLinkRequest,
  type GoogleContinueRequest,
  type GoogleLinkRequest,
  type GoogleLinkResult,
  type LinkedProvider,
} from './socialAuth';
import {
  decodeRecoveryCompleteResponse,
  decodeRecoveryRequestResponse,
} from './recoveryFlow';
import { confirmCardPayment } from './stripe';
import { createMesaResponse, payMesaResponse, topupCardResponse, topupOxxoResponse, topupStatusResponse, transferResponse, type PayMesaExpectation, type TransferExpectation } from './moneyGuards';
import type {
  AcceptInvitationLinkResponse,
  AppConfig,
  BalanceResponse,
  AttachPaymentMethodResponse,
  MeResponse,
  LegalAcceptanceRequest,
  LegalAcceptanceResponse,
  NotificationPreferencesPut,
  NotificationPreferencesResponse,
  LegalTextKind,
  LegalTextResponse,
  RestaurantResponse,
  RestaurantResolutionRequest,
  RestaurantResolutionResponse,
  LockFractionRequest,
  ClabeResponse,
  CreateInvitationResponse,
  CreateSetupIntentResponse,
  CreateMesaRequest,
  CreateMesaResponse,
  MesaCreationLookup,
  CreateTransferRequest,
  CreateTransferResponse,
  FriendRequestCreatedResponse,
  FacebookCompleteRequest,
  FacebookRegisterStartRequest,
  FacebookStartResponse,
  FriendsResponse,
  GroupDetailResponse,
  GoogleRegisterRequest,
  GroupsResponse,
  IncomingFriendRequestsResponse,
  LockItemsResponse,
  MesaDetailResponse,
  NotificationsResponse,
  OcrResponse,
  OpenMesasResponse,
  OutgoingFriendRequestsResponse,
  PayMesaRequest,
  PayMesaResponse,
  PaymentMethodsResponse,
  ProfileAvatarResponse,
  ProfileIdentityResponse,
  RecoveryCompleteResponse,
  RecoveryRequestResponse,
  PendingInvitationsResponse,
  RegisterRequest,
  StatsResponse,
  TopupCardResponse,
  TopupOxxoResponse,
  TopupStatusResponse,
  TransfersResponse,
  WalletTransactionsResponse,
  HistoryResponse,
  InformativeSelectionResponse,
  ReplaceInformativeSelectionRequest,
  MovementDetailResponse,
} from './types';

export type { UploadProgress } from './http';

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
 * Riel saldo PayMe: **APAGADO en real y mock**, y desde OLA 5D **el que lo
 * declara apagado es el BACKEND**.
 *
 * Acá había una constante `WALLET_RAIL_ENABLED = false`. Se eliminó a
 * propósito, y la eliminación es media corrección: mientras existiera, alguien
 * podía leerla en vez de leer la capability, y un deploy de este front con otro
 * valor reencendía el riel sin que el backend se enterara. Sacarla convierte
 * esa omisión silenciosa en un error de compilación en cada consumidor.
 *
 * El estado vive en `./walletRail`: `useWalletRail()` en pantallas,
 * `readWalletRail()` para la lógica pura. Lee `GET /api/config` →
 * `features.wallet_rail` y **falla cerrado**.
 *
 * **Nada se borra.** Pantallas, adaptadores, tipos, schema e historia siguen
 * DURMIENTES: `TopupScreen` y `TransferScreen` siguen en el árbol, los ocho
 * métodos del riel siguen en esta fachada, y `payment_type: 'wallet'` sigue
 * siendo legal en los decoders porque el contrato del backend lo conserva.
 */


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
 * Techo del multipart del OCR, espejado de `routes/ocr.js:49`
 * (`limits: { fileSize: 8 * 1024 * 1024 }` → 413 `image_too_large`).
 *
 * Se exporta porque la pantalla de Escanear (§1.6) tiene que avisar del límite
 * ANTES de subir: con mala señal, mandar 12 MB para que el backend los rechace
 * es un minuto perdido en la mesa. La guarda de abajo se conserva igual — el
 * adaptador no confía en que la pantalla haya mirado.
 */
export const MAX_TICKET_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * La ESCRITURA de una vinculación no existe en la fachada con la capability
 * apagada, igual que las operaciones de `profile_identity`: la pantalla la
 * oculta, y esto es la segunda capa para que ningún otro camino la dispare.
 * La lectura de `linked-providers` no se gatea: el dueño la sirve sólo por
 * sesión y es un dato de la propia cuenta.
 */
function assertGoogleLinkingEnabled(): void {
  if (!socialAuthSnapshot().google.linking) throw new Error('google_linking_not_available');
}

export interface Api {
  /**
   * `GET /api/config`. Público (sin sesión) y de solo lectura. Lo consume
   * `walletRail.ts` para la capability del riel saldo.
   *
   * Pasa por la fachada —y no por un `fetch` suelto— para que el mock recorra
   * EL MISMO camino: un mock que se saltee la capability no la respetaría, la
   * ignoraría, y volvería a enseñar el comportamiento que se eliminó.
   */
  getConfig(): Promise<AppConfig>;
  /** Aviso vigente que debe ponerse a disposición antes del alta. Público. */
  getPrivacyNotice(): Promise<LegalTextResponse>;
  /**
   * LEGAL-3.0.0 (AF1) · cualquier texto legal público por su `kind`. Los
   * Términos y el aviso simplificado se leen por acá cuando el dueño los sirva;
   * `getPrivacyNotice` conserva su camino literal.
   */
  getLegalText(kind: LegalTextKind): Promise<LegalTextResponse>;
  /**
   * LEGAL-3.0.0 (AF1) · estado de aceptación del paquete legal vigente
   * (`GET /api/legal/acceptance`, con sesión). Con el paquete apagado en el
   * dueño: `{required:false, aviso:null, terminos:null}`. La puerta llega en AF2.
   */
  getLegalAcceptance(expectedSession: StoredSession): Promise<LegalAcceptanceResponse>;
  /**
   * AF2 · Configuración › Notificaciones (E1 del dueño, v2.128.0): sólo correo.
   * Privado: `no-store`, `Vary: Authorization`, sin ETag, como el aviso de foto.
   */
  getNotificationPreferences(expectedSession: StoredSession): Promise<NotificationPreferencesResponse>;
  /** `PUT` de uno o más ítems editables; responde el DTO completo. */
  putNotificationPreferences(body: NotificationPreferencesPut, expectedSession: StoredSession): Promise<NotificationPreferencesResponse>;
  /** `POST /api/legal/acceptance`: acepta el par vigente con la declaración 18+. Idempotente. */
  acceptLegal(acceptance: LegalAcceptanceRequest, expectedSession: StoredSession): Promise<LegalAcceptanceResponse>;
  // auth
  login(email: string, password: string): Promise<StoredSession>;
  register(data: RegisterRequest): Promise<StoredSession>;
  googleLogin(idToken: string): Promise<StoredSession>;
  googleRegister(data: GoogleRegisterRequest): Promise<StoredSession>;
  /**
   * AF-17 · v2.92.0 · «Continuar con Google» entra o crea la cuenta en un toque.
   * Sólo con `features.google_continue.supported`; sin ella, `googleLogin` y
   * `googleRegister` como en 0.167.0.
   */
  googleContinue(data: GoogleContinueRequest): Promise<{ readonly created: boolean }>;
  /** AF-17 · completa un `409 link_required` con la contraseña de la cuenta. */
  googleContinueLink(data: GoogleContinueLinkRequest): Promise<{ readonly created: boolean }>;
  /**
   * AF-09 · D-LOGIN-1 «Vincular desde la cuenta». Las dos exigen la sesión de
   * ESA cuenta: el dueño nunca responde por otra, ni por parámetro.
   */
  getLinkedProviders(expectedSession: StoredSession): Promise<readonly LinkedProvider[]>;
  googleLink(data: GoogleLinkRequest, expectedSession: StoredSession): Promise<GoogleLinkResult>;
  facebookLoginStart(): Promise<FacebookStartResponse>;
  facebookRegisterStart(data: FacebookRegisterStartRequest): Promise<FacebookStartResponse>;
  facebookLoginComplete(
    data: FacebookCompleteRequest,
    expectedStateWitness: SessionStateWitness,
  ): Promise<StoredSession>;
  facebookRegisterComplete(
    data: FacebookCompleteRequest,
    expectedStateWitness: SessionStateWitness,
  ): Promise<StoredSession>;
  requestRecovery(email: string): Promise<RecoveryRequestResponse>;
  completeRecovery(token: string, newPassword: string): Promise<RecoveryCompleteResponse>;
  logout(): Promise<void>;
  restoreSession(): StoredSession | null;
  onSessionExpired(cb: (() => void) | null): void;
  /** AF2 · LEGAL-3.0.0: el dueño contestó 428 `legal_acceptance_required` (AB2); la app abre la puerta. */
  onLegalAcceptanceRequired(cb: (() => void) | null): void;
  /** Perfil propio (G-02, v2.20) — hidrata sesiones persistidas sin `user`. */
  getMe(): Promise<MeResponse>;
  /** GET propio estricto, sólo detrás de `profile_identity`. */
  getProfileIdentity(expectedSession: StoredSession): Promise<ProfileIdentityResponse>;
  updateProfileIdentity(
    name: { first_name: string; last_name: string },
    expectedSession: StoredSession,
  ): Promise<ProfileIdentityResponse>;
  getProfileAvatar(expectedSession: StoredSession): Promise<PrivateAvatarBlob>;
  putProfileAvatar(
    image: Blob,
    expectedRevision: string | null,
    expectedSession: StoredSession,
  ): Promise<ProfileAvatarResponse>;
  deleteProfileAvatar(expectedRevision: string, expectedSession: StoredSession): Promise<void>;
  /** Resolver el uuid del QR de la mesa (G-01, v2.21). Público, 404 si no está activo. */
  getRestaurant(id: string): Promise<RestaurantResponse>;
  /** Identidad del ticket → restaurante público o registro privado record-only. */
  resolveRestaurant(req: RestaurantResolutionRequest): Promise<RestaurantResolutionResponse>;
  // cuenta
  getBalance(): Promise<BalanceResponse>;
  getWalletTransactions(): Promise<WalletTransactionsResponse>;
  /**
   * Pagos propios en mesas (GET /account/history). OJO: el backend pagina
   * con limit default 20 (máx 100) — para agregados (la torta de Cuenta)
   * pedir `from` + `limit`, no la primera página pelada.
   */
  getHistory(params?: { from?: string; to?: string; limit?: number; offset?: number }): Promise<HistoryResponse>;
  /**
   * AF-24 · «Tus mesas» · `GET /api/mesas/mine`. Sólo las mesas propias, de a
   * `limit` (dueño: 20 por defecto, 50 máximo) con el cursor opaco del dueño.
   */
  getMyMesas(params?: { cursor?: string; limit?: number; detail?: 'items' }): Promise<PaginaMisMesas>;
  /** Detalle de UN pago propio; el backend vuelve a validar `user_id`. */
  getMovement(id: string): Promise<MovementDetailResponse>;
  // mesas
  getOpenMesas(): Promise<OpenMesasResponse>;
  getMesa(code: string, guestToken?: string): Promise<MesaDetailResponse>;
  getInformativeSelection(code: string): Promise<InformativeSelectionResponse>;
  replaceInformativeSelection(code: string, req: ReplaceInformativeSelectionRequest): Promise<InformativeSelectionResponse>;
  scanTicket(image?: Blob, onUploadProgress?: (progress: UploadProgress) => void): Promise<OcrResponse>;
  createMesa(req: CreateMesaRequest, intent: MonetaryIntentHandle): Promise<CreateMesaResponse>;
  /**
   * ORDEN 2A · `GET /mesas/creations/:idempotency_key` (backend v2.47.0).
   * La evidencia EXACTA de una apertura ambigua. **De solo lectura: no mueve
   * un centavo ni crea una segunda mesa.** Diagnóstico; la acción es aparte.
   */
  getMesaCreation(idempotencyKey: string, payloadHash?: string): Promise<MesaCreationLookup>;
  /** Mock: simula la confirmación 3DS de la garantía. En T7: Stripe.js. */
  /** @param connectedAccountId v2.24: si el hold vive en la cuenta del restaurante. */
  confirmGuarantee3ds(
    code: string,
    clientSecret: string,
    connectedAccountId?: string,
  ): Promise<{ status: string; outcome: 'success' | 'definitive' | 'ambiguous'; error?: string }>;
  lockItems(code: string, items: LockFractionRequest[], guestToken?: string): Promise<LockItemsResponse>;
  /** AF-25 · n80 · suelta lo propio no pagado; `[]` si no había nada que soltar. */
  releaseItems(code: string, itemIds: readonly string[]): Promise<readonly ConsumoSoltado[]>;
  /** AF-34 · n98 · el organizador cierra la mesa sin garantía. La confirmación la pide la pantalla. */
  closeMesa(code: string): Promise<MesaCerrada>;
  /**
   * AF-25 · n72 · quiénes se sumaron. SÓLO el organizador: a un no-organizador
   * la pantalla ni lo pide (403 `not_mesa_organizer`).
   */
  getMesaParticipants(code: string): Promise<readonly Participante[]>;
  /**
   * AF-32 · v2.110.0 · la foto de alguien que se sumó, sólo para el organizador.
   * Con sesión, `private, no-store`, JPEG: el mismo canal validado que la foto
   * propia. 404 `avatar_not_found` para todo lo demás.
   */
  getParticipantAvatar(code: string, participantId: string, expectedSession: StoredSession): Promise<PrivateAvatarBlob>;
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
  getShortfallDetail(
    mesaCode: string,
    expectedShortfallCents: number,
    expectedSession: StoredSession,
  ): Promise<ShortfallDetail>;
  getUnreadCount(): Promise<{ unread_count: number }>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  getPendingInvitations(): Promise<PendingInvitationsResponse>;
  acceptInvitation(id: string): Promise<{ accepted: boolean }>;
  /**
   * CIERRE DEL PAGO SIN CUENTA (v2.32.0) · canjea el token de un link por una
   * INSCRIPCIÓN. **Requiere sesión**: es el único camino nuevo para sumarse a
   * una mesa por link.
   *
   * El link es MULTIUSO, así que canjearlo no lo consume para los demás.
   * Canjear dos veces es idempotente: deja una sola inscripción activa.
   *
   * Errores del contrato: `400 invitation_token_required` · `401` sin sesión ·
   * `403 invitation_link_not_valid` · `503 invitation_link_unavailable`.
   * Los CUATRO motivos de rechazo —inválido, vencido, cancelado y
   * supersedido— comparten el 403 a propósito: distinguirlos le diría a un
   * desconocido si una mesa existe. El front no debe inventar copy que los
   * separe (misma doctrina que el 202 ciego de `addFriend`).
   */
  acceptInvitationLink(token: string): Promise<AcceptInvitationLinkResponse>;
  // stats
  /** AF-31 · con `period`, `?period=` (dueño v2.106.0); sin él, el mes en curso. */
  getStats(period?: ClavePeriodo): Promise<StatsResponse>;
  /** AF-29 · n165 · «Tus restaurantes» (2b). 404 = backend anterior. */
  getStatsRestaurants(period?: ClavePeriodo): Promise<TusRestaurantes>;
  /** AF-31 · n166 · «Qué comes» por platos (2c). 404 = backend anterior. */
  getStatsDishes(period?: ClavePeriodo): Promise<PlatosDelPeriodo>;
  /** AF-31 · n167 · «Evolución» (2f): los últimos 6 meses, sin parámetros. */
  getStatsEvolution(): Promise<Evolucion>;
  /** AF-32 · «por momento del día» (2e). 404 = backend anterior. */
  getStatsDayparts(period?: ClavePeriodo): Promise<MomentosDelPeriodo>;
  /** AF-38 · n168 · «por ingrediente» (2d). 404 = backend anterior. */
  getStatsIngredients(period?: ClavePeriodo): Promise<IngredientesDelPeriodo>;
  // social
  getFriends(): Promise<FriendsResponse>;
  /** Estado privado del acuse específico de la audiencia de fotos entre amigos. */
  getFriendAvatarNotice(expectedSession: StoredSession): Promise<FriendAvatarNoticeState>;
  /** Único acto que registra el acuse: versión y hash efectivamente mostrados. */
  acknowledgeFriendAvatarNotice(
    acknowledgement: FriendAvatarNoticeAcknowledgement,
    expectedSession: StoredSession,
  ): Promise<FriendAvatarNoticeState>;
  /** JPEG privado; cualquier ausencia/denegación comparte el fallback 404 del dueño. */
  getFriendAvatar(friendId: string, expectedSession: StoredSession): Promise<PrivateAvatarBlob>;
  /**
   * C1/C2 (v2.29): ya NO crea amistad ni dice si la persona existe. Responde
   * 202 `{ requested: true }` en todos los casos. La UI no puede afirmar nada
   * sobre el destinatario.
   */
  addFriend(query: { email?: string; payme_id?: string }): Promise<FriendRequestCreatedResponse>;
  getIncomingFriendRequests(): Promise<IncomingFriendRequestsResponse>;
  getOutgoingFriendRequests(): Promise<OutgoingFriendRequestsResponse>;
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

/**
 * ORDEN 2A · el 404 y el 409 de `GET /mesas/creations/:key` **son respuestas
 * del contrato, no fallas**: `not_found` y `payload_hash_conflict` traen su
 * cuerpo y su `outcome`. Sin esto, "no existe ninguna creación con tu clave"
 * llegaría a la pantalla como "no pudimos consultar", que es justo la
 * confusión que este endpoint viene a terminar.
 *
 * **Cualquier otro error se relanza**, y ahí sí el caller conserva el freeze:
 * un 401, un 500 o una red caída no dicen nada sobre la creación. Y un 404/409
 * cuyo cuerpo no decodifica tampoco se interpreta — se relanza el error
 * original, que es más honesto que fabricar un `not_found`.
 *
 * Vale para los dos rieles: `extractApiError` normaliza `HttpError` (real) y
 * `MockApiError` (mock) al mismo `{code, extra, status}`.
 */
function creacionDesdeError(err: unknown): MesaCreationLookup {
  const { extra, status } = extractApiError(err);
  if (status !== 404 && status !== 409) throw err;
  try {
    return mesaCreationResponse(extra);
  } catch {
    throw err;
  }
}

const realApi: Api = {
  getConfig: () => httpPublicRequest<AppConfig>('GET', '/config'),
  getPrivacyNotice: async () => legalTextResponse(
    await httpPublicRequest<unknown>('GET', '/legal/aviso_privacidad'),
  ),
  getLegalText: async (kind) => legalTextResponse(
    await httpPublicRequest<unknown>('GET', `/legal/${encodeURIComponent(kind)}`), kind,
  ),
  // LEGAL-3.0.0 (AF1) · forma exacta publicada por App Backend - Opus para AB1
  // (DISENO_AB1.md §3): GET y POST comparten ruta y forma; con la bandera
  // apagada el GET responde `{required:false, aviso:null, terminos:null}`.
  getLegalAcceptance: async (expectedSession) => legalAcceptanceResponse(
    await httpRequest<unknown>('GET', '/legal/acceptance', undefined, expectedSession),
  ),
  getNotificationPreferences: async (expectedSession) => decodeNotificationPreferences(
    await httpPrivateJsonRequest<unknown>(
      '/notifications/preferences', expectedSession, 30_000,
      { requireAuthorizationVary: true, forbidEtag: true },
    ),
  ),
  putNotificationPreferences: async (body, expectedSession) => decodeNotificationPreferences(
    await httpPrivateJsonMutationRequest<unknown>(
      '/notifications/preferences', body, expectedSession, 30_000, 'PUT',
    ),
  ),
  acceptLegal: async (acceptance, expectedSession) => legalAcceptanceResponse(
    await httpRequest<unknown>('POST', '/legal/acceptance', acceptance, expectedSession),
  ),
  login: (email, password) => httpLogin(email, password),
  register: (data) => httpRegister(data),
  googleLogin: (idToken) => httpSocialSession('/auth/google/login', { id_token: idToken }),
  googleRegister: (data) => httpSocialSession('/auth/google/register', data),
  googleContinue: (data) => httpGoogleContinue('/auth/google/continue', data),
  googleContinueLink: (data) => httpGoogleContinue('/auth/google/continue/link', data),
  // `private, no-store` es contrato del dueño para esta ruta: el lector
  // privado lo EXIGE, igual que para `/account/me`.
  getLinkedProviders: async (expectedSession) => decodeLinkedProvidersResponse(
    await httpPrivateJsonRequest<unknown>('/account/me/linked-providers', expectedSession),
  ),
  googleLink: async (data, expectedSession) => {
    assertGoogleLinkingEnabled();
    return decodeGoogleLinkResponse(
      await httpRequest<unknown>('POST', '/auth/google/link', data, expectedSession),
    );
  },
  facebookLoginStart: async () => decodeFacebookStartResponse(
    await httpPublicRequest<unknown>('POST', '/auth/facebook/login/start', {}),
  ),
  facebookRegisterStart: async (data) => decodeFacebookStartResponse(
    await httpPublicRequest<unknown>('POST', '/auth/facebook/register/start', data),
  ),
  facebookLoginComplete: (data, expectedStateWitness) => httpSocialSession(
    '/auth/facebook/login/complete',
    data,
    expectedStateWitness,
  ),
  facebookRegisterComplete: (data, expectedStateWitness) => httpSocialSession(
    '/auth/facebook/register/complete',
    data,
    expectedStateWitness,
  ),
  requestRecovery: async (email) => decodeRecoveryRequestResponse(
    await httpPublicRequest<unknown>('POST', '/auth/recovery/request', { email }),
  ),
  completeRecovery: async (token, newPassword) => {
    const origin = loadSession();
    const response = decodeRecoveryCompleteResponse(
      await httpPublicRequest<unknown>('POST', '/auth/recovery/complete', {
        token,
        new_password: newPassword,
      }),
    );
    if (origin) await invalidateSessionSerialized(origin);
    return response;
  },
  logout: () => httpLogout(),
  restoreSession: () => loadSession(),
  onSessionExpired: (cb) => setOnSessionExpired(cb),
  onLegalAcceptanceRequired: (cb) => setOnLegalAcceptanceRequired(cb),
  // Compatibilidad de rollout: sesiones históricas pueden hidratarse contra
  // un backend previo al header privado. El lector estricto vive únicamente
  // detrás de la capability nueva, en `getProfileIdentity`.
  getMe: () => httpRequest<MeResponse>('GET', '/account/me'),
  getProfileIdentity: async (expectedSession) => {
    assertProfileIdentityEnabled();
    return decodeProfileIdentityResponse(
      await httpPrivateJsonRequest<unknown>('/account/me', expectedSession),
    );
  },
  updateProfileIdentity: async (name, expectedSession) => {
    assertProfileIdentityEnabled();
    return decodeProfileIdentityResponse(
      await httpRequest<unknown>('PATCH', '/account/me/profile', name, expectedSession),
    );
  },
  getProfileAvatar: async (expectedSession) => {
    assertProfileIdentityEnabled();
    return httpPrivateAvatarRequest('/account/me/avatar', expectedSession);
  },
  putProfileAvatar: async (image, expectedRevision, expectedSession) => {
    assertProfileIdentityEnabled();
    validateAvatarInput(image);
    const body = new FormData();
    body.append('avatar', image, 'avatar');
    const headers: Record<string, string> = expectedRevision === null
      ? {}
      : { 'If-Match': `"${expectedRevision}"` };
    return decodeProfileAvatarResponse(await httpRequestWithHeaders<unknown>(
      'PUT', '/account/me/avatar', body, headers, expectedSession,
    ));
  },
  deleteProfileAvatar: async (expectedRevision, expectedSession) => {
    assertProfileIdentityEnabled();
    await httpNoContentRequest(
      'DELETE', '/account/me/avatar', { 'If-Match': `"${expectedRevision}"` }, expectedSession,
    );
  },
  getRestaurant: (id) =>
    httpPublicRequest<RestaurantResponse>('GET', `/restaurants/${encodeURIComponent(id)}`),
  resolveRestaurant: async (req) => decodeRestaurantResolution(
    await httpRequest<unknown>('POST', '/restaurants/resolve', req),
  ),

  getBalance: () => httpRequest<BalanceResponse>('GET', '/account/balance'),
  getHistory: (params) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.limit) qs.set('limit', String(params.limit));
    // `offset` con `!= null` y no truthy: `offset=0` es la primera página y con
    // un `if (params.offset)` no se mandaba nunca. El emisor lo defaultea a 0
    // igual, pero un parámetro que se pierde en el caso más común es el que
    // nadie mira cuando la paginación sale mal.
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const s = qs.toString();
    return httpRequest<HistoryResponse>('GET', `/account/history${s ? `?${s}` : ''}`);
  },
  getMyMesas: async (params) => {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.detail) qs.set('detail', params.detail);
    const s = qs.toString();
    return decodeMisMesas(await httpRequest<unknown>('GET', `/mesas/mine${s ? `?${s}` : ''}`));
  },
  getMovement: async (id) => decodeMovementDetailResponse(
    await httpPrivateJsonRequest<unknown>(`/account/movements/${encodeURIComponent(id)}`),
  ),
  getWalletTransactions: () =>
    httpRequest<WalletTransactionsResponse>('GET', '/account/wallet-transactions'),

  getOpenMesas: () => httpRequest<OpenMesasResponse>('GET', '/mesas/open'),
  getMesa: (code, guestToken) =>
    guestToken
      ? httpGuestRequest<MesaDetailResponse>('GET', `/mesas/${encodeURIComponent(code)}`, guestToken)
      : httpRequest<MesaDetailResponse>('GET', `/mesas/${encodeURIComponent(code)}`),
  getInformativeSelection: async (code) => informativeSelectionResponse(
    await httpRequest<unknown>('GET', `/mesas/${encodeURIComponent(code)}/informative-selection`),
  ),
  replaceInformativeSelection: async (code, req) => informativeSelectionResponse(
    await httpRequest<unknown>('PUT', `/mesas/${encodeURIComponent(code)}/informative-selection`, req),
  ),
  async scanTicket(image, onUploadProgress) {
    // POST /api/ocr es multipart (campo `image`). Usa XHR sólo acá para medir
    // el upload; auth/refresh/timeout/HttpError siguen compartiendo la misma
    // maquinaria que el resto, sin cambiar el fetch del riel monetario.
    if (!image || image.size <= 0 || image.size > MAX_TICKET_IMAGE_BYTES) throw new Error('scanTicket requiere una imagen de hasta 8 MiB');
    const form = new FormData();
    form.append('image', image, 'ticket.jpg');
    return ocrResponse(await httpOcrUploadRequest<unknown>(form, onUploadProgress));
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
   * 🔴 NO pasa por `withPreparedMonetaryRequest` **a propósito**: eso es para
   * MUTACIONES —marca `sending`, cuenta reintentos, y en caso de error deja el
   * journal `ambiguous`—. Esto es un GET que no mueve nada; hacerlo pasar por
   * ahí ensuciaría el journal del intento que estamos tratando de diagnosticar.
   *
   * **ORDEN 2-A · ahora SÍ se manda `payload_hash`**, y lo que cambió no es la
   * opinión sino la evidencia. Antes no se mandaba porque replicar el
   * `payloadHash` del dueño de memoria era peligroso en la dirección fea: un
   * hash mal calculado devuelve **409 `payload_hash_conflict`**, que este
   * front lee como "conservá el freeze" — el error de réplica habría vuelto a
   * trabar al organizador. Con el dueño publicando sus vectores y el
   * algoritmo espejado, la réplica se acredita **ejecutando su propio JS**
   * (`scripts/payloadIdentity.mirror.test.ts`), no citándolo.
   *
   * 🔴 **El hash lo entrega el JOURNAL, no se recalcula acá.** Es el sello
   * congelado antes del primer envío, y por eso sobrevive al reload: si se
   * recalculara desde un payload reconstruido, un `pm_` nuevo o un ítem
   * reordenado darían otro valor y la consulta mentiría sobre lo que se
   * mandó. Y `readEconomicFingerprint` devuelve `null` cuando el sello es de
   * la versión vieja: un digest del request entero no es reproducible por el
   * dueño y garantizaría un 409.
   */
  getMesaCreation: async (idempotencyKey, payloadHash) => {
    const query = payloadHash ? `?payload_hash=${encodeURIComponent(payloadHash)}` : '';
    try {
      return mesaCreationResponse(
        await httpRequest<unknown>('GET', `/mesas/creations/${encodeURIComponent(idempotencyKey)}${query}`),
      );
    } catch (err) {
      return creacionDesdeError(err);
    }
  },
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
  getMesaParticipants: async (code) =>
    decodeParticipantes(await httpRequest<unknown>('GET', `/mesas/${encodeURIComponent(code)}/participants`)),
  getParticipantAvatar: (code, participantId, expectedSession) =>
    httpPrivateAvatarRequest(
      `/mesas/${encodeURIComponent(code)}/participants/${encodeURIComponent(participantId)}/avatar`,
      expectedSession,
    ),
  closeMesa: async (code) =>
    decodeMesaCerrada(await httpRequest<unknown>('POST', `/mesas/${encodeURIComponent(code)}/close`)),
  releaseItems: async (code, itemIds) =>
    decodeSoltarConsumo(await httpRequest<unknown>('POST', `/mesas/${encodeURIComponent(code)}/items/release`, {
      item_ids: [...itemIds],
    })),
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
  getShortfallDetail: async (mesaCode, expectedShortfallCents, expectedSession) => {
    assertShortfallDetailEnabled();
    return decodeShortfallDetailResponse(
      await httpPrivateJsonRequest<unknown>(
        `/mesas/${encodeURIComponent(mesaCode)}/shortfall-detail`, expectedSession,
      ),
      expectedShortfallCents,
    );
  },
  getUnreadCount: () => httpRequest<{ unread_count: number }>('GET', '/notifications/unread-count'),
  markNotificationRead: async (id) => {
    const response = await httpRequest<unknown>('PATCH', `/notifications/${encodeURIComponent(id)}/read`);
    if (typeof response !== 'object' || response === null || Array.isArray(response)
        || Object.keys(response).length !== 1 || !('read' in response) || response.read !== true) {
      throw new Error('notification_read_response_malformed');
    }
  },
  markAllNotificationsRead: async () => {
    await httpRequest('PATCH', '/notifications/read-all');
  },
  getPendingInvitations: () => httpRequest<PendingInvitationsResponse>('GET', '/invitations'),
  // Decodificado como su puerta hermana `accept-link`: un 2xx malformado no
  // acredita la inscripción (ver `acceptInvitationResponse`).
  acceptInvitation: async (id) =>
    acceptInvitationResponse(
      await httpRequest<unknown>('POST', `/invitations/${encodeURIComponent(id)}/accept`),
    ),
  acceptInvitationLink: async (token) =>
    acceptInvitationLinkResponse(
      await httpRequest<unknown>('POST', '/invitations/accept-link', { token }),
    ),

  getStats: (period) => httpRequest<StatsResponse>('GET', rutaConPeriodo('/account/stats', period)),
  getStatsDishes: async (period) =>
    decodePlatos(await httpRequest<unknown>('GET', rutaConPeriodo('/account/stats/dishes', period))),
  getStatsEvolution: async () => decodeEvolucion(await httpRequest<unknown>('GET', '/account/stats/evolution')),
  getStatsDayparts: async (period) =>
    decodeMomentos(await httpRequest<unknown>('GET', rutaConPeriodo('/account/stats/dayparts', period))),
  getStatsIngredients: async (period) =>
    decodeIngredientes(await httpRequest<unknown>('GET', rutaConPeriodo('/account/stats/ingredients', period))),
  getStatsRestaurants: async (period) =>
    decodeTusRestaurantes(
      await httpRequest<unknown>('GET', rutaConPeriodo('/account/stats/restaurants', period)),
    ),

  getFriends: () => httpRequest<FriendsResponse>('GET', '/friends'),
  getFriendAvatarNotice: async (expectedSession) => decodeFriendAvatarNotice(
    await httpPrivateJsonRequest<unknown>(
      '/friends/avatar-notice', expectedSession, 30_000,
      { requireAuthorizationVary: true, forbidEtag: true },
    ),
  ),
  acknowledgeFriendAvatarNotice: async (acknowledgement, expectedSession) => decodeFriendAvatarNotice(
    await httpPrivateJsonMutationRequest<unknown>(
      '/friends/avatar-notice', acknowledgement, expectedSession,
    ),
  ),
  getFriendAvatar: (friendId, expectedSession) => httpPrivateAvatarRequest(
    `/friends/${encodeURIComponent(friendId)}/avatar`, expectedSession, 15_000,
    { requireAuthorizationVary: true, forbidEtag: true },
  ),
  addFriend: async (query) => friendRequestCreatedResponse(
    await httpRequest<unknown>('POST', '/friends', query),
  ),
  getIncomingFriendRequests: async () => friendRequestsResponse(
    await httpRequest<unknown>('GET', '/friends/requests?direction=incoming'),
    'incoming',
  ),
  getOutgoingFriendRequests: async () => friendRequestsResponse(
    await httpRequest<unknown>('GET', '/friends/requests?direction=outgoing'),
    'outgoing',
  ),
  acceptFriendRequest: async (requestId) => {
    await httpRequest('POST', `/friends/requests/${encodeURIComponent(requestId)}/accept`);
  },
  rejectFriendRequest: async (requestId) => {
    await httpRequest('POST', `/friends/requests/${encodeURIComponent(requestId)}/reject`);
  },
  cancelFriendRequest: async (requestId) => {
    friendRequestCancelledResponse(
      await httpRequest<unknown>('DELETE', `/friends/requests/${encodeURIComponent(requestId)}`),
    );
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
  getConfig: () => mock.mockGetConfig(),
  getPrivacyNotice: async () => legalTextResponse(await mock.mockGetPrivacyNotice()),
  getLegalText: async (kind) => legalTextResponse(await mock.mockGetLegalText(kind), kind),
  getLegalAcceptance: async (expectedSession) => legalAcceptanceResponse(
    await mock.mockGetLegalAcceptance(expectedSession),
  ),
  getNotificationPreferences: async (expectedSession) => decodeNotificationPreferences(
    await mock.mockGetNotificationPreferences(expectedSession),
  ),
  putNotificationPreferences: async (body, expectedSession) => decodeNotificationPreferences(
    await mock.mockPutNotificationPreferences(body, expectedSession),
  ),
  acceptLegal: async (acceptance, expectedSession) => legalAcceptanceResponse(
    await mock.mockAcceptLegal(acceptance, expectedSession),
  ),
  login: (email, password) => runWithSessionStateLock(() => mock.mockLogin(email, password)),
  register: (data) => runWithSessionStateLock(() => mock.mockRegister(data)),
  googleLogin: (idToken) => mock.mockGoogleLogin(idToken),
  googleRegister: (data) => mock.mockGoogleRegister(data),
  googleContinue: (data) => mock.mockGoogleContinue(data),
  googleContinueLink: (data) => mock.mockGoogleContinueLink(data),
  getLinkedProviders: async () => decodeLinkedProvidersResponse(await mock.mockGetLinkedProviders()),
  googleLink: async (data) => {
    assertGoogleLinkingEnabled();
    return decodeGoogleLinkResponse(await mock.mockGoogleLink(data));
  },
  facebookLoginStart: () => mock.mockFacebookLoginStart(),
  facebookRegisterStart: (data) => mock.mockFacebookRegisterStart(data),
  facebookLoginComplete: (data, expectedStateWitness) => mock.mockFacebookLoginComplete(
    data,
    expectedStateWitness,
  ),
  facebookRegisterComplete: (data, expectedStateWitness) => mock.mockFacebookRegisterComplete(
    data,
    expectedStateWitness,
  ),
  requestRecovery: (email) => mock.mockRequestRecovery(email),
  completeRecovery: async (token, newPassword) => {
    const origin = loadSession();
    const response = await mock.mockCompleteRecovery(token, newPassword);
    if (origin) await invalidateSessionSerialized(origin);
    return response;
  },
  async logout() {
    const origin = loadSession();
    await mock.mockLogout();
    if (origin) await invalidateSessionSerialized(origin);
  },
  restoreSession: () => loadSession(),
  onSessionExpired: () => undefined,
  // El mock nunca contesta 428: la puerta se ejercita parchando la fachada.
  onLegalAcceptanceRequired: () => undefined,
  getMe: () => mock.mockGetMe(),
  getProfileIdentity: async () => {
    assertProfileIdentityEnabled();
    return mock.mockProfileIdentity();
  },
  updateProfileIdentity: async (name) => {
    assertProfileIdentityEnabled();
    return mock.mockUpdateProfileIdentity(name);
  },
  getProfileAvatar: async () => {
    assertProfileIdentityEnabled();
    return mock.mockProfileAvatar();
  },
  putProfileAvatar: async (image, expectedRevision) => {
    assertProfileIdentityEnabled();
    return mock.mockPutProfileAvatar(image, expectedRevision);
  },
  deleteProfileAvatar: async (expectedRevision) => {
    assertProfileIdentityEnabled();
    await mock.mockDeleteProfileAvatar(expectedRevision);
  },
  getRestaurant: (id) => mock.mockGetRestaurant(id),
  resolveRestaurant: async (req) => decodeRestaurantResolution(await mock.mockResolveRestaurant(req)),

  getBalance: () => mock.mockBalance(),
  getWalletTransactions: () => mock.mockWalletTransactions(),
  getHistory: (params) => mock.mockHistory(params),
  getMyMesas: async (params) => decodeMisMesas(await mock.mockMisMesas(params)),
  getMovement: async (id) => decodeMovementDetailResponse(await mock.mockMovement(id)),

  getOpenMesas: () => mock.mockOpenMesas(),
  getMesa: (code, guestToken) => mock.mockGetMesa(code, guestToken ? 'guest' : 'user'),
  getInformativeSelection: async (code) => informativeSelectionResponse(await mock.mockGetInformativeSelection(code)),
  replaceInformativeSelection: async (code, req) => informativeSelectionResponse(
    await mock.mockReplaceInformativeSelection(code, req),
  ),
  scanTicket: async () => ocrResponse(await mock.mockScanTicket()),
  createMesa: async (req, intent) =>
    withPreparedMonetaryRequest(
      'create_mesa',
      intent,
      req,
      undefined,
      async () => createMesaResponse(await mock.mockCreateMesa(req), req),
    ),
  getMesaCreation: async (idempotencyKey, payloadHash) => {
    try {
      return mesaCreationResponse(await mock.mockGetMesaCreation(idempotencyKey, payloadHash));
    } catch (err) {
      return creacionDesdeError(err);
    }
  },
  async confirmGuarantee3ds(code) {
    const result = await mock.mockConfirmGuarantee3ds(code);
    return { ...result, outcome: result.status === 'open' ? 'success' as const : 'ambiguous' as const };
  },
  lockItems: (code, items, guestToken) => mock.mockLockItems(code, items, guestToken ? 'guest' : 'user'),
  releaseItems: async (code, itemIds) => decodeSoltarConsumo(await mock.mockReleaseItems(code, itemIds, 'user')),
  closeMesa: async (code) => decodeMesaCerrada(await mock.mockCloseMesa(code, 'user')),
  getMesaParticipants: async (code) => decodeParticipantes(await mock.mockMesaParticipants(code, 'user')),
  getParticipantAvatar: (code, participantId) => mock.mockParticipantAvatar(code, participantId, 'user'),
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
  getShortfallDetail: async (mesaCode, expectedShortfallCents) => {
    assertShortfallDetailEnabled();
    const detail = await mock.mockShortfallDetail(mesaCode);
    return decodeShortfallDetailResponse({ shortfall_detail: detail }, expectedShortfallCents);
  },
  getUnreadCount: () => mock.mockUnreadCount(),
  markNotificationRead: (id) => mock.mockMarkNotificationRead(id),
  markAllNotificationsRead: () => mock.mockMarkAllNotificationsRead(),
  getPendingInvitations: () => mock.mockPendingInvitations(),
  acceptInvitation: async (id) => acceptInvitationResponse(await mock.mockAcceptInvitation(id)),
  acceptInvitationLink: async (token) =>
    acceptInvitationLinkResponse(await mock.mockAcceptInvitationLink(token)),

  getStats: (period) => mock.mockStats(period),
  getStatsDishes: async (period) => decodePlatos(await mock.mockStatsDishes(period)),
  getStatsEvolution: async () => decodeEvolucion(await mock.mockStatsEvolution()),
  getStatsDayparts: async (period) => decodeMomentos(await mock.mockStatsDayparts(period)),
  getStatsIngredients: async (period) => decodeIngredientes(await mock.mockStatsIngredients(period)),
  getStatsRestaurants: async (period) => decodeTusRestaurantes(await mock.mockStatsRestaurants(period)),

  getFriends: () => mock.mockFriends(),
  getFriendAvatarNotice: async (expectedSession) => decodeFriendAvatarNotice(
    await mock.mockFriendAvatarNotice(expectedSession),
  ),
  acknowledgeFriendAvatarNotice: async (acknowledgement, expectedSession) => decodeFriendAvatarNotice(
    await mock.mockAcknowledgeFriendAvatarNotice(acknowledgement, expectedSession),
  ),
  getFriendAvatar: (friendId, expectedSession) => mock.mockFriendAvatar(friendId, expectedSession),
  addFriend: async (query) => friendRequestCreatedResponse(await mock.mockAddFriend(query)),
  getIncomingFriendRequests: async () => friendRequestsResponse(
    await mock.mockFriendRequests('incoming'),
    'incoming',
  ),
  getOutgoingFriendRequests: async () => friendRequestsResponse(
    await mock.mockFriendRequests('outgoing'),
    'outgoing',
  ),
  acceptFriendRequest: (requestId) => mock.mockAcceptFriendRequest(requestId),
  rejectFriendRequest: (requestId) => mock.mockRejectFriendRequest(requestId),
  cancelFriendRequest: async (requestId) => {
    friendRequestCancelledResponse(await mock.mockCancelFriendRequest(requestId));
  },
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
