import { centsToDisplay, fractionAmount, splitEqual, sumCents, tipFromBps } from '../../utils/money';
import { payloadCanonical, sha256Hex } from '../../utils/payloadIdentity';
import {
  createSession,
  loadSession,
  saveSession,
  type SessionStateWitness,
  type StoredSession,
} from '../storage';
import { persistSocialSessionResponse } from '../http';
import type {
  AcceptInvitationLinkResponse,
  AppConfig,
  AttachPaymentMethodResponse,
  MeResponse,
  RestaurantResponse,
  BalanceResponse,
  ClabeResponse,
  CreateInvitationResponse,
  CreateMesaRequest,
  CreateMesaResponse,
  CreateSetupIntentResponse,
  CreateTransferRequest,
  CreateTransferResponse,
  FriendRequestCreatedResponse,
  FriendRequestCancelledResponse,
  FriendRequestDirection,
  FriendRequestsResponse,
  FriendsResponse,
  GroupDetailResponse,
  GroupsResponse,
  IncomingFriendRequestsResponse,
  LockItemsResponse,
  LegalTextResponse,
  MesaCreationOutcome,
  MesaDetailResponse,
  MesaStatus,
  NotificationsResponse,
  OcrResponse,
  OpenMesasResponse,
  OutgoingFriendRequestsResponse,
  PayMesaRequest,
  PayMesaResponse,
  PaymentMethod,
  PaymentMethodsResponse,
  PendingInvitationsResponse,
  ProfileAvatarResponse,
  ProfileIdentityResponse,
  StatsResponse,
  TransfersResponse,
  WalletTransactionsResponse,
  HistoryResponse,
  MovementDetailResponse,
  FractionRequest,
  FacebookCompleteRequest,
  FacebookRegisterStartRequest,
  FacebookStartResponse,
  GoogleRegisterRequest,
  RecoveryCompleteResponse,
  RecoveryRequestResponse,
  RegisterRequest,
} from '../types';
import type { PrivateAvatarBlob } from '../profileIdentity';
import { profileNameInput, validateAvatarInput } from '../profileIdentity';
import type { ShortfallDetail } from '../shortfallDetail';
import { MESA_CREATION_OUTCOME_BY_STATUS } from '../types';
import {
  MOCK_CONNECTED_ACCOUNTS,
  MOCK_RECOVERY_TOKEN,
  MOCK_RESTAURANTS,
  MOCK_USER,
} from './seedData';
import { MODO_MONETARIO_MOCK_POR_DEFECTO } from './store';
import {
  availableBalance,
  findMesa,
  markMesaPaid,
  materializeDemoMesa,
  mesaPayable,
  mockId,
  persist,
  pushWalletTx,
  settleIfExpired,
  state,
  toMesaDetail,
  toOpenMesa,
  takenBps,
  type MockClaim,
  type MockIdemEntry,
  type MockIdentity,
  type MockMesa,
  type MockSlot,
} from './store';

/**
 * Adaptador mock (VITE_MOCK=1): replica shapes Y reglas del contrato
 * (garantía A-1, saldo retenido, locks, slots, expiración A-2, errores 4xx
 * como MockApiError con el mismo `error` que devolvería el backend).
 */

const LATENCY_MS = 350;

function validNonNegativeCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validPositiveCents(value: unknown): value is number {
  return validNonNegativeCents(value) && value > 0;
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 100;
}

/**
 * B-06: réplica de la idempotencia del backend. El ledger vive dentro del
 * estado persistido del mock: una recarga restaura mutación y clave juntas.
 *
 * Guarda el HASH del payload junto a la respuesta, como el backend: misma
 * clave + mismo contenido = replay; misma clave + otro contenido =
 * `409 idempotency_conflict`. Sin comparar el contenido, el mock replayaba
 * pagos distintos con la misma clave y tapaba en la demo justo los bugs que
 * el fix tiene que evitar.
 */
function readMockIdempotency(key: string): MockIdemEntry | undefined {
  return state.idempotency[key];
}

function writeMockIdempotency(key: string, entry: MockIdemEntry): void {
  state.idempotency[key] = entry;
}

/** El backend actualiza la fila canónica antes de resolver un replay. */
function invitationReplay(entry: MockIdemEntry): CreateInvitationResponse {
  const response = entry.response as CreateInvitationResponse;
  const expiry = Date.parse(response.invitation?.expires_at ?? '');
  if (response.invitation?.status === 'pending' && Number.isFinite(expiry) && expiry <= Date.now()) {
    return {
      ...response,
      invitation: { ...response.invitation, status: 'expired' },
    };
  }
  return response;
}

function readPendingInvitationAuthority(key: string): MockIdemEntry | undefined {
  const entry = readMockIdempotency(key);
  if (!entry) return undefined;
  const response = entry.response as CreateInvitationResponse;
  const expiry = Date.parse(response.invitation?.expires_at ?? '');
  if (response.invitation?.status !== 'pending' || !Number.isFinite(expiry) || expiry <= Date.now()) {
    delete state.idempotency[key];
    return undefined;
  }
  return entry;
}

/**
 * Mismos subconjuntos de campos que `PAYLOAD_KEYS` del backend. `lock_tokens`
 * queda afuera (estado temporal del lock) y las listas se ordenan, para no
 * inventar conflictos que el backend real no daría.
 */
const MOCK_PAYLOAD_KEYS = {
  mesa_pay: [
    'payment_type',
    'item_ids',
    'items',
    'tip_cents',
    'tip_bps',
    'tip_to_staff_id',
  ],
  create_mesa: [
    'restaurant_id',
    'total_cents',
    'division_mode',
    'expected_participants',
    'guarantee_method',
    'items',
  ],
  transfer: ['amount_cents', 'to_payme_id', 'to_email', 'to_user_id', 'concept'],
  topup_oxxo: ['amount_cents'],
  topup_card: ['amount_cents', 'payment_method_id'],
  invitation: ['type', 'invited_user_id'],
} as const;

/**
 * ORDEN 2-A · UNA SOLA COPIA DEL ALGORITMO, no dos.
 *
 * Acá vivía una réplica propia de la canonicalización del backend
 * (`canonicalizeMockPayload` + `sortUnorderedMockArray` + `mockPayloadHash`),
 * paralela a la que ahora usa el journal. Dos copias del mismo algoritmo es
 * la forma más silenciosa de que se separen: se corrige una y la otra sigue
 * viva. Se unifican en `src/utils/payloadIdentity.ts`, que además está
 * acreditado byte a byte contra el JS espejado del dueño.
 *
 * Se conserva la decisión de guardar la forma CANÓNICA y no el sha256: para
 * detectar conflicto alcanza, es sincrónico, y el hash del dueño es
 * exactamente `sha256(esta cadena)` — así que cuando el front manda su
 * `payload_hash`, `mockGetMesaCreation` lo compara hasheando lo guardado.
 */
function mockPayloadHash(payload: unknown, keep: readonly string[]): string {
  return payloadCanonical(payload, keep);
}

export class MockApiError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(status: number, error: string, extra: Record<string, unknown> = {}) {
    super(error);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Toda respuesta OK del mock pasa por acá, así que es el punto natural para
 * persistir: cualquier mutación queda guardada sin tener que acordarse en
 * cada handler.
 */
function delay<T>(value: T): Promise<T> {
  persist();
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new MockApiError(status, error, extra)), LATENCY_MS),
  );
}

// ─── Config ────────────────────────────────────────────────

/**
 * `GET /api/config` — OLA 5D.
 *
 * El mock **también respeta la capability**, y eso es una decisión, no un
 * detalle: si el mock se saltara `wallet_rail` y el riel quedara apagado por
 * otro camino, el mock estaría *ignorando* la capability en vez de respetarla,
 * y el artefacto de desarrollo enseñaría un producto donde el apagado del riel
 * no depende del backend. Ya pasó en este repo que un mock permisivo le ocultó
 * un defecto vivo a quien verificaba a mano.
 *
 * Los valores replican **exactos** los del emisor
 * (`contract-mirror/routes/config.js:43-46`), y hay un test que lee el espejo
 * como texto y falla si se separan.
 *
 * `stripe_publishable_key: undefined` es fiel: el mock no carga Stripe.js ni
 * depende de credenciales.
 */
/**
 * MODO MONETARIO DEL MOCK · `D-FF-2-BIS`.
 *
 * ⚠️ **FORMA LEÍDA DE LA FUENTE, NO ESPEJADA.** Los tres modos y sus tres
 * campos salen de `../payme-app-backend/services/moneyRail.js:138`, leído
 * directo. **Eso no es el contrato:** el contrato es lo que declara el
 * inventario del dueño, y su inventario está en `df32a6b` (2026-08-07), tres
 * días antes de que `money_rail` naciera en `5e19ec5`.
 *
 * 🔴 **Si el espejo llega con una forma distinta de la que asumí acá, este
 * comentario es lo único que evita que alguien crea que el mock estaba
 * verificado contra el contrato. No lo borres al espejar: corregilo.**
 *
 * ── Por qué el mock tiene que modelar los TRES ──
 *
 * El cartel de «tarjeta de prueba» tiene que aparecer con `real_money: false`
 * **y NO aparecer con `real_money: true`**. Sin los dos estados alcanzables se
 * puede probar que aparece; **no se puede probar que desaparece**, que es la
 * mitad que importa: mostrarlo de más le dice a alguien con dinero real que use
 * una tarjeta falsa.
 *
 * ── Por qué `localStorage` y no una variable de entorno ──
 *
 * Se cambia en caliente desde un test o desde la consola, sin rebuild. La clave
 * va namespaceada por lo de `storage.ts:10-13`: mock y build real compartieron
 * origen una vez y una sesión se habría filtrado.
 */
const CLAVE_MODO = 'payme.app.mock.money_rail.v1';

export type ModoMonetarioMock = 'disabled' | 'sandbox' | 'live';

/** Igual que el emisor: `payments_enabled` y `real_money` son INDEPENDIENTES. */
const MODOS: Record<ModoMonetarioMock, { mode: string; payments_enabled: boolean; real_money: boolean }> = {
  disabled: { mode: 'disabled', payments_enabled: false, real_money: false },
  sandbox: { mode: 'sandbox', payments_enabled: true, real_money: false },
  live: { mode: 'live', payments_enabled: true, real_money: true },
};

/**
 * 🔴 **F2 · el default se queda en `sandbox`, y el corte se declara donde se
 * prueba.**
 *
 * Lo intenté en `disabled` —es lo desplegado durante el corte— y la medición lo
 * refutó: ese default decide qué flujo ejercita la suite entera, y sin pagos el
 * organizador nunca pasa por la garantía. `disabled` y `live` siguen alcanzables
 * por la clave de `localStorage`, sin rebuild, y es por ahí que cada recorrido
 * del corte declara su modo. El porqué completo, en `./store.ts`.
 */
const MODO_POR_DEFECTO: ModoMonetarioMock = MODO_MONETARIO_MOCK_POR_DEFECTO.mode as ModoMonetarioMock;

/**
 * El modo que el mock sirve cuando nadie tocó la clave. **Sin `localStorage`, a
 * propósito**: los recorridos de Playwright necesitan derivar el corte desde
 * Node, antes de que exista un navegador, y una lectura de storage ahí sólo
 * podría caer en su `catch`. Que sea una función y no la constante suelta evita
 * que alguien exporte el objeto mutable de `MODOS`.
 */
export function modoMonetarioMockPorDefecto(): unknown {
  return MODOS[MODO_POR_DEFECTO];
}

export function modoMonetarioMock(): unknown {
  try {
    const v = localStorage.getItem(CLAVE_MODO);
    return MODOS[(v as ModoMonetarioMock) in MODOS ? (v as ModoMonetarioMock) : MODO_POR_DEFECTO];
  } catch {
    return MODOS[MODO_POR_DEFECTO];
  }
}

/**
 * C2b · seam del alta pública **del mock**, con el mismo molde que el modo
 * monetario y por los mismos motivos.
 *
 * 🔴 **Default CERRADA, y no es una preferencia: es el contrato.** El dueño abre
 * el alta sólo con `PUBLIC_SIGNUP_ENABLED === 'true'`; ausente o cualquier otro
 * valor mantiene la invitación obligatoria. El mock reproduce ese default, no el
 * estado que se quiere el viernes — si reprodujera el estado deseado, la demo
 * dejaría de mostrar lo que un backend recién levantado devuelve.
 *
 * ⚠️ **Esta clave la lee SÓLO el mock.** El camino real de la capability
 * (`socialAuth.ts`) sale de `GET /api/config` del backend y no consulta
 * `localStorage` en ningún punto: `mockApi` viaja en el bundle real porque el
 * import es estático, así que la garantía es de CAMINO, no de bundle, y hay un
 * test que la fija con `IS_MOCK=false`.
 *
 * Va namespaceada como manda `storage.ts:10-28`: mock y real compartieron origen
 * una vez y el namespacing es lo único que impidió que se cruzaran.
 */
const CLAVE_ALTA_PUBLICA = 'payme.app.mock.public_signup.v1';

export function altaPublicaMock(): boolean {
  try {
    // Sólo el `true` exacto abre, igual que la bandera del dueño. Un valor
    // inválido, ausente o un storage que tira excepción dejan la invitación
    // obligatoria, que es el lado seguro.
    return localStorage.getItem(CLAVE_ALTA_PUBLICA) === 'true';
  } catch {
    return false;
  }
}

/** Para tests y consola. No hay UI: esto no es una preferencia del usuario. */
export function setAltaPublicaMock(abierta: boolean): void {
  try { localStorage.setItem(CLAVE_ALTA_PUBLICA, abierta ? 'true' : 'false'); } catch { /* ver altaPublicaMock */ }
}

/** Para tests y consola. No hay UI: esto no es una preferencia del usuario. */
export function setModoMonetarioMock(m: ModoMonetarioMock): void {
  try { localStorage.setItem(CLAVE_MODO, m); } catch { /* ver modoMonetarioMock */ }
}

interface PrivateFeatureMockFixture {
  profile: ProfileIdentityResponse;
  avatar: Blob | null;
  shortfallByMesa: Readonly<Record<string, ShortfallDetail>>;
}

let privateFeatureFixture: PrivateFeatureMockFixture | null = null;
let mockAvatar: Blob | null = null;

const MOCK_PROFILE_CREATED_AT = '2026-08-25T00:00:00.000Z';
const MOCK_SHORTFALL_CLOSED_AT = '2026-08-25T00:00:00.000Z';
const MOCK_SHORTFALL_CODE = 'PA-1099';

function defaultPrivateFeatureFixture(): PrivateFeatureMockFixture {
  const user = state.user;
  return {
    profile: {
      user: {
        ...user,
        phone: user.phone ?? null,
        birth_date: user.birth_date ?? null,
        created_at: user.created_at ?? MOCK_PROFILE_CREATED_AT,
        birth_date_set: user.birth_date_set ?? user.birth_date != null,
        is_adult: user.is_adult ?? null,
        avatar: user.avatar ?? null,
      },
    },
    avatar: mockAvatar,
    shortfallByMesa: {
      [MOCK_SHORTFALL_CODE]: {
        version: 1,
        detail_available: true,
        closed_at: MOCK_SHORTFALL_CLOSED_AT,
        shortfall_cents: 21000,
        unassigned_cents: 8000,
        rows: [{ display_name: 'Luis Cárdenas', due_cents: 13000 }],
      },
    },
  };
}

function activePrivateFeatureFixture(): PrivateFeatureMockFixture {
  return privateFeatureFixture ?? defaultPrivateFeatureFixture();
}

/** Seam exclusivo de Vitest para sustituir datos, no para habilitar el gate. */
export function installPrivateFeatureMockFixtureForTests(
  fixture: PrivateFeatureMockFixture,
): () => void {
  if (import.meta.env.MODE !== 'test') throw new Error('private_feature_mock_seam_forbidden');
  const previous = privateFeatureFixture;
  privateFeatureFixture = fixture;
  return () => { privateFeatureFixture = previous; };
}

export async function mockGetConfig(): Promise<AppConfig> {
  return delay({
    version: 'mock',
    currency: 'mxn',
    stripe_publishable_key: undefined,
    mesa_hold_seconds: 1800,
    payment_hold_seconds: 420,
    invitation_expiry_seconds: 86400,
    // C3 · con el dinero apagado la selección NO vence: el dueño publica `null`,
    // que es la ausencia explícita. Un número grande sería una mentira redonda.
    item_lock_seconds: (modoMonetarioMock() as { payments_enabled?: unknown })?.payments_enabled === true ? 600 : null,
    features: {
      apple_pay: false,
      google_pay: false,
      stp_dispersal: false,
      ocr_real: false,
      social_auth: {
        google_sign_in: {
          enabled: true,
          registration: true,
          login: true,
          linking: true,
          web_client_id: 'mock-google-client-id',
        },
        facebook_sign_in: {
          enabled: true,
          registration: true,
          login: true,
          app_id: '1234567890',
          redirect_uri: 'https://app.paymemx.com/',
        },
        recovery_email: { enabled: true, completion_route: '#/recovery' },
        password_login: { enabled: true },
      },
      account_birth_date: {
        supported: true,
        registration_required: false,
        write_once: true,
        adulthood_server_authoritative: true,
      },
      // C2b · forma exacta del dueño (`contract-mirror/routes/config.js:142-149`):
      // dos claves y nada más. `supported` es constante; el booleano vivo sale
      // del seam de arriba, que nace cerrado.
      signup: {
        supported: true,
        public_registration: altaPublicaMock(),
      },
      wallet_rail: { enabled: false, account_activity: true },
      money_rail: modoMonetarioMock(),
      /**
       * ⚠️ FORMA ESPEJADA (`contract-mirror/services/ocrRail.js`, `a8611ec`),
       * a diferencia de `money_rail`, que se leyó de la fuente sin contrato.
       *
       * El mock es `mode: 'mock'` y ahí el emisor acepta los CUATRO a propósito
       * —nada llega a Textract—, así que el `accept` del selector se ensancha.
       * Es lo que hace que la demo no le angoste el picker a los iPhone.
       */
      ocr: {
        mode: 'mock',
        credentials_present: false,
        accepted_mime_types: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'],
        provider_mime_types: ['image/jpeg', 'image/png'],
      },
      profile_identity: {
        supported: true,
        enabled: true,
        notice_version: '2.3.0',
        notice_required: true,
        activation_blocker: null,
        payme_id_mutable: false,
        avatar_public_url: false,
      },
      settlement_shortfall_detail: {
        supported: true,
        enabled: true,
        version: 1,
        owner_only: true,
        includes_tip: false,
        notice_version: '2.3.0',
        notice_required: true,
        activation_blocker: null,
      },
    },
  });
}

export async function mockProfileIdentity(): Promise<ProfileIdentityResponse> {
  return delay(activePrivateFeatureFixture().profile);
}

export async function mockUpdateProfileIdentity(
  name: { first_name: string; last_name: string },
): Promise<ProfileIdentityResponse> {
  const fixture = activePrivateFeatureFixture();
  const profile = {
    ...fixture.profile,
    user: {
      ...fixture.profile.user,
      first_name: profileNameInput(name.first_name),
      last_name: profileNameInput(name.last_name),
    },
  };
  if (privateFeatureFixture) {
    privateFeatureFixture = { ...fixture, profile };
  } else {
    state.user = {
      ...state.user,
      first_name: profile.user.first_name,
      last_name: profile.user.last_name,
    };
    persist();
  }
  return delay(profile);
}

export async function mockProfileAvatar(): Promise<PrivateAvatarBlob> {
  const avatar = activePrivateFeatureFixture().avatar;
  if (!avatar) throw new MockApiError(404, 'avatar_not_found');
  // El artefacto mock no tiene Sharp: conserva los bytes privados que el
  // navegador ya validó como JPG/PNG/WebP de hasta 5 MB. Aplicar acá el
  // límite de SALIDA del backend (JPEG normalizado <= 256 KiB) rechazaba una
  // foto normal de teléfono antes de que pudiera mostrarse.
  return delay({ blob: avatar });
}

export async function mockPutProfileAvatar(
  image: Blob,
  expectedRevision: string | null,
): Promise<ProfileAvatarResponse> {
  validateAvatarInput(image);
  const fixture = activePrivateFeatureFixture();
  if ((fixture.profile.user.avatar?.revision ?? null) !== expectedRevision) {
    throw new MockApiError(409, 'avatar_revision_conflict');
  }
  // No declarar JPEG sin transcodificar: cambiar sólo el MIME dejaba bytes
  // PNG/WebP etiquetados incorrectamente. El backend real sí normaliza con
  // Sharp; el mock guarda una copia fiel y privada durante esta sesión.
  const avatar = new Blob([await image.arrayBuffer()], { type: image.type });
  const metadata = {
    revision: crypto.randomUUID(),
    width: 128,
    height: 128,
    updated_at: new Date().toISOString(),
  };
  if (privateFeatureFixture) {
    privateFeatureFixture = {
      ...fixture,
      avatar,
      profile: { user: { ...fixture.profile.user, avatar: metadata } },
    };
  } else {
    mockAvatar = avatar;
    state.user = { ...state.user, avatar: metadata };
    persist();
  }
  return delay({ avatar: metadata });
}

export async function mockDeleteProfileAvatar(expectedRevision: string): Promise<void> {
  const fixture = activePrivateFeatureFixture();
  if (fixture.profile.user.avatar?.revision !== expectedRevision) {
    throw new MockApiError(409, 'avatar_revision_conflict');
  }
  if (privateFeatureFixture) {
    privateFeatureFixture = {
      ...fixture,
      avatar: null,
      profile: { user: { ...fixture.profile.user, avatar: null } },
    };
  } else {
    mockAvatar = null;
    state.user = { ...state.user, avatar: null };
    persist();
  }
  return delay(undefined);
}

export async function mockShortfallDetail(mesaCode: string): Promise<ShortfallDetail> {
  const detail = activePrivateFeatureFixture().shortfallByMesa[mesaCode];
  if (!detail) throw new MockApiError(404, 'shortfall_detail_not_found');
  return delay(detail);
}

// ─── Auth ──────────────────────────────────────────────────

/** "sofi.lopez@mail.com" → "Sofi": el que prueba la demo se ve saludado por su
 *  propio nombre en vez del de la persona de ejemplo. */
function nameFromEmail(email: string): string | null {
  const local = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (!local) return null;
  const first = local.split(' ')[0];
  if (!first || first.length < 2 || /^\d+$/.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export async function mockLogin(email: string, _password: string): Promise<StoredSession> {
  const derived = nameFromEmail(email);
  const user = {
    ...MOCK_USER,
    email: email || MOCK_USER.email,
    /**
     * 🔴 El `payme_id` SIGUE AL NOMBRE, y esto es un arreglo.
     *
     * Antes se derivaba `first_name` del email y se heredaba el `payme_id` del
     * usuario sembrado. Resultado: alguien entraba como `juan@ejemplo.mx`, la
     * app lo saludaba «Juan» y le mostraba **`payme_mx_mati`** en Más y en el
     * encabezado de Avisos.
     *
     * Por qué importa más de lo que parece:
     *  · el `payme_id` es **la identidad con la que te encuentran tus amigos**.
     *    Que sea la de otra persona contradice el modelo que la demo enseña;
     *  · en un link público, cada desconocido veía el nombre propio del dueño
     *    de la demo como si fuera su identificador;
     *  · históricamente también aparecía en cabeceras; hoy permanece sólo en
     *    superficies propias de sólo lectura, como Configuración.
     *
     * El comentario de `paymeIdFromName` ya prometía esta conducta —"sale de SU
     * nombre, no del usuario de ejemplo"— y `mockRegister` la cumplía. El que
     * no la cumplía era este camino. **Un comentario correcto al lado de un
     * código que hace otra cosa es peor que no tener comentario.**
     *
     * Quien entre con el email del usuario sembrado obtiene `payme_mx_mati`
     * igual, porque el nombre deriva a lo mismo: no es un caso especial.
     */
    ...(derived && { first_name: derived, last_name: '', payme_id: paymeIdFromName(derived) }),
  };
  state.user = user;
  const session = createSession({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    user,
  });
  saveSession(session);
  return delay(session);
}

/** GET /account/me (G-02, v2.20): el user vigente de la demo. */
export async function mockGetMe(): Promise<MeResponse> {
  return delay({ user: state.user });
}

/** "Sofía" → "payme_mx_sofia": el payme_id de una cuenta nueva sale de SU
 *  nombre, como en el backend real — no del usuario de ejemplo. */
function paymeIdFromName(firstName: string): string {
  const plano = firstName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return `payme_mx_${plano || 'nueva'}`;
}

export async function mockRegister(data: RegisterRequest): Promise<StoredSession> {
  // El mock recorre la misma compuerta de superficie: sin una autoridad con
  // forma válida no hay alta. No pretende validar email/TTL/one-use —eso sólo
  // lo acredita el owner y PostgreSQL—, pero tampoco enseña un registro abierto.
  // C2b · con el alta abierta la invitación deja de ser obligatoria; si llega,
  // se sigue exigiendo que tenga forma de autoridad. Con el alta cerrada, todo
  // igual que antes. El 403 es el MISMO en los dos casos: el mock no puede
  // enseñar a distinguir motivos que el dueño publica como opacos.
  const tokenPresente = data.invitation_token !== undefined;
  const tokenValido = typeof data.invitation_token === 'string'
    && data.invitation_token.length >= 20
    && data.invitation_token.length <= 200;
  if (tokenPresente ? !tokenValido : !altaPublicaMock()) {
    throw new MockApiError(403, 'registration_not_available');
  }
  // Una cuenta NUEVA nace como en el backend real: sin métodos de pago y con
  // payme_id propio. Heredar los del seed hacía INEJERCITABLE el camino del
  // pagador primerizo —el primero que recorre un usuario real, porque la
  // garantía exige tarjeta guardada y Apple/Google están apagados— y servía
  // el payme_id de la persona de ejemplo a cualquier registro. El usuario del
  // SEED conserva sus dos tarjetas: entra por mockLogin, que no toca esto.
  const { invitation_token: _authority, password: _password, ...profile } = data;
  state.user = { ...MOCK_USER, ...profile, payme_id: paymeIdFromName(data.first_name) };
  state.paymentMethods = [];
  const session = createSession({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    user: state.user,
  });
  saveSession(session);
  return delay(session);
}

interface MockFacebookIntent {
  readonly purpose: 'login' | 'register';
  readonly expiresAt: number;
  readonly registration: FacebookRegisterStartRequest | null;
}

const mockFacebookIntents = new Map<string, MockFacebookIntent>();
let mockRecoveryIssued = false;

function validSocialCredential(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 8192;
}

function waitSocialLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
}

async function persistMockSocialUser(
  user: typeof MOCK_USER,
  suffix: string,
  origin: StoredSession | null,
  onAccepted: () => void,
  expectedStateWitness?: SessionStateWitness,
): Promise<StoredSession> {
  return persistSocialSessionResponse({
    user: {
      id: user.id,
      payme_id: user.payme_id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
    },
    access_token: `mock-social-access-${suffix}-${crypto.randomUUID()}`,
    refresh_token: `mock-social-refresh-${suffix}-${crypto.randomUUID()}`,
    expires_in: 900,
  }, origin, onAccepted, expectedStateWitness);
}

function socialRegistrationUser(data: Pick<GoogleRegisterRequest, 'first_name' | 'last_name'>) {
  return {
    ...MOCK_USER,
    email: 'registro.social@payme.local',
    first_name: data.first_name.trim(),
    last_name: data.last_name.trim(),
    payme_id: paymeIdFromName(data.first_name),
  };
}

export async function mockGoogleLogin(idToken: string): Promise<StoredSession> {
  if (!validSocialCredential(idToken)) throw new MockApiError(400, 'validation_error');
  const origin = loadSession();
  await waitSocialLatency();
  return persistMockSocialUser(MOCK_USER, 'google-login', origin, () => {
    state.user = { ...MOCK_USER };
    persist();
  });
}

export async function mockGoogleRegister(data: GoogleRegisterRequest): Promise<StoredSession> {
  // C2b · el DTO social del dueño es strict POR MODO: `email` sólo se acepta
  // con el alta abierta, y con el alta cerrada lo rechaza con `validation_error`.
  // El mock reproduce esa distinción porque es la única del alta que existe.
  const traeToken = data.invitation_token !== undefined;
  const tokenSocialValido = typeof data.invitation_token === 'string'
    && data.invitation_token.length >= 20 && data.invitation_token.length <= 200;
  if (data.email !== undefined && !altaPublicaMock()) {
    throw new MockApiError(400, 'validation_error');
  }
  if (!validSocialCredential(data.id_token)
      || (traeToken ? !tokenSocialValido : !altaPublicaMock())
      || (!traeToken && (typeof data.email !== 'string' || !data.email.includes('@')))
      || !data.first_name.trim() || data.first_name.length > 100
      || !data.last_name.trim() || data.last_name.length > 100) {
    throw new MockApiError(403, 'registration_not_available');
  }
  const origin = loadSession();
  await waitSocialLatency();
  const user = socialRegistrationUser(data);
  return persistMockSocialUser(user, 'google-register', origin, () => {
    state.user = user;
    state.paymentMethods = [];
    persist();
  });
}

async function mockFacebookStart(
  purpose: 'login' | 'register',
  registration: FacebookRegisterStartRequest | null,
): Promise<FacebookStartResponse> {
  const stateValue = `mock-facebook-state-${crypto.randomUUID()}`;
  const expiresAt = Date.now() + 10 * 60 * 1000;
  mockFacebookIntents.set(stateValue, { purpose, registration, expiresAt });
  const authorization = new URL('https://www.facebook.com/v99.0/dialog/oauth');
  authorization.searchParams.set('client_id', '1234567890');
  authorization.searchParams.set('redirect_uri', 'https://app.paymemx.com/');
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('state', stateValue);
  return delay({
    authorization_url: authorization.toString(),
    expires_at: new Date(expiresAt).toISOString(),
  });
}

export function mockFacebookLoginStart(): Promise<FacebookStartResponse> {
  return mockFacebookStart('login', null);
}

export function mockFacebookRegisterStart(
  data: FacebookRegisterStartRequest,
): Promise<FacebookStartResponse> {
  if (typeof data.invitation_token !== 'string'
      || data.invitation_token.length < 20 || data.invitation_token.length > 200
      || !data.first_name.trim() || data.first_name.length > 100
      || !data.last_name.trim() || data.last_name.length > 100) {
    throw new MockApiError(403, 'registration_not_available');
  }
  return mockFacebookStart('register', { ...data });
}

async function mockFacebookComplete(
  purpose: 'login' | 'register',
  data: FacebookCompleteRequest,
  expectedStateWitness: SessionStateWitness,
): Promise<StoredSession> {
  const origin = loadSession();
  if (typeof data.state !== 'string' || data.state.length < 20 || data.state.length > 200
      || typeof data.code !== 'string' || data.code.length < 1 || data.code.length > 4096) {
    throw new MockApiError(400, 'validation_error');
  }
  const intent = mockFacebookIntents.get(data.state);
  // One-use incluso ante un purpose cruzado o expirado.
  mockFacebookIntents.delete(data.state);
  if (!intent || intent.purpose !== purpose || intent.expiresAt <= Date.now()) {
    throw new MockApiError(401, 'social_auth_failed');
  }
  await waitSocialLatency();
  if (purpose === 'register') {
    if (!intent.registration) throw new MockApiError(403, 'registration_not_available');
    const user = socialRegistrationUser(intent.registration);
    return persistMockSocialUser(user, 'facebook-register', origin, () => {
      state.user = user;
      state.paymentMethods = [];
      persist();
    }, expectedStateWitness);
  }
  return persistMockSocialUser(MOCK_USER, 'facebook-login', origin, () => {
    state.user = { ...MOCK_USER };
    persist();
  }, expectedStateWitness);
}

export function mockFacebookLoginComplete(
  data: FacebookCompleteRequest,
  expectedStateWitness: SessionStateWitness,
): Promise<StoredSession> {
  return mockFacebookComplete('login', data, expectedStateWitness);
}

export function mockFacebookRegisterComplete(
  data: FacebookCompleteRequest,
  expectedStateWitness: SessionStateWitness,
): Promise<StoredSession> {
  return mockFacebookComplete('register', data, expectedStateWitness);
}

export async function mockRequestRecovery(email: string): Promise<RecoveryRequestResponse> {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MockApiError(400, 'validation_error');
  }
  mockRecoveryIssued = true;
  return delay({ accepted: true });
}

export async function mockCompleteRecovery(
  token: string,
  newPassword: string,
): Promise<RecoveryCompleteResponse> {
  const passwordBytes = new TextEncoder().encode(newPassword).byteLength;
  if (!mockRecoveryIssued || token !== MOCK_RECOVERY_TOKEN
      || typeof newPassword !== 'string' || newPassword.length < 8
      || newPassword.length > 128 || passwordBytes > 72) {
    throw new MockApiError(403, 'recovery_not_available');
  }
  mockRecoveryIssued = false;
  return delay({ completed: true });
}

/** Fixture de UI, no copia del aviso legal productivo ni aprobación jurídica. */
export async function mockGetPrivacyNotice(): Promise<LegalTextResponse> {
  return delay({
    legal_text: {
      kind: 'aviso_privacidad',
      version: '0.0.0-demo-local',
      hash: '0'.repeat(64),
      effective_from: '2026-08-12T00:00:00.000Z',
      body: 'AVISO DE DEMOSTRACIÓN. Este texto sólo ejercita la puesta a disposición en el modo demo; no es el aviso productivo de PayMe.',
    },
  });
}

export async function mockLogout(): Promise<void> {
  return delay(undefined);
}

// ─── Cuenta ────────────────────────────────────────────────

export async function mockBalance(): Promise<BalanceResponse> {
  // G-03 (v2.21): retenido + disponible, misma resta que el backend.
  const held = state.held_balance_cents;
  const available = state.balance_cents - held;
  return delay({
    balance_cents: state.balance_cents,
    balance_display: centsToDisplay(state.balance_cents),
    held_balance_cents: held,
    held_balance_display: centsToDisplay(held),
    available_cents: available,
    available_display: centsToDisplay(available),
    clabe: state.clabe,
    currency: 'mxn',
  });
}

/** GET /restaurants/:id (G-01, v2.21): resuelve el uuid del QR de la mesa. */
export async function mockGetRestaurant(id: string): Promise<RestaurantResponse> {
  const r = MOCK_RESTAURANTS.find((x) => x.id === id);
  if (!r) return fail(404, 'restaurant_not_found');
  return delay({ restaurant: { ...r } });
}

export async function mockWalletTransactions(): Promise<WalletTransactionsResponse> {
  return delay({ transactions: [...state.walletTx], limit: 30, offset: 0 });
}

/** GET /account/history: pagos propios, más reciente primero. Replica la
 *  paginación real (limit default 20, máx 100) y los filtros from/to. */
export async function mockHistory(params?: {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<HistoryResponse> {
  const limit = Math.min(params?.limit ?? 20, 100);
  // `offset` espeja `historyQuery` del emisor: entero, mínimo 0, default 0.
  const offset = Math.max(0, Math.trunc(params?.offset ?? 0));
  let sorted = [...state.history].sort((a, b) => b.date.localeCompare(a.date));
  if (params?.from) sorted = sorted.filter((h) => h.date >= params.from!);
  if (params?.to) sorted = sorted.filter((h) => h.date <= params.to!);
  /**
   * `mesa_status` es VIVO, no foto: el emisor lo proyecta con `JOIN mesas` al
   * momento de la consulta (`routes/account.js`). `mockPayMesa` guarda el
   * estado del momento del pago, así que servirlo tal cual mentiría en el caso
   * corriente: pagás tu parte (la entrada nace `partially_paid`), la mesa
   * termina después, y el historial la seguiría mostrando viva — Historial
   * (§1.10) la excluiría para siempre. Se re-lee la mesa al servir; las del
   * seed sin mesa viva conservan su estado guardado.
   */
  const vivas = new Map(state.mesas.map((m) => [m.code, m.status]));
  const proyectado = sorted
    .slice(offset, offset + limit)
    .map((h) => (vivas.has(h.mesa_code) ? { ...h, mesa_status: vivas.get(h.mesa_code)! } : h));
  return delay({ history: proyectado, limit, offset });
}

export async function mockMovement(id: string): Promise<MovementDetailResponse> {
  const detail = state.movementDetails[id];
  if (!detail) return fail(404, 'movement_not_found');
  return delay(structuredClone(detail));
}

// ─── v2.18 · Fracciones (réplica de services/itemClaims.js del espejo) ─────

const FRACTION_VALUES = [2500, 3333, 5000, 6667, 7500, 10000];
const COMPLETING_TOLERANCE_BPS = 100;

/** bps efectivos contra lo que queda; 409 si no entra; absorbe restos <100. */
function effectiveBps(requestedBps: number, remainingBps: number): number {
  if (remainingBps <= 0 || requestedBps > remainingBps) {
    throw new MockApiError(409, 'fraction_not_available', {
      remaining_bps: Math.max(0, remainingBps),
    });
  }
  return remainingBps - requestedBps < COMPLETING_TOLERANCE_BPS ? remainingBps : requestedBps;
}

/** Precio de la fracción; la que COMPLETA ajusta para que el ítem cierre exacto. */
function priceFraction(priceCents: number, effBps: number, otherLive: MockClaim[]): number {
  const otherBps = otherLive.reduce((s, c) => s + c.fraction_bps, 0);
  if (otherBps + effBps >= 10000) {
    const others = otherLive.reduce(
      (s, c) => s + (c.amount_cents != null ? c.amount_cents : fractionAmount(priceCents, c.fraction_bps)),
      0,
    );
    return Math.max(0, priceCents - others);
  }
  return fractionAmount(priceCents, effBps);
}

// ─── Mesas ─────────────────────────────────────────────────

export async function mockOpenMesas(): Promise<OpenMesasResponse> {
  state.mesas.forEach(settleIfExpired);
  return delay({
    mesas: state.mesas
      // G-28, cerrado en el backend v2.42.0: la mesa abierta es de **todos sus
      // participantes**, no sólo de quien la abrió. Filtrar por `openedByUser`
      // era acá el mismo defecto que `opener_user_id` allá — quien se sumaba
      // por un link leía "No tenés mesas abiertas" mientras debía plata, y sin
      // error que lo delatara.
      //
      // `joinedMesaCodes` es en el mock lo que `mesa_participants` con
      // `status = 'active'` es en el contrato: se escribe al canjear el link.
      .filter(
        (m) =>
          (m.openedByUser || state.joinedMesaCodes.includes(m.code)) &&
          (m.status === 'open' || m.status === 'partially_paid'),
      )
      .map(toOpenMesa),
  });
}

export async function mockGetMesa(code: string, identity: MockIdentity): Promise<MesaDetailResponse> {
  // Si el link viene de otro dispositivo, la mesa no existe en ESTE navegador:
  // se materializa con el ticket de ejemplo para que la demo no se corte.
  const mesa = findMesa(code) ?? materializeDemoMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  settleIfExpired(mesa);
  return delay({ mesa: toMesaDetail(mesa, identity) });
}

export async function mockScanTicket(): Promise<OcrResponse> {
  // Mismo ticket que devuelve el mock del backend (routes/ocr.js).
  const items = [
    { name: 'Tagliatelle Bolognese', category: 'italian' as const, price_cents: 19500, quantity: 1 },
    { name: 'Risotto ai Funghi', category: 'italian' as const, price_cents: 22000, quantity: 1 },
    { name: 'Pizza Margherita', category: 'italian' as const, price_cents: 18500, quantity: 1 },
    { name: 'Tiramisú', category: 'italian' as const, price_cents: 7000, quantity: 2 },
    { name: 'Agua mineral', category: 'other' as const, price_cents: 4000, quantity: 1 },
    { name: 'Vino tinto (copa)', category: 'other' as const, price_cents: 6000, quantity: 1 },
  ];
  const total = items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
  return new Promise((resolve) =>
    setTimeout(() => resolve({ items, total_cents: total, warnings: [], mock: true }), 1200),
  );
}

/** Garantía 3DS pendiente del mock (mesa creada con card, aún pending_auth). */
let pending3ds: MockMesa | null = null;
/**
 * D4: pm_ de la tarjeta nueva a guardar RECIÉN cuando el 3DS confirme.
 *
 * 🔴 QUÉ CUBRIÓ N-16 Y QUÉ NO — con precisión, porque la mitad se arregló y la
 * otra mitad no, y decir "arreglado" a secas sería falso.
 *
 * · **CUBIERTO:** la FINALIZACIÓN del 3DS ya no depende de memoria de módulo.
 *   `mockConfirmGuarantee3ds` gateaba con `mesa !== pending3ds` y eso volvía
 *   imposible confirmar tras una recarga; ahora el gate es
 *   `status === 'pending_auth'`, que es durable. Ése era el defecto que
 *   bloqueaba el camino.
 *
 * · **NO CUBIERTO:** esta variable. La INTENCIÓN de guardar la tarjeta sigue
 *   viviendo sólo en memoria del módulo, así que tras una recarga se pierde y
 *   el mock no guarda la tarjeta aunque la persona hubiera marcado el
 *   checkbox. **El backend real NO tiene ese agujero**: sella
 *   `auth_save_payment_method` en la fila de la mesa ANTES de Stripe y el
 *   webhook de éxito la guarda igual.
 *
 * · **Alcance de la divergencia:** sólo el efecto "la tarjeta aparece después
 *   en Mis tarjetas", y sólo en el mock, y sólo si hubo recarga entre la
 *   garantía y el 3DS. No toca dinero, no toca el reenvío, no toca la
 *   identidad económica. Y el checkbox nace DESMARCADO (`saveCardView.ts`),
 *   así que el camino por defecto ni siquiera lo activa.
 *
 * · **Por qué no se amplía acá:** persistir la intención exige tocar la forma
 *   del estado guardado del mock por un observable de demo. Queda declarado en
 *   vez de arreglado a medias — y declarado con su alcance, no con un "ojo,
 *   puede fallar".
 */
let pending3dsSave: string | null = null;

export async function mockCreateMesa(req: CreateMesaRequest): Promise<CreateMesaResponse> {
  if (!validIdempotencyKey(req.idempotency_key) || !validPositiveCents(req.total_cents) || !Array.isArray(req.items) || req.items.length === 0 ||
      req.items.some((item) => !validNonNegativeCents(item.price_cents) || !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
    return fail(400, 'validation_error');
  }
  let sum: number;
  try {
    sum = sumCents(...req.items.map((item) => {
      const line = BigInt(item.price_cents) * BigInt(item.quantity);
      if (line > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('line_overflow');
      return Number(line);
    }));
  } catch {
    return fail(400, 'validation_error');
  }
  if (sum !== req.total_cents) {
    return fail(400, 'total_mismatch', { expected: sum, received: req.total_cents });
  }
  // B-06 (v2.25): misma clave → misma mesa, sin abrir una segunda con otra
  // garantía por el total.
  const idemKey = `mesa:${req.idempotency_key}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.create_mesa);
  const previoMesa = readMockIdempotency(idemKey);
  if (previoMesa) {
    if (previoMesa.hash !== idemHash) return fail(409, 'idempotency_conflict');
    return delay({ ...(previoMesa.response as CreateMesaResponse), idempotent: true });
  }
  const restaurant = MOCK_RESTAURANTS.find((r) => r.id === req.restaurant_id);
  if (!restaurant) return fail(404, 'restaurant_not_found');

  /**
   * C3 · la mesa SIN garantía, con la puerta exacta del dueño
   * (`contract-mirror/routes/mesas.js:243-250`): `none` sólo existe con el
   * dinero apagado. Con el riel vivo se rechaza **antes** de tocar nada, con el
   * mismo `409 guarantee_required` — «la garantía es lo que hace que el
   * restaurante cobre», y eso no se negocia porque el front pida otra cosa.
   */
  const modo = modoMonetarioMock() as { payments_enabled?: unknown };
  const dineroVivo = modo?.payments_enabled === true;
  if (req.guarantee_method === 'none' && dineroVivo) {
    return fail(409, 'guarantee_required');
  }
  /**
   * ⚠️ **Límite declarado del mock, y por qué no se cierra acá.** El dueño
   * también rechaza `card` y `wallet` con el dinero apagado
   * (`rechazaPorDineroApagado`). El mock **no** modela esa mitad: hacerlo
   * obligaría a que cada test que abre una mesa con tarjeta declarara primero el
   * modo, y esos tests están fuera de esta orden.
   *
   * No abre un hueco de producto: el front nunca manda `card` con el riel
   * apagado —`sinGarantia` en `CreateMesaFlow` lo desvía antes—, y quien lo
   * mandara igual chocaría con el gate del dueño, que sí existe. Lo que falta es
   * la simulación, no la defensa.
   */

  // A-1: hold de garantía. Wallet = congelar saldo (D2); card = hold con 3DS.
  if (req.guarantee_method === 'wallet') {
    const available = availableBalance();
    if (available < req.total_cents) {
      return fail(402, 'guarantee_failed', {
        reason: 'insufficient_balance_for_guarantee',
        available,
        required: req.total_cents,
      });
    }
  }

  const code = `PA-${Math.floor(Math.random() * 9000 + 1000)}`;
  const now = new Date().toISOString();
  const mesa: MockMesa = {
    id: mockId('c'),
    code,
    restaurant: { ...restaurant },
    total_cents: req.total_cents,
    paid_amount_cents: 0,
    tip_amount_cents: 0,
    division_mode: req.division_mode,
    expected_participants: req.expected_participants,
    status: req.guarantee_method === 'card' ? 'pending_auth' : 'open',
    // C3 · la mesa sin garantía vive CINCO HORAS (decisión de Mati); con
    // garantía conserva su ventana de siempre.
    expires_at: new Date(Date.now() + (req.guarantee_method === 'none' ? 5 * 60 * 60_000 : 30 * 60_000)).toISOString(),
    guarantee_mode: req.guarantee_method !== 'none',
    closure_reason: null,
    items: req.items.map((i) => ({
      id: mockId('d'),
      name: i.name,
      category: i.category ?? 'other',
      price_cents: i.price_cents,
      quantity: i.quantity,
      status: 'available',
      lockedBy: null,
      claims: [],
      lock_expires_at: null,
    })),
    slots:
      req.division_mode === 'igual'
        ? // splitEqual (igual que el backend): el primer comensal absorbe los
          // centavos sobrantes, así la suma de las partes da SIEMPRE el total.
          splitEqual(req.total_cents, req.expected_participants).map((amount, idx) => ({
            slot_index: idx,
            amount_cents: amount,
            status: 'available' as const,
            claimedBy: null,
          }))
        : null,
    active_staff: state.mesas[0]?.active_staff ?? [],
    openedByUser: true,
    captured_shortfall_cents: 0,
    guarantee_method: req.guarantee_method,
    guarantee_saved_payment_method_id:
      req.guarantee_method === 'card' && typeof req.payment_method_id === 'string'
        ? req.payment_method_id
        : null,
  };
  state.mesas.unshift(mesa);

  /**
   * C3 · la mesa SIN garantía responde acá, **antes** de tocar cualquier riel:
   * nace `open`, sin hold, sin 3DS y sin Stripe. El par `{method:'none',
   * status:'none'}` es el del dueño (`contract-mirror/routes/mesas.js:663-671`).
   */
  if (req.guarantee_method === 'none') {
    const respuestaSinGarantia: CreateMesaResponse = {
      mesa: {
        id: mesa.id,
        code: mesa.code,
        total_cents: mesa.total_cents,
        division_mode: mesa.division_mode,
        expected_participants: mesa.expected_participants,
        status: 'open',
        expires_at: mesa.expires_at,
        created_at: now,
      },
      guarantee: { method: 'none', status: 'none' },
    };
    writeMockIdempotency(idemKey, { hash: idemHash, response: respuestaSinGarantia });
    return delay(respuestaSinGarantia);
  }

  if (req.guarantee_method === 'wallet') {
    state.held_balance_cents += req.total_cents;
    const respuestaWallet: CreateMesaResponse = {
      mesa: {
        id: mesa.id,
        code: mesa.code,
        total_cents: mesa.total_cents,
        division_mode: mesa.division_mode,
        expected_participants: mesa.expected_participants,
        status: 'open',
        expires_at: mesa.expires_at,
        created_at: now,
      },
      guarantee: { method: 'wallet', status: 'open' },
    };
    // B-06: esta rama volvía ANTES de guardar la idempotencia, así que en la
    // demo el reintento de una garantía WALLET retenía el total otra vez.
    writeMockIdempotency(idemKey, { hash: idemHash, response: respuestaWallet });
    return delay(respuestaWallet);
  }

  // card: el mock siempre pide 3DS para que la demo muestre requires_action.
  // D4: el "guardar tarjeta" queda PENDIENTE hasta que el 3DS confirme — si
  // guardáramos acá, cada reintento cancelado acumularía tarjetas fantasma
  // (el backend real también guarda recién en el webhook del hold).
  pending3ds = mesa;
  // El riel del restaurante sigue informándose en la respuesta (Connect).
  const connectedAccountId = MOCK_CONNECTED_ACCOUNTS[req.restaurant_id];
  // G-11 CERRADO (backend v2.46.0): el guardado de la garantía es real
  // TAMBIÉN con hold directo — la condición `!connectedAccountId` que vivía
  // acá modelaba el v2.24 que lo ignoraba. Sigue PENDIENTE hasta el 3DS
  // (comentario de arriba): el camino post-3DS del backend lo cubre el
  // webhook de éxito, y acá lo cubre la confirmación.
  pending3dsSave =
    req.save_payment_method && req.stripe_payment_method_id
      ? req.stripe_payment_method_id
      : null;
  const respuestaMesa: CreateMesaResponse = {
    mesa: {
      id: mesa.id,
      code: mesa.code,
      total_cents: mesa.total_cents,
      division_mode: mesa.division_mode,
      expected_participants: mesa.expected_participants,
      status: 'pending_auth',
      expires_at: mesa.expires_at,
      created_at: now,
    },
    guarantee: {
      method: 'card',
      status: 'requires_action' as const,
      client_secret: 'mock_3ds_secret',
      ...(connectedAccountId && { connected_account_id: connectedAccountId }),
    },
  };
  writeMockIdempotency(idemKey, { hash: idemHash, response: respuestaMesa });
  return delay(respuestaMesa);
}

/**
 * `routes/mesas.js` · `outcomeDeCreacion(status)`, espejado exacto (v2.48.0).
 *
 * 🔴 **Ya no cae en `replayable` por descarte.** La matriz del dueño pasó a
 * ser exhaustiva y bidireccional sobre la FSM, con `dispersed` declarado, y lo
 * que no está en ningún grupo devuelve **`unknown`** — *"inventarle una
 * etiqueta a un estado que nadie declaró es mentirle al consumidor"*. El mock
 * usa la MISMA tabla que el decoder (`MESA_CREATION_OUTCOME_BY_STATUS`), así
 * que no puede desincronizarse de él.
 */
function outcomeDeCreacion(status: MesaStatus | string): MesaCreationOutcome {
  return MESA_CREATION_OUTCOME_BY_STATUS[status as MesaStatus] ?? 'unknown';
}

/**
 * `GET /mesas/creations/:idempotency_key` — ORDEN 2A · backend v2.47.0.
 *
 * Espejo del riel real, con sus dos rarezas conservadas porque el mock no
 * puede ser más lindo que el contrato:
 *
 * 1. **`total_cents` sale como STRING.** El real lo manda así (bigint del
 *    driver, mismo helper que el 201 de `POST /mesas`). Un mock que mandara el
 *    entero taparía el día que el decoder deje de aceptar la forma real.
 * 2. **El estado se lee de la mesa VIVA, no de la respuesta guardada.** La
 *    respuesta del idempotency store congeló el estado del momento de crear
 *    (`pending_auth`); el sentido del endpoint es decir en qué quedó, así que
 *    consultarla después del 3DS tiene que dar `open`.
 *
 * La autoridad es la clave, igual que allá: no hay búsqueda por nombre, por
 * restaurante ni por "la más reciente".
 *
 * `payloadHash` es opcional y **desde la ORDEN 2-A el front SÍ lo manda**: el
 * sello v2 del journal es el `payloadHash` del contrato. (Este comentario decía
 * lo contrario y quedó vencido el mismo día.) El mock compara hasheando su
 * forma canónica guardada, que es exactamente lo que el dueño hashea.
 */
export async function mockGetMesaCreation(
  idempotencyKey: string,
  payloadHash?: string,
): Promise<unknown> {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 200) {
    return fail(400, 'idempotency_key_invalid');
  }
  const previo = readMockIdempotency(`mesa:${idempotencyKey}`);
  if (!previo) {
    // El 404 del contrato TRAE cuerpo: no es una falla, es una respuesta.
    return fail(404, 'creation_not_found', {
      found: false,
      outcome: 'not_found',
      retry_with_same_idempotency_key: true,
    });
  }
  if (typeof payloadHash === 'string' && payloadHash.length > 0) {
    // ORDEN 2-A · el front manda el sha256 del dueño; el store guarda la forma
    // CANÓNICA. El hash del dueño es exactamente `sha256(canónica)`, así que
    // se compara hasheando lo guardado — sin una segunda definición de "el
    // mismo request", que es cómo se separan dos implementaciones.
    if (payloadHash !== await sha256Hex(previo.hash)) {
      // Sin datos de la mesa, a propósito: la misma clave con otra intención
      // económica es un error del cliente, no un estado de la creación.
      return fail(409, 'payload_hash_conflict', {
        found: true,
        outcome: 'payload_hash_conflict',
        retry_with_same_idempotency_key: false,
      });
    }
  }
  const code = (previo.response as CreateMesaResponse)?.mesa?.code;
  const mesa = state.mesas.find((m) => m.code === code);
  // Una fila que se evaporó es una inconsistencia del propio mock, no un
  // estado del contrato. Se contesta error genérico —el front conserva el
  // freeze— en vez de inventar un `not_found` que diría lo que no sabemos.
  if (!mesa) return fail(500, 'internal_error');

  const outcome = outcomeDeCreacion(mesa.status);
  return delay({
    found: true,
    outcome,
    // El decoder exige la coherencia declarada: sólo estos dos habilitan
    // repetir el POST. `not_found` sale por el 404 de más arriba.
    retry_with_same_idempotency_key: outcome === 'requires_action',
    ...(payloadHash ? { payload_hash_matches: true } : {}),
    mesa: {
      id: mesa.id,
      code: mesa.code,
      total_cents: String(mesa.total_cents),
      division_mode: mesa.division_mode,
      expected_participants: mesa.expected_participants,
      status: mesa.status,
      expires_at: mesa.expires_at,
    },
    guarantee: {
      method: mesa.guarantee_method,
      authorized: mesa.guarantee_method !== null && mesa.status !== 'pending_auth',
      saved_payment_method_id: mesa.guarantee_saved_payment_method_id ?? null,
    },
  });
}

/**
 * Confirmación 3DS simulada. En T7 (backend real) esto es
 * stripe.confirmCardPayment(client_secret) + esperar que el webhook abra la
 * mesa (poll de GET /mesas/:code). El mock la abre directo.
 */
export async function mockConfirmGuarantee3ds(code: string): Promise<{ status: 'open' }> {
  const mesa = findMesa(code);
  // 🔴 ORDEN 2-A · EL GATE ES EL ESTADO DE LA MESA, no una variable de módulo.
  //
  // Acá decía `mesa !== pending3ds`, y `pending3ds` es memoria del módulo: se
  // pierde con cualquier recarga. O sea que **el mock volvía IMPOSIBLE de
  // completar el escenario de la respuesta perdida** —garantizar, recargar,
  // reenviar, confirmar— cuando el backend real lo permite sin problema: allá
  // el 3DS se confirma contra Stripe con el `client_secret` y el webhook abre
  // la mesa; no hay ninguna variable en memoria que lo gatee.
  //
  // Un mock MÁS DURO que el real es tan mentiroso como uno más blando: hace
  // fallar en la demo algo que en producción funciona, y —peor— vuelve
  // inalcanzable el camino que hay que probar. La verdad durable es
  // `status === 'pending_auth'`, que sobrevive al reload igual que la mesa.
  if (!mesa || mesa.status !== 'pending_auth') return fail(404, 'mesa_not_found');
  mesa.status = 'open';
  if (pending3ds === mesa) pending3ds = null;
  // D4: el hold quedó autorizado → recién ahora se guarda la tarjeta nueva.
  // ⚠️ Tras un reload esta intención se perdió con el módulo: el backend real
  // la sella en la mesa ANTES de Stripe y no depende de la sesión del
  // navegador. Diferencia declarada, no simulada — el mock no inventa un
  // guardado que no puede acreditar.
  if (pending3dsSave) {
    saveMockCard(pending3dsSave);
    pending3dsSave = null;
  }
  // No pasa por `delay()`, así que persiste explícito: sin esto la mesa queda
  // abierta sólo en memoria y la siguiente recarga la muestra en pending_auth.
  persist();
  return new Promise((resolve) => setTimeout(() => resolve({ status: 'open' }), 1500));
}

export async function mockLockItems(
  code: string,
  requests: FractionRequest[],
  identity: MockIdentity,
): Promise<LockItemsResponse> {
  const mesa = findMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  if (!mesaPayable(mesa)) return fail(409, 'mesa_not_active');
  if (!requests.every((r) => FRACTION_VALUES.includes(r.fraction_bps))) {
    return fail(400, 'validation_error', { message: 'fraction_bps inválido' });
  }
  // Validar y calcular efectivos ANTES de mutar (como la tx del backend).
  const claims: Array<{ item_id: string; fraction_bps: number }> = [];
  try {
    for (const rq of requests) {
      const item = mesa.items.find((i) => i.id === rq.item_id);
      if (!item) return fail(404, 'item_not_found', { item_id: rq.item_id });
      // Re-reclamo: mis locked del ítem se reemplazan (como el backend).
      const others = item.claims.filter((c) => !(c.who === identity && c.status === 'locked'));
      const remaining = 10000 - others.reduce((s, c) => s + c.fraction_bps, 0);
      const eff = effectiveBps(rq.fraction_bps, remaining);
      claims.push({ item_id: rq.item_id, fraction_bps: eff });
    }
  } catch (e) {
    if (e instanceof MockApiError) return fail(e.status, e.message, e.extra);
    throw e;
  }
  const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  for (const c of claims) {
    const item = mesa.items.find((i) => i.id === c.item_id);
    if (!item) continue;
    item.claims = item.claims.filter((cl) => !(cl.who === identity && cl.status === 'locked'));
    item.claims.push({ who: identity, fraction_bps: c.fraction_bps, amount_cents: null, status: 'locked' });
    item.lock_expires_at = expires;
  }
  return delay({
    locked: claims.map((c) => c.item_id),
    claims,
    lock_token: `mock-lock-${Date.now()}`,
    lock_expires_at: expires,
  });
}

export async function mockPayMesa(
  code: string,
  req: PayMesaRequest,
  identity: MockIdentity,
): Promise<PayMesaResponse> {
  if (!validIdempotencyKey(req.idempotency_key) ||
      (req.tip_cents !== undefined && !validNonNegativeCents(req.tip_cents)) ||
      (req.tip_bps !== undefined && (!Number.isSafeInteger(req.tip_bps) || req.tip_bps < 0 || req.tip_bps > 10_000)) ||
      (req.items !== undefined && (!Array.isArray(req.items) || req.items.length === 0 || req.items.some((item) => !FRACTION_VALUES.includes(item.fraction_bps)))) ||
      (req.items !== undefined && (req.item_ids?.length ?? 0) > 0)) {
    return fail(400, 'validation_error');
  }
  // B-06: misma clave → replay, sin volver a cobrar (igual que el backend).
  const idemKey = `pay:${code}:${req.idempotency_key}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.mesa_pay);
  const previoPago = readMockIdempotency(idemKey);
  if (previoPago) {
    if (previoPago.hash !== idemHash) return fail(409, 'idempotency_conflict');
    const previous = previoPago.response as PayMesaResponse;
    // Forma del replay unificado coordinado: tip/tipo, detalle de consumo y
    // neutros Stripe. En igualdad `items` permanece ausente por contrato.
    return delay({
      idempotent: true,
      attempt: {
        id: previous.attempt.id,
        status: previous.attempt.status,
        gross_amount_cents: previous.attempt.gross_amount_cents,
        tip_cents: previous.attempt.tip_cents,
        payment_type: previous.attempt.payment_type,
        ...(previous.attempt.items && { items: previous.attempt.items }),
        ...(previous.attempt.payment_type === 'wallet' && previous.attempt.gross_display && {
          gross_display: previous.attempt.gross_display,
        }),
        ...(previous.attempt.payment_type !== 'wallet' && {
          client_secret: previous.attempt.client_secret ?? null,
          requires_action: previous.attempt.status === 'requires_action',
        }),
        ...(previous.attempt.connected_account_id && { connected_account_id: previous.attempt.connected_account_id }),
      },
    });
  }
  const mesa = findMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  settleIfExpired(mesa);
  if (!mesaPayable(mesa)) return fail(409, 'mesa_not_payable', { status: mesa.status });
  if (req.payment_type === 'wallet' && identity === 'guest') {
    return fail(401, 'wallet_requires_auth');
  }
  const requestedItems: FractionRequest[] = req.items
    ?? (req.item_ids ?? []).map((item_id) => ({ item_id, fraction_bps: 10000 }));
  const requestedIds = requestedItems.map((item) => item.item_id);
  if (new Set(requestedIds).size !== requestedIds.length) return fail(400, 'duplicate_item');
  if (requestedItems.some((requested) => !mesa.items.some((item) => item.id === requested.item_id))) {
    return fail(400, 'invalid_item_ids');
  }
  // D7 (v2.17): tip_bps (el server hace la cuenta sobre total ÷ N) excluyente
  // con tip_cents (monto a mano). Misma regla y mismo redondeo que el backend.
  if (req.tip_bps !== undefined && req.tip_cents) {
    return fail(400, 'validation_error', {
      message: 'tip_bps and tip_cents are mutually exclusive',
    });
  }
  const tipCents =
    req.tip_bps !== undefined
      ? tipFromBps(mesa.total_cents, mesa.expected_participants || 1, req.tip_bps)
      : (req.tip_cents ?? 0);

  let itemsAmount = 0;
  let selectedEqualSlot: MockSlot | null = null;
  // v2.18: recibo de fracciones cobradas (solo consumo).
  const pricedItems: Array<{ item_id: string; fraction_bps: number; amount_cents: number }> = [];
  if (mesa.division_mode === 'consumo') {
    if (requestedItems.length === 0) return fail(400, 'no_items_selected');
    try {
      for (const rq of requestedItems) {
        const item = mesa.items.find((i) => i.id === rq.item_id);
        if (!item) return fail(400, 'invalid_item_ids');
        // Mi claim locked del ítem se consume/reemplaza; los demás quedan.
        const others = item.claims.filter((c) => !(c.who === identity && c.status === 'locked'));
        const remaining = 10000 - others.reduce((sum, c) => sum + c.fraction_bps, 0);
        const eff = effectiveBps(rq.fraction_bps, remaining);
        const amount = priceFraction(item.price_cents * item.quantity, eff, others);
        pricedItems.push({ item_id: rq.item_id, fraction_bps: eff, amount_cents: amount });
        itemsAmount = sumCents(itemsAmount, amount);
      }
    } catch (e) {
      if (e instanceof MockApiError) return fail(e.status, e.message, e.extra);
      throw e;
    }
  } else {
    const slot = mesa.slots?.find((s) => s.status === 'available');
    if (!slot) return fail(409, 'no_slots_available');
    // Seleccionar no es mutar: la parte se confirma recién después de validar
    // el saldo. Así un rechazo jamás necesita adivinar qué slot deshacer.
    selectedEqualSlot = slot;
    itemsAmount = slot.amount_cents;
  }

  let gross: number;
  try {
    gross = sumCents(itemsAmount, tipCents);
  } catch {
    return fail(400, 'validation_error');
  }

  if (req.payment_type === 'wallet') {
    const available = availableBalance();
    if (available < gross) {
      return fail(402, 'insufficient_funds', { available, required: gross });
    }
  }

  if (selectedEqualSlot) {
    selectedEqualSlot.status = 'paid';
    selectedEqualSlot.claimedBy = identity;
  }

  if (req.payment_type === 'wallet') {
    state.balance_cents -= gross;
    pushWalletTx('payment_mesa', -gross, `Pago mesa ${mesa.code}`);
  }

  if (mesa.division_mode === 'consumo') {
    for (const pi of pricedItems) {
      const item = mesa.items.find((i) => i.id === pi.item_id);
      if (!item) continue;
      item.claims = item.claims.filter((c) => !(c.who === identity && c.status === 'locked'));
      item.claims.push({
        who: identity,
        fraction_bps: pi.fraction_bps,
        amount_cents: pi.amount_cents,
        status: 'paid',
      } satisfies MockClaim);
      // v2.18: 'paid' SOLO al 100%.
      if (takenBps(item) >= 10000 && item.claims.every((c) => c.status === 'paid')) {
        item.status = 'paid';
      }
    }
  }
  mesa.tip_amount_cents += tipCents;
  markMesaPaid(mesa, itemsAmount);
  const attemptId = mockId('f');

  // Pantalla Mesas: cada pago propio suma una entrada al historial.
  if (identity !== 'guest') {
    const movementId = attemptId;
    const movementDate = new Date().toISOString();
    state.history.push({
      id: movementId,
      amount_cents: gross,
      date: movementDate,
      mesa_code: mesa.code,
      mesa_status: mesa.status,
      restaurant: mesa.restaurant.name,
      category: mesa.restaurant.category,
    });
    const detailItems = mesa.division_mode === 'consumo'
      ? pricedItems.flatMap((claim) => {
          const item = mesa.items.find((candidate) => candidate.id === claim.item_id);
          return item ? [{
            name: item.name,
            price_cents: item.price_cents,
            quantity: item.quantity,
            category: item.category,
            amount_cents: claim.amount_cents,
            fraction_bps: claim.fraction_bps,
            declared_fraction_bps: null,
          }] : [];
        })
      : requestedItems.flatMap((declared) => {
          const item = mesa.items.find((candidate) => candidate.id === declared.item_id);
          return item ? [{
            name: item.name,
            price_cents: item.price_cents,
            quantity: item.quantity,
            category: item.category,
            amount_cents: null,
            fraction_bps: null,
            declared_fraction_bps: declared.fraction_bps as 2500 | 3333 | 5000 | 6667 | 7500 | 10000,
          }] : [];
        });
    state.movementDetails[movementId] = {
      id: movementId,
      restaurant: { name: mesa.restaurant.name, category: mesa.restaurant.category },
      mesa: { code: mesa.code },
      date: movementDate,
      payment_type: req.payment_type,
      method: null,
      items: detailItems,
      items_amount_cents: itemsAmount,
      tip_amount_cents: tipCents,
      gross_amount_cents: gross,
      fee_amount_cents: 0,
      status: 'succeeded',
    };
  }

  // v2.24 (Connect): el riel es DIRECTO si el restaurante tiene cuenta
  // conectada Y el pago es con tarjeta (el saldo nunca sale de PayMe).
  const connectedAccountId =
    req.payment_type !== 'wallet' ? MOCK_CONNECTED_ACCOUNTS[mesa.restaurant.id] : undefined;

  // D4 + G-11 CERRADO (backend v2.46.0, 7e45db0): el guardado es REAL también
  // bajo direct charge — attach del pm_ FUENTE al Customer de PayMe tras el
  // éxito del cobro, misma semántica que el vault. La condición
  // `!connectedAccountId` que vivía acá modelaba el v2.24 que ignoraba el
  // guardado en el riel directo; conservarla habría sido el mock mintiendo
  // AL REVÉS que antes. Sigue el contrato: sólo tarjeta ('card' — las wallets
  // nativas son no-op, cardEligibility las rechaza), sólo con cuenta.
  if (
    req.payment_type === 'card' &&
    req.save_payment_method &&
    req.stripe_payment_method_id &&
    identity !== 'guest'
  ) {
    saveMockCard(req.stripe_payment_method_id);
  }

  const respuesta: PayMesaResponse = {
    attempt: {
      id: attemptId,
      gross_amount_cents: gross,
      tip_cents: tipCents,
      ...(pricedItems.length > 0 && { items: pricedItems }),
      gross_display: centsToDisplay(gross),
      status: req.payment_type === 'wallet' ? 'processed' : 'succeeded',
      payment_type: req.payment_type,
      ...(req.payment_type !== 'wallet' && {
        client_secret: 'mock_payment_secret',
        stripe_status: 'succeeded',
        requires_action: false,
      }),
      ...(connectedAccountId && { connected_account_id: connectedAccountId }),
      // G-10 (Connect, mock-first): con tarjeta el comercio es el RESTAURANTE.
      // Forma acordada; el contrato real todavía no expone el campo.
      ...(req.payment_type !== 'wallet' && {
        statement_descriptor: mesa.restaurant.name.toUpperCase().slice(0, 22),
      }),
    },
  };
  writeMockIdempotency(idemKey, { hash: idemHash, response: respuesta });
  return delay(respuesta);
}

/** POST /:code/invitations type in_app: invita a un amigo por payme_id. */
export async function mockInviteFriend(
  code: string,
  paymeId: string,
  idempotencyKey: string,
): Promise<CreateInvitationResponse> {
  if (!validIdempotencyKey(idempotencyKey)) {
    return fail(400, 'validation_error');
  }
  const mesa = findMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  if (!mesaPayable(mesa)) return fail(409, 'mesa_not_invitable', { status: mesa.status });
  const invited = state.friends.find((f) => f.payme_id === paymeId);
  if (!invited) {
    return fail(404, 'invited_user_not_found');
  }
  // La autoridad canónica es el uuid resuelto por el backend, no el alias
  // `payme_id` aportado por el cliente.
  const payload = { type: 'in_app', invited_user_id: invited.id };
  const ledgerKey = `invitation:${state.user.id}:${mesa.id}:${idempotencyKey}`;
  const naturalKey = `invitation-natural:${state.user.id}:${mesa.id}:in_app:${invited.id}`;
  const hash = mockPayloadHash(payload, MOCK_PAYLOAD_KEYS.invitation);
  const previous = readMockIdempotency(ledgerKey);
  if (previous) {
    if (previous.hash !== hash) return fail(409, 'idempotency_conflict');
    return delay({ ...invitationReplay(previous), idempotent: true });
  }
  // Igual que invitationAuthority: otra key para el mismo destinatario
  // converge a la única invitación pending natural y queda ligada a ella.
  const natural = readPendingInvitationAuthority(naturalKey);
  if (natural) {
    const response = { ...(natural.response as CreateInvitationResponse), idempotent: true };
    writeMockIdempotency(ledgerKey, { hash, response: natural.response });
    return delay(response);
  }
  const response: CreateInvitationResponse = {
    invitation: {
      id: mockId('f'),
      invitation_type: 'in_app' as const,
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      created_at: new Date().toISOString(),
    },
  };
  writeMockIdempotency(naturalKey, { hash, response });
  writeMockIdempotency(ledgerKey, { hash, response });
  return delay(response);
}

export async function mockCreateInvitation(
  code: string,
  idempotencyKey: string,
): Promise<CreateInvitationResponse> {
  if (!validIdempotencyKey(idempotencyKey)) {
    return fail(400, 'validation_error');
  }
  const mesa = findMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  if (!mesaPayable(mesa)) return fail(409, 'mesa_not_invitable', { status: mesa.status });
  const base = `${window.location.origin}${window.location.pathname}`;
  const payload = { type: 'link' };
  const ledgerKey = `invitation:${state.user.id}:${mesa.id}:${idempotencyKey}`;
  const naturalKey = `invitation-natural:${state.user.id}:${mesa.id}:link`;
  const hash = mockPayloadHash(payload, MOCK_PAYLOAD_KEYS.invitation);
  const previous = readMockIdempotency(ledgerKey);
  if (previous) {
    if (previous.hash !== hash) return fail(409, 'idempotency_conflict');
    return delay({ ...invitationReplay(previous), idempotent: true });
  }
  const natural = readPendingInvitationAuthority(naturalKey);
  if (natural) {
    const response = { ...(natural.response as CreateInvitationResponse), idempotent: true };
    writeMockIdempotency(ledgerKey, { hash, response: natural.response });
    return delay(response);
  }
  const token = `mock-guest-${Date.now().toString(36)}`;
  const response: CreateInvitationResponse = {
    invitation: {
      id: mockId('f'),
      invitation_type: 'link',
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      created_at: new Date().toISOString(),
    },
    // El mismo UUID canónico reconstruye el mismo link en cada replay.
    link: `${base}#/mesa/${code}?t=${token}`,
  };
  // El token nombra SU mesa, como en el backend. Sin esto `accept-link` tendría
  // que aceptar cualquier string y el mock enseñaría que todo link sirve.
  state.linkTokens[token] = code;
  writeMockIdempotency(naturalKey, { hash, response });
  writeMockIdempotency(ledgerKey, { hash, response });
  return delay(response);
}

// ─── Topup (A-3: tres vías) ────────────────────────────────

export async function mockTopupOxxo(amountCents: number, idempotencyKey: string): Promise<unknown> {
  if (!validPositiveCents(amountCents) || amountCents < 5000 || amountCents > 1_000_000) return fail(400, 'validation_error');
  const req = { amount_cents: amountCents };
  // App Backend comparte UNIQUE(user_id,idempotency_key) entre ambos rieles.
  const idemKey = `topup:${idempotencyKey}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.topup_oxxo);
  const previous = readMockIdempotency(idemKey);
  if (previous) {
    if (previous.hash !== idemHash) return fail(409, 'idempotency_conflict');
    return delay(previous.response);
  }
  const ref = `93${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
  const id = mockId('f');
  const voucherExpires = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
  const voucherReference = ref.replace(/(\d{4})(?=\d)/g, '$1 ');
  const fresh = {
    topup: {
      id,
      status: 'processing',
      amount_cents: amountCents,
      amount_display: centsToDisplay(amountCents),
      voucher_reference: voucherReference,
      stripe_voucher_url: null,
      voucher_expires_at: voucherExpires,
    },
  };
  writeMockIdempotency(idemKey, {
    hash: idemHash,
    response: {
      idempotent: true,
      topup: {
        ...fresh.topup,
        method: 'oxxo',
      },
    },
  });
  return delay(fresh);
}

export async function mockTopupCard(
  amountCents: number,
  paymentMethodId: string,
  idempotencyKey: string,
): Promise<unknown> {
  if (!validPositiveCents(amountCents) || amountCents < 5000 || amountCents > 1_000_000) return fail(400, 'validation_error');
  const req = { amount_cents: amountCents, payment_method_id: paymentMethodId };
  // Mismo namespace que OXXO: cambiar de riel con la misma key es conflicto.
  const idemKey = `topup:${idempotencyKey}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.topup_card);
  const previous = readMockIdempotency(idemKey);
  if (previous) {
    if (previous.hash !== idemHash) return fail(409, 'idempotency_conflict');
    return delay(previous.response);
  }
  if (!state.paymentMethods.some((pm) => pm.id === paymentMethodId)) {
    return fail(404, 'payment_method_not_found');
  }
  state.balance_cents += amountCents;
  pushWalletTx('topup_card', amountCents, 'Carga de saldo vía CARD');
  const id = mockId('f');
  const fresh = {
    topup: {
      id,
      status: 'succeeded',
      amount_cents: amountCents,
      amount_display: centsToDisplay(amountCents),
    },
    requires_action: false,
  };
  writeMockIdempotency(idemKey, {
    hash: idemHash,
    response: {
      idempotent: true,
      topup: {
        ...fresh.topup,
        method: 'card',
      },
    },
  });
  return delay(fresh);
}

/**
 * OLA 5C (b): el riel saldo está apagado y esta lectura queda DURMIENTE.
 *
 * Además se elimina un defecto propio, independiente del wallet: la versión
 * anterior **acuñaba y persistía** una CLABE dentro de un `GET`. Una lectura que
 * escribe es un defecto por sí mismo, y no vuelve así aunque el riel se
 * reactive dentro de dos años.
 *
 * Falla cerrada en vez de fabricar: si algo llegara acá con el riel apagado, es
 * un camino que no debería existir, y devolver una CLABE inventada sería
 * enseñar un riel inexistente a quien usa el mock para entender el producto.
 */
export async function mockGetClabe(): Promise<ClabeResponse> {
  return fail(404, 'wallet_rail_disabled');
}

// ─── Transfers ─────────────────────────────────────────────

export async function mockCreateTransfer(
  req: CreateTransferRequest,
): Promise<CreateTransferResponse> {
  if (!validPositiveCents(req.amount_cents)) return fail(400, 'validation_error');
  const idemKey = `transfer:${req.idempotency_key}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.transfer);
  const previous = readMockIdempotency(idemKey);
  if (previous) {
    if (previous.hash !== idemHash) return fail(409, 'idempotency_conflict');
    return delay(previous.response as CreateTransferResponse);
  }
  // C3/C4: `email` ya no viaja en el shape de amigo. El destinatario por correo
  // sigue siendo válido en el contrato de transferencias, pero el mock no puede
  // resolverlo desde su lista: se busca por payme_id o id.
  const to = state.friends.find(
    (f) => f.payme_id === req.to_payme_id || f.id === req.to_user_id,
  );
  if (!to) return fail(404, 'recipient_not_found');
  const available = availableBalance();
  if (available < req.amount_cents) {
    return fail(402, 'insufficient_funds', { available, required: req.amount_cents });
  }
  state.balance_cents -= req.amount_cents;
  pushWalletTx('transfer_out', -req.amount_cents, req.concept ?? `Transferencia a ${to.first_name}`);
  const now = new Date().toISOString();
  state.transfers.unshift({
    id: mockId('f'),
    amount_cents: req.amount_cents,
    amount_display: centsToDisplay(req.amount_cents),
    concept: req.concept ?? null,
    status: 'completed',
    completed_at: now,
    created_at: now,
    direction: 'sent',
    counterparty_payme_id: to.payme_id,
    counterparty_name: to.full_name,
  });
  const fresh: CreateTransferResponse = {
    transfer: {
      id: state.transfers[0].id,
      amount_cents: req.amount_cents,
      concept: req.concept ?? null,
      completed_at: now,
      amount_display: centsToDisplay(req.amount_cents),
      to: { payme_id: to.payme_id, full_name: to.full_name },
    },
  };
  // Replay exacto del espejo: recipient se acredita por UUID estable.
  const replay: CreateTransferResponse = {
    idempotent: true,
    transfer: {
      id: state.transfers[0].id,
      amount_cents: req.amount_cents,
      concept: req.concept ?? null,
      completed_at: now,
      amount_display: centsToDisplay(req.amount_cents),
      status: 'completed',
      to_user_id: to.id,
    },
  };
  writeMockIdempotency(idemKey, { hash: idemHash, response: replay });
  return delay(fresh);
}

export async function mockListTransfers(): Promise<TransfersResponse> {
  return delay({ transfers: [...state.transfers] });
}

// ─── Payment methods ───────────────────────────────────────

export async function mockPaymentMethods(): Promise<PaymentMethodsResponse> {
  return delay({ payment_methods: [...state.paymentMethods] });
}

export async function mockSetDefaultPaymentMethod(id: string): Promise<void> {
  if (!state.paymentMethods.some((pm) => pm.id === id)) return fail(404, 'payment_method_not_found');
  state.paymentMethods = state.paymentMethods.map((pm) => ({ ...pm, is_default: pm.id === id }));
  return delay(undefined);
}

export async function mockRemovePaymentMethod(id: string): Promise<void> {
  if (!state.paymentMethods.some((pm) => pm.id === id)) return fail(404, 'payment_method_not_found');
  state.paymentMethods = state.paymentMethods.filter((pm) => pm.id !== id);
  return delay(undefined);
}

export async function mockCreateSetupIntent(
  idempotencyKey: string,
): Promise<CreateSetupIntentResponse> {
  if (!validIdempotencyKey(idempotencyKey)) {
    return fail(400, 'validation_error');
  }
  const ledgerKey = `setup-intent:${state.user.id}:${idempotencyKey}`;
  const previous = readMockIdempotency(ledgerKey);
  if (previous) return delay(previous.response as CreateSetupIntentResponse);
  const setupIntentId = `seti_mock_${mockId('f')}`;
  const response: CreateSetupIntentResponse = {
    setup_intent_id: setupIntentId,
    client_secret: `${setupIntentId}_secret_mock`,
  };
  writeMockIdempotency(ledgerKey, { hash: '{}', response });
  return delay(response);
}

/**
 * D4: en el mock no hay Stripe, así que "guardar una tarjeta" fabrica una
 * verosímil con la forma del contrato v2.16 (id uuid + pm_…). La usan el alta
 * de Cuenta (attach) y el save_payment_method de garantía/pago. Idempotente
 * por pm_ (el backend real también deduplica el attach), pero un dupe con
 * set_as_default SÍ actualiza la principal.
 */
export function saveMockCard(stripePaymentMethodId: string, setAsDefault?: boolean): PaymentMethod {
  const existing = state.paymentMethods.find(
    (pm) => pm.stripe_payment_method_id === stripePaymentMethodId,
  );
  if (existing) {
    if (setAsDefault) {
      state.paymentMethods = state.paymentMethods.map((pm) => ({
        ...pm,
        is_default: pm.stripe_payment_method_id === stripePaymentMethodId,
      }));
    }
    return state.paymentMethods.find((pm) => pm.id === existing.id)!;
  }
  if (setAsDefault) {
    state.paymentMethods = state.paymentMethods.map((pm) => ({ ...pm, is_default: false }));
  }
  const banks = ['BBVA', 'Banorte', 'HSBC', 'Citibanamex'];
  const bank = banks[state.paymentMethods.length % banks.length];
  const lastFour = String(Math.floor(1000 + Math.random() * 9000));
  const created: PaymentMethod = {
    id: mockId('b'),
    stripe_payment_method_id: stripePaymentMethodId,
    brand: 'visa',
    bank_name: bank,
    type: 'debit',
    last_four: lastFour,
    exp_month: 11,
    exp_year: 2030,
    is_default: !!setAsDefault || state.paymentMethods.length === 0,
    display: `${bank} · Débito · •••• ${lastFour}`,
  };
  state.paymentMethods.push(created);
  return created;
}

export async function mockAttachPaymentMethod(
  stripePaymentMethodId: string,
  setAsDefault?: boolean,
): Promise<AttachPaymentMethodResponse> {
  const existed = state.paymentMethods.some(
    (pm) => pm.stripe_payment_method_id === stripePaymentMethodId,
  );
  const paymentMethod = saveMockCard(stripePaymentMethodId, setAsDefault);
  return delay({ payment_method: paymentMethod, ...(existed && { idempotent: true }) });
}

// ─── Notifications / invitaciones in-app ───────────────────

export async function mockNotifications(): Promise<NotificationsResponse> {
  const unread = state.notifications.filter((n) => !n.read_at).length;
  return delay({ notifications: [...state.notifications], unread_count: unread, limit: 20, offset: 0 });
}

export async function mockUnreadCount(): Promise<{ unread_count: number }> {
  return delay({ unread_count: state.notifications.filter((n) => !n.read_at).length });
}

export async function mockMarkAllNotificationsRead(): Promise<void> {
  const now = new Date().toISOString();
  state.notifications = state.notifications.map((n) => ({ ...n, read_at: n.read_at ?? now }));
  return delay(undefined);
}

/**
 * Espejo de `utils/stateMachine.js · mesaViva()` (v2.45.0): UNA mesa está
 * viva cuando todavía se puede estar en ella. `fully_paid` está viva A
 * PROPÓSITO (decisión B ratificada 2026-08-06: pagada entera pero no cerrada
 * admite gente). Es EL MISMO predicado para las tres puertas — las dos de
 * entrar y el marcador del listado —, igual que en el emisor: una segunda
 * expresión de la regla se desincroniza sola.
 *
 * ⚠️ NO confundir con el filtro de `/mesas/open` (open|partially_paid): son
 * dos conjuntos distintos por contrato — una fully_paid admite gente pero no
 * se lista como "abierta".
 */
function mesaViva(status: MockMesa['status']): boolean {
  return status === 'open' || status === 'partially_paid' || status === 'fully_paid';
}

export async function mockPendingInvitations(): Promise<PendingInvitationsResponse> {
  // Espejo del WHERE del emisor (`routes/invitations.js`): pendiente Y NO
  // VENCIDA. Y desde v2.45.0 el listado MARCA, no filtra: la invitación de
  // mesa muerta sigue viniendo —desaparecerla parecería un bug— con
  // `mesa_joinable: false` computado en vivo con el MISMO `mesaViva()` de las
  // puertas, y el `mesa_status` actual para el copy.
  const ahora = new Date().toISOString();
  state.mesas.forEach(settleIfExpired);
  return delay({
    invitations: state.pendingInvitations
      .filter((i) => i.expires_at > ahora)
      .map((i) => {
        const mesa = findMesa(i.mesa_code);
        const status = mesa ? mesa.status : i.mesa_status;
        return { ...i, mesa_status: status, mesa_joinable: mesaViva(status) };
      }),
  });
}

/**
 * `POST /invitations/accept-link` — CIERRE DEL PAGO SIN CUENTA (v2.32.0).
 *
 * Replica las propiedades del emisor que importan, no su implementación:
 *
 *  - **Ciego a propósito.** Token inexistente, de otra mesa que ya no está, o
 *    basura: todos el MISMO 403 `invitation_link_not_valid`. El emisor no
 *    distingue inválido de vencido de cancelado de supersedido porque hacerlo
 *    le diría a un desconocido si una mesa existe. Un mock que devolviera
 *    404 para "no existe" y 403 para "vencido" **enseñaría el oráculo que el
 *    contrato eliminó** — que es la lección 18 de este ciclo, ya pagada.
 *  - **Idempotente.** Canjear dos veces deja una sola inscripción.
 *  - **No consume el link.** Es MULTIUSO: canjearlo no lo invalida para el
 *    resto de la mesa.
 *  - **Requiere sesión.** Sin ella el adaptador real da 401 y acá también.
 */
export async function mockAcceptInvitationLink(
  token: string,
): Promise<AcceptInvitationLinkResponse> {
  if (typeof token !== 'string' || token.length < 8 || token.length > 200) {
    return fail(400, 'invitation_token_required');
  }
  if (!loadSession()) return fail(401, 'auth_required');
  const code = state.linkTokens[token];
  const mesa = code ? findMesa(code) : null;
  // Un solo 403 para los cuatro motivos. No agregar ramas que los separen.
  if (!code || !mesa) return fail(403, 'invitation_link_not_valid');
  // Gate de admisión (v2.45.0 · decisión C): el MISMO `mesaViva()` que la
  // puerta in-app, DESPUÉS del 403 opaco — el 410 revela el estado de la mesa
  // sólo a quien ya probó tener un token válido.
  settleIfExpired(mesa);
  if (!mesaViva(mesa.status)) {
    return fail(410, 'mesa_not_joinable', { mesa_status: mesa.status });
  }
  // La inscripción es por usuario y el link NO se marca consumido.
  if (!state.joinedMesaCodes.includes(code)) state.joinedMesaCodes.push(code);
  return delay({ joined: true as const, mesa_code: code });
}

export async function mockAcceptInvitation(id: string): Promise<{ accepted: boolean }> {
  const inv = state.pendingInvitations.find((i) => i.id === id);
  if (!inv) return fail(404, 'invitation_not_found');
  // El emisor valida el vencimiento AL ACEPTAR y contesta 410 marcándola
  // 'expired' (`routes/invitations.js:69-74`). El mock aceptaba incondicional:
  // "Te sumaste ✓" a una invitación muerta.
  if (inv.expires_at <= new Date().toISOString()) {
    state.pendingInvitations = state.pendingInvitations.filter((i) => i.id !== id);
    return fail(410, 'invitation_expired');
  }
  // Gate de admisión (v2.45.0): la invitación está viva; ahora la MESA tiene
  // que estarlo. Mismo orden que el emisor (vencimiento primero, mesa
  // después) y mismo detalle: la invitación QUEDA pendiente — la mesa no
  // revive, y consumirla acá sería inventar semántica.
  {
    const mesaInv = findMesa(inv.mesa_code);
    if (mesaInv) settleIfExpired(mesaInv);
    const st = mesaInv ? mesaInv.status : inv.mesa_status;
    if (!mesaViva(st)) {
      return fail(410, 'mesa_not_joinable', { mesa_status: st });
    }
  }
  state.pendingInvitations = state.pendingInvitations.filter((i) => i.id !== id);
  // El emisor INSERTA en mesa_participants al aceptar (routes/invitations.js:102)
  // y `joinedMesaCodes` es su espejo acá. Sin esta línea, aceptar era un no-op
  // de participación: la mesa aceptada JAMÁS aparecía en /mesas/open — el
  // síntoma de G-28, reproducido por el mock en el riel de invitaciones in-app.
  if (!state.joinedMesaCodes.includes(inv.mesa_code)) {
    state.joinedMesaCodes.push(inv.mesa_code);
  }
  state.notifications = state.notifications.map((n) =>
    n.type === 'invitation_received' ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n,
  );
  return delay({ accepted: true });
}

// ─── Stats (GET /account/stats) ────────────────────────────

export async function mockStats(): Promise<StatsResponse> {
  const spent = 216500;
  const visits = 6;
  const avg = Math.floor(spent / visits);
  return delay({
    month: {
      spent_cents: spent,
      spent_display: centsToDisplay(spent),
      visits,
      avg_per_visit_cents: avg,
      avg_per_visit_display: centsToDisplay(avg),
    },
    top_restaurants: [
      { name: 'La Parolaccia', visits: 3 },
      { name: 'Hanzo Sushi', visits: 2 },
      { name: 'Café Nube', visits: 1 },
    ],
    top_dish: { name: 'Tagliatelle Bolognese', times: 3 },
    favorite_category: 'italian',
  });
}

// ─── Friends / Groups ──────────────────────────────────────

export async function mockFriends(): Promise<FriendsResponse> {
  // C3: el contrato de amigos ya no lleva `email`. Se proyecta explícitamente
  // para que el mock no pueda filtrarlo por descuido.
  return delay({
    friends: state.friends.map(({ email: _email, ...persona }) => persona),
  });
}

/**
 * C1/C2 · una solicitud es una INTENCIÓN, no un vínculo.
 *
 * Responde 202 `{ requested: true, request_id }` SIEMPRE: exista o no la
 * persona, sea o no ya tu amigo, te haya bloqueado o no. El receipt es nuevo y
 * opaco en todos los caminos. El mock replica esa ceguera a propósito: si acá
 * devolviera 404 o variara la cantidad, la demo reabriría el oráculo.
 */
export async function mockAddFriend(query: { email?: string; payme_id?: string }): Promise<FriendRequestCreatedResponse> {
  const requestedAt = new Date().toISOString();
  const receiptId = mockId('f');
  const email = query.email?.trim().toLowerCase();
  const destino = [...state.friends, ...state.directory].find(
    (p) => (email !== undefined && p.email.toLowerCase() === email)
      || (query.payme_id !== undefined && p.payme_id === query.payme_id),
  );

  if (destino) {
    const bloqueado = state.blockedUserIds.includes(destino.id);
    const yaEsAmigo = state.friends.some((f) => f.id === destino.id);
    // Si el otro YA me pidió, pedirle yo equivale a aceptar: el contrato evita
    // así dos pendientes cruzadas que nadie resuelve.
    const reciproca = state.friendRequests.findIndex(
      (r) => r.direction === 'incoming' && r.person.id === destino.id,
    );
    if (!bloqueado && !yaEsAmigo && reciproca !== -1) {
      const [req] = state.friendRequests.splice(reciproca, 1);
      state.friends.push({ ...req.person, added_at: new Date().toISOString() });
    }
  }
  state.friendRequestReceipts.push({
    id: receiptId,
    requested_at: requestedAt,
  });
  // Misma forma y un recibo nuevo en TODOS los casos: no existe, existe, ya es
  // amigo, ya hay pendiente, o me bloqueó. Nunca incluye identidad.
  return delay({ requested: true as const, request_id: receiptId });
}

export function mockFriendRequests(direction: 'incoming'): Promise<IncomingFriendRequestsResponse>;
export function mockFriendRequests(direction: 'outgoing'): Promise<OutgoingFriendRequestsResponse>;
export function mockFriendRequests(direction: FriendRequestDirection): Promise<FriendRequestsResponse> {
  if (direction === 'outgoing') {
    return delay({
      direction,
      requests: state.friendRequestReceipts.map(({ id, requested_at }) => ({ id, requested_at })),
    });
  }
  return delay({
    direction,
    requests: state.friendRequests
      .filter((request) => request.direction === 'incoming')
      .map((request) => ({
        id: request.id,
        user: {
          id: request.person.id,
          payme_id: request.person.payme_id,
          first_name: request.person.first_name,
          last_name: request.person.last_name,
          full_name: request.person.full_name,
        },
        requested_at: request.requested_at,
      })),
  });
}

/** Aceptar: sólo una ENTRANTE. Una saliente no es mía para aceptar. */
export async function mockAcceptFriendRequest(requestId: string): Promise<void> {
  const i = state.friendRequests.findIndex((r) => r.id === requestId && r.direction === 'incoming');
  if (i === -1) return fail(404, 'request_not_found');
  const [req] = state.friendRequests.splice(i, 1);
  state.friends.push({ ...req.person, added_at: new Date().toISOString() });
  return delay(undefined);
}

export async function mockRejectFriendRequest(requestId: string): Promise<void> {
  const i = state.friendRequests.findIndex((r) => r.id === requestId && r.direction === 'incoming');
  if (i === -1) return fail(404, 'request_not_found');
  state.friendRequests.splice(i, 1);
  return delay(undefined);
}

/** Cancelar: sólo una PROPIA todavía pendiente. */
export async function mockCancelFriendRequest(requestId: string): Promise<FriendRequestCancelledResponse> {
  const i = state.friendRequestReceipts.findIndex((receipt) => receipt.id === requestId);
  if (i === -1) return fail(404, 'request_not_found');
  state.friendRequestReceipts.splice(i, 1);
  return delay({ cancelled: true as const });
}

/**
 * Bloquear rompe la amistad en ambos sentidos y borra cualquier solicitud viva
 * con esa persona, igual que el backend.
 */
export async function mockBlockUser(userId: string): Promise<void> {
  if (userId === state.user.id) return fail(400, 'cannot_block_self');
  const conocido =
    state.friends.some((f) => f.id === userId) ||
    state.friendRequests.some((r) => r.person.id === userId);
  if (!conocido) return fail(404, 'user_not_found');
  state.friends = state.friends.filter((f) => f.id !== userId);
  state.friendRequests = state.friendRequests.filter((r) => r.person.id !== userId);
  if (!state.blockedUserIds.includes(userId)) state.blockedUserIds.push(userId);
  return delay(undefined);
}

export async function mockUnblockUser(userId: string): Promise<void> {
  if (!state.blockedUserIds.includes(userId)) return fail(404, 'block_not_found');
  state.blockedUserIds = state.blockedUserIds.filter((id) => id !== userId);
  return delay(undefined);
}

export async function mockRemoveFriend(friendId: string): Promise<void> {
  state.friends = state.friends.filter((f) => f.id !== friendId);
  return delay(undefined);
}

export async function mockGroups(): Promise<GroupsResponse> {
  return delay({
    groups: state.groups.map(({ memberIds, ...g }) => ({ ...g, member_count: memberIds.length })),
  });
}

export async function mockGroupDetail(id: string): Promise<GroupDetailResponse> {
  const group = state.groups.find((g) => g.id === id);
  if (!group) return fail(404, 'group_not_found');
  const members = state.friends.filter((f) => group.memberIds.includes(f.id));
  return delay({
    group: { id: group.id, name: group.name, icon: group.icon },
    members: members.map((m) => ({
      id: m.id,
      payme_id: m.payme_id,
      first_name: m.first_name,
      last_name: m.last_name,
      // Grupos SÍ conserva el correo (contract-mirror/routes/groups.js).
      email: m.email,
    })),
  });
}

export async function mockCreateGroup(name: string, icon?: string): Promise<void> {
  state.groups.push({
    id: mockId('a'),
    name,
    icon: icon ?? '👥',
    created_at: new Date().toISOString(),
    member_count: 0,
    memberIds: [],
  });
  return delay(undefined);
}

export async function mockAddGroupMember(groupId: string, friendId: string): Promise<void> {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return fail(404, 'group_not_found');
  if (!group.memberIds.includes(friendId)) group.memberIds.push(friendId);
  return delay(undefined);
}

export async function mockRemoveGroupMember(groupId: string, friendId: string): Promise<void> {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return fail(404, 'group_not_found');
  group.memberIds = group.memberIds.filter((id) => id !== friendId);
  return delay(undefined);
}

export async function mockDeleteGroup(groupId: string): Promise<void> {
  if (!state.groups.some((g) => g.id === groupId)) return fail(404, 'group_not_found');
  state.groups = state.groups.filter((g) => g.id !== groupId);
  return delay(undefined);
}
